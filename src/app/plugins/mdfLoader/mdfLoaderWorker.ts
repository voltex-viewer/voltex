import {
    Link, newLink, getLink, readBlock,
    deserializeId,
    Header, readHeader,
    iterateDataGroupBlocks,
    iterateChannelGroupBlocks,
    iterateChannelBlocks,
    TextBlock, deserializeTextBlock, deserializeMetadataBlock, readTextBlock,
    ChannelConversionBlock, readConversionBlock,
} from './blocks/v4';
import * as v4 from './blocks/v4';
import * as v3 from './blocks/v3'
import { BufferedFileReader } from './BufferedFileReader';
import { ChannelType, DataType, getNumberType, NumberType } from './decoder';
import { DataGroupLoader } from './decoder';
import type { AbstractChannel, AbstractDataGroup } from './decoder';
import { RenderMode } from '@voltex-viewer/plugin-api';
import { SharedBufferSequence, SharedBufferBigInt64Sequence, SharedBufferBigUint64Sequence } from './SharedBufferSequence';
import type { WorkerMessage, WorkerResponse, SignalMetadata } from './workerTypes';

interface LoadedSignalData {
    dataGroup: AbstractDataGroup;
    channel: AbstractChannel;
    file: File;
    version: number;
    littleEndian: boolean;
    dgBlockLink: any;
    dataGroupKey: string;
}

interface CachedDataGroup {
    sequences: Map<AbstractChannel, SharedBufferSequence | SharedBufferBigInt64Sequence | SharedBufferBigUint64Sequence>;
    loading: Promise<void> | null;
}

let signalDataMap: Map<number, LoadedSignalData> = new Map();
let dataGroupCache: Map<string, CachedDataGroup> = new Map();

function mdf3TypeToDataType(type: v3.DataType, littleEndian: boolean): DataType {
    switch (type) {
        case v3.DataType.Uint: return littleEndian ? DataType.UintLe : DataType.UintBe;
        case v3.DataType.Int: return littleEndian ? DataType.IntLe : DataType.IntBe;
        case v3.DataType.Float: return littleEndian ? DataType.FloatLe : DataType.FloatBe;
        case v3.DataType.Double: return littleEndian ? DataType.FloatLe : DataType.FloatBe;
        case v3.DataType.UintBe: return DataType.UintBe;
        case v3.DataType.IntBe: return DataType.IntBe;
        case v3.DataType.FloatBe: return DataType.FloatBe;
        case v3.DataType.DoubleBe: return DataType.FloatBe;
        case v3.DataType.UintLe: return DataType.UintLe;
        case v3.DataType.IntLe: return DataType.IntLe;
        case v3.DataType.FloatLe: return DataType.FloatLe;
        case v3.DataType.DoubleLe: return DataType.FloatLe;
        default: return DataType.Unknown;
    }
}

function mdf4TypeToDataType(type: v4.DataType): DataType {
    switch (type) {
        case v4.DataType.UintLe: return DataType.UintLe;
        case v4.DataType.UintBe: return DataType.UintBe;
        case v4.DataType.IntLe: return DataType.IntLe;
        case v4.DataType.IntBe: return DataType.IntBe;
        case v4.DataType.FloatLe: return DataType.FloatLe;
        case v4.DataType.FloatBe: return DataType.FloatBe;
        default: return DataType.Unknown;
    }
}

async function readMf3(reader: BufferedFileReader): Promise<SignalMetadata[]> {
    const rootLink = newLink<Header>(64n);
    const header = await v3.readHeader(rootLink, reader);
    let signals: SignalMetadata[] = [];
    let signalId = 0;
    let dataGroupIndex = 0;
    console.log(header);
    
    let lastProgressUpdate = 0;
    for await (const dgBlock of v3.iterateDataGroupBlocks(header.firstDataGroup, reader)) {
        const dataGroupKey = `${reader.file.name}:dg${dataGroupIndex++}`;
        const groups = [];
        let totalRows = 0;
        for await (const channelGroup of v3.iterateChannelGroupBlocks(dgBlock.channelGroupFirst, reader)) {
            totalRows += channelGroup.numberOfRecords;
            const channels = [];
            for await (const channel of v3.iterateChannelBlocks(channelGroup.channelFirst, reader)) {
                const conversionBlockLinked = await v3.readChannelConversionBlock(channel.conversion, reader);
                let conversionBlockInstanced: v3.ChannelConversionBlock<'instanced'> | undefined;
                if (conversionBlockLinked.type === v3.ConversionType.TextRangeTable) {
                    conversionBlockInstanced = {
                        ...conversionBlockLinked,
                        default: v3.getLink(conversionBlockLinked.default) === 0 ? null : await v3.readTextBlock(conversionBlockLinked.default, reader),
                        table: await Promise.all(conversionBlockLinked.table.map(async (x: any) => [x[0], x[1], await v3.readTextBlock(x[2], reader)])),
                    };
                } else {
                    conversionBlockInstanced = conversionBlockLinked;
                }
                const conversionData = v3.serializeConversion(conversionBlockInstanced as any);
                channels.push({
                    name: [reader.file.name, v3.getLink(channel.longName) !== 0 ? (await readTextBlock(channel.longName, reader)).data : channel.name],
                    type: channel.channelType === 0 ? ChannelType.Signal : channel.channelType == 1 ? ChannelType.Time : ChannelType.Unknown,
                    dataType: mdf3TypeToDataType(channel.dataType, reader.littleEndian),
                    byteOffset: channel.byteOffset + Math.floor(channel.bitOffset / 8),
                    bitOffset: channel.bitOffset % 8,
                    bitCount: channel.bitCount,
                    conversion: conversionData,
                    renderMode: conversionData.textValues.length >= 2 ? RenderMode.Enum : RenderMode.Lines,
                });
            }
            groups.push({
                recordId: Number(channelGroup.recordId),
                dataBytes: channelGroup.dataBytes + (dgBlock.recordIdType == 2 ? 1 : 0),
                invalidationBytes: 0,
                channels,
            });
        }
        const dataGroup: AbstractDataGroup = {
            recordIdSize: dgBlock.recordIdType == 0 ? 0 : 1,
            totalRows,
            groups: groups.map(g => ({
                recordId: g.recordId,
                dataBytes: g.dataBytes,
                invalidationBytes: g.invalidationBytes,
                channels: g.channels.map(c => ({
                    name: c.name,
                    type: c.type,
                    dataType: c.dataType,
                    byteOffset: c.byteOffset,
                    bitOffset: c.bitOffset,
                    bitCount: c.bitCount
                }))
            }))
        };
        
        for (const group of groups) {
            const timeChannel = group.channels.find(c => c.type === ChannelType.Time);
            const abstractTimeChannel = timeChannel ? dataGroup.groups
                .flatMap(g => g.channels)
                .find(c => c.name === timeChannel.name) : undefined;
            
            for (const channel of group.channels) {
                if (channel.type === ChannelType.Signal) {
                    const abstractChannel = dataGroup.groups
                        .flatMap(g => g.channels)
                        .find(c => c.name === channel.name)!;
                    
                    signalDataMap.set(signalId, {
                        dataGroup,
                        channel: abstractChannel,
                        file: reader.file,
                        version: reader.version,
                        littleEndian: reader.littleEndian,
                        dgBlockLink: dgBlock,
                        dataGroupKey
                    });
                    
                    signals.push({
                        name: channel.name,
                        conversion: channel.conversion,
                        renderMode: channel.renderMode,
                        signalId: signalId++,
                        timeSequenceType: abstractTimeChannel ? getNumberType(abstractTimeChannel) : NumberType.Float64,
                        valuesSequenceType: getNumberType(abstractChannel),
                    });
                    
                    const now = performance.now();
                    if (now - lastProgressUpdate > 100) {
                        self.postMessage({ type: 'fileLoadingProgress', channelCount: signals.length } as WorkerResponse);
                        lastProgressUpdate = now;
                    }
                }
            }
        }
    }

    self.postMessage({ type: 'fileLoadingProgress', channelCount: signals.length } as WorkerResponse);

    return signals;
}

async function readMf4(reader: BufferedFileReader): Promise<SignalMetadata[]> {
    const rootLink = newLink<Header>(64n);
    const header = await readHeader(rootLink, reader);
    console.log(header);
    
    let signals: SignalMetadata[] = [];
    let signalId = 0;
    let dataGroupIndex = 0;
    let lastProgressUpdate = 0;

    for await (const dgBlock of iterateDataGroupBlocks(header.firstDataGroup, reader)) {
        const dataGroupKey = `${reader.file.name}:dg${dataGroupIndex++}`;
        const conversionMap = new Map<Link<ChannelConversionBlock>, ChannelConversionBlock<'instanced'>>();
        async function readConversionBlockRecurse(link: Link<ChannelConversionBlock>): Promise<ChannelConversionBlock<'instanced'> | null> {
            if (getLink(link) === 0n) {
                return null;
            }
            if (conversionMap.has(link)) {
                return conversionMap.get(link)!;
            }
            const srcBlock = await readConversionBlock(link, reader);
            const block = {
                ...srcBlock,
                txName: null,
                mdUnit: null,
                mdComment: null,
                inverse: null,
                refs: [],
            } as ChannelConversionBlock<'instanced'>;
            conversionMap.set(link, block);
            for (const ref of srcBlock.refs) {
                if (getLink(ref) === 0n) {
                    (block.refs as (ChannelConversionBlock<'instanced'> | TextBlock | null)[]).push(null);
                } else {
                    const refBlock = await readBlock(ref, reader);
                    
                    if (refBlock.type === "##CC") {
                        (block.refs as (ChannelConversionBlock<'instanced'> | TextBlock | null)[]).push(await readConversionBlockRecurse(ref));
                    } else if (refBlock.type === "##TX") {
                        (block.refs as (ChannelConversionBlock<'instanced'> | TextBlock | null)[]).push(deserializeTextBlock(refBlock));
                    } else {
                        throw new Error(`Invalid block type in channel conversion block: "${block.type}"`);
                    }
                }
            }
            
            if (getLink(srcBlock.mdUnit) !== 0n) {
                const unit = await readBlock(srcBlock.mdUnit, reader);

                if (unit.type === "##TX") {
                    block.mdUnit = deserializeTextBlock(unit);
                } else if (unit.type == "##MD") {
                    block.mdUnit = deserializeMetadataBlock(unit);
                } else {
                    throw new Error(`Invalid block type in channel conversion block: "${unit.type}"`);
                }
            }

            return block;
        }
        const groups = [];
        for await (const channelGroup of iterateChannelGroupBlocks(dgBlock.channelGroupFirst, reader)) {
            const channels = [];
            for await (const channel of iterateChannelBlocks(channelGroup.channelFirst, reader)) {
                const conversionBlock = await readConversionBlockRecurse(channel.conversion);
                const conversionData = v4.serializeConversion(conversionBlock);
                channels.push({
                    name: [reader.file.name, (await readTextBlock(channel.txName, reader)).data],
                    type: channel.channelType === 2 ? ChannelType.Time : channel.channelType == 0 ? ChannelType.Signal : ChannelType.Unknown,
                    dataType: mdf4TypeToDataType(channel.dataType),
                    byteOffset: channel.byteOffset,
                    bitOffset: channel.bitOffset,
                    bitCount: channel.bitCount,
                    conversion: conversionData,
                    renderMode: conversionData.textValues.length >= 2 ? RenderMode.Enum : RenderMode.Lines,
                });
            }
            groups.push({
                recordId: Number(channelGroup.recordId),
                dataBytes: channelGroup.dataBytes,
                invalidationBytes: channelGroup.invalidationBytes,
                channels,
            });
        }
        const dataGroup: AbstractDataGroup = {
            recordIdSize: dgBlock.recordIdSize,
            groups: groups.map(g => ({
                recordId: g.recordId,
                dataBytes: g.dataBytes,
                invalidationBytes: g.invalidationBytes,
                channels: g.channels.map(c => ({
                    name: c.name,
                    type: c.type,
                    dataType: c.dataType,
                    byteOffset: c.byteOffset,
                    bitOffset: c.bitOffset,
                    bitCount: c.bitCount
                }))
            }))
        };
        
        for (const group of groups) {
            const timeChannel = group.channels.find(c => c.type === ChannelType.Time);
            const abstractTimeChannel = timeChannel ? dataGroup.groups
                .flatMap(g => g.channels)
                .find(c => c.name === timeChannel.name) : undefined;
            
            for (const channel of group.channels) {
                if (channel.type === ChannelType.Signal) {
                    const abstractChannel = dataGroup.groups
                        .flatMap(g => g.channels)
                        .find(c => c.name === channel.name)!;
                    
                    signalDataMap.set(signalId, {
                        dataGroup,
                        channel: abstractChannel,
                        file: reader.file,
                        version: reader.version,
                        littleEndian: reader.littleEndian,
                        dgBlockLink: dgBlock,
                        dataGroupKey
                    });
                    
                    signals.push({
                        name: channel.name,
                        conversion: channel.conversion,
                        renderMode: channel.renderMode,
                        signalId: signalId++,
                        timeSequenceType: abstractTimeChannel ? getNumberType(abstractTimeChannel) : NumberType.Float64,
                        valuesSequenceType: getNumberType(abstractChannel),
                    });
                    
                    const now = performance.now();
                    if (now - lastProgressUpdate > 100) {
                        self.postMessage({ type: 'fileLoadingProgress', channelCount: signals.length } as WorkerResponse);
                        lastProgressUpdate = now;
                    }
                }
            }
        }
    }

    self.postMessage({ type: 'fileLoadingProgress', channelCount: signals.length } as WorkerResponse);

    return signals;
}

self.addEventListener('message', async (event: MessageEvent<WorkerMessage>) => {
    const message = event.data;
    
    if (message.type === 'loadFile') {
        try {
            const start = performance.now();
            const reader = new BufferedFileReader(message.file);
            
            const id = deserializeId(await message.file.slice(0, 64).arrayBuffer());
            
            if (id.header !== "MDF     " && id.header !== "UnFinMF ") {
                throw new Error(`Invalid MDF header: "${id.header}"`);
            }

            reader.version = id.version;
            reader.littleEndian = id.littleEndian;

            let signals: SignalMetadata[];

            if (id.version >= 400 && id.version < 500) {
                signals = await readMf4(reader);
            } else if (id.version >= 300 && id.version < 400) {
                signals = await readMf3(reader);
            } else {
                throw new Error(`Unsupported MDF version: ${id.version} (long: ${id.versionLong})`);
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
            const response: WorkerResponse = {
                type: 'error',
                error: error instanceof Error ? error.message : String(error),
            };
            self.postMessage(response);
        }
    } else if (message.type === 'loadSignal') {
        try {
            const signalData = signalDataMap.get(message.signalId);
            if (!signalData) {
                throw new Error(`Signal ${message.signalId} not found`);
            }
            
            const { dataGroup, channel, file, version, littleEndian, dgBlockLink, dataGroupKey } = signalData;
            
            // Check if this data group is already cached or being loaded
            let cached = dataGroupCache.get(dataGroupKey);
            
            if (!cached) {
                // Not cached, need to load
                cached = {
                    sequences: new Map(),
                    loading: null
                };
                dataGroupCache.set(dataGroupKey, cached);
                
                // Create the loading promise
                cached.loading = (async () => {
                    const reader = new BufferedFileReader(file);
                    reader.version = version;
                    reader.littleEndian = littleEndian;
                    
                    // Create SharedArrayBuffer-backed sequences for all channels
                    const sequences = new Map<AbstractChannel, SharedBufferSequence | SharedBufferBigInt64Sequence | SharedBufferBigUint64Sequence>();
                    for (const group of dataGroup.groups) {
                        for (const ch of group.channels) {
                            switch (getNumberType(ch)) {
                                case NumberType.BigUint64:
                                    sequences.set(ch, new SharedBufferBigUint64Sequence());
                                    break;
                                case NumberType.BigInt64:
                                    sequences.set(ch, new SharedBufferBigInt64Sequence());
                                    break;
                                case NumberType.Float64:
                                default:
                                    sequences.set(ch, new SharedBufferSequence());
                                    break;
                            }
                        }
                    }
                    
                    cached!.sequences = sequences;
                    
                    const loader = new DataGroupLoader(dataGroup, async () => {
                        if (version >= 400 && version < 500) {
                            return await v4.getDataBlocks(dgBlockLink, reader);
                        } else if (version >= 300 && version < 400) {
                            return await v3.getDataBlocks(dgBlockLink, reader);
                        } else {
                            throw new Error(`Unsupported version: ${version}`);
                        }
                    });
                    
                    // Wrap the sequences to trigger progress updates for any active signal from this data group
                    const wrappedSequences = new Map<AbstractChannel, { push(value: number | bigint): void }>();
                    
                    for (const [ch, seq] of sequences) {
                        wrappedSequences.set(ch, {
                            push(value: number | bigint) {
                                (seq.push as any)(value);
                            }
                        });
                    }

                    // Load data
                    await loader.loadInto(wrappedSequences);
                    cached!.loading = null;
                })();
            }
            
            // Get sequences for this specific signal
            const timeChannel = dataGroup.groups.flatMap(g => g.channels).find(c => c.type === ChannelType.Time)!;
            const timeSeq = cached.sequences.get(timeChannel);
            const valuesSeq = cached.sequences.get(channel);
            
            if (!timeSeq || !valuesSeq) {
                throw new Error(`Failed to get sequences`);
            }

            // Send initial response immediately with current buffers
            const startResponse: WorkerResponse = {
                type: 'signalLoadingStarted',
                signalId: message.signalId,
                timeBuffer: timeSeq.getBuffer(),
                valuesBuffer: valuesSeq.getBuffer(),
                length: Math.min(timeSeq.length(), valuesSeq.length())
            };
            self.postMessage(startResponse);

            // If loading is in progress, set up progress tracking
            if (cached.loading) {
                let prevTimeBuffer = timeSeq.getBuffer();
                let prevValuesBuffer = valuesSeq.getBuffer();
                let prevLength = Math.min(timeSeq.length(), valuesSeq.length());
                
                const progressInterval = setInterval(() => {
                    const currentTimeBuffer = timeSeq.getBuffer();
                    const currentValuesBuffer = valuesSeq.getBuffer();
                    const currentLength = Math.min(timeSeq.length(), valuesSeq.length());
                    
                    if (currentLength !== prevLength || currentTimeBuffer !== prevTimeBuffer || currentValuesBuffer !== prevValuesBuffer) {
                        const progressResponse: WorkerResponse = {
                            type: 'signalLoadingProgress',
                            signalId: message.signalId,
                            timeBuffer: currentTimeBuffer !== prevTimeBuffer ? currentTimeBuffer : undefined,
                            valuesBuffer: currentValuesBuffer !== prevValuesBuffer ? currentValuesBuffer : undefined,
                            length: currentLength
                        };
                        
                        prevTimeBuffer = currentTimeBuffer;
                        prevValuesBuffer = currentValuesBuffer;
                        prevLength = currentLength;
                        
                        self.postMessage(progressResponse);
                    }
                }, 100);
                
                // Wait for loading to complete
                await cached.loading;
                clearInterval(progressInterval);
            }
            
            // Send final completion message
            const finalTimeBuffer = timeSeq.getBuffer();
            const finalValuesBuffer = valuesSeq.getBuffer();
            const finalLength = Math.min(timeSeq.length(), valuesSeq.length());
            
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
