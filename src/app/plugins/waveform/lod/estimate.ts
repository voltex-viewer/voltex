import type { Sample } from '@voltex-viewer/plugin-api';
import type { LodGeometry } from './lodView';

export interface SampleEstimate {
    /** The sample at or before the time for enums, otherwise the nearest one. Made up when not exact. */
    point: Sample;
    /** The point after it, which ends an enum run */
    next: Sample | null;
    /** False when samples hidden near the time could differ, so the value is an estimate */
    exact: boolean;
}

function geometryPoint(geometry: LodGeometry, i: number): Sample {
    const point: Sample = { time: geometry.time[i], value: geometry.value[i] };
    const exact = geometry.exact?.[i];
    if (exact !== undefined) point.exact = exact;
    return point;
}

/**
 * Estimates the samples at a time from the points already drawn, so there is something to show while the exact
 * ones load. Each column keeps its first and last sample, so points in different columns have no samples between
 * them, and neither do points with no value changes between them.
 */
export function estimateSample(geometry: LodGeometry, time: number, columnWidth: number, nearest: boolean, nullValue?: number): SampleEstimate | null {
    const { length } = geometry;
    let lo = 0;
    let hi = length;
    while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (geometry.time[mid] <= time) lo = mid + 1;
        else hi = mid;
    }
    const i = lo - 1;
    const j = lo;
    if (i < 0 || j >= length) return null;

    const before = geometryPoint(geometry, i);
    const after = geometryPoint(geometry, j);
    const column = (t: number) => Math.floor(t / columnWidth);
    // NaN where a coarser tile stood in, which says nothing
    const changes = geometry.changes[j];
    const adjacent = changes === 0 || (!Number.isNaN(changes) && column(before.time) !== column(after.time));
    if (adjacent) {
        const useAfter = nearest && after.time - time < time - before.time;
        const point = useAfter ? after : before;
        return { point, next: useAfter ? null : after, exact: true };
    }

    if (!nearest) {
        // The run drawn at the time, which may hide changes
        return { point: before, next: after, exact: false };
    }

    // Hidden samples lie between the column's smallest and largest points, so the estimate is halfway
    let min = Infinity;
    let max = -Infinity;
    const start = column(time) * columnWidth;
    const end = start + columnWidth;
    for (let k = i; k >= 0 && (k === i || geometry.time[k] >= start); k--) {
        const v = geometry.value[k];
        if (v !== nullValue) { min = Math.min(min, v); max = Math.max(max, v); }
    }
    for (let k = j; k < length && (k === j || geometry.time[k] < end); k++) {
        const v = geometry.value[k];
        if (v !== nullValue) { min = Math.min(min, v); max = Math.max(max, v); }
    }
    if (min > max) return null;
    return { point: { time, value: (min + max) / 2 }, next: null, exact: false };
}
