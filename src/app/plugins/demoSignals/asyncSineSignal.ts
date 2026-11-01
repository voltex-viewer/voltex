import { RenderMode, tileColumns, type Signal, type SignalSource, type Tile, type Sample } from '@voltex-viewer/plugin-api';

/**
 * A sine with far too many samples to hold, so its tiles are computed in closed form and delivered after a delay
 * like a remote source. The period must be a multiple of 4 samples, so every crest and trough falls on a sample.
 */
export class AsyncSineSignal implements Signal {
    readonly renderHint = RenderMode.Lines;
    readonly valueRange = [-1, 1] as const;

    constructor(
        public readonly source: SignalSource,
        private readonly sampleRate: number,
        private readonly periodSamples: number,
        private readonly length: number,
        private readonly delayMs: () => number,
        private readonly loadedLength: () => number,
    ) {}

    get timeRange(): readonly [number, number] {
        const loaded = Math.min(this.length, this.loadedLength());
        return loaded === 0 ? [Infinity, -Infinity] : [0, (loaded - 1) / this.sampleRate];
    }

    tile(level: number, index: number): Promise<Tile> {
        const loaded = Math.min(this.length, this.loadedLength());
        return new Promise(resolve => setTimeout(() => resolve(this.compute(level, index, loaded)), this.delayMs()));
    }

    private compute(level: number, index: number, loaded: number): Tile {
        const width = Math.pow(2, level);
        const firstColumn = index * tileColumns;
        const time: number[] = [];
        const value: number[] = [];
        const changes: number[] = [];

        const first = this.indexAt(firstColumn * width, loaded);
        // Every sample differs from the one before, so the changes are the samples skipped
        let previous = first - 1;
        let a = first;
        for (let c = 1; c <= tileColumns; c++) {
            const b = this.indexAt((firstColumn + c) * width, loaded);
            for (const i of this.columnIndices(a, b)) {
                time.push(i / this.sampleRate);
                value.push(this.valueAt(i));
                changes.push(previous < 0 ? 0 : i - previous);
                previous = i;
            }
            a = b;
        }

        return {
            time: Float64Array.from(time),
            value: Float64Array.from(value),
            changes: Uint32Array.from(changes),
            samples: a - first,
            before: first > 0 ? this.point(first - 1) : null,
            after: a < loaded ? this.point(a) : null,
        };
    }

    private columnIndices(a: number, b: number): number[] {
        const last = b - 1;
        if (b - a <= 4) {
            return Array.from({ length: Math.max(0, b - a) }, (_, k) => a + k);
        }
        const p = this.periodSamples;
        const crest = this.nextAtPhase(a, p / 4, p);
        const trough = this.nextAtPhase(a, (3 * p) / 4, p);
        const maxIndex = crest <= last ? crest : (this.valueAt(a) >= this.valueAt(last) ? a : last);
        const minIndex = trough <= last ? trough : (this.valueAt(a) <= this.valueAt(last) ? a : last);
        return [...new Set([a, minIndex, maxIndex, last])].sort((x, y) => x - y);
    }

    private nextAtPhase(i: number, phase: number, modulus: number): number {
        return i + ((((phase - i) % modulus) + modulus) % modulus);
    }

    private indexAt(t: number, length: number): number {
        return Math.min(length, Math.max(0, Math.ceil(t * this.sampleRate)));
    }

    private valueAt(i: number): number {
        return Math.sin((2 * Math.PI * (i % this.periodSamples)) / this.periodSamples);
    }

    private point(i: number): Sample {
        return { time: i / this.sampleRate, value: this.valueAt(i) };
    }
}
