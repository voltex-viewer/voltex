import { PluginContext, RenderMode, SignalSource } from '@voltex-viewer/plugin-api';
import { FunctionSignal, FunctionTimeSequence, InMemorySequence, SequenceSignal } from '@voltex-viewer/plugin-api';

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
            
            // Add final point
            timeSeq.push(currentTime);
            valueSeq.push(0);
            
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

    const sources = [squareWaveSource, triangleWaveSource, sawtoothWaveSource, sineWaveSource, trafficLightSource];
    
    context.signalSources.add(...sources);
    context.createRows(...sources.map(source => ({ channels: [source.signal()] })));
}

