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
            context.signalSources.add(sources);
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

            const signalNames = signals.map(s => s.source.name.slice(1).join('.'));
            const header = 'timestamp,' + signalNames.join(',') + '\n';

            const writer = file.getWriter();
            try {
                await writer.write(header);

                const BUFFER_SIZE = 1024 * 1024;
                let buffer = '';

                const signalData = signals.map(s => ({
                    time: s.time,
                    values: s.values,
                    index: 0,
                    length: s.time.length
                }));

                const rows: Map<number, string[][]> = new Map();
                
                for (let i = 0; i < signalData.length; i++) {
                    const data = signalData[i];
                    for (let j = 0; j < data.length; j++) {
                        const timestamp = data.time.valueAt(j);
                        const value = data.values.convertedValueAt ? 
                            data.values.convertedValueAt(j) : 
                            data.values.valueAt(j);
                        
                        if (!rows.has(timestamp)) {
                            rows.set(timestamp, []);
                        }
                        const timestampRows = rows.get(timestamp)!;
                        
                        let targetRow = timestampRows.find(row => row[i + 1] === undefined);
                        if (!targetRow) {
                            targetRow = new Array(signals.length + 1);
                            targetRow[0] = timestamp.toString();
                            timestampRows.push(targetRow);
                        }
                        targetRow[i + 1] = value.toString();
                    }
                }

                const sortedTimestamps = Array.from(rows.keys()).sort((a, b) => a - b);
                
                for (const timestamp of sortedTimestamps) {
                    const timestampRows = rows.get(timestamp)!;
                    for (const row of timestampRows) {
                        for (let i = 1; i <= signals.length; i++) {
                            if (row[i] === undefined) {
                                row[i] = '';
                            }
                        }
                        buffer += row.join(',') + '\n';
                    }
                    
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
