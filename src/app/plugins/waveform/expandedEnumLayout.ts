import type { Signal } from "@voltex-viewer/plugin-api";

// Expanded enum view constants
export const topHeightRatio = 0.2;
export const trapezoidHeightRatio = 0.2;
export const animationLerpFactor = 0.3;
export const borderWidth = 1.0;

export interface ExpandedSegment {
    startBufferIndex: number;
    endBufferIndex: number;
    originalStartX: number;
    originalEndX: number;
    expandedStartX: number;
    expandedWidth: number;
    value: number;
}

const topEnd = topHeightRatio;
const bottomStart = topHeightRatio + trapezoidHeightRatio;

// Pre-computed geometry for expanded enum trapezoid shape (6 triangles = 18 vertices)
export const expandedGeometry = new Float32Array([
    // Top rectangle
    0, 0, 1, 0, 1, topEnd,
    0, 0, 1, topEnd, 0, topEnd,
    // Trapezoid
    0, topEnd, 1, topEnd, 1, bottomStart,
    0, topEnd, 1, bottomStart, 0, bottomStart,
    // Bottom rectangle
    0, bottomStart, 1, bottomStart, 1, 1,
    0, bottomStart, 1, 1, 0, 1,
]);

/**
 * Binary search to find the appropriate index for a given time.
 * @param signal The signal to search in
 * @param targetTime The time to search for
 * @param left The left boundary of the search range
 * @param right The right boundary of the search range
 * @param findStart If true, finds the leftmost index where time >= targetTime (for start).
 *                  If false, finds the rightmost index where time <= targetTime (for end).
 * @returns The appropriate index
 */
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
    startIndex: number,
    endIndex: number,
    pxPerSecond: number,
    offset: number,
    viewportCenterX: number,
    viewportWidth: number,
    minExpandedWidth: number
): ExpandedSegment[] {
    const maxUpdateIndex = Math.min(signal.time.length, signal.values.length);
    if (startIndex >= maxUpdateIndex) return [];

    // Calculate max segments needed to cover viewport (with buffer for animation)
    const maxSegmentsForViewport = Math.ceil(viewportWidth / minExpandedWidth) + 4;

    // First, find the center time and corresponding index
    const centerTime = (viewportCenterX + offset) / pxPerSecond;
    const centerIndex = binarySearchTimeIndex(signal, centerTime, startIndex, endIndex, true);

    // Build segments expanding outward from center
    const leftSegments: ExpandedSegment[] = [];
    const rightSegments: ExpandedSegment[] = [];
    let totalExtraNeeded = 0;
    let totalShrinkable = 0;

    const createSegment = (segStartIdx: number, segEndIdx: number): ExpandedSegment | null => {
        // Don't create segment if end index is at or past the last valid point
        // (we need endIdx to have a valid time for the segment's end)
        if (segStartIdx >= maxUpdateIndex - 1 || segEndIdx >= maxUpdateIndex) return null;
        const value = signal.values.valueAt(segStartIdx);
        const segmentStartTime = signal.time.valueAt(segStartIdx);
        const segmentEndTime = signal.time.valueAt(segEndIdx);
        const originalStartX = segmentStartTime * pxPerSecond - offset;
        const originalEndX = segmentEndTime * pxPerSecond - offset;
        const originalWidth = originalEndX - originalStartX;

        const seg: ExpandedSegment = {
            startBufferIndex: segStartIdx,
            endBufferIndex: segEndIdx,
            originalStartX,
            originalEndX,
            expandedStartX: 0,
            expandedWidth: originalWidth,
            value
        };

        const isNullValue = "null" in signal.values && value === signal.values.null;
        if (!isNullValue && originalWidth < minExpandedWidth) {
            const extraNeeded = minExpandedWidth - originalWidth;
            totalExtraNeeded += extraNeeded;
            seg.expandedWidth = minExpandedWidth;
        } else if (isNullValue && originalWidth > 1) {
            totalShrinkable += originalWidth - 1;
        } else if (originalWidth > minExpandedWidth) {
            totalShrinkable += originalWidth - minExpandedWidth;
        }

        return seg;
    };

    // Find segment boundaries by scanning for value changes
    // Start by finding the segment containing centerIndex, but clamp to valid range
    // We need centerIndex to be before the last point (need at least one more point for end time)
    const adjustedCenterIndex = Math.min(centerIndex, maxUpdateIndex - 2);
    if (adjustedCenterIndex < startIndex) {
        // No valid segments in range
        return [];
    }

    let currentSegStart = adjustedCenterIndex;
    const centerValue = signal.values.valueAt(adjustedCenterIndex);
    while (currentSegStart > startIndex && signal.values.valueAt(currentSegStart - 1) === centerValue) {
        currentSegStart--;
    }

    let currentSegEnd = adjustedCenterIndex + 1;
    // Don't extend past maxUpdateIndex - 1 (need valid end time)
    while (currentSegEnd < endIndex + 1 && currentSegEnd < maxUpdateIndex - 1 && signal.values.valueAt(currentSegEnd) === centerValue) {
        currentSegEnd++;
    }

    // Add center segment
    const centerSeg = createSegment(currentSegStart, currentSegEnd);
    if (!centerSeg) return [];
    rightSegments.push(centerSeg);

    // Interleave left and right expansion to distribute segments evenly around center
    let leftIdx = currentSegStart;
    let rightIdx = currentSegEnd;
    let canExpandLeft = leftIdx > startIndex;
    let canExpandRight = rightIdx <= endIndex && rightIdx < maxUpdateIndex - 1;

    while ((canExpandLeft || canExpandRight) && leftSegments.length + rightSegments.length < maxSegmentsForViewport) {
        // Expand left
        if (canExpandLeft && leftSegments.length + rightSegments.length < maxSegmentsForViewport) {
            leftIdx--;
            const value = signal.values.valueAt(leftIdx);
            let segStart = leftIdx;
            while (segStart > startIndex && signal.values.valueAt(segStart - 1) === value) {
                segStart--;
            }
            const seg = createSegment(segStart, leftIdx + 1);
            if (seg) leftSegments.push(seg);
            leftIdx = segStart;
            canExpandLeft = leftIdx > startIndex;
        }

        // Expand right
        if (canExpandRight && leftSegments.length + rightSegments.length < maxSegmentsForViewport) {
            const value = signal.values.valueAt(rightIdx);
            let segEnd = rightIdx + 1;
            while (segEnd <= endIndex + 1 && segEnd < maxUpdateIndex - 1 && signal.values.valueAt(segEnd) === value) {
                segEnd++;
            }
            const seg = createSegment(rightIdx, segEnd);
            if (seg) rightSegments.push(seg);
            rightIdx = segEnd;
            canExpandRight = rightIdx <= endIndex && rightIdx < maxUpdateIndex - 1;
        }
    }

    // Combine: left segments are in reverse order
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
                seg.expandedWidth = originalWidth - shrinkable * shrinkRatio;
            }
        }
    }

    // Position expanded segments so they align with original at the clamped center point
    const firstSeg = segments[0];
    const lastSeg = segments[segments.length - 1];
    const clampedCenterX = Math.max(firstSeg.originalStartX, Math.min(lastSeg.originalEndX, viewportCenterX));

    // Find which segment contains clampedCenterX
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
        expandedBeforeCenter += segments[i].expandedWidth;
    }
    const expandedCenterOffset = t * (centerSegForLayout?.expandedWidth ?? 0);

    const firstExpandedStart = clampedCenterX - expandedBeforeCenter - expandedCenterOffset;

    let currentX = firstExpandedStart;
    for (const seg of segments) {
        seg.expandedStartX = currentX;
        currentX += seg.expandedWidth;
    }

    return segments;
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
            const t = (seg.originalEndX - seg.originalStartX) > 0
                ? (timeX - seg.originalStartX) / (seg.originalEndX - seg.originalStartX)
                : 0.5;
            return seg.expandedStartX + t * seg.expandedWidth;
        }
    }
    return null;
}
