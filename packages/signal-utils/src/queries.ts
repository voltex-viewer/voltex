import { tileColumns, tileDuration, type Signal, type Tile, type Sample } from '@voltex-viewer/plugin-api';
import { isRawTile, tileSample } from './tiles';

/** Level of the tiles used to find the samples either side of a time. Each covers about a microsecond. */
export const pointLevel = -29;

export interface Neighbours {
    /** The last sample at or before the time */
    floor: Sample | null;
    /** The first sample after the time */
    next: Sample | null;
}

interface CachedTile {
    tile: Tile | null;
    // The end of the signal when the tile was requested, as a tile with nothing after it may have changed since
    end: number;
    listeners: (() => void)[];
}

const maxCachedTiles = 64;

export function neighboursInTile(tile: Tile, time: number): Neighbours {
    let floor = -1;
    while (floor + 1 < tile.time.length && tile.time[floor + 1] <= time) floor++;
    const next = floor + 1;
    return {
        floor: floor >= 0 ? tileSample(tile, floor) : tile.before,
        next: next < tile.time.length ? tileSample(tile, next) : tile.after,
    };
}

/** Finds the samples either side of a time, keeping the tiles they were found in for the next lookup nearby. */
export class NeighbourCache {
    private readonly caches = new WeakMap<Signal, Map<number, CachedTile>>();

    /**
     * The samples either side of a time, in the signal's own time. Returns null while the tile they are found from
     * is loading, and calls `onLoad` once it has.
     */
    neighboursAt(signal: Signal, time: number, onLoad?: () => void): Neighbours | null {
        let cache = this.caches.get(signal);
        if (!cache) {
            cache = new Map();
            this.caches.set(signal, cache);
        }
        const index = Math.floor(time / tileDuration(pointLevel));
        const end = signal.timeRange[1];
        let entry = cache.get(index);
        if (entry?.tile && entry.tile.after === null && entry.end !== end) {
            entry = undefined;
        }
        if (entry) {
            // Moved to the back, so the least recently used tile is first
            cache.delete(index);
            cache.set(index, entry);
        } else {
            entry = request(signal, cache, index, end);
        }
        if (entry.tile) return neighboursInTile(entry.tile, time);
        if (onLoad && !entry.listeners.includes(onLoad)) entry.listeners.push(onLoad);
        return null;
    }
}

function request(signal: Signal, cache: Map<number, CachedTile>, index: number, end: number): CachedTile {
    const entry: CachedTile = { tile: null, end, listeners: [] };
    cache.set(index, entry);
    if (cache.size > maxCachedTiles) cache.delete(cache.keys().next().value!);
    const result = signal.tile(pointLevel, index);
    if (!(result instanceof Promise)) {
        entry.tile = result;
        return entry;
    }
    result.then(
        tile => {
            entry.tile = tile;
            const listeners = entry.listeners;
            entry.listeners = [];
            for (const listener of listeners) listener();
        },
        (error: unknown) => {
            if (cache.get(index) === entry) cache.delete(index);
            console.error(`Failed to load tile ${pointLevel}:${index}:`, error);
        },
    );
    return entry;
}

export interface SampleChunk {
    time: Float64Array;
    value: Float64Array;
    exact?: BigInt64Array | BigUint64Array | undefined;
}

// Samples sharing a timestamp can't be split by finer tiles, so the search stops somewhere
const minSampleLevel = -60;

/** Every sample in the signal, in order, found by splitting tiles until none drop samples. */
export async function* rawSamples(signal: Signal): AsyncGenerator<SampleChunk> {
    const [start, end] = signal.timeRange;
    if (!(start <= end)) return;
    let level = Math.max(minSampleLevel, Math.ceil(Math.log2(Math.max(end - start, Number.MIN_VALUE) / tileColumns)));
    while (Math.floor(end / tileDuration(level)) - Math.floor(start / tileDuration(level)) > 1) level++;
    for (let index = Math.floor(start / tileDuration(level)); index <= Math.floor(end / tileDuration(level)); index++) {
        yield* rawTileSamples(signal, level, index);
    }
}

async function* rawTileSamples(signal: Signal, level: number, index: number): AsyncGenerator<SampleChunk> {
    const tile = await signal.tile(level, index);
    if (tile.samples === 0) return;
    if (isRawTile(tile) || level <= minSampleLevel) {
        if (!isRawTile(tile)) {
            console.warn(`Dropped ${tile.samples - tile.time.length} samples sharing a timestamp near ${tile.time[0]}`);
        }
        yield { time: tile.time, value: tile.value, exact: tile.exact };
        return;
    }
    yield* rawTileSamples(signal, level - 1, index * 2);
    yield* rawTileSamples(signal, level - 1, index * 2 + 1);
}
