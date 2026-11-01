import { tileDuration, type Signal, type Tile, type Sample } from '@voltex-viewer/plugin-api';
import { isRawTile, tileSample } from '@voltex-viewer/signal-utils';

interface TileEntry {
    level: number;
    index: number;
    tile: Tile | null;
    // The end of the signal when the tile was requested, as a tile with nothing after it may have changed since
    end: number;
    loading: boolean;
    // The update that last drew or fetched this tile, for least recently used eviction
    usedFrame: number;
}

export interface LodGeometry {
    time: Float64Array;
    value: Float64Array;
    // Value changes since the previous point, NaN where unknown
    changes: Float64Array;
    // Exact values for 64-bit sources, otherwise null
    exact: (bigint | undefined)[] | null;
    length: number;
    // True when every sample in the drawn tiles is a point
    raw: boolean;
    // [startHigh, startLow, endHigh, endLow, min, max] per block
    blocks: Float32Array;
    blockCount: number;
}

type Piece =
    | { tiles: Tile[] }
    | { coarse: Tile; level: number; start: number; end: number };

const marginTiles = 1;
const maxAheadTiles = 256;
const maxFinerLevels = 3;
// Enough to reach the base tiles from the deepest zoom
const maxCoarserLevels = 64;

export function lodLevel(pxPerSecond: number): number {
    return Math.floor(Math.log2(1 / pxPerSecond));
}

// The finest level where the whole signal fits in two tiles
function baseLevel(start: number, end: number): number {
    let level = Math.ceil(Math.log2(Math.max(end - start, Number.MIN_VALUE) / tileDuration(0)));
    while (Math.floor(end / tileDuration(level)) - Math.floor(start / tileDuration(level)) > 1) level++;
    return level;
}

// Missing tiles are stood in for by cached finer tiles, or by a coarser tile drawn as blocks. The base tiles, covering
// the whole signal, are kept up to date and never evicted, so there is always a coarser tile to stand in.
export class LodView {
    private readonly levels = new Map<number, Map<number, TileEntry>>();
    private tileCount = 0;
    private frame = 0;
    private shownPieces: Piece[] = [];
    private seenEnd: number;
    private readonly writer = new GeometryWriter();
    geometry: LodGeometry | null = null;

    constructor(
        private readonly source: Signal,
        private readonly onTileLoaded: () => void,
        private readonly maxTiles = 512,
    ) {
        this.seenEnd = source.timeRange[1];
    }

    // Tiles up to `aheadTo` are fetched but not drawn, for data about to scroll into view
    update(start: number, end: number, pxPerSecond: number, deadline: number, aheadTo = end): { changed: boolean; busy: boolean } {
        const level = lodLevel(pxPerSecond);
        const duration = tileDuration(level);
        const first = Math.floor(start / duration) - marginTiles;
        const last = Math.floor(end / duration) + marginTiles;
        const ahead = Math.min(Math.floor(aheadTo / duration), last + maxAheadTiles);
        const [dataStart, dataEnd] = this.source.timeRange;
        this.frame++;

        let busy = false;
        const fetch = (level: number, index: number): void => {
            const entry = this.entry(level, index);
            if (entry) entry.usedFrame = this.frame;
            const stale = entry !== undefined && !entry.loading && entry.end !== dataEnd && !complete(entry);
            if (entry === undefined || stale) {
                if (!busy && performance.now() < deadline) {
                    this.request(level, index, entry);
                } else {
                    busy = true;
                }
            }
        };

        if (dataStart <= dataEnd) {
            const base = Math.max(level, baseLevel(dataStart, dataEnd));
            const baseDuration = tileDuration(base);
            for (let index = Math.floor(dataStart / baseDuration); index <= Math.floor(dataEnd / baseDuration); index++) {
                fetch(base, index);
            }
        }

        const pieces: Piece[] = [];
        let missing = false;
        for (let index = first; index <= last; index++) {
            fetch(level, index);
            const tile = this.cached(level, index);
            const piece: Piece | null = tile ? { tiles: [tile] } : this.standIn(level, index);
            if (piece) {
                pieces.push(piece);
            } else if (index >= first + marginTiles && index <= last - marginTiles) {
                missing = true;
            }
        }
        for (let index = last + 1; index <= ahead; index++) {
            fetch(level, index);
        }

        this.evict();
        if (dataEnd !== this.seenEnd) {
            this.seenEnd = dataEnd;
            // Stale tiles coming back into view would be drawn next to fresh ones, leaving gaps
            for (const entry of this.entries()) {
                if (entry.usedFrame !== this.frame && !complete(entry)) this.remove(entry);
            }
        }

        if (missing || samePieces(pieces, this.shownPieces)) {
            return { changed: false, busy };
        }
        this.shownPieces = pieces;
        this.geometry = join(pieces, this.source.null, this.writer);
        return { changed: true, busy };
    }

    private standIn(level: number, index: number): Piece | null {
        for (let d = 1; d <= maxFinerLevels; d++) {
            const count = Math.pow(2, d);
            const tiles: Tile[] = [];
            for (let i = index * count; i < (index + 1) * count; i++) {
                const tile = this.cached(level - d, i);
                if (!tile) break;
                tiles.push(tile);
            }
            if (tiles.length === count) {
                for (let i = index * count; i < (index + 1) * count; i++) this.entry(level - d, i)!.usedFrame = this.frame;
                return { tiles };
            }
        }
        const duration = tileDuration(level);
        for (let d = 1; d <= maxCoarserLevels; d++) {
            const coarseIndex = Math.floor(index / Math.pow(2, d));
            const coarse = this.cached(level + d, coarseIndex);
            if (coarse) {
                this.entry(level + d, coarseIndex)!.usedFrame = this.frame;
                return { coarse, level: level + d, start: index * duration, end: (index + 1) * duration };
            }
        }
        return null;
    }

    private entry(level: number, index: number): TileEntry | undefined {
        return this.levels.get(level)?.get(index);
    }

    private cached(level: number, index: number): Tile | null {
        return this.entry(level, index)?.tile ?? null;
    }

    private *entries(): Generator<TileEntry> {
        for (const tiles of this.levels.values()) yield* tiles.values();
    }

    private remove(entry: TileEntry): void {
        const tiles = this.levels.get(entry.level);
        if (!tiles?.delete(entry.index)) return;
        this.tileCount--;
        if (tiles.size === 0) this.levels.delete(entry.level);
    }

    private request(level: number, index: number, existing: TileEntry | undefined): void {
        let entry = existing;
        if (!entry) {
            entry = { level, index, tile: null, end: 0, loading: false, usedFrame: this.frame };
            let tiles = this.levels.get(level);
            if (!tiles) {
                tiles = new Map();
                this.levels.set(level, tiles);
            }
            tiles.set(index, entry);
            this.tileCount++;
        }
        entry.end = this.source.timeRange[1];
        const result = this.source.tile(level, index);
        if (!(result instanceof Promise)) {
            entry.tile = result;
            return;
        }
        entry.loading = true;
        const loading = entry;
        result.then(
            tile => {
                loading.loading = false;
                loading.tile = tile;
                this.onTileLoaded();
            },
            (error: unknown) => {
                loading.loading = false;
                console.error(`Failed to load tile ${level}:${index}:`, error);
            },
        );
    }

    private evict(): void {
        if (this.tileCount <= this.maxTiles) return;
        const unused = [...this.entries()].filter(entry => entry.usedFrame !== this.frame);
        unused.sort((a, b) => a.usedFrame - b.usedFrame);
        for (const entry of unused) {
            if (this.tileCount <= this.maxTiles) break;
            this.remove(entry);
        }
    }
}

// Nothing can be appended inside a tile once there is a sample after it
function complete(entry: TileEntry): boolean {
    return entry.tile !== null && entry.tile.after !== null;
}

function samePieces(a: Piece[], b: Piece[]): boolean {
    return a.length === b.length && a.every((p, i) => {
        const q = b[i];
        if ('tiles' in p) {
            return 'tiles' in q && p.tiles.length === q.tiles.length && p.tiles.every((t, k) => t === q.tiles[k]);
        }
        return 'coarse' in q && p.coarse === q.coarse && p.start === q.start;
    });
}

function grow<T extends Float32Array | Float64Array>(array: T, length: number): T {
    const grown = new (array.constructor as { new(n: number): T })(length);
    grown.set(array);
    return grown;
}

// Reused between joins, so the arrays only grow
class GeometryWriter implements LodGeometry {
    time = new Float64Array(1024);
    value = new Float64Array(1024);
    changes = new Float64Array(1024);
    exact: (bigint | undefined)[] | null = null;
    length = 0;
    raw = true;
    blocks = new Float32Array(6 * 64);
    blockCount = 0;

    reset(): void {
        this.length = 0;
        this.exact = null;
        this.raw = true;
        this.blockCount = 0;
    }

    points(tile: Tile, knownChanges: boolean): void {
        const { time, value, changes, exact } = tile;
        this.reserve(time.length);
        for (let i = 0; i < time.length; i++) {
            this.write(time[i], value[i], knownChanges || i > 0 ? changes[i] : NaN, exact?.[i]);
        }
        this.raw &&= isRawTile(tile);
    }

    point(point: Sample, changes: number): void {
        this.reserve(1);
        this.write(point.time, point.value, changes, point.exact);
    }

    block(start: number, end: number, min: number, max: number): void {
        const offset = this.blockCount * 6;
        if (offset + 6 > this.blocks.length) this.blocks = grow(this.blocks, this.blocks.length * 2);
        const startHigh = Math.fround(start);
        const endHigh = Math.fround(end);
        this.blocks[offset] = startHigh;
        this.blocks[offset + 1] = start - startHigh;
        this.blocks[offset + 2] = endHigh;
        this.blocks[offset + 3] = end - endHigh;
        this.blocks[offset + 4] = min;
        this.blocks[offset + 5] = max;
        this.blockCount++;
    }

    private reserve(count: number): void {
        const needed = this.length + count;
        if (needed <= this.value.length) return;
        const capacity = Math.max(needed, this.value.length * 2);
        this.time = grow(this.time, capacity);
        this.value = grow(this.value, capacity);
        this.changes = grow(this.changes, capacity);
    }

    private write(time: number, value: number, changes: number, exact: bigint | undefined): void {
        this.time[this.length] = time;
        this.value[this.length] = value;
        this.changes[this.length] = changes;
        if (exact !== undefined && this.exact === null) this.exact = new Array<bigint | undefined>(this.length).fill(undefined);
        this.exact?.push(exact);
        this.length++;
    }
}

function join(pieces: Piece[], nullValue: number | undefined, out: GeometryWriter): LodGeometry {
    out.reset();
    const firstPiece = pieces[0];
    const firstTile = firstPiece && 'tiles' in firstPiece ? firstPiece.tiles[0] : null;
    const lastPiece = pieces[pieces.length - 1];
    const lastTile = lastPiece && 'tiles' in lastPiece ? lastPiece.tiles[lastPiece.tiles.length - 1] : null;
    // The lines into and out of the view, which zoomed in far may be all there is to draw
    const before = firstTile ? firstTile.before : firstPiece ? coarseBefore(firstPiece as CoarsePiece) : null;
    const after = lastTile ? lastTile.after : lastPiece ? coarseAfter(lastPiece as CoarsePiece) : null;
    if (before) {
        out.point(before, NaN);
    }
    // A tile's first count runs from the last sample before it, which is only the previous point if a tile drew it
    let knownChanges = firstTile !== null;
    for (const piece of pieces) {
        if ('tiles' in piece) {
            for (const tile of piece.tiles) {
                out.points(tile, knownChanges);
                knownChanges = true;
            }
        } else {
            addCoarse(piece, nullValue, out);
            knownChanges = false;
            out.raw = false;
        }
    }
    if (after) {
        // Only just off screen, so a guess is fine
        const previous = out.length > 0 ? out.value[out.length - 1] : NaN;
        out.point(after, after.value !== previous ? 1 : 0);
    }
    return out;
}

type CoarsePiece = Extract<Piece, { coarse: Tile }>;

// The coarse tile's nearest point before the piece, which stands in for the sample before it
function coarseBefore({ coarse, start }: CoarsePiece): Sample | null {
    const i = lowerBound(coarse.time, start) - 1;
    return i >= 0 ? tileSample(coarse, i) : coarse.before;
}

function coarseAfter({ coarse, end }: CoarsePiece): Sample | null {
    const i = lowerBound(coarse.time, end);
    return i < coarse.time.length ? tileSample(coarse, i) : coarse.after;
}

function lowerBound(time: Float64Array, t: number): number {
    let lo = 0;
    let hi = time.length;
    while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (time[mid] < t) lo = mid + 1;
        else hi = mid;
    }
    return lo;
}

// A column with several points was drawn as a vertical stroke, so stretched it becomes a block spanning its
// points and the lines into it from adjacent columns
function addCoarse(piece: CoarsePiece, nullValue: number | undefined, out: GeometryWriter): void {
    const { coarse, start, end } = piece;
    const width = Math.pow(2, piece.level);

    const columns: { column: number; first: number; last: number }[] = [];
    for (let i = 0; i < coarse.time.length; i++) {
        const column = Math.floor(coarse.time[i] / width);
        const previous = columns[columns.length - 1];
        if (previous?.column === column) previous.last = i + 1;
        else columns.push({ column, first: i, last: i + 1 });
    }

    const addPoint = (i: number) => {
        if (coarse.time[i] >= start && coarse.time[i] < end) {
            out.point({ time: coarse.time[i], value: coarse.value[i], exact: coarse.exact?.[i] }, NaN);
        }
    };
    columns.forEach(({ column, first, last }, c) => {
        const blockStart = Math.max(start, column * width);
        const blockEnd = Math.min(end, (column + 1) * width);
        if (blockStart >= blockEnd) return;

        addPoint(first);
        if (last - first === 1) return;

        const values = Array.from(coarse.value.subarray(first, last));
        if (columns[c - 1]?.column === column - 1) values.push(coarse.value[columns[c - 1].last - 1]);
        if (columns[c + 1]?.column === column + 1) values.push(coarse.value[columns[c + 1].first]);
        const drawn = values.filter(v => v !== nullValue);
        if (drawn.length > 0) {
            out.block(blockStart, blockEnd, Math.min(...drawn), Math.max(...drawn));
        }
        addPoint(last - 1);
    });
}
