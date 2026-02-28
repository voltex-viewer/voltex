import {
    ChannelType,
    NumberType,
    openMdfFile,
    type MdfFile,
    type MdfSignal,
    type MdfSignalGroup,
    type SerializableConversionData,
} from '@voltex-viewer/mdf-reader';
import { RenderMode } from '@voltex-viewer/plugin-api';
import { SharedBufferSequence as SharedBufferFloat64Sequence, SharedBufferBigInt64Sequence, SharedBufferBigUint64Sequence } from './sharedBufferSequence';
import type { WorkerMessage, WorkerResponse, SignalMetadata } from './workerTypes';

type SharedBuffer = SharedBufferFloat64Sequence | SharedBufferBigInt64Sequence | SharedBufferBigUint64Sequence;

interface LoadedSignalData {
    mdfFile: MdfFile;
    group: MdfSignalGroup;
    signal: MdfSignal;
    timeSignal: MdfSignal | undefined;
}

interface CachedGroupData {
    buffers: Map<MdfSignal, SharedBuffer>;
    loading: Promise<void> | null;
    progressListeners: Set<(timeSeq: SharedBuffer | undefined, valuesSeq: SharedBuffer) => void>;
}

const signalDataMap: Map<number, LoadedSignalData> = new Map();
const groupCache: Map<MdfSignalGroup, CachedGroupData> = new Map();

function createSharedBuffer(numberType: NumberType): SharedBuffer {
    switch (numberType) {
        case NumberType.BigInt64: return new SharedBufferBigInt64Sequence();
        case NumberType.BigUint64: return new SharedBufferBigUint64Sequence();
        default: return new SharedBufferFloat64Sequence();
    }
}

self.addEventListener('message', async (event: MessageEvent<WorkerMessage>) => {
    const message = event.data;
    
    if (message.type === 'loadFile') {
        try {
            const start = performance.now();
            const mdfFile = await openMdfFile(message.file, {
                onProgress: (signalCount: number) => {
                    self.postMessage({ type: 'fileLoadingProgress', channelCount: signalCount } as WorkerResponse);
                },
            });
            
            const signals: SignalMetadata[] = [];
            let signalId = 0;
            
            for (const group of mdfFile.getGroups()) {
                for (const channelGroup of group.channelGroups) {
                    const timeSignal = channelGroup.signals.find(s => s.channelType === ChannelType.Time);
                    for (const signal of channelGroup.signals) {
                        if (signal.channelType !== ChannelType.Signal) continue;
                        signalDataMap.set(signalId, {
                            mdfFile,
                            group,
                            signal,
                            timeSignal,
                        });
                        
                        signals.push({
                            name: [mdfFile.filename, signal.name],
                            signalId: signalId++,
                            timeSequenceType: timeSignal?.numberType ?? NumberType.Float64,
                            valuesSequenceType: signal.numberType,
                        });
                    }
                }
            }

            const duration = performance.now() - start;
            console.log(`Loaded ${signals.length} signal sources from ${message.file.name} in ${duration.toFixed(1)} ms`);

            const response: WorkerResponse = {
                type: 'fileLoaded',
                signals,
                fileName: message.file.name,
            };
            
            self.postMessage(response);
        } catch (error) {
            console.error(error);
            const response: WorkerResponse = {
                type: 'error',
                error: error instanceof Error ? error.message : String(error),
            };
            self.postMessage(response);
        }
    } else if (message.type === 'loadSignal') {
        try {
            const start = performance.now();
            const signalData = signalDataMap.get(message.signalId);
            if (!signalData) {
                throw new Error(`Signal ${message.signalId} not found`);
            }
            
            const { mdfFile, group, signal, timeSignal } = signalData;
            
            const [valuesConversion, timeConversion, timeUnit, valueUnit] = await Promise.all([
                signal.getConversion(),
                timeSignal?.getConversion() ?? Promise.resolve({ conversion: null, textValues: [], unit: null } as SerializableConversionData),
                timeSignal?.getUnit() ?? Promise.resolve(null),
                signal.getUnit(),
            ]);
            
            let cached = groupCache.get(group);
            const cacheHit = cached != null;
            
            if (!cached) {
                cached = {
                    buffers: new Map(),
                    loading: null,
                    progressListeners: new Set(),
                };
                groupCache.set(group, cached);
                
                const currentCached = cached;
                cached.loading = (async () => {
                    const signalToBuffer = currentCached.buffers;
                    
                    await mdfFile.read<SharedArrayBuffer>([group], {
                        createBuffer: (sig: MdfSignal, numberType: NumberType) => {
                            const seq = createSharedBuffer(numberType);
                            signalToBuffer.set(sig, seq);
                            return seq;
                        },
                        onProgress: () => {
                            for (const listener of currentCached.progressListeners) {
                                const tSeq = timeSignal ? currentCached.buffers.get(timeSignal) : undefined;
                                const vSeq = currentCached.buffers.get(signal);
                                if (vSeq) {
                                    listener(tSeq, vSeq);
                                }
                            }
                        },
                    });
                    currentCached.loading = null;
                })();
            }
            
            const timeSeq = timeSignal ? cached.buffers.get(timeSignal) : undefined;
            const valuesSeq = cached.buffers.get(signal);
            
            if (!valuesSeq) {
                throw new Error(`Failed to get buffer for signal`);
            }

            const startResponse: WorkerResponse = {
                type: 'signalLoadingStarted',
                signalId: message.signalId,
                timeBuffer: timeSeq?.getBuffer() ?? new SharedArrayBuffer(0),
                valuesBuffer: valuesSeq.getBuffer(),
                length: Math.min(timeSeq?.length() ?? valuesSeq.length(), valuesSeq.length()),
                timeConversion,
                valuesConversion,
                timeUnit,
                valueUnit,
                renderMode: (valuesConversion?.textValues.length ?? 0) >= 2 ? RenderMode.Enum : RenderMode.Lines,
            };
            self.postMessage(startResponse);

            if (cached.loading) {
                let prevTimeBuffer = timeSeq?.getBuffer();
                let prevValuesBuffer = valuesSeq.getBuffer();
                let prevLength = Math.min(timeSeq?.length() ?? valuesSeq.length(), valuesSeq.length());
                
                const progressListener = (tSeq: SharedBuffer | undefined, vSeq: SharedBuffer) => {
                    const currentTimeBuffer = tSeq?.getBuffer();
                    const currentValuesBuffer = vSeq.getBuffer();
                    const currentLength = Math.min(tSeq?.length() ?? vSeq.length(), vSeq.length());
                    
                    if (currentLength !== prevLength || currentTimeBuffer !== prevTimeBuffer || currentValuesBuffer !== prevValuesBuffer) {
                        const progressResponse: WorkerResponse = {
                            type: 'signalLoadingProgress',
                            signalId: message.signalId,
                            ...(currentTimeBuffer !== prevTimeBuffer && currentTimeBuffer && { timeBuffer: currentTimeBuffer }),
                            ...(currentValuesBuffer !== prevValuesBuffer && { valuesBuffer: currentValuesBuffer }),
                            length: currentLength
                        };
                        
                        prevTimeBuffer = currentTimeBuffer;
                        prevValuesBuffer = currentValuesBuffer;
                        prevLength = currentLength;
                        
                        self.postMessage(progressResponse);
                    }
                };
                
                cached.progressListeners.add(progressListener);
                await cached.loading;
                cached.progressListeners.delete(progressListener);
            }
            
            const sampleCount = valuesSeq.length();
            const groupSignalCount = cached.buffers.size;
            const duration = performance.now() - start;
            console.log(`Loaded signal "${signal.name}" from ${mdfFile.filename}: ${sampleCount.toLocaleString()} samples, ${groupSignalCount} signals in group,${duration.toFixed(1)} ms${cacheHit ? ' (group cached)' : ''}`);

            const finalTimeBuffer = timeSeq?.getBuffer() ?? new SharedArrayBuffer(0);
            const finalValuesBuffer = valuesSeq.getBuffer();
            const finalLength = Math.min(timeSeq?.length() ?? valuesSeq.length(), valuesSeq.length());
            
            const completeResponse: WorkerResponse = {
                type: 'signalLoadingComplete',
                signalId: message.signalId,
                timeBuffer: finalTimeBuffer,
                valuesBuffer: finalValuesBuffer,
                length: finalLength
            };
            
            self.postMessage(completeResponse);
        } catch (error) {
            const response: WorkerResponse = {
                type: 'error',
                error: error instanceof Error ? error.message : String(error),
            };
            self.postMessage(response);
        }
    }
});
