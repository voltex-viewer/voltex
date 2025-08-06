import type { SignalSource } from './Plugin';

export type ChannelPoint = [t: number, v: number];

export interface Signal {
    name: string;
    data(index: number): ChannelPoint;
    length: number;
    source: SignalSource;
}

export class InMemorySignal implements Signal {
    name: string;
    source: SignalSource;
    private _data: ChannelPoint[];
    
    constructor(name: string, data: ChannelPoint[], source: SignalSource) {
        this.name = name;
        this.source = source;
        this._data = data;
    }
    
    data(index: number): ChannelPoint {
        return this._data[index];
    }
    
    get length(): number {
        return this._data.length;
    }
}

export class FunctionSignal implements Signal {
    name: string;
    source: SignalSource;
    private _duration: number = 1000;
    private _sampleRate: number = 1000;
    private _generator: (time: number) => number;
    
    constructor(name: string, generator: (time: number) => number, source: SignalSource) {
        this.name = name;
        this.source = source;
        this._generator = generator;
    }
    
    data(index: number): ChannelPoint {
        if (index < 0 || index >= this.length) {
            return [0, 0];
        }
        const time = index / this._sampleRate;
        const value = this._generator(time);
        return [time, value];
    }
    
    get length(): number {
        return this._duration * this._sampleRate;
    }
}
