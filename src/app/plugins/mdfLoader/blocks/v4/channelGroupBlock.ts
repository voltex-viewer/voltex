import { Link, getLink, readBlock, MaybeLinked, GenericBlock } from './common';
import { resolveTextBlockOffset, TextBlock } from './textBlock';
import { ChannelBlock, resolveChannelOffset } from './channelBlock';
import { SerializeContext } from './serializer';
import { BufferedFileReader } from '../../BufferedFileReader';

export interface ChannelGroupBlock<TMode extends 'linked' | 'instanced' = 'linked'> {
    channelGroupNext: MaybeLinked<ChannelGroupBlock<TMode> | null, TMode>;
    channelFirst: MaybeLinked<ChannelBlock<TMode> | null, TMode>;
    acquisitionName: MaybeLinked<TextBlock | null, TMode>;
    acquisitionSource: MaybeLinked<unknown, TMode>;
    sampleReductionFirst: MaybeLinked<unknown, TMode>;
    comment: MaybeLinked<unknown, TMode>;
    recordId: bigint;
    cycleCount: bigint;
    flags: number;
    pathSeparator: number;
    dataBytes: number;
    invalidationBytes: number;
}

export function deserializeChannelGroupBlock(block: GenericBlock): ChannelGroupBlock<'linked'> {
    const view = block.buffer;

    return {
        channelGroupNext: block.links[0] as Link<ChannelGroupBlock>,
        channelFirst: block.links[1] as Link<ChannelBlock>,
        acquisitionName: block.links[2] as Link<TextBlock>,
        acquisitionSource: block.links[3] as Link<unknown>,
        sampleReductionFirst: block.links[4] as Link<unknown>,
        comment: block.links[5] as Link<unknown>,
        recordId: view.getBigUint64(0, true),
        cycleCount: view.getBigUint64(8, true),
        flags: view.getUint16(16, true),
        pathSeparator: view.getUint16(18, true),
        dataBytes: view.getUint32(20, true),
        invalidationBytes: view.getUint32(24, true)
    };
}

export function serializeChannelGroupBlock(view: DataView, context: SerializeContext, block: ChannelGroupBlock<'instanced'>) {
    view.setBigUint64(0, context.get(block.channelGroupNext), true);
    view.setBigUint64(8, context.get(block.channelFirst), true);
    view.setBigUint64(16, context.get(block.acquisitionName), true);
    view.setBigUint64(24, context.get(block.acquisitionSource), true);
    view.setBigUint64(32, context.get(block.sampleReductionFirst), true);
    view.setBigUint64(40, context.get(block.comment), true);
    view.setBigUint64(48, block.recordId, true);
    view.setBigUint64(56, block.cycleCount, true);
    view.setUint16(64, block.flags, true);
    view.setUint16(66, block.pathSeparator, true);
    view.setUint32(72, block.dataBytes, true);
    view.setUint32(76, block.invalidationBytes, true);
}

export function resolveChannelGroupOffset(context: SerializeContext, block: ChannelGroupBlock<'instanced'> | null) {
    return context.resolve(
        block, 
        {
            type: "##CG",
            length: 80n,
            linkCount: 6n,
        },
        serializeChannelGroupBlock,
        block => {
            resolveChannelGroupOffset(context, block.channelGroupNext);
            resolveChannelOffset(context, block.channelFirst);
            resolveTextBlockOffset(context, block.acquisitionName);
        });
}

export async function readChannelGroupBlock(link: Link<ChannelGroupBlock>, reader: BufferedFileReader): Promise<ChannelGroupBlock<'linked'>> {
    return deserializeChannelGroupBlock(await readBlock(link, reader, "##CG"));
}

export async function* iterateChannelGroupBlocks(startLink: Link<ChannelGroupBlock>, reader: BufferedFileReader): AsyncIterableIterator<ChannelGroupBlock<'linked'>> {
    let currentLink = startLink;
    
    while (getLink(currentLink) !== 0n) {
        const channelGroup = await readChannelGroupBlock(currentLink, reader);
        yield channelGroup;
        currentLink = channelGroup.channelGroupNext;
    }
}
