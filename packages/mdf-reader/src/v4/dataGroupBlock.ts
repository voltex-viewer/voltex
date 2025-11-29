import { Link, getLink, readBlock, MaybeLinked, GenericBlock } from './common';
import { DataTableBlock, deserializeDataTableBlock, readDataTableBlock, resolveDataTableOffset } from './dataTableBlock';
import { DataListBlock, iterateDataListBlocks, resolveDataListOffset } from './dataListBlock';
import { ChannelGroupBlock, resolveChannelGroupOffset } from './channelGroupBlock';
import { SerializeContext } from './serializer';
import { BufferedFileReader } from '../bufferedFileReader';
import { deserializeHeaderListBlock, HeaderListBlock, resolveHeaderListOffset } from './headerListBlock';

export interface DataGroupBlock<TMode extends 'linked' | 'instanced' = 'linked'> {
    dataGroupNext: MaybeLinked<DataGroupBlock<TMode> | null, TMode>;
    channelGroupFirst: MaybeLinked<ChannelGroupBlock<TMode> | null, TMode>;
    data: MaybeLinked<DataTableBlock | DataListBlock<TMode> | HeaderListBlock<TMode> | null, TMode>;
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

export function resolveDataGroupOffset(context: SerializeContext, block: DataGroupBlock<'instanced'> | null) {
    return context.resolve(
        block, 
        {
            type: "##DG",
            length: BigInt(40n),
            linkCount: 4n,
        },
        serializeDataGroupBlock,
        block => {
            resolveChannelGroupOffset(context, block.channelGroupFirst);
            resolveDataGroupOffset(context, block.dataGroupNext);
            if (block.data !== null) {
                if ('dataListNext' in block.data) {
                    resolveDataListOffset(context, block.data);
                } else if ('dataList' in block.data) {
                    resolveHeaderListOffset(context, block.data);
                } else {
                    resolveDataTableOffset(context, block.data);
                }
            }
        });
}

export async function getDataBlocks(dataGroup: DataGroupBlock, reader: BufferedFileReader): Promise<AsyncIterableIterator<DataView<ArrayBuffer>>> {
    return (async function* () {
        let link = dataGroup.data;
        let block = await readBlock(link, reader, ["##DT", "##DZ", "##DL", "##HL"]);
        if (block.type === "##HL") {
            link = deserializeHeaderListBlock(block).dataList;
            block = await readBlock(link, reader, ["##DT", "##DZ", "##DL"]);
        }
        if (block.type === "##DT" || block.type === "##DZ") {
            yield (await deserializeDataTableBlock(block)).data;
        } else if (block.type === "##DL") {
            for await (const list of iterateDataListBlocks(link, reader)) {
                for (const item of list.data) {
                    yield (await readDataTableBlock(item, reader)).data;
                }
            }
        } else {
            throw new Error(`Invalid block type: "${block.type}"`);
        }
    })();
}

export async function readDataGroupBlock(link: Link<DataGroupBlock>, reader: BufferedFileReader): Promise<DataGroupBlock<'linked'>> {
    return deserializeDataGroupBlock(await readBlock(link, reader, "##DG"));
}

export async function* iterateDataGroupBlocks(startLink: Link<DataGroupBlock>, reader: BufferedFileReader): AsyncIterableIterator<DataGroupBlock<'linked'>> {
    let currentLink = startLink;
    
    while (getLink(currentLink) !== 0n) {
        const dataGroup = await readDataGroupBlock(currentLink, reader);
        yield dataGroup;
        currentLink = dataGroup.dataGroupNext;
    }
}
