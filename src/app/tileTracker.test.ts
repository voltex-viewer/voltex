import { describe, it, expect } from 'vitest';
import { RenderMode, tileDuration, type Signal, type Tile } from '@voltex-viewer/plugin-api';
import { TileTracker } from './tileTracker';

// Level 0, so each tile is 512 seconds
const level = 0;
const duration = tileDuration(level);

// Data up to `end`. Tiles before the end have something after them, so only the one holding the end may change.
function growingSignal(async = false) {
    let end = 1000;
    const pending: (() => void)[] = [];
    const signal: Signal = {
        source: { name: ['test'], signal: () => Promise.reject(new Error('unused')) },
        renderHint: RenderMode.Lines,
        get timeRange() { return [0, end] as const; },
        valueRange: [0, 1],
        live: true,
        tile(level: number, index: number): Tile | Promise<Tile> {
            const tileEnd = (index + 1) * tileDuration(level);
            const tile: Tile = {
                time: new Float64Array(0),
                value: new Float64Array(0),
                changes: new Uint32Array(0),
                samples: 0,
                before: null,
                after: tileEnd <= end ? { time: tileEnd, value: 0 } : null,
            };
            if (!async) return tile;
            return new Promise(resolve => pending.push(() => resolve(tile)));
        },
    };
    const flush = async () => {
        pending.splice(0).forEach(resolve => resolve());
        await new Promise(resolve => setTimeout(resolve));
    };
    return { signal, grow: (to: number) => { end = to; }, flush };
}

describe('TileTracker', () => {
    it('wraps each signal once, and leaves wrapped signals as they are', () => {
        const tracker = new TileTracker(() => {});
        const { signal } = growingSignal();
        const tracked = tracker.track(signal);
        expect(tracked).not.toBe(signal);
        expect(tracker.track(signal)).toBe(tracked);
        expect(tracker.track(tracked)).toBe(tracked);
        expect(tracked.source).toBe(signal.source);
    });

    it('reads the signal live through the wrapper', () => {
        const tracker = new TileTracker(() => {});
        const { signal, grow } = growingSignal();
        const tracked = tracker.track(signal);
        grow(2000);
        expect(tracked.timeRange).toEqual([0, 2000]);
    });

    it('holds where no tiles have loaded', () => {
        const tracker = new TileTracker(() => {});
        const tracked = tracker.track(growingSignal().signal);
        expect(tracker.readyUntil(tracked, 100, level)).toBe(100);
    });

    it('runs through loaded tiles up to the end of the data', () => {
        const tracker = new TileTracker(() => {});
        const tracked = tracker.track(growingSignal().signal);
        tracked.tile(level, 0);
        tracked.tile(level, 1);
        expect(tracker.readyUntil(tracked, 100, level)).toBe(1000);
    });

    it('stops at a gap', () => {
        const tracker = new TileTracker(() => {});
        const { signal, grow } = growingSignal();
        grow(2000);
        const tracked = tracker.track(signal);
        tracked.tile(level, 0);
        tracked.tile(level, 2);
        expect(tracker.readyUntil(tracked, 100, level)).toBe(duration);
    });

    it('counts a tile that may still change only up to the data it was loaded with', () => {
        const tracker = new TileTracker(() => {});
        const { signal, grow } = growingSignal();
        const tracked = tracker.track(signal);
        tracked.tile(level, 0);
        tracked.tile(level, 1);
        grow(1020);
        expect(tracker.readyUntil(tracked, 1000, level)).toBe(1000);
        tracked.tile(level, 1);
        expect(tracker.readyUntil(tracked, 1000, level)).toBe(1020);
    });

    it('only counts tiles at the level asked for', () => {
        const tracker = new TileTracker(() => {});
        const tracked = tracker.track(growingSignal().signal);
        tracked.tile(level + 1, 0);
        expect(tracker.readyUntil(tracked, 100, level)).toBe(100);
        expect(tracker.readyUntil(tracked, 100, level + 1)).toBe(1000);
    });

    it('records tiles that load later, and says when they do', async () => {
        let loads = 0;
        const tracker = new TileTracker(() => loads++);
        const { signal, flush } = growingSignal(true);
        const tracked = tracker.track(signal);
        tracked.tile(level, 0);
        tracked.tile(level, 1);
        expect(tracker.readyUntil(tracked, 100, level)).toBe(100);
        await flush();
        expect(tracker.readyUntil(tracked, 100, level)).toBe(1000);
        expect(loads).toBe(2);
    });

    it('leaves failed tiles to whoever asked for them', async () => {
        const tracker = new TileTracker(() => {});
        const failing: Signal = {
            ...growingSignal().signal,
            timeRange: [0, 1000],
            tile: () => Promise.reject(new Error('failed')),
        };
        const tracked = tracker.track(failing);
        await expect(tracked.tile(level, 0)).rejects.toThrow('failed');
        expect(tracker.readyUntil(tracked, 100, level)).toBe(100);
    });
});
