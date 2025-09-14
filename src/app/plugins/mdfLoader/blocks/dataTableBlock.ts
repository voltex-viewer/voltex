import { Link, readBlock, GenericBlock } from './common';
import { SerializeContext } from './serializer';

export interface DataTableBlock {
    data: DataView<ArrayBuffer>;
}

export function deserializeDataTableBlock(block: GenericBlock): DataTableBlock {
    return {
        data: block.buffer
    };
}

export function serializeDataTableBlock(view: DataView, context: SerializeContext, block: DataTableBlock): void {
    for (let i = 0; i < block.data.byteLength; i++) {
        view.setUint8(i, block.data.getUint8(i));
    }
}

export function resolveDataTableOffset(context: SerializeContext, block: DataTableBlock) {
    return context.resolve(
        block, 
        {
            type: "##DT",
            length: BigInt(block.data.byteLength),
            linkCount: 0n,
        },
        serializeDataTableBlock);
}

export async function readDataTableBlock(link: Link<DataTableBlock>, file: File): Promise<DataTableBlock> {
    return deserializeDataTableBlock(await readBlock(link, file, "##DT"));
}
