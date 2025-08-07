import { PluginContext, SignalSource } from '../../Plugin';
import { FunctionSignal } from '../../Signal';

export default (context: PluginContext): void => {
    const squareWaveSource: SignalSource = {
        name: ['Demo Signals', 'Square Wave'],
        discrete: true,
        signal: () => new FunctionSignal(
            squareWaveSource,
            (t: number) => Math.sin(2 * Math.PI * context.signal.freq * t) >= 0 ? 1 : -1,
            -1,
            1
        )
    };
    
    const triangleWaveSource: SignalSource = {
        name: ['Demo Signals', 'Triangle Wave'],
        discrete: false,
        signal: () => new FunctionSignal(
            triangleWaveSource,
            (t: number) => 10 * (2 * Math.abs(2 * (t * context.signal.freq - Math.floor(t * context.signal.freq + 0.5))) - 1),
            -10,
            10
        )
    };
    
    const sawtoothWaveSource: SignalSource = {
        name: ['Demo Signals', 'Sawtooth Wave'],
        discrete: false,
        signal: () => new FunctionSignal(
            sawtoothWaveSource,
            (t: number) => 2 * (t * context.signal.freq - Math.floor(t * context.signal.freq + 0.5)),
            -1,
            1
        )
    };
    
    const sineWaveSource: SignalSource = {
        name: ['Demo Signals', 'Sine Wave'],
        discrete: false,
        signal: () => new FunctionSignal(
            sineWaveSource,
            (t: number) => Math.sin(2 * Math.PI * context.signal.freq * t),
            -1,
            1
        )
    };
    
    const sources = [squareWaveSource, triangleWaveSource, sawtoothWaveSource, sineWaveSource];
    
    context.signalSources.add(...sources);
    context.createRows(...sources.map(source => ({ channels: [source.signal()] })));
}
