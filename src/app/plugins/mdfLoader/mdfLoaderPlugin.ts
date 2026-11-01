import { PluginContext, SignalSource, RenderObject } from '@voltex-viewer/plugin-api';
import { SequenceSignal } from '@voltex-viewer/signal-utils';
import { v4, NumberType, deserializeConversion } from '@voltex-viewer/mdf-reader';
import { buildMdfHeader } from './mdfExport';
import { SharedBufferBackedSequence } from './sharedBufferBackedSequence';
import type { WorkerMessage, WorkerResponse } from './workerTypes';
import { loadingOverlayRenderObject } from './loadingOverlayRenderObject';

type AnySequence = SharedBufferBackedSequence<Float64Array> | SharedBufferBackedSequence<BigInt64Array> | SharedBufferBackedSequence<BigUint64Array>;

export default (context: PluginContext): void => {

    const activeSignalLoaders = new Map<number, {
        timeSequence: AnySequence;
        valuesSequence: AnySequence;
    }>();
    let loadingOverlay: RenderObject | null = null;
    let loadingOverlayObj: ReturnType<typeof loadingOverlayRenderObject> | null = null;
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
                        
                        const time = new SharedBufferBackedSequence(startResponse.timeBuffer, timeConstructor, wrapConversion(metadata.timeSequenceType, deserializeConversion(startResponse.timeConversion)) as ((value: number | bigint) => string | number) | undefined, startResponse.timeUnit) as AnySequence;
                        time.updateLength(startResponse.length);
                        const values = new SharedBufferBackedSequence(startResponse.valuesBuffer, valuesConstructor, wrapConversion(metadata.valuesSequenceType, deserializeConversion(startResponse.valuesConversion)) as ((value: number | bigint) => string | number) | undefined, startResponse.valueUnit) as AnySequence;
                        values.updateLength(startResponse.length);
                        
                        // Register with the persistent handler
                        activeSignalLoaders.set(metadata.signalId, {
                            timeSequence: time,
                            valuesSequence: values
                        });
                        
                        return new SequenceSignal(source, time, values, startResponse.renderMode, response.startTime);
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
            const header = await buildMdfHeader(signals, now);
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