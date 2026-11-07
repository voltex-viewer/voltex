import { tileDuration, type Sample, type Signal, type Tile } from '@voltex-viewer/plugin-api';
import { baseLevel, coverView, hasDataUntil, isRawTile, lodLevel, tileSample } from '@voltex-viewer/signal-utils';

export interface LodGeometry {
    time: Float64Array;
    value: Float64Array;
    // Value changes since the previous point, NaN where unknown
    changes: Float64Array;
    // Exact values for 64-bit sources, otherwise null
    exact: (bigint | undefined)[] | null;
    length: number;
    // True when every sample in the tiles on screen is a point
    raw: boolean;
    // [startHigh, startLow, endHigh, endLow, min, max] per block
    blocks: Float32Array;
    blockCount: number;
}

interface Piece {
    tile: Tile;
    level: number;
    start: number;
    end: number;
}

const maxFinerLevels = 3;
const maxLoading = 8;

export class LodView {
    private shownPieces: Piece[] = [];
    private readonly loading = new Set<string>();
    private readonly writer = new GeometryWriter();
    geometry: LodGeometry | null = null;

    constructor(private readonly signal: Signal) {}

    update(start: number, end: number, pxPerSecond: number, deadline: number): { changed: boolean; busy: boolean } {
        const signal = this.signal;
        const level = lodLevel(pxPerSecond);
        const duration = tileDuration(level);
        const [dataStart, dataEnd] = signal.timeRange;

        let busy = false;
        const fetch = (level: number, index: number): void => {
            const cached = signal.peek(level, index);
            const key = `${level}:${index}`;
            if ((cached && cached.completeUntil >= dataEnd) || this.loading.has(key)) return;
            if (busy || this.loading.size >= maxLoading || performance.now() >= deadline) {
                busy = true;
                return;
            }
            const result = signal.tile(level, index);
            if (!(result instanceof Promise)) return;
            this.loading.add(key);
            // The signal says when tiles load, and logs failures
            result.catch(() => {}).finally(() => this.loading.delete(key));
        };

        // Kept up to date so there's always a coarser tile to stand in
        if (dataStart <= dataEnd) {
            const base = Math.max(level, baseLevel(dataStart, dataEnd));
            const baseDuration = tileDuration(base);
            for (let index = Math.floor(dataStart / baseDuration); index <= Math.floor(dataEnd / baseDuration); index++) {
                fetch(base, index);
            }
        }

        const pieces: Piece[] = [];
        let complete = true;
        for (const cover of coverView(signal, start, end, level)) {
            if ('raw' in cover) {
                pieces.push({ tile: cover.raw.tile, level: cover.level, start: cover.first * duration, end: (cover.last + 1) * duration });
                continue;
            }
            const { index, coarse } = cover;
            fetch(level, index);
            const tileStart = index * duration;
            const tileEnd = (index + 1) * duration;
            const shown = this.drawable(level, index) ?? this.finer(level, index, maxFinerLevels)
                ?? (coarse ? [{ tile: coarse.cached.tile, level: coarse.level, start: tileStart, end: tileEnd }] : null);
            if (shown) {
                pieces.push(...shown);
            } else if (tileStart < end && tileEnd > start) {
                complete = false;
            }
        }

        if (!complete || samePieces(pieces, this.shownPieces)) {
            return { changed: false, busy };
        }
        this.shownPieces = pieces;
        this.geometry = join(pieces, level, start, end, signal.null, this.writer);
        return { changed: true, busy };
    }

    // An out-of-date tile would leave a gap before newer data, except at the end of the data
    private drawable(level: number, index: number): Piece[] | null {
        const cached = this.signal.peek(level, index);
        const tileEnd = (index + 1) * tileDuration(level);
        if (!cached || !(hasDataUntil(cached, tileEnd, this.signal) || tileEnd > this.signal.timeRange[1])) return null;
        return [{ tile: cached.tile, level, start: index * tileDuration(level), end: tileEnd }];
    }

    private finer(level: number, index: number, depth: number): Piece[] | null {
        if (depth === 0) return null;
        const pieces: Piece[] = [];
        for (const child of [2 * index, 2 * index + 1]) {
            const shown = this.drawable(level - 1, child) ?? this.finer(level - 1, child, depth - 1);
            if (!shown) return null;
            pieces.push(...shown);
        }
        return pieces;
    }
}

function samePieces(a: Piece[], b: Piece[]): boolean {
    return a.length === b.length && a.every((p, i) => p.tile === b[i].tile && p.start === b[i].start && p.end === b[i].end);
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

    points({ tile, start, end }: Piece, knownChanges: boolean): void {
        const { time, value, changes, exact } = tile;
        const from = lowerBound(time, start);
        const to = lowerBound(time, end);
        this.reserve(to - from);
        for (let i = from; i < to; i++) {
            this.write(time[i], value[i], knownChanges || i > from ? changes[i] : NaN, exact?.[i]);
        }
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

function join(pieces: Piece[], level: number, start: number, end: number, nullValue: number | undefined, out: GeometryWriter): LodGeometry {
    out.reset();
    // The lines into and out of the view, which zoomed in far may be all there is to draw
    const before = pieces.length > 0 ? sampleBefore(pieces[0]) : null;
    const after = pieces.length > 0 ? sampleAfter(pieces[pieces.length - 1]) : null;
    if (before) {
        out.point(before, NaN);
    }
    // A piece's first count runs from the last sample before it, which is only the previous point if drawn as points
    let knownChanges = true;
    for (const piece of pieces) {
        // The margins either side are off screen, so don't decide whether what's shown is raw
        if (piece.end > start && piece.start < end) out.raw &&= isRawTile(piece.tile);
        // Coarser than the view, the points of a tile that isn't raw are a summary, so stretched they become blocks
        if (isRawTile(piece.tile) || piece.level <= level) {
            out.points(piece, knownChanges);
            knownChanges = true;
        } else {
            addCoarse(piece, nullValue, out);
            knownChanges = false;
        }
    }
    if (after) {
        // Only just off screen, so a guess is fine
        const previous = out.length > 0 ? out.value[out.length - 1] : NaN;
        out.point(after, after.value !== previous ? 1 : 0);
    }
    return out;
}

function sampleBefore({ tile, start }: Piece): Sample | null {
    const i = lowerBound(tile.time, start) - 1;
    return i >= 0 ? tileSample(tile, i) : tile.before;
}

function sampleAfter({ tile, end }: Piece): Sample | null {
    const i = lowerBound(tile.time, end);
    return i < tile.time.length ? tileSample(tile, i) : tile.after;
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
function addCoarse(piece: Piece, nullValue: number | undefined, out: GeometryWriter): void {
    const { tile: coarse, start, end } = piece;
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
