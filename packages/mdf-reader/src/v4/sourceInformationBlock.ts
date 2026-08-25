import { Link, NonNullLink, readBlock, MaybeLinked, GenericBlock } from './common';
import { resolveTextBlockOffset, TextBlock } from './textBlock';
import { SerializeContext, type SerializeWriteFunction } from './serializer';
import { BufferedFileReader } from '../bufferedFileReader';

export enum SourceType {
    Other = 0,
    Ecu = 1,
    Bus = 2,
    Io = 3,
    Tool = 4,
    User = 5,
    Video = 6,
    Radar = 7,
    Lidar = 8,
    Protocol = 9,
}

export enum BusType {
    None = 0,
    Other = 1,
    Can = 2,
    Lin = 3,
    Most = 4,
    FlexRay = 5,
    KLine = 6,
    Ethernet = 7,
    Usb = 8,
}

export interface SourceInformationBlock<TMode extends 'linked' | 'instanced' = 'linked'> {
    txName: MaybeLinked<TextBlock | null, TMode>;
    txPath: MaybeLinked<TextBlock | null, TMode>;
    comment: MaybeLinked<TextBlock | null, TMode>;
    sourceType: number;
    busType: number;
    flags: number;
}

export function deserializeSourceInformationBlock(block: GenericBlock): SourceInformationBlock<'linked'> {
    const view = block.buffer;

    return {
        txName: block.links[0] as Link<TextBlock>,
        txPath: block.links[1] as Link<TextBlock>,
        comment: block.links[2] as Link<TextBlock>,
        sourceType: view.getUint8(0),
        busType: view.getUint8(1),
        flags: view.getUint8(2),
    };
}

const sourceInformationBlockLength = 32;

export async function serializeSourceInformationBlock(write: SerializeWriteFunction, context: SerializeContext, block: SourceInformationBlock<'instanced'>): Promise<void> {
    await write({
        size: sourceInformationBlockLength,
        fill: (view: DataView<ArrayBuffer>) => {
            view.setBigUint64(0, context.get(block.txName), true);
            view.setBigUint64(8, context.get(block.txPath), true);
            view.setBigUint64(16, context.get(block.comment), true);

            view.setUint8(24, block.sourceType);
            view.setUint8(25, block.busType);
            view.setUint8(26, block.flags);
        },
    });
}

export function resolveSourceInformationOffset(context: SerializeContext, block: SourceInformationBlock<'instanced'> | null) {
    return context.resolve(
        block,
        {
            type: "##SI",
            length: BigInt(sourceInformationBlockLength),
            linkCount: 3n,
        },
        serializeSourceInformationBlock,
        block => {
            resolveTextBlockOffset(context, block.txName);
            resolveTextBlockOffset(context, block.txPath);
            resolveTextBlockOffset(context, block.comment);
        });
}

export async function readSourceInformationBlock(link: NonNullLink<SourceInformationBlock>, reader: BufferedFileReader): Promise<SourceInformationBlock<'linked'>>;
export async function readSourceInformationBlock(link: Link<SourceInformationBlock>, reader: BufferedFileReader): Promise<SourceInformationBlock<'linked'> | null>;
export async function readSourceInformationBlock(link: Link<SourceInformationBlock>, reader: BufferedFileReader): Promise<SourceInformationBlock<'linked'> | null> {
    const block = await readBlock(link, reader, "##SI");
    return block === null ? null : deserializeSourceInformationBlock(block);
}
