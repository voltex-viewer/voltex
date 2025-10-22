import { InMemorySequence, InMemorySignal, PluginContext, RenderMode, SignalSource } from '@voltex-viewer/plugin-api';
import { FunctionSignal, FunctionTimeSequence, SequenceSignal } from '@voltex-viewer/plugin-api';

function seededRandom(seed: number) {
    let state = seed;
    return () => {
        state = (state * 1664525 + 1013904223) % 4294967296;
        return state / 4294967296;
    };
}

export default (context: PluginContext): void => {
    const freq = 1;
    const time = new FunctionTimeSequence(1000, 1000);

    const squareWaveSource: SignalSource = {
        name: ['Demo Signals', 'Square Wave'],
        signal: () => new FunctionSignal(
            squareWaveSource,
            time,
            (t: number) => Math.sin(2 * Math.PI * freq * t) >= 0 ? 1 : 0,
            0,
            1
        ),
        renderHint: RenderMode.Discrete,
    };
    
    const triangleWaveSource: SignalSource = {
        name: ['Demo Signals', 'Triangle Wave'],
        signal: () => new FunctionSignal(
            triangleWaveSource,
            time,
            (t: number) => 1000 * (2 * Math.abs(2 * (t * freq - Math.floor(t * freq + 0.5))) - 1),
            -1000,
            1000
        ),
        renderHint: RenderMode.Lines,
    };
    
    const sawtoothWaveSource: SignalSource = {
        name: ['Demo Signals', 'Sawtooth Wave'],
        signal: () => new FunctionSignal(
            sawtoothWaveSource,
            time,
            (t: number) => 2 * (t * freq - Math.floor(t * freq + 0.5)),
            -1,
            1
        ),
        renderHint: RenderMode.Lines,
    };
    
    const sineWaveSource: SignalSource = {
        name: ['Demo Signals', 'Sine Wave'],
        signal: () => new FunctionSignal(
            sineWaveSource,
            time,
            (t: number) => Math.sin(2 * Math.PI * freq * t),
            -1,
            1
        ),
        renderHint: RenderMode.Lines,
    };
    
    const flatSignalSource: SignalSource = {
        name: ['Demo Signals', 'Flat Signal'],
        signal: () => new FunctionSignal(
            flatSignalSource,
            time,
            (t: number) => 0,
            0,
            0
        ),
        renderHint: RenderMode.Lines,
    };
    
    const random = seededRandom(42);
    const randomTime = new InMemorySequence();
    // Random time has 100 points with a random gap (from 0-1 seconds) after each point
    // Distribution favors values near 0 and 1 (U-shaped)
    let currentTime = 0;
    for (let i = 0; i < 100; i++) {
        randomTime.push(currentTime);
        const u = random();
        const gap = u < 0.5 ? Math.sqrt(2 * u) / 2 : 1 - Math.sqrt(2 * (1 - u)) / 2;
        currentTime += gap;
    }

    const randomPoints: SignalSource = {
        name: ['Demo Signals', 'Random Points'],
        signal: () => new InMemorySignal(
            randomPoints,
            Array.from({ length: randomTime.length }, (_, i) => [randomTime.valueAt(i), random() * 2 - 1] as [number, number])
        ),
        renderHint: RenderMode.Lines,
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
            
            // Define the states and their varied durations
            const states = [
                { value: 0, duration: 45 },   // stop - 45s
                { value: 1, duration: 5 },    // wait - 5s
                { value: 2, duration: 30 },   // go - 30s
                { value: 1, duration: 3 },    // wait - 3s
                { value: 0, duration: 60 },   // stop - 60s
                { value: 1, duration: 4 },    // wait - 4s
                { value: 2, duration: 25 },   // go - 25s
                { value: 1, duration: 6 },    // wait - 6s
            ];
            
            let currentTime = 0;
            const cycleCount = 5; // Repeat the pattern 5 times
            
            for (let cycle = 0; cycle < cycleCount; cycle++) {
                for (const state of states) {
                    // Add data points every second for this state
                    for (let t = 0; t < state.duration; t++) {
                        timeSeq.push(currentTime + t);
                        valueSeq.push(state.value);
                    }
                    currentTime += state.duration;
                }
            }
            
            const signal = new SequenceSignal(trafficLightSource, timeSeq, valueSeq);
            (signal.values as any).textValues = [
                { text: 'stop', value: 0 },
                { text: 'wait', value: 1 },
                { text: 'go', value: 2 },
            ];
            
            return signal;
        },
        renderHint: RenderMode.Enum,
    };

    const sources = [squareWaveSource, triangleWaveSource, sawtoothWaveSource, sineWaveSource, flatSignalSource, randomPoints, trafficLightSource];
    
    context.signalSources.add(...sources);
    context.createRows(...sources.map(source => ({ channels: [source.signal()] })));
}

