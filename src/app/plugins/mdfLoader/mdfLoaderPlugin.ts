import { Sequence, TextValue } from '@voltex-viewer/plugin-api';
import { PluginContext, SignalSource, Signal } from '@voltex-viewer/plugin-api';
import {
    Link, newLink, getLink, readBlock,
    deserializeId,
    Header, readHeader,
    DataGroupBlock, iterateDataGroupBlocks, getDataBlocks,
    iterateChannelGroupBlocks,
    ChannelBlock, iterateChannelBlocks,
    TextBlock, deserializeTextBlock, deserializeMetadataBlock, readTextBlock,
    ChannelConversionBlock, readConversionBlock, ConversionType,
    resolveHeaderOffset,
    DataTableBlock,
    DataListBlock
} from './blocks/v4';
import * as v4 from './blocks/v4';
import * as v3 from './blocks/v3'
import { SerializeContext } from './blocks/v4/serializer';
import { BufferedFileReader } from './BufferedFileReader';
import { AbstractChannel, AbstractDataGroup, AbstractGroup, ChannelType, DataGroupLoader, DataType } from './decoder';

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

export default (context: PluginContext): void => {
    context.registerFileOpenHandler({
        extensions: ['.mf4', '.mdf'],
        description: 'MDF/MF4 Measurement Files',
        mimeType: '*/*',
        handler: async (file: File) => {
            const start = performance.now();
            // Create a buffered reader for better performance
            const reader = new BufferedFileReader(file);
            
            const id = deserializeId(await file.slice(0, 64).arrayBuffer());
            
            if (id.header !== "MDF     " && id.header !== "UnFinMF ") {
                throw new Error(`Invalid MDF header: "${id.header}"`);
            }

            reader.version == id.version;
            reader.littleEndian = id.littleEndian;

            let sources: SignalSource[];

            if (id.version >= 400 && id.version < 500) {
                sources = await readMf4(reader);
            } else if (id.version >= 300 && id.version < 400) {
                sources = await readMf3(reader);
            } else {
                throw new Error(`Unsupported MDF version: ${id.version} (long: ${id.versionLong})`);
            }

            console.log(`Loaded ${sources.length} signal sources from ${file.name} in ${(performance.now() - start).toFixed(1)} ms`);

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

async function readMf3(reader: BufferedFileReader): Promise<SignalSource[]> {
    const rootLink = newLink<Header>(64n);
    const header = await v3.readHeader(rootLink, reader);
    let sources: SignalSource[] = [];
    console.log(header);
    for await (const dataGroup of v3.iterateDataGroupBlocks(header.firstDataGroup, reader)) {
        const groups: AbstractGroup[] = [];
        let totalRows = 0;
        for await (const channelGroup of v3.iterateChannelGroupBlocks(dataGroup.channelGroupFirst, reader)) {
            totalRows += channelGroup.numberOfRecords;
            const channels: AbstractChannel[] = [];
            for await (const channel of v3.iterateChannelBlocks(channelGroup.channelFirst, reader)) {
                const conversionBlockLinked = await v3.readChannelConversionBlock(channel.conversion, reader);
                let conversionBlockInstanced: v3.ChannelConversionBlock<'instanced'> | undefined;
                if (conversionBlockLinked.type === v3.ConversionType.TextRangeTable) {
                    conversionBlockInstanced = {
                        ...conversionBlockLinked,
                        default: v3.getLink(conversionBlockLinked.default) === 0 ? null : await v3.readTextBlock(conversionBlockLinked.default, reader),
                        table: await Promise.all(conversionBlockLinked.table.map(async x => [x[0], x[1], await v3.readTextBlock(x[2], reader)])),
                    };
                } else {
                    conversionBlockInstanced = conversionBlockLinked;
                }
                const {conversion, textValues} = v3.conversionToFunction(conversionBlockInstanced);
                channels.push({
                    name: [reader.file.name, v3.getLink(channel.longName) !== 0 ? (await readTextBlock(channel.longName, reader)).data : channel.name],
                    type: channel.channelType === 0 ? ChannelType.Signal : channel.channelType == 1 ? ChannelType.Time : ChannelType.Unknown,
                    dataType: mdf3TypeToDataType(channel.dataType, reader.littleEndian),
                    byteOffset: channel.byteOffset + Math.floor(channel.bitOffset / 8),
                    bitOffset: channel.bitOffset % 8,
                    bitCount: channel.bitCount,
                    conversion,
                    textValues,
                });
            }
            groups.push({
                recordId: Number(channelGroup.recordId),
                dataBytes: channelGroup.dataBytes + (dataGroup.recordIdType == 2 ? 1 : 0), // Include the extra record ID at the end
                invalidationBytes: 0,
                channels,
            });
        }
        const data: AbstractDataGroup = {
            recordIdSize: dataGroup.recordIdType == 0 ? 0 : 1,
            totalRows,
            groups,
        };
        sources.push(...new DataGroupLoader(data, () => v3.getDataBlocks(dataGroup, reader)).sources());
    }

    return sources;
}
async function readMf4(reader: BufferedFileReader) {
    // Parse the first block (Header block) at offset 64
    const rootLink = newLink<Header>(64n);
    const header = await readHeader(rootLink, reader);
    console.log(header);
    
    let sources: SignalSource[] = [];

    for await (const dataGroup of iterateDataGroupBlocks(header.firstDataGroup, reader)) {
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
                    // TODO: Should parse this XML properly
                    block.mdUnit = deserializeMetadataBlock(unit);
                } else {
                    throw new Error(`Invalid block type in channel conversion block: "${unit.type}"`);
                }
            }

            return block;
        }
        const groups: AbstractGroup[] = [];
        for await (const channelGroup of iterateChannelGroupBlocks(dataGroup.channelGroupFirst, reader)) {
            const channels: AbstractChannel[] = [];
            for await (const channel of iterateChannelBlocks(channelGroup.channelFirst, reader)) {
                const conversionBlock = await readConversionBlockRecurse(channel.conversion);
                const {conversion, textValues} = v4.conversionToFunction(conversionBlock);
                channels.push({
                    name: [reader.file.name, (await readTextBlock(channel.txName, reader)).data],
                    type: channel.channelType === 2 ? ChannelType.Time : channel.channelType == 0 ? ChannelType.Signal : ChannelType.Unknown,
                    dataType: mdf4TypeToDataType(channel.dataType),
                    byteOffset: channel.byteOffset,
                    bitOffset: channel.bitOffset,
                    bitCount: channel.bitCount,
                    conversion,
                    textValues,
                });
            }
            groups.push({
                recordId: Number(channelGroup.recordId),
                dataBytes: channelGroup.dataBytes,
                invalidationBytes: channelGroup.invalidationBytes,
                channels,
            });
        }
        const data: AbstractDataGroup = {
            recordIdSize: dataGroup.recordIdSize,
            groups,
        };
        sources.push(...new DataGroupLoader(data, () => getDataBlocks(dataGroup, reader)).sources());
    }
    return sources;
}

