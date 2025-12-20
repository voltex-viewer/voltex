import { Link, readBlock, MaybeLinked, GenericBlock, NonNullLink } from './common';
import { SerializeContext } from './serializer';
import { BufferedFileReader } from '../bufferedFileReader';
import { DataListBlock, resolveDataListOffset } from './dataListBlock';

export interface HeaderListBlock<TMode extends 'linked' | 'instanced' = 'linked'> {
    dataList: MaybeLinked<DataListBlock<TMode>, TMode>;
    flags: number;
    algorithm: number;
}

export function deserializeHeaderListBlock(block: GenericBlock): HeaderListBlock {
    return {
        dataList: block.links[0] as Link<HeaderListBlock>,
        flags: block.buffer.getUint8(0),
        algorithm: block.buffer.getUint8(1),
    };
}

export function serializeHeaderListBlock(view: DataView, context: SerializeContext, block: HeaderListBlock<'instanced'>): void {
    view.setBigUint64(0, context.get(block.dataList), true);
    view.setUint8(8, block.flags);
    view.setUint8(9, block.algorithm);
    view.setUint8(10, 0);
    view.setUint8(11, 0);
    view.setUint8(12, 0);
    view.setUint8(13, 0);
    view.setUint8(14, 0);
    view.setUint8(15, 0);
}

export function resolveHeaderListOffset(context: SerializeContext, block: HeaderListBlock<'instanced'>) {
    return context.resolve(
        block, 
        {
            type: "##HL",
            length: 16n,
            linkCount: 1n,
        },
        serializeHeaderListBlock,
        block => {
            resolveDataListOffset(context, block.dataList);
        });
}

export async function readHeaderListBlock(link: NonNullLink<HeaderListBlock>, reader: BufferedFileReader): Promise<HeaderListBlock>;
export async function readHeaderListBlock(link: Link<HeaderListBlock>, reader: BufferedFileReader): Promise<HeaderListBlock | null>;
export async function readHeaderListBlock(link: Link<HeaderListBlock>, reader: BufferedFileReader): Promise<HeaderListBlock | null> {
    const block = await readBlock(link, reader, "##HL");
    return block === null ? null : deserializeHeaderListBlock(block);
}
