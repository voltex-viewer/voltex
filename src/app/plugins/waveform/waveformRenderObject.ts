import { hexToRgba, RenderMode, Row, type RenderContext, type RenderBounds, type RenderObject, type Signal, SignalMetadata, formatValueForDisplay } from "@voltex-viewer/plugin-api";
import type { BufferData } from './waveformRendererPlugin';
import { WaveformConfig } from './waveformConfig';
import { WaveformShaders, InstancedLineAttributes, BevelJoinAttributes, DotAttributes, ExpandedEnumAttributes } from './waveformShaders';
import { TypedVAO } from './typedProgram';
import {
    topHeightRatio,
    trapezoidHeightRatio,
    borderWidth,
    animationLerpFactor,
    type ExpandedSegment,
    expandedGeometry,
    binarySearchTimeIndex,
    computeExpandedLayout,
    getExpandedXForTime,
} from './expandedEnumLayout';

type LineVAO = TypedVAO<InstancedLineAttributes>;
type BevelVAO = TypedVAO<BevelJoinAttributes>;
type DotVAO = TypedVAO<DotAttributes>;
type ExpandedEnumVAO = TypedVAO<ExpandedEnumAttributes>;

export class WaveformRenderObject {
    private lineVAO: LineVAO | null = null;
    private bevelVAO: BevelVAO | null = null;
    private dotVAO: DotVAO | null = null;
    private cachedRenderMode: RenderMode | null = null;

    // Expanded enum rendering state
    private expandedEnumState: { vao: ExpandedEnumVAO; dataBuffer: WebGLBuffer } | null = null;
    private expandedInstanceData: Float32Array | null = null;
    private animatedBottomOffset = 0;
    private prevReferenceTime: number | null = null;
    private prevReferenceExpandedX: number | null = null;
    private currentExpandedSegments: ExpandedSegment[] | null = null;
    private expandedTextRenderState: { segments: ExpandedSegment[]; bottomY: number; bottomHeight: number } | null = null;
    
    // Exposed for parent to control animation progress (0 = collapsed, 1 = fully expanded)
    expandedModeProgress = 0;

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
        // Separate child for expanded text to render above highlights
        parent.addChild({
            zIndex: 100,
            render: this.renderExpandedTextPass.bind(this),
        });
    }

    getExpandedSegmentForTime(time: number, pxPerSecond: number, offset: number): { expandedStartX: number; expandedWidth: number } | null {
        if (this.metadata.renderMode !== RenderMode.ExpandedEnum || !this.currentExpandedSegments) return null;
        const timeX = time * pxPerSecond - offset;
        for (const seg of this.currentExpandedSegments) {
            // Use exclusive end boundary to avoid matching next segment at boundary
            if (timeX >= seg.originalStartX && timeX < seg.originalEndX) {
                return { expandedStartX: seg.expandedStartX, expandedWidth: seg.expandedWidth };
            }
        }
        return null;
    }

    getIndexForPosition(screenX: number, screenY: number, boundsHeight: number, pxPerSecond: number, offset: number): number {
        const renderMode = this.metadata.renderMode;
        const signalLength = Math.min(this.signal.time.length, this.signal.values.length);
        if (signalLength === 0) return 0;

        if (renderMode === RenderMode.ExpandedEnum && this.currentExpandedSegments && this.currentExpandedSegments.length > 0) {
            return this.getIndexForExpandedPosition(screenX, screenY, boundsHeight, pxPerSecond, offset);
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

    private getIndexForExpandedPosition(screenX: number, screenY: number, boundsHeight: number, pxPerSecond: number, offset: number): number {
        const segments = this.currentExpandedSegments!;
        const progress = this.expandedModeProgress;

        // Determine Y region
        const topEndY = boundsHeight * topHeightRatio;
        const bottomStartY = boundsHeight * (topHeightRatio + trapezoidHeightRatio);

        let t: number; // 0 = top (original coords), 1 = bottom (expanded coords)
        if (screenY <= topEndY) {
            t = 0;
        } else if (screenY >= bottomStartY) {
            t = 1;
        } else {
            t = (screenY - topEndY) / (bottomStartY - topEndY);
        }
        // Apply animation progress
        t *= progress;

        // Search through segments using interpolated X boundaries
        let accumulatedX = segments[0].expandedStartX;
        let closestSegIndex = 0;
        let closestDist = Infinity;

        for (let i = 0; i < segments.length; i++) {
            const seg = segments[i];
            const startTime = this.signal.time.valueAt(seg.startBufferIndex);
            const endTime = this.signal.time.valueAt(seg.endBufferIndex);

            const topStartX = startTime * pxPerSecond - offset;
            const topEndX = endTime * pxPerSecond - offset;

            let expandedStartX = accumulatedX;
            if (i === 0 && expandedStartX > topStartX) {
                expandedStartX = topStartX;
            }
            accumulatedX += seg.expandedWidth;
            let expandedEndX = accumulatedX;
            if (i === segments.length - 1 && expandedEndX < topEndX) {
                expandedEndX = topEndX;
            }

            // Interpolate between top (original) and bottom (expanded) coords
            const leftX = topStartX + (expandedStartX - topStartX) * t;
            const rightX = topEndX + (expandedEndX - topEndX) * t;

            if (screenX >= leftX && screenX < rightX) {
                // Map screen position to original time to find exact index
                const segmentWidth = rightX - leftX;
                if (segmentWidth <= 0) return seg.startBufferIndex;
                
                const ratio = (screenX - leftX) / segmentWidth;
                const originalX = topStartX + ratio * (topEndX - topStartX);
                const originalTime = (originalX + offset) / pxPerSecond;
                
                // Find the index at this time within the segment's range
                let left = seg.startBufferIndex;
                let right = seg.endBufferIndex - 1;
                while (left < right) {
                    const mid = Math.floor((left + right) / 2);
                    if (this.signal.time.valueAt(mid + 1) <= originalTime) {
                        left = mid + 1;
                    } else {
                        right = mid;
                    }
                }
                return left;
            }
            
            // Track closest segment for fallback
            const centerX = (leftX + rightX) / 2;
            const dist = Math.abs(screenX - centerX);
            if (dist < closestDist) {
                closestDist = dist;
                closestSegIndex = i;
            }
        }
        // Fallback to closest segment
        return segments[closestSegIndex].startBufferIndex;
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
        if (renderMode !== RenderMode.ExpandedEnum) {
            this.currentExpandedSegments = null;
            this.expandedTextRenderState = null;
            this.animatedBottomOffset = 0;
            this.prevReferenceTime = null;
            this.prevReferenceExpandedX = null;
            if (this.expandedEnumState) {
                this.expandedEnumState.vao.delete();
                this.expandedEnumState = null;
            }
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
                u_borderWidth: borderWidth,
            }, this.lineVAO);
            const instanceCount = this.bufferData.bufferLength - 1;
            if (instanceCount > 0) {
                gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, instanceCount);
            }
            prog.unbind();
            this.renderEnumText(context, bounds);
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
        const { state } = context;

        // First render normal enum as background (fast, covers entire signal)
        this.renderEnumBackground(context, bounds);

        const startTime = state.offset / state.pxPerSecond;
        const endTime = (state.offset + bounds.width) / state.pxPerSecond;

        const maxUpdateIndex = Math.min(this.signal.time.length, this.signal.values.length);
        let startIndex = binarySearchTimeIndex(this.signal, startTime, 0, maxUpdateIndex - 1, true);
        let endIndex = binarySearchTimeIndex(this.signal, endTime, startIndex, maxUpdateIndex - 1, false);
        
        // Include extra segments on each side for stable redistribution
        const maxTransitionsForExpansion = Math.floor(bounds.width / this.config.minExpandedWidth);
        const extraSegments = Math.ceil(maxTransitionsForExpansion / 2);
        for (let e = 0; e < extraSegments && startIndex > 0; e++) {
            const currentValue = this.signal.values.valueAt(startIndex);
            while (startIndex > 0 && this.signal.values.valueAt(startIndex - 1) === currentValue) {
                startIndex--;
            }
            if (startIndex > 0) {
                startIndex--;
                const newValue = this.signal.values.valueAt(startIndex);
                while (startIndex > 0 && this.signal.values.valueAt(startIndex - 1) === newValue) {
                    startIndex--;
                }
            }
        }
        for (let e = 0; e < extraSegments && endIndex < maxUpdateIndex - 2; e++) {
            const currentValue = this.signal.values.valueAt(endIndex);
            while (endIndex < maxUpdateIndex - 2 && this.signal.values.valueAt(endIndex + 1) === currentValue) {
                endIndex++;
            }
            if (endIndex < maxUpdateIndex - 2) {
                endIndex++;
                const newValue = this.signal.values.valueAt(endIndex);
                while (endIndex < maxUpdateIndex - 2 && this.signal.values.valueAt(endIndex + 1) === newValue) {
                    endIndex++;
                }
            }
        }

        const viewportCenterX = bounds.width / 2;
        const segments = computeExpandedLayout(
            this.signal,
            startIndex,
            endIndex,
            state.pxPerSecond,
            state.offset,
            viewportCenterX,
            bounds.width,
            this.config.minExpandedWidth
        );

        if (segments.length === 0) {
            return false;
        }

        // Compute center time for animation reference
        const centerTime = (viewportCenterX + state.offset) / state.pxPerSecond;

        // Find where the reference time is in the new layout (before applying offset)
        const newRefX = this.prevReferenceTime !== null
            ? getExpandedXForTime(segments, this.prevReferenceTime, state.pxPerSecond, state.offset)
            : null;

        if (this.prevReferenceExpandedX !== null && newRefX !== null) {
            const jump = this.prevReferenceExpandedX - newRefX;
            // Only animate large jumps (segment redistribution), apply small panning adjustments immediately
            if (Math.abs(jump) > this.config.minExpandedWidth * 0.9) {
                this.animatedBottomOffset += jump;
            }
        }

        // Store reference for next frame BEFORE applying offset
        this.prevReferenceTime = centerTime;
        this.prevReferenceExpandedX = getExpandedXForTime(segments, centerTime, state.pxPerSecond, state.offset);

        // Lerp the offset toward 0 - faster when further away
        const lerpFactor = Math.min(0.5, animationLerpFactor + Math.abs(this.animatedBottomOffset) * 0.002);
        this.animatedBottomOffset *= (1 - lerpFactor);
        if (Math.abs(this.animatedBottomOffset) < 0.5) {
            this.animatedBottomOffset = 0;
        }

        // Apply animation offset to bottom positions
        for (const seg of segments) {
            seg.expandedStartX += this.animatedBottomOffset;
        }

        // Store for external access (hover highlighting)
        this.currentExpandedSegments = segments;

        const topHeight = bounds.height * topHeightRatio;
        const trapezoidHeight = bounds.height * trapezoidHeightRatio;
        const bottomHeight = bounds.height * (1 - topHeightRatio - trapezoidHeightRatio);
        const bottomY = topHeight + trapezoidHeight;

        this.renderExpandedEnumGeometry(context, bounds, segments);

        // Store state for text rendering in separate pass
        this.expandedTextRenderState = { segments, bottomY, bottomHeight };

        return this.animatedBottomOffset !== 0;
    }

    private renderExpandedEnumGeometry(context: RenderContext, bounds: RenderBounds, segments: ExpandedSegment[]): void {
        const { render, state } = context;
        const { gl } = render;

        const topHeight = bounds.height * topHeightRatio;
        const trapezoidHeight = bounds.height * trapezoidHeightRatio;
        const bottomHeight = bounds.height * (1 - topHeightRatio - trapezoidHeightRatio);
        const topY = 0;
        const bottomY = topHeight + trapezoidHeight;

        const color = this.metadata.color;
        const [r, g, b, a] = hexToRgba(color);

        const leftTimeDouble = state.offset / state.pxPerSecond;
        const timeOffsetHigh = Math.fround(leftTimeDouble);
        const timeOffsetLow = leftTimeDouble - timeOffsetHigh;

        const dataStride = 8;
        const requiredSize = segments.length * dataStride;
        if (!this.expandedInstanceData || this.expandedInstanceData.length < requiredSize) {
            this.expandedInstanceData = new Float32Array(requiredSize);
        }
        const instanceData = this.expandedInstanceData;

        if (!this.expandedEnumState) {
            const positionBuffer = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
            gl.bufferData(gl.ARRAY_BUFFER, expandedGeometry, gl.STATIC_DRAW);

            const dataBuffer = gl.createBuffer();

            const prog = this.waveformPrograms.expandedEnum;
            const stride = dataStride * 4;
            const vao = prog.createVAO({
                position: { buffer: positionBuffer, size: 2 },
                pointATimeHigh: { buffer: dataBuffer, size: 1, stride: stride, offset: 0, divisor: 1 },
                pointBTimeHigh: { buffer: dataBuffer, size: 1, stride: stride, offset: 4, divisor: 1 },
                pointATimeLow: { buffer: dataBuffer, size: 1, stride: stride, offset: 8, divisor: 1 },
                pointBTimeLow: { buffer: dataBuffer, size: 1, stride: stride, offset: 12, divisor: 1 },
                pointAValue: { buffer: dataBuffer, size: 1, stride: stride, offset: 16, divisor: 1 },
                bottomLeftX: { buffer: dataBuffer, size: 1, stride: stride, offset: 20, divisor: 1 },
                bottomRightX: { buffer: dataBuffer, size: 1, stride: stride, offset: 24, divisor: 1 },
            });
            this.expandedEnumState = { vao, dataBuffer };
        }

        let accumulatedX = segments[0].expandedStartX;
        for (let i = 0; i < segments.length; i++) {
            const seg = segments[i];
            const off = i * dataStride;
            
            // Compute boundary times
            const startTime = this.signal.time.valueAt(seg.startBufferIndex);
            const startHigh = Math.fround(startTime);
            const endTime = this.signal.time.valueAt(seg.endBufferIndex);
            const endHigh = Math.fround(endTime);
            
            // Compute bottom boundary X
            const currentTopX = startTime * state.pxPerSecond - state.offset;
            let expandedX = accumulatedX;
            if (i === 0 && expandedX > currentTopX) {
                expandedX = currentTopX;
            }
            const bottomLeftX = currentTopX + (expandedX - currentTopX) * this.expandedModeProgress;
            
            accumulatedX += seg.expandedWidth;
            
            const currentTopEndX = endTime * state.pxPerSecond - state.offset;
            let expandedEndX = accumulatedX;
            if (i === segments.length - 1 && expandedEndX < currentTopEndX) {
                expandedEndX = currentTopEndX;
            }
            const bottomRightX = currentTopEndX + (expandedEndX - currentTopEndX) * this.expandedModeProgress;
            
            instanceData[off + 0] = startHigh;
            instanceData[off + 1] = endHigh;
            instanceData[off + 2] = startTime - startHigh;
            instanceData[off + 3] = endTime - endHigh;
            instanceData[off + 4] = seg.value;
            instanceData[off + 5] = bottomLeftX;
            instanceData[off + 6] = bottomRightX;
            instanceData[off + 7] = 0;
        }

        gl.bindBuffer(gl.ARRAY_BUFFER, this.expandedEnumState.dataBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, instanceData.subarray(0, requiredSize), gl.DYNAMIC_DRAW);

        const prog = this.waveformPrograms.expandedEnum;
        prog.bind({
            u_bounds: [bounds.width, bounds.height],
            u_topY: topY,
            u_topHeight: topHeight,
            u_bottomY: bottomY,
            u_bottomHeight: bottomHeight,
            u_timeOffsetHigh: timeOffsetHigh,
            u_timeOffsetLow: timeOffsetLow,
            u_pxPerSecond: state.pxPerSecond,
            u_color: [r, g, b, a],
            u_nullValue: "null" in this.signal.values ? this.signal.values.null : this.signal.values.max + 1.0,
            u_hasNullValue: "null" in this.signal.values,
            u_borderWidth: borderWidth,
        }, this.expandedEnumState.vao);
        gl.drawArraysInstanced(gl.TRIANGLES, 0, 18, segments.length);
        prog.unbind();
    }

    private renderExpandedTextPass(context: RenderContext, bounds: RenderBounds): boolean {
        if (!this.expandedTextRenderState) return false;
        const { segments, bottomY, bottomHeight } = this.expandedTextRenderState;
        this.renderExpandedText(context, bounds, segments, bottomY, bottomHeight);
        return false;
    }

    private renderExpandedText(
        context: RenderContext,
        bounds: RenderBounds,
        segments: ExpandedSegment[],
        bottomY: number,
        bottomHeight: number
    ): void {
        const { render, state } = context;
        const { utils } = render;

        const padding = 5;
        const ellipsisWidth = utils.measureText('...').renderWidth;
        const baselineMetrics = utils.measureText('Ag');
        const y = bottomY + (bottomHeight - baselineMetrics.renderHeight) / 2;

        // Pre-compute interpolated X positions for text (same as shader)
        // Use current top X positions from time values (not stored original, since zoom may have changed)
        // Bottom can expand outward but never shrink inward relative to top
        const progress = this.expandedModeProgress;
        let accumulatedX = segments[0].expandedStartX;
        const textBoundaryX: number[] = [];
        for (let i = 0; i < segments.length; i++) {
            const seg = segments[i];
            const startTime = this.signal.time.valueAt(seg.startBufferIndex);
            const currentTopX = startTime * state.pxPerSecond - state.offset;
            let expandedX = accumulatedX;
            // For the first segment, clamp so bottom-left doesn't shrink inward (go right of top-left)
            if (i === 0 && expandedX > currentTopX) {
                expandedX = currentTopX;
            }
            textBoundaryX.push(currentTopX + (expandedX - currentTopX) * progress);
            accumulatedX += seg.expandedWidth;
        }
        const lastSeg = segments[segments.length - 1];
        const lastEndTime = this.signal.time.valueAt(lastSeg.endBufferIndex);
        const lastCurrentTopEndX = lastEndTime * state.pxPerSecond - state.offset;
        // Clamp so bottom-right doesn't shrink inward (go left of top-right)
        let lastExpandedEndX = accumulatedX;
        if (lastExpandedEndX < lastCurrentTopEndX) {
            lastExpandedEndX = lastCurrentTopEndX;
        }
        textBoundaryX.push(lastCurrentTopEndX + (lastExpandedEndX - lastCurrentTopEndX) * progress);

        for (let segIndex = 0; segIndex < segments.length; segIndex++) {
            const seg = segments[segIndex];
            const segStartX = textBoundaryX[segIndex];
            const segEndX = textBoundaryX[segIndex + 1];
            
            // Skip segments that are too narrow to show any text
            const segWidth = segEndX - segStartX;
            if (segWidth < padding * 2 + 10) continue;
            
            // Use seg.startBufferIndex directly instead of O(n) search
            let displayText = formatValueForDisplay(
                "convertedValueAt" in this.signal.values 
                    ? this.signal.values.convertedValueAt(seg.startBufferIndex) 
                    : seg.value,
                this.metadata.display
            );

            if (displayText === "null") continue;

            const textX = Math.max(padding, segStartX + padding);
            const availableWidth = Math.max(0, segEndX - textX - padding);

            if (availableWidth <= 0) continue;

            const textMetrics = utils.measureText(displayText);
            const textWidth = textMetrics.renderWidth;

            if (textWidth > availableWidth) {
                const availableForText = availableWidth - ellipsisWidth;
                if (availableForText <= 0) continue;

                const avgCharWidth = textWidth / displayText.length;
                const estimatedLength = Math.floor(availableForText / avgCharWidth);

                let left = Math.max(1, estimatedLength - 5);
                let right = Math.min(displayText.length - 1, estimatedLength + 5);
                let bestLength = 0;

                while (left <= right) {
                    const mid = Math.floor((left + right) / 2);
                    const truncatedWidth = utils.measureText(displayText.substring(0, mid)).renderWidth;
                    if (truncatedWidth <= availableForText) {
                        bestLength = mid;
                        left = mid + 1;
                    } else {
                        right = mid - 1;
                    }
                }

                if (bestLength === 0) continue;
                displayText = displayText.substring(0, bestLength) + '...';
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
    }
}
