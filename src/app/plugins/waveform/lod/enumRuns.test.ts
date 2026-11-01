import { describe, it, expect } from 'vitest';
import type { LodGeometry } from './lodView';
import { EnumRuns } from './enumRuns';

function geometry(points: [number, number, number][]): LodGeometry {
    return {
        time: Float64Array.from(points.map(p => p[0])),
        value: Float64Array.from(points.map(p => p[1])),
        changes: Float64Array.from(points.map(p => p[2])),
        exact: null,
        length: points.length,
        raw: true,
        blocks: new Float32Array(0),
        blockCount: 0,
    };
}

function runsOf(runs: EnumRuns): [number, number, number, number][] {
    return Array.from({ length: runs.count }, (_, i) => [runs.start(i), runs.end(i), runs.value(i), runs.hidden(i)]);
}

describe('EnumRuns', () => {
    it('counts changes the points do not show against the run they are in', () => {
        const runs = new EnumRuns();
        // 1 -> 2 shows one change of three, and 2 -> 2 hides two
        runs.build(geometry([[0, 1, 0], [1, 2, 3], [2, 2, 2], [3, 1, 1]]));
        expect(runsOf(runs)).toEqual([[0, 1, 1, 2], [1, 3, 2, 2], [3, 3, 1, 0]]);
    });

    it('marks runs with unknown changes', () => {
        const runs = new EnumRuns();
        runs.build(geometry([[0, 1, NaN], [1, 1, NaN], [2, 2, 1]]));
        expect(runs.hidden(0)).toBeNaN();
        expect(runs.hidden(1)).toBe(0);
    });

    it('finds the runs overlapping a time range', () => {
        const runs = new EnumRuns();
        runs.build(geometry([[0, 1, 0], [2, 2, 1], [4, 3, 1], [6, 3, 0]]));
        expect(runs.visibleRange(1, 3)).toEqual([0, 1]);
        expect(runs.visibleRange(4.5, 10)).toEqual([2, 2]);
        expect(runs.visibleRange(7, 10)).toEqual([3, 2]);
    });
});
