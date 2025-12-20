import { Link, NonNullLink, readBlock, MaybeLinked, GenericBlock, isNonNullLink } from './common';
import { DataTableBlock, resolveDataTableOffset } from './dataTableBlock';
import { SerializeContext } from './serializer';
import { BufferedFileReader } from '../bufferedFileReader';

export interface DataListBlock<TMode extends 'linked' | 'instanced' = 'linked'> {
    dataListNext: MaybeLinked<DataListBlock<TMode> | null, TMode>;
    data: MaybeLinked<DataTableBlock, TMode>[];
    flags: number;
}

export type LinkedDataListBlock = DataListBlock<'linked'>;
export type InstancedDataListBlock = DataListBlock<'instanced'>;

export function deserializeDataListBlock(block: GenericBlock): LinkedDataListBlock {
    const dataCount = block.buffer.getUint32(4, true);
    return {
        dataListNext: block.links[0] as Link<DataListBlock>,
        data: block.links.slice(1, 1 + dataCount) as Link<DataTableBlock>[],
        flags: block.buffer.getUint8(0),
    };
}

export function serializeDataListBlock(view: DataView, context: SerializeContext, block: DataListBlock<'instanced'>): void {
    view.setBigUint64(0, context.get(block.dataListNext), true);
    for (let i = 0; i < block.data.length; i++) {
        view.setBigUint64((i + 1) * 8, context.get(block.data[i]), true);
    }
    let viewOffset = (block.data.length + 1) * 8;
    view.setUint8(viewOffset, block.flags);
    viewOffset += 1;
    view.setUint8(viewOffset, 0);
    viewOffset += 1;
    view.setUint8(viewOffset, 0);
    viewOffset += 1;
    view.setUint8(viewOffset, 0);
    viewOffset += 1;
    view.setUint32(viewOffset, block.data.length, true);
    viewOffset += 4;
    let offset = 0n;
    for (let i = 0; i < block.data.length; i++) {
        view.setBigUint64(viewOffset, offset, true);
        viewOffset += 8;
        offset += BigInt(block.data[i].data.byteLength);
    }
}

export function resolveDataListOffset(context: SerializeContext, block: DataListBlock<'instanced'>) {
    return context.resolve(
        block, 
        {
            type: "##DL",
            length: 16n + BigInt(block.data.length) * 16n,
            linkCount: 1n + BigInt(block.data.length),
        },
        serializeDataListBlock,
        block => {
            for (const dataTable of block.data) {
                resolveDataTableOffset(context, dataTable);
            }
        });
}

export async function readDataListBlock(link: NonNullLink<DataListBlock>, reader: BufferedFileReader): Promise<LinkedDataListBlock>;
export async function readDataListBlock(link: Link<DataListBlock>, reader: BufferedFileReader): Promise<LinkedDataListBlock | null>;
export async function readDataListBlock(link: Link<DataListBlock>, reader: BufferedFileReader): Promise<LinkedDataListBlock | null> {
    const block = await readBlock(link as Link<DataListBlock>, reader, "##DL");
    return block === null ? null : deserializeDataListBlock(block);
}

export async function* iterateDataListBlocks(startLink: Link<DataListBlock>, reader: BufferedFileReader): AsyncIterableIterator<LinkedDataListBlock> {
    let currentLink = startLink;
    
    while (isNonNullLink(currentLink)) {
        const value = await readDataListBlock(currentLink, reader);
        yield value;
        currentLink = value.dataListNext;
    }
}
