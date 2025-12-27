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

    public readonly unit?: string;

    constructor(
        buffer: SharedArrayBuffer,
        arrayConstructor: TypedArrayConstructor,
        conversion: ((value: ArrayValue<T>) => number | string) | undefined,
        unit: string | null,
    ) {
        this.arrayConstructor = arrayConstructor;
        // TypeScript has trouble with union-typed constructors, but this is safe at runtime
        this.array = new (arrayConstructor as unknown as { new(buffer: SharedArrayBuffer): T })(buffer);
        this._length = 0;
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

    updateBuffer(newBuffer: SharedArrayBuffer, newLength: number): void {
        // TypeScript has trouble with union-typed constructors, but this is safe at runtime
        this.array = new (this.arrayConstructor as unknown as { new(buffer: SharedArrayBuffer): T })(newBuffer);
        for (let i = this._length; i < newLength; i++) {
            const value = this.valueAt(i);
            if (value < this._min) this._min = value;
            if (value > this._max) this._max = value;
        }
        this._length = newLength;
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
