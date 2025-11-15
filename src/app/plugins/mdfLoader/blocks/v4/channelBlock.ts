import { Link, getLink, readBlock, MaybeLinked, GenericBlock } from './common';
import { resolveTextBlockOffset, TextBlock } from './textBlock';
import { ChannelConversionBlock, resolveChannelConversionOffset } from './channelConversionBlock';
import { SerializeContext } from './serializer';
import { BufferedFileReader } from '../../BufferedFileReader';

export enum DataType {
    UintLe = 0,
    UintBe = 1,
    IntLe = 2,
    IntBe = 3,
    FloatLe = 4,
    FloatBe = 5,
    StringAscii = 6,
    StringUtf8 = 7,
    StringUtf16Le = 8,
    StringUtf16Be = 9,
    ByteArray = 10,
    MimeSample = 11,
    MimeStream = 12,
    CanOpenDate = 13,
    CanOpenTime = 14,
    ComplexLe = 15,
    ComplexBe = 16,
}

export function parseDataType(value: number): DataType {
    if (value >= 0 && value <= 16) {
        return value as DataType;
    }
    throw new Error(`Invalid DataType value: ${value}`);
}

export interface ChannelBlock<TMode extends 'linked' | 'instanced' = 'linked'> {
    channelNext: MaybeLinked<ChannelBlock<TMode>, TMode>;
    component: MaybeLinked<unknown, TMode>;
    txName: MaybeLinked<TextBlock, TMode>;
    siSource: MaybeLinked<unknown, TMode>;
    conversion: MaybeLinked<ChannelConversionBlock<TMode>, TMode>;
    data: MaybeLinked<unknown, TMode>;
    unit: MaybeLinked<TextBlock, TMode>;
    comment: MaybeLinked<TextBlock, TMode>;
    channelType: number;
    syncType: number;
    dataType: DataType;
    bitOffset: number;
    byteOffset: number;
    bitCount: number;
    flags: number;
    invalidationBitPosition: number;
    precision: number;
    attachmentCount: number;
    valueRangeMinimum: number;
    valueRangeMaximum: number;
    limitMinimum: number;
    limitMaximum: number;
    limitExtendedMinimum: number;
    limitExtendedMaximum: number;
}

export function deserializeChannelBlock(block: GenericBlock): ChannelBlock<'linked'> {
    const view = block.buffer;

    return {
        channelNext: block.links[0] as Link<ChannelBlock>,
        component: block.links[1] as Link<unknown>,
        txName: block.links[2] as Link<TextBlock>,
        siSource: block.links[3] as Link<unknown>,
        conversion: block.links[4] as Link<ChannelConversionBlock>,
        data: block.links[5] as Link<unknown>,
        unit: block.links[6] as Link<TextBlock>,
        comment: block.links[7] as Link<unknown>,
        channelType: view.getUint8(0),
        syncType: view.getUint8(1),
        dataType: parseDataType(view.getUint8(2)),
        bitOffset: view.getUint8(3),
        byteOffset: view.getUint32(4, true),
        bitCount: view.getUint32(8, true),
        flags: view.getUint32(12, true),
        invalidationBitPosition: view.getUint32(16, true),
        precision: view.getUint8(20),
        attachmentCount: view.getUint16(22, true),
        valueRangeMinimum: view.getFloat64(24, true),
        valueRangeMaximum: view.getFloat64(32, true),
        limitMinimum: view.getFloat64(40, true),
        limitMaximum: view.getFloat64(48, true),
        limitExtendedMinimum: view.getFloat64(56, true),
        limitExtendedMaximum: view.getFloat64(64, true)
    };
}

export function serializeChannelBlock(view: DataView, context: SerializeContext, block: ChannelBlock<'instanced'>) {
    view.setBigUint64(0, context.get(block.channelNext), true);
    view.setBigUint64(8, context.get(block.component), true);
    view.setBigUint64(16, context.get(block.txName), true);
    view.setBigUint64(24, context.get(block.siSource), true);
    view.setBigUint64(32, context.get(block.conversion), true);
    view.setBigUint64(40, context.get(block.data), true);
    view.setBigUint64(48, context.get(block.unit), true);
    view.setBigUint64(56, context.get(block.comment), true);

    view.setUint8(64, block.channelType);
    view.setUint8(65, block.syncType);
    view.setUint8(66, block.dataType);
    view.setUint8(67, block.bitOffset);
    view.setUint32(68, block.byteOffset, true);
    view.setUint32(72, block.bitCount, true);
    view.setUint32(76, block.flags, true);
    view.setUint32(80, block.invalidationBitPosition, true);
    view.setUint8(84, block.precision);
    view.setUint16(86, block.attachmentCount, true);
    view.setFloat64(88, block.valueRangeMinimum, true);
    view.setFloat64(96, block.valueRangeMaximum, true);
    view.setFloat64(104, block.limitMinimum, true);
    view.setFloat64(112, block.limitMaximum, true);
    view.setFloat64(120, block.limitExtendedMinimum, true);
    view.setFloat64(128, block.limitExtendedMaximum, true);
}

export function resolveChannelOffset(context: SerializeContext, block: ChannelBlock<'instanced'>) {
    return context.resolve(
        block, 
        {
            type: "##CN",
            length: 136n,
            linkCount: 8n,
        },
        serializeChannelBlock,
        block => {
            resolveChannelOffset(context, block.channelNext);
            resolveTextBlockOffset(context, block.txName);
            resolveChannelConversionOffset(context, block.conversion);
            resolveTextBlockOffset(context, block.unit);
            resolveTextBlockOffset(context, block.comment);
        });
}

export async function readChannelBlock(link: Link<ChannelBlock>, reader: BufferedFileReader): Promise<ChannelBlock<'linked'>> {
    return deserializeChannelBlock(await readBlock(link, reader, "##CN"));
}

export async function* iterateChannelBlocks(startLink: Link<ChannelBlock>, reader: BufferedFileReader): AsyncIterableIterator<ChannelBlock<'linked'>> {
    let currentLink = startLink;
    
    while (getLink(currentLink) !== 0n) {
        const channel = await readChannelBlock(currentLink, reader);
        yield channel;
        currentLink = channel.channelNext;
    }
}
