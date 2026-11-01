import { hexToRgba, RenderMode, Row, type RenderContext, type RenderBounds, type RenderObject, type Signal, type WaveformState, SignalMetadata, formatValueForDisplay, signalShift } from "@voltex-viewer/plugin-api";
import type { BufferData } from './waveformRendererPlugin';
import { WaveformConfig } from './waveformConfig';
import { WaveformShaders, InstancedLineAttributes, BevelJoinAttributes, DotAttributes, BlockAttributes } from './waveformShaders';
import { TypedVAO } from './typedProgram';
import {
    type ExpandedSegment,
    type ExpandedEnumResources,
    ExpandedEnumController,
    borderWidth,
} from './expandedEnum';

type LineVAO = TypedVAO<InstancedLineAttributes>;
type BevelVAO = TypedVAO<BevelJoinAttributes>;
type DotVAO = TypedVAO<DotAttributes>;
type BlockVAO = TypedVAO<BlockAttributes>;

export class WaveformRenderObject {
    private lineVAO: LineVAO | null = null;
    private bevelVAO: BevelVAO | null = null;
    private dotVAO: DotVAO | null = null;
    private blockVAO: BlockVAO | null = null;
    private cachedRenderMode: RenderMode | null = null;

    private expandedController: ExpandedEnumController | null = null;

    constructor(
        parent: RenderObject,
        private gl: WebGL2RenderingContext,
        private config: WaveformConfig,
        private bufferData: BufferData,
        private sharedInstanceGeometryBuffer: WebGLBuffer,
        private sharedBevelJoinGeometryBuffer: WebGLBuffer,
        private metadata: SignalMetadata,
        private waveformPrograms: WaveformShaders,
        private signal: Signal,
        private row: Row,
        private expandedResources: ExpandedEnumResources | null,
        zIndex: number = 0,
    ) {
        parent.addChild({
            zIndex: zIndex,
            render: (context, bounds) => clipToDisplayEnd(context, () => this.render(context, bounds)),
        });
        // Separate child for expanded text to render above highlights
        parent.addChild({
            zIndex: 100,
            render: (context, bounds) => clipToDisplayEnd(context, () => this.renderExpandedTextPass(context, bounds)),
        });
    }

    // Pixel offset with the per-signal shift folded in, so the existing
    // `time * pxPerSecond - offset` mapping draws the signal at its real-time position.
    private effectiveOffset(state: WaveformState): number {
        return state.offset - signalShift(this.signal, state) * state.pxPerSecond;
    }

    get expandedModeProgress(): number {
        return this.expandedController?.progress ?? 0;
    }

    set expandedModeProgress(value: number) {
        if (this.expandedController) {
            this.expandedController.targetProgress = value;
        }
    }

    getExpandedSegmentForTime(time: number, state: WaveformState): ExpandedSegment | null {
        if (this.metadata.renderMode !== RenderMode.ExpandedEnum || !this.expandedController) return null;
        return this.expandedController.getSegmentForTime(time, state.pxPerSecond, this.effectiveOffset(state));
    }

    /** The time under a position, in the signal's own time. */
    getTimeForPosition(screenX: number, screenY: number, boundsHeight: number, state: WaveformState): number {
        const offset = this.effectiveOffset(state);
        if (this.metadata.renderMode === RenderMode.ExpandedEnum && this.expandedController && this.expandedController.segments.length > 0) {
            return this.expandedController.getTimeForPosition(screenX, screenY, boundsHeight, state.pxPerSecond, offset);
        }
        return (offset + screenX) / state.pxPerSecond;
    }

    render(context: RenderContext, bounds: RenderBounds): boolean {
        const { render, state } = context;
        const { gl } = render;

        const renderMode = this.metadata.renderMode;

        // Invalidate VAOs if render mode or buffers changed
        if (this.lineVAO && (this.cachedRenderMode !== renderMode ||
            this.lineVAO.attributes.pointATimeHigh.buffer !== this.bufferData.timeHighBuffer ||
            this.lineVAO.attributes.pointATimeLow.buffer !== this.bufferData.timeLowBuffer ||
            this.lineVAO.attributes.pointAValue.buffer !== this.bufferData.valueBuffer)) {

            this.lineVAO.delete();
            this.lineVAO = null;
            if (this.bevelVAO) {
                this.bevelVAO.delete();
                this.bevelVAO = null;
            }
        }
        if (this.dotVAO && (this.cachedRenderMode !== renderMode ||
            this.dotVAO.attributes.timePosHigh.buffer !== this.bufferData.timeHighBuffer ||
            this.dotVAO.attributes.timePosLow.buffer !== this.bufferData.timeLowBuffer ||
            this.dotVAO.attributes.valuePos.buffer !== this.bufferData.valueBuffer)) {

            this.dotVAO.delete();
            this.dotVAO = null;
        }
        
        // Clear expanded state when not in expanded mode
        if (renderMode !== RenderMode.ExpandedEnum && this.expandedController) {
            this.expandedController.reset();
        }
        
        this.cachedRenderMode = renderMode;

        const color = this.metadata.color;
        const [r, g, b, a] = hexToRgba(color);

        const leftTimeDouble = this.effectiveOffset(state) / state.pxPerSecond;
        const timeOffsetHigh = Math.fround(leftTimeDouble);
        const timeOffsetLow = leftTimeDouble - timeOffsetHigh;

        if (renderMode === RenderMode.Lines || renderMode === RenderMode.Discrete) {
            const prog = this.waveformPrograms.instancedLine;
            if (!this.lineVAO) {
                this.lineVAO = prog.createVAO({
                    position: { buffer: this.sharedInstanceGeometryBuffer, size: 2 },
                    pointATimeHigh: { buffer: this.bufferData.timeHighBuffer, size: 1, stride: 4, offset: 0, divisor: 1 },
                    pointBTimeHigh: { buffer: this.bufferData.timeHighBuffer, size: 1, stride: 4, offset: 4, divisor: 1 },
                    pointATimeLow: { buffer: this.bufferData.timeLowBuffer, size: 1, stride: 4, offset: 0, divisor: 1 },
                    pointBTimeLow: { buffer: this.bufferData.timeLowBuffer, size: 1, stride: 4, offset: 4, divisor: 1 },
                    pointAValue: { buffer: this.bufferData.valueBuffer, size: 1, stride: 4, offset: 0, divisor: 1 },
                    pointBValue: { buffer: this.bufferData.valueBuffer, size: 1, stride: 4, offset: 4, divisor: 1 },
                });
            }
            prog.bind({
                u_bounds: [bounds.width, bounds.height],
                u_width: this.config.lineWidth,
                u_timeOffsetHigh: timeOffsetHigh,
                u_timeOffsetLow: timeOffsetLow,
                u_pxPerSecond: state.pxPerSecond,
                u_yScale: this.row.yScale,
                u_yOffset: this.row.yOffset,
                u_color: [r, g, b, a],
                u_discrete: renderMode === RenderMode.Discrete,
                u_nullValue: this.signal.null ?? 0,
                u_hasNullValue: this.signal.null !== undefined,
            }, this.lineVAO);
            const instanceCount = this.bufferData.bufferLength - 1;
            if (instanceCount > 0) {
                gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, instanceCount);
            }
            prog.unbind();

            if (renderMode === RenderMode.Lines) {
                const bevelProg = this.waveformPrograms.bevelJoin;
                if (!this.bevelVAO) {
                    this.bevelVAO = bevelProg.createVAO({
                        position: { buffer: this.sharedBevelJoinGeometryBuffer, size: 2 },
                        pointATimeHigh: { buffer: this.bufferData.timeHighBuffer, size: 1, stride: 4, offset: 0, divisor: 1 },
                        pointBTimeHigh: { buffer: this.bufferData.timeHighBuffer, size: 1, stride: 4, offset: 4, divisor: 1 },
                        pointCTimeHigh: { buffer: this.bufferData.timeHighBuffer, size: 1, stride: 4, offset: 8, divisor: 1 },
                        pointATimeLow: { buffer: this.bufferData.timeLowBuffer, size: 1, stride: 4, offset: 0, divisor: 1 },
                        pointBTimeLow: { buffer: this.bufferData.timeLowBuffer, size: 1, stride: 4, offset: 4, divisor: 1 },
                        pointCTimeLow: { buffer: this.bufferData.timeLowBuffer, size: 1, stride: 4, offset: 8, divisor: 1 },
                        pointAValue: { buffer: this.bufferData.valueBuffer, size: 1, stride: 4, offset: 0, divisor: 1 },
                        pointBValue: { buffer: this.bufferData.valueBuffer, size: 1, stride: 4, offset: 4, divisor: 1 },
                        pointCValue: { buffer: this.bufferData.valueBuffer, size: 1, stride: 4, offset: 8, divisor: 1 },
                    });
                }
                bevelProg.bind({
                    u_bounds: [bounds.width, bounds.height],
                    u_width: this.config.lineWidth,
                    u_timeOffsetHigh: timeOffsetHigh,
                    u_timeOffsetLow: timeOffsetLow,
                    u_pxPerSecond: state.pxPerSecond,
                    u_yScale: this.row.yScale,
                    u_yOffset: this.row.yOffset,
                    u_color: [r, g, b, a],
                    u_discrete: false,
                    u_nullValue: this.signal.null ?? 0,
                    u_hasNullValue: this.signal.null !== undefined,
                }, this.bevelVAO);
                const bevelInstanceCount = this.bufferData.bufferLength - 2;
                if (bevelInstanceCount > 0) {
                    gl.drawArraysInstanced(gl.TRIANGLES, 0, 3, bevelInstanceCount);
                }
                bevelProg.unbind();
            }

            const blocks = this.bufferData.blocks;
            if (blocks && blocks.count > 0) {
                const blockProg = this.waveformPrograms.block;
                if (!this.blockVAO) {
                    this.blockVAO = blockProg.createVAO({
                        position: { buffer: this.sharedInstanceGeometryBuffer, size: 2 },
                        startTimeHigh: { buffer: blocks.buffer, size: 1, stride: 24, offset: 0, divisor: 1 },
                        startTimeLow: { buffer: blocks.buffer, size: 1, stride: 24, offset: 4, divisor: 1 },
                        endTimeHigh: { buffer: blocks.buffer, size: 1, stride: 24, offset: 8, divisor: 1 },
                        endTimeLow: { buffer: blocks.buffer, size: 1, stride: 24, offset: 12, divisor: 1 },
                        minValue: { buffer: blocks.buffer, size: 1, stride: 24, offset: 16, divisor: 1 },
                        maxValue: { buffer: blocks.buffer, size: 1, stride: 24, offset: 20, divisor: 1 },
                    });
                }
                blockProg.bind({
                    u_bounds: [bounds.width, bounds.height],
                    u_width: this.config.lineWidth,
                    u_timeOffsetHigh: timeOffsetHigh,
                    u_timeOffsetLow: timeOffsetLow,
                    u_pxPerSecond: state.pxPerSecond,
                    u_yScale: this.row.yScale,
                    u_yOffset: this.row.yOffset,
                    u_color: [r, g, b, a],
                }, this.blockVAO);
                gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, blocks.count);
                blockProg.unbind();
            }
        } else if (renderMode === RenderMode.Dots) {
            const prog = this.waveformPrograms.dot;
            if (!this.dotVAO) {
                this.dotVAO = prog.createVAO({
                    timePosHigh: { buffer: this.bufferData.timeHighBuffer, size: 1 },
                    timePosLow: { buffer: this.bufferData.timeLowBuffer, size: 1 },
                    valuePos: { buffer: this.bufferData.valueBuffer, size: 1 },
                });
            }
            prog.bind({
                u_bounds: [bounds.width, bounds.height],
                u_width: this.config.dotSize * context.dpr,
                u_timeOffsetHigh: timeOffsetHigh,
                u_timeOffsetLow: timeOffsetLow,
                u_pxPerSecond: state.pxPerSecond,
                u_yScale: this.row.yScale,
                u_yOffset: this.row.yOffset,
                u_color: [r, g, b, a],
                u_nullValue: this.signal.null ?? 0,
                u_hasNullValue: this.signal.null !== undefined,
            }, this.dotVAO);
            gl.drawArrays(gl.POINTS, 0, this.bufferData.bufferLength);
            prog.unbind();
        } else if (renderMode === RenderMode.Enum) {
            const prog = this.waveformPrograms.enumLine;
            if (!this.lineVAO) {
                this.lineVAO = prog.createVAO({
                    position: { buffer: this.sharedInstanceGeometryBuffer, size: 2 },
                    pointATimeHigh: { buffer: this.bufferData.timeHighBuffer, size: 1, stride: 4, offset: 0, divisor: 1 },
                    pointBTimeHigh: { buffer: this.bufferData.timeHighBuffer, size: 1, stride: 4, offset: 4, divisor: 1 },
                    pointATimeLow: { buffer: this.bufferData.timeLowBuffer, size: 1, stride: 4, offset: 0, divisor: 1 },
                    pointBTimeLow: { buffer: this.bufferData.timeLowBuffer, size: 1, stride: 4, offset: 4, divisor: 1 },
                    pointAValue: { buffer: this.bufferData.valueBuffer, size: 1, stride: 4, offset: 0, divisor: 1 },
                    pointBValue: { buffer: this.bufferData.valueBuffer, size: 1, stride: 4, offset: 4, divisor: 1 },
                });
            }
            prog.bind({
                u_bounds: [bounds.width, bounds.height],
                u_timeOffsetHigh: timeOffsetHigh,
                u_timeOffsetLow: timeOffsetLow,
                u_pxPerSecond: state.pxPerSecond,
                u_color: [r, g, b, a],
                u_nullValue: this.signal.null ?? 0,
                u_hasNullValue: this.signal.null !== undefined,
                u_borderWidth: borderWidth,
            }, this.lineVAO);
            const instanceCount = this.bufferData.bufferLength - 1;
            if (instanceCount > 0) {
                gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, instanceCount);
            }
            prog.unbind();
        } else if (renderMode === RenderMode.ExpandedEnum) {
            return this.renderExpandedEnum(context, bounds);
        }
        return false;
    }

    private renderEnumText(
        context: RenderContext,
        bounds: RenderBounds,
    ): void {
        const { render, state } = context;
        const { utils } = render;

        const enumOffset = this.effectiveOffset(state);
        const startTime = enumOffset / state.pxPerSecond;
        const endTime = (enumOffset + bounds.width) / state.pxPerSecond;

        const padding = 5;
        const ellipsisWidth = utils.measureText('...').renderWidth;
        const minRenderableWidth = padding * 2 + ellipsisWidth;
        const baselineMetrics = utils.measureText('Ag');
        const y = (bounds.height - baselineMetrics.renderHeight) / 2;

        const enumRuns = this.bufferData.runs;
        if (!enumRuns || enumRuns.count === 0) return;

        const [visStart, visEnd] = enumRuns.visibleRange(startTime, endTime);

        // Collect renderable runs
        type RunEntry = { runIdx: number; pxWidth: number; startX: number; endX: number };
        const runs: RunEntry[] = [];
        for (let r = visStart; r <= visEnd; r++) {
            const startX = enumRuns.start(r) * state.pxPerSecond - enumOffset;
            const endX = enumRuns.end(r) * state.pxPerSecond - enumOffset;
            const pxWidth = endX - startX;
            if (pxWidth >= minRenderableWidth) {
                runs.push({ runIdx: r, pxWidth, startX, endX });
            }
        }

        runs.sort((a, b) => b.pxWidth - a.pxWidth);

        for (const run of runs) {
            const value = enumRuns.exact(run.runIdx) ?? enumRuns.value(run.runIdx);
            const enumText = formatValueForDisplay(this.signal.format ? this.signal.format(value) : value, this.metadata.display);
            if (enumText === "null") continue;

            const textX = Math.max(padding, run.startX + padding);
            const availableWidth = Math.max(0, run.endX - textX - padding);
            if (availableWidth <= 0) continue;

            drawTruncatedText(utils, enumText, textX, y, availableWidth, ellipsisWidth, bounds);
        }
    }

    private renderEnumBackground(context: RenderContext, bounds: RenderBounds): void {
        const { render, state } = context;
        const { gl } = render;

        const color = this.metadata.color;
        const [r, g, b, a] = hexToRgba(color);

        const leftTimeDouble = this.effectiveOffset(state) / state.pxPerSecond;
        const timeOffsetHigh = Math.fround(leftTimeDouble);
        const timeOffsetLow = leftTimeDouble - timeOffsetHigh;

        const prog = this.waveformPrograms.enumLine;
        if (!this.lineVAO) {
            this.lineVAO = prog.createVAO({
                position: { buffer: this.sharedInstanceGeometryBuffer, size: 2 },
                pointATimeHigh: { buffer: this.bufferData.timeHighBuffer, size: 1, stride: 4, offset: 0, divisor: 1 },
                pointBTimeHigh: { buffer: this.bufferData.timeHighBuffer, size: 1, stride: 4, offset: 4, divisor: 1 },
                pointATimeLow: { buffer: this.bufferData.timeLowBuffer, size: 1, stride: 4, offset: 0, divisor: 1 },
                pointBTimeLow: { buffer: this.bufferData.timeLowBuffer, size: 1, stride: 4, offset: 4, divisor: 1 },
                pointAValue: { buffer: this.bufferData.valueBuffer, size: 1, stride: 4, offset: 0, divisor: 1 },
                pointBValue: { buffer: this.bufferData.valueBuffer, size: 1, stride: 4, offset: 4, divisor: 1 },
            });
        }
        prog.bind({
            u_bounds: [bounds.width, bounds.height],
            u_timeOffsetHigh: timeOffsetHigh,
            u_timeOffsetLow: timeOffsetLow,
            u_pxPerSecond: state.pxPerSecond,
            u_color: [r, g, b, a],
            u_nullValue: this.signal.null ?? 0,
            u_hasNullValue: this.signal.null !== undefined,
            u_borderWidth: borderWidth,
        }, this.lineVAO);
        const instanceCount = this.bufferData.bufferLength - 1;
        if (instanceCount > 0) {
            gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, instanceCount);
        }
        prog.unbind();
    }

    private renderExpandedEnum(context: RenderContext, bounds: RenderBounds): boolean {
        // First render normal enum as background (fast, covers entire signal)
        this.renderEnumBackground(context, bounds);

        // Create controller lazily when needed
        if (!this.expandedController && this.expandedResources && this.bufferData.runs) {
            this.expandedController = new ExpandedEnumController(
                this.gl,
                this.signal,
                this.bufferData.runs,
                this.config,
                this.waveformPrograms,
                this.expandedResources
            );
        }

        if (!this.expandedController) return false;

        const { needsRedraw } = this.expandedController.update(context, bounds);
        this.expandedController.renderGeometry(context, bounds, this.metadata);

        return needsRedraw;
    }

    private renderExpandedTextPass(context: RenderContext, bounds: RenderBounds): boolean {
        if (this.metadata.renderMode === RenderMode.Enum) {
            this.renderEnumText(context, bounds);
        } else if (this.metadata.renderMode === RenderMode.ExpandedEnum && this.expandedController) {
            this.expandedController.renderText(context, bounds, this.metadata);
        }
        return false;
    }
}

function clipToDisplayEnd(context: RenderContext, draw: () => boolean): boolean {
    const { state, viewport, dpr } = context;
    const { gl } = context.render;
    const endX = (state.displayEndTime * state.pxPerSecond - state.offset) * dpr;
    if (endX >= viewport[2]) return draw();
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(viewport[0], viewport[1], Math.max(0, Math.ceil(endX)), viewport[3]);
    const result = draw();
    gl.disable(gl.SCISSOR_TEST);
    return result;
}

export function drawTruncatedText(
    utils: RenderContext['render']['utils'],
    enumText: string,
    textX: number,
    y: number,
    availableWidth: number,
    ellipsisWidth: number,
    bounds: RenderBounds,
): void {
    const textMetrics = utils.measureText(enumText);
    const textWidth = textMetrics.renderWidth;

    let displayText = enumText;
    if (textWidth > availableWidth) {
        const availableForText = availableWidth - ellipsisWidth;
        if (availableForText <= 0) return;

        const avgCharWidth = textWidth / enumText.length;
        const estimatedLength = Math.floor(availableForText / avgCharWidth);

        let left = Math.max(1, estimatedLength - 5);
        let right = Math.min(enumText.length - 1, estimatedLength + 5);
        let bestLength = 0;

        while (left <= right) {
            const mid = Math.floor((left + right) / 2);
            const truncatedWidth = utils.measureText(enumText.substring(0, mid)).renderWidth;
            if (truncatedWidth <= availableForText) {
                bestLength = mid;
                left = mid + 1;
            } else {
                right = mid - 1;
            }
        }

        if (bestLength === 0) return;
        displayText = enumText.substring(0, bestLength) + '...';
    }

    utils.drawText(
        displayText,
        textX,
        y,
        { width: bounds.width, height: bounds.height },
        {
            fillStyle: '#ffffff',
            strokeStyle: '#000000',
            strokeWidth: 2
        }
    );
}
