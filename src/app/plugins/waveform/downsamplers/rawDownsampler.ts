import type { Signal } from '@voltex-viewer/plugin-api';
import type { Downsampler, DownsampleResult } from './types';

export function createRawDownsampler(
    signal: Signal,
    maxPoints: number
): Downsampler {
    const timeBuffer = new Float32Array(maxPoints);
    const valueBuffer = new Float32Array(maxPoints);

    const generator = (function* (): Generator<DownsampleResult, void, void> {
        let signalIndex = 0;
        let bufferOffset = 0;

        while (true) {
            const seqLen = Math.min(signal.time.length, signal.values.length);

            if (signalIndex >= seqLen) {
                yield { bufferOffset, hasMore: false };
                bufferOffset = 0;
                continue;
            }

            while (signalIndex < seqLen && bufferOffset < maxPoints) {
                timeBuffer[bufferOffset] = signal.time.valueAt(signalIndex);
                valueBuffer[bufferOffset] = signal.values.valueAt(signalIndex);
                bufferOffset++;
                signalIndex++;
            }

            yield { bufferOffset, hasMore: signalIndex < seqLen };
            bufferOffset = 0;
        }
    })();

    return Object.assign(generator, { timeBuffer, valueBuffer });
}
