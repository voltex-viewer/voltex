import { Link, readBlock, GenericBlock, NonNullLink } from './common';
import { SerializeContext } from './serializer';
import { BufferedFileReader } from '../bufferedFileReader';

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

export function serializeTextBlock(view: DataView<ArrayBuffer>, _context: SerializeContext, block: TextBlock): void {
    const arr = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
    
    const encoded = new TextEncoder().encode(block.data);
    arr.set(encoded, 0);
    arr.set([0], Math.min(encoded.length, arr.byteLength - 1));
}

export function serializeMetadataBlock(view: DataView<ArrayBuffer>, context: SerializeContext, block: MetadataBlock): void {
    return serializeTextBlock(view, context, block);
}

export async function readTextBlock(link: NonNullLink<TextBlock>, reader: BufferedFileReader): Promise<TextBlock>;
export async function readTextBlock(link: Link<TextBlock>, reader: BufferedFileReader): Promise<TextBlock | null>;
export async function readTextBlock(link: Link<TextBlock>, reader: BufferedFileReader): Promise<TextBlock | null> {
    const block = await readBlock(link, reader, "##TX");
    return block === null ? null : deserializeTextBlock(block);
}

export async function readMetadataBlock(link: NonNullLink<MetadataBlock>, reader: BufferedFileReader): Promise<MetadataBlock>;
export async function readMetadataBlock(link: Link<MetadataBlock>, reader: BufferedFileReader): Promise<MetadataBlock | null>;
export async function readMetadataBlock(link: Link<MetadataBlock>, reader: BufferedFileReader): Promise<MetadataBlock | null> {
    const block = await readBlock(link, reader, "##MD");
    return block === null ? null : deserializeMetadataBlock(block);
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
            length: block === null ? 0n : BigInt(getEncodedLength(block.data)),
            linkCount: 0n,
        },
        serializeMetadataBlock);
}
