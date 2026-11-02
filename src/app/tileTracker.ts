import { tileDuration, type Signal, type Tile } from '@voltex-viewer/plugin-api';

const maxTrackedTiles = 1024;

export class TileTracker {
    private readonly tracked = new WeakMap<Signal, Signal>();
    private readonly loaded = new WeakMap<Signal, Map<string, number>>();

    constructor(private readonly onLoaded: () => void) {}

    track(signal: Signal): Signal {
        if (this.loaded.has(signal)) return signal;
        let tracked = this.tracked.get(signal);
        if (tracked) return tracked;

        const loaded = new Map<string, number>();
        const tile = (level: number, index: number): Tile | Promise<Tile> => {
            const end = signal.timeRange[1];
            const result = signal.tile(level, index);
            if (result instanceof Promise) {
                // Failures are left to whoever asked for the tile
                result.then(t => this.record(loaded, level, index, t, end), () => {});
            } else {
                this.record(loaded, level, index, result, end);
            }
            return result;
        };
        tracked = new Proxy(signal, {
            get: (target, prop) => {
                if (prop === 'tile') return tile;
                const value: unknown = Reflect.get(target, prop, target);
                return typeof value === 'function' ? value.bind(target) : value;
            },
        });
        this.tracked.set(signal, tracked);
        this.loaded.set(tracked, loaded);
        return tracked;
    }

    // How far on from `from` the signal's tiles at `level` are loaded without a gap
    readyUntil(signal: Signal, from: number, level: number): number {
        const loaded = this.loaded.get(signal);
        const dataEnd = signal.timeRange[1];
        const duration = tileDuration(level);
        let time = from;
        for (let index = Math.floor(from / duration); loaded && time < dataEnd; index++) {
            const known = loaded.get(key(level, index));
            if (known === undefined) break;
            const tileEnd = (index + 1) * duration;
            time = Math.max(time, Math.min(known, tileEnd));
            if (known < tileEnd) break;
        }
        return Math.min(time, dataEnd);
    }

    private record(loaded: Map<string, number>, level: number, index: number, tile: Tile, end: number): void {
        const k = key(level, index);
        const previous = loaded.get(k) ?? -Infinity;
        const known = Math.max(previous, tile.after !== null ? Infinity : end);
        loaded.delete(k);
        loaded.set(k, known);
        if (loaded.size > maxTrackedTiles) loaded.delete(loaded.keys().next().value!);
        if (known > previous) {
            queueMicrotask(this.onLoaded);
        }
    }
}

function key(level: number, index: number): string {
    return `${level}:${index}`;
}
