import { Link, readBlock, MaybeLinked, GenericBlock } from './common';
import { SerializeContext } from './serializer';
import { BufferedFileReader } from '../bufferedFileReader';
import { TextBlock } from './textBlock';
import { MdfView } from './mdfView';

export interface Header<TMode extends 'linked' | 'instanced' = 'linked'> {
    firstDataGroup: MaybeLinked<unknown, TMode>;
    fileComment: MaybeLinked<TextBlock, TMode>;
    programBlock: MaybeLinked<unknown, TMode>;
    dataGroupCount: number,
    author: string,
    organization: string,
    project: string,
    subject: string,
    startTime?: bigint;
    utcOffset?: number;
    timeQuality?: number;
    timerIdentification?: string;
}

export function deserializeHeader(block: GenericBlock, version: number): Header {
    const view = block.buffer;

    const baseline = {
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

    if (version < 330) {
        return baseline;
    } else {
        return {
            ...baseline,
            startTime: view.readBigUint64(),
            utcOffset: view.readInt16(),
            timeQuality: view.readUint16(),
            timerIdentification: view.readString(32),
        };
    }
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

export async function readHeader(link: Link<Header>, reader: BufferedFileReader): Promise<Header<'linked'>> {
    return deserializeHeader(await readBlock(link, reader, "HD"), reader.version);
}
