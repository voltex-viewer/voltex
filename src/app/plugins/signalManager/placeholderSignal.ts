import { RenderMode, Sequence, Signal, SignalSource } from '@voltex-viewer/plugin-api';

class EmptySequence implements Sequence {
    get min(): number { return 0; }
    get max(): number { return 0; }
    get length(): number { return 0; }
    valueAt(): number { return 0; }
}

class PlaceholderSignal implements Signal {
    readonly time: Sequence = new EmptySequence();
    readonly values: Sequence = new EmptySequence();
    readonly renderHint = RenderMode.Lines;
    constructor(public source: SignalSource) {}
}

export class PlaceholderSignalSource implements SignalSource {
    constructor(public readonly name: string[]) {}

    signal(): Promise<Signal> {
        return Promise.resolve(new PlaceholderSignal(this));
    }
}
