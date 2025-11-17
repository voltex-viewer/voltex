import { PluginContext, SignalSource, Sequence, Signal } from '@voltex-viewer/plugin-api';
import { resolveHeaderOffset, Header, DataTableBlock, DataListBlock, DataGroupBlock, ChannelBlock, } from './blocks/v4';
import * as v4 from './blocks/v4';
import { SerializeContext } from './blocks/v4/serializer';
import { deserializeConversion } from './serializableConversion';
import { SharedBufferBackedSequence } from './SharedBufferBackedSequence';
import { NumberType } from './decoder';
import type { WorkerMessage, WorkerResponse } from './workerTypes';

type AnySequence = SharedBufferBackedSequence<Float64Array> | SharedBufferBackedSequence<BigInt64Array> | SharedBufferBackedSequence<BigUint64Array>;

export default (context: PluginContext): void => {

    const activeSignalLoaders = new Map<number, {
        timeSequence: AnySequence;
        valuesSequence: AnySequence;
    }>();
    let worker: Worker | null = new Worker(new URL('./mdfLoaderWorker.ts', import.meta.url), { type: 'module' });
    worker.addEventListener('message', (event: MessageEvent<WorkerResponse>) => {
        const data = event.data;
        
        switch (data.type) {
            case 'error':
                console.error('Worker error:', data.error);
                return;
            
            case 'fileLoaded':
                return; // Handled by file open handler
            
            case 'signalLoadingStarted':
                return; // Handled by per-signal promise
            
            case 'signalLoadingProgress': {
                const loader = activeSignalLoaders.get(data.signalId);
                if (!loader) return;
                
                // Update buffers if they were reallocated
                if (data.timeBuffer) {
                    loader.timeSequence.updateBuffer(data.timeBuffer, data.length);
                } else {
                    loader.timeSequence.updateLength(data.length);
                }
                
                if (data.valuesBuffer) {
                    loader.valuesSequence.updateBuffer(data.valuesBuffer, data.length);
                } else {
                    loader.valuesSequence.updateLength(data.length);
                }
                
                context.requestRender();
                break;
            }
            
            case 'signalLoadingComplete': {
                const loader = activeSignalLoaders.get(data.signalId);
                if (!loader) return;
                
                // Final update with potential buffer changes
                if (data.timeBuffer) {
                    loader.timeSequence.updateBuffer(data.timeBuffer, data.length);
                } else {
                    loader.timeSequence.updateLength(data.length);
                }
                
                if (data.valuesBuffer) {
                    loader.valuesSequence.updateBuffer(data.valuesBuffer, data.length);
                } else {
                    loader.valuesSequence.updateLength(data.length);
                }
                
                context.requestRender();
                activeSignalLoaders.delete(data.signalId);
                break;
            }
        }
    });

    context.registerFileOpenHandler({
        extensions: ['.mf4', '.mdf'],
        description: 'MDF/MF4 Measurement Files',
        mimeType: '*/*',
        handler: async (file: File) => {
            const message: WorkerMessage = {
                type: 'loadFile',
                file,
            };
            
            worker.postMessage(message);
            
            const response = await new Promise<WorkerResponse>((resolve, reject) => {
                const handler = (event: MessageEvent<WorkerResponse>) => {
                    worker.removeEventListener('message', handler);
                    if (event.data.type === 'error') {
                        reject(new Error(event.data.error));
                    } else {
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
                    
                    const conversion = deserializeConversion(metadata.conversion);
                    const source: SignalSource = sources.find(s => s.name === metadata.name)!;
                    
                    const timeConstructor = metadata.timeSequenceType === NumberType.BigInt64 ? BigInt64Array : metadata.timeSequenceType === NumberType.BigUint64 ? BigUint64Array : Float64Array;
                    const valuesConstructor = metadata.valuesSequenceType === NumberType.BigInt64 ? BigInt64Array : metadata.valuesSequenceType === NumberType.BigUint64 ? BigUint64Array : Float64Array;
                    
                    // Apply default conversions for bigint types if no custom conversion provided
                    let valuesConversion: any = conversion;
                    if (!valuesConversion) {
                        if (metadata.valuesSequenceType === NumberType.BigInt64) {
                            valuesConversion = (x: bigint) => ("0x" + x.toString(16)).replace("0x-", "-0x");
                        } else if (metadata.valuesSequenceType === NumberType.BigUint64) {
                            valuesConversion = (x: bigint) => "0x" + x.toString(16);
                        }
                    } else if (metadata.valuesSequenceType !== NumberType.Float64) {
                        // Wrap existing conversion to handle bigint to number conversion
                        const originalConversion = valuesConversion;
                        valuesConversion = (x: bigint) => originalConversion(Number(x));
                    }
                    
                    const time = new SharedBufferBackedSequence(startResponse.timeBuffer, timeConstructor) as AnySequence;
                    time.updateLength(startResponse.length);
                    const values = new SharedBufferBackedSequence(startResponse.valuesBuffer, valuesConstructor, valuesConversion) as AnySequence;
                    values.updateLength(startResponse.length);
                    
                    // Register with the persistent handler
                    activeSignalLoaders.set(metadata.signalId, {
                        timeSequence: time,
                        valuesSequence: values
                    });
                    
                    return {
                        time,
                        values,
                        conversion: conversion || (() => 0),
                        renderMode: metadata.renderMode,
                        source,
                        renderHint: metadata.renderMode
                    };
                }
            }));
            
            context.signalSources.add(sources);
        }
    });

    context.registerFileSaveHandler({
        extensions: ['.mf4', '.mdf'],
        description: 'MDF/MF4 Measurement Files',
        mimeType: '*/*',
        handler: async (file: FileSystemWritableFileStream) => {
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
                const channels = channelInfo.map(([name], index) => ({
                    channelNext: null,
                    component: null,
                    txName: {
                        data: name.slice(commonPrefix.length).join('.'),
                    },
                    siSource: null,
                    conversion: null,
                    data: null,
                    unit: null,
                    comment: null,
                    channelType: index == 0 ? 2 : 0,
                    syncType: index == 0 ? 1 : 0,
                    dataType: v4.DataType.FloatLe,
                    bitOffset: 0,
                    byteOffset: index * 4,
                    bitCount: 32,
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
                } as ChannelBlock<'instanced'>));
                
                for (let i = 0; i < channels.length - 1; i++) {
                    channels[i].channelNext = channels[i + 1];
                }
                const maxBytesPerArray = 65536 - 24; // 64 KB block size minus header
                const bytesPerSample = channels.length * Float32Array.BYTES_PER_ELEMENT;
                const samplesPerArray = Math.floor(maxBytesPerArray / bytesPerSample);
                const numArrays = Math.ceil(length / samplesPerArray);
                const arrays: DataTableBlock[] = [];

                for (let arrayIndex = 0; arrayIndex < numArrays; arrayIndex++) {
                    const startSample = arrayIndex * samplesPerArray;
                    const endSample = Math.min(startSample + samplesPerArray, length);
                    const samplesInThisArray = endSample - startSample;
                    
                    const arr = new Float32Array(samplesInThisArray * channels.length);
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
                        dataBytes: channelInfo.length * 4,
                        invalidationBytes: 0,
                    },
                    data: arrays.length == 1 ? arrays[0] : {
                        dataListNext: null,
                        data: arrays,
                        flags: 0,
                    } as DataListBlock<'instanced'>,
                    comment: null,
                    recordIdSize: 0,
                } as DataGroupBlock<'instanced'>
            });
            const dataGroup = dataGroups[0];
            for (let i = 1; i < dataGroups.length; i++) {
                dataGroups[i - 1].dataGroupNext = dataGroups[i];
            }
            const header: Header<'instanced'> = {
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
            const serializeContext = new SerializeContext();
            resolveHeaderOffset(serializeContext, header);
            const writer = file.getWriter();
            try {
                await serializeContext.serialize(writer);
            } finally {
                await writer.close();
            }
        }
    });
}