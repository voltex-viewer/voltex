import type { RenderMode, Signal, SignalSource, Tile } from '@voltex-viewer/plugin-api';
import type { Sequence } from './sequences';
import { SequenceTiles } from './sequenceTiles';

export class SequenceSignal implements Signal {
    private readonly tiles: SequenceTiles;

    constructor(
        public source: SignalSource,
        private readonly time: Sequence,
        private readonly values: Sequence,
        public renderHint: RenderMode,
        public startTime?: number | undefined) {
        this.tiles = new SequenceTiles(time, values);
    }

    get unit(): string | undefined {
        return this.values.unit;
    }

    get null(): number | undefined {
        return this.values.null;
    }

    get timeRange(): readonly [number, number] {
        const n = this.tiles.length;
        return n === 0 ? [Infinity, -Infinity] : [this.time.valueAt(0), this.time.valueAt(n - 1)];
    }

    get valueRange(): readonly [number, number] {
        return this.tiles.length === 0 ? [Infinity, -Infinity] : [this.values.min, this.values.max];
    }

    tile(level: number, index: number): Tile | Promise<Tile> {
        return this.tiles.tile(level, index);
    }

    format(value: number | bigint): number | bigint | string {
        return this.values.format ? this.values.format(value) : value;
    }
}
