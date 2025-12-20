import { Link, NonNullLink, isNonNullLink, readBlock, MaybeLinked, GenericBlock } from './common';
import { resolveTextBlockOffset, TextBlock } from './textBlock';
import { SerializeContext } from './serializer';
import { BufferedFileReader } from '../bufferedFileReader';
import { MdfView } from './mdfView';

export enum DataType {
    Uint = 0,
    Int = 1,
    Float = 2,
    Double = 3,
    FFloat = 4,
    GFloat = 5,
    DFloat = 6,
    String = 7,
    Bytes = 8,
    UintBe = 9,
    IntBe = 10,
    FloatBe = 11,
    DoubleBe = 12,
    UintLe = 13,
    IntLe = 14,
    FloatLe = 15,
    DoubleLe = 16,
}

export function parseDataType(value: number): DataType {
    if (value >= 0 && value <= 16) {
        return value as DataType;
    }
    throw new Error(`Invalid DataType value: ${value}`);
}

export interface ChannelBlock<TMode extends 'linked' | 'instanced' = 'linked'> {
    channelNext: MaybeLinked<ChannelBlock<TMode>, TMode>;
    conversion: MaybeLinked<unknown, TMode>;
    extensions: MaybeLinked<unknown, TMode>;
    dependency: MaybeLinked<unknown, TMode>;
    comment: MaybeLinked<TextBlock, TMode>;
    channelType: number;
    name: string;
    description: string;
    bitOffset: number;
    bitCount: number;
    dataType: DataType;
    rangeValid: boolean;
    minimum: number;
    maximum: number;
    sampleRate: number;
    longName?: MaybeLinked<TextBlock, TMode>; // MDF 2.12+
    displayName?: MaybeLinked<TextBlock, TMode>; // MDF 3.0+
    byteOffset?: number; // MDF 3.0+
}

export function deserializeChannelBlock(block: GenericBlock): ChannelBlock<'linked'> {
    const view = block.buffer;

    const result: ChannelBlock<'linked'> = {
        channelNext: view.readLink(),
        conversion: view.readLink(),
        extensions: view.readLink(),
        dependency: view.readLink(),
        comment: view.readLink(),
        channelType: view.readUint16(),
        name: view.readString(32),
        description: view.readString(128),
        bitOffset: view.readUint16(),
        bitCount: view.readUint16(),
        dataType: parseDataType(view.readUint16()),
        rangeValid: view.readBool(),
        minimum: view.readReal(),
        maximum: view.readReal(),
        sampleRate: view.readReal(),
    };

    if (view.remaining < 4) return result;
    result.longName = view.readLink(); // MDF 2.12+
    if (view.remaining < 4) return result;
    result.displayName = view.readLink(); // MDF 3.0+
    if (view.remaining < 2) return result;
    result.byteOffset = view.readUint16(); // MDF 3.0+

    return result;
}

export function serializeChannelBlock(_view: MdfView, _context: SerializeContext, _block: ChannelBlock<'instanced'>) {
    
}

export function resolveChannelOffset(context: SerializeContext, block: ChannelBlock<'instanced'>) {
    return context.resolve(
        block, 
        {
            type: "##CN",
            length: 224,
        },
        serializeChannelBlock,
        block => {
            resolveChannelOffset(context, block.channelNext);
            resolveTextBlockOffset(context, block.comment);
            if (block.longName) resolveTextBlockOffset(context, block.longName);
            if (block.displayName) resolveTextBlockOffset(context, block.displayName);
        });
}

export async function readChannelBlock(link: NonNullLink<ChannelBlock>, reader: BufferedFileReader): Promise<ChannelBlock<'linked'>>;
export async function readChannelBlock(link: Link<ChannelBlock>, reader: BufferedFileReader): Promise<ChannelBlock<'linked'> | null>;
export async function readChannelBlock(link: Link<ChannelBlock>, reader: BufferedFileReader): Promise<ChannelBlock<'linked'> | null> {
    const block = await readBlock(link, reader, "CN");
    return block === null ? null : deserializeChannelBlock(block);
}

export async function* iterateChannelBlocks(startLink: Link<ChannelBlock>, reader: BufferedFileReader): AsyncIterableIterator<ChannelBlock<'linked'>> {
    let currentLink = startLink;
    
    while (isNonNullLink(currentLink)) {
        const channel = await readChannelBlock(currentLink, reader);
        yield channel;
        currentLink = channel.channelNext;
    }
}
