import { PluginContext, SignalSource } from '../../Plugin';
import { FunctionSignal, FunctionTimeSequence } from '../../Signal';

export default (context: PluginContext): void => {
    const freq = 1;
    const time = new FunctionTimeSequence(1000, 1000);

    const squareWaveSource: SignalSource = {
        name: ['Demo Signals', 'Square Wave'],
        discrete: true,
        signal: () => new FunctionSignal(
            squareWaveSource,
            time,
            (t: number) => Math.sin(2 * Math.PI * freq * t) >= 0 ? 1 : 0,
            0,
            1
        )
    };
    
    const triangleWaveSource: SignalSource = {
        name: ['Demo Signals', 'Triangle Wave'],
        discrete: false,
        signal: () => new FunctionSignal(
            triangleWaveSource,
            time,
            (t: number) => 1000 * (2 * Math.abs(2 * (t * freq - Math.floor(t * freq + 0.5))) - 1),
            -1000,
            1000
        )
    };
    
    const sawtoothWaveSource: SignalSource = {
        name: ['Demo Signals', 'Sawtooth Wave'],
        discrete: false,
        signal: () => new FunctionSignal(
            sawtoothWaveSource,
            time,
            (t: number) => 2 * (t * freq - Math.floor(t * freq + 0.5)),
            -1,
            1
        )
    };
    
    const sineWaveSource: SignalSource = {
        name: ['Demo Signals', 'Sine Wave'],
        discrete: false,
        signal: () => new FunctionSignal(
            sineWaveSource,
            time,
            (t: number) => Math.sin(2 * Math.PI * freq * t),
            -1,
            1
        )
    };
    
    const sources = [squareWaveSource, triangleWaveSource, sawtoothWaveSource, sineWaveSource];
    
    context.signalSources.add(...sources);
    context.createRows(...sources.map(source => ({ channels: [source.signal()] })));
}
