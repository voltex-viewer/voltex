import type { RenderContext, RenderBounds, Signal, SignalMetadata } from '@voltex-viewer/plugin-api';
import type { WaveformShaders } from '../waveformShaders';
import type { WaveformConfig } from '../waveformConfig';
import {
    type ExpandedSegment,
    computeExpandedLayout,
    binarySearchTimeIndex,
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

        const startTime = state.offset / state.pxPerSecond;
        const endTime = (state.offset + bounds.width) / state.pxPerSecond;

        const maxUpdateIndex = Math.min(this.signal.time.length, this.signal.values.length);
        let startIndex = binarySearchTimeIndex(this.signal, startTime, 0, maxUpdateIndex - 1, true);
        let endIndex = binarySearchTimeIndex(this.signal, endTime, startIndex, maxUpdateIndex - 1, false);

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
        
        for (let e = 0; e < extraSegments && endIndex < maxUpdateIndex - 1; e++) {
            const currentValue = this.signal.values.valueAt(endIndex);
            while (endIndex < maxUpdateIndex - 1 && this.signal.values.valueAt(endIndex + 1) === currentValue) {
                endIndex++;
            }
            if (endIndex < maxUpdateIndex - 1) {
                endIndex++;
                const newValue = this.signal.values.valueAt(endIndex);
                while (endIndex < maxUpdateIndex - 1 && this.signal.values.valueAt(endIndex + 1) === newValue) {
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
