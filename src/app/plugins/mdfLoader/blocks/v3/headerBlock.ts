import { Link, readBlock, MaybeLinked, GenericBlock } from './common';
//import { DataGroupBlock, resolveDataGroupOffset, serializeDataGroupBlock } from './dataGroupBlock';
//import { FileHistoryBlock, resolveFileHistoryOffset } from './fileHistoryBlock';
import { SerializeContext } from './serializer';
import { BufferedFileReader } from '../../BufferedFileReader';
import { TextBlock } from '.';
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

export function serializeHeader(view: MdfView<ArrayBuffer>, context: SerializeContext, header: Header<'instanced'>): void {
    /*view.setBigUint64(0, context.get(header.firstDataGroup), true);
    view.setBigUint64(8, context.get(header.fileHistory), true);
    view.setBigUint64(16, context.get(header.channelHierarchy), true);
    view.setBigUint64(24, context.get(header.attachment), true);
    view.setBigUint64(32, context.get(header.event), true);
    view.setBigUint64(40, context.get(header.comment), true);
    view.setBigUint64(48, header.startTime, true);
    view.setUint16(56, header.timeZone, true);
    view.setUint16(58, header.dstOffset, true);
    view.setUint8(60, header.timeFlags);
    view.setUint8(61, header.timeQuality);
    view.setUint8(62, header.flags);
    view.setBigUint64(64, header.startAngle, true);
    view.setBigUint64(72, header.startDistance, true);*/
}

export function resolveHeaderOffset(context: SerializeContext, header: Header<'instanced'>): number {
    return context.resolve(
        header,
        {
            type: "HD",
            length: 204,
        },
        serializeHeader,
        block => {
            //resolveDataGroupOffset(context, block.firstDataGroup);
            //resolveFileHistoryOffset(context, block.fileHistory);
        }
    );
}

export async function readHeader(link: Link<Header>, reader: BufferedFileReader): Promise<Header<'linked'>> {
    return deserializeHeader(await readBlock(link, reader, "HD"), reader.version);
}
