import { type ExpandedSegment, getExpandedXForTime } from './layout';

export const topHeightRatio = 0.2;
export const trapezoidHeightRatio = 0.2;
export const animationLerpFactor = 0.3;
export const borderWidth = 1.0;

export class ExpandedEnumAnimationState {
    progress = 0;
    bottomOffset = 0;
    private prevReferenceTime: number | null = null;
    private prevReferenceExpandedX: number | null = null;

    tick(
        targetProgress: number,
        segments: ExpandedSegment[],
        centerTime: number,
        pxPerSecond: number,
        offset: number,
        minExpandedWidth: number
    ): boolean {
        const lerped = this.progress + (targetProgress - this.progress) * animationLerpFactor;
        this.progress = Math.abs(lerped - targetProgress) < 0.01 ? targetProgress : lerped;

        if (segments.length === 0) {
            this.reset();
            return this.progress !== targetProgress;
        }

        const newRefX = this.prevReferenceTime !== null
            ? getExpandedXForTime(segments, this.prevReferenceTime, pxPerSecond, offset)
            : null;

        if (this.prevReferenceExpandedX !== null && newRefX !== null) {
            const delta = newRefX - this.prevReferenceExpandedX;
            if (Math.abs(delta) > minExpandedWidth * 0.9) {
                this.bottomOffset -= delta;
            }
        }

        this.prevReferenceTime = centerTime;
        this.prevReferenceExpandedX = getExpandedXForTime(segments, centerTime, pxPerSecond, offset);

        const lerpFactor = Math.min(0.5, animationLerpFactor + Math.abs(this.bottomOffset) * 0.002);
        this.bottomOffset *= (1 - lerpFactor);
        if (Math.abs(this.bottomOffset) < 0.5) {
            this.bottomOffset = 0;
        }

        for (const seg of segments) {
            seg.renderStartX += this.bottomOffset;
            seg.renderEndX += this.bottomOffset;
        }

        return this.bottomOffset !== 0 || this.progress !== targetProgress;
    }

    reset(): void {
        this.progress = 0;
        this.bottomOffset = 0;
        this.prevReferenceTime = null;
        this.prevReferenceExpandedX = null;
    }
}
