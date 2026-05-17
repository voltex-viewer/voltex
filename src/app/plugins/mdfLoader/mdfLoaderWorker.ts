import {
    ChannelType,
    NumberType,
    openMdfFile,
    type MdfFile,
    type MdfChannel,
    type MdfDataGroup,
    type SerializableConversionData,
} from '@voltex-viewer/mdf-reader';
import { RenderMode } from '@voltex-viewer/plugin-api';
import { SharedBufferSequence as SharedBufferFloat64Sequence, SharedBufferBigInt64Sequence, SharedBufferBigUint64Sequence } from './sharedBufferSequence';
import type { WorkerMessage, WorkerResponse, SignalMetadata } from './workerTypes';

type SharedBuffer = SharedBufferFloat64Sequence | SharedBufferBigInt64Sequence | SharedBufferBigUint64Sequence;

interface LoadedSignalData {
    mdfFile: MdfFile;
    dataGroup: MdfDataGroup;
    channel: MdfChannel;
    timeChannel: MdfChannel | undefined;
}

// Memory budget for loading all channels in a data group at once. Groups that exceed this are loaded signal-by-signal
// to avoid OOM on large files.
const groupLoadThresholdBytes = 100 * 1024 * 1024;

function estimateWorstCaseGroupMemoryBytes(dataGroup: MdfDataGroup): number {
    if (dataGroup.channelGroups.every(cg => cg.rowCount === 0)) {
        // If all the row counts in the group are zero then this may be an unfinalized file, and the upper bound on size
        // is very large. In this instance, just load each channel one-by-one to avoid OOM.
        return groupLoadThresholdBytes;
    }
    let total = 0;
    for (const channelGroup of dataGroup.channelGroups) {
        // All NumberTypes store as 64-bit values
        total += channelGroup.rowCount * channelGroup.channels.length * 8;
    }
    return total;
}

interface PendingBatch {
    channels: Map<MdfChannel, SharedBuffer>;
    promise: Promise<void>;
    resolve: () => void;
    reject: (err: unknown) => void;
}

const signalDataMap: Map<number, LoadedSignalData> = new Map();
const channelCache = new Map<MdfChannel, { buffer: SharedBuffer; loading: Promise<void> | null }>();
const groupPendingBatch = new Map<MdfDataGroup, PendingBatch>();
const activeProgressCallbacks = new Map<number, () => void>();
let signalId = 0;

function createSharedBuffer(numberType: NumberType): SharedBuffer {
    switch (numberType) {
        case NumberType.BigInt64: return new SharedBufferBigInt64Sequence();
        case NumberType.BigUint64: return new SharedBufferBigUint64Sequence();
        default: return new SharedBufferFloat64Sequence();
    }
}

const dispatchProgress = () => {
    for (const cb of activeProgressCallbacks.values()) cb();
};

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

            for (const dataGroup of mdfFile.getGroups()) {
                for (const channelGroup of dataGroup.channelGroups) {
                    const timeChannel = channelGroup.channels.find(c => c.channelType === ChannelType.Time);
                    for (const channel of channelGroup.channels) {
                        if (channel.channelType !== ChannelType.Signal) continue;
                        signalDataMap.set(signalId, {
                            mdfFile,
                            dataGroup,
                            channel,
                            timeChannel,
                        });

                        signals.push({
                            name: [mdfFile.filename, channel.name],
                            signalId: signalId++,
                            timeSequenceType: timeChannel?.numberType ?? NumberType.Float64,
                            valuesSequenceType: channel.numberType,
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

            const { mdfFile, dataGroup, channel, timeChannel } = signalData;

            const [valuesConversion, timeConversion, timeUnit, valueUnit] = await Promise.all([
                channel.getConversion(),
                timeChannel?.getConversion() ?? Promise.resolve({ conversion: null, textValues: [], unit: null } as SerializableConversionData),
                timeChannel?.getUnit() ?? Promise.resolve(null),
                channel.getUnit(),
            ]);

            let cached = channelCache.get(channel);
            const cacheHit = cached != null;

            if (!cached) {
                const estimatedBytes = estimateWorstCaseGroupMemoryBytes(dataGroup);

                // For small groups load everything at once; for large groups load only the
                // requested signal and its time channel to avoid OOM.
                const channelsToLoad: MdfChannel[] = estimatedBytes <= groupLoadThresholdBytes
                    ? dataGroup.channelGroups.flatMap(cg => cg.channels)
                    : [channel, ...(timeChannel ? [timeChannel] : [])];

                let pending = groupPendingBatch.get(dataGroup);
                if (!pending) {
                    let resolve!: () => void;
                    let reject!: (err: unknown) => void;
                    const promise = new Promise<void>((res, rej) => { resolve = res; reject = rej; });
                    pending = { channels: new Map(), promise, resolve, reject };
                    groupPendingBatch.set(dataGroup, pending);

                    // Defer the read so concurrent loadSignal messages for the same group
                    // can register their channels before the scan starts.
                    setTimeout(async () => {
                        groupPendingBatch.delete(dataGroup);
                        const batch = pending!;
                        const batchRequests = Array.from(batch.channels.entries())
                            .map(([ch, buf]) => ({ channel: ch, buffer: buf }));
                        try {
                            await mdfFile.read(batchRequests, { onProgress: dispatchProgress });
                            for (const { channel: ch } of batchRequests) {
                                const entry = channelCache.get(ch);
                                if (entry) entry.loading = null;
                            }
                            batch.resolve();
                        } catch (err) {
                            for (const { channel: ch } of batchRequests) {
                                channelCache.delete(ch);
                            }
                            batch.reject(err);
                        }
                    }, 0);
                }

                for (const ch of channelsToLoad) {
                    if (!channelCache.has(ch)) {
                        const buffer = createSharedBuffer(ch.numberType);
                        channelCache.set(ch, { buffer, loading: pending.promise });
                        pending.channels.set(ch, buffer);
                    }
                }

                cached = channelCache.get(channel)!;
            }

            const valuesSeq = cached.buffer;
            const timeSeq = timeChannel ? channelCache.get(timeChannel)?.buffer : undefined;
            const loading = cached.loading;

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

            if (loading) {
                let prevTimeBuffer = timeSeq?.getBuffer();
                let prevValuesBuffer = valuesSeq.getBuffer();
                let prevLength = Math.min(timeSeq?.length() ?? valuesSeq.length(), valuesSeq.length());

                const progressListener = () => {
                    const currentTimeBuffer = timeSeq?.getBuffer();
                    const currentValuesBuffer = valuesSeq.getBuffer();
                    const currentLength = Math.min(timeSeq?.length() ?? valuesSeq.length(), valuesSeq.length());

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

                activeProgressCallbacks.set(message.signalId, progressListener);
                await loading;
                activeProgressCallbacks.delete(message.signalId);
            }

            const sampleCount = valuesSeq.length();
            const duration = performance.now() - start;
            console.log(`Loaded signal "${channel.name}" from ${mdfFile.filename}: ${sampleCount.toLocaleString()} samples, ${duration.toFixed(1)} ms${cacheHit ? ' (cached)' : ''}`);

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
