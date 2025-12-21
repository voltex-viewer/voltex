export class TimeValueBuffer {
    readonly timeHighBuffer: Float32Array;
    readonly timeLowBuffer: Float32Array;
    readonly valueBuffer: Float32Array;
    private _length = 0;

    constructor(readonly capacity: number) {
        this.timeHighBuffer = new Float32Array(capacity);
        this.timeLowBuffer = new Float32Array(capacity);
        this.valueBuffer = new Float32Array(capacity);
    }

    get length(): number {
        return this._length;
    }

    append(time: number, value: number): void {
        const high = Math.fround(time);
        this.timeHighBuffer[this._length] = high;
        this.timeLowBuffer[this._length] = time - high;
        this.valueBuffer[this._length] = value;
        this._length++;
    }

    clear(): void {
        this._length = 0;
    }
}
