import { tileDuration, type CachedTile, type Signal, type Tile, type Sample } from '@voltex-viewer/plugin-api';

/** Whether every sample in the tile's range is in the tile. */
export function isRawTile(tile: Tile): boolean {
    return tile.samples === tile.time.length;
}

export function tileSample(tile: Tile, i: number): Sample {
    const point: Sample = { time: tile.time[i], value: tile.value[i] };
    if (tile.exact) point.exact = tile.exact[i];
    return point;
}

/** The form of a sample to display, before formatting as hex or decimal. */
export function displayValue(signal: Signal, point: Sample): number | bigint | string {
    const value = point.exact ?? point.value;
    return signal.format ? signal.format(value) : value;
}

/** Level of the tiles drawn at a zoom */
export function lodLevel(pxPerSecond: number): number {
    return Math.floor(Math.log2(1 / pxPerSecond));
}

export function baseLevel(start: number, end: number): number {
    let level = Math.ceil(Math.log2(Math.max(end - start, Number.MIN_VALUE) / tileDuration(0)));
    while (Math.floor(end / tileDuration(level)) - Math.floor(start / tileDuration(level)) > 1) level++;
    return level;
}

export type Cover =
    | { raw: CachedTile; level: number; first: number; last: number }
    | { index: number; coarse: { cached: CachedTile; level: number } | null };

// Either side of a view, for the lines into and out of it
const marginTiles = 1;
// Tiles kept from zooming out further than the base tiles can still cover a view
const coarserLevels = 8;

export function hasDataUntil(cached: CachedTile, time: number, signal: Signal): boolean {
    return cached.completeUntil >= Math.min(time, signal.timeRange[1]);
}

export function coverView(signal: Signal, start: number, end: number, level: number): Cover[] {
    const [dataStart, dataEnd] = signal.timeRange;
    const duration = tileDuration(level);
    const first = Math.floor(start / duration) - marginTiles;
    const last = Math.floor(end / duration) + marginTiles;
    const top = Math.max(level, dataStart <= dataEnd ? baseLevel(dataStart, dataEnd) : level) + coarserLevels;
    const covers: Cover[] = [];
    const visit = (l: number, index: number, coarse: { cached: CachedTile; level: number } | null): void => {
        const scale = Math.pow(2, l - level);
        const from = Math.max(first, index * scale);
        const to = Math.min(last, (index + 1) * scale - 1);
        if (from > to) return;
        if (l === level) {
            covers.push({ index, coarse });
            return;
        }
        const cached = signal.peek(l, index);
        const current = cached !== null && hasDataUntil(cached, (to + 1) * duration, signal);
        // Raw tiles have every sample, so nothing finer is needed
        if (current && isRawTile(cached.tile)) {
            covers.push({ raw: cached, level: l, first: from, last: to });
            return;
        }
        const standIn = current ? { cached, level: l } : coarse;
        visit(l - 1, 2 * index, standIn);
        visit(l - 1, 2 * index + 1, standIn);
    };
    const scale = Math.pow(2, top - level);
    for (let index = Math.floor(first / scale); index <= Math.floor(last / scale); index++) visit(top, index, null);
    return covers;
}
