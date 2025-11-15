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
} from './blocks';
import * as blocks from './blocks'
import { SerializeContext } from './blocks/serializer';
import { BufferedFileReader } from './BufferedFileReader';
import { AbstractChannel, AbstractDataGroup, AbstractGroup, ChannelType, DataGroupLoader, DataType } from './decoder';

function mdfTypeToDataType(type: blocks.DataType): DataType {
    switch (type) {
        case blocks.DataType.UintLe: return DataType.UintLe;
        case blocks.DataType.UintBe: return DataType.UintBe;
        case blocks.DataType.IntLe: return DataType.IntLe;
        case blocks.DataType.IntBe: return DataType.IntBe;
        case blocks.DataType.FloatLe: return DataType.FloatLe;
        case blocks.DataType.FloatBe: return DataType.FloatBe;
        default: return DataType.Unknown;
    }
}

function conversionToFunction(conversion: ChannelConversionBlock<'instanced'> | null): {conversion: null | ((value: number) => number | string), textValues: TextValue[]} {
    const textValues: TextValue[] = [];
    function convert(conversion: ChannelConversionBlock<'instanced'>): null | ((value: number) => number | string) {
        if (conversion === null) {
            return null;
        }
        switch (conversion.type) {
            case ConversionType.OneToOne:
                return (value) => value;
            case ConversionType.Linear:
                const [intercept, slope] = conversion.values;
                return value => {
                    return slope * value + intercept;
                };
            case ConversionType.Rational:
                const [numerator_x2, numerator_x1, numerator_x0, denominator_x2, denominator_x1, denominator_x0] = conversion.values;
                return value => {
                    return (numerator_x2 * value ** 2 + numerator_x1 * value + numerator_x0) / (denominator_x2 * value ** 2 + denominator_x1 * value + denominator_x0);
                };
            case ConversionType.Algebraic:
                const formula = conversion.refs[0];
                return new Function('X', `return ${formula.data.replaceAll('x', 'X').replaceAll('^', '**')};`) as (value: number) => number;
            case ConversionType.ValueToValueTableWithInterpolation:
            case ConversionType.ValueToValueTableWithoutInterpolation:
                const pairs = [];
                for (let i = 0; i < conversion.values.length; i += 2) {
                    pairs.push([conversion.values[i], conversion.values[i + 1]]);
                }
                pairs.sort((a, b) => a[0] - b[0]);
                const keys = pairs.map(pair => pair[0]);
                const values = pairs.map(pair => pair[1]);

                if (conversion.type === ConversionType.ValueToValueTableWithInterpolation) {
                    return value => {
                        if (value <= keys[0]) return values[0];
                        if (value >= keys[keys.length - 1]) return values[values.length - 1];
                        
                        let left = 0;
                        let right = keys.length - 1;
                        
                        while (left < right - 1) {
                            const mid = (left + right) >>> 1;
                            if (keys[mid] <= value) {
                                left = mid;
                            } else {
                                right = mid;
                            }
                        }
                        
                        const t = (value - keys[left]) / (keys[right] - keys[left]);
                        return values[left] + t * (values[right] - values[left]);
                    };
                } else {
                    return value => {
                        if (value <= keys[0]) return values[0];
                        if (value >= keys[keys.length - 1]) return values[values.length - 1];
                        
                        let left = 0;
                        let right = keys.length - 1;
                        
                        while (left < right - 1) {
                            const mid = (left + right) >>> 1;
                            if (keys[mid] <= value) {
                                left = mid;
                            } else {
                                right = mid;
                            }
                        }
                        
                        const leftDist = value - keys[left];
                        const rightDist = keys[right] - value;
                        
                        return leftDist <= rightDist ? values[left] : values[right];
                    };
                }

            case ConversionType.ValueRangeToValueTable: {
                if ((conversion.values.length % 3) !== 1) {
                    throw new Error(`Invalid number of values for ValueRangeToValueTable: ${conversion.values.length}`);
                }
                const groups = [];
                for (let i = 0; i < conversion.values.length - 2; i += 3) {
                    groups.push([conversion.values[i], conversion.values[i + 1], conversion.values[i + 2]]);
                }
                const defaultValue = conversion.values[conversion.values.length - 1];
                groups.sort((a, b) => a[0] - b[0]);
                const keys_min = groups.map(group => group[0]);
                const keys_max = groups.map(group => group[1]);
                const values = groups.map(group => group[2]);
                if (keys_min.length <= 8) {
                    return value => {
                        for (let i = 0; i < keys_min.length; i++) {
                            if (value >= keys_min[i] && value <= keys_max[i]) {
                                return values[i];
                            }
                        }
                        return defaultValue;
                    };
                } else {
                    return value => {
                        let left = 0;
                        let right = keys_min.length - 1;
                        
                        while (left <= right) {
                            const mid = (left + right) >>> 1;
                            if (value >= keys_min[mid] && value <= keys_max[mid]) {
                                return values[mid];
                            } else if (value < keys_min[mid]) {
                                right = mid - 1;
                            } else {
                                left = mid + 1;
                            }
                        }
                        return defaultValue;
                    };
                }
            }

            case ConversionType.ValueToTextOrScale: {
                if (conversion.values.length + 1 !== conversion.refs.length) {
                    throw new Error(`Mismatched lengths for ValueToTextOrScale`);
                }
                const conversionMap = new Map<number, string | ((value: number) => number | string)>();
                for (let i = 0; i < conversion.values.length; i++) {
                    const ref = conversion.refs[i];
                    if ('type' in ref) {
                        conversionMap.set(conversion.values[i], convert(ref));
                    } else {
                        conversionMap.set(conversion.values[i], ref.data);
                        textValues.push({text: ref.data, value: conversion.values[i]});
                    }
                }
                const defaultRef = conversion.refs[conversion.refs.length - 1];
                let defaultValue: string | ((value: number) => number | string) | undefined;
                if (defaultRef === null) {
                    defaultValue = undefined;
                } else if ('type' in defaultRef) {
                    defaultValue = convert(defaultRef);
                } else {
                    defaultValue = defaultRef.data;
                    textValues.push({text: defaultRef.data});
                }
                if (typeof(defaultValue) === "function") {
                    return value => {
                        const result = conversionMap.get(value);
                        switch (typeof(result)) {
                            case "function":
                                return result(value);
                            case "undefined":
                                return defaultValue(value);
                            default:
                                return result;
                        }
                    };
                } else {
                    return value => {
                        const result = conversionMap.get(value);
                        switch (typeof(result)) {
                            case "function":
                                return result(value);
                            case "undefined":
                                return defaultValue;
                            default:
                                return result;
                        }
                    };
                }
            }

            case ConversionType.ValueRangeToTextOrScale: {
                const count = conversion.values.length / 2;
                if (count + 1 !== conversion.refs.length || conversion.values.length % 2 !== 0) {
                    throw new Error(`Mismatched lengths for ValueRangeToTextOrScale`);
                }
                const conversionMap: { lower: number; upper: number; result: string | ((value: number) => number | string) }[] = [];
                for (let i = 0; i < count; i++) {
                    const ref = conversion.refs[i];
                    let result;
                    if ('type' in ref) {
                        result = convert(ref);
                    } else {
                        result = ref.data;
                        textValues.push({text: ref.data});
                    }
                    conversionMap.push({
                        lower: conversion.values[i * 2],
                        upper: conversion.values[i * 2 + 1],
                        result
                    });
                }
                // Technically the ranges should already be sorted, but we can be permissive here
                conversionMap.sort((a, b) => a.lower - b.lower);
                const defaultRef = conversion.refs[conversion.refs.length - 1];
                let defaultValue: string | ((value: number) => number | string) | undefined;
                if (defaultRef === null) {
                    defaultValue = undefined;
                } else if ('type' in defaultRef) {
                    defaultValue = convert(defaultRef);
                } else {
                    defaultValue = defaultRef.data;
                    textValues.push({text: defaultRef.data});
                }
                return value => {
                    const result = conversionMap.find(entry => entry.lower <= value && entry.upper >= value)?.result;
                    switch (typeof(result)) {
                        case "function":
                            return result(value);
                        case "undefined":
                            return typeof(defaultValue) === "function" ? defaultValue(value) : defaultValue;
                        default:
                            return result;
                    }
                };
            }

            case ConversionType.TextToValue:
            case ConversionType.TextToText:
            default:
                return value => 0;
        }
    }
    return {
        conversion: convert(conversion),
        textValues,
    };
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

            if (id.version < 400 || id.version >= 500) {
                throw new Error(`Unsupported MDF version: ${id.version} (long: ${id.versionLong})`);
            }
            
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
                        const {conversion, textValues} = conversionToFunction(conversionBlock);
                        channels.push({
                            name: [reader.file.name, (await readTextBlock(channel.txName, reader)).data],
                            type: channel.channelType === 2 ? ChannelType.Time : channel.channelType == 0 ? ChannelType.Signal : ChannelType.Unknown,
                            dataType: mdfTypeToDataType(channel.dataType),
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
                    dataType: blocks.DataType.FloatLe,
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
