import type { CachedTile, Signal, SignalBackend, SignalSource, Tile } from '@voltex-viewer/plugin-api';

const maxTiles = 512;
const retryMs = 250;

interface Entry {
    cached: CachedTile | null;
    loading: Promise<Tile> | null;
    failed: { at: number; result: Promise<Tile> } | null;
    used: number;
}

class Tiles {
    private readonly entries = new Map<string, Entry>();
    private clock = 0;

    constructor(private readonly backend: SignalBackend, private readonly onLoaded: () => void) {}

    tile(level: number, index: number): Tile | Promise<Tile> {
        const entry = this.entry(level, index, true)!;
        const dataEnd = this.backend.timeRange[1];
        if (entry.cached && entry.cached.completeUntil >= dataEnd) return entry.cached.tile;
        if (entry.loading) return entry.loading;
        if (entry.failed && performance.now() - entry.failed.at < retryMs) return entry.failed.result;

        const loaded = (tile: Tile): Tile => {
            const completeUntil = tile.after !== null ? Infinity : dataEnd;
            entry.cached = { tile, completeUntil: Math.max(completeUntil, entry.cached?.completeUntil ?? -Infinity) };
            entry.failed = null;
            return tile;
        };
        const result = this.backend.tile(level, index);
        if (!(result instanceof Promise)) {
            this.evict();
            return loaded(result);
        }
        entry.loading = result.then(
            tile => {
                entry.loading = null;
                loaded(tile);
                this.onLoaded();
                return tile;
            },
            (error: unknown) => {
                entry.loading = null;
                if (!entry.failed) console.error(`Failed to load tile ${level}:${index}:`, error);
                const failed = Promise.reject(error);
                failed.catch(() => {});
                entry.failed = { at: performance.now(), result: failed };
                // Others may be waiting for a request to finish
                this.onLoaded();
                throw error;
            },
        );
        this.evict();
        return entry.loading;
    }

    peek(level: number, index: number): CachedTile | null {
        return this.entry(level, index, false)?.cached ?? null;
    }

    private entry(level: number, index: number, create: boolean): Entry | undefined {
        const key = `${level}:${index}`;
        let entry = this.entries.get(key);
        if (!entry && create) {
            entry = { cached: null, loading: null, failed: null, used: 0 };
            this.entries.set(key, entry);
        }
        if (entry) entry.used = ++this.clock;
        return entry;
    }

    private evict(): void {
        if (this.entries.size <= maxTiles) return;
        const idle = [...this.entries].filter(([, entry]) => !entry.loading).sort(([, a], [, b]) => a.used - b.used);
        for (const [key] of idle.slice(0, this.entries.size - maxTiles)) this.entries.delete(key);
    }
}

export class SignalCache {
    private readonly signals = new WeakMap<SignalBackend, Signal>();
    private readonly sources = new WeakMap<SignalSource<SignalBackend>, SignalSource>();
    private readonly wrappers = new WeakSet<object>();

    constructor(private readonly onLoaded: () => void) {}

    signal(backend: SignalBackend): Signal {
        if (this.wrappers.has(backend)) return backend as Signal;
        let signal = this.signals.get(backend);
        if (!signal) {
            const tiles = new Tiles(backend, this.onLoaded);
            const tile = tiles.tile.bind(tiles);
            const peek = tiles.peek.bind(tiles);
            signal = new Proxy(backend, {
                get: (target, prop) => {
                    if (prop === 'tile') return tile;
                    if (prop === 'peek') return peek;
                    if (prop === 'source') return this.source(target.source);
                    const value: unknown = Reflect.get(target, prop, target);
                    return typeof value === 'function' ? value.bind(target) : value;
                },
            }) as Signal;
            this.signals.set(backend, signal);
            this.wrappers.add(signal);
        }
        return signal;
    }

    source(source: SignalSource<SignalBackend>): SignalSource {
        if (this.wrappers.has(source)) return source as SignalSource;
        let wrapped = this.sources.get(source);
        if (!wrapped) {
            const signal = async () => this.signal(await source.signal());
            wrapped = new Proxy(source, {
                get: (target, prop) => {
                    if (prop === 'signal') return signal;
                    const value: unknown = Reflect.get(target, prop, target);
                    return typeof value === 'function' ? value.bind(target) : value;
                },
            }) as SignalSource;
            this.sources.set(source, wrapped);
            this.wrappers.add(wrapped);
        }
        return wrapped;
    }
}
