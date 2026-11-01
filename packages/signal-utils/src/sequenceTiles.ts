import { tileColumns, tileDuration, type Tile, type Sample } from '@voltex-viewer/plugin-api';
import type { Sequence } from './sequences';

// Smaller buckets are faster to query but use more memory
const bucketSize = 32;
const fanout = 4;
const maxRawColumnSamples = 4;
const indexChunk = 4096;
const noIndex = -1;

class Summary {
    minIndex = noIndex;
    maxIndex = noIndex;
    min = Infinity;
    max = -Infinity;
    // The first null sample, so a line can break at it
    nullIndex = noIndex;

    reset(): void {
        this.minIndex = noIndex;
        this.maxIndex = noIndex;
        this.min = Infinity;
        this.max = -Infinity;
        this.nullIndex = noIndex;
    }

    addExtremes(minIndex: number, min: number, maxIndex: number, max: number): void {
        if (minIndex !== noIndex && (min < this.min || (min === this.min && minIndex < this.minIndex))) {
            this.min = min;
            this.minIndex = minIndex;
        }
        if (maxIndex !== noIndex && (max > this.max || (max === this.max && maxIndex < this.maxIndex))) {
            this.max = max;
            this.maxIndex = maxIndex;
        }
    }

    addNull(index: number): void {
        if (index !== noIndex && (this.nullIndex === noIndex || index < this.nullIndex)) this.nullIndex = index;
    }
}

class Level {
    minIndex = new Float64Array(64);
    maxIndex = new Float64Array(64);
    min = new Float64Array(64);
    max = new Float64Array(64);
    nullIndex = new Float64Array(64);
    length = 0;

    push(s: Summary): void {
        if (this.length === this.min.length) {
            const grow = (a: Float64Array): Float64Array<ArrayBuffer> => {
                const b = new Float64Array(a.length * 2);
                b.set(a);
                return b;
            };
            this.minIndex = grow(this.minIndex);
            this.maxIndex = grow(this.maxIndex);
            this.min = grow(this.min);
            this.max = grow(this.max);
            this.nullIndex = grow(this.nullIndex);
        }
        const i = this.length++;
        this.minIndex[i] = s.minIndex;
        this.maxIndex[i] = s.maxIndex;
        this.min[i] = s.min;
        this.max[i] = s.max;
        this.nullIndex[i] = s.nullIndex;
    }

    mergeInto(i: number, s: Summary): void {
        s.addExtremes(this.minIndex[i], this.min[i], this.maxIndex[i], this.max[i]);
        s.addNull(this.nullIndex[i]);
    }
}

class PointWriter {
    time = new Float64Array(256);
    value = new Float64Array(256);
    changes = new Uint32Array(256);
    exact: bigint[] | null;
    length = 0;
    // Sample index of the last point written, which `changes` counts from
    previous = noIndex;

    constructor(exact: boolean) {
        this.exact = exact ? [] : null;
    }

    push(time: number, value: number, changes: number, exact: bigint | undefined): void {
        if (this.length === this.time.length) {
            const time = new Float64Array(this.length * 2);
            const value = new Float64Array(this.length * 2);
            const changes = new Uint32Array(this.length * 2);
            time.set(this.time);
            value.set(this.value);
            changes.set(this.changes);
            this.time = time;
            this.value = value;
            this.changes = changes;
        }
        this.time[this.length] = time;
        this.value[this.length] = value;
        this.changes[this.length] = changes;
        if (this.exact && exact !== undefined) this.exact.push(exact);
        this.length++;
    }
}

// A signed source can't hold values above 2^63, and an unsigned one has no negative values, so one of these fits
function exactArray(values: bigint[]): BigInt64Array | BigUint64Array {
    return values.some(v => v < 0n) ? BigInt64Array.from(values) : BigUint64Array.from(values);
}

interface Waiter {
    end: number;
    resolve: () => void;
}

// Indexing runs in short slices of idle time, so a large file doesn't hold up drawing. Idle callbacks are shared out
// by the browser, so sources from separate copies of this package take turns rather than each taking a slice.
const sliceMs = 8;
// Indexing still makes progress when the page is never idle
const idleTimeoutMs = 100;

function whenIdle(callback: (ms: number) => void): void {
    if (typeof requestIdleCallback === 'function') {
        requestIdleCallback(
            deadline => callback(deadline.didTimeout ? sliceMs : Math.min(sliceMs, deadline.timeRemaining())),
            { timeout: idleTimeoutMs },
        );
    } else {
        setTimeout(() => callback(sliceMs), 0);
    }
}

/**
 * Builds tiles from a min/max pyramid over samples held in memory. Assumes time is sorted and the samples only
 * grow. Samples are indexed in the background, and tiles over samples not indexed yet resolve once they are.
 */
export class SequenceTiles {
    private indexed = 0;
    private readonly levels: Level[] = [new Level()];
    private readonly pending = new Summary();
    private readonly scratch = new Summary();
    // Value changes up to the start of each bucket, so changes between any two samples are found in one bucket scan
    private bucketChanges = new Float64Array(64);
    private changeCount = 0;
    private waiters: Waiter[] = [];
    private scheduled = false;

    constructor(private readonly time: Sequence, private readonly values: Sequence) {}

    get length(): number {
        return Math.min(this.time.length, this.values.length);
    }

    tile(level: number, index: number): Tile | Promise<Tile> {
        const end = (index + 1) * tileDuration(level);
        if (this.ready(end)) return this.build(level, index);
        this.schedule();
        return new Promise(resolve => {
            this.waiters.push({ end, resolve: () => resolve(this.build(level, index)) });
        });
    }

    private schedule(): void {
        if (this.scheduled) return;
        this.scheduled = true;
        whenIdle(ms => {
            this.scheduled = false;
            if (this.update(performance.now() + ms)) this.schedule();
        });
    }

    // A tile can be built once a sample after it is indexed, or every sample is
    private ready(end: number): boolean {
        return this.indexed >= this.length || (this.indexed > 0 && this.time.valueAt(this.indexed - 1) >= end);
    }

    /** Indexes samples until the deadline. Returns whether there are more to index. */
    update(deadline: number): boolean {
        const n = this.length;
        let i = this.indexed;
        while (i < n) {
            const end = Math.min(n, i + indexChunk);
            while (i < end) {
                const bucketEnd = Math.min(end, (Math.floor(i / bucketSize) + 1) * bucketSize);
                this.countChanges(i, bucketEnd);
                this.addSamples(i, bucketEnd, this.pending);
                i = bucketEnd;
                if (i % bucketSize === 0) {
                    this.pushBucket(0, this.pending);
                    this.pending.reset();
                }
            }
            if (performance.now() >= deadline) break;
        }
        this.indexed = i;
        if (this.waiters.length > 0) {
            const waiting = this.waiters;
            this.waiters = [];
            for (const waiter of waiting) {
                if (this.ready(waiter.end)) waiter.resolve();
                else this.waiters.push(waiter);
            }
        }
        return i < this.length;
    }

    private pushBucket(level: number, s: Summary): void {
        const nodes = this.levels[level];
        nodes.push(s);
        if (nodes.length % fanout !== 0) return;
        const parent = new Summary();
        for (let i = nodes.length - fanout; i < nodes.length; i++) {
            nodes.mergeInto(i, parent);
        }
        if (level + 1 === this.levels.length) this.levels.push(new Level());
        this.pushBucket(level + 1, parent);
    }

    private build(level: number, index: number): Tile {
        const n = this.indexed;
        const width = Math.pow(2, level);
        const firstColumn = index * tileColumns;
        const out = new PointWriter(this.values.exactAt !== undefined);

        const first = this.lowerBound(firstColumn * width, 0, n);
        out.previous = first > 0 ? first - 1 : noIndex;
        let a = first;
        for (let c = 1; c <= tileColumns; c++) {
            const b = this.lowerBound((firstColumn + c) * width, a, n);
            if (b > a) this.emitColumn(a, b, out);
            a = b;
        }

        const tile: Tile = {
            time: out.time.slice(0, out.length),
            value: out.value.slice(0, out.length),
            changes: out.changes.slice(0, out.length),
            samples: a - first,
            before: first > 0 ? this.point(first - 1) : null,
            after: a < n ? this.point(a) : null,
        };
        if (out.exact) tile.exact = exactArray(out.exact);
        return tile;
    }

    private point(i: number): Sample {
        const point: Sample = { time: this.time.valueAt(i), value: this.values.valueAt(i) };
        if (this.values.exactAt) point.exact = this.values.exactAt(i);
        return point;
    }

    // Gallops from lo, as successive columns are close
    private lowerBound(t: number, lo: number, hi: number): number {
        const time = this.time;
        if (lo >= hi || time.valueAt(lo) >= t) return lo;
        let below = lo;
        let step = 1;
        let next = lo + 1;
        while (next < hi && time.valueAt(next) < t) {
            below = next;
            step *= 2;
            next = below + step;
        }
        let left = below + 1;
        let right = Math.min(next, hi);
        while (left < right) {
            const mid = Math.floor((left + right) / 2);
            if (time.valueAt(mid) < t) left = mid + 1;
            else right = mid;
        }
        return left;
    }

    private emitColumn(a: number, b: number, out: PointWriter): void {
        if (b - a <= maxRawColumnSamples) {
            for (let i = a; i < b; i++) {
                this.emit(i, out);
            }
            return;
        }

        const s = this.scratch;
        this.query(a, b, s);
        // A null inside the column has to break the line, so the first one is kept too
        const indices = [a, b - 1];
        if (s.minIndex !== noIndex) indices.push(s.minIndex, s.maxIndex);
        if (s.nullIndex !== noIndex) indices.push(s.nullIndex);
        indices.sort((x, y) => x - y);
        for (let k = 0; k < indices.length; k++) {
            if (k === 0 || indices[k] !== indices[k - 1]) this.emit(indices[k], out);
        }
    }

    private emit(i: number, out: PointWriter): void {
        const changes = out.previous === noIndex ? 0 : this.changesUpTo(i) - this.changesUpTo(out.previous);
        out.push(this.time.valueAt(i), this.values.valueAt(i), changes, this.values.exactAt?.(i));
        out.previous = i;
    }

    private countChanges(a: number, b: number): void {
        const values = this.values;
        for (let i = a; i < b; i++) {
            if (i > 0 && values.valueAt(i) !== values.valueAt(i - 1)) this.changeCount++;
            if (i % bucketSize !== 0) continue;
            const bucket = i / bucketSize;
            if (bucket === this.bucketChanges.length) {
                const grown = new Float64Array(bucket * 2);
                grown.set(this.bucketChanges);
                this.bucketChanges = grown;
            }
            this.bucketChanges[bucket] = this.changeCount;
        }
    }

    private changesUpTo(i: number): number {
        const values = this.values;
        const bucketStart = Math.floor(i / bucketSize) * bucketSize;
        let count = this.bucketChanges[bucketStart / bucketSize];
        for (let k = bucketStart + 1; k <= i; k++) {
            if (values.valueAt(k) !== values.valueAt(k - 1)) count++;
        }
        return count;
    }

    private query(a: number, b: number, s: Summary): void {
        s.reset();
        const lo = Math.min(b, Math.ceil(a / bucketSize) * bucketSize);
        this.addSamples(a, lo, s);
        if (lo < b) {
            const hiSample = Math.floor(b / bucketSize) * bucketSize;
            let l = lo / bucketSize;
            let h = hiSample / bucketSize;
            for (let level = 0; l < h; level++) {
                const nodes = this.levels[level];
                if (level + 1 < this.levels.length) {
                    while (l < h && l % fanout !== 0) nodes.mergeInto(l++, s);
                    while (l < h && h % fanout !== 0) nodes.mergeInto(--h, s);
                    l /= fanout;
                    h /= fanout;
                } else {
                    while (l < h) nodes.mergeInto(l++, s);
                }
            }
            this.addSamples(Math.max(lo, hiSample), b, s);
        }
    }

    private addSamples(a: number, b: number, s: Summary): void {
        const values = this.values;
        const nullValue = values.null;
        for (let i = a; i < b; i++) {
            const v = values.valueAt(i);
            if (v === nullValue) {
                s.addNull(i);
            } else {
                s.addExtremes(i, v, i, v);
            }
        }
    }
}
