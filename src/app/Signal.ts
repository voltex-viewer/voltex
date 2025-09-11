import type { SignalSource } from './Plugin';

export type ChannelPoint = [t: number, v: number];

export interface Sequence {
    min: number;
    max: number;
    length: number;
    valueAt(index: number): number;
    convertedValueAt?(index: number): number | string;
}

export interface Signal {
    source: SignalSource;
    time: Sequence;
    values: Sequence;
    valueTable: ReadonlyMap<number, string>;
}

export class InMemorySequence implements Sequence {
    private _min: number;
    private _max: number;
    private _data: Float32Array;
    private _length: number;

    constructor(private conversion?: (value: number) => number | string) {
        this._min = Infinity;
        this._max = -Infinity;
        this._data = new Float32Array(1024);
        this._length = 0;
    }

    push(...values: number[]) {
        for (const value of values) {
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
    }

    get min(): number {
        return this._min == Infinity ? 0 : this._min;
    }

    get max(): number {
        return this._max == -Infinity ? 0 : this._max;
    }

    get length(): number {
        return this._length;
    }

    valueAt(index: number): number {
        const value = this._data[index];
        if (this.conversion !== undefined) {
            const result = this.conversion(value);
            if (typeof result === 'number') {
                return result;
            } else {
                return value;
            }
        } else {
            return value;
        }
    }

    convertedValueAt(index: number): number | string {
        const value = this._data[index];
        if (this.conversion !== undefined) {
            const result = this.conversion(value);
            if (typeof result !== 'undefined') {
                return result;
            } else {
                return value;
            }
        } else {
            return value;
        }
    }
}

export class SequenceSignal implements Signal {
    constructor(
        public source: SignalSource,
        public time: InMemorySequence,
        public values: InMemorySequence) {
    }

    data(index: number): ChannelPoint {
        return [this.time.valueAt(index), this.values.valueAt(index)];
    }

    convertedData(index: number): [t: number, v: number | string] {
        return [this.time.valueAt(index), this.values.convertedValueAt(index)];
    }

    get length(): number {
        return Math.min(this.time.length, this.values.length);
    }

    get valueTable(): ReadonlyMap<number, string> {
        return new Map();
    }
}

export class InMemorySignal implements Signal {
    source: SignalSource;
    public readonly time: InMemorySequence;
    public readonly values: InMemorySequence;
    public readonly valueTable: ReadonlyMap<number, string>;
    
    constructor(source: SignalSource, data: ChannelPoint[]) {
        this.source = source;
        this.time = new InMemorySequence();
        this.values = new InMemorySequence();
        
        this.time.push(...data.map(([t]) => t));
        this.values.push(...data.map(([, v]) => v));
        
        this.valueTable = new Map<number, string>();
    }
}

class FunctionTimeSequence implements Sequence {
    constructor(private duration: number, private sampleRate: number) {}

    get min(): number {
        return 0;
    }

    get max(): number {
        return this.duration;
    }

    get length(): number {
        return this.duration * this.sampleRate;
    }

    valueAt(index: number): number {
        return index / this.sampleRate;
    }
}

class FunctionValueSequence implements Sequence {
    constructor(
        private generator: (time: number) => number,
        private sampleRate: number,
        private minVal: number,
        private maxVal: number
    ) {}

    get min(): number {
        return this.minVal;
    }

    get max(): number {
        return this.maxVal;
    }

    get length(): number {
        return Infinity;
    }

    valueAt(index: number): number {
        const time = index / this.sampleRate;
        return this.generator(time);
    }
}

export class FunctionSignal implements Signal {
    source: SignalSource;
    private _duration: number = 1000;
    private _sampleRate: number = 1000;
    private _generator: (time: number) => number;
    public readonly time: FunctionTimeSequence;
    public readonly values: FunctionValueSequence;
    public readonly valueTable: ReadonlyMap<number, string>;
    
    constructor(source: SignalSource, generator: (time: number) => number, minValue: number, maxValue: number) {
        this.source = source;
        this._generator = generator;
        this.time = new FunctionTimeSequence(this._duration, this._sampleRate);
        this.values = new FunctionValueSequence(this._generator, this._sampleRate, minValue, maxValue);
        this.valueTable = new Map<number, string>();
    }
}
