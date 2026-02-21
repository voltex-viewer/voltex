import { PluginContext, SignalSource, Sequence, Signal, RenderObject } from '@voltex-viewer/plugin-api';
import { v4, NumberType, deserializeConversion } from '@voltex-viewer/mdf-reader';
import { SharedBufferBackedSequence } from './sharedBufferBackedSequence';
import type { WorkerMessage, WorkerResponse } from './workerTypes';
import { loadingOverlayRenderObject } from './loadingOverlayRenderObject';

export default (context: PluginContext): void => {

    const loadingSequences = new Map<number, { time: SharedBufferBackedSequence<Float64Array | BigInt64Array | BigUint64Array>, values: SharedBufferBackedSequence<Float64Array | BigInt64Array | BigUint64Array> }>();
    let animationFrameId: number | null = null;
    let loadingOverlay: RenderObject | null = null;
    let loadingOverlayObj: ReturnType<typeof loadingOverlayRenderObject> | null = null;
    
    function startPolling(): void {
        if (animationFrameId !== null) return;
        const poll = () => {
            if (loadingSequences.size > 0) {
                for (const { time, values } of loadingSequences.values()) {
                    time.update();
                    values.update();
                }
                context.requestRender();
                animationFrameId = requestAnimationFrame(poll);
            } else {
                animationFrameId = null;
            }
        };
        animationFrameId = requestAnimationFrame(poll);
    }
    
    // @ts-expect-error - import.meta.url is provided by Vite
    const worker: Worker | null = new Worker(new URL('./mdfLoaderWorker.ts', import.meta.url), { type: 'module' });
    worker.addEventListener('message', (event: MessageEvent<WorkerResponse>) => {
        const data = event.data;
        
        switch (data.type) {
            case 'error':
                console.error('Worker error:', data.error);
                if (loadingOverlay) {
                    context.rootRenderObject.removeChild(loadingOverlay);
                    loadingOverlay = null;
                    loadingOverlayObj = null;
                }
                return;
            
            case 'fileLoaded':
                if (loadingOverlay) {
                    context.rootRenderObject.removeChild(loadingOverlay);
                    loadingOverlay = null;
                    loadingOverlayObj = null;
                }
                return;
            
            case 'fileLoadingProgress':
                if (loadingOverlayObj) {
                    loadingOverlayObj.updateChannelCount(data.channelCount);
                    context.requestRender();
                }
                return;
            
            case 'signalLoadingStarted':
                return; // Handled by per-signal promise
            
            case 'signalLoadingComplete': {
                const seqs = loadingSequences.get(data.signalId);
                if (seqs) {
                    seqs.time.update();
                    seqs.values.update();
                }
                loadingSequences.delete(data.signalId);
                context.requestRender();
                break;
            }
        }
    });

    context.registerFileOpenHandler({
        extensions: ['.mf4', '.mdf'],
        description: 'MDF/MF4 Measurement Files',
        mimeType: '*/*',
        handler: async (file: File) => {
            // Show loading overlay after a delay to avoid flashing for quick loads
            const showOverlayTimeout = setTimeout(() => {
                loadingOverlayObj = loadingOverlayRenderObject();
                loadingOverlay = context.rootRenderObject.addChild(loadingOverlayObj);
                context.requestRender();
            }, 200);
            
            const message: WorkerMessage = {
                type: 'loadFile',
                file,
            };
            
            worker.postMessage(message);
            
            try {
                const response = await new Promise<WorkerResponse>((resolve, reject) => {
                    const handler = (event: MessageEvent<WorkerResponse>) => {
                        if (event.data.type === 'error') {
                            worker.removeEventListener('message', handler);
                            reject(new Error(event.data.error));
                        } else if (event.data.type === 'fileLoaded') {
                            worker.removeEventListener('message', handler);
                            resolve(event.data);
                        }
                    };
                    worker.addEventListener('message', handler);
                });
                
                if (response.type !== 'fileLoaded') {
                    throw new Error('Unexpected response type');
                }
                
                const sources: SignalSource[] = response.signals.map(metadata => ({
                    name: metadata.name,
                    signal: async () => {
                        const loadMessage: WorkerMessage = {
                            type: 'loadSignal',
                            signalId: metadata.signalId
                        };
                        
                        // Wait for the initial response with buffers
                        const startResponse = await new Promise<Extract<WorkerResponse, { type: 'signalLoadingStarted' }>>((resolve, reject) => {
                            const handler = (event: MessageEvent<WorkerResponse>) => {
                                if (event.data.type === 'error') {
                                    worker.removeEventListener('message', handler);
                                    reject(new Error(event.data.error));
                                } else if (event.data.type === 'signalLoadingStarted' && event.data.signalId === metadata.signalId) {
                                    worker.removeEventListener('message', handler);
                                    resolve(event.data);
                                }
                            };
                            worker.addEventListener('message', handler);
                            
                            // Post message after handler is set up
                            worker.postMessage(loadMessage);
                        });
                        
                        const source: SignalSource = sources.find(s => s.name === metadata.name)!;
                        
                        const timeConstructor = metadata.timeSequenceType === NumberType.BigInt64 ? BigInt64Array : metadata.timeSequenceType === NumberType.BigUint64 ? BigUint64Array : Float64Array;
                        const valuesConstructor = metadata.valuesSequenceType === NumberType.BigInt64 ? BigInt64Array : metadata.valuesSequenceType === NumberType.BigUint64 ? BigUint64Array : Float64Array;
                        
                        // Apply default conversions for bigint types if no custom conversion provided
                        function wrapConversion(type: NumberType, conversion: ((x: number) => string | number) | undefined): undefined | ((x: bigint) => string | bigint | number) | ((x: number) => string | number) {
                            if (type === NumberType.Float64) {
                                return conversion;
                            } else if (conversion) {
                                return (x: bigint) => conversion(Number(x));
                            } else {
                                return (x: bigint) => x;
                            }
                        }
                        
                        const time = new SharedBufferBackedSequence(startResponse.timeBuffer, timeConstructor, wrapConversion(metadata.timeSequenceType, deserializeConversion(startResponse.timeConversion)) as ((value: number | bigint) => string | number) | undefined, startResponse.timeUnit);
                        const values = new SharedBufferBackedSequence(startResponse.valuesBuffer, valuesConstructor, wrapConversion(metadata.valuesSequenceType, deserializeConversion(startResponse.valuesConversion)) as ((value: number | bigint) => string | number) | undefined, startResponse.valueUnit);
                        
                        loadingSequences.set(metadata.signalId, { time, values });
                        startPolling();
                        
                        return {
                            time,
                            values,
                            renderMode: startResponse.renderMode,
                            source,
                            renderHint: startResponse.renderMode
                        };
                    }
                }));
                
                context.signalSources.add(sources);
                return sources;
            } finally {
                clearTimeout(showOverlayTimeout);
                if (loadingOverlay) {
                    context.rootRenderObject.removeChild(loadingOverlay);
                    loadingOverlay = null;
                    loadingOverlayObj = null;
                }
            }
        }
    });

    context.registerFileSaveHandler({
        extensions: ['.mf4', '.mdf'],
        description: 'MDF/MF4 Measurement Files',
        mimeType: '*/*',
        handler: async (file) => {
            const now = BigInt(Date.now()) * 1000000n;
            const signals = context.getRows().flatMap(row => row.signals);
            // Group signals by time sequence
            const groupedSignals = new Map<Sequence, Map<number, Signal[]>>();
            for (const signal of signals) {
                const timeSequence = signal.time;
                const length = Math.min(signal.time.length, signal.values.length);
                
                if (!groupedSignals.has(timeSequence)) {
                    groupedSignals.set(timeSequence, new Map());
                }
                
                const lengthMap = groupedSignals.get(timeSequence)!;
                if (!lengthMap.has(length)) {
                    lengthMap.set(length, []);
                }
                lengthMap.get(length)!.push(signal);
            }
            const channelGroups = Array.from(groupedSignals.entries().flatMap(([time, lengthMap]) => lengthMap.entries().map(([length, signals]) => ({time, length, signals}))));
            const dataGroups = channelGroups.map(({time, length, signals}) => {
                let commonPrefix = signals[0].source.name.slice(0, signals[0].source.name.length - 1);
                for (let i = 1; i < signals.length && commonPrefix; i++) {
                    const name = signals[i].source.name;
                    let j = 0;
                    while (j < commonPrefix.length && j < name.length && commonPrefix[j] === name[j]) {
                        j++;
                    }
                    commonPrefix = commonPrefix.slice(0, j);
                }
                const channelInfo: [string[], Sequence][] = [[[...commonPrefix, "time"], time], ...signals.map(s => [s.source.name, s.values] as [string[], Sequence])];
                
                function buildConversion(seq: Sequence, length: number): v4.ChannelConversionBlock<'instanced'> | null {
                    if (!seq.convertedValueAt) return null;
                    
                    const valueToText = new Map<number, string>();
                    for (let i = 0; i < length; i++) {
                        const rawValue = seq.valueAt(i);
                        const converted = seq.convertedValueAt(i);
                        if (typeof converted === 'string' && !valueToText.has(rawValue)) {
                            valueToText.set(rawValue, converted);
                        }
                    }
                    
                    if (valueToText.size === 0) return null;
                    
                    const values: number[] = [];
                    const refs: (v4.TextBlock | null)[] = [];
                    
                    for (const [value, text] of valueToText) {
                        values.push(value);
                        refs.push({ data: text });
                    }
                    refs.push(null);
                    
                    return {
                        type: v4.ConversionType.ValueToTextOrScale,
                        values,
                        refs,
                        txName: null,
                        mdUnit: null,
                        mdComment: null,
                        inverse: null,
                        precision: 0,
                        flags: 0,
                        physicalRangeMinimum: 0,
                        physicalRangeMaximum: 0,
                    } satisfies v4.ChannelConversionBlock<'instanced'>;
                }
                
                const channels = channelInfo.map(([name, seq], index) => ({
                    channelNext: null,
                    component: null,
                    txName: {
                        data: name.slice(commonPrefix.length).join('.'),
                    },
                    siSource: null,
                    conversion: index === 0 ? null : buildConversion(seq, length),
                    data: null,
                    unit: null,
                    comment: null,
                    channelType: index == 0 ? 2 : 0,
                    syncType: index == 0 ? 1 : 0,
                    dataType: v4.DataType.FloatLe,
                    bitOffset: 0,
                    byteOffset: index * 8,
                    bitCount: 64,
                    flags: 0,
                    invalidationBitPosition: 0,
                    precision: 0,
                    attachmentCount: 0,
                    valueRangeMinimum: 0,
                    valueRangeMaximum: 0,
                    limitMinimum: 0,
                    limitMaximum: 0,
                    limitExtendedMinimum: 0,
                    limitExtendedMaximum: 0,
                } as v4.ChannelBlock<'instanced'>));
                
                for (let i = 0; i < channels.length - 1; i++) {
                    channels[i].channelNext = channels[i + 1];
                }
                const maxBytesPerArray = 65536 - 24; // 64 KB block size minus header
                const bytesPerSample = channels.length * Float64Array.BYTES_PER_ELEMENT;
                const samplesPerArray = Math.floor(maxBytesPerArray / bytesPerSample);
                const numArrays = Math.ceil(length / samplesPerArray);
                const arrays: v4.DataTableBlock[] = [];

                for (let arrayIndex = 0; arrayIndex < numArrays; arrayIndex++) {
                    const startSample = arrayIndex * samplesPerArray;
                    const endSample = Math.min(startSample + samplesPerArray, length);
                    const samplesInThisArray = endSample - startSample;
                    
                    const arr = new Float64Array(samplesInThisArray * channels.length);
                    for (let i = 0; i < samplesInThisArray; i++) {
                        for (let j = 0; j < channelInfo.length; j++) {
                            arr[i * channels.length + j] = channelInfo[j][1].valueAt(startSample + i);
                        }
                    }
                    arrays.push({
                        data: new DataView(arr.buffer),
                    });
                }
                return {
                    dataGroupNext: null,
                    channelGroupFirst: {
                        channelGroupNext: null,
                        channelFirst: channels[0],
                        acquisitionName: {
                            data: commonPrefix.join('.'),
                        },
                        acquisitionSource: null,
                        sampleReductionFirst: null,
                        comment: null,
                        recordId: 0n,
                        cycleCount: BigInt(length),
                        flags: 0,
                        pathSeparator: 0,
                        dataBytes: channelInfo.length * 8,
                        invalidationBytes: 0,
                    },
                    data: arrays.length == 1 ? arrays[0] : {
                        dataListNext: null,
                        data: arrays,
                        flags: 0,
                    } as v4.DataListBlock<'instanced'>,
                    comment: null,
                    recordIdSize: 0,
                } as v4.DataGroupBlock<'instanced'>
            });
            const dataGroup = dataGroups[0];
            for (let i = 1; i < dataGroups.length; i++) {
                dataGroups[i - 1].dataGroupNext = dataGroups[i];
            }
            const header: v4.Header<'instanced'> = {
                firstDataGroup: dataGroup,
                fileHistory: {
                    fileHistoryNext: null,
                    comment: {
                        data: `<FHcomment xmlns='http://www.asam.net/mdf/v4'><TX>File was created.</TX><tool_id>Voltex</tool_id><tool_vendor>Voltex</tool_vendor><tool_version>1.0</tool_version><user_name>User</user_name></FHcomment>`,
                    },
                    time: now,
                    timeZone: 0,
                    dstOffset: 0,
                    timeFlags: 0,
                },
                channelHierarchy: null,
                attachment: null,
                event: null,
                comment: null,
                startTime: now,
                timeZone: 0,
                dstOffset: 0,
                timeFlags: 0,
                timeQuality: 0,
                flags: 0,
                startAngle: 0n,
                startDistance: 0n,
            };
            const serializeContext = new v4.SerializeContext();
            v4.resolveHeaderOffset(serializeContext, header);
            try {
                await serializeContext.serialize(file);
            } finally {
                await file.close();
            }
        }
    });
}