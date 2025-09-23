import type { Sequence, Signal, SignalSource } from './Plugin';

export type ChannelPoint = [t: number, v: number];

function convertToNumber(value: number, conversion?: (value: number) => number | string): number {
    if (conversion !== undefined) {
        const result = conversion(value);
        if (typeof result === 'number') {
            return result;
        } else {
            return value;
        }
    } else {
        return value;
    }
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
            const numberValue = convertToNumber(value, this.conversion);
            if (numberValue < this._min) {
                this._min = numberValue;
            }
            if (numberValue > this._max) {
                this._max = numberValue;
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
        return convertToNumber(this._data[index], this.conversion);
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
}

export class InMemorySignal implements Signal {
    source: SignalSource;
    public readonly time: InMemorySequence;
    public readonly values: InMemorySequence;
    
    constructor(source: SignalSource, data: ChannelPoint[]) {
        this.source = source;
        this.time = new InMemorySequence();
        this.values = new InMemorySequence();
        
        this.time.push(...data.map(([t]) => t));
        this.values.push(...data.map(([, v]) => v));
    }
}

export class FunctionTimeSequence implements Sequence {
    constructor(public readonly duration: number, public readonly sampleRate: number) {}

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

export class FunctionValueSequence implements Sequence {
    constructor(
        private generator: (time: number) => number,
        private time: FunctionTimeSequence,
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
        return this.time.length;
    }

    valueAt(index: number): number {
        const time = index / this.time.sampleRate;
        return this.generator(time);
    }
}

export class FunctionSignal implements Signal {
    source: SignalSource;
    private _generator: (time: number) => number;
    public readonly time: FunctionTimeSequence;
    public readonly values: FunctionValueSequence;
    
    constructor(source: SignalSource, time: FunctionTimeSequence, generator: (time: number) => number, minValue: number, maxValue: number) {
        this.source = source;
        this._generator = generator;
        this.time = time;
        this.values = new FunctionValueSequence(this._generator, this.time, minValue, maxValue);
    }
}
