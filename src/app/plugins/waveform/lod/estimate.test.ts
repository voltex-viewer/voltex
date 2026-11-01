import { describe, it, expect } from 'vitest';
import type { LodGeometry } from './lodView';
import { estimateSample } from './estimate';

// [time, value, changes since the previous point]
function geometry(points: [number, number, number][]): LodGeometry {
    return {
        time: Float64Array.from(points.map(p => p[0])),
        value: Float64Array.from(points.map(p => p[1])),
        changes: Float64Array.from(points.map(p => p[2])),
        exact: null,
        length: points.length,
        raw: false,
        blocks: new Float32Array(0),
        blockCount: 0,
    };
}

describe('estimateSample', () => {
    // Columns are 1 wide. Column 2 hides samples between 2.1 (min) and 2.8 (max).
    const g = geometry([[0.5, 1, NaN], [1.5, 2, 1], [2.0, 5, 1], [2.1, 0, 4], [2.8, 9, 3], [2.9, 4, 2], [4.5, 4, 0]]);

    it('is exact between points in different columns', () => {
        expect(estimateSample(g, 1.6, 1, true)).toMatchObject({ exact: true, point: { time: 1.5, value: 2 } });
        expect(estimateSample(g, 1.9, 1, true)).toMatchObject({ exact: true, point: { time: 2.0, value: 5 } });
        expect(estimateSample(g, 1.9, 1, false)).toMatchObject({ exact: true, point: { time: 1.5 }, next: { time: 2.0 } });
    });

    it('is exact when no value changed between the points', () => {
        expect(estimateSample(g, 4.4, 1, false)).toMatchObject({ exact: true, point: { value: 4 } });
    });

    it('gives the middle of the column when samples could be hidden', () => {
        expect(estimateSample(g, 2.5, 1, true)).toMatchObject({ exact: false, point: { time: 2.5, value: 4.5 } });
    });

    it('gives the drawn run for enums when changes could be hidden', () => {
        expect(estimateSample(g, 2.5, 1, false)).toMatchObject({ exact: false, point: { time: 2.1, value: 0 }, next: { time: 2.8 } });
    });

    it('is not exact next to points from a coarser tile', () => {
        const coarse = geometry([[0.5, 1, NaN], [1.5, 2, NaN]]);
        expect(estimateSample(coarse, 0.7, 1, true)).toMatchObject({ exact: false, point: { value: 1.5 } });
    });
});
