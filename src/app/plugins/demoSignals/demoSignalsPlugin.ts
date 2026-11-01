import { PluginContext, RenderMode, Signal, SignalSource } from '@voltex-viewer/plugin-api';
import { FunctionTimeSequence, FunctionValueSequence, InMemoryFloat64Sequence, InMemorySequence, type Sequence, SequenceSignal } from '@voltex-viewer/signal-utils';
import * as t from 'io-ts';
import { AsyncSineSignal } from './asyncSineSignal';

const configSchema = t.type({
    realTimeLoading: t.boolean,
    asyncLodDelayMs: t.number,
});

function seededRandom(seed: number) {
    let state = seed;
    return () => {
        state = (state * 1664525 + 1013904223) % 4294967296;
        return state / 4294967296;
    };
}

// Never decreases, so samples don't disappear when real-time loading is turned on
function realTimeLength(length: () => number, samplesBy: (elapsed: number) => number, isRealTimeEnabled: () => boolean): () => number {
    const startTime = performance.now() / 1000;
    let maxExposedLength = 1;
    return () => {
        if (!isRealTimeEnabled()) {
            maxExposedLength = length();
        } else {
            const elapsed = performance.now() / 1000 - startTime;
            maxExposedLength = Math.max(maxExposedLength, Math.min(length(), samplesBy(elapsed)));
        }
        return maxExposedLength;
    };
}

// Shows the first `length()` samples, as though the rest haven't arrived yet
function prefix(sequence: Sequence, length: () => number): Sequence {
    const wrapped: Sequence = {
        get length() { return Math.min(sequence.length, length()); },
        valueAt: (index: number) => sequence.valueAt(index),
        get min() { return sequence.min; },
        get max() { return sequence.max; },
    };
    if (sequence.null !== undefined) wrapped.null = sequence.null;
    if (sequence.format) wrapped.format = value => sequence.format!(value);
    return wrapped;
}

function realTimeSignal(source: SignalSource, time: Sequence, values: Sequence, renderHint: RenderMode, isRealTimeEnabled: () => boolean): Signal {
    const length = Math.min(time.length, values.length);
    const exposed = realTimeLength(
        () => length,
        elapsed => {
            // Samples at or before the elapsed time
            let lo = 0;
            let hi = length;
            while (lo < hi) {
                const mid = (lo + hi) >>> 1;
                if (time.valueAt(mid) <= elapsed) lo = mid + 1;
                else hi = mid;
            }
            return lo;
        },
        isRealTimeEnabled,
    );
    return new SequenceSignal(source, prefix(time, exposed), prefix(values, exposed), renderHint);
}

function realTimeFunctionSignal(source: SignalSource, time: Sequence, generator: (time: number) => number, min: number, max: number, renderHint: RenderMode, isRealTimeEnabled: () => boolean): Signal {
    return realTimeSignal(source, time, new FunctionValueSequence(generator, time, min, max), renderHint, isRealTimeEnabled);
}

export default async (context: PluginContext) => {
    const config = context.loadConfig(configSchema, { realTimeLoading: false, asyncLodDelayMs: 30 });
    const isRealTimeEnabled = () => config.realTimeLoading;

    const freq = 1;
    const time = new FunctionTimeSequence(100, 100);

    let animationId: number | undefined;
    const startAnimation = () => {
        if (animationId !== undefined) return;
        const endTime = performance.now() + time.duration * 1000;
        const animate = () => {
            context.requestRender();
            if (performance.now() < endTime && config.realTimeLoading) {
                animationId = requestAnimationFrame(animate);
            } else {
                animationId = undefined;
            }
        };
        animationId = requestAnimationFrame(animate);
    };

    if (config.realTimeLoading) startAnimation();

    const squareWaveSource: SignalSource = {
        name: ['Demo Signals', 'Square Wave'],
        signal: () => Promise.resolve(realTimeFunctionSignal(
            squareWaveSource,
            time,
            (t: number) => Math.sin(2 * Math.PI * freq * t) >= 0 ? 1 : 0,
            0,
            1,
            RenderMode.Discrete,
            isRealTimeEnabled,
        )),
    };
    
    const triangleWaveSource: SignalSource = {
        name: ['Demo Signals', 'Triangle Wave'],
        signal: () => Promise.resolve(realTimeFunctionSignal(
            triangleWaveSource,
            time,
            (t: number) => 1000 * (2 * Math.abs(2 * (t * freq - Math.floor(t * freq + 0.5))) - 1),
            -1000,
            1000,
            RenderMode.Lines,
            isRealTimeEnabled,
        )),
    };
    
    const sawtoothWaveSource: SignalSource = {
        name: ['Demo Signals', 'Sawtooth Wave'],
        signal: () => Promise.resolve(realTimeFunctionSignal(
            sawtoothWaveSource,
            time,
            (t: number) => 2 * (t * freq - Math.floor(t * freq + 0.5)),
            -1,
            1,
            RenderMode.Lines,
            isRealTimeEnabled,
        )),
    };
    
    const sineWaveSource: SignalSource = {
        name: ['Demo Signals', 'Sine Wave'],
        signal: () => Promise.resolve(realTimeFunctionSignal(
            sineWaveSource,
            time,
            (t: number) => Math.sin(2 * Math.PI * freq * t),
            -1,
            1,
            RenderMode.Lines,
            isRealTimeEnabled,
        )),
    };
    
    const flatSignalSource: SignalSource = {
        name: ['Demo Signals', 'Flat Signal'],
        signal: () => Promise.resolve(realTimeFunctionSignal(
            flatSignalSource,
            time,
            (_t: number) => 0,
            0,
            0,
            RenderMode.Lines,
            isRealTimeEnabled,
        )),
    };
    
        const random = seededRandom(42);
    const randomTime = new InMemoryFloat64Sequence();
    let currentTime = 0;
    for (let i = 0; i < 100; i++) {
        randomTime.push(currentTime);
        const u = random();
        const gap = (u < 0.5 ? Math.sqrt(2 * u) / 2 : 1 - Math.sqrt(2 * (1 - u)) / 2) / 10;
        currentTime += gap;
    }

    const randomPoints: SignalSource = {
        name: ['Demo Signals', 'Random Points'],
                signal: () => {
            const values = new InMemorySequence();
            values.push(...Array.from({ length: randomTime.length }, () => random() * 2 - 1));
            return Promise.resolve(realTimeSignal(randomPoints, randomTime, values, RenderMode.Lines, isRealTimeEnabled));
        },
    };
    
    const trafficLightSource: SignalSource = {
        name: ['Demo Signals', 'Traffic Light'],
        signal: () => {
            const timeSeq = new InMemoryFloat64Sequence();
            const valueSeq = new InMemorySequence((value: number) => {
                if (value === 0) return 'stop';
                if (value === 1) return 'wait';
                if (value === 2) return 'go';
                if (value === 3) return 'transitioning';
                return 'unknown';
            });
            
            const states = [
                { value: 0, duration: 4.5 }, // stop - 4.5s
                { value: 3, duration: 100e-9 }, // Small delay to test zooming
                { value: 1, duration: 0.5 }, // wait - 0.5s
                { value: 3, duration: 200e-9 }, // Small delay to test zooming
                { value: 2, duration: 3 }, // go - 3s
                { value: 3, duration: 300e-9 }, // Small delay to test zooming
                { value: 1, duration: 0.3 }, // wait - 0.3s
                { value: 3, duration: 500e-9 }, // Small delay to test zooming
                { value: 0, duration: 6 }, // stop - 6s
                { value: 3, duration: 500e-9 }, // Small delay to test zooming
                { value: 1, duration: 0.4 }, // wait - 0.4s
                { value: 3, duration: 600e-9 }, // Small delay to test zooming
                { value: 2, duration: 2.5 }, // go - 2.5s
                { value: 3, duration: 700e-9 }, // Small delay to test zooming
                { value: 1, duration: 0.6 }, // wait - 0.6s
                { value: 3, duration: 800e-9 }, // Small delay to test zooming
            ];
            
            let currentTime = 0;
            const cycleCount = 5; // Repeat the pattern 5 times
            for (let cycle = 0; cycle < cycleCount; cycle++) {
                for (const state of states) {
                    for (let t = 0; t < state.duration; t += 0.1) {
                        timeSeq.push(currentTime + t);
                        valueSeq.push(state.value);
                    }
                    currentTime += state.duration;
                }
            }
            
            return Promise.resolve(realTimeSignal(trafficLightSource, timeSeq, valueSeq, RenderMode.Enum, isRealTimeEnabled));
        },
    };

    const sineWithGapsSource: SignalSource = {
        name: ['Demo Signals', 'Sine with Gaps'],
        signal: () => {
            const timeSeq = new InMemoryFloat64Sequence();
            const valueSeq = new InMemorySequence();
            const nullValue = 999;
            valueSeq.null = nullValue;
            
            for (let i = 0; i < time.length; i++) {
                const t = time.valueAt(i);
                timeSeq.push(t);
                // Create gaps every 2 seconds for 0.5 seconds
                const cyclePos = t % 2;
                if (cyclePos > 1.5 && cyclePos < 2.0) {
                    valueSeq.push(nullValue);
                } else {
                    valueSeq.push(Math.sin(2 * Math.PI * freq * t));
                }
            }
            
            return Promise.resolve(realTimeSignal(sineWithGapsSource, timeSeq, valueSeq, RenderMode.Lines, isRealTimeEnabled));
        },
    };

    const blipSource: SignalSource = {
        name: ['Demo Signals', 'Blip'],
        signal: () => {
            const timeSeq = new InMemoryFloat64Sequence();
            const valueSeq = new InMemorySequence((value: number) => {
                if (value === 0) return 'blip';
                return 'unknown';
            });
            
            timeSeq.push(0);
            valueSeq.push(0);
            
            return Promise.resolve(realTimeSignal(blipSource, timeSeq, valueSeq, RenderMode.Enum, isRealTimeEnabled));
        },
    };

        // Far too many samples to keep in memory, so it only exists as tiles, like a remote source
    const asyncSineSource: SignalSource = {
        name: ['Demo Signals', 'Async LOD Sine'],
        signal: () => {
            const sampleRate = 1e9;
            const length = 100 * sampleRate;
            const loadedLength = realTimeLength(
                () => length,
                elapsed => Math.floor(elapsed * sampleRate) + 1,
                isRealTimeEnabled,
            );
            return Promise.resolve(new AsyncSineSignal(asyncSineSource, sampleRate, sampleRate / 1000, length, () => config.asyncLodDelayMs, loadedLength));
        },
    };

    const sources = [squareWaveSource, triangleWaveSource, sawtoothWaveSource, sineWaveSource, sineWithGapsSource, flatSignalSource, randomPoints, trafficLightSource, blipSource, asyncSineSource];
    
    context.signalSources.add(sources);
    context.createRows(...await Promise.all(sources.map(async source => ({ channels: [await source.signal()] }))));
}

