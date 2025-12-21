import type { Signal } from '@voltex-viewer/plugin-api';
import type { Downsampler, DownsampleResult } from './types';
import { TimeValueBuffer } from './timeValueBuffer';

export function createRawDownsampler(
    signal: Signal,
    maxPoints: number
): Downsampler {
    const buffer = new TimeValueBuffer(maxPoints);

    const generator = (function* (): Generator<DownsampleResult, void, void> {
        let signalIndex = 0;

        while (true) {
            const seqLen = Math.min(signal.time.length, signal.values.length);

            if (signalIndex >= seqLen) {
                yield { hasMore: false };
                buffer.clear();
                continue;
            }

            while (signalIndex < seqLen && buffer.length < maxPoints) {
                buffer.append(signal.time.valueAt(signalIndex), signal.values.valueAt(signalIndex));
                signalIndex++;
            }

            yield { hasMore: signalIndex < seqLen };
            buffer.clear();
        }
    })();

    return Object.assign(generator, { buffer });
}
