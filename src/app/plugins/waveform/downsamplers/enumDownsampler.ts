import type { Signal } from '@voltex-viewer/plugin-api';
import type { Downsampler, DownsampleResult } from './types';

export function createEnumDownsampler(
    signal: Signal,
    maxPoints: number
): Downsampler {
    const timeBuffer = new Float32Array(maxPoints + 1);
    const valueBuffer = new Float32Array(maxPoints + 1);

    const generator = (function* (): Generator<DownsampleResult, void, void> {
        let signalIndex = 0;
        let bufferOffset = 0;
        let lastValue = NaN;

        while (true) {
            let seqLen = Math.min(signal.time.length, signal.values.length);

            while (signalIndex >= seqLen) {
                yield { bufferOffset, hasMore: false };
                seqLen = Math.min(signal.time.length, signal.values.length);
            }

            if (signalIndex === 0) {
                lastValue = signal.values.valueAt(0);
                timeBuffer[0] = signal.time.valueAt(0);
                valueBuffer[0] = lastValue;
                bufferOffset = 1;
                signalIndex = 1;
            }

            while (signalIndex < seqLen) {
                const value = signal.values.valueAt(signalIndex);
                if (value !== lastValue) {
                    timeBuffer[bufferOffset] = signal.time.valueAt(signalIndex);
                    valueBuffer[bufferOffset] = value;
                    lastValue = value;
                    bufferOffset++;
                    if (bufferOffset === maxPoints + 1) {
                        yield { bufferOffset: bufferOffset - 1, hasMore: true };
                        timeBuffer[0] = timeBuffer[bufferOffset - 1];
                        valueBuffer[0] = valueBuffer[bufferOffset - 1];
                        bufferOffset = 1;
                    }
                }
                signalIndex++;
            }

            // Add trailing point if time advanced since last committed point
            const trailingTime = signal.time.valueAt(seqLen - 1);
            if (trailingTime !== timeBuffer[bufferOffset - 1]) {
                timeBuffer[bufferOffset] = trailingTime;
                valueBuffer[bufferOffset] = lastValue;
                bufferOffset++;
                yield { bufferOffset, hasMore: false, overwriteNext: true };
            } else {
                yield { bufferOffset, hasMore: false };
            }
            bufferOffset = 0;
        }
    })();

    return Object.assign(generator, { timeBuffer, valueBuffer });
}
