import type { PluginContext, Row } from '../../Plugin';
import type { Signal, ChannelPoint } from '../../Signal';
import { RenderObject, type RenderContext, type RenderBounds, type MouseEvent } from '../../RenderObject';
import { WebGLUtils } from '../../WebGLUtils';
import { type WaveformConfig } from './WaveformConfig';
import { RenderMode } from '../../Plugin';
import type { WaveformTooltipRenderObject } from './WaveformTooltipRenderObject';
import type { ChannelBufferData } from './WaveformRendererPlugin';
import type { WaveformShaders } from './WaveformShaders';
import { WaveformRenderObject } from './WaveformRenderObject';

/**
 * A lightweight signal wrapper that contains just the highlighted data points
 * while preserving the original signal's valueTable for enum rendering
 */
class HighlightSignal implements Signal {
    private _data: ChannelPoint[];
    
    constructor(
        public readonly source: Signal['source'],
        data: ChannelPoint[],
        public readonly valueTable: ReadonlyMap<number, string>,
        public readonly minTime: number,
        public readonly maxTime: number,
        public readonly minValue: number,
        public readonly maxValue: number
    ) {
        this._data = data;
    }
    
    data(index: number): ChannelPoint {
        return this._data[index] || [0, 0];
    }
    
    get length(): number {
        return this._data.length;
    }
}

export class WaveformRowHoverOverlayRenderObject extends RenderObject {
    private mouse: { offsetX: number; clientX: number; clientY: number } | null = null;
    private readonly signals: Signal[];
    private readonly signalBuffers: Map<Signal, ChannelBufferData>;
    private readonly highlightRenderObjects: Map<Signal, WaveformRenderObject> = new Map();
    private readonly highlightSignals: Map<Signal, HighlightSignal> = new Map();

    constructor(
        private readonly context: PluginContext,
        private readonly config: WaveformConfig,
        private readonly row: Row,
        private readonly tooltipRenderObject: WaveformTooltipRenderObject,
        signals: Signal[],
        signalBuffers: Map<Signal, ChannelBufferData>,
        sharedInstanceGeometryBuffer: WebGLBuffer,
        sharedBevelJoinGeometryBuffer: WebGLBuffer,
        instancingExt: ANGLE_instanced_arrays,
        waveformPrograms: WaveformShaders,
        zIndex: number = 10
    ) {
        super(zIndex);
        this.signals = signals;
        this.signalBuffers = signalBuffers;

        // Create highlight render objects for each signal
        for (const signal of signals) {
            const bufferData = signalBuffers.get(signal);
            if (bufferData) {
                // Create a highlight signal that will hold just the highlighted data
                const highlightSignal = new HighlightSignal(
                    signal.source,
                    [], // Start with empty data
                    signal.valueTable, // Preserve the original valueTable
                    signal.minTime,
                    signal.maxTime,
                    signal.minValue,
                    signal.maxValue
                );
                
                this.highlightSignals.set(signal, highlightSignal);

                // Create dedicated highlight buffer for this signal
                const highlightBuffer = context.webgl.gl.createBuffer();
                if (!highlightBuffer) {
                    throw new Error('Failed to create highlight buffer');
                }

                const highlightBufferData: ChannelBufferData = {
                    buffer: highlightBuffer,
                    lastDataLength: 0,
                    updateIndex: 0,
                    pointCount: 0
                };

                const baseColor = this.context.signalMetadata.getColor(signal);
                const highlightColor = this.createHighlightColor(baseColor);
                const highlightConfig = {
                    ...config,
                    dotSize: config.dotSize * 1.5, // Make highlight dots larger
                    lineWidth: config.lineWidth * 1.5 // Make highlight lines thicker for enum mode
                };
                // Proxy the row, overriding the render mode
                const proxyRow = new Proxy(row, {
                    get(target, prop, receiver) {
                        if (prop === 'renderMode') {
                            return target.renderMode === RenderMode.Enum ? RenderMode.Enum : RenderMode.Dots;
                        }
                        return Reflect.get(target, prop, receiver);
                    }
                });

                const highlightRenderObject = new WaveformRenderObject(
                    highlightConfig,
                    highlightBufferData,
                    sharedInstanceGeometryBuffer,
                    sharedBevelJoinGeometryBuffer,
                    instancingExt,
                    highlightColor,
                    waveformPrograms,
                    highlightSignal, // Use the highlight signal instead of the original
                    proxyRow,
                    zIndex + 1
                );
                
                this.highlightRenderObjects.set(signal, highlightRenderObject);
            }
        }

        this.onMouseMove((event: MouseEvent) => {
            this.mouse = {
                offsetX: event.offsetX,
                clientX: event.clientX,
                clientY: event.clientY,
            }
            this.context.requestRender();
        });

        this.onMouseEnter((event: MouseEvent) => {
            this.mouse = {
                offsetX: event.offsetX,
                clientX: event.clientX,
                clientY: event.clientY,
            }
            this.context.requestRender();
        });

        this.onMouseLeave(() => {
            this.mouse = null;
            this.tooltipRenderObject.updateTooltip(null);
            this.context.requestRender();
        });
    }

    dispose(): void {
        // Clean up highlight render objects and their buffers
        for (const renderObject of this.highlightRenderObjects.values()) {
            renderObject.dispose();
        }
        this.highlightRenderObjects.clear();
        this.highlightSignals.clear();
        
        super.dispose();
    }

    private createHighlightColor(baseColor: string): string {
        const [r, g, b] = WebGLUtils.hexToRgba(baseColor);
        const brightnessBoost = 0.3;
        const tintedR = Math.min(1.0, r + brightnessBoost);
        const tintedG = Math.min(1.0, g + brightnessBoost);
        const tintedB = Math.min(1.0, b + brightnessBoost);
        
        // Convert back to hex
        const toHex = (val: number) => Math.round(val * 255).toString(16).padStart(2, '0');
        return `#${toHex(tintedR)}${toHex(tintedG)}${toHex(tintedB)}`;
    }

    render(context: RenderContext, bounds: RenderBounds): boolean {
        if (!this.config.hoverEnabled || !this.isMouseOver || this.mouse === null) {
            if (!this.config.hoverEnabled)
            {
                this.tooltipRenderObject.updateTooltip(null);
            }
            return false;
        }

        const { state } = context;

        // Calculate time at mouse position using the same coordinate system as WaveformRenderObject
        const mouseTimeDouble = (state.offset + this.mouse.offsetX) / state.pxPerSecond;
        
        // Aggregate tooltip data
        const signalData: Array<{
            signal: Signal;
            time: number;
            value: number;
            dataIndex: number;
            color: string;
        }> = [];

        // Find data for all signals at this time and render highlight dots
        for (const signal of this.signals) {
            const dataPoint = this.getSignalValueAtTime(signal, mouseTimeDouble);
            if (dataPoint !== null && signal.valueTable.get(dataPoint.value) !== "null") {
                const color = this.context.signalMetadata.getColor(signal);
                signalData.push({
                    signal: signal,
                    time: dataPoint.time,
                    value: dataPoint.value,
                    dataIndex: dataPoint.index,
                    color: color
                });
                
                // Render highlight for this signal using the existing WaveformRenderObject
                this.renderHighlightedSignal(context, bounds, signal, dataPoint.index);
            }
        }

        // Update tooltip with aggregated data or hide if no valid data
        if (signalData.length > 0) {
            this.tooltipRenderObject.updateTooltip({
                visible: true,
                x: this.mouse.clientX,
                y: this.mouse.clientY,
                signals: signalData,
                yScale: this.row.yScale
            });
        } else {
            this.tooltipRenderObject.updateTooltip(null);
        }

        return false;
    }

    private renderHighlightedSignal(
        context: RenderContext,
        bounds: RenderBounds,
        signal: Signal,
        dataIndex: number
    ): void {
        const highlightRenderObject = this.highlightRenderObjects.get(signal);
        const highlightSignal = this.highlightSignals.get(signal);
        if (!highlightRenderObject || !highlightSignal) return;

        const bufferData = this.signalBuffers.get(signal);
        if (!bufferData) return;

        // Update the highlight signal with the specific data point(s) we want to highlight
        this.updateHighlightSignal(signal, dataIndex, bufferData, highlightSignal, context);

        // Render using the existing WaveformRenderObject logic
        highlightRenderObject.render(context, bounds);
    }

    private updateHighlightSignal(
        signal: Signal,
        dataIndex: number,
        originalBufferData: ChannelBufferData,
        highlightSignal: HighlightSignal,
        context: RenderContext
    ): void {
        const { gl } = context.render;
        
        if (dataIndex >= originalBufferData.updateIndex) return;

        let pointData: ChannelPoint[];

        if (this.row.renderMode === RenderMode.Enum) {
            // For enum, render the segment (paired points)
            if (dataIndex >= originalBufferData.updateIndex - 1) return;
            
            const [time1, value1] = signal.data(dataIndex);
            const [time2, value2] = signal.data(dataIndex + 1);
            pointData = [[time1, value1], [time2, value2]];
        } else {
            // For all other modes (Lines, Dots, LinesDots), just show the single point as a dot
            const [time, value] = signal.data(dataIndex);
            pointData = [[time, value]];
        }

        // Update the highlight signal's data
        (highlightSignal as any)._data = pointData;

        // Get the highlight render object's buffer and update it
        const highlightRenderObject = this.highlightRenderObjects.get(signal);
        if (highlightRenderObject) {
            const bufferData = (highlightRenderObject as any).bufferData;
            if (bufferData) {
                // Convert points to flat array for WebGL buffer
                const flatData = new Float32Array(pointData.length * 2);
                for (let i = 0; i < pointData.length; i++) {
                    flatData[i * 2] = pointData[i][0];     // time
                    flatData[i * 2 + 1] = pointData[i][1]; // value
                }

                gl.bindBuffer(gl.ARRAY_BUFFER, bufferData.buffer);
                gl.bufferData(gl.ARRAY_BUFFER, flatData, gl.DYNAMIC_DRAW);
                
                // Update buffer metadata
                bufferData.updateIndex = pointData.length;
                bufferData.lastDataLength = flatData.length;
                bufferData.pointCount = pointData.length;
            }
        }
    }

    private getSignalValueAtTime(signal: Signal, time: number): { time: number; value: number; index: number } | null {
        const bufferData = this.signalBuffers.get(signal);
        if (!bufferData || bufferData.updateIndex === 0) return null;

        // Use binary search to find the closest data point
        let left = 0;
        let right = bufferData.updateIndex - 1;
        
        while (left < right) {
            const mid = Math.floor((left + right) / 2);
            const [midTime] = signal.data(mid);
            
            if (midTime < time) {
                left = mid + 1;
            } else {
                right = mid;
            }
        }
        
        let closestIndex = left;
        
        if (this.row.renderMode === RenderMode.Enum) {
            // For enum signals, always look leftwards (backwards in time)
            // Find the last data point that is <= the mouse time
            if (left < bufferData.updateIndex) {
                if (signal.data(left)[0] > time && left > 0) {
                    // If the found point is after the mouse time, go back one
                    closestIndex = left - 1;
                }
            } else {
                // If we're past the end, use the last point
                closestIndex = bufferData.updateIndex - 1;
            }
        } else {
            // For non-enum signals, use the closest-point
            if (left > 0) {
                const distToLeft = Math.abs(signal.data(left)[0] - time);
                const distToPrev = Math.abs(signal.data(left - 1)[0] - time);
                
                if (distToPrev < distToLeft) {
                    closestIndex = left - 1;
                }
            }
            
            if (left >= bufferData.updateIndex) {
                closestIndex = bufferData.updateIndex - 1;
            }
        }

        const [dataTime, value] = signal.data(closestIndex);
        return { time: dataTime, value, index: closestIndex };
    }
}
