import { Sequence } from '@voltex-viewer/plugin-api';

type TypedArray = Float64Array | BigInt64Array | BigUint64Array;
type TypedArrayConstructor = Float64ArrayConstructor | BigInt64ArrayConstructor | BigUint64ArrayConstructor;
type ArrayValue<T> = T extends Float64Array ? number : bigint;

export class SharedBufferBackedSequence<T extends TypedArray> implements Sequence {
    private array: T;
    private _length: number = 0;
    private _min: number = Infinity;
    private _max: number = -Infinity;
    private conversion?: (value: ArrayValue<T>) => number | string;
    private arrayConstructor: TypedArrayConstructor;
    private toNumber: (value: ArrayValue<T>) => number;

    constructor(
        buffer: SharedArrayBuffer,
        arrayConstructor: TypedArrayConstructor,
        conversion?: (value: ArrayValue<T>) => number | string
    ) {
        this.arrayConstructor = arrayConstructor;
        this.array = new arrayConstructor(buffer as any) as T;
        this._length = 0;
        this.conversion = conversion;
        this.toNumber = (arrayConstructor === Float64Array 
            ? (v: any) => v 
            : (v: any) => Number(v)) as (value: ArrayValue<T>) => number;
    }

    private recalculateMinMax(): void {
        this._min = Infinity;
        this._max = -Infinity;
        for (let i = 0; i < this._length; i++) {
            const value = this.valueAt(i);
            if (value < this._min) this._min = value;
            if (value > this._max) this._max = value;
        }
    }

    updateBuffer(newBuffer: SharedArrayBuffer, newLength: number): void {
        this.array = new this.arrayConstructor(newBuffer as any) as T;
        this._length = newLength;
        this.recalculateMinMax();
    }

    updateLength(newLength: number): void {
        const oldLength = this._length;
        this._length = newLength;
        
        for (let i = oldLength; i < newLength; i++) {
            const value = this.valueAt(i);
            if (value < this._min) this._min = value;
            if (value > this._max) this._max = value;
        }
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
