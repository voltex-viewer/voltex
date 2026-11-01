import { hexToRgba, RenderMode, type RenderContext, type Signal, type PluginContext, type RenderObject, type Row, type RenderBounds, type MouseEvent as PluginMouseEvent, type Sample, SignalMetadata, formatValueForDisplay } from '@voltex-viewer/plugin-api';
import { displayValue, NeighbourCache } from '@voltex-viewer/signal-utils';
import { type WaveformConfig } from './waveformConfig';
import type { SignalTooltipData, TooltipData } from './waveformTooltipRenderObject';
import type { BufferData, SignalBufferData } from './waveformRendererPlugin';
import { estimateSample, type SampleEstimate } from './lod/estimate';
import { lodLevel } from './lod/lodView';
import type { WaveformShaders } from './waveformShaders';
import { WaveformRenderObject } from './waveformRenderObject';
import {
    type ExpandedSegment,
    type ExpandedEnumResources,
    ExpandedEnumGeometryRenderer,
} from './expandedEnum';

type HoveredSample = SampleEstimate;

function isEnumMode(mode: RenderMode): boolean {
    return mode === RenderMode.Enum || mode === RenderMode.ExpandedEnum;
}

function fromNeighbours(floor: Sample | null, next: Sample | null, time: number, nearest: boolean): HoveredSample | null {
    const sample = (point: Sample, after: Sample | null): HoveredSample => ({ point, next: after, exact: true });
    if (!nearest) return floor && sample(floor, next);
    if (floor && (!next || time - floor.time <= next.time - time)) return sample(floor, next);
    return next && sample(next, null);
}

export class WaveformRowHoverOverlayRenderObject {
    private readonly neighbours = new NeighbourCache();
    private mouse: { offsetX: number; offsetY: number; clientX: number; clientY: number } | null = null;
    
    private readonly highlightBuffers: Map<Signal, BufferData> = new Map();
    private _tooltipData: TooltipData | null = null;
    
    // Expanded mode highlight
    private expandedHighlightRenderer: ExpandedEnumGeometryRenderer | null = null;
    private expandedHighlightData: { signal: Signal; segment: ExpandedSegment; sample: HoveredSample } | null = null;

    constructor(
        parent: RenderObject,
        private readonly context: PluginContext,
        config: WaveformConfig,
        private readonly row: Row,
        private readonly signals: Signal[],
        private readonly signalBuffers: Map<Signal, SignalBufferData>,
        sharedInstanceGeometryBuffer: WebGLBuffer,
        sharedBevelJoinGeometryBuffer: WebGLBuffer,
        private readonly waveformPrograms: WaveformShaders,
        private readonly mainRenderObjects: Map<Signal, WaveformRenderObject>,
        private readonly expandedResources: ExpandedEnumResources,
        zIndex: number = 90
    ) {
        parent.addChild({
            zIndex: zIndex,
            render: this.render.bind(this),
            onMouseMove: ((event: PluginMouseEvent) => {
                this.mouse = {
                    offsetX: event.offsetX,
                    offsetY: event.offsetY,
                    clientX: event.clientX,
                    clientY: event.clientY,
                }
                this.context.requestRender();
            }),
            onMouseEnter: ((event: PluginMouseEvent) => {
                this.mouse = {
                    offsetX: event.offsetX,
                    offsetY: event.offsetY,
                    clientX: event.clientX,
                    clientY: event.clientY,
                }
                this.context.requestRender();
            }),
            onMouseLeave: (() => {
                this.mouse = null;
                this.context.requestRender();
            }),
        });

        // Create separate render object for expanded highlight (above main waveform at z-index 0, below text rendered at end)
        parent.addChild({
            zIndex: 1,
            render: this.renderExpandedHighlight.bind(this),
        });

        // Create highlight render objects for each signal
        for (const signal of signals) {
            const bufferData = signalBuffers.get(signal);
            if (bufferData) {
                // Create a highlight signal that will hold just the highlighted data
                const baseMetadata = this.context.signalMetadata.get(signal);
                const highlightMetadata = new Proxy<SignalMetadata>(baseMetadata, {
                    get: (target, prop) => {
                        if (prop === 'color') {
                            return this.createHighlightColor(target.color);
                        } else if (prop === 'renderMode') {
                            return target.renderMode === RenderMode.Enum ? RenderMode.Enum : RenderMode.Dots;
                        }
                        return target[prop as keyof typeof target];
                    }
                });

                

                // Create dedicated highlight buffers for this signal
                const highlightTimeHighBuffer = context.webgl.gl.createBuffer();
                const highlightTimeLowBuffer = context.webgl.gl.createBuffer();
                const highlightValueBuffer = context.webgl.gl.createBuffer();
                if (!highlightTimeHighBuffer || !highlightTimeLowBuffer || !highlightValueBuffer) {
                    throw new Error('Failed to create highlight buffers');
                }

                const bufferData: BufferData = {
                    timeHighBuffer: highlightTimeHighBuffer,
                    timeLowBuffer: highlightTimeLowBuffer,
                    valueBuffer: highlightValueBuffer,
                    bufferCapacity: 0,
                    bufferLength: 0,
                };

                // Store the buffer references for direct access
                this.highlightBuffers.set(signal, bufferData);

                const highlightConfig = {
                    ...config,
                    dotSize: config.dotSize * 1.5,
                    lineWidth: config.lineWidth * 1.5,
                };

                new WaveformRenderObject(
                    parent,
                    context.webgl.gl,
                    highlightConfig,
                    bufferData,
                    sharedInstanceGeometryBuffer,
                    sharedBevelJoinGeometryBuffer,
                                        highlightMetadata,
                    waveformPrograms,
                    signal,
                    row,
                    null, // No expanded enum resources for highlight
                    95
                );
            }
        }
    }

    public get tooltipData(): TooltipData | null {
        return this._tooltipData;
    }

    dispose(): void {
        // Clean up highlight buffers
        for (const bufferData of this.highlightBuffers.values()) {
            this.context.webgl.gl.deleteBuffer(bufferData.timeHighBuffer);
            this.context.webgl.gl.deleteBuffer(bufferData.timeLowBuffer);
            this.context.webgl.gl.deleteBuffer(bufferData.valueBuffer);
        }
        
        // Clean up expanded highlight renderer
        if (this.expandedHighlightRenderer) {
            this.expandedHighlightRenderer.dispose();
        }
        
        
        this.highlightBuffers.clear();
    }

    private createHighlightColor(baseColor: string): string {
        const [r, g, b] = hexToRgba(baseColor);
        const brightnessBoost = 0.3;
        const tintedR = Math.min(1.0, r + brightnessBoost);
        const tintedG = Math.min(1.0, g + brightnessBoost);
        const tintedB = Math.min(1.0, b + brightnessBoost);
        
        // Convert back to hex
        const toHex = (val: number) => Math.round(val * 255).toString(16).padStart(2, '0');
        return `#${toHex(tintedR)}${toHex(tintedG)}${toHex(tintedB)}`;
    }

    render(context: RenderContext, bounds: RenderBounds): boolean {
        this.expandedHighlightData = null;
        
        if (this.mouse === null) {
            this._tooltipData = null;
            for (const buffer of this.highlightBuffers.values()) {
                buffer.bufferLength = 0;
            }
            return false;
        }

        const { state } = context;
        
        // Aggregate tooltip data
        const signalData: Array<SignalTooltipData> = [];

        // Find data for all signals at this position and render highlight dots
        for (const signal of this.signals) {
            const signalMetadata = this.context.signalMetadata.get(signal);
            const mainRenderObject = this.mainRenderObjects.get(signal);
            
            if (!mainRenderObject) continue;
            
            const time = mainRenderObject.getTimeForPosition(
                this.mouse.offsetX,
                this.mouse.offsetY,
                bounds.height,
                state
            );

            const highlightBufferData = this.highlightBuffers.get(signal);
            if (highlightBufferData) highlightBufferData.bufferLength = 0;

            const sample = this.hoveredSample(signal, time, signalMetadata.renderMode, context.dpr);
            if (sample === null) continue;
            const display = formatValueForDisplay(displayValue(signal, sample.point), signalMetadata.display);
            if (display === "null") continue;
            signalData.push({
                time: sample.point.time,
                value: sample.point.value,
                // Marked as an estimate until the exact samples load
                display: sample.exact ? display : `≈ ${display}`,
                signal: signal,
                color: signalMetadata.color,
                units: signal.unit || '',
            });

            this.updateHighlightSignal(signal, sample, context, signalMetadata.renderMode);
        }

        // Update tooltip with aggregated data or hide if no valid data
        if (signalData.length > 0) {
            this._tooltipData = {
                visible: true,
                x: this.mouse.clientX,
                y: this.mouse.clientY,
                signals: signalData,
                yScale: this.row.yScale
            };
        } else {
            this._tooltipData = null;
        }

        return false;
    }

    // Enum signals show the sample in force at the time, others the nearest one. The points already drawn often
    // pin it down, and otherwise give an estimate until the exact samples load.
    private hoveredSample(signal: Signal, time: number, renderMode: RenderMode, dpr: number): HoveredSample | null {
        const nearest = !isEnumMode(renderMode);
        const geometry = this.signalBuffers.get(signal)?.lod.geometry ?? null;
        const columnWidth = Math.pow(2, lodLevel(this.context.state.pxPerSecond * dpr));
        const estimate = geometry && estimateSample(geometry, time, columnWidth, nearest, signal.null);
        let sample: HoveredSample | null = estimate?.exact ? estimate : null;
        if (!sample) {
            const around = this.neighbours.neighboursAt(signal, time, () => this.context.requestRender());
            sample = around ? fromNeighbours(around.floor, around.next, time, nearest) : estimate;
        }
        // Over a gap there is nothing to show
        return sample && sample.point.value !== signal.null ? sample : null;
    }

    private updateHighlightSignal(
        signal: Signal,
        sample: HoveredSample,
        context: RenderContext,
        renderMode: RenderMode
    ): void {
        const { gl } = context.render;

        // Check if the main render object is in expanded mode
        const mainRenderObject = this.mainRenderObjects.get(signal);
        const isExpandedMode = mainRenderObject && mainRenderObject.expandedModeProgress > 0;
        if (isExpandedMode && renderMode === RenderMode.Enum) {
            // Get the expanded segment for this data point
            const segment = mainRenderObject.getExpandedSegmentForTime(sample.point.time, context.state);
            if (segment) {
                this.expandedHighlightData = { signal, segment, sample };
            }
            return;
        }

        const points: Sample[] = [];
        if (renderMode === RenderMode.Enum) {
            if (sample.next === null) return;
            points.push(sample.point, sample.next);
        } else {
            points.push(sample.point);
        }

        // Get the highlight buffer data directly from our stored references
        const highlightBufferData = this.highlightBuffers.get(signal);
        if (highlightBufferData) {
            // Convert points to separate time high/low and value arrays for WebGL buffers
            const timeHighData = new Float32Array(points.length);
            const timeLowData = new Float32Array(points.length);
            const valueData = new Float32Array(points.map(p => p.value));

            for (let i = 0; i < points.length; i++) {
                const time = points[i].time;
                const high = Math.fround(time);
                timeHighData[i] = high;
                timeLowData[i] = time - high;
            }

            gl.bindBuffer(gl.ARRAY_BUFFER, highlightBufferData.timeHighBuffer);
            gl.bufferData(gl.ARRAY_BUFFER, timeHighData, gl.DYNAMIC_DRAW);

            gl.bindBuffer(gl.ARRAY_BUFFER, highlightBufferData.timeLowBuffer);
            gl.bufferData(gl.ARRAY_BUFFER, timeLowData, gl.DYNAMIC_DRAW);

            gl.bindBuffer(gl.ARRAY_BUFFER, highlightBufferData.valueBuffer);
            gl.bufferData(gl.ARRAY_BUFFER, valueData, gl.DYNAMIC_DRAW);

            // Update buffer metadata
            highlightBufferData.bufferLength = points.length;
            highlightBufferData.bufferCapacity = points.length;
        }
    }

    private renderExpandedHighlight(context: RenderContext, bounds: RenderBounds): boolean {
        if (!this.expandedHighlightData) return false;
        
                const { signal, segment, sample } = this.expandedHighlightData;
        
        const mainRenderObject = this.mainRenderObjects.get(signal);
        if (!mainRenderObject || mainRenderObject.expandedModeProgress <= 0) {
            this.expandedHighlightData = null;
            return false;
        }
        
        // Re-query the segment position for current frame (tracks animation)
        const updatedSegment = mainRenderObject.getExpandedSegmentForTime(segment.startTime, context.state);
        if (!updatedSegment) {
            return false;
        }
        
        // Construct sub-segment: narrow original bounds (specific data index) + full segment render bounds
        const { state } = context;
                const highlightStartTime = sample.point.time;
        const highlightEndTime = sample.next?.time ?? highlightStartTime;
        
        const highlightOrigStartX = highlightStartTime * state.pxPerSecond - state.offset;
        const highlightOrigEndX = highlightEndTime * state.pxPerSecond - state.offset;
        
        const highlightSegment: ExpandedSegment = {
            startTime: highlightStartTime,
            endTime: highlightEndTime,
            originalStartX: highlightOrigStartX,
            originalEndX: highlightOrigEndX,
            renderStartX: updatedSegment.renderStartX,
            renderEndX: updatedSegment.renderEndX,
            value: updatedSegment.value,
        };
        
        // Create renderer lazily
        if (!this.expandedHighlightRenderer) {
            this.expandedHighlightRenderer = new ExpandedEnumGeometryRenderer(
                this.context.webgl.gl,
                this.waveformPrograms,
                this.expandedResources
            );
        }
        
        const signalMetadata = this.context.signalMetadata.get(signal);
        const highlightColor = this.createHighlightColor(signalMetadata.color);
        
        this.expandedHighlightRenderer.renderHighlight(
            context,
            bounds,
            highlightSegment,
            signal,
            highlightColor,
            mainRenderObject.expandedModeProgress
        );
        
        return false;
    }
}
