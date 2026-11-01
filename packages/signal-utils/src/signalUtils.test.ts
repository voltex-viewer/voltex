import { describe, it, expect } from 'vitest';
import { RenderMode, tileColumns, type Signal, type Tile, type Sample } from '@voltex-viewer/plugin-api';
import type { Sequence } from './sequences';
import { NeighbourCache, rawSamples } from './queries';
import { InMemoryBigUint64Sequence } from './sequences';
import { SequenceSignal } from './sequenceSignal';
import { SequenceTiles } from './sequenceTiles';

function seededRandom(seed: number) {
    let state = seed;
    return () => {
        state = (state * 1664525 + 1013904223) % 4294967296;
        return state / 4294967296;
    };
}

function sequence(data: number[], nullValue?: number): Sequence {
    const seq: Sequence = {
        min: Math.min(...data),
        max: Math.max(...data),
        get length() { return data.length; },
        valueAt: (i: number) => data[i],
    };
    if (nullValue !== undefined) seq.null = nullValue;
    return seq;
}

function lastIndex(time: number[], predicate: (t: number) => boolean): number {
    for (let i = time.length - 1; i >= 0; i--) {
        if (predicate(time[i])) return i;
    }
    return -1;
}

function referenceTile(time: number[], values: number[], level: number, index: number, nullValue?: number): Tile {
    const width = Math.pow(2, level);
    const firstColumn = index * tileColumns;
    const out = { time: [] as number[], value: [] as number[], changes: [] as number[] };
    const tileStart = firstColumn * width;
    const tileEnd = (firstColumn + tileColumns) * width;
    let previous = lastIndex(time, t => t < tileStart);
    const emit = (i: number) => {
        let changes = 0;
        for (let k = previous + 1; previous >= 0 && k <= i; k++) {
            if (values[k] !== values[k - 1]) changes++;
        }
        out.time.push(time[i]);
        out.value.push(values[i]);
        out.changes.push(changes);
        previous = i;
    };

    const columns = new Map<number, number[]>();
    let samples = 0;
    time.forEach((t, i) => {
        if (t < tileStart || t >= tileEnd) return;
        samples++;
        const c = Math.floor(t / width) - firstColumn;
        columns.set(c, [...(columns.get(c) ?? []), i]);
    });
    for (let c = 0; c < tileColumns; c++) {
        const idx = columns.get(c);
        if (!idx) continue;
        if (idx.length <= 4) {
            idx.forEach(emit);
            continue;
        }
        let minI = -1, maxI = -1, nullI = -1;
        for (const i of idx) {
            const v = values[i];
            if (v === nullValue) { if (nullI < 0) nullI = i; continue; }
            if (Number.isNaN(v)) continue;
            if (minI < 0 || v < values[minI]) minI = i;
            if (maxI < 0 || v > values[maxI]) maxI = i;
        }
        const extremes = minI >= 0 ? [minI, maxI] : [];
        const nulls = nullI >= 0 ? [nullI] : [];
        [...new Set([idx[0], idx[idx.length - 1], ...extremes, ...nulls])].sort((x, y) => x - y).forEach(emit);
    }

    const point = (i: number): Sample | null => i >= 0 ? { time: time[i], value: values[i] } : null;
    return {
        time: Float64Array.from(out.time),
        value: Float64Array.from(out.value),
        changes: Uint32Array.from(out.changes),
        samples,
        before: point(lastIndex(time, t => t < tileStart)),
        after: point(time.findIndex(t => t >= tileEnd)),
    };
}

function expectTileToMatch(actual: Tile, expected: Tile) {
    expect(Array.from(actual.time)).toEqual(Array.from(expected.time));
    expect(Array.from(actual.value)).toEqual(Array.from(expected.value));
    expect(Array.from(actual.changes)).toEqual(Array.from(expected.changes));
    expect(actual.samples).toBe(expected.samples);
    expect(actual.before).toEqual(expected.before);
    expect(actual.after).toEqual(expected.after);
}

function indexedTiles(time: number[], values: number[], nullValue?: number): SequenceTiles {
    const tiles = new SequenceTiles(sequence(time), sequence(values, nullValue));
    tiles.update(Infinity);
    return tiles;
}

function syncTile(tiles: SequenceTiles, level: number, index: number): Tile {
    const tile = tiles.tile(level, index);
    if (tile instanceof Promise) throw new Error('Expected the tile to be ready');
    return tile;
}

describe('SequenceTiles', () => {
    const random = seededRandom(1);

    const uniformTime = Array.from({ length: 20000 }, (_, i) => i * 1e-3);
    const irregularTime: number[] = [];
    for (let t = 0; irregularTime.length < 20000;) {
        irregularTime.push(t);
        t += random() < 0.01 ? random() * 0.5 : random() * 1e-4;
    }
    const noise = uniformTime.map(() => random() * 2 - 1);

    const cases: [string, number[], number[], number?][] = [
        ['uniform noise', uniformTime, noise],
        ['irregular noise', irregularTime, noise],
        ['digital', uniformTime, uniformTime.map(() => (random() < 0.5 ? 0 : 1))],
        ['enum', irregularTime, irregularTime.map((_, i) => Math.floor(i / 37) % 5)],
        ['flat', uniformTime, uniformTime.map(() => 3)],
        ['with nulls', irregularTime, noise.map((v, i) => (i % 700 < 50 ? 999 : v)), 999],
        ['with NaN', uniformTime, noise.map((v, i) => (i % 300 === 7 ? NaN : v))],
    ];

    for (const [name, time, values, nullValue] of cases) {
        it(`matches a brute-force M4 for ${name}`, () => {
            const tiles = indexedTiles(time, values, nullValue);
            const end = time[time.length - 1];
            for (const level of [-16, -13, -10, -8, -4]) {
                const lastTile = Math.floor(end / (tileColumns * Math.pow(2, level)));
                for (const index of new Set([0, 1, Math.floor(lastTile / 2), lastTile, lastTile + 1])) {
                    expectTileToMatch(syncTile(tiles, level, index), referenceTile(time, values, level, index, nullValue));
                }
            }
        });
    }

    it('resolves tiles over samples not indexed yet once they are', async () => {
        const tiles = new SequenceTiles(sequence(uniformTime), sequence(noise));
        const pending = tiles.tile(-4, 0);
        expect(pending).toBeInstanceOf(Promise);
        expectTileToMatch(await pending, referenceTile(uniformTime, noise, -4, 0));
    });

    it('keeps 64-bit values exact', () => {
        const values = new InMemoryBigUint64Sequence();
        const big = [2n ** 64n - 1n, 2n ** 63n + 1n, 2n ** 53n + 1n, 5n];
        values.push(...big);
        const tiles = new SequenceTiles(sequence([0, 1, 2, 3]), values);
        tiles.update(Infinity);
        const tile = syncTile(tiles, 0, 0);
        expect(Array.from(tile.exact!)).toEqual(big);
        expect(syncTile(tiles, -10, 1).before).toEqual({ time: 0, value: Number(big[0]), exact: big[0] });
    });
});

function signal(time: number[], values: number[]): Signal {
    const s = new SequenceSignal(null!, sequence(time), sequence(values), RenderMode.Lines);
    s.tile(0, 0);
    return s;
}

async function indexed(s: Signal): Promise<Signal> {
    const [start, end] = s.timeRange;
    await s.tile(-40, Math.floor(end / (tileColumns * Math.pow(2, -40))));
    expect(start).toBeLessThanOrEqual(end);
    return s;
}

describe('NeighbourCache', () => {
    const time = [0, 0.5, 0.5000001, 2, 1e3];
    const values = [1, 2, 3, 4, 5];

    it('finds the samples either side of a time', async () => {
        const s = await indexed(signal(time, values));
        const neighbours = new NeighbourCache();
        expect(neighbours.neighboursAt(s, 0.25)).toEqual({ floor: { time: 0, value: 1 }, next: { time: 0.5, value: 2 } });
        expect(neighbours.neighboursAt(s, 0.5)).toEqual({ floor: { time: 0.5, value: 2 }, next: { time: 0.5000001, value: 3 } });
        expect(neighbours.neighboursAt(s, 500)).toEqual({ floor: { time: 2, value: 4 }, next: { time: 1e3, value: 5 } });
        expect(neighbours.neighboursAt(s, -1)).toEqual({ floor: null, next: { time: 0, value: 1 } });
        expect(neighbours.neighboursAt(s, 2e3)).toEqual({ floor: { time: 1e3, value: 5 }, next: null });
    });

    it('waits for tiles that are loading', async () => {
        const inner = await indexed(signal(time, values));
        const delayed: Signal = {
            ...inner,
            timeRange: inner.timeRange,
            valueRange: inner.valueRange,
            tile: (level, index) => Promise.resolve(inner.tile(level, index)),
        };
        const neighbours = new NeighbourCache();
        let loaded = false;
        expect(neighbours.neighboursAt(delayed, 1, () => { loaded = true; })).toBeNull();
        await Promise.resolve();
        await Promise.resolve();
        expect(loaded).toBe(true);
        expect(neighbours.neighboursAt(delayed, 1)?.floor?.value).toBe(3);
    });
});

describe('rawSamples', () => {
    it('returns every sample in order', async () => {
        const random = seededRandom(3);
        const time: number[] = [];
        for (let t = -5; time.length < 30000;) {
            time.push(t);
            t += random() < 0.001 ? random() * 50 : random() * 1e-5;
        }
        const values = time.map(() => random());
        const s = await indexed(signal(time, values));
        const outTime: number[] = [];
        const outValue: number[] = [];
        for await (const chunk of rawSamples(s)) {
            outTime.push(...chunk.time);
            outValue.push(...chunk.value);
        }
        expect(outTime).toEqual(time);
        expect(outValue).toEqual(values);
    });
});
