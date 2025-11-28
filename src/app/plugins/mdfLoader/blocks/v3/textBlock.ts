import { Link, readBlock, GenericBlock } from './common';
import { SerializeContext } from './serializer';
import { BufferedFileReader } from '../../bufferedFileReader';
import { MdfView } from './mdfView';

export interface TextBlock {
    data: string;
}

export function deserializeTextBlock(block: GenericBlock): TextBlock {
    const bytes = new Uint8Array(block.buffer.buffer, block.buffer.byteOffset, block.buffer.byteLength);
    const end = bytes.indexOf(0);
    return {
        data: new TextDecoder('utf-8').decode(bytes.subarray(0, end === -1 ? bytes.length : end))
    };
}

export function serializeTextBlock(view: MdfView, _context: SerializeContext, block: TextBlock): void {
    view.writeString(block.data);
}

export async function readTextBlock(link: Link<TextBlock>, reader: BufferedFileReader): Promise<TextBlock> {
    return deserializeTextBlock(await readBlock(link, reader, ["TX", "MD"]));
}

function getEncodedLength(data: string): number {
    return new TextEncoder().encode(data).byteLength + 1;
}

export function resolveTextBlockOffset(context: SerializeContext, block: TextBlock) {
    return context.resolve(
        block, 
        {
            type: "TX",
            length: block === null ? 0 : getEncodedLength(block.data),
        },
        serializeTextBlock);
}
