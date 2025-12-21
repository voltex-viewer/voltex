import type { Signal } from '@voltex-viewer/plugin-api';
import type { Downsampler, DownsampleResult } from './types';
import { TimeValueBuffer } from './timeValueBuffer';

export function createEnumDownsampler(
    signal: Signal,
    maxPoints: number
): Downsampler {
    const buffer = new TimeValueBuffer(maxPoints + 1);

    const generator = (function* (): Generator<DownsampleResult, void, void> {
        let signalIndex = 0;
        let lastValue = NaN;
        let lastCommittedTime = 0;

        while (true) {
            let seqLen = Math.min(signal.time.length, signal.values.length);

            while (signalIndex >= seqLen) {
                yield { hasMore: false };
                seqLen = Math.min(signal.time.length, signal.values.length);
            }

            if (signalIndex === 0) {
                lastValue = signal.values.valueAt(0);
                lastCommittedTime = signal.time.valueAt(0);
                buffer.append(lastCommittedTime, lastValue);
                signalIndex = 1;
            }

            while (signalIndex < seqLen) {
                const value = signal.values.valueAt(signalIndex);
                if (value !== lastValue) {
                    if (buffer.length === maxPoints) {
                        yield { hasMore: true };
                        buffer.clear();
                    }
                    lastCommittedTime = signal.time.valueAt(signalIndex);
                    buffer.append(lastCommittedTime, value);
                    lastValue = value;
                }
                signalIndex++;
            }

            const trailingTime = signal.time.valueAt(seqLen - 1);
            if (trailingTime !== lastCommittedTime) {
                buffer.append(trailingTime, lastValue);
                yield { hasMore: false, overwriteNext: true };
            } else {
                yield { hasMore: false };
            }
            buffer.clear();
        }
    })();

    return Object.assign(generator, { buffer });
}
