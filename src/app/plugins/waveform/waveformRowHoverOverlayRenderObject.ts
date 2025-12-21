import { hexToRgba, RenderMode, type RenderContext, type Sequence, type Signal, type PluginContext, type RenderObject, type Row, type RenderBounds, type MouseEvent as PluginMouseEvent, SignalMetadata, formatValueForDisplay } from '@voltex-viewer/plugin-api';
import { type WaveformConfig } from './waveformConfig';
import type { SignalTooltipData, TooltipData } from './waveformTooltipRenderObject';
import type { BufferData } from './waveformRendererPlugin';
import type { WaveformShaders } from './waveformShaders';
import { WaveformRenderObject } from './waveformRenderObject';

class HighlightSignal implements Signal {
    constructor(
        public readonly source: Signal['source'],
        public readonly time: ArraySequence,
        public readonly values: ArraySequence,
        public readonly renderHint: RenderMode,
    ) {
    }

    updateData(time: number[], values: number[], converted?: (number | bigint | string)[]): void {
        this.time.updateData(time);
        this.values.updateData(values, converted);
    }
}

export class WaveformRowHoverOverlayRenderObject {
    private mouse: { offsetX: number; clientX: number; clientY: number } | null = null;
    private readonly highlightSignals: Map<Signal, HighlightSignal> = new Map();
    private readonly highlightBuffers: Map<Signal, BufferData> = new Map();
    private _tooltipData: TooltipData | null = null;

    constructor(
        parent: RenderObject,
        private readonly context: PluginContext,
        config: WaveformConfig,
        private readonly row: Row,
        private readonly signals: Signal[],
        private readonly signalBuffers: Map<Signal, BufferData>,
        sharedInstanceGeometryBuffer: WebGLBuffer,
        sharedBevelJoinGeometryBuffer: WebGLBuffer,
        waveformPrograms: WaveformShaders,
        zIndex: number = 90
    ) {
        parent.addChild({
            zIndex: zIndex,
            render: this.render.bind(this),
            onMouseMove: ((event: PluginMouseEvent) => {
                this.mouse = {
                    offsetX: event.offsetX,
                    clientX: event.clientX,
                    clientY: event.clientY,
                }
                this.context.requestRender();
            }),
            onMouseEnter: ((event: PluginMouseEvent) => {
                this.mouse = {
                    offsetX: event.offsetX,
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

                const highlightSignal = new HighlightSignal(
                    signal.source,
                    new ArraySequence(),
                    new ArraySequence(),
                    RenderMode.Dots // This is ignored as the render metadata proxy provides the correct mode
                );
                this.highlightSignals.set(signal, highlightSignal);

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
                    downsamplingMode: 'off',
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
                    highlightConfig,
                    bufferData,
                    sharedInstanceGeometryBuffer,
                    sharedBevelJoinGeometryBuffer,
                    highlightMetadata,
                    waveformPrograms,
                    highlightSignal, // Use the highlight signal instead of the original
                    row,
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
        
        this.highlightSignals.clear();
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

    render(context: RenderContext, _bounds: RenderBounds): boolean {
        if (this.mouse === null) {
            this._tooltipData = null;
            for (const buffer of this.highlightBuffers.values()) {
                buffer.bufferLength = 0;
            }
            for (const signal of this.highlightSignals.values()) {
                signal.updateData([], []);
            }
            return false;
        }

        const { state } = context;

        // Calculate time at mouse position using the same coordinate system as WaveformRenderObject
        const mouseTimeDouble = (state.offset + this.mouse.offsetX) / state.pxPerSecond;
        
        // Aggregate tooltip data
        const signalData: Array<SignalTooltipData> = [];

        // Find data for all signals at this time and render highlight dots
        for (const signal of this.signals) {
            const signalMetadata = this.context.signalMetadata.get(signal);
            const dataPoint = this.getSignalValueAtTime(signal, mouseTimeDouble, signalMetadata);
            if (dataPoint !== null && dataPoint.display !== "null") {
                signalData.push({
                    ...dataPoint,
                    signal: signal,
                    color: signalMetadata.color,
                });
                
                this.updateHighlightSignal(signal, dataPoint.dataIndex, context, signalMetadata.renderMode);
            }
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

    private updateHighlightSignal(
        signal: Signal,
        dataIndex: number,
        context: RenderContext,
        renderMode: RenderMode
    ): void {
        const highlightSignal = this.highlightSignals.get(signal);
        const { gl } = context.render;
        
        const signalLength = Math.min(signal.time.length, signal.values.length);
        if (dataIndex >= signalLength) return;

        const indices = [];
        if (renderMode === RenderMode.Enum) {
            if (dataIndex >= signalLength - 1) return;
            
            indices.push(dataIndex, dataIndex + 1);
        } else {
            indices.push(dataIndex);
        }

        const timeSourceData = indices.map(i => signal.time.valueAt(i));
        const valueSourceData = indices.map(i => signal.values.valueAt(i));
        const convertedSourceData = signal.values.convertedValueAt ? indices.map(i => signal.values.convertedValueAt!(i)) : undefined;
        // Update the highlight signal's data
        if (!highlightSignal) return;
        highlightSignal.updateData(timeSourceData, valueSourceData, convertedSourceData);

        // Get the highlight buffer data directly from our stored references
        const highlightBufferData = this.highlightBuffers.get(signal);
        if (highlightBufferData) {
            // Convert points to separate time high/low and value arrays for WebGL buffers
            const timeHighData = new Float32Array(timeSourceData.length);
            const timeLowData = new Float32Array(timeSourceData.length);
            const valueData = new Float32Array(valueSourceData);
            
            for (let i = 0; i < timeSourceData.length; i++) {
                const time = timeSourceData[i];
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
            highlightBufferData.bufferLength = indices.length;
            highlightBufferData.bufferCapacity = indices.length;
        }
    }

    private getSignalValueAtTime(signal: Signal, time: number, signalMetadata: SignalMetadata): { time: number; value: number; display: string; dataIndex: number } | null {
        const signalLength = Math.min(signal.time.length, signal.values.length);
        if (signalLength === 0) return null;

        // Use binary search to find the closest data point
        let left = 0;
        let right = signalLength - 1;
        
        while (left < right) {
            const mid = Math.floor((left + right) / 2);
            const midTime = signal.time.valueAt(mid);
            
            if (midTime < time) {
                left = mid + 1;
            } else {
                right = mid;
            }
        }
        
        let closestIndex = left;
        
        if (signalMetadata.renderMode === RenderMode.Enum) {
            // For enum signals, always look leftwards (backwards in time)
            // Find the last data point that is <= the mouse time
            if (left < signalLength) {
                if (signal.time.valueAt(left) > time && left > 0) {
                    // If the found point is after the mouse time, go back one
                    closestIndex = left - 1;
                }
            } else {
                // If we're past the end, use the last point
                closestIndex = signalLength - 1;
            }
        } else {
            // For non-enum signals, use the closest-point
            if (left > 0) {
                const distToLeft = Math.abs(signal.time.valueAt(left) - time);
                const distToPrev = Math.abs(signal.time.valueAt(left - 1) - time);
                
                if (distToPrev < distToLeft) {
                    closestIndex = left - 1;
                }
            }
            
            if (left >= signalLength) {
                closestIndex = signalLength - 1;
            }
        }

        const dataTime = signal.time.valueAt(closestIndex);
        const value = signal.values.valueAt(closestIndex);
        let display: number | bigint | string = value;
        if (signal.values.convertedValueAt) {
            display = signal.values.convertedValueAt(closestIndex);
        }
        return {
            time: dataTime,
            value,
            display: formatValueForDisplay(display, signalMetadata.display),
            dataIndex: closestIndex,
        };
    }
}

class ArraySequence implements Sequence {
    private data: number[];
    convertedValueAt?(index: number): number | bigint | string;

    constructor() {
        this.data = [];
    }

    get min(): number {
        if (this.data.length === 0) return 0;
        return Math.min(...this.data);
    }

    get max(): number {
        if (this.data.length === 0) return 0;
        return Math.max(...this.data);
    }

    get length(): number {
        return this.data.length;
    }

    valueAt(index: number): number {
        return this.data[index];
    }

    updateData(newData: number[], convertedData?: (number | bigint | string)[]): void {
        this.data = newData;
        if (typeof convertedData !== 'undefined') {
            this.convertedValueAt = (index: number) => convertedData[index];
        } else {
            delete this.convertedValueAt;
        }
    }
}
