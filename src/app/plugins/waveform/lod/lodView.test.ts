import { describe, it, expect } from 'vitest';
import { RenderMode, tileDuration, type Signal, type Tile } from '@voltex-viewer/plugin-api';
import { LodView } from './lodView';

// One sample per second, up to `end`. Tiles past the end have nothing after them, so they may still change.
function growingSignal() {
    const requests: number[] = [];
    let end = 1000;
    const signal: Signal = {
        source: { name: ['test'], signal: () => Promise.reject(new Error('unused')) },
        renderHint: RenderMode.Lines,
        get timeRange() { return [0, end] as const; },
        valueRange: [0, 1],
        tile(level: number, index: number): Tile {
            // Only the view's level, not the base tiles kept alongside it
            if (level === 0) requests.push(index);
            const duration = tileDuration(level);
            const time = [];
            for (let t = Math.max(0, Math.ceil(index * duration)); t < (index + 1) * duration && t <= end; t++) time.push(t);
            const afterTime = Math.ceil((index + 1) * duration);
            return {
                time: Float64Array.from(time),
                value: new Float64Array(time.length),
                changes: new Uint32Array(time.length),
                samples: time.length,
                before: index > 0 && index * duration <= end + 1 ? { time: Math.ceil(index * duration) - 1, value: 0 } : null,
                after: afterTime <= end ? { time: afterTime, value: 0 } : null,
            };
        },
    };
    return { signal, requests, grow: (to: number) => { end = to; } };
}

describe('LodView', () => {
    // Level 0, so each tile is 512 seconds
    const pxPerSecond = 1;

    it('refetches tiles that may still change only when the signal grows', () => {
        const { signal, requests, grow } = growingSignal();
        const view = new LodView(signal, () => {});
        view.update(0, 1500, pxPerSecond, Infinity);
        expect(new Set(requests)).toEqual(new Set([-1, 0, 1, 2, 3]));

        requests.length = 0;
        view.update(0, 1500, pxPerSecond, Infinity);
        expect(requests).toEqual([]);

        // Tile 1 ends at 1024, so has data after it now, but tiles 2 and 3 still don't
        grow(1100);
        view.update(0, 1500, pxPerSecond, Infinity);
        expect(new Set(requests)).toEqual(new Set([1, 2, 3]));

        requests.length = 0;
        grow(1200);
        view.update(0, 1500, pxPerSecond, Infinity);
        expect(new Set(requests)).toEqual(new Set([2, 3]));
    });
});

// Samples at the given times, with tiles that load when `flush` is called
function asyncSignal(times: number[]) {
    let end = times.length;
    const pending: (() => void)[] = [];
    const tileFor = (level: number, index: number): Tile => {
        const duration = tileDuration(level);
        const visible = times.slice(0, end);
        const inside = visible.filter(t => t >= index * duration && t < (index + 1) * duration);
        const before = visible.filter(t => t < index * duration).at(-1);
        const after = visible.find(t => t >= (index + 1) * duration);
        return {
            time: Float64Array.from(inside),
            value: Float64Array.from(inside),
            changes: new Uint32Array(inside.length).fill(1),
            samples: inside.length,
            before: before === undefined ? null : { time: before, value: before },
            after: after === undefined ? null : { time: after, value: after },
        };
    };
    const signal: Signal = {
        source: { name: ['test'], signal: () => Promise.reject(new Error('unused')) },
        renderHint: RenderMode.Lines,
        get timeRange() { return [times[0], times[end - 1]] as const; },
        valueRange: [0, 1],
        tile(level: number, index: number): Promise<Tile> {
            return new Promise(resolve => pending.push(() => resolve(tileFor(level, index))));
        },
    };
    const flush = async () => {
        while (pending.length > 0) pending.splice(0).forEach(resolve => resolve());
        await new Promise(resolve => setTimeout(resolve, 0));
    };
    return { signal, flush, setLength: (n: number) => { end = n; } };
}

function drawnRange(view: LodView): [number, number] {
    const g = view.geometry!;
    return [g.time[0], g.time[g.length - 1]];
}

describe('LodView stand-ins', () => {
    it('can draw the whole signal after zooming in while it grew', async () => {
        const times = Array.from({ length: 2000 }, (_, i) => i);
        const { signal, flush, setLength } = asyncSignal(times);
        setLength(1000);
        const view = new LodView(signal, () => {});
        // Level 2, so one tile covers the signal
        view.update(0, 1000, 1 / 4, Infinity);
        await flush();
        view.update(0, 1000, 1 / 4, Infinity);

        // Level -9, so each tile is a second
        for (let frame = 0; frame < 3; frame++) {
            view.update(500, 501, 512, Infinity);
            await flush();
        }
        setLength(1100);
        view.update(500, 501, 512, Infinity);
        await flush();
        view.update(500, 501, 512, Infinity);

        // Zoomed back out, before the new tiles have loaded
        view.update(0, 1100, 1 / 4, Infinity);
        const [first, last] = drawnRange(view);
        expect(first).toBeLessThanOrEqual(0);
        expect(last).toBeGreaterThanOrEqual(999);
    });

    it('draws the line across a view with no samples while finer tiles load', async () => {
        const { signal, flush } = asyncSignal([0, 1000]);
        const view = new LodView(signal, () => {});
        view.update(0, 1000, 1, Infinity);
        await flush();
        view.update(0, 1000, 1, Infinity);

        view.update(400, 401, 512, Infinity);
        const [first, last] = drawnRange(view);
        expect(first).toBeLessThanOrEqual(400);
        expect(last).toBeGreaterThanOrEqual(401);
    });
});
