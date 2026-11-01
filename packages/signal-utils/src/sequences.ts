/** Samples held in memory. */
export interface Sequence {
    /** Minimum value in the sequence */
    min: number;
    /** Maximum value in the sequence */
    max: number;
    /** Number of values in the sequence */
    length: number;
    /** Optional value representing null/missing data */
    null?: number;
    /** Unit of measurement for the sequence values */
    unit?: string;
    /** Returns the value at the specified index used for plotting */
    valueAt(index: number): number;
    /** Returns the exact value at the specified index, for sequences of 64-bit integers */
    exactAt?(index: number): bigint;
    /** Returns the form of a value to display, given the exact value where there is one */
    format?(value: number | bigint): number | bigint | string;
}

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
    null?: number;

    constructor(private conversion?: (value: number) => number | string) {
        this._min = Infinity;
        this._max = -Infinity;
        this._data = new Float32Array(1024);
        this._length = 0;
    }

    push(...values: number[]) {
        for (const value of values) {
            if (this._length === this._data.length) {
                const newData = new Float32Array(Math.max(this._data.length * 2, 1024));
                newData.set(this._data);
                this._data = newData;
            }
            this._data[this._length] = value;
            this._length++;
            
            // Skip null values when calculating min/max
            if (this.null !== undefined && value === this.null) {
                continue;
            }
            const numberValue = convertToNumber(value, this.conversion);
            if (numberValue < this._min) {
                this._min = numberValue;
            }
            if (numberValue > this._max) {
                this._max = numberValue;
            }
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

    // Text conversions leave the plotted value raw, so only those need converting again
    format(value: number | bigint): number | bigint | string {
        if (this.conversion === undefined || typeof value === 'bigint') return value;
        const result = this.conversion(value);
        return typeof result === 'string' ? result : value;
    }
}

export class InMemoryFloat64Sequence implements Sequence {
    private _min: number;
    private _max: number;
    private _data: Float64Array;
    private _length: number;

    constructor() {
        this._min = Infinity;
        this._max = -Infinity;
        this._data = new Float64Array(1024);
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
                const newData = new Float64Array(Math.max(this._data.length * 2, 1024));
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
        return this._data[index];
    }
}

export class InMemoryBigInt64Sequence implements Sequence {
    private _min: number;
    private _max: number;
    private _data: BigInt64Array;
    private _length: number;
    private _conversion?: (value: number) => number | string

    constructor(private _bigConversion?: (value: bigint) => number | string) {
        if (typeof this._bigConversion !== "undefined") {
            this._conversion = x => this._bigConversion!(BigInt(x));
        }
        this._min = Infinity;
        this._max = -Infinity;
        this._data = new BigInt64Array(1024);
        this._length = 0;
    }

    push(...values: bigint[]) {
        for (const value of values) {
            const numberValue = convertToNumber(Number(value), this._conversion);
            if (numberValue < this._min) {
                this._min = numberValue;
            }
            if (numberValue > this._max) {
                this._max = numberValue;
            }
            if (this.length === this._data.length) {
                const newData = new BigInt64Array(Math.max(this._data.length * 2, 1024));
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
        return convertToNumber(Number(this._data[index]), this._conversion);
    }

    exactAt(index: number): bigint {
        return this._data[index];
    }

    format(value: number | bigint): number | bigint | string {
        if (typeof value !== 'bigint' || this._bigConversion === undefined) return value;
        return this._bigConversion(value);
    }
}

export class InMemoryBigUint64Sequence implements Sequence {
    private _min: number;
    private _max: number;
    private _data: BigUint64Array;
    private _length: number;
    private _conversion?: (value: number) => number | string

    constructor(private _bigConversion?: (value: bigint) => number | string) {
        if (typeof this._bigConversion !== "undefined") {
            this._conversion = x => this._bigConversion!(BigInt(x));
        }
        this._min = Infinity;
        this._max = -Infinity;
        this._data = new BigUint64Array(1024);
        this._length = 0;
    }

    push(...values: bigint[]) {
        for (const value of values) {
            const numberValue = convertToNumber(Number(value), this._conversion);
            if (numberValue < this._min) {
                this._min = numberValue;
            }
            if (numberValue > this._max) {
                this._max = numberValue;
            }
            if (this.length === this._data.length) {
                const newData = new BigUint64Array(Math.max(this._data.length * 2, 1024));
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
        return convertToNumber(Number(this._data[index]), this._conversion);
    }

    exactAt(index: number): bigint {
        return this._data[index];
    }

    format(value: number | bigint): number | bigint | string {
        if (typeof value !== 'bigint' || this._bigConversion === undefined) return value;
        return this._bigConversion(value);
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
    null?: number;

    constructor(
        private generator: (time: number) => number,
        private time: Sequence,
        private minVal: number,
        private maxVal: number,
        private nullValue?: number,
    ) {
        if (nullValue !== undefined) {
            this.null = nullValue;
        }
    }

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
        return this.generator(this.time.valueAt(index));
    }
}
