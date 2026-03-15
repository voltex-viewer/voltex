import type { Signal, Sequence } from '@voltex-viewer/plugin-api';

export class EnumRunIndex {
    private valuesArr = new Float32Array(1024);
    private startIndicesArr = new Uint32Array(1024);
    private endIndicesArr = new Uint32Array(1024);
    private count = 0;
    private capacity = 1024;
    private processedUpTo = 0;
    private lastValue = NaN;

    get runCount(): number {
        return this.count;
    }

    value(i: number): number {
        return this.valuesArr[i];
    }

    startIndex(i: number): number {
        return this.startIndicesArr[i];
    }

    endIndex(i: number): number {
        return this.endIndicesArr[i];
    }

    process(signal: Signal, chunkSize: number): boolean {
        const seqLen = Math.min(signal.time.length, signal.values.length);
        if (this.processedUpTo >= seqLen) return false;

        const end = Math.min(this.processedUpTo + chunkSize, seqLen);

        if (this.processedUpTo === 0 && end > 0) {
            this.lastValue = signal.values.valueAt(0);
            this.appendRun(this.lastValue, 0, 0);
            this.processedUpTo = 1;
        }

        for (let i = this.processedUpTo; i < end; i++) {
            const v = signal.values.valueAt(i);
            if (v !== this.lastValue) {
                this.endIndicesArr[this.count - 1] = i;
                this.lastValue = v;
                this.appendRun(v, i, i);
            } else {
                this.endIndicesArr[this.count - 1] = i;
            }
        }

        this.processedUpTo = end;
        return end < seqLen;
    }

    getVisibleRunRange(signal: Signal, startTime: number, endTime: number): [number, number] {
        if (this.count === 0) return [0, 0];

        let lo = 0;
        let hi = this.count - 1;
        let startIdx = 0;
        while (lo <= hi) {
            const mid = (lo + hi) >>> 1;
            const runEndTime = signal.time.valueAt(this.endIndicesArr[mid]);
            if (runEndTime < startTime) {
                lo = mid + 1;
            } else {
                startIdx = mid;
                hi = mid - 1;
            }
        }

        lo = startIdx;
        hi = this.count - 1;
        let endIdx = startIdx;
        while (lo <= hi) {
            const mid = (lo + hi) >>> 1;
            const runStartTime = signal.time.valueAt(this.startIndicesArr[mid]);
            if (runStartTime <= endTime) {
                endIdx = mid;
                lo = mid + 1;
            } else {
                hi = mid - 1;
            }
        }

        return [startIdx, endIdx];
    }

    asSignal(rawSignal: Signal): Signal {
        // eslint-disable-next-line @typescript-eslint/no-this-alias
        const self = this;

        const timeSeq: Sequence = {
            get min() { return rawSignal.time.min; },
            get max() { return rawSignal.time.max; },
            get length() { return self.count; },
            valueAt: (i: number) => rawSignal.time.valueAt(this.startIndicesArr[i]),
        };

        const valuesSeq: Sequence = {
            get min() { return rawSignal.values.min; },
            get max() { return rawSignal.values.max; },
            get length() { return self.count; },
            valueAt: (i: number) => this.valuesArr[i],
            convertedValueAt: (i: number) => {
                return "convertedValueAt" in rawSignal.values
                    ? rawSignal.values.convertedValueAt!(this.startIndicesArr[i])
                    : this.valuesArr[i];
            },
        };

        if ("null" in rawSignal.values) {
            (valuesSeq as unknown as Record<string, unknown>).null = rawSignal.values.null;
        }
        if ("unit" in rawSignal.values && rawSignal.values.unit !== undefined) {
            (valuesSeq as unknown as Record<string, unknown>).unit = rawSignal.values.unit;
        }

        return {
            source: rawSignal.source,
            time: timeSeq,
            values: valuesSeq,
            renderHint: rawSignal.renderHint,
        };
    }

    private appendRun(value: number, startIndex: number, endIndex: number): void {
        if (this.count === this.capacity) {
            this.grow();
        }
        this.valuesArr[this.count] = value;
        this.startIndicesArr[this.count] = startIndex;
        this.endIndicesArr[this.count] = endIndex;
        this.count++;
    }

    private grow(): void {
        const newCap = this.capacity * 2;
        const newValues = new Float32Array(newCap);
        const newStarts = new Uint32Array(newCap);
        const newEnds = new Uint32Array(newCap);
        newValues.set(this.valuesArr);
        newStarts.set(this.startIndicesArr);
        newEnds.set(this.endIndicesArr);
        this.valuesArr = newValues;
        this.startIndicesArr = newStarts;
        this.endIndicesArr = newEnds;
        this.capacity = newCap;
    }
}
