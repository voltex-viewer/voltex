import { InMemorySequence, SequenceSignal, Signal, SignalSource, TextValue, RenderMode } from "@voltex-viewer/plugin-api";

class MdfSource implements SignalSource {
    constructor(public readonly name: string[], public signal: () => Promise<Signal>) {
    }
}

export enum ChannelType {
    Time = 0,
    Signal = 1,
    Unknown = 2,
}

export enum DataType {
    UintLe = 0,
    UintBe = 1,
    IntLe = 2,
    IntBe = 3,
    FloatLe = 4,
    FloatBe = 5,
    Unknown = 6,
}

export interface AbstractDataGroup {
    recordIdSize: number;
    groups: AbstractGroup[];
    totalRows?: number | undefined;
}

export interface AbstractGroup {
    recordId: number;
    dataBytes: number;
    invalidationBytes: number;
    channels: AbstractChannel[];
}

export interface AbstractChannel {
    name: string[];
    type: ChannelType;
    dataType: DataType;
    byteOffset: number;
    bitOffset: number;
    bitCount: number;
    conversion: (value: number) => number | string;
    textValues: TextValue[];
}

export class DataGroupLoader {
    private signals: Map<AbstractChannel, SequenceSignal> = new Map();
    private loaded: boolean = false;
    private mappedSources: Map<AbstractChannel, SignalSource>;

    constructor(private data: AbstractDataGroup, private blocks: () => Promise<AsyncIterableIterator<DataView<ArrayBuffer>>>) {
        this.mappedSources = new Map(this.data.groups.flatMap(group => group.channels.map(channel => [channel, new MdfSource(channel.name, () => Promise.resolve(this.get(channel)))])));
    }

    sources(): SignalSource[] {
        return Array.from(this.mappedSources)
            .filter(([channel, ]) => channel.type == ChannelType.Signal)
            .map(([_, source]) => source);
    }

    get(channel: AbstractChannel): Signal {
        this.load();
        return this.signals.get(channel)!;
    }

    async load() {
        if (this.loaded) {
            return;
        } else {
            this.loaded = true;
        }
        let records = new Map<number, {length: number, sequences: {sequence: InMemorySequence, loader: ((buffer: DataView) => number)}[]}>();
        for (const group of this.data.groups) {
            if (group.channels.length == 0) {
                continue;
            }
            const recordId = this.data.recordIdSize == 0 ? 0 : group.recordId;
            if (records.has(recordId)) {
                throw new Error(`Duplicate record ID found: ${recordId}`);
            }
            if (recordId >= (1n << BigInt(this.data.recordIdSize * 8))) {
                console.warn(`Record ID ${recordId} exceeds maximum value for ${this.data.recordIdSize * 8}-bit unsigned integer`);
            }
            const sequences = [];
            for (let i = 0; i < group.channels.length; i++) {
                const channel = group.channels[i];
                const sequence = new InMemorySequence(channel.conversion == null ? undefined : channel.conversion);
                sequences.push({
                    sequence,
                    loader: getLoader(channel.dataType, channel.byteOffset, channel.bitOffset, channel.bitCount),
                });
            }
            const masterIndex = group.channels.findIndex(c => c.type == ChannelType.Time);
            if (masterIndex === -1) {
                throw new Error(`No master channel found in group with record ID ${recordId}`);
            }
            const masterSequence = sequences[masterIndex].sequence;
            for (let i = 0; i < group.channels.length; i++) {
                const channel = group.channels[i];
                const sequence = sequences[i].sequence;
                this.signals.set(channel, new SequenceSignal(this.mappedSources.get(channel)!, masterSequence, sequence, channel.textValues.length >= 2 ? RenderMode.Enum : RenderMode.Lines));
            }
            records.set(recordId, {length: group.dataBytes + group.invalidationBytes, sequences});
        }
        let rowCount = 0;
        let totalRows = this.data.totalRows ?? 0;
        await parseData(
            this.data.recordIdSize,
            await this.blocks(),
            records,
            (context, view) => {
                for (const {sequence, loader} of context.sequences) {
                    const value = loader(view);
                    sequence.push(value);
                }
                rowCount += 1;
                return rowCount == totalRows;
            });
        console.log(`  Total Rows: ${rowCount}`);
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

async function parseData<T>(recordIdSize: number, blocks: AsyncIterableIterator<DataView<ArrayBuffer>>, records: ReadonlyMap<number, T & {length: number}>, rowHandler: (context: T, chunk: DataView) => boolean): Promise<void> {
    let carry = new Uint8Array(recordIdSize + Math.max(...records.values().map(x => x.length)));
    let carryLength = 0;

    function getMetadata(view: DataView) {
        let recordId;
        if (recordIdSize === 0) {
            recordId = 0;
        } else if (recordIdSize === 1) {
            recordId = view.getUint8(0);
        } else if (recordIdSize === 2) {
            recordId = view.getUint16(0, true);
        } else if (recordIdSize === 4) {
            recordId = view.getUint32(0, true);
        } else if (recordIdSize === 8) {
            recordId = Number(view.getBigUint64(0, true));
        } else {
            throw new Error(`Unsupported record size: ${recordIdSize}`);
        }
        const metadata = records.get(recordId);
        if (typeof(metadata) === "undefined") {
            throw new Error(`Unknown record ID: ${recordId}`);
        }
        return metadata;
    }

    for await (const dataBlock of blocks) {
        const blockData = new Uint8Array(dataBlock.buffer, dataBlock.byteOffset, dataBlock.byteLength);
        let blockDataOffset = 0;
        // Check if there is any data carried from the last data block
        if (carryLength > 0) {
            if (carryLength < recordIdSize) {
                const newData = blockData.subarray(0, Math.max(recordIdSize - carryLength, 0));
                carry.set(newData, carryLength);
                carryLength += newData.length;
                blockDataOffset += newData.length;
            }
            if (carryLength >= recordIdSize) {
                const metadata = getMetadata(new DataView(carry.buffer, 0, carryLength));
                if (carryLength < recordIdSize + metadata.length) {
                    const newData = blockData.subarray(blockDataOffset, blockDataOffset + recordIdSize + metadata.length - carryLength);
                    carry.set(newData, carryLength);
                    carryLength += newData.length;
                    blockDataOffset += newData.length;
                }
                if (carryLength == recordIdSize + metadata.length) {
                    rowHandler(metadata, new DataView(carry.buffer, recordIdSize, metadata.length));
                    carryLength = 0;
                }
            }
        }
        let buffer = blockData.subarray(blockDataOffset);
        while (buffer.length >= recordIdSize) {
            const metadata = getMetadata(new DataView(buffer.buffer, buffer.byteOffset, buffer.length));
            if (buffer.length < recordIdSize + metadata.length) {
                break;
            }
            buffer = buffer.subarray(recordIdSize); // Consume the record ID
            if (rowHandler(metadata, new DataView(buffer.buffer, buffer.byteOffset, metadata.length))) {
                return;
            }
            buffer = buffer.subarray(metadata.length); // Consume the record data
        }
        if (buffer.length > 0)
        {
            carry.set(buffer, carryLength);
            carryLength += buffer.length;
        }
    }
}
