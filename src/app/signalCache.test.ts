import { describe, it, expect } from 'vitest';
import { RenderMode, tileDuration, type SignalBackend, type SignalSource, type Tile } from '@voltex-viewer/plugin-api';
import { coverView } from '@voltex-viewer/signal-utils';
import { SignalCache } from './signalCache';

function growingSignal(raw = false) {
    let end = 1000;
    const requests: string[] = [];
    const pending: (() => void)[] = [];
    const source: SignalSource<SignalBackend> = { name: ['test'], signal: () => Promise.resolve(backend) };
    const backend: SignalBackend = {
        source,
        renderHint: RenderMode.Lines,
        get timeRange() { return [0, end] as const; },
        valueRange: [0, 1],
        live: true,
        tile(level: number, index: number): Promise<Tile> {
            requests.push(`${level}:${index}`);
            const duration = tileDuration(level);
            return new Promise(resolve => pending.push(() => {
                const time: number[] = [];
                for (let t = Math.max(0, Math.ceil(index * duration)); t < (index + 1) * duration && t <= end; t++) time.push(t);
                const after = Math.ceil((index + 1) * duration);
                resolve({
                    time: Float64Array.from(time),
                    value: new Float64Array(time.length),
                    changes: new Uint32Array(time.length),
                    samples: raw ? time.length : time.length * 2,
                    before: null,
                    after: after <= end ? { time: after, value: 0 } : null,
                });
            }));
        },
    };
    const flush = async () => {
        pending.splice(0).forEach(resolve => resolve());
        await new Promise(resolve => setTimeout(resolve, 0));
    };
    return { backend, source, requests, flush, grow: (to: number) => { end = to; } };
}

describe('SignalCache', () => {
    it('wraps each backend and source once, and leaves wrappers as they are', async () => {
        const cache = new SignalCache(() => {});
        const { backend, source } = growingSignal();
        const signal = cache.signal(backend);
        expect(cache.signal(backend)).toBe(signal);
        expect(cache.signal(signal)).toBe(signal);
        expect(signal.timeRange).toEqual([0, 1000]);
        expect(signal.source).toBe(cache.source(source));
        expect(await signal.source.signal()).toBe(signal);
    });

    it('shares requests, and gives loaded tiles straight back while they are up to date', async () => {
        let loads = 0;
        const cache = new SignalCache(() => loads++);
        const { backend, requests, flush, grow } = growingSignal();
        const signal = cache.signal(backend);
        const first = signal.tile(0, 1);
        expect(signal.tile(0, 1)).toBe(first);
        await flush();
        expect(loads).toBe(1);
        expect(signal.tile(0, 1)).toBe(await first);
        expect(requests).toEqual(['0:1']);

        // Tile 1 runs to 1024 and has nothing after it, so it's fetched again once the data grows
        grow(1100);
        expect(signal.tile(0, 1)).toBeInstanceOf(Promise);
        expect(requests).toEqual(['0:1', '0:1']);
    });

    it('peeks without fetching, at tiles however out of date', async () => {
        const cache = new SignalCache(() => {});
        const { backend, requests, flush, grow } = growingSignal();
        const signal = cache.signal(backend);
        expect(signal.peek(0, 1)).toBe(null);
        expect(requests).toEqual([]);
        void signal.tile(0, 1);
        await flush();
        grow(1100);
        expect(signal.peek(0, 1)?.completeUntil).toBe(1000);
        expect(signal.peek(0, 0)?.completeUntil).toBe(undefined);
        void signal.tile(0, 0);
        await flush();
        // Tile 0 has data after it, so can't change
        expect(signal.peek(0, 0)?.completeUntil).toBe(Infinity);
    });

    it('waits a while before asking again for a tile that failed', async () => {
        const cache = new SignalCache(() => {});
        let calls = 0;
        const failing: SignalBackend = {
            ...growingSignal().backend,
            timeRange: [0, 1000],
            tile: () => { calls++; return Promise.reject(new Error('failed')); },
        };
        const signal = cache.signal(failing);
        const error = console.error;
        const errors: unknown[] = [];
        console.error = (...args: unknown[]) => errors.push(args);
        try {
            await expect(signal.tile(0, 0)).rejects.toThrow('failed');
            await expect(signal.tile(0, 0)).rejects.toThrow('failed');
            expect(calls).toBe(1);
            await new Promise(resolve => setTimeout(resolve, 300));
            await expect(signal.tile(0, 0)).rejects.toThrow('failed');
            expect(calls).toBe(2);
            expect(errors.length).toBe(1);
        } finally {
            console.error = error;
        }
    });
});

describe('coverView', () => {
    it('stops at a raw tile up to date with the data it covers, so nothing finer is needed', async () => {
        const cache = new SignalCache(() => {});
        const { backend, flush } = growingSignal(true);
        const signal = cache.signal(backend);
        void signal.tile(2, 0);
        await flush();
        const covers = coverView(signal, 500, 501, -9);
        expect(covers.every(c => 'raw' in c && c.level === 2)).toBe(true);
    });

    it('leaves out of date tiles out, as raw tiles or stand-ins', async () => {
        const cache = new SignalCache(() => {});
        const { backend, flush, grow } = growingSignal(true);
        const signal = cache.signal(backend);
        void signal.tile(2, 0);
        await flush();
        grow(1100);
        // The tile has data up to 1000, so covers a view before then but not one after
        expect(coverView(signal, 500, 501, -9).every(c => 'raw' in c)).toBe(true);
        const after = coverView(signal, 1050, 1051, -9);
        expect(after.every(c => 'index' in c && c.coarse === null)).toBe(true);
    });
});
