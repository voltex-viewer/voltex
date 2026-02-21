const headerBytes = 8;
const defaultInitialCapacity = 1024;
const defaultMaxCapacity = 128 * 1024 * 1024;

export class SharedBufferSequence {
    private buffer: SharedArrayBuffer;
    private lengthView: Int32Array;
    private array: Float64Array;

    constructor(initialCapacity: number = defaultInitialCapacity, maxCapacity: number = defaultMaxCapacity) {
        this.buffer = new SharedArrayBuffer(headerBytes + initialCapacity * 8, { maxByteLength: headerBytes + maxCapacity * 8 });
        this.lengthView = new Int32Array(this.buffer, 0, 1);
        this.array = new Float64Array(this.buffer, headerBytes);
    }

    push(value: number): void {
        const len = Atomics.load(this.lengthView, 0);
        if (len >= this.array.length) {
            const newCapacity = this.array.length * 2;
            this.buffer.grow(headerBytes + newCapacity * 8);
            this.array = new Float64Array(this.buffer, headerBytes);
        }
        this.array[len] = value;
        Atomics.store(this.lengthView, 0, len + 1);
    }

    length(): number {
        return Atomics.load(this.lengthView, 0);
    }

    getBuffer(): SharedArrayBuffer {
        return this.buffer;
    }
}

export class SharedBufferBigInt64Sequence {
    private buffer: SharedArrayBuffer;
    private lengthView: Int32Array;
    private array: BigInt64Array;

    constructor(initialCapacity: number = defaultInitialCapacity, maxCapacity: number = defaultMaxCapacity) {
        this.buffer = new SharedArrayBuffer(headerBytes + initialCapacity * 8, { maxByteLength: headerBytes + maxCapacity * 8 });
        this.lengthView = new Int32Array(this.buffer, 0, 1);
        this.array = new BigInt64Array(this.buffer, headerBytes);
    }

    push(value: bigint): void {
        const len = Atomics.load(this.lengthView, 0);
        if (len >= this.array.length) {
            const newCapacity = this.array.length * 2;
            this.buffer.grow(headerBytes + newCapacity * 8);
            this.array = new BigInt64Array(this.buffer, headerBytes);
        }
        this.array[len] = value;
        Atomics.store(this.lengthView, 0, len + 1);
    }

    length(): number {
        return Atomics.load(this.lengthView, 0);
    }

    getBuffer(): SharedArrayBuffer {
        return this.buffer;
    }
}

export class SharedBufferBigUint64Sequence {
    private buffer: SharedArrayBuffer;
    private lengthView: Int32Array;
    private array: BigUint64Array;

    constructor(initialCapacity: number = defaultInitialCapacity, maxCapacity: number = defaultMaxCapacity) {
        this.buffer = new SharedArrayBuffer(headerBytes + initialCapacity * 8, { maxByteLength: headerBytes + maxCapacity * 8 });
        this.lengthView = new Int32Array(this.buffer, 0, 1);
        this.array = new BigUint64Array(this.buffer, headerBytes);
    }

    push(value: bigint): void {
        const len = Atomics.load(this.lengthView, 0);
        if (len >= this.array.length) {
            const newCapacity = this.array.length * 2;
            this.buffer.grow(headerBytes + newCapacity * 8);
            this.array = new BigUint64Array(this.buffer, headerBytes);
        }
        this.array[len] = value;
        Atomics.store(this.lengthView, 0, len + 1);
    }

    length(): number {
        return Atomics.load(this.lengthView, 0);
    }

    getBuffer(): SharedArrayBuffer {
        return this.buffer;
    }
}
