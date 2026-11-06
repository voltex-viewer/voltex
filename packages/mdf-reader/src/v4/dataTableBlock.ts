import { Link, readBlock, GenericBlock, NonNullLink } from './common';
import { SerializeContext, type SerializeWriteFunction } from './serializer';
import { BufferedFileReader } from '../bufferedFileReader';
import { decodeLz4Frames } from './lz4';

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

        // 0 deflate, 1 transposed then deflate, 4 LZ4, 5 transposed then LZ4 (MDF 4.3)
        let decompressedData: Uint8Array;
        if (algorithm === 0 || algorithm === 1) {
            decompressedData = await inflate(compressedData, Number(uncompressedSize));
        } else if (algorithm === 4 || algorithm === 5) {
            decompressedData = decodeLz4Frames(compressedData, Number(uncompressedSize));
        } else {
            throw new Error(`Unsupported compression algorithm: ${algorithm}`);
        }

        if (algorithm === 1 || algorithm === 5) {
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
                data: new DataView(decompressedData.buffer as ArrayBuffer, decompressedData.byteOffset, decompressedData.byteLength),
            };
        }
    } else {
        throw new Error(`Invalid data table block type: "${block.type}"`);
    }
}

async function inflate(compressedData: Uint8Array, size: number): Promise<Uint8Array> {
    const decompressedData = new Uint8Array(size);
    const decompressionStream = new DecompressionStream('deflate');
    const writer = decompressionStream.writable.getWriter();
    const reader = decompressionStream.readable.getReader();
    writer.write(compressedData as Uint8Array<ArrayBuffer>);
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
    return decompressedData;
}

export async function serializeDataTableBlock(write: SerializeWriteFunction, _context: SerializeContext, block: DataTableBlock): Promise<void> {
    await write(new Uint8Array(block.data.buffer, block.data.byteOffset, block.data.byteLength));
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

export async function readDataTableBlock(link: NonNullLink<DataTableBlock>, reader: BufferedFileReader): Promise<DataTableBlock>;
export async function readDataTableBlock(link: Link<DataTableBlock>, reader: BufferedFileReader): Promise<DataTableBlock | null>;
export async function readDataTableBlock(link: Link<DataTableBlock>, reader: BufferedFileReader): Promise<DataTableBlock | null> {
    const block = await readBlock(link, reader, ["##DT", "##DZ"]);
    return block === null ? null : await deserializeDataTableBlock(block);
}
