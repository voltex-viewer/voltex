import type { RenderContext, RenderBounds, Signal, SignalMetadata } from '@voltex-viewer/plugin-api';
import type { WaveformShaders } from '../waveformShaders';
import type { WaveformConfig } from '../waveformConfig';
import type { EnumRunIndex } from '../enumRunIndex';
import {
    type ExpandedSegment,
    computeExpandedLayout,
} from './layout';
import { ExpandedEnumAnimationState, topHeightRatio, trapezoidHeightRatio } from './animation';
import { type ExpandedEnumResources } from './resources';
import { ExpandedEnumGeometryRenderer } from './geometryRenderer';
import { ExpandedEnumTextRenderer } from './textRenderer';

export interface ExpandedEnumUpdateResult {
    segments: ExpandedSegment[];
    needsRedraw: boolean;
}

export class ExpandedEnumController {
    private animationState = new ExpandedEnumAnimationState();
    private geometryRenderer: ExpandedEnumGeometryRenderer;
    private textRenderer = new ExpandedEnumTextRenderer();
    private currentSegments: ExpandedSegment[] = [];
    
    targetProgress = 0;

    constructor(
        gl: WebGL2RenderingContext,
        private signal: Signal,
        private enumRunIndex: EnumRunIndex | null,
        private config: WaveformConfig,
        shaders: WaveformShaders,
        resources: ExpandedEnumResources
    ) {
        this.geometryRenderer = new ExpandedEnumGeometryRenderer(gl, shaders, resources);
    }

    get progress(): number {
        return this.animationState.progress;
    }

    get segments(): ExpandedSegment[] {
        return this.currentSegments;
    }

    update(context: RenderContext, bounds: RenderBounds): ExpandedEnumUpdateResult {
        const { state } = context;

        if (!this.enumRunIndex || this.enumRunIndex.runCount === 0) {
            this.currentSegments = [];
            return { segments: this.currentSegments, needsRedraw: false };
        }

        const indexedLastRun = this.enumRunIndex.runCount - 1;

        const startTime = state.offset / state.pxPerSecond;
        const endTime = (state.offset + bounds.width) / state.pxPerSecond;
        const [visibleRunStart, visibleRunEnd] = this.enumRunIndex.getVisibleRunRange(this.signal, startTime, endTime);

        const maxTransitionsForExpansion = Math.floor(bounds.width / this.config.minExpandedWidth);
        const extraRuns = Math.ceil(maxTransitionsForExpansion / 2);
        const startRun = Math.max(0, visibleRunStart - extraRuns);
        const endRun = Math.min(indexedLastRun, visibleRunEnd + extraRuns);

        const viewportCenterX = bounds.width / 2;
        const segments = computeExpandedLayout(
            this.signal,
            this.enumRunIndex,
            startRun,
            endRun,
            state.pxPerSecond,
            state.offset,
            viewportCenterX,
            bounds.width,
            this.config.minExpandedWidth
        );

        const centerTime = (viewportCenterX + state.offset) / state.pxPerSecond;
        const needsRedraw = this.animationState.tick(
            this.targetProgress,
            segments,
            centerTime,
            state.pxPerSecond,
            state.offset,
            this.config.minExpandedWidth
        );

        this.currentSegments = segments;

        return { segments, needsRedraw };
    }

    renderGeometry(
        context: RenderContext,
        bounds: RenderBounds,
        metadata: SignalMetadata
    ): void {
        this.geometryRenderer.render(
            context,
            bounds,
            this.currentSegments,
            this.signal,
            metadata,
            this.animationState.progress
        );
    }

    renderText(
        context: RenderContext,
        bounds: RenderBounds,
        metadata: SignalMetadata
    ): void {
        this.textRenderer.render(
            context,
            bounds,
            this.currentSegments,
            this.signal,
            metadata,
            this.animationState.progress
        );
    }

    renderHighlight(
        context: RenderContext,
        bounds: RenderBounds,
        segment: ExpandedSegment,
        highlightColor: string
    ): void {
        this.geometryRenderer.renderHighlight(
            context,
            bounds,
            segment,
            this.signal,
            highlightColor,
            this.animationState.progress
        );
    }

    getSegmentForTime(time: number, pxPerSecond: number, offset: number): ExpandedSegment | null {
        if (this.currentSegments.length === 0) return null;
        const timeX = time * pxPerSecond - offset;
        for (const seg of this.currentSegments) {
            if (seg.originalStartX === seg.originalEndX) {
                if (timeX === seg.originalStartX) {
                    return seg;
                }
            } else if (timeX >= seg.originalStartX && timeX < seg.originalEndX) {
                return seg;
            }
        }
        return null;
    }

    getIndexForPosition(
        screenX: number,
        screenY: number,
        boundsHeight: number,
        pxPerSecond: number,
        offset: number
    ): number {
        const segments = this.currentSegments;
        if (segments.length === 0) return 0;

        const progress = this.animationState.progress;
        const topEndY = boundsHeight * topHeightRatio;
        const bottomStartY = boundsHeight * (topHeightRatio + trapezoidHeightRatio);

        let t: number;
        if (screenY <= topEndY) {
            t = 0;
        } else if (screenY >= bottomStartY) {
            t = 1;
        } else {
            t = (screenY - topEndY) / (bottomStartY - topEndY);
        }
        t *= progress;

        let closestSegIndex = 0;
        let closestDist = Infinity;

        for (let i = 0; i < segments.length; i++) {
            const seg = segments[i];
            const startTime = this.signal.time.valueAt(seg.startBufferIndex);
            const endTime = this.signal.time.valueAt(seg.endBufferIndex);

            const topStartX = startTime * pxPerSecond - offset;
            const topEndX = endTime * pxPerSecond - offset;

            const leftX = topStartX + (seg.renderStartX - topStartX) * t;
            const rightX = topEndX + (seg.renderEndX - topEndX) * t;

            if (screenX >= leftX && screenX < rightX) {
                const segmentWidth = rightX - leftX;
                if (segmentWidth <= 0) return seg.startBufferIndex;

                const ratio = (screenX - leftX) / segmentWidth;
                const originalX = topStartX + ratio * (topEndX - topStartX);
                const originalTime = (originalX + offset) / pxPerSecond;

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

            const centerX = (leftX + rightX) / 2;
            const dist = Math.abs(screenX - centerX);
            if (dist < closestDist) {
                closestDist = dist;
                closestSegIndex = i;
            }
        }

        return segments[closestSegIndex].startBufferIndex;
    }

    reset(): void {
        this.animationState.reset();
        this.currentSegments = [];
        this.targetProgress = 0;
    }

    dispose(): void {
        this.geometryRenderer.dispose();
        this.currentSegments = [];
    }
}
