import { Link, newLink, getLink, readBlock, MaybeLinked, GenericBlock } from './common';
import { DataTableBlock, deserializeDataTableBlock, readDataTableBlock } from './dataTableBlock';
import { DataListBlock, iterateDataListBlocks } from './dataListBlock';
import { ChannelGroupBlock, resolveChannelGroupOffset } from './channelGroupBlock';
import { SerializeContext } from './serializer';

const DATA_GROUP_BLOCK_SIZE = 64;

export interface DataGroupBlock<TMode extends 'linked' | 'instanced' = 'linked'> {
    dataGroupNext: MaybeLinked<DataGroupBlock<TMode>, TMode>;
    channelGroupFirst: MaybeLinked<ChannelGroupBlock<TMode>, TMode>;
    data: MaybeLinked<DataTableBlock | DataListBlock, TMode>;
    comment: MaybeLinked<unknown, TMode>;
    recordIdSize: number;
}

export function deserializeDataGroupBlock(block: GenericBlock): DataGroupBlock<'linked'> {
    const view = block.buffer;
    return {
        dataGroupNext: block.links[0] as Link<DataGroupBlock>,
        channelGroupFirst: block.links[1] as Link<ChannelGroupBlock>,
        data: block.links[2] as Link<DataTableBlock | DataListBlock>,
        comment: block.links[3] as Link<unknown>,
        recordIdSize: view.getUint8(0)
    };
}

export function serializeDataGroupBlock(view: DataView, context: SerializeContext, dataGroup: DataGroupBlock<'instanced'>): void {
    view.setBigUint64(0, context.get(dataGroup.dataGroupNext), true);
    view.setBigUint64(8, context.get(dataGroup.channelGroupFirst), true);
    view.setBigUint64(16, context.get(dataGroup.data), true);
    view.setBigUint64(24, context.get(dataGroup.comment), true);
    view.setUint8(32, dataGroup.recordIdSize);
}

export function resolveDataGroupOffset(context: SerializeContext, block: DataGroupBlock<'instanced'>) {
    return context.resolve(
        block, 
        {
            type: "##DG",
            length: BigInt(DATA_GROUP_BLOCK_SIZE),
            linkCount: 4n,
        },
        serializeDataGroupBlock,
        block => {
            resolveChannelGroupOffset(context, block.channelGroupFirst);
        });
}

export async function getDataBlocks(dataGroup: DataGroupBlock, file: File): Promise<AsyncIterableIterator<DataTableBlock>> {
    return (async function* () {
        const block = await readBlock(dataGroup.data, file, undefined); // Read just the header
        if (block.type === "##DT") {
            yield deserializeDataTableBlock(block);
        } else if (block.type === "##DL") {
            for await (const list of iterateDataListBlocks(dataGroup.data, file)) {
                for (const item of list.data) {
                    yield await readDataTableBlock(item, file);
                }
            }
        } else {
            throw new Error(`Invalid block type: "${block.type}"`);
        }
    })();
}

export async function readDataGroupBlock(link: Link<DataGroupBlock>, file: File): Promise<DataGroupBlock<'linked'>> {
    return deserializeDataGroupBlock(await readBlock(link, file, "##DG"));
}

export async function* iterateDataGroupBlocks(startLink: Link<DataGroupBlock>, file: File): AsyncIterableIterator<DataGroupBlock<'linked'>> {
    let currentLink = startLink;
    
    while (getLink(currentLink) !== 0n) {
        const dataGroup = await readDataGroupBlock(currentLink, file);
        yield dataGroup;
        currentLink = dataGroup.dataGroupNext;
    }
}
