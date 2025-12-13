import type { Signal } from '@voltex-viewer/plugin-api';
import type { Downsampler, DownsampleResult } from './types';

export function createGradientDownsampler(
    signal: Signal,
    gradientThreshold: number,
    maxPoints: number
): Downsampler {
    const timeBuffer = new Float32Array(maxPoints + 1);
    const valueBuffer = new Float32Array(maxPoints + 1);

    const generator = (function* (): Generator<DownsampleResult, void, void> {
        let signalIndex = 0;
        let bufferOffset = 0;
        let lastTime = 0;
        let lastValue = 0;
        let lastGradient = Infinity;

        while (true) {
            let seqLen = Math.min(signal.time.length, signal.values.length);

            while (signalIndex >= seqLen) {
                yield { bufferOffset, hasMore: false };
                seqLen = Math.min(signal.time.length, signal.values.length);
            }

            // Handle first point specially
            if (signalIndex === 0) {
                lastTime = signal.time.valueAt(0);
                lastValue = signal.values.valueAt(0);
                timeBuffer[0] = lastTime;
                valueBuffer[0] = lastValue;
                signalIndex = 1;
            }

            while (signalIndex < seqLen) {
                const time = signal.time.valueAt(signalIndex);
                const value = signal.values.valueAt(signalIndex);
                const gradient = (value - lastValue) / (time - lastTime);

                if (Math.abs(gradient - lastGradient) > gradientThreshold) {
                    // Gradient changed - commit the previous point
                    timeBuffer[bufferOffset] = lastTime;
                    valueBuffer[bufferOffset] = lastValue;
                    bufferOffset++;
                    if (bufferOffset === maxPoints + 1) {
                        yield { bufferOffset: bufferOffset - 1, hasMore: true };
                        timeBuffer[0] = lastTime;
                        valueBuffer[0] = lastValue;
                        bufferOffset = 1;
                    }
                    lastGradient = gradient;
                }
                lastTime = time;
                lastValue = value;
                signalIndex++;
            }

            // End of current data - commit trailing point
            timeBuffer[bufferOffset] = lastTime;
            valueBuffer[bufferOffset] = lastValue;
            bufferOffset++;
            yield { bufferOffset, hasMore: false, overwriteNext: true };
            // Reset buffer; lastTime/lastValue hold the trailing point for continuation
            bufferOffset = 0;
        }
    })();

    return Object.assign(generator, { timeBuffer, valueBuffer });
}
