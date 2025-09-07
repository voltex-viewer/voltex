import { Link, readBlock, GenericBlock } from './common';

export interface DataTableBlock {
    data: DataView<ArrayBuffer>;
}

export function deserializeDataTableBlock(block: GenericBlock): DataTableBlock {
    return {
        data: block.buffer
    };
}

export function serializeDataTableBlock(buffer: ArrayBuffer, dataTable: DataTableBlock): ArrayBuffer {
    const view = new DataView(buffer);
    for (let i = 0; i < dataTable.data.byteLength; i++) {
        view.setUint8(i, dataTable.data.getUint8(i));
    }
    return buffer;
}

export async function readDataTableBlock(link: Link<DataTableBlock>, file: File): Promise<DataTableBlock> {
    return deserializeDataTableBlock(await readBlock(link, file, "##DT"));
}
