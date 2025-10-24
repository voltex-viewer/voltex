import { InMemorySequence, SequenceSignal, SignalSource, PluginContext, RenderMode, Signal, Sequence } from '@voltex-viewer/plugin-api';

class CsvSource implements SignalSource {
    constructor(public readonly name: string[], private _signal: Signal, private textValueCount: number) {}

    get renderHint(): RenderMode {
        return this.textValueCount >= 2 ? RenderMode.Enum : RenderMode.Lines;
    }

    signal(): Signal {
        return this._signal;
    }
}

export default (context: PluginContext): void => {
    context.registerFileOpenHandler({
        extensions: ['.csv'],
        description: 'CSV Files (Sparse Format)',
        mimeType: 'text/csv',
        handler: async (file: File) => {
            const start = performance.now();
            const text = await file.text();
            const lines = text.split('\n').filter(line => line.trim());
            
            if (lines.length < 2) {
                throw new Error('CSV file must have at least a header row and one data row');
            }

            const headers = lines[0].split(',').map(h => h.trim());
            if (headers.length < 2) {
                throw new Error('CSV file must have at least a timestamp column and one signal column');
            }

            const signalHeaders = headers.slice(1);
            
            const signalSequences = signalHeaders.map(() => ({
                time: new InMemorySequence(),
                numericValues: [] as number[],
                textValues: [] as (number | string)[],
                allNumericValues: new Set<number>()
            }));

            for (let i = 1; i < lines.length; i++) {
                const values = lines[i].split(',');
                if (values.length !== headers.length) {
                    continue;
                }

                const timestamp = parseFloat(values[0]);
                if (isNaN(timestamp)) {
                    continue;
                }

                for (let j = 0; j < signalHeaders.length; j++) {
                    const valueStr = values[j + 1].trim();
                    if (valueStr !== '') {
                        const numValue = parseFloat(valueStr);
                        if (!isNaN(numValue)) {
                            signalSequences[j].time.push(timestamp);
                            signalSequences[j].numericValues.push(numValue);
                            signalSequences[j].textValues.push(numValue);
                            signalSequences[j].allNumericValues.add(numValue);
                        } else {
                            signalSequences[j].time.push(timestamp);
                            signalSequences[j].numericValues.push(0);
                            signalSequences[j].textValues.push(valueStr);
                        }
                    }
                }
            }

            const sources: SignalSource[] = [];
            for (let i = 0; i < signalHeaders.length; i++) {
                const name = [file.name, signalHeaders[i]];
                const seq = signalSequences[i];
                
                const hasTextValues = seq.textValues.some(v => typeof v === 'string');
                
                if (hasTextValues) {
                    const maxNumeric = seq.allNumericValues.size > 0 ? Math.max(...seq.allNumericValues) : -1;
                    let nextCode = Math.floor(maxNumeric) + 1;
                    const textToCode = new Map<string, number>();
                    const codeToText = new Map<number, string>();
                    
                    for (const value of seq.textValues) {
                        if (typeof value === 'string' && !textToCode.has(value)) {
                            while (seq.allNumericValues.has(nextCode)) {
                                nextCode++;
                            }
                            textToCode.set(value, nextCode);
                            codeToText.set(nextCode, value);
                            nextCode++;
                        }
                    }
                    
                    const valuesSeq = new InMemorySequence((value: number) => codeToText.get(value) ?? value);
                    for (const value of seq.textValues) {
                        const numValue = typeof value === 'string' ? textToCode.get(value)! : value;
                        valuesSeq.push(numValue);
                    }
                    
                    const signal = new SequenceSignal(null as any, seq.time, valuesSeq);
                    const source = new CsvSource(name, signal, codeToText.size);
                    (signal as any).source = source;
                    sources.push(source);
                } else {
                    const valuesSeq = new InMemorySequence();
                    for (const value of seq.numericValues) {
                        valuesSeq.push(value);
                    }
                    const signal = new SequenceSignal(null as any, seq.time, valuesSeq);
                    const source = new CsvSource(name, signal, 0);
                    (signal as any).source = source;
                    sources.push(source);
                }
            }

            console.log(`Loaded ${sources.length} signal sources from ${file.name} in ${(performance.now() - start).toFixed(1)} ms`);
            context.signalSources.add(...sources);
        }
    });

    context.registerFileSaveHandler({
        extensions: ['.csv'],
        description: 'CSV Files (Sparse Format)',
        mimeType: 'text/csv',
        handler: async (file: FileSystemWritableFileStream) => {
            const signals = context.getRows().flatMap(row => row.signals);
            
            if (signals.length === 0) {
                throw new Error('No signals to save');
            }

            const allTimestamps = new Set<number>();
            for (const signal of signals) {
                for (let i = 0; i < signal.time.length; i++) {
                    allTimestamps.add(signal.time.valueAt(i));
                }
            }

            const sortedTimestamps = Array.from(allTimestamps).sort((a, b) => a - b);

            const signalNames = signals.map(s => s.source.name.join('.'));
            const header = ['timestamp', ...signalNames].join(',') + '\n';

            const writer = file.getWriter();
            try {
                const BUFFER_SIZE = 8192;
                let buffer = header;

                const signalIndices = signals.map(() => 0);

                for (const timestamp of sortedTimestamps) {
                    const row = [timestamp.toString()];
                    
                    for (let i = 0; i < signals.length; i++) {
                        const signal = signals[i];
                        let value = '';
                        
                        if (signalIndices[i] < signal.time.length) {
                            const signalTimestamp = signal.time.valueAt(signalIndices[i]);
                            if (signalTimestamp === timestamp) {
                                const convertedValue = signal.values.convertedValueAt(signalIndices[i]);
                                value = convertedValue.toString();
                                signalIndices[i]++;
                            }
                        }
                        
                        row.push(value);
                    }
                    
                    buffer += row.join(',') + '\n';

                    if (buffer.length >= BUFFER_SIZE) {
                        await writer.write(buffer);
                        buffer = '';
                    }
                }

                if (buffer.length > 0) {
                    await writer.write(buffer);
                }
            } finally {
                await writer.close();
            }
        }
    });
};
