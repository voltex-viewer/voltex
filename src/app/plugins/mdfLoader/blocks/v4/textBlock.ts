import { Link, readBlock, GenericBlock } from './common';
import { SerializeContext } from './serializer';
import { BufferedFileReader } from '../../BufferedFileReader';

export interface TextBlock {
    data: string;
}

export interface MetadataBlock {
    data: string;
}

export function deserializeTextBlock(block: GenericBlock): TextBlock {
    const bytes = new Uint8Array(block.buffer.buffer, block.buffer.byteOffset, block.buffer.byteLength);
    const end = bytes.indexOf(0);
    return {
        data: new TextDecoder('utf-8').decode(bytes.subarray(0, end === -1 ? bytes.length : end))
    };
}

export function deserializeMetadataBlock(block: GenericBlock): MetadataBlock {
    return deserializeTextBlock(block);
}

export function serializeTextBlock(view: DataView<ArrayBuffer>, context: SerializeContext, block: TextBlock): void {
    const arr = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
    
    const encoded = new TextEncoder().encode(block.data);
    arr.set(encoded, 0);
    arr.set([0], Math.min(encoded.length, arr.byteLength - 1)); // null terminator
}

export function serializeMetadataBlock(view: DataView<ArrayBuffer>, context: SerializeContext, block: MetadataBlock): void {
    return serializeTextBlock(view, context, block);
}

export async function readTextBlock(link: Link<TextBlock>, reader: BufferedFileReader): Promise<TextBlock> {
    return deserializeTextBlock(await readBlock(link, reader, "##TX"));
}

export async function readMetadataBlock(link: Link<MetadataBlock>, reader: BufferedFileReader): Promise<MetadataBlock> {
    return deserializeMetadataBlock(await readBlock(link, reader, "##MD"));
}

function getEncodedLength(data: string): number {
    return new TextEncoder().encode(data).byteLength + 1;
}

export function resolveTextBlockOffset(context: SerializeContext, block: TextBlock | null) {
    return context.resolve(
        block, 
        {
            type: "##TX",
            length: block === null ? 0n : BigInt(getEncodedLength(block.data)),
            linkCount: 0n,
        },
        serializeTextBlock);
}

export function resolveMetadataOffset(context: SerializeContext, block: MetadataBlock | null) {
    return context.resolve(
        block, 
        {
            type: "##MD",
            length: block === null ? 0n : BigInt(getEncodedLength(block.data)), // +1 for null terminator, +24 for header
            linkCount: 0n,
        },
        serializeMetadataBlock);
}
