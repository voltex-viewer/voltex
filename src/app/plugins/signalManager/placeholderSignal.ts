import { RenderMode, Signal, SignalSource, type Tile } from '@voltex-viewer/plugin-api';

class PlaceholderSignal implements Signal {
    readonly renderHint = RenderMode.Lines;
    readonly timeRange = [Infinity, -Infinity] as const;
    readonly valueRange = [Infinity, -Infinity] as const;
    constructor(public source: SignalSource) {}

    tile(): Tile {
        return { time: new Float64Array(0), value: new Float64Array(0), changes: new Uint32Array(0), samples: 0, before: null, after: null };
    }
}

export class PlaceholderSignalSource implements SignalSource {
    constructor(public readonly name: string[]) {}

    signal(): Promise<Signal> {
        return Promise.resolve(new PlaceholderSignal(this));
    }
}
