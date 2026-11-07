import { RenderMode, SignalSource, type Tile, type SignalBackend } from '@voltex-viewer/plugin-api';

class PlaceholderSignal implements SignalBackend {
    readonly renderHint = RenderMode.Lines;
    readonly timeRange = [Infinity, -Infinity] as const;
    readonly valueRange = [Infinity, -Infinity] as const;
    readonly live = false;
    constructor(public source: SignalSource<SignalBackend>) {}

    tile(): Tile {
        return { time: new Float64Array(0), value: new Float64Array(0), changes: new Uint32Array(0), samples: 0, before: null, after: null };
    }
}

export class PlaceholderSignalSource implements SignalSource<SignalBackend> {
    constructor(public readonly name: string[]) {}

    signal(): Promise<SignalBackend> {
        return Promise.resolve(new PlaceholderSignal(this));
    }
}
