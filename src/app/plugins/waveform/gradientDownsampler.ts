import type { Signal } from '@voltex-viewer/plugin-api';

export function createGradientDownsampler(
    maxPoints: number,
    timeBuffer: Float32Array,
    valueBuffer: Float32Array
) {
    return function gradientDownsampler(
        sequence: Signal,
        signalIndex: number,
        seqLen: number,
        gradientThreshold: number
    ) {
        let lastTime = sequence.time.valueAt(signalIndex);
        let lastValue = sequence.values.valueAt(signalIndex);
        timeBuffer[0] = lastTime;
        valueBuffer[0] = lastValue;
        signalIndex++;

        let lastGradient = Infinity;
        let bufferOffset = 0;

        for (; bufferOffset < maxPoints && signalIndex < seqLen; signalIndex++) {
            const time = sequence.time.valueAt(signalIndex);
            const value = sequence.values.valueAt(signalIndex);
            const gradient = (value - lastValue) / (time - lastTime);
            if (Math.abs(gradient - lastGradient) > gradientThreshold) {
                bufferOffset++;
                timeBuffer[bufferOffset] = time;
                valueBuffer[bufferOffset] = value;
                lastGradient = gradient;
            } else {
                timeBuffer[bufferOffset] = time;
                valueBuffer[bufferOffset] = value;
            }
            lastTime = time;
            lastValue = value;
        }

        if (signalIndex === seqLen && bufferOffset < maxPoints) {
            const time = sequence.time.valueAt(seqLen - 1);
            const value = sequence.values.valueAt(seqLen - 1);
            if (timeBuffer[bufferOffset] !== time || valueBuffer[bufferOffset] !== value) {
                bufferOffset++;
                timeBuffer[bufferOffset] = time;
                valueBuffer[bufferOffset] = value;
            }
            bufferOffset++;
        }

        return { bufferOffset, signalIndex };
    };

}
