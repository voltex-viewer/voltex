import { BufferedFileReader } from '../../bufferedFileReader';
import { MdfView } from './mdfView';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export interface Link<T> {
    __brand: "<T>",
}

export type MaybeLinked<T, TMode extends 'linked' | 'instanced'> = TMode extends 'linked' ? Link<T> : T;

export function newLink<T>(value: number): Link<T> {
    return value as unknown as Link<T>;
}

export function getLink<T>(link: Link<T>): number {
    return link as unknown as number;
}

export interface GenericBlockHeader {
    type: string;
    length: number;
}

export interface GenericBlock extends GenericBlockHeader {
    buffer: MdfView<ArrayBuffer>;
}

export async function readBlockHeader<T>(link: Link<T>, reader: BufferedFileReader, expectedType?: string | string[]): Promise<GenericBlockHeader> {
    const offset = Number(getLink(link));
    
    const buffer = await reader.readBytes(offset, 4);
    const type = String.fromCharCode(...new Uint8Array(buffer, 0, 2));
    if (typeof expectedType !== "undefined" && ((!Array.isArray(expectedType) && type !== expectedType) || (Array.isArray(expectedType) && !expectedType.includes(type)))) {
        throw new Error(`Invalid block tag: "${type}", expected: ${expectedType}`);
    }
    const view = new DataView(buffer);
    const len = view.getUint16(2, reader.littleEndian);
    return {
        type,
        length: len,
    };
}

export async function readBlock<T>(link: Link<T>, reader: BufferedFileReader, expectedType?: string | string[]): Promise<GenericBlock> {
    const fileOffset = Number(getLink(link));
    const header = await readBlockHeader(link, reader, expectedType);
    const payload = await reader.readBytes(fileOffset + 4, Number(header.length) - 4);
    return {
        ...header,
        buffer: new MdfView(payload, reader.littleEndian, 0),
    };
}
