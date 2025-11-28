import { Link, readBlock, GenericBlock } from './common';
import { SerializeContext } from './serializer';
import { BufferedFileReader } from '../../bufferedFileReader';

export interface DataTableBlock {
    data: DataView<ArrayBuffer>;
}

export async function deserializeDataTableBlock(block: GenericBlock): Promise<DataTableBlock> {
    if (block.type == "##DT") {
        return {
            data: block.buffer
        };
    } else if (block.type == "##DZ") {
        const originalBlock = String.fromCharCode(...new Uint8Array(block.buffer.buffer, block.buffer.byteOffset, 2));
        if (originalBlock !== "DT") {
            throw new Error(`Invalid compressed data table block type: "${originalBlock}"`);
        }
        const algorithm = block.buffer.getUint8(2);
        const parameters = block.buffer.getUint32(4, true);
        const uncompressedSize = block.buffer.getBigUint64(8, true);
        const compressedSize = block.buffer.getBigUint64(16, true);
        const compressedData = new Uint8Array(block.buffer.buffer, block.buffer.byteOffset + 24, Number(compressedSize));

        if (![0, 1].includes(algorithm)) {
            throw new Error(`Unsupported compression algorithm: ${algorithm}`);
        }
        
        // Decompress using deflate
        const decompressedData = new Uint8Array(Number(uncompressedSize));
        const decompressionStream = new DecompressionStream('deflate');
        const writer = decompressionStream.writable.getWriter();
        const reader = decompressionStream.readable.getReader();
        writer.write(compressedData);
        writer.close();
        let offset = 0;
        while (true) {
            const { value, done } = await reader.read();
            if (done) {
                break;
            }
            if (value) {
                decompressedData.set(value, offset);
                offset += value.length;
            }
        }
        
        if (algorithm == 1) {
            const columns = parameters;
            const rows = Math.floor(decompressedData.length / columns);
            const completeDataSize = rows * columns;
            
            const transposedData = new Uint8Array(decompressedData.length);
            
            // Transpose the complete rows
            for (let row = 0; row < rows; row++) {
                for (let col = 0; col < columns; col++) {
                    transposedData[row * columns + col] = decompressedData[col * rows + row];
                }
            }
            
            // Copy any remaining incomplete row unchanged
            if (completeDataSize < decompressedData.length) {
                for (let i = completeDataSize; i < decompressedData.length; i++) {
                    transposedData[i] = decompressedData[i];
                }
            }
            
            return {
                data: new DataView(transposedData.buffer),
            };
        }
        else {
            return {
                data: new DataView(decompressedData.buffer),
            };
        }
    } else {
        throw new Error(`Invalid data table block type: "${block.type}"`);
    }
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

export async function readDataTableBlock(link: Link<DataTableBlock>, reader: BufferedFileReader): Promise<DataTableBlock> {
    return await deserializeDataTableBlock(await readBlock(link, reader, ["##DT", "##DZ"]));
}
