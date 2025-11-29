import { BufferedFileReader } from '../bufferedFileReader';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export interface Link<T> {
    __brand: "<T>",
}

export type MaybeLinked<T, TMode extends 'linked' | 'instanced'> = TMode extends 'linked' ? Link<T> : T;

export function newLink<T>(value: bigint): Link<T> {
    return value as unknown as Link<T>;
}

export function getLink<T>(link: Link<T>): bigint {
    return link as unknown as bigint;
}

export interface GenericBlockHeader {
    type: string;
    length: bigint;
    linkCount: bigint;
}

export interface GenericBlock extends GenericBlockHeader {
    buffer: DataView<ArrayBuffer>;
    links: Link<unknown>[];
}

export async function readBlockHeader<T>(link: Link<T>, reader: BufferedFileReader, expectedType?: string | string[]): Promise<GenericBlockHeader> {
    const offset = Number(getLink(link));
    
    const buffer = await reader.readBytes(offset, 24);
    const type = String.fromCharCode(...new Uint8Array(buffer, 0, 4));
    if (typeof expectedType !== "undefined" && ((!Array.isArray(expectedType) && type !== expectedType) || (Array.isArray(expectedType) && !expectedType.includes(type)))) {
        throw new Error(`Invalid block tag: "${type}"`);
    }
    const view = new DataView(buffer);
    const len = view.getBigUint64(8, true);
    return {
        type,
        length: len,
        linkCount: view.getBigUint64(16, true),
    };
}

export async function readBlock<T>(link: Link<T>, reader: BufferedFileReader, expectedType?: string | string[]): Promise<GenericBlock> {
    const fileOffset = Number(getLink(link));
    const header = await readBlockHeader(link, reader, expectedType);
    
    const payload = await reader.readBytes(fileOffset + 24, Number(header.length) - 24);

    const links: Link<unknown>[] = [];
    let offset = 0;
    const view = new DataView(payload);
    for (offset = 0; offset < Number(header.linkCount) * 8; offset += 8) {
        links.push(newLink(view.getBigUint64(offset, true)));
    }
    
    return {
        ...header,
        buffer: new DataView(payload, offset),
        links,
    };
}
