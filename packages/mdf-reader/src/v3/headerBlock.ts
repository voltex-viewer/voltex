import { Link, NonNullLink, readBlock, MaybeLinked, GenericBlock } from './common';
import { SerializeContext } from './serializer';
import { BufferedFileReader } from '../bufferedFileReader';
import { TextBlock } from './textBlock';
import { MdfView } from './mdfView';

export interface Header<TMode extends 'linked' | 'instanced' = 'linked'> {
    firstDataGroup: MaybeLinked<unknown, TMode>;
    fileComment: MaybeLinked<TextBlock, TMode>;
    programBlock: MaybeLinked<unknown, TMode>;
    dataGroupCount: number,
    date: string,
    time: string,
    author: string,
    organization: string,
    project: string,
    subject: string,
    startTime?: bigint; // MDF 3.2+
    utcOffset?: number; // MDF 3.2+
    timeQuality?: number; // MDF 3.2+
    timerIdentification?: string; // MDF 3.2+
}

export function deserializeHeader(block: GenericBlock): Header {
    const view = block.buffer;

    const result: Header = {
        firstDataGroup: view.readLink(),
        fileComment: view.readLink(),
        programBlock: view.readLink(),
        dataGroupCount: view.readUint16(),
        date: view.readString(10),
        time: view.readString(8),
        author: view.readString(32),
        organization: view.readString(32),
        project: view.readString(32),
        subject: view.readString(32),
    };

    // MDF 3.2+
    if (view.remaining < 8) return result;
    result.startTime = view.readBigUint64();
    if (view.remaining < 2) return result;
    result.utcOffset = view.readInt16();
    if (view.remaining < 2) return result;
    result.timeQuality = view.readUint16();
    if (view.remaining < 32) return result;
    result.timerIdentification = view.readString(32);

    return result;
}

export function serializeHeader(_view: MdfView<ArrayBuffer>, _context: SerializeContext, _header: Header<'instanced'>): void {
}

export function resolveHeaderOffset(context: SerializeContext, header: Header<'instanced'>): number {
    return context.resolve(
        header,
        {
            type: "HD",
            length: 204,
        },
        serializeHeader,
        _block => {
        }
    );
}

export async function readHeader(link: NonNullLink<Header>, reader: BufferedFileReader): Promise<Header<'linked'>>;
export async function readHeader(link: Link<Header>, reader: BufferedFileReader): Promise<Header<'linked'> | null>;
export async function readHeader(link: Link<Header>, reader: BufferedFileReader): Promise<Header<'linked'> | null> {
    const block = await readBlock(link, reader, "HD");
    return block === null ? null : deserializeHeader(block);
}
