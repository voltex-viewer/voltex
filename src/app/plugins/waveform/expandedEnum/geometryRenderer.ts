import { hexToRgba, type RenderContext, type RenderBounds, type Signal, type SignalMetadata } from '@voltex-viewer/plugin-api';
import type { WaveformShaders } from '../waveformShaders';
import type { ExpandedSegment } from './layout';
import {
    type ExpandedEnumResources,
    type ExpandedEnumVAO,
    type ExpandedInstanceBuffers,
    createInstanceBuffers,
    ensureInstanceBufferCapacity,
    disposeInstanceBuffers,
} from './resources';
import { topHeightRatio, trapezoidHeightRatio, borderWidth } from './animation';

export class ExpandedEnumGeometryRenderer {
    private vao: ExpandedEnumVAO | null = null;
    private instanceBuffers: ExpandedInstanceBuffers | null = null;

    constructor(
        private gl: WebGL2RenderingContext,
        private shaders: WaveformShaders,
        private resources: ExpandedEnumResources
    ) {}

    render(
        context: RenderContext,
        bounds: RenderBounds,
        segments: ExpandedSegment[],
        signal: Signal,
        metadata: SignalMetadata,
        progress: number
    ): void {
        if (segments.length === 0) return;

        const { gl, shaders, resources } = this;
        const { state } = context;

        if (!this.instanceBuffers) {
            this.instanceBuffers = createInstanceBuffers(gl, Math.max(64, segments.length));
        }
        ensureInstanceBufferCapacity(this.instanceBuffers, segments.length);

        if (!this.vao) {
            this.vao = resources.createVAO(
                shaders.expandedEnum,
                this.instanceBuffers.dataBuffer,
                this.instanceBuffers.timeBuffer
            );
        }

        this.uploadInstanceData(segments, signal, state.pxPerSecond, state.offset, progress);

        const topHeight = bounds.height * topHeightRatio;
        const trapezoidHeight = bounds.height * trapezoidHeightRatio;
        const bottomHeight = bounds.height * (1 - topHeightRatio - trapezoidHeightRatio);
        const bottomY = topHeight + trapezoidHeight;

        const color = metadata.color;
        const [r, g, b, a] = hexToRgba(color);

        const leftTimeDouble = state.offset / state.pxPerSecond;
        const timeOffsetHigh = Math.fround(leftTimeDouble);
        const timeOffsetLow = leftTimeDouble - timeOffsetHigh;

        shaders.expandedEnum.bind({
            u_bounds: [bounds.width, bounds.height],
            u_topY: 0,
            u_topHeight: topHeight,
            u_bottomY: bottomY,
            u_bottomHeight: bottomHeight,
            u_timeOffsetHigh: timeOffsetHigh,
            u_timeOffsetLow: timeOffsetLow,
            u_pxPerSecond: state.pxPerSecond,
            u_color: [r, g, b, a],
            u_nullValue: "null" in signal.values ? signal.values.null : signal.values.max + 1.0,
            u_hasNullValue: "null" in signal.values,
            u_borderWidth: borderWidth,
        }, this.vao);
        gl.drawArraysInstanced(gl.TRIANGLES, 0, 18, segments.length);
        shaders.expandedEnum.unbind();
    }

    renderHighlight(
        context: RenderContext,
        bounds: RenderBounds,
        segment: ExpandedSegment,
        signal: Signal,
        highlightColor: string,
        progress: number
    ): void {
        const { gl, shaders, resources } = this;
        const { state } = context;

        if (!this.instanceBuffers) {
            this.instanceBuffers = createInstanceBuffers(gl, 1);
        }

        if (!this.vao) {
            this.vao = resources.createVAO(
                shaders.expandedEnum,
                this.instanceBuffers.dataBuffer,
                this.instanceBuffers.timeBuffer
            );
        }

        this.uploadInstanceData([segment], signal, state.pxPerSecond, state.offset, progress);

        const topHeight = bounds.height * topHeightRatio;
        const trapezoidHeight = bounds.height * trapezoidHeightRatio;
        const bottomHeight = bounds.height * (1 - topHeightRatio - trapezoidHeightRatio);
        const bottomY = topHeight + trapezoidHeight;

        const [r, g, b, a] = hexToRgba(highlightColor);

        const leftTimeDouble = state.offset / state.pxPerSecond;
        const timeOffsetHigh = Math.fround(leftTimeDouble);
        const timeOffsetLow = leftTimeDouble - timeOffsetHigh;

        shaders.expandedEnum.bind({
            u_bounds: [bounds.width, bounds.height],
            u_topY: 0,
            u_topHeight: topHeight,
            u_bottomY: bottomY,
            u_bottomHeight: bottomHeight,
            u_timeOffsetHigh: timeOffsetHigh,
            u_timeOffsetLow: timeOffsetLow,
            u_pxPerSecond: state.pxPerSecond,
            u_color: [r, g, b, a],
            u_nullValue: "null" in signal.values ? signal.values.null : signal.values.max + 1.0,
            u_hasNullValue: "null" in signal.values,
            u_borderWidth: borderWidth,
        }, this.vao);
        gl.drawArraysInstanced(gl.TRIANGLES, 0, 18, 1);
        shaders.expandedEnum.unbind();
    }

    private uploadInstanceData(
        segments: ExpandedSegment[],
        signal: Signal,
        pxPerSecond: number,
        offset: number,
        progress: number
    ): void {
        const { gl, instanceBuffers } = this;
        if (!instanceBuffers) return;

        const { timeData, dataData, timeBuffer, dataBuffer } = instanceBuffers;

        let accumulatedX = segments[0].expandedStartX;
        for (let i = 0; i < segments.length; i++) {
            const seg = segments[i];

            const startTime = signal.time.valueAt(seg.startBufferIndex);
            const endTime = signal.time.valueAt(seg.endBufferIndex);
            const startHigh = Math.fround(startTime);
            const endHigh = Math.fround(endTime);

            const currentTopX = startTime * pxPerSecond - offset;
            let expandedX = accumulatedX;
            if (seg.isFirst && expandedX > currentTopX) {
                expandedX = currentTopX;
            }
            const bottomLeftX = currentTopX + (expandedX - currentTopX) * progress;

            accumulatedX += seg.expandedWidth;

            const currentTopEndX = endTime * pxPerSecond - offset;
            let expandedEndX = accumulatedX;
            if (seg.isLast && expandedEndX < currentTopEndX) {
                expandedEndX = currentTopEndX;
            }
            const bottomRightX = currentTopEndX + (expandedEndX - currentTopEndX) * progress;

            const timeOff = i * 5;
            timeData[timeOff + 0] = startHigh;
            timeData[timeOff + 1] = endHigh;
            timeData[timeOff + 2] = startTime - startHigh;
            timeData[timeOff + 3] = endTime - endHigh;
            timeData[timeOff + 4] = seg.value;

            const dataOff = i * 2;
            dataData[dataOff + 0] = bottomLeftX;
            dataData[dataOff + 1] = bottomRightX;
        }

        gl.bindBuffer(gl.ARRAY_BUFFER, timeBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, timeData.subarray(0, segments.length * 5), gl.DYNAMIC_DRAW);
        gl.bindBuffer(gl.ARRAY_BUFFER, dataBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, dataData.subarray(0, segments.length * 2), gl.DYNAMIC_DRAW);
    }

    dispose(): void {
        if (this.vao) {
            this.vao.delete();
            this.vao = null;
        }
        if (this.instanceBuffers) {
            disposeInstanceBuffers(this.gl, this.instanceBuffers);
            this.instanceBuffers = null;
        }
    }
}
