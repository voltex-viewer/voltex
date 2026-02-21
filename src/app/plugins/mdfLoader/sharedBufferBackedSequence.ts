import { Sequence } from '@voltex-viewer/plugin-api';

const headerBytes = 8;

type TypedArray = Float64Array | BigInt64Array | BigUint64Array;
type TypedArrayConstructor = Float64ArrayConstructor | BigInt64ArrayConstructor | BigUint64ArrayConstructor;
type ArrayValue<T> = T extends Float64Array ? number : bigint;

export class SharedBufferBackedSequence<T extends TypedArray> implements Sequence {
    private buffer: SharedArrayBuffer;
    private lengthView: Int32Array;
    private array: T;
    private _length: number = 0;
    private _min: number = Infinity;
    private _max: number = -Infinity;
    private conversion?: (value: ArrayValue<T>) => number | string;
    private arrayConstructor: TypedArrayConstructor;
    private toNumber: (value: ArrayValue<T>) => number;

    public readonly unit?: string;

    constructor(
        buffer: SharedArrayBuffer,
        arrayConstructor: TypedArrayConstructor,
        conversion: ((value: ArrayValue<T>) => number | string) | undefined,
        unit: string | null,
    ) {
        this.buffer = buffer;
        this.arrayConstructor = arrayConstructor;
        this.lengthView = new Int32Array(buffer, 0, 1);
        this.array = new (arrayConstructor as unknown as { new(buffer: SharedArrayBuffer, byteOffset: number): T })(buffer, headerBytes);
        if (conversion) {
            this.conversion = conversion;
        }
        if (unit) {
            this.unit = unit;
        }
        this.toNumber = (arrayConstructor === Float64Array 
            ? (v: ArrayValue<T>) => v as number 
            : (v: ArrayValue<T>) => Number(v)) as (value: ArrayValue<T>) => number;
    }

    update(): void {
        const currentLength = Atomics.load(this.lengthView, 0);
        if (currentLength > this.array.length) {
            this.array = new (this.arrayConstructor as unknown as { new(buffer: SharedArrayBuffer, byteOffset: number): T })(this.buffer, headerBytes);
        }
        for (let i = this._length; i < currentLength; i++) {
            const value = this.valueAt(i);
            if (value < this._min) this._min = value;
            if (value > this._max) this._max = value;
        }
        this._length = currentLength;
    }

    get min(): number {
        return this._min === Infinity ? 0 : this._min;
    }

    get max(): number {
        return this._max === -Infinity ? 0 : this._max;
    }

    get length(): number {
        return this._length;
    }

    valueAt(index: number): number {
        const rawValue = this.array[index] as ArrayValue<T>;
        
        if (this.conversion) {
            const result = this.conversion(rawValue);
            if (typeof result === 'number') {
                return result;
            }
        }
        return this.toNumber(rawValue);
    }

    convertedValueAt(index: number): number | string {
        const rawValue = this.array[index] as ArrayValue<T>;
        
        if (this.conversion) {
            const result = this.conversion(rawValue);
            if (typeof result !== 'undefined') {
                return result;
            }
        }
        return this.toNumber(rawValue);
    }
}
