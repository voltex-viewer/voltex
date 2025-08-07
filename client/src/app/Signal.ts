import type { SignalSource } from './Plugin';

export type ChannelPoint = [t: number, v: number];

export interface Signal {
    data(index: number): ChannelPoint;
    length: number;
    source: SignalSource;
    minTime: number;
    maxTime: number;
    minValue: number;
    maxValue: number;
}

export class InMemorySignal implements Signal {
    source: SignalSource;
    private _data: ChannelPoint[];
    public readonly minTime: number;
    public readonly maxTime: number;
    public readonly minValue: number;
    public readonly maxValue: number;
    
    constructor(source: SignalSource, data: ChannelPoint[]) {
        this.source = source;
        this._data = data;
        
        // Calculate min/max values during construction
        let minTime = Infinity;
        let maxTime = -Infinity;
        let minValue = Infinity;
        let maxValue = -Infinity;
        
        for (const [t, v] of data) {
            minTime = Math.min(minTime, t);
            maxTime = Math.max(maxTime, t);
            minValue = Math.min(minValue, v);
            maxValue = Math.max(maxValue, v);
        }
        
        this.minTime = minTime === Infinity ? 0 : minTime;
        this.maxTime = maxTime === -Infinity ? 0 : maxTime;
        this.minValue = minValue === Infinity ? 0 : minValue;
        this.maxValue = maxValue === -Infinity ? 0 : maxValue;
    }
    
    data(index: number): ChannelPoint {
        return this._data[index];
    }
    
    get length(): number {
        return this._data.length;
    }
}

export class FunctionSignal implements Signal {
    source: SignalSource;
    private _duration: number = 1000;
    private _sampleRate: number = 1000;
    private _generator: (time: number) => number;
    public readonly minTime: number = 0;
    public readonly maxTime: number;
    public readonly minValue: number;
    public readonly maxValue: number;
    
    constructor(source: SignalSource, generator: (time: number) => number, minValue: number, maxValue: number) {
        this.source = source;
        this._generator = generator;
        this.maxTime = this._duration;
        this.minValue = minValue;
        this.maxValue = maxValue;
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
