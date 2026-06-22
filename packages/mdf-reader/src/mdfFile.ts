import { BufferedFileReader } from './bufferedFileReader';
import { ChannelType, DataType, NumberType, AbstractChannel, AbstractDataGroup, AbstractGroup, DataGroupLoader, getNumberType } from './decoder';
import { SerializableConversionData } from './conversion';
import * as v3 from './v3';
import * as v4 from './v4';

export interface MdfChannel {
    readonly name: string;
    readonly channelType: ChannelType;
    readonly numberType: NumberType;
    getConversion(): Promise<SerializableConversionData>;
    getUnit(): Promise<string | null>;
}

export interface MdfChannelGroup {
    readonly name: string | null;
    readonly channels: MdfChannel[];
    readonly rowCount: number;
}

export interface MdfDataGroup {
    readonly channelGroups: MdfChannelGroup[];
}

export interface GrowableBuffer<TBuffer> {
    push(value: number | bigint): void;
    getBuffer(): TBuffer;
    length(): number;
}

export interface ReadOptions {
    onProgress?: () => void;
}

export interface OpenOptions {
    onProgress?: (signalCount: number) => void;
}

export interface MdfFile {
    readonly filename: string;
    readonly version: number;
    /** Absolute recording start in unix seconds (UTC), or undefined if the file has none. */
    readonly startTime?: number | undefined;
    getGroups(): MdfDataGroup[];
    read(
        channels: Array<{ channel: MdfChannel; buffer: { push(value: number | bigint): void } }>,
        options?: ReadOptions
    ): Promise<void>;
}

interface LazySignal {
    name: string;
    channelType: ChannelType;
    channel: AbstractChannel;
    conversionLink: number | bigint;
    unitLink: number | bigint;
}

interface CachedGroup {
    dataGroup: AbstractDataGroup;
    dgLink: v3.Link<v3.DataGroupBlock> | v4.Link<v4.DataGroupBlock>;
}

class MdfChannelImpl implements MdfChannel {
    readonly name: string;
    readonly channelType: ChannelType;
    readonly numberType: NumberType;
    readonly lazy: LazySignal;
    readonly channelGroup: MdfChannelGroupImpl;
    private mdf: MdfFileImpl;
    private cachedConversion: SerializableConversionData | null = null;

    constructor(lazy: LazySignal, mdf: MdfFileImpl, channelGroup: MdfChannelGroupImpl) {
        this.name = lazy.name;
        this.channelType = lazy.channelType;
        this.numberType = getNumberType(lazy.channel);
        this.lazy = lazy;
        this.mdf = mdf;
        this.channelGroup = channelGroup;
    }

    async getConversion(): Promise<SerializableConversionData> {
        if (!this.cachedConversion) {
            this.cachedConversion = await this.mdf.loadConversion(this.lazy.conversionLink);
        }
        return this.cachedConversion;
    }

    async getUnit(): Promise<string | null> {
        if (this.lazy.unitLink !== 0 && this.lazy.unitLink !== 0n) {
            return this.mdf.loadTextBlock(this.lazy.unitLink);
        }
        const conversion = await this.getConversion();
        return conversion.unit;
    }
}

class MdfChannelGroupImpl implements MdfChannelGroup {
    readonly channels: MdfChannelImpl[] = [];

    constructor(
        public readonly dataGroup: MdfDataGroupImpl,
        public readonly name: string | null,
        public readonly rowCount: number,
    ) {}
}

class MdfDataGroupImpl implements MdfDataGroup {
    readonly channelGroups: MdfChannelGroupImpl[] = [];
    cachedGroup: CachedGroup = null!;
}

class MdfFileImpl implements MdfFile {
    readonly filename: string;
    readonly version: number;
    startTime?: number | undefined;
    private dataGroups: MdfDataGroupImpl[] = [];
    private reader: BufferedFileReader;

    private constructor(reader: BufferedFileReader) {
        this.reader = reader;
        this.filename = reader.file.name;
        this.version = reader.version;
    }

    static async open(file: File, options?: OpenOptions): Promise<MdfFile> {
        const reader = new BufferedFileReader(file);
        const id = v4.deserializeId(await file.slice(0, 64).arrayBuffer());

        if (id.header !== "MDF     " && id.header !== "UnFinMF ") {
            throw new Error(`Invalid MDF header: "${id.header}"`);
        }

        reader.version = id.version;
        reader.littleEndian = id.littleEndian;

        const mdf = new MdfFileImpl(reader);

        if (id.version >= 400 && id.version < 500) {
            await mdf.loadGroupsV4(options?.onProgress);
        } else if (id.version >= 300 && id.version < 400) {
            await mdf.loadGroupsV3(options?.onProgress);
        } else {
            throw new Error(`Unsupported MDF version: ${id.version}`);
        }

        console.log(`Cache stats when loading "${file.name}":`, reader.getCacheStats());

        return mdf;
    }

    private async loadGroupsV3(onProgress?: (signalCount: number) => void): Promise<void> {
        const rootLink = v3.newNonNullLink<v3.Header>(64);
        const header = await v3.readHeader(rootLink, this.reader);

        if (header.startTime !== undefined && header.startTime !== 0n) {
            this.startTime = Number(header.startTime) / 1e9;
        }

        let dgLink = header.firstDataGroup as v3.Link<v3.DataGroupBlock>;
        let totalSignalCount = 0;
        let lastProgressUpdate = 0;

        while (v3.isNonNullLink(dgLink)) {
            const dgBlockLink = dgLink;
            const dgBlock = await v3.readDataGroupBlock(dgBlockLink, this.reader);

            const abstractGroups: AbstractGroup[] = [];
            const dgImpl = new MdfDataGroupImpl();
            let totalRows = 0;

            for await (const channelGroup of v3.iterateChannelGroupBlocks(dgBlock.channelGroupFirst, this.reader)) {
                totalRows += channelGroup.numberOfRecords;
                const groupChannels: AbstractChannel[] = [];
                const cgImpl = new MdfChannelGroupImpl(dgImpl, null, channelGroup.numberOfRecords);

                for await (const channel of v3.iterateChannelBlocks(channelGroup.channelFirst, this.reader)) {
                    const name = channel.longName && v3.isNonNullLink(channel.longName)
                        ? (await v3.readTextBlock(channel.longName, this.reader))?.data ?? channel.name
                        : channel.name;
                    const channelType = channel.channelType === 1 ? ChannelType.Time :
                                        channel.channelType === 0 ? ChannelType.Signal : ChannelType.Unknown;

                    const abstractChannel: AbstractChannel = {
                        name: [this.filename, name],
                        type: channelType,
                        dataType: this.mdf3TypeToDataType(channel.dataType),
                        byteOffset: (channel.byteOffset ?? 0) + Math.floor(channel.bitOffset / 8),
                        bitOffset: channel.bitOffset % 8,
                        bitCount: channel.bitCount,
                    };
                    groupChannels.push(abstractChannel);

                    const lazy: LazySignal = {
                        name,
                        channelType,
                        channel: abstractChannel,
                        conversionLink: v3.getLink(channel.conversion),
                        unitLink: 0,
                    };
                    cgImpl.channels.push(new MdfChannelImpl(lazy, this, cgImpl));

                    if (onProgress) {
                        totalSignalCount++;
                        const now = performance.now();
                        if (now - lastProgressUpdate > 100) {
                            onProgress(totalSignalCount);
                            lastProgressUpdate = now;
                        }
                    }
                }

                dgImpl.channelGroups.push(cgImpl);

                abstractGroups.push({
                    recordId: Number(channelGroup.recordId),
                    dataBytes: channelGroup.dataBytes + (dgBlock.recordIdType === 2 ? 1 : 0),
                    invalidationBytes: 0,
                    channels: groupChannels,
                });
            }

            dgImpl.cachedGroup = {
                dataGroup: { recordIdSize: dgBlock.recordIdType === 0 ? 0 : 1, totalRows, groups: abstractGroups },
                dgLink: dgBlockLink,
            };

            this.dataGroups.push(dgImpl);
            dgLink = dgBlock.dataGroupNext;
        }

        if (onProgress) {
            onProgress(totalSignalCount);
        }
    }

    private async loadGroupsV4(onProgress?: (signalCount: number) => void): Promise<void> {
        const rootLink = v4.newNonNullLink<v4.Header>(64n);
        const header = await v4.readHeader(rootLink, this.reader);

        if (header.startTime !== 0n) {
            this.startTime = Number(header.startTime) / 1e9;
        }

        let dgLink = header.firstDataGroup as v4.Link<v4.DataGroupBlock>;
        let totalSignalCount = 0;
        let lastProgressUpdate = 0;

        while (v4.isNonNullLink(dgLink)) {
            const dgBlockLink = dgLink;
            const dgBlock = await v4.readDataGroupBlock(dgBlockLink, this.reader);

            const abstractGroups: AbstractGroup[] = [];
            const dgImpl = new MdfDataGroupImpl();

            for await (const channelGroup of v4.iterateChannelGroupBlocks(dgBlock.channelGroupFirst, this.reader)) {
                const cgName = (await v4.readTextBlock(channelGroup.acquisitionName, this.reader))?.data ?? null;
                const groupChannels: AbstractChannel[] = [];
                const cgImpl = new MdfChannelGroupImpl(dgImpl, cgName, Number(channelGroup.cycleCount));

                for await (const channel of v4.iterateChannelBlocks(channelGroup.channelFirst, this.reader)) {
                    const channelName = (await v4.readTextBlock(channel.txName, this.reader))?.data ?? "";
                    const channelType = channel.channelType === 2 ? ChannelType.Time :
                                        channel.channelType === 0 ? ChannelType.Signal : ChannelType.Unknown;

                    const abstractChannel: AbstractChannel = {
                        name: [this.filename, channelName],
                        type: channelType,
                        dataType: this.mdf4TypeToDataType(channel.dataType),
                        byteOffset: channel.byteOffset,
                        bitOffset: channel.bitOffset,
                        bitCount: channel.bitCount,
                    };
                    groupChannels.push(abstractChannel);

                    const lazy: LazySignal = {
                        name: channelName,
                        channelType,
                        channel: abstractChannel,
                        conversionLink: v4.getLink(channel.conversion as v4.Link<unknown>),
                        unitLink: v4.getLink(channel.unit as v4.Link<unknown>),
                    };
                    cgImpl.channels.push(new MdfChannelImpl(lazy, this, cgImpl));

                    if (onProgress) {
                        totalSignalCount++;
                        const now = performance.now();
                        if (now - lastProgressUpdate > 100) {
                            onProgress(totalSignalCount);
                            lastProgressUpdate = now;
                        }
                    }
                }

                dgImpl.channelGroups.push(cgImpl);

                abstractGroups.push({
                    recordId: Number(channelGroup.recordId),
                    dataBytes: channelGroup.dataBytes,
                    invalidationBytes: channelGroup.invalidationBytes,
                    channels: groupChannels,
                });
            }

            dgImpl.cachedGroup = {
                dataGroup: { recordIdSize: dgBlock.recordIdSize, groups: abstractGroups },
                dgLink: dgBlockLink,
            };

            this.dataGroups.push(dgImpl);
            dgLink = dgBlock.dataGroupNext as v4.Link<v4.DataGroupBlock>;
        }

        if (onProgress) {
            onProgress(totalSignalCount);
        }
    }

    async loadConversion(conversionLink: number | bigint): Promise<SerializableConversionData> {
        if (this.version >= 400 && this.version < 500) {
            return this.loadConversionV4(conversionLink as bigint);
        } else {
            return this.loadConversionV3(conversionLink as number);
        }
    }

    async loadTextBlock(link: number | bigint): Promise<string | null> {
        if (this.version >= 400 && this.version < 500) {
            if (link === 0n) return null;
            const block = await v4.readTextBlock(v4.newNonNullLink(link as bigint), this.reader);
            return block.data;
        }
        return null;
    }

    private async loadConversionV3(conversionLink: number): Promise<SerializableConversionData> {
        if (conversionLink === 0) {
            return { conversion: null, textValues: [], unit: null };
        }
        const conversionBlockLinked = await v3.readChannelConversionBlock(v3.newNonNullLink(conversionLink), this.reader);
        const conversionBlockInstanced = await this.instanceMdf3ConversionBlock(conversionBlockLinked);
        return v3.serializeConversion(conversionBlockInstanced);
    }

    private async loadConversionV4(conversionLink: bigint): Promise<SerializableConversionData> {
        if (conversionLink === 0n) {
            return { conversion: null, textValues: [], unit: null };
        }
        const conversionMap = new Map<bigint, v4.ChannelConversionBlock<'instanced'>>();
        const block = await this.readV4ConversionBlockRecurse(v4.newNonNullLink(conversionLink), conversionMap);
        return v4.serializeConversion(block);
    }

    private async instanceMdf3ConversionBlock(
        conversionBlockLinked: v3.ChannelConversionBlock<'linked'>
    ): Promise<v3.ChannelConversionBlock<'instanced'>> {
        if (conversionBlockLinked.type === v3.ConversionType.TextRangeTable) {
            return {
                ...conversionBlockLinked,
                default: v3.getLink(conversionBlockLinked.default) === 0
                    ? null
                    : await v3.readTextBlock(conversionBlockLinked.default, this.reader),
                table: await Promise.all(
                    conversionBlockLinked.table.map(async x => [x[0], x[1], await v3.readTextBlock(x[2], this.reader)] as [number, number, v3.TextBlock])
                ),
            };
        } else {
            return conversionBlockLinked;
        }
    }

    private async readV4ConversionBlockRecurse(
        link: v4.Link<v4.ChannelConversionBlock>,
        conversionMap: Map<bigint, v4.ChannelConversionBlock<'instanced'>>
    ): Promise<v4.ChannelConversionBlock<'instanced'> | null> {
        if (!v4.isNonNullLink(link)) return null;
        const linkValue = v4.getLink(link);
        if (conversionMap.has(linkValue)) return conversionMap.get(linkValue)!;

        const srcBlock = await v4.readConversionBlock(link, this.reader);
        const block = {
            ...srcBlock,
            txName: null,
            mdUnit: null,
            mdComment: null,
            inverse: null,
            refs: [],
        } as v4.ChannelConversionBlock<'instanced'>;
        conversionMap.set(linkValue, block);

        for (const ref of srcBlock.refs) {
            if (!v4.isNonNullLink(ref)) {
                (block.refs as (v4.ChannelConversionBlock<'instanced'> | v4.TextBlock | null)[]).push(null);
            } else {
                const refBlock = await v4.readBlock(ref, this.reader);
                if (refBlock.type === "##CC") {
                    (block.refs as (v4.ChannelConversionBlock<'instanced'> | v4.TextBlock | null)[]).push(
                        await this.readV4ConversionBlockRecurse(ref as v4.Link<v4.ChannelConversionBlock>, conversionMap)
                    );
                } else if (refBlock.type === "##TX") {
                    (block.refs as (v4.ChannelConversionBlock<'instanced'> | v4.TextBlock | null)[]).push(
                        v4.deserializeTextBlock(refBlock)
                    );
                } else {
                    throw new Error(`Invalid block type in channel conversion block: "${refBlock.type}"`);
                }
            }
        }

        if (v4.isNonNullLink(srcBlock.mdUnit)) {
            const unit = await v4.readBlock(srcBlock.mdUnit, this.reader);
            if (unit.type === "##TX") {
                block.mdUnit = v4.deserializeTextBlock(unit);
            } else if (unit.type === "##MD") {
                block.mdUnit = v4.deserializeMetadataBlock(unit);
            }
        }

        return block;
    }

    private mdf3TypeToDataType(type: v3.DataType): DataType {
        switch (type) {
            case v3.DataType.Uint: return this.reader.littleEndian ? DataType.UintLe : DataType.UintBe;
            case v3.DataType.Int: return this.reader.littleEndian ? DataType.IntLe : DataType.IntBe;
            case v3.DataType.Float: return this.reader.littleEndian ? DataType.FloatLe : DataType.FloatBe;
            case v3.DataType.Double: return this.reader.littleEndian ? DataType.FloatLe : DataType.FloatBe;
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

    private mdf4TypeToDataType(type: v4.DataType): DataType {
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

    getGroups(): MdfDataGroup[] {
        return this.dataGroups;
    }

    async read(
        channels: Array<{ channel: MdfChannel; buffer: { push(value: number | bigint): void } }>,
        options?: ReadOptions
    ): Promise<void> {
        // Group requests by their parent data group so each data group is read in one pass
        const byDataGroup = new Map<MdfDataGroupImpl, Array<{ abstractChannel: AbstractChannel; buffer: { push(value: number | bigint): void } }>>();

        for (const { channel, buffer } of channels) {
            const channelImpl = channel as MdfChannelImpl;
            const dgImpl = channelImpl.channelGroup.dataGroup;
            if (!byDataGroup.has(dgImpl)) {
                byDataGroup.set(dgImpl, []);
            }
            byDataGroup.get(dgImpl)!.push({ abstractChannel: channelImpl.lazy.channel, buffer });
        }

        for (const [dgImpl, requests] of byDataGroup) {
            const { dataGroup, dgLink } = dgImpl.cachedGroup;

            // Build sequences map; same AbstractChannel with multiple buffers -> combined pusher
            const sequences = new Map<AbstractChannel, { push(value: number | bigint): void }>();
            for (const { abstractChannel, buffer } of requests) {
                const existing = sequences.get(abstractChannel);
                if (existing) {
                    const prev = existing;
                    sequences.set(abstractChannel, { push: (v) => { prev.push(v); buffer.push(v); } });
                } else {
                    sequences.set(abstractChannel, buffer);
                }
            }

            const getDataBlocks = async () => {
                if (this.version >= 400 && this.version < 500) {
                    const dgBlock = await v4.readDataGroupBlock(dgLink as v4.Link<v4.DataGroupBlock>, this.reader);
                    return dgBlock !== null ? v4.getDataBlocks(dgBlock, this.reader) : Promise.resolve((async function* () {})());
                } else {
                    const dgBlock = await v3.readDataGroupBlock(dgLink as v3.Link<v3.DataGroupBlock>, this.reader);
                    return dgBlock !== null ? v3.getDataBlocks(dgBlock, this.reader) : Promise.resolve((async function* () {})());
                }
            };

            const loader = new DataGroupLoader(dataGroup, getDataBlocks);
            await loader.loadInto(sequences, options);
        }
    }
}

export async function openMdfFile(file: File, options?: OpenOptions): Promise<MdfFile> {
    return MdfFileImpl.open(file, options);
}
