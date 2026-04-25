import type { Signal } from "@voltex-viewer/plugin-api";
import type { EnumRunIndex } from '../enumRunIndex';

export interface ExpandedSegment {
    startBufferIndex: number;
    endBufferIndex: number;
    originalStartX: number;
    originalEndX: number;
    renderStartX: number;
    renderEndX: number;
    value: number;
}

export function binarySearchTimeIndex(
    signal: Signal,
    targetTime: number,
    left: number,
    right: number,
    findStart: boolean
): number {
    if (left > right) {
        return findStart ? left : right;
    }

    let result = findStart ? right + 1 : left - 1;
    const signalLength = Math.min(signal.time.length, signal.values.length);

    while (left <= right) {
        const mid = Math.floor((left + right) / 2);
        const midTime = signal.time.valueAt(mid);

        if (findStart) {
            if (mid + 1 < signalLength) {
                const nextTime = signal.time.valueAt(mid + 1);
                if (nextTime >= targetTime) {
                    result = mid;
                    right = mid - 1;
                } else {
                    left = mid + 1;
                }
            } else {
                if (midTime <= targetTime) {
                    result = mid;
                }
                right = mid - 1;
            }
        } else {
            if (midTime <= targetTime) {
                result = mid;
                left = mid + 1;
            } else {
                right = mid - 1;
            }
        }
    }

    return Math.max(0, Math.min(signalLength - 1, result));
}

export function computeExpandedLayout(
    signal: Signal,
    enumRunIndex: EnumRunIndex,
    startRun: number,
    endRun: number,
    pxPerSecond: number,
    offset: number,
    viewportCenterX: number,
    viewportWidth: number,
    minExpandedWidth: number
): ExpandedSegment[] {
    const runCount = enumRunIndex.runCount;
    if (runCount === 0) return [];

    const clampedStartRun = Math.max(0, Math.min(startRun, runCount - 1));
    const clampedEndRun = Math.max(clampedStartRun, Math.min(endRun, runCount - 1));

    const maxSegmentsForViewport = Math.ceil(viewportWidth / minExpandedWidth) + 4;
    const centerTime = (viewportCenterX + offset) / pxPerSecond;

    const leftSegments: ExpandedSegment[] = [];
    const rightSegments: ExpandedSegment[] = [];
    let totalExtraNeeded = 0;
    let totalShrinkable = 0;
    const lastRun = runCount - 1;

    const createSegmentFromRun = (runIdx: number): ExpandedSegment | null => {
        if (runIdx < clampedStartRun || runIdx > clampedEndRun) return null;

        const segStartIdx = enumRunIndex.startIndex(runIdx);
        const segEndIdx = enumRunIndex.endIndex(runIdx);
        const value = enumRunIndex.value(runIdx);
        const segmentStartTime = signal.time.valueAt(segStartIdx);
        const segmentEndTime = runIdx < lastRun
            ? signal.time.valueAt(enumRunIndex.startIndex(runIdx + 1))
            : signal.time.valueAt(segEndIdx);
        const originalStartX = segmentStartTime * pxPerSecond - offset;
        const originalEndX = segmentEndTime * pxPerSecond - offset;
        const originalWidth = originalEndX - originalStartX;

        const seg: ExpandedSegment = {
            startBufferIndex: segStartIdx,
            endBufferIndex: segEndIdx,
            originalStartX,
            originalEndX,
            renderStartX: 0,
            renderEndX: originalWidth,
            value,
        };

        const isNullValue = "null" in signal.values && value === signal.values.null;
        if (!isNullValue && originalWidth < minExpandedWidth) {
            const extraNeeded = minExpandedWidth - originalWidth;
            totalExtraNeeded += extraNeeded;
            seg.renderEndX = minExpandedWidth;
        } else if (isNullValue && originalWidth > 1) {
            totalShrinkable += originalWidth - 1;
        } else if (originalWidth > minExpandedWidth) {
            totalShrinkable += originalWidth - minExpandedWidth;
        }

        return seg;
    };

    let centerRun = clampedStartRun;
    let left = clampedStartRun;
    let right = clampedEndRun;
    while (left <= right) {
        const mid = (left + right) >>> 1;
        const runStartTime = signal.time.valueAt(enumRunIndex.startIndex(mid));
        const runEndTime = mid < lastRun
            ? signal.time.valueAt(enumRunIndex.startIndex(mid + 1))
            : signal.time.valueAt(enumRunIndex.endIndex(mid));

        if (centerTime < runStartTime) {
            right = mid - 1;
        } else if (centerTime > runEndTime) {
            left = mid + 1;
        } else {
            centerRun = mid;
            break;
        }
    }

    if (left > right) {
        centerRun = Math.max(clampedStartRun, Math.min(clampedEndRun, right));
    }

    const centerSeg = createSegmentFromRun(centerRun);
    if (!centerSeg) return [];
    rightSegments.push(centerSeg);

    let leftRun = centerRun - 1;
    let rightRun = centerRun + 1;

    while (leftSegments.length + rightSegments.length < maxSegmentsForViewport) {
        let added = false;

        if (leftRun >= clampedStartRun && leftSegments.length + rightSegments.length < maxSegmentsForViewport) {
            const seg = createSegmentFromRun(leftRun);
            if (seg) {
                leftSegments.push(seg);
                added = true;
            }
            leftRun--;
        }

        if (rightRun <= clampedEndRun && leftSegments.length + rightSegments.length < maxSegmentsForViewport) {
            const seg = createSegmentFromRun(rightRun);
            if (seg) {
                rightSegments.push(seg);
                added = true;
            }
            rightRun++;
        }

        if (!added) break;
    }

    const segments = [...leftSegments.reverse(), ...rightSegments];
    if (segments.length === 0) return [];

    const nullValue = "null" in signal.values ? signal.values.null : null;

    if (totalExtraNeeded > 0 && totalShrinkable > 0) {
        const shrinkRatio = Math.min(1, totalExtraNeeded / totalShrinkable);
        for (const seg of segments) {
            const originalWidth = seg.originalEndX - seg.originalStartX;
            const isNullSeg = nullValue !== null && seg.value === nullValue;
            const minWidth = isNullSeg ? 1 : minExpandedWidth;
            if (originalWidth > minWidth) {
                const shrinkable = originalWidth - minWidth;
                seg.renderEndX = originalWidth - shrinkable * shrinkRatio;
            }
        }
    }

    const firstSeg = segments[0];
    const lastSeg = segments[segments.length - 1];
    const clampedCenterX = Math.max(firstSeg.originalStartX, Math.min(lastSeg.originalEndX, viewportCenterX));

    let centerSegmentIndex = 0;
    for (let i = 0; i < segments.length; i++) {
        const seg = segments[i];
        if (clampedCenterX >= seg.originalStartX && clampedCenterX <= seg.originalEndX) {
            centerSegmentIndex = i;
            break;
        } else if (seg.originalStartX > clampedCenterX) {
            centerSegmentIndex = Math.max(0, i - 1);
            break;
        }
        centerSegmentIndex = i;
    }

    const centerSegForLayout = segments[centerSegmentIndex];
    let t = 0.5;
    if (centerSegForLayout) {
        const segWidth = centerSegForLayout.originalEndX - centerSegForLayout.originalStartX;
        t = segWidth > 0 ? (clampedCenterX - centerSegForLayout.originalStartX) / segWidth : 0.5;
        t = Math.max(0, Math.min(1, t));
    }

    let expandedBeforeCenter = 0;
    for (let i = 0; i < centerSegmentIndex; i++) {
        expandedBeforeCenter += segments[i].renderEndX;
    }
    const expandedCenterOffset = t * (centerSegForLayout?.renderEndX ?? 0);
    const firstExpandedStart = clampedCenterX - expandedBeforeCenter - expandedCenterOffset;

    let currentX = firstExpandedStart;
    for (let i = 0; i < segments.length; i++) {
        const seg = segments[i];
        const expandedWidth = seg.renderEndX;
        
        let startX = currentX;
        let endX = currentX + expandedWidth;
        
        if (i === 0 && startX > seg.originalStartX) {
            startX = seg.originalStartX;
        }
        if (i === segments.length - 1 && endX < seg.originalEndX) {
            endX = seg.originalEndX;
        }
        
        seg.renderStartX = startX;
        seg.renderEndX = endX;
        currentX += expandedWidth;
    }

    return segments.filter(seg => seg.renderEndX > seg.renderStartX);
}

export function binarySearchExpandedSegment(
    segments: ExpandedSegment[],
    screenX: number,
    progress: number,
    pxPerSecond: number,
    offset: number
): ExpandedSegment | null {
    if (segments.length === 0) return null;

    let left = 0;
    let right = segments.length - 1;

    while (left <= right) {
        const mid = Math.floor((left + right) / 2);
        const seg = segments[mid];
        const bounds = interpolateSegmentBounds(seg, progress, pxPerSecond, offset);

        if (screenX < bounds.leftX) {
            right = mid - 1;
        } else if (screenX > bounds.rightX) {
            left = mid + 1;
        } else {
            return seg;
        }
    }

    return null;
}

export function interpolateSegmentBounds(
    segment: ExpandedSegment,
    progress: number,
    _pxPerSecond: number,
    _offset: number
): { leftX: number; rightX: number; topLeftX: number; topRightX: number } {
    const topLeftX = segment.originalStartX;
    const topRightX = segment.originalEndX;
    const bottomLeftX = segment.renderStartX;
    const bottomRightX = segment.renderEndX;

    const leftX = topLeftX + (bottomLeftX - topLeftX) * progress;
    const rightX = topRightX + (bottomRightX - topRightX) * progress;

    return { leftX, rightX, topLeftX, topRightX };
}

export function getExpandedXForTime(
    segments: ExpandedSegment[],
    time: number,
    pxPerSecond: number,
    offset: number
): number | null {
    const timeX = time * pxPerSecond - offset;
    for (const seg of segments) {
        if (timeX >= seg.originalStartX && timeX <= seg.originalEndX) {
            const originalWidth = seg.originalEndX - seg.originalStartX;
            const t = originalWidth > 0
                ? (timeX - seg.originalStartX) / originalWidth
                : 0.5;
            return seg.renderStartX + t * (seg.renderEndX - seg.renderStartX);
        }
    }
    return null;
}
