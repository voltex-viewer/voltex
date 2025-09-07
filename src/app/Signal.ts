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
    valueTable: ReadonlyMap<number, string>;
}

export class Sequence {
    private _min: number;
    private _max: number;
    private _data: Float32Array;
    private _length: number;

    constructor() {
        this._min = Infinity;
        this._max = -Infinity;
        this._data = new Float32Array(1024);
        this._length = 0;
    }

    push(value: number) {
        if (value < this._min) {
            this._min = value;
        }
        if (value > this._max) {
            this._max = value;
        }
        if (this._length === this._data.length) {
            const newData = new Float32Array(Math.max(this._data.length * 2, 1024));
            newData.set(this._data);
            this._data = newData;
        }
        this._data[this._length] = value;
        this._length++;
    }

    get min(): number {
        return this._min == Infinity ? 0 : this._min;
    }

    get max(): number {
        return this._max == -Infinity ? 0 : this._max;
    }

    get data(): Float32Array {
        return this._data.subarray(0, this._length);
    }

    get length(): number {
        return this._length;
    }
}

export class SequenceSignal implements Signal {
    private _time: Sequence;
    private _value: Sequence;

    constructor(
        public source: SignalSource,
        time: Sequence,
        value: Sequence) {
        this._time = time;
        this._value = value;
    }

    data(index: number): ChannelPoint {
        return [this._time.data[index], this._value.data[index]];
    }

    get length(): number {
        return Math.min(this._time.length, this._value.length);
    }

    get minTime(): number {
        return this._time.min;
    }

    get maxTime(): number {
        return this._time.max;
    }

    get minValue(): number {
        return this._value.min;
    }

    get maxValue(): number {
        return this._value.max;
    }

    get valueTable(): ReadonlyMap<number, string> {
        return new Map();
    }
}

export class InMemorySignal implements Signal {
    source: SignalSource;
    private _data: ChannelPoint[];
    private _minTime: number;
    private _maxTime: number;
    private _minValue: number;
    private _maxValue: number;
    public readonly valueTable: ReadonlyMap<number, string>;
    
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

        this._minTime = minTime === Infinity ? 0 : minTime;
        this._maxTime = maxTime === -Infinity ? 0 : maxTime;
        this._minValue = minValue === Infinity ? 0 : minValue;
        this._maxValue = maxValue === -Infinity ? 0 : maxValue;

        this.valueTable = new Map<number, string>();
    }
    
    data(index: number): ChannelPoint {
        return this._data[index];
    }

    append(...points: ChannelPoint[]) {
        this._data.push(...points);
        for (const [t, v] of points) {
            this._minTime = Math.min(this._minTime, t);
            this._maxTime = Math.max(this._maxTime, t);
            this._minValue = Math.min(this._minValue, v);
            this._maxValue = Math.max(this._maxValue, v);
        }
    }
    
    get length(): number {
        return this._data.length;
    }

    get minTime(): number {
        return this._minTime;
    }

    get maxTime(): number {
        return this._maxTime;
    }

    get minValue(): number {
        return this._minValue;
    }

    get maxValue(): number {
        return this._maxValue;
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
    public readonly valueTable: ReadonlyMap<number, string>;
    
    constructor(source: SignalSource, generator: (time: number) => number, minValue: number, maxValue: number) {
        this.source = source;
        this._generator = generator;
        this.maxTime = this._duration;
        this.minValue = minValue;
        this.maxValue = maxValue;
        this.valueTable = new Map<number, string>();
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
