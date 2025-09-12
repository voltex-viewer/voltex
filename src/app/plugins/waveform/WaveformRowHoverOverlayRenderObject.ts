import type { PluginContext, Row } from '../../Plugin';
import type { Signal, ChannelPoint, Sequence } from '../../Signal';
import { RenderObject, type RenderContext, type RenderBounds, type MouseEvent } from '../../RenderObject';
import { WebGLUtils } from '../../WebGLUtils';
import { type WaveformConfig } from './WaveformConfig';
import { RenderMode } from '../../Plugin';
import type { SignalTooltipData, WaveformTooltipRenderObject } from './WaveformTooltipRenderObject';
import type { SequenceBufferData } from './WaveformRendererPlugin';
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
        public readonly time: ArrayTimeSequence,
        public readonly values: ArrayValueSequence
    ) {
        this._data = data;
    }
    
    data(index: number): ChannelPoint {
        return this._data[index] || [0, 0];
    }
    
    get length(): number {
        return this._data.length;
    }

    updateData(newData: ChannelPoint[]): void {
        this._data = newData;
        this.time.updateData(newData);
        this.values.updateData(newData);
    }
}

export class WaveformRowHoverOverlayRenderObject extends RenderObject {
    private mouse: { offsetX: number; clientX: number; clientY: number } | null = null;
    private readonly signals: Signal[];
    private readonly signalBuffers: Map<Signal, { timeBuffer: SequenceBufferData, valueBuffer: SequenceBufferData }>;
    private readonly highlightRenderObjects: Map<Signal, WaveformRenderObject> = new Map();
    private readonly highlightSignals: Map<Signal, HighlightSignal> = new Map();
    private readonly highlightBuffers: Map<Signal, { timeBuffer: SequenceBufferData, valueBuffer: SequenceBufferData }> = new Map();

    constructor(
        private readonly context: PluginContext,
        private readonly config: WaveformConfig,
        private readonly row: Row,
        private readonly tooltipRenderObject: WaveformTooltipRenderObject,
        signals: Signal[],
        signalBuffers: Map<Signal, { timeBuffer: SequenceBufferData, valueBuffer: SequenceBufferData }>,
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
                const emptyData: ChannelPoint[] = [];
                const highlightSignal = new HighlightSignal(
                    signal.source,
                    emptyData, // Start with empty data
                    signal.valueTable, // Preserve the original valueTable
                    new ArrayTimeSequence(emptyData),
                    new ArrayValueSequence(emptyData)
                );
                
                this.highlightSignals.set(signal, highlightSignal);

                // Create dedicated highlight buffers for this signal
                const highlightTimeBuffer = context.webgl.gl.createBuffer();
                const highlightValueBuffer = context.webgl.gl.createBuffer();
                if (!highlightTimeBuffer || !highlightValueBuffer) {
                    throw new Error('Failed to create highlight buffers');
                }

                const highlightTimeBufferData: SequenceBufferData = {
                    buffer: highlightTimeBuffer,
                    lastDataLength: 0,
                    updateIndex: 0,
                    pointCount: 0
                };

                const highlightValueBufferData: SequenceBufferData = {
                    buffer: highlightValueBuffer,
                    lastDataLength: 0,
                    updateIndex: 0,
                    pointCount: 0
                };

                // Store the buffer references for direct access
                this.highlightBuffers.set(signal, {
                    timeBuffer: highlightTimeBufferData,
                    valueBuffer: highlightValueBufferData
                });

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
                    highlightTimeBufferData,
                    highlightValueBufferData,
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
        
        // Clean up highlight buffers
        for (const bufferData of this.highlightBuffers.values()) {
            this.context.webgl.gl.deleteBuffer(bufferData.timeBuffer.buffer);
            this.context.webgl.gl.deleteBuffer(bufferData.valueBuffer.buffer);
        }
        
        this.highlightRenderObjects.clear();
        this.highlightSignals.clear();
        this.highlightBuffers.clear();
        
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
        const signalData: Array<SignalTooltipData> = [];

        // Find data for all signals at this time and render highlight dots
        for (const signal of this.signals) {
            const dataPoint = this.getSignalValueAtTime(signal, mouseTimeDouble);
            if (dataPoint !== null && signal.valueTable.get(dataPoint.value) !== "null") {
                const color = this.context.signalMetadata.getColor(signal);
                signalData.push({
                    ...dataPoint,
                    signal: signal,
                    color: color
                });
                
                // Render highlight for this signal using the existing WaveformRenderObject
                this.renderHighlightedSignal(context, bounds, signal, dataPoint.dataIndex);
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
        originalBufferData: { timeBuffer: SequenceBufferData, valueBuffer: SequenceBufferData },
        highlightSignal: HighlightSignal,
        context: RenderContext
    ): void {
        const { gl } = context.render;
        
        const maxUpdateIndex = Math.min(originalBufferData.timeBuffer.updateIndex, originalBufferData.valueBuffer.updateIndex);
        if (dataIndex >= maxUpdateIndex) return;

        let pointData: ChannelPoint[];

        if (this.row.renderMode === RenderMode.Enum) {
            // For enum, render the segment (paired points)
            if (dataIndex >= maxUpdateIndex - 1) return;
            
            const time1 = signal.time.valueAt(dataIndex);
            const value1 = signal.values.valueAt(dataIndex);
            const time2 = signal.time.valueAt(dataIndex + 1);
            const value2 = signal.values.valueAt(dataIndex + 1);
            pointData = [[time1, value1], [time2, value2]];
        } else {
            // For all other modes (Lines, Dots, LinesDots), just show the single point as a dot
            const time = signal.time.valueAt(dataIndex);
            const value = signal.values.valueAt(dataIndex);
            pointData = [[time, value]];
        }

        // Update the highlight signal's data
        highlightSignal.updateData(pointData);

        // Get the highlight buffer data directly from our stored references
        const highlightBufferData = this.highlightBuffers.get(signal);
        if (highlightBufferData) {
            // Convert points to separate time and value arrays for WebGL buffers
            const timeData = new Float32Array(pointData.length);
            const valueData = new Float32Array(pointData.length);
            for (let i = 0; i < pointData.length; i++) {
                timeData[i] = pointData[i][0];
                valueData[i] = pointData[i][1];
            }

            gl.bindBuffer(gl.ARRAY_BUFFER, highlightBufferData.timeBuffer.buffer);
            gl.bufferData(gl.ARRAY_BUFFER, timeData, gl.DYNAMIC_DRAW);

            gl.bindBuffer(gl.ARRAY_BUFFER, highlightBufferData.valueBuffer.buffer);
            gl.bufferData(gl.ARRAY_BUFFER, valueData, gl.DYNAMIC_DRAW);
            
            // Update buffer metadata
            highlightBufferData.timeBuffer.updateIndex = pointData.length;
            highlightBufferData.timeBuffer.lastDataLength = pointData.length;
            highlightBufferData.timeBuffer.pointCount = pointData.length;
            
            highlightBufferData.valueBuffer.updateIndex = pointData.length;
            highlightBufferData.valueBuffer.lastDataLength = pointData.length;
            highlightBufferData.valueBuffer.pointCount = pointData.length;
        }
    }

    private getSignalValueAtTime(signal: Signal, time: number): { time: number; value: number; display: number | string; dataIndex: number } | null {
        const bufferData = this.signalBuffers.get(signal);
        if (!bufferData) return null;
        
        const maxUpdateIndex = Math.min(bufferData.timeBuffer.updateIndex, bufferData.valueBuffer.updateIndex);
        if (maxUpdateIndex === 0) return null;

        // Use binary search to find the closest data point
        let left = 0;
        let right = maxUpdateIndex - 1;
        
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
        
        if (this.row.renderMode === RenderMode.Enum) {
            // For enum signals, always look leftwards (backwards in time)
            // Find the last data point that is <= the mouse time
            if (left < maxUpdateIndex) {
                if (signal.time.valueAt(left) > time && left > 0) {
                    // If the found point is after the mouse time, go back one
                    closestIndex = left - 1;
                }
            } else {
                // If we're past the end, use the last point
                closestIndex = maxUpdateIndex - 1;
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
            
            if (left >= maxUpdateIndex) {
                closestIndex = maxUpdateIndex - 1;
            }
        }

        const dataTime = signal.time.valueAt(closestIndex);
        const value = signal.values.valueAt(closestIndex);
        let display: number | string = value;
        if (signal.values.convertedValueAt) {
            display = signal.values.convertedValueAt(closestIndex);
        }
        return { time: dataTime, value, display, dataIndex: closestIndex };
    }
}

class ArrayTimeSequence implements Sequence {
    constructor(private data: ChannelPoint[]) {}

    get min(): number {
        if (this.data.length === 0) return 0;
        return Math.min(...this.data.map(([t]) => t));
    }

    get max(): number {
        if (this.data.length === 0) return 0;
        return Math.max(...this.data.map(([t]) => t));
    }

    get length(): number {
        return this.data.length;
    }

    valueAt(index: number): number {
        return this.data[index]?.[0] ?? 0;
    }

    updateData(newData: ChannelPoint[]): void {
        this.data = newData;
    }
}

class ArrayValueSequence implements Sequence {
    constructor(private data: ChannelPoint[]) {}

    get min(): number {
        if (this.data.length === 0) return 0;
        return Math.min(...this.data.map(([, v]) => v));
    }

    get max(): number {
        if (this.data.length === 0) return 0;
        return Math.max(...this.data.map(([, v]) => v));
    }

    get length(): number {
        return this.data.length;
    }

    valueAt(index: number): number {
        return this.data[index]?.[1] ?? 0;
    }

    updateData(newData: ChannelPoint[]): void {
        this.data = newData;
    }
}
