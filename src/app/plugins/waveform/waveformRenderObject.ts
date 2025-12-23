import { hexToRgba, RenderMode, Row, type RenderContext, type RenderBounds, type RenderObject, type Signal, SignalMetadata, formatValueForDisplay } from "@voltex-viewer/plugin-api";
import type { BufferData } from './waveformRendererPlugin';
import { WaveformConfig } from './waveformConfig';
import { WaveformShaders, InstancedLineAttributes, BevelJoinAttributes, DotAttributes } from './waveformShaders';
import { TypedVAO } from './typedProgram';

type LineVAO = TypedVAO<InstancedLineAttributes>;
type BevelVAO = TypedVAO<BevelJoinAttributes>;
type DotVAO = TypedVAO<DotAttributes>;

export class WaveformRenderObject {
    private lineVAO: LineVAO | null = null;
    private bevelVAO: BevelVAO | null = null;
    private dotVAO: DotVAO | null = null;
    private cachedRenderMode: RenderMode | null = null;

    constructor(
        parent: RenderObject,
        private config: WaveformConfig,
        private bufferData: BufferData,
        private sharedInstanceGeometryBuffer: WebGLBuffer,
        private sharedBevelJoinGeometryBuffer: WebGLBuffer,
        private metadata: SignalMetadata,
        private waveformPrograms: WaveformShaders,
        private signal: Signal,
        private row: Row,
        zIndex: number = 0
    ) {
        parent.addChild({
            zIndex: zIndex,
            render: this.render.bind(this),
        });
    }

    render(context: RenderContext, bounds: RenderBounds): boolean {
        const { render, state } = context;
        const { gl } = render;

        const renderMode = this.metadata.renderMode;

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
        this.cachedRenderMode = this.metadata.renderMode;

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
            }, this.lineVAO);
            const instanceCount = this.bufferData.bufferLength - 1;
            if (instanceCount > 0) {
                gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, instanceCount);
            }
            prog.unbind();
        } else if (renderMode === RenderMode.Text) {
            this.renderEnumText(context, bounds);
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
        const startIndex = this.binarySearchTimeIndex(startTime, 0, maxUpdateIndex - 1, true);
        const endIndex = this.binarySearchTimeIndex(endTime, startIndex, maxUpdateIndex - 1, false);

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

    /**
     * Binary search to find the appropriate index for a given time.
     * @param targetTime The time to search for
     * @param left The left boundary of the search range
     * @param right The right boundary of the search range
     * @param findStart If true, finds the leftmost index where time >= targetTime (for start).
     *                  If false, finds the rightmost index where time <= targetTime (for end).
     * @returns The appropriate index
     */
    private binarySearchTimeIndex(targetTime: number, left: number, right: number, findStart: boolean): number {
        if (left > right) {
            return findStart ? left : right;
        }

        let result = findStart ? right + 1 : left - 1;
        const signalLength = Math.min(this.signal.time.length, this.signal.values.length);

        while (left <= right) {
            const mid = Math.floor((left + right) / 2);
            const midTime = this.signal.time.valueAt(mid);

            if (findStart) {
                // For start index: find leftmost position where segment might be visible
                // A segment at index i is visible if signal.time.valueAt(i+1) >= startTime
                if (mid + 1 < signalLength) {
                    const nextTime = this.signal.time.valueAt(mid + 1);
                    if (nextTime >= targetTime) {
                        result = mid;
                        right = mid - 1;
                    } else {
                        left = mid + 1;
                    }
                } else {
                    // Last segment, check if it starts before target time
                    if (midTime <= targetTime) {
                        result = mid;
                    }
                    right = mid - 1;
                }
            } else {
                // For end index: find rightmost position where segment might be visible
                // A segment at index i is visible if signal.time.valueAt(i) <= endTime
                if (midTime <= targetTime) {
                    result = mid;
                    left = mid + 1;
                } else {
                    right = mid - 1;
                }
            }
        }

        // Clamp result to valid range
        return Math.max(0, Math.min(signalLength - 1, result));
    }
}
