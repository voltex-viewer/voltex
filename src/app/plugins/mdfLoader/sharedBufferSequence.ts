export class SharedBufferSequence {
    private buffer: SharedArrayBuffer;
    private array: Float64Array;
    private len: number = 0;

    constructor(initialCapacity: number = 1024) {
        this.buffer = new SharedArrayBuffer(initialCapacity * 8);
        this.array = new Float64Array(this.buffer);
    }

    push(value: number): void {
        if (this.len >= this.array.length) {
            // Double capacity
            const newBuffer = new SharedArrayBuffer(this.array.length * 2 * 8);
            const newArray = new Float64Array(newBuffer);
            newArray.set(this.array);
            this.buffer = newBuffer;
            this.array = newArray;
        }
        this.array[this.len++] = value;
    }

    length(): number {
        return this.len;
    }

    getBuffer(): SharedArrayBuffer {
        return this.buffer;
    }
}

export class SharedBufferBigInt64Sequence {
    private buffer: SharedArrayBuffer;
    private array: BigInt64Array;
    private len: number = 0;

    constructor(initialCapacity: number = 1024) {
        this.buffer = new SharedArrayBuffer(initialCapacity * 8);
        this.array = new BigInt64Array(this.buffer);
    }

    push(value: bigint): void {
        if (this.len >= this.array.length) {
            const newBuffer = new SharedArrayBuffer(this.array.length * 2 * 8);
            const newArray = new BigInt64Array(newBuffer);
            newArray.set(this.array);
            this.buffer = newBuffer;
            this.array = newArray;
        }
        this.array[this.len++] = value;
    }

    length(): number {
        return this.len;
    }

    getBuffer(): SharedArrayBuffer {
        return this.buffer;
    }
}

export class SharedBufferBigUint64Sequence {
    private buffer: SharedArrayBuffer;
    private array: BigUint64Array;
    private len: number = 0;

    constructor(initialCapacity: number = 1024) {
        this.buffer = new SharedArrayBuffer(initialCapacity * 8);
        this.array = new BigUint64Array(this.buffer);
    }

    push(value: bigint): void {
        if (this.len >= this.array.length) {
            const newBuffer = new SharedArrayBuffer(this.array.length * 2 * 8);
            const newArray = new BigUint64Array(newBuffer);
            newArray.set(this.array);
            this.buffer = newBuffer;
            this.array = newArray;
        }
        this.array[this.len++] = value;
    }

    length(): number {
        return this.len;
    }

    getBuffer(): SharedArrayBuffer {
        return this.buffer;
    }
}
