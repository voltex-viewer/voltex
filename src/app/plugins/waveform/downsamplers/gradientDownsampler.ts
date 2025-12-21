import type { Signal } from '@voltex-viewer/plugin-api';
import type { Downsampler, DownsampleResult } from './types';
import { TimeValueBuffer } from './timeValueBuffer';

export function createGradientDownsampler(
    signal: Signal,
    gradientThreshold: number,
    maxPoints: number
): Downsampler {
    const buffer = new TimeValueBuffer(maxPoints + 1);

    const generator = (function* (): Generator<DownsampleResult, void, void> {
        let signalIndex = 0;
        let lastTime = 0;
        let lastValue = 0;
        let lastGradient = Infinity;

        while (true) {
            let seqLen = Math.min(signal.time.length, signal.values.length);

            while (signalIndex >= seqLen) {
                yield { hasMore: false };
                seqLen = Math.min(signal.time.length, signal.values.length);
            }

            if (signalIndex === 0) {
                lastTime = signal.time.valueAt(0);
                lastValue = signal.values.valueAt(0);
                signalIndex = 1;
            }

            while (signalIndex < seqLen) {
                const time = signal.time.valueAt(signalIndex);
                const value = signal.values.valueAt(signalIndex);
                const gradient = (value - lastValue) / (time - lastTime);

                if (Math.abs(gradient - lastGradient) > gradientThreshold) {
                    if (buffer.length === maxPoints) {
                        yield { hasMore: true };
                        buffer.clear();
                    }
                    buffer.append(lastTime, lastValue);
                    lastGradient = gradient;
                }
                lastTime = time;
                lastValue = value;
                signalIndex++;
            }

            buffer.append(lastTime, lastValue);
            yield { hasMore: false, overwriteNext: true };
            buffer.clear();
        }
    })();

    return Object.assign(generator, { buffer });
}
