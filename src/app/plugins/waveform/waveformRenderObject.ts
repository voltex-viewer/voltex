import { hexToRgba, RenderMode, Row, type RenderContext, type RenderBounds, type RenderObject, type Signal, SignalMetadata, formatValueForDisplay } from "@voltex-viewer/plugin-api";
import type { BufferData } from './waveformRendererPlugin';
import { WaveformConfig } from './waveformConfig';
import { WaveformShaders, InstancedLineAttributes, BevelJoinAttributes, DotAttributes } from './waveformShaders';
import { TypedVAO } from './typedProgram';
import {
    type ExpandedSegment,
    type ExpandedEnumResources,
    ExpandedEnumController,
    binarySearchTimeIndex,
    borderWidth,
} from './expandedEnum';

type LineVAO = TypedVAO<InstancedLineAttributes>;
type BevelVAO = TypedVAO<BevelJoinAttributes>;
type DotVAO = TypedVAO<DotAttributes>;

export class WaveformRenderObject {
    private lineVAO: LineVAO | null = null;
    private bevelVAO: BevelVAO | null = null;
    private dotVAO: DotVAO | null = null;
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
        zIndex: number = 0
    ) {
        parent.addChild({
            zIndex: zIndex,
            render: this.render.bind(this),
        });
        // Separate child for expanded text to render above highlights
        parent.addChild({
            zIndex: 100,
            render: this.renderExpandedTextPass.bind(this),
        });
    }

    get expandedModeProgress(): number {
        return this.expandedController?.progress ?? 0;
    }

    set expandedModeProgress(value: number) {
        if (this.expandedController) {
            this.expandedController.targetProgress = value;
        }
    }

    getExpandedSegmentForTime(time: number, pxPerSecond: number, offset: number): ExpandedSegment | null {
        if (this.metadata.renderMode !== RenderMode.ExpandedEnum || !this.expandedController) return null;
        return this.expandedController.getSegmentForTime(time, pxPerSecond, offset);
    }

    getIndexForPosition(screenX: number, screenY: number, boundsHeight: number, pxPerSecond: number, offset: number): number {
        const renderMode = this.metadata.renderMode;
        const signalLength = Math.min(this.signal.time.length, this.signal.values.length);
        if (signalLength === 0) return 0;

        if (renderMode === RenderMode.ExpandedEnum && this.expandedController && this.expandedController.segments.length > 0) {
            return this.expandedController.getIndexForPosition(screenX, screenY, boundsHeight, pxPerSecond, offset);
        }

        // For all other modes, convert screenX to time and find index
        const time = (offset + screenX) / pxPerSecond;

        // Binary search to find the closest data point
        let left = 0;
        let right = signalLength - 1;
        while (left < right) {
            const mid = Math.floor((left + right) / 2);
            if (this.signal.time.valueAt(mid) < time) {
                left = mid + 1;
            } else {
                right = mid;
            }
        }

        if (renderMode === RenderMode.Enum) {
            // For enum signals, find the last data point <= mouse time
            if (left < signalLength && this.signal.time.valueAt(left) > time && left > 0) {
                return left - 1;
            }
            return left < signalLength ? left : signalLength - 1;
        }

        // For non-enum signals, use closest point
        if (left > 0) {
            const distToLeft = Math.abs(this.signal.time.valueAt(left) - time);
            const distToPrev = Math.abs(this.signal.time.valueAt(left - 1) - time);
            if (distToPrev < distToLeft) {
                return left - 1;
            }
        }
        return left < signalLength ? left : signalLength - 1;
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

        const leftTimeDouble = state.offset / state.pxPerSecond;
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
                u_nullValue: "null" in this.signal.values ? this.signal.values.null : this.signal.values.max + 1.0,
                u_hasNullValue: "null" in this.signal.values,
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
                    u_nullValue: "null" in this.signal.values ? this.signal.values.null : this.signal.values.max + 1.0,
                    u_hasNullValue: "null" in this.signal.values,
                }, this.bevelVAO);
                const bevelInstanceCount = this.bufferData.bufferLength - 2;
                if (bevelInstanceCount > 0) {
                    gl.drawArraysInstanced(gl.TRIANGLES, 0, 3, bevelInstanceCount);
                }
                bevelProg.unbind();
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
                u_nullValue: "null" in this.signal.values ? this.signal.values.null : this.signal.values.max + 1.0,
                u_hasNullValue: "null" in this.signal.values,
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
                u_nullValue: "null" in this.signal.values ? this.signal.values.null : this.signal.values.max + 1.0,
                u_hasNullValue: "null" in this.signal.values,
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

        // Calculate visible time range
        const startTime = state.offset / state.pxPerSecond;
        const endTime = (state.offset + bounds.width) / state.pxPerSecond;

        const padding = 5; // Padding around text

        // Pre-calculate expensive measurements
        const ellipsisWidth = utils.measureText('...').renderWidth;
        const baselineMetrics = utils.measureText('Ag'); // Use consistent reference text for baseline
        const y = (bounds.height - baselineMetrics.renderHeight) / 2;

        // Binary search to find the indices of visible segments
        const maxUpdateIndex = Math.min(this.signal.time.length, this.signal.values.length);
        const startIndex = binarySearchTimeIndex(this.signal, startTime, 0, maxUpdateIndex - 1, true);
        const endIndex = binarySearchTimeIndex(this.signal, endTime, startIndex, maxUpdateIndex - 1, false);

        // Render text for segments in the visible range
        for (let i = startIndex; i <= endIndex && i < maxUpdateIndex - 1; i++) {
            const segmentStartTime = this.signal.time.valueAt(i);
            const value = this.signal.values.valueAt(i);

            // Get the end time of this segment, extending it to include consecutive segments with the same value
            let segmentEndTime = this.signal.time.valueAt(i + 1);
            let j = i + 1;
            while (j < maxUpdateIndex - 1 && this.signal.values.valueAt(j) === value) {
                segmentEndTime = this.signal.time.valueAt(j + 1);
                j++;
            }
            // Skip ahead to avoid rendering duplicate labels for the same value
            i = j - 1;

            const enumText = formatValueForDisplay("convertedValueAt" in this.signal.values ? this.signal.values.convertedValueAt(i) : value, this.metadata.display);

            if (enumText == "null") continue;

            // Calculate segment boundaries in pixel space
            const segmentStartX = segmentStartTime * state.pxPerSecond - state.offset;
            const segmentEndX = segmentEndTime * state.pxPerSecond - state.offset;

            // Determine text position - snap to left edge if segment starts off-screen
            const textX = Math.max(padding, segmentStartX + padding);

            // Calculate available width from text position to segment end
            const availableWidth = Math.max(0, segmentEndX - textX - padding);

            if (availableWidth > 0) {
                // Measure the actual text width
                const textMetrics = utils.measureText(enumText);
                const textWidth = textMetrics.renderWidth;

                // Handle text truncation if it doesn't fit
                let displayText = enumText;
                if (textWidth > availableWidth) {
                    // Try to fit text with ellipsis
                    const availableForText = availableWidth - ellipsisWidth;

                    if (availableForText <= 0) {
                        // Not enough space even for ellipsis
                        continue;
                    }

                    // Use character-based estimate to reduce binary search iterations
                    const avgCharWidth = textWidth / enumText.length;
                    const estimatedLength = Math.floor(availableForText / avgCharWidth);

                    // Binary search to find the longest text that fits
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

                    if (bestLength === 0) {
                        // Can't fit any meaningful text
                        continue;
                    }

                    displayText = enumText.substring(0, bestLength) + '...';
                }

                // Render text at center of viewport height using consistent baseline positioning
                // Render text with white fill and black stroke for better visibility
                utils.drawText(
                    displayText,
                    textX, // Use calculated text position (snapped to left edge if needed)
                    y,
                    { width: bounds.width, height: bounds.height },
                    {
                        fillStyle: '#ffffff',
                        strokeStyle: '#000000',
                        strokeWidth: 2
                    }
                );
            }
        }
    }

    private renderEnumBackground(context: RenderContext, bounds: RenderBounds): void {
        const { render, state } = context;
        const { gl } = render;

        const color = this.metadata.color;
        const [r, g, b, a] = hexToRgba(color);

        const leftTimeDouble = state.offset / state.pxPerSecond;
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
            u_nullValue: "null" in this.signal.values ? this.signal.values.null : this.signal.values.max + 1.0,
            u_hasNullValue: "null" in this.signal.values,
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
        if (!this.expandedController && this.expandedResources) {
            this.expandedController = new ExpandedEnumController(
                this.gl,
                this.signal,
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
