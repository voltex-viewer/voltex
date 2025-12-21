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
            const bufferLength = downsampler.buffer.length;

            if (this.lastOverwriteNext && bufferLength > 0 && this.times.length > 0) {
                this.times.pop();
                this.values.pop();
            }

            for (let i = 0; i < bufferLength; i++) {
                // Reconstruct time from high + low parts
                this.times.push(downsampler.buffer.timeHighBuffer[i] + downsampler.buffer.timeLowBuffer[i]);
                this.values.push(downsampler.buffer.valueBuffer[i]);
            }

            if (bufferLength > 0) {
                this.lastOverwriteNext = result.overwriteNext ?? false;
            }
            if (!result.hasMore) break;
        }
    }

    toPoints(): [number, number][] {
        return this.times.map((t, i) => [t, this.values[i]]);
    }
}
