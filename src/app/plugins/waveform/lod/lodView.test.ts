import { describe, it, expect } from 'vitest';
import { RenderMode, tileColumns, tileDuration, type SignalBackend, type Tile } from '@voltex-viewer/plugin-api';
import { SignalCache } from '../../../signalCache';
import { LodView } from './lodView';

function lodView(backend: SignalBackend): LodView {
    return new LodView(new SignalCache(() => {}).signal(backend));
}

// One sample per second, up to `end`. Tiles past the end have nothing after them, so they may still change. Tiles
// summarise more samples than they hold, so finer tiles are always fetched.
function growingSignal() {
    const requests: number[] = [];
    let end = 1000;
    const signal: SignalBackend = {
        source: { name: ['test'], signal: () => Promise.reject(new Error('unused')) },
        renderHint: RenderMode.Lines,
        get timeRange() { return [0, end] as const; },
        valueRange: [0, 1],
        live: true,
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
                samples: time.length * 2,
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
        const view = lodView(signal);
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
    const levels: number[] = [];
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
    const signal: SignalBackend = {
        source: { name: ['test'], signal: () => Promise.reject(new Error('unused')) },
        renderHint: RenderMode.Lines,
        get timeRange() { return [times[0], times[end - 1]] as const; },
        valueRange: [0, 1],
        live: true,
        tile(level: number, index: number): Promise<Tile> {
            levels.push(level);
            return new Promise(resolve => pending.push(() => resolve(tileFor(level, index))));
        },
    };
    const flush = async () => {
        while (pending.length > 0) pending.splice(0).forEach(resolve => resolve());
        await new Promise(resolve => setTimeout(resolve, 0));
    };
    return { signal, flush, pending, levels, setLength: (n: number) => { end = n; } };
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
        const view = lodView(signal);
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
        const view = lodView(signal);
        view.update(0, 1000, 1, Infinity);
        await flush();
        view.update(0, 1000, 1, Infinity);

        view.update(400, 401, 512, Infinity);
        const [first, last] = drawnRange(view);
        expect(first).toBeLessThanOrEqual(400);
        expect(last).toBeGreaterThanOrEqual(401);
    });
});

describe('LodView raw tiles', () => {
    it('draws raw data from the tiles it has when zooming in, without fetching finer ones', async () => {
        const times = Array.from({ length: 1000 }, (_, i) => i);
        const { signal, flush, levels } = asyncSignal(times);
        const view = lodView(signal);
        // Level 2, so one tile covers the signal, with every sample in it
        view.update(0, 1000, 1 / 4, Infinity);
        await flush();
        view.update(0, 1000, 1 / 4, Infinity);

        levels.length = 0;
        for (let pxPerSecond = 1; pxPerSecond <= 512; pxPerSecond *= 2) {
            view.update(500, 500 + 100 / pxPerSecond, pxPerSecond, Infinity);
            const g = view.geometry!;
            expect(g.raw).toBe(true);
            expect(g.blockCount).toBe(0);
            expect(g.time[0]).toBeLessThanOrEqual(500);
            expect(g.time[g.length - 1]).toBeGreaterThanOrEqual(500 + 100 / pxPerSecond);
        }
        // Only the base tile, which is kept for when the view zooms out again
        expect(levels).toEqual([1]);
    });

    it('draws a raw tile standing in as points', async () => {
        const times = Array.from({ length: 2000 }, (_, i) => i);
        const { signal, flush, pending, setLength } = asyncSignal(times);
        setLength(1000);
        const view = lodView(signal);
        view.update(0, 1000, 1 / 4, Infinity);
        await flush();
        view.update(0, 1000, 1 / 4, Infinity);

        // The signal grew, so the tile is out of date and finer tiles are fetched, but it's still raw meanwhile
        setLength(1100);
        view.update(500, 600, 1, Infinity);
        expect(pending.length).toBeGreaterThan(0);
        const g = view.geometry!;
        expect(g.raw).toBe(true);
        expect(g.blockCount).toBe(0);
    });

    it('is raw when the tiles on screen are, whatever stands in off screen', async () => {
        const signal: SignalBackend = {
            source: { name: ['test'], signal: () => Promise.reject(new Error('unused')) },
            renderHint: RenderMode.Lines,
            timeRange: [0, 999],
            valueRange: [0, 1],
            live: false,
            tile(level: number, index: number): Promise<Tile> {
                const duration = tileDuration(level);
                // The margins either side of the view below never load
                if (level === -3 && (index === 1 || index === 5)) return new Promise(() => {});
                const time = Float64Array.from({ length: 1000 }, (_, i) => i).filter(t => t >= index * duration && t < (index + 1) * duration);
                return Promise.resolve({
                    time, value: new Float64Array(time.length), changes: new Uint32Array(time.length),
                    samples: level >= 0 ? time.length * 2 : time.length,
                    before: null, after: null,
                });
            },
        };
        const view = lodView(signal);
        // Level 1 holds everything, then level -3, with tiles of 64 seconds: 2 to 4 in view and 1 and 5 its margins
        view.update(0, 999, 1 / 2, Infinity);
        await new Promise(resolve => setTimeout(resolve, 0));
        view.update(128, 256, 8, Infinity);
        await new Promise(resolve => setTimeout(resolve, 0));
        view.update(128, 256, 8, Infinity);
        expect(view.geometry!.blockCount).toBeGreaterThan(0);
        expect(view.geometry!.raw).toBe(true);
    });
});

// Tiles that load or fail when told to, recording what was asked for
function controlledSignal(end: number) {
    const requests: { level: number; index: number; resolve: () => void; reject: (e: Error) => void }[] = [];
    const signal: SignalBackend = {
        source: { name: ['test'], signal: () => Promise.reject(new Error('unused')) },
        renderHint: RenderMode.Lines,
        get timeRange() { return [0, end] as const; },
        valueRange: [0, 1],
        live: true,
        tile(level: number, index: number): Promise<Tile> {
            return new Promise((resolve, reject) => {
                const tile: Tile = {
                    time: new Float64Array(0), value: new Float64Array(0), changes: new Uint32Array(0), samples: 0,
                    before: null, after: { time: end, value: 0 },
                };
                requests.push({ level, index, resolve: () => resolve(tile), reject });
            });
        },
    };
    return { signal, requests };
}

describe('LodView requests', () => {
    const settle = () => new Promise(resolve => setTimeout(resolve, 0));

    it('keeps a few requests in flight, in the order of the tiles in view', () => {
        const { signal, requests } = controlledSignal(1e6);
        const view = lodView(signal);
        // Level 0: tiles -1 to 10, with margins, after the base tile
        view.update(0, 5000, 1, Infinity);
        const atLevel0 = requests.filter(r => r.level === 0).map(r => r.index);
        expect(requests.length).toBe(8);
        expect(atLevel0).toEqual([-1, 0, 1, 2, 3, 4, 5]);

        view.update(0, 5000, 1, Infinity);
        expect(requests.length).toBe(8);
    });

    it('asks again for a tile that failed, after a while', async () => {
        const { signal, requests } = controlledSignal(1000);
        const view = lodView(signal);
        const errors: unknown[] = [];
        const error = console.error;
        console.error = (...args: unknown[]) => errors.push(args);
        try {
            view.update(0, 500, 1, Infinity);
            const first = requests.find(r => r.level === 0 && r.index === 0)!;
            first.reject(new Error('superseded by newer requests'));
            await settle();

            const before = requests.length;
            view.update(0, 500, 1, Infinity);
            expect(requests.length).toBe(before);

            await new Promise(resolve => setTimeout(resolve, 300));
            view.update(0, 500, 1, Infinity);
            expect(requests.slice(before).some(r => r.level === 0 && r.index === 0)).toBe(true);
            expect(errors.length).toBe(1);
        } finally {
            console.error = error;
        }
    });
});

function liveSignal(rate: number) {
    let n = 1000;
    const pending: (() => void)[] = [];
    const tileFor = (level: number, index: number): Tile => {
        const duration = tileDuration(level);
        const column = duration / tileColumns;
        const time: number[] = [];
        let samples = 0;
        for (let c = 0; c < tileColumns; c++) {
            const a = Math.max(0, Math.ceil((index * duration + c * column) * rate));
            const b = Math.min(n, Math.ceil((index * duration + (c + 1) * column) * rate));
            if (b <= a) continue;
            samples += b - a;
            const kept = b - a <= 4 ? Array.from({ length: b - a }, (_, k) => a + k) : [a, b - 1];
            time.push(...kept);
        }
        const first = Math.ceil(index * duration * rate);
        const next = Math.ceil((index + 1) * duration * rate);
        return {
            time: Float64Array.from(time, k => k / rate),
            value: Float64Array.from(time, k => Math.floor(k / 7) % 2),
            changes: new Uint32Array(time.length).fill(1),
            samples,
            before: first > 0 && first - 1 < n ? { time: (first - 1) / rate, value: 0 } : null,
            after: next < n ? { time: next / rate, value: 0 } : null,
        };
    };
    const signal: SignalBackend = {
        source: { name: ['test'], signal: () => Promise.reject(new Error('unused')) },
        renderHint: RenderMode.Lines,
        get timeRange() { return [0, (n - 1) / rate] as const; },
        valueRange: [0, 1],
        live: true,
        tile(level: number, index: number): Promise<Tile> {
            return new Promise(resolve => pending.push(() => resolve(tileFor(level, index))));
        },
    };
    const flush = async () => {
        pending.splice(0).forEach(resolve => resolve());
        await new Promise(resolve => setTimeout(resolve, 0));
    };
    return { signal, flush, grow: (count: number) => { n += count; }, end: () => (n - 1) / rate };
}

describe('LodView live', () => {
    it('keeps up with the end of the data when following it zoomed in', async () => {
        const rate = 1e6;
        const growth = 2000;
        const { signal, flush, grow, end } = liveSignal(rate);
        const view = lodView(signal);
        let lag = 0;
        for (let frame = 0; frame < 80; frame++) {
            if (frame % 4 === 0) grow(growth);
            // Zooms in, passing tiles that go out of date as the data grows
            const pxPerSecond = frame < 20 ? 1e3 * Math.pow(2, frame / 2) : 1e9;
            const e = end();
            view.update(e - 1000 / pxPerSecond, e, pxPerSecond, Infinity);
            const g = view.geometry!;
            if (frame >= 30) lag = Math.max(lag, (e - g.time[g.length - 1]) * rate);
            await flush();
        }
        // No further behind than one growth, before its tiles load
        expect(lag).toBeLessThanOrEqual(growth + 1e-6);
    });
});
