import { Link, getLink, readBlock, MaybeLinked, GenericBlock } from './common';
import { DataTableBlock } from './dataTableBlock';

export interface DataListBlock<TMode extends 'linked' | 'instanced' = 'linked'> {
    dataListNext: MaybeLinked<DataListBlock<TMode>, TMode>;
    data: MaybeLinked<DataTableBlock, TMode>[];
    flags: number;
}

export type LinkedDataListBlock = DataListBlock<'linked'>;
export type InstancedDataListBlock = DataListBlock<'instanced'>;

export function deserializeDataListBlock(block: GenericBlock): LinkedDataListBlock {
    return {
        dataListNext: block.links[0] as Link<DataListBlock>,
        data: block.links.slice(1) as Link<DataTableBlock>[],
        flags: block.buffer.getUint8(0),
    };
}

export function serializeDataListBlock(buffer: ArrayBuffer, dataList: LinkedDataListBlock): ArrayBuffer {
    const view = new DataView(buffer);

    view.setBigUint64(0, getLink(dataList.dataListNext), true);
    for (let i = 0; i < dataList.data.length; i++) {
        view.setBigUint64((i + 1) * 8, getLink(dataList.data[i]), true);
    }
    view.setUint8((dataList.data.length + 1) * 8, dataList.flags);

    return buffer;
}

export async function readDataListBlock(link: Link<DataListBlock>, file: File): Promise<LinkedDataListBlock> {
    const block = await readBlock(link, file, "##DL");
    return deserializeDataListBlock(block);
}

export async function* iterateDataListBlocks(startLink: Link<DataListBlock>, file: File): AsyncIterableIterator<LinkedDataListBlock> {
    let currentLink = startLink;
    
    while (getLink(currentLink) !== 0n) {
        const value = await readDataListBlock(currentLink, file);
        yield value;
        currentLink = value.dataListNext;
    }
}
