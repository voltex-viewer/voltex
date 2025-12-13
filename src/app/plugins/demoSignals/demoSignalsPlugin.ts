import { InMemorySequence, InMemorySignal, PluginContext, RenderMode, Signal, SignalSource } from '@voltex-viewer/plugin-api';
import { FunctionSignal, FunctionTimeSequence, SequenceSignal } from '@voltex-viewer/plugin-api';

function seededRandom(seed: number) {
    let state = seed;
    return () => {
        state = (state * 1664525 + 1013904223) % 4294967296;
        return state / 4294967296;
    };
}

function wrapRealTimeSignal(signal: Signal): Signal {
    const startTime = performance.now() / 1000;
    
    const getExposedLength = () => {
        const elapsed = performance.now() / 1000 - startTime;
        let count = 0;
        while (count < signal.time.length && signal.time.valueAt(count) <= elapsed) {
            count++;
        }
        return Math.max(1, count);
    };

    return {
        source: signal.source,
        time: {
            get length() { return getExposedLength(); },
            valueAt: (index: number) => signal.time.valueAt(index),
            min: signal.time.min,
            get max() { return signal.time.valueAt(getExposedLength() - 1); },
        },
        values: {
            get length() { return getExposedLength(); },
            valueAt: (index: number) => signal.values.valueAt(index),
            convertedValueAt: (index: number) => signal.values.convertedValueAt?.(index) ?? signal.values.valueAt(index),
            min: signal.values.min,
            max: signal.values.max,
        },
        renderHint: signal.renderHint,
    };
}

export default async (context: PluginContext) => {
    const freq = 1;
    const time = new FunctionTimeSequence(100, 100);

    const interval = setInterval(() => context.requestRender(), 100);
    setTimeout(() => clearInterval(interval), time.duration * 1000);

    const squareWaveSource: SignalSource = {
        name: ['Demo Signals', 'Square Wave'],
        signal: () => Promise.resolve(wrapRealTimeSignal(new FunctionSignal(
            squareWaveSource,
            time,
            (t: number) => Math.sin(2 * Math.PI * freq * t) >= 0 ? 1 : 0,
            0,
            1,
            RenderMode.Discrete
        ))),
    };
    
    const triangleWaveSource: SignalSource = {
        name: ['Demo Signals', 'Triangle Wave'],
        signal: () => Promise.resolve(wrapRealTimeSignal(new FunctionSignal(
            triangleWaveSource,
            time,
            (t: number) => 1000 * (2 * Math.abs(2 * (t * freq - Math.floor(t * freq + 0.5))) - 1),
            -1000,
            1000,
            RenderMode.Lines,
        ))),
    };
    
    const sawtoothWaveSource: SignalSource = {
        name: ['Demo Signals', 'Sawtooth Wave'],
        signal: () => Promise.resolve(wrapRealTimeSignal(new FunctionSignal(
            sawtoothWaveSource,
            time,
            (t: number) => 2 * (t * freq - Math.floor(t * freq + 0.5)),
            -1,
            1,
            RenderMode.Lines,
        ))),
    };
    
    const sineWaveSource: SignalSource = {
        name: ['Demo Signals', 'Sine Wave'],
        signal: () => Promise.resolve(wrapRealTimeSignal(new FunctionSignal(
            sineWaveSource,
            time,
            (t: number) => Math.sin(2 * Math.PI * freq * t),
            -1,
            1,
            RenderMode.Lines,
        ))),
    };
    
    const flatSignalSource: SignalSource = {
        name: ['Demo Signals', 'Flat Signal'],
        signal: () => Promise.resolve(wrapRealTimeSignal(new FunctionSignal(
            flatSignalSource,
            time,
            (_t: number) => 0,
            0,
            0,
            RenderMode.Lines,
        ))),
    };
    
    const random = seededRandom(42);
    const randomTime = new InMemorySequence();
    let currentTime = 0;
    for (let i = 0; i < 100; i++) {
        randomTime.push(currentTime);
        const u = random();
        const gap = (u < 0.5 ? Math.sqrt(2 * u) / 2 : 1 - Math.sqrt(2 * (1 - u)) / 2) / 10;
        currentTime += gap;
    }

    const randomPoints: SignalSource = {
        name: ['Demo Signals', 'Random Points'],
        signal: () => Promise.resolve(wrapRealTimeSignal(new InMemorySignal(
            randomPoints,
            Array.from({ length: randomTime.length }, (_, i) => [randomTime.valueAt(i), random() * 2 - 1] as [number, number]),
            RenderMode.Lines,
        ))),
    };
    
    const trafficLightSource: SignalSource = {
        name: ['Demo Signals', 'Traffic Light'],
        signal: () => {
            const timeSeq = new InMemorySequence();
            const valueSeq = new InMemorySequence((value: number) => {
                if (value === 0) return 'stop';
                if (value === 1) return 'wait';
                if (value === 2) return 'go';
                return 'unknown';
            });
            
            const states = [
                { value: 0, duration: 4.5 }, // stop - 4.5s
                { value: 1, duration: 0.5 }, // wait - 0.5s
                { value: 2, duration: 3 }, // go - 3s
                { value: 1, duration: 0.3 }, // wait - 0.3s
                { value: 0, duration: 6 }, // stop - 6s
                { value: 1, duration: 0.4 }, // wait - 0.4s
                { value: 2, duration: 2.5 }, // go - 2.5s
                { value: 1, duration: 0.6 }, // wait - 0.6s
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
            
            return Promise.resolve(wrapRealTimeSignal(new SequenceSignal(trafficLightSource, timeSeq, valueSeq, RenderMode.Enum)));
        },
    };

    const sources = [squareWaveSource, triangleWaveSource, sawtoothWaveSource, sineWaveSource, flatSignalSource, randomPoints, trafficLightSource];
    
    context.signalSources.add(sources);
    context.createRows(...await Promise.all(sources.map(async source => ({ channels: [await source.signal()] }))));
}

