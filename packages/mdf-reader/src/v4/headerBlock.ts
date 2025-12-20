import { Link, readBlock, MaybeLinked, GenericBlock, NonNullLink } from './common';
import { DataGroupBlock, resolveDataGroupOffset } from './dataGroupBlock';
import { FileHistoryBlock, resolveFileHistoryOffset } from './fileHistoryBlock';
import { SerializeContext } from './serializer';
import { BufferedFileReader } from '../bufferedFileReader';

export interface Header<TMode extends 'linked' | 'instanced' = 'linked'> {
    firstDataGroup: MaybeLinked<DataGroupBlock<TMode> | null, TMode>;
    fileHistory: MaybeLinked<FileHistoryBlock<TMode> | null, TMode>;
    channelHierarchy: MaybeLinked<unknown, TMode>;
    attachment: MaybeLinked<unknown, TMode>;
    event: MaybeLinked<unknown, TMode>;
    comment: MaybeLinked<unknown, TMode>;
    startTime: bigint; // nanoseconds since unix epoch
    timeZone: number;
    dstOffset: number;
    timeFlags: number;
    timeQuality: number;
    flags: number;
    startAngle: bigint;
    startDistance: bigint;
}

export function deserializeHeader(block: GenericBlock): Header {
    const view = block.buffer;

    return {
        firstDataGroup: block.links[0] as Link<DataGroupBlock>,
        fileHistory: block.links[1] as Link<FileHistoryBlock>,
        channelHierarchy: block.links[2] as Link<unknown>,
        attachment: block.links[3] as Link<unknown>,
        event: block.links[4] as Link<unknown>,
        comment: block.links[5] as Link<unknown>,
        startTime: view.getBigUint64(0, true),
        timeZone: view.getUint16(8, true),
        dstOffset: view.getUint16(10, true),
        timeFlags: view.getUint8(12),
        timeQuality: view.getUint8(13),
        flags: view.getUint8(14),
        startAngle: view.getBigUint64(16, true),
        startDistance: view.getBigUint64(24, true)
    };
}

export function serializeHeader(view: DataView<ArrayBuffer>, context: SerializeContext, header: Header<'instanced'>): void {
    view.setBigUint64(0, context.get(header.firstDataGroup), true);
    view.setBigUint64(8, context.get(header.fileHistory), true);
    view.setBigUint64(16, context.get(header.channelHierarchy), true);
    view.setBigUint64(24, context.get(header.attachment), true);
    view.setBigUint64(32, context.get(header.event), true);
    view.setBigUint64(40, context.get(header.comment), true);
    view.setBigUint64(48, header.startTime, true);
    view.setUint16(56, header.timeZone, true);
    view.setUint16(58, header.dstOffset, true);
    view.setUint8(60, header.timeFlags);
    view.setUint8(61, header.timeQuality);
    view.setUint8(62, header.flags);
    view.setBigUint64(64, header.startAngle, true);
    view.setBigUint64(72, header.startDistance, true);
}

export function resolveHeaderOffset(context: SerializeContext, header: Header<'instanced'>): bigint {
    return context.resolve(
        header,
        {
            type: "##HD",
            length: 80n,
            linkCount: 6n,
        },
        serializeHeader,
        block => {
            resolveDataGroupOffset(context, block.firstDataGroup);
            resolveFileHistoryOffset(context, block.fileHistory);
        }
    );
}

export async function readHeader(link: NonNullLink<Header>, reader: BufferedFileReader): Promise<Header<'linked'>>;
export async function readHeader(link: Link<Header>, reader: BufferedFileReader): Promise<Header<'linked'> | null>;
export async function readHeader(link: Link<Header>, reader: BufferedFileReader): Promise<Header<'linked'> | null> {
    const block = await readBlock(link, reader, "##HD");
    return block === null ? null : deserializeHeader(block);
}
