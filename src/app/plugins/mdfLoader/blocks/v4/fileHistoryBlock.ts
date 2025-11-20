import { Link, getLink, readBlock, MaybeLinked, GenericBlock } from './common';
import { SerializeContext } from './serializer';
import { MetadataBlock, resolveMetadataOffset } from './textBlock';
import { BufferedFileReader } from '../../BufferedFileReader';

export interface FileHistoryBlock<TMode extends 'linked' | 'instanced' = 'linked'> {
    fileHistoryNext: MaybeLinked<FileHistoryBlock<TMode> | null, TMode>;
    comment: MaybeLinked<MetadataBlock | null, TMode>;
    time: bigint;
    timeZone: number;
    dstOffset: number;
    timeFlags: number;

}

export function deserializeFileHistoryBlock(block: GenericBlock): FileHistoryBlock<'linked'> {
    const view = block.buffer;
    return {
        fileHistoryNext: block.links[0] as Link<FileHistoryBlock>,
        comment: block.links[1] as Link<MetadataBlock>,
        time: view.getBigUint64(0, true),
        timeZone: view.getUint16(8),
        dstOffset: view.getUint16(10),
        timeFlags: view.getUint8(12),
        // 3 bytes reserved
    };
}

export function serializeFileHistoryBlock(view: DataView<ArrayBuffer>, context: SerializeContext, fileHistory: FileHistoryBlock<'instanced'>): void {
    view.setBigUint64(0, context.get(fileHistory.fileHistoryNext), true);
    view.setBigUint64(8, context.get(fileHistory.comment), true);
    view.setBigUint64(16, fileHistory.time, true);
    view.setUint16(24, fileHistory.timeZone, true);
    view.setUint16(26, fileHistory.dstOffset, true);
    view.setUint8(28, fileHistory.timeFlags);
    view.setUint8(29, 0);
    view.setUint8(30, 0);
    view.setUint8(31, 0);
}

export function resolveFileHistoryOffset(context: SerializeContext, block: FileHistoryBlock<'instanced'> | null) {
    return context.resolve(
        block, 
        {
            type: "##FH",
            length: BigInt(32n),
            linkCount: 2n,
        },
        serializeFileHistoryBlock,
        block => {
            resolveFileHistoryOffset(context, block.fileHistoryNext);
            resolveMetadataOffset(context, block.comment);
        });
}

export async function readFileHistoryBlock(link: Link<FileHistoryBlock>, reader: BufferedFileReader): Promise<FileHistoryBlock<'linked'>> {
    return deserializeFileHistoryBlock(await readBlock(link, reader, "##FH"));
}

export async function* iterateFileHistoryBlocks(startLink: Link<FileHistoryBlock>, reader: BufferedFileReader): AsyncIterableIterator<FileHistoryBlock<'linked'>> {
    let currentLink = startLink;
    
    while (getLink(currentLink) !== 0n) {
        const fileHistory = await readFileHistoryBlock(currentLink, reader);
        yield fileHistory;
        currentLink = fileHistory.fileHistoryNext;
    }
}
