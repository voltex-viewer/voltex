import type { Signal } from '@voltex-viewer/plugin-api';
import type { Downsampler } from './types';

interface MockArrayLike {
    length: number;
    valueAt: (index: number) => number;
}

export function createMockSignal(timeData: number[], valueData: number[]): Signal {
    return {
        time: {
            get length() { return timeData.length; },
            valueAt: (index: number) => timeData[index],
        } as MockArrayLike,
        values: {
            get length() { return valueData.length; },
            valueAt: (index: number) => valueData[index],
        } as MockArrayLike,
    } as Signal;
}

export class DownsampleCollector {
    readonly times: number[] = [];
    readonly values: number[] = [];
    private lastOverwriteNext = false;

    collect(downsampler: Downsampler): void {
        while (true) {
            const iter = downsampler.next();
            if (iter.done) {
                throw new Error('Downsampler generator unexpectedly returned');
            }
            const result = iter.value;

            if (this.lastOverwriteNext && result.bufferOffset > 0 && this.times.length > 0) {
                this.times.pop();
                this.values.pop();
            }

            for (let i = 0; i < result.bufferOffset; i++) {
                this.times.push(downsampler.timeBuffer[i]);
                this.values.push(downsampler.valueBuffer[i]);
            }

            if (result.bufferOffset > 0) {
                this.lastOverwriteNext = result.overwriteNext ?? false;
            }
            if (!result.hasMore) break;
        }
    }

    toPoints(): [number, number][] {
        return this.times.map((t, i) => [t, this.values[i]]);
    }
}
