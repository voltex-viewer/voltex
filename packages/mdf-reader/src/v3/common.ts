import { BufferedFileReader } from '../bufferedFileReader';
import { MdfView } from './mdfView';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export interface Link<T> {
    __brand: "<T>",
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export interface NonNullLink<T> {
    __brand: "<T>",
    __nonNull: true,
}

export type MaybeLinked<T, TMode extends 'linked' | 'instanced'> = TMode extends 'linked' ? Link<T> : T;

export function newLink<T>(value: number): Link<T> {
    return value as unknown as Link<T>;
}

export function newNonNullLink<T>(value: number): NonNullLink<T> {
    return value as unknown as NonNullLink<T>;
}

export function getLink<T>(link: Link<T> | NonNullLink<T>): number {
    return link as unknown as number;
}

export function isNonNullLink<T>(link: Link<T>): link is NonNullLink<T> {
    return getLink(link) !== 0;
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

export async function readBlock<T>(link: NonNullLink<T>, reader: BufferedFileReader, expectedType?: string | string[]): Promise<GenericBlock>;
export async function readBlock<T>(link: Link<T>, reader: BufferedFileReader, expectedType?: string | string[]): Promise<GenericBlock | null>;
export async function readBlock<T>(link: Link<T> | NonNullLink<T>, reader: BufferedFileReader, expectedType?: string | string[]): Promise<GenericBlock | null> {
    const fileOffset = Number(getLink(link));
    if (fileOffset === 0) {
        return null;
    }
    const header = await readBlockHeader(link, reader, expectedType);
    const payload = await reader.readBytes(fileOffset + 4, Number(header.length) - 4);
    return {
        ...header,
        buffer: new MdfView(payload, reader.littleEndian, 0),
    };
}
