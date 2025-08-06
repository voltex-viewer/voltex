import { PluginContext, SignalSource } from '../../Plugin';
import { FunctionSignal } from '../../Signal';

export default (context: PluginContext): void => {
    const squareWaveSource: SignalSource = {
        name: ['Demo Signals', 'Square Wave'],
        discrete: true,
        signal: () => new FunctionSignal('Square Wave', (t: number) => 
            Math.sign(Math.sin(2 * Math.PI * context.signal.freq * t)), squareWaveSource)
    };
    
    const triangleWaveSource: SignalSource = {
        name: ['Demo Signals', 'Triangle Wave'],
        discrete: false,
        signal: () => new FunctionSignal('Triangle Wave', (t: number) => 
            10 * (2 * Math.abs(2 * (t * context.signal.freq - Math.floor(t * context.signal.freq + 0.5))) - 1), triangleWaveSource
        )
    };
    
    const sawtoothWaveSource: SignalSource = {
        name: ['Demo Signals', 'Sawtooth Wave'],
        discrete: false,
        signal: () => new FunctionSignal('Sawtooth Wave', (t: number) => 
            2 * (t * context.signal.freq - Math.floor(t * context.signal.freq + 0.5)), sawtoothWaveSource
        )
    };
    
    const sineWaveSource: SignalSource = {
        name: ['Demo Signals', 'Sine Wave'],
        discrete: false,
        signal: () => new FunctionSignal('Sine Wave', (t: number) => 
            Math.sin(2 * Math.PI * context.signal.freq * t), sineWaveSource
        )
    };
    
    const sources = [squareWaveSource, triangleWaveSource, sawtoothWaveSource, sineWaveSource];
    
    context.signalSources.add(...sources);
    context.createRows(...sources.map(source => ({ channels: [source.signal()] })));
}
