export interface Link<T> {
    __brand: "<T>",
}

export type MaybeLinked<T, TMode extends 'linked' | 'instanced'> = TMode extends 'linked' ? Link<T> : T;

export function newLink<T>(value: bigint): Link<T> {
    return value as any;
}

export function getLink(link: Link<any>): bigint {
    return link as any as bigint;
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

export async function readBlockHeader(link: Link<any>, file: File, expectedType?: string): Promise<GenericBlockHeader> {
    let offset = Number(getLink(link));
    
    const buffer = await file.slice(offset, offset + 24).arrayBuffer();
    const type = String.fromCharCode(...new Uint8Array(buffer, 0, 4));
    if (typeof(expectedType) !== "undefined" && type !== expectedType) {
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

export async function readBlock(link: Link<any>, file: File, expectedType?: string): Promise<GenericBlock> {
    let fileOffset = Number(getLink(link));
    const header = await readBlockHeader(link, file, expectedType);
    
    const payload = await file.slice(fileOffset + 24, fileOffset + Number(header.length)).arrayBuffer();

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
