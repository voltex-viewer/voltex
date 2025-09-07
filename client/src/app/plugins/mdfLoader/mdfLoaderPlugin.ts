import { Sequence, SequenceSignal, Signal } from '../../Signal';
import { PluginContext, SignalSource } from '../../Plugin';
import {
    Link, newLink, getLink, readBlock,
    deserializeId,
    Header, readHeader,
    DataGroupBlock, iterateDataGroupBlocks, getDataBlocks,
    ChannelGroupBlock, iterateChannelGroupBlocks,
    ChannelBlock, iterateChannelBlocks, DataType,
    TextBlock, deserializeTextBlock, deserializeMetadataBlock, readTextBlock,
    ChannelConversionBlock, readConversionBlock, ConversionType,
    resolveHeaderOffset
} from './blocks';
import { SerializeContext } from './blocks/serializer';

async function parseData<T>(dataGroup: DataGroupBlock, file: File, rowHandler: (context: T, chunk: DataView) => void, records: ReadonlyMap<number, T & {length: number}>): Promise<void> {
    const recordSize = dataGroup.recordIdSize;

    let carry = new Uint8Array(recordSize + Math.max(...records.values().map(x => x.length)));
    let carryLength = 0;

    function getMetadata(array: ArrayBuffer) {
        let recordId;
        const view = new DataView(array);
        if (recordSize === 0) {
            recordId = 0;
        } else if (recordSize === 1) {
            recordId = view.getUint8(0);
        } else if (recordSize === 2) {
            recordId = view.getUint16(0, true);
        } else if (recordSize === 4) {
            recordId = view.getUint32(0, true);
        } else if (recordSize === 8) {
            recordId = Number(view.getBigUint64(0, true));
        } else {
            throw new Error(`Unsupported record size: ${recordSize}`);
        }
        return records.get(recordId);
    }

    for await (const dataBlock of await getDataBlocks(dataGroup, file)) {
        const blockData = new Uint8Array(dataBlock.data.buffer, dataBlock.data.byteOffset, dataBlock.data.byteLength);
        let blockDataOffset = 0;
        // Check if there is any data carried from the last data block
        if (carryLength > 0) {
            if (carryLength < recordSize) {
                const newData = blockData.subarray(0, Math.max(recordSize - carryLength, 0));
                carry.set(newData, carryLength);
                carryLength += newData.length;
                blockDataOffset += newData.length;
            }
            if (carryLength >= recordSize) {
                const metadata = getMetadata(carry.buffer);
                if (carryLength < recordSize + metadata.length) {
                    const newData = blockData.subarray(blockDataOffset, blockDataOffset + recordSize + metadata.length - carryLength);
                    carry.set(newData, carryLength);
                    carryLength += newData.length;
                    blockDataOffset += newData.length;
                }
                if (carryLength == recordSize + metadata.length) {
                    rowHandler(metadata, new DataView(carry.buffer, recordSize, carry.length));
                    carryLength = 0;
                }
            }
        }
        let buffer = blockData.subarray(blockDataOffset);
        while (buffer.length >= recordSize) {
            const metadata = getMetadata(buffer.buffer);
            if (buffer.length < recordSize + metadata.length) {
                break;
            }
            buffer = buffer.subarray(recordSize); // Consume the record ID
            rowHandler(metadata, new DataView(buffer.buffer, buffer.byteOffset, metadata.length));
            buffer = buffer.subarray(metadata.length); // Consume the record data
        }
        if (buffer.length > 0)
        {
            carry.set(buffer, carryLength);
            carryLength += buffer.length;
        }
    }
}

function getLoader(dataType: DataType, byteOffset: number, bitOffset: number, bitCount: number) {
    function getExpression() {
        switch (dataType) {
            case DataType.FloatLe:
            case DataType.FloatBe: {
                const littleEndian = dataType === DataType.FloatLe;
                if (bitOffset != 0) {
                    throw new Error(`Unsupported bit offset ${bitOffset} for FloatLe`);
                }
                if (bitCount === 32) {
                    return `return view.getFloat32(${byteOffset}, ${littleEndian});`;
                } else if (bitCount === 64) {
                    return `return view.getFloat64(${byteOffset}, ${littleEndian});`;
                } else {
                    throw new Error(`Unsupported bit count ${bitCount} for FloatLe`);
                }
            }
            case DataType.UintLe:
            case DataType.UintBe:
            case DataType.IntLe:
            case DataType.IntBe: {
                const littleEndian = (dataType === DataType.UintLe) || (dataType === DataType.IntLe);
                const isSigned = (dataType === DataType.IntLe) || (dataType === DataType.IntBe);
                // Simple case - no bit offset
                if (bitOffset == 0) {
                    const type = isSigned ? 'Int' : 'Uint';
                    if (bitCount === 8) {
                        return `return view.get${type}8(${byteOffset});`;
                    } else if (bitCount === 16) {
                        return `return view.get${type}16(${byteOffset}, ${littleEndian});`;
                    } else if (bitCount === 32) {
                        return `return view.get${type}32(${byteOffset}, ${littleEndian});`;
                    } else if (bitCount === 64) {
                        return `return Number(view.getBig${type}64(${byteOffset}, ${littleEndian}));`;
                    }
                }
                // Complex case - with masking and/or shifting
                const mask = (1 << bitCount) - 1;
                const parts = [];
                const end = Math.ceil((bitCount + bitOffset) / 8);
                for (let i = 0; i < end; i++)
                {
                    const byte = littleEndian ? byteOffset + i : byteOffset + end - 1 - i;
                    const shift = i * 8 - (bitOffset % 8);
                    if (shift == 0) {
                        parts.push(`view.getUint8(${byte})`);
                    } else if (shift <= 0) {
                        parts.push(`(view.getUint8(${byte}) >> ${-shift})`);
                    } else {
                        parts.push(`(view.getUint8(${byte}) << ${shift})`);
                    }
                }
                if (isSigned) {
                    return `const value = (${parts.join(" | ")}) & 0x${mask.toString(16)};` +
                           `return value >= 0x${(1 << (bitCount - 1)).toString(16)} ? value - 0x${(1 << bitCount).toString(16)} : value;`;
                } else {
                    return `return (${parts.join(" | ")}) & 0x${mask.toString(16)};`;
                }
            }
            default:
                return "return 0;";
        }
    }
    return new Function("view", getExpression()) as (view: DataView) => number;
}

class Mf4Source implements SignalSource {
    discrete: boolean;

    constructor(public readonly name: string[], private loader: DataGroupLoader, public channel: ChannelBlock) {
        this.discrete = false;
    }

    signal(): Signal {
        return this.loader.get(this);
    }
}

class DataGroupLoader {
    private signals: Map<ChannelBlock, SequenceSignal> = new Map();
    private loaded: boolean = false;
    private groups: {group: ChannelGroupBlock, channels: {source: SignalSource, channel: ChannelBlock, name: string, conversion: (value: number) => number | string}[]}[];

    constructor(private dataGroup: DataGroupBlock, groups: {group: ChannelGroupBlock, channels: {channel: ChannelBlock, name: string, conversion: (value: number) => number | string}[]}[], private file: File) {
        this.groups = groups.map(({group, channels}) => ({
            group,
            channels: channels.map(({channel, name, conversion}) => ({
                source: new Mf4Source([file.name, name], this, channel),
                channel,
                conversion,
                name
            }))
        }));
    }

    sources(): SignalSource[] {
        return this.groups.flatMap(({channels}) => channels.map(({source}) => source));
    }

    get(source: Mf4Source): Signal {
        this.load();
        return this.signals.get(source.channel)!;
    }

    async load() {
        if (this.loaded) {
            return;
        } else {
            this.loaded = true;
        }
        let records = new Map<number, {length: number, sequences: {sequence: Sequence, loader: ((buffer: DataView) => number), conversion: (value: number) => number | string}[]}>();
        for (const {group, channels} of this.groups) {
            const recordId = Number(group.recordId);
            if (records.has(recordId)) {
                throw new Error(`Duplicate record ID found: ${recordId}`);
            }
            if (recordId >= (1 << this.dataGroup.recordIdSize)) {
                throw new Error(`Record ID ${recordId} exceeds maximum value for ${this.dataGroup.recordIdSize}-bit unsigned integer`);
            }
            const sequences = [];
            for (let i = 0; i < channels.length; i++) {
                const {channel, source, conversion, name} = channels[i];
                const sequence = new Sequence();
                sequences.push({
                    sequence,
                    loader: getLoader(channel.dataType, channel.byteOffset, channel.bitOffset, channel.bitCount),
                    conversion,
                });
                this.signals.set(channels[i].channel, new SequenceSignal(source, sequences[0].sequence, sequence));
            }
            records.set(recordId, {length: group.dataBytes + group.invalidationBytes, sequences});
        }
        let rowCount = 0;
        await parseData(this.dataGroup, this.file, (context, view) => {
            for (const {sequence, loader, conversion} of context.sequences)
            {
                const result = conversion(loader(view));
                if (typeof result === 'number') {
                    sequence.push(result);
                } else {
                    // For string results, we can either skip or convert to a number
                    // For now, we'll push 0 as a placeholder for string values
                    sequence.push(0);
                }
            }
            rowCount += 1;
        }, records);
        console.log(`  Total Rows: ${rowCount}`);
    }
}

function conversionToFunction(conversionMap: Map<Link<ChannelConversionBlock>, ChannelConversionBlock>, strings: Map<Link<TextBlock>, string>, link: Link<ChannelConversionBlock>): (value: number) => number | string {
    function convert(link: Link<ChannelConversionBlock>): (value: number) => number | string {
        const conversion = conversionMap.get(link);
        if (!conversion) {
            throw new Error(`Unknown conversion: ${link}`);
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
                    const str = strings.get(conversion.refs[i]);
                    conversionMap.set(conversion.values[i], typeof(str) !== 'undefined' ? str : convert(conversion.refs[i]));
                }
                const defaultRef = conversion.refs[conversion.refs.length - 1];
                let defaultValue: string | ((value: number) => number | string) | undefined;
                if (getLink(defaultRef) === 0n) {
                    defaultValue = undefined;
                } else {
                    const str = strings.get(defaultRef);
                    defaultValue = typeof(str) !== 'undefined' ? str : convert(defaultRef);
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
            case ConversionType.TextToValue:
            case ConversionType.TextToText:
            default:
                return value => 0;
        }
    }
    return convert(link);
}

export default (context: PluginContext): void => {
    context.registerFileOpenHandler({
        extensions: ['.mf4', '.mdf'],
        description: 'MDF/MF4 Measurement Files',
        mimeType: '*/*',
        handler: async (file: File) => {
            const id = deserializeId(await file.slice(0, 64).arrayBuffer());
            
            if (id.header !== "MDF     " && id.header !== "UnFinMF ") {
                throw new Error(`Invalid MDF header: "${id.header}"`);
            }
            
            // Parse the first block (Header block) at offset 64
            const rootLink = newLink<Header>(64n);
            const header = await readHeader(rootLink, file);
            console.log(header);
            
            let sources: SignalSource[] = [];

            for await (const dataGroup of iterateDataGroupBlocks(header.firstDataGroup, file)) {
                const groups = [];
                // Defer figuring out the conversions so that the results can be cached and limit async scope
                const conversionMap = new Map<Link<ChannelConversionBlock>, ChannelConversionBlock>();
                const strings = new Map<Link<TextBlock>, string>();
                async function readConversionBlockRecurse(link: Link<ChannelConversionBlock>) {
                    if (conversionMap.has(link)) {
                        return conversionMap.get(link);
                    }
                    const block = await readConversionBlock(link, file);
                    conversionMap.set(link, block);
                    for (const ref of block.refs.filter(x => getLink(x) !== 0n)) {
                        const block = await readBlock(ref, file);
                        
                        if (block.type === "##CC") {
                            await readConversionBlockRecurse(ref);
                        } else if (block.type === "##TX") {
                            strings.set(ref, deserializeTextBlock(block).data);
                        } else {
                            throw new Error(`Invalid block type in channel conversion block: "${block.type}"`);
                        }
                    }
                    
                    if (getLink(block.mdUnit) !== 0n) {
                        const unit = await readBlock(block.mdUnit, file);

                        if (unit.type === "##TX") {
                            strings.set(block.mdUnit, deserializeTextBlock(unit).data);
                        } else if (unit.type == "##MD") {
                            // TODO: Should parse this XML properly
                            strings.set(block.mdUnit, deserializeMetadataBlock(unit).data);
                        } else {
                            throw new Error(`Invalid block type in channel conversion block: "${unit.type}"`);
                        }
                    }

                    return block;
                }
                for await (const channelGroup of iterateChannelGroupBlocks(dataGroup.channelGroupFirst, file)) {
                    const channels = [];
                    for await (const channel of iterateChannelBlocks(channelGroup.channelFirst, file)) {
                        const name = (await readTextBlock(channel.txName, file)).data;
                        await readConversionBlockRecurse(channel.conversion);
                        channels.push({channel, name, conversion: channel.conversion});
                    }
                    groups.push({group: channelGroup, channels});
                }

                const resolvedGroups = groups.map(g => ({
                    ...g,
                    channels: g.channels.map(c => ({
                        ...c,
                        conversion: conversionToFunction(conversionMap, strings, c.conversion),
                    })),
                }));

                sources.push(...new DataGroupLoader(dataGroup, resolvedGroups, file).sources());
            }

            context.signalSources.add(...sources);
        }
    });

    context.registerFileSaveHandler({
        extensions: ['.mf4', '.mdf'],
        description: 'MDF/MF4 Measurement Files',
        mimeType: '*/*',
        handler: async (file: FileSystemWritableFileStream) => {
            const header: Header<'instanced'> = {
                firstDataGroup: {
                    dataGroupNext: null,
                    channelGroupFirst: {
                        channelGroupNext: null,
                        channelFirst: {
                            channelNext: null,
                            component: null,
                            txName: {
                                data: "Channel1",
                            },
                            siSource: null,
                            conversion: null,
                            data: null,
                            unit: null,
                            comment: null,
                            channelType: 0,
                            syncType: 0,
                            dataType: DataType.UintLe,
                            bitOffset: 0,
                            byteOffset: 0,
                            bitCount: 8,
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
                        },
                        acquisitionName: {
                            data: "Test",
                        },
                        acquisitionSource: null,
                        sampleReductionFirst: null,
                        comment: null,
                        recordId: 0n,
                        cycleCount: 0n,
                        flags: 0,
                        pathSeparator: 0,
                        dataBytes: 1,
                        invalidationBytes: 0,
                    },
                    data: null,
                    comment: null,
                    recordIdSize: 0,
                },
                fileHistory: {
                    fileHistoryNext: null,
                    comment: {
                        data: `<FHcomment xmlns='http://www.asam.net/mdf/v4'><TX>File was created.</TX><tool_id>Voltex</tool_id><tool_vendor>Voltex</tool_vendor><tool_version>1.0</tool_version><user_name>User</user_name></FHcomment>`,
                    },
                    time: 0n,
                    timeZone: 0,
                    dstOffset: 0,
                    timeFlags: 0,
                },
                channelHierarchy: null,
                attachment: null,
                event: null,
                comment: null,
                startTime: 0n,
                timeZone: 0,
                dstOffset: 0,
                timeFlags: 0,
                timeQuality: 0,
                flags: 0,
                startAngle: 0n,
                startDistance: 0n,
            };
            const context = new SerializeContext();
            resolveHeaderOffset(context, header);
            const writer = file.getWriter();
            await context.serialize(writer);
            writer.close();
        }
    });
}

