import { Link, getLink, readBlock, MaybeLinked, GenericBlock } from './common';
import { SerializeContext } from './serializer';
import { BufferedFileReader } from '../../BufferedFileReader';
import { MdfView } from './mdfView';
import { TextBlock, ChannelBlock, resolveTextBlockOffset, resolveChannelOffset } from '.';

export interface ChannelGroupBlock<TMode extends 'linked' | 'instanced' = 'linked'> {
    channelGroupNext: MaybeLinked<ChannelGroupBlock<TMode>, TMode>;
    channelFirst: MaybeLinked<ChannelBlock<TMode>, TMode>;
    comment: MaybeLinked<TextBlock, TMode>;
    recordId: number;
    numberOfChannels: number;
    dataBytes: number;
    numberOfRecords: number;
    sampleReductionFirst: MaybeLinked<TextBlock, TMode>;
}

export function deserializeChannelGroupBlock(block: GenericBlock): ChannelGroupBlock<'linked'> {
    const view = block.buffer;

    return {
        channelGroupNext: view.readLink(),
        channelFirst: view.readLink(),
        comment: view.readLink(),
        recordId: view.readUint16(),
        numberOfChannels: view.readUint16(),
        dataBytes: view.readUint16(),
        numberOfRecords: view.readUint32(),
        sampleReductionFirst: view.readLink(),
    };
}

export function serializeChannelGroupBlock(view: MdfView, context: SerializeContext, block: ChannelGroupBlock<'instanced'>) {
    view.writeLink(context.get(block.channelGroupNext));
    view.writeLink(context.get(block.channelFirst));
    view.writeLink(context.get(block.comment));
    view.writeUint16(block.recordId);
    view.writeUint16(block.numberOfChannels);
    view.writeUint16(block.dataBytes);
    view.writeUint32(block.numberOfRecords);
    view.writeLink(context.get(block.sampleReductionFirst));
}

export function resolveChannelGroupOffset(context: SerializeContext, block: ChannelGroupBlock<'instanced'>) {
    return context.resolve(
        block, 
        {
            type: "CG",
            length: 26,
        },
        serializeChannelGroupBlock,
        block => {
            resolveChannelGroupOffset(context, block.channelGroupNext);
            resolveChannelOffset(context, block.channelFirst);
            resolveTextBlockOffset(context, block.comment);
        });
}

export async function readChannelGroupBlock(link: Link<ChannelGroupBlock>, reader: BufferedFileReader): Promise<ChannelGroupBlock<'linked'>> {
    return deserializeChannelGroupBlock(await readBlock(link, reader, "CG"));
}

export async function* iterateChannelGroupBlocks(startLink: Link<ChannelGroupBlock>, reader: BufferedFileReader): AsyncIterableIterator<ChannelGroupBlock<'linked'>> {
    let currentLink = startLink;
    
    while (getLink(currentLink) !== 0) {
        const channelGroup = await readChannelGroupBlock(currentLink, reader);
        yield channelGroup;
        currentLink = channelGroup.channelGroupNext;
    }
}
