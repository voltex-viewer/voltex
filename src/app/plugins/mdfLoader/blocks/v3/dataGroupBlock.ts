import { Link, getLink, readBlock, MaybeLinked, GenericBlock } from './common';
import { SerializeContext } from './serializer';
import { BufferedFileReader } from '../../BufferedFileReader';
import { MdfView } from './mdfView';
import { ChannelGroupBlock, resolveChannelGroupOffset } from '.';

export enum RecordIdType {
    None = 0, // No record ID tagging (i.e. sorted)
    Before = 1, // Record ID before
    BeforeAndAfter = 2, // Record ID after
}

export function parseRecordIdType(value: number): RecordIdType {
    if (value >= 0 && value <= 2) {
        return value as RecordIdType;
    }
    throw new Error(`Invalid RecordIdType value: ${value}`);
}

export interface DataGroupBlock<TMode extends 'linked' | 'instanced' = 'linked'> {
    dataGroupNext: MaybeLinked<DataGroupBlock<TMode>, TMode>;
    channelGroupFirst: MaybeLinked<ChannelGroupBlock<TMode>, TMode>;
    trigger: MaybeLinked<unknown, TMode>;
    data: MaybeLinked<unknown, TMode>;
    channelGroupCount: number,
    recordIdType: number
}

export function deserializeDataGroupBlock(block: GenericBlock): DataGroupBlock<'linked'> {
    const view = block.buffer;
    return {
        dataGroupNext: view.readLink(),
        channelGroupFirst: view.readLink(),
        trigger: view.readLink(),
        data: view.readLink(),
        channelGroupCount: view.readUint16(),
        recordIdType: parseRecordIdType(view.readUint16()),
        // 4 bytes reserved
    };
}

export function serializeDataGroupBlock(view: MdfView, context: SerializeContext, dataGroup: DataGroupBlock<'instanced'>): void {
    view.writeLink(context.get(dataGroup.dataGroupNext));
    view.writeLink(context.get(dataGroup.channelGroupFirst));
    view.writeLink(context.get(dataGroup.trigger));
    view.writeLink(context.get(dataGroup.data));
    view.writeUint16(dataGroup.channelGroupCount);
    view.writeUint16(dataGroup.recordIdType);
    view.writeUint32(0); // Reserved
}

export function resolveDataGroupOffset(context: SerializeContext, block: DataGroupBlock<'instanced'>) {
    return context.resolve(
        block, 
        {
            type: "DG",
            length: 24,
        },
        serializeDataGroupBlock,
        block => {
            resolveChannelGroupOffset(context, block.channelGroupFirst);
            resolveDataGroupOffset(context, block.dataGroupNext);
        });
}
export async function getDataBlocks(dataGroup: DataGroupBlock, reader: BufferedFileReader): Promise<AsyncIterableIterator<DataView<ArrayBuffer>>> {
    return (async function* () {
        let fileOffset = Number(getLink(dataGroup.data));

        const readLength = 8192;
        while(true)
        {
            const payload = await reader.readBytes(fileOffset, readLength);
            yield new DataView(payload, 0, payload.byteLength);
            if (payload.byteLength < readLength) {
                break;
            }
            fileOffset += readLength;
        }
    })();
}

export async function readDataGroupBlock(link: Link<DataGroupBlock>, reader: BufferedFileReader): Promise<DataGroupBlock<'linked'>> {
    return deserializeDataGroupBlock(await readBlock(link, reader, "DG"));
}

export async function* iterateDataGroupBlocks(startLink: Link<DataGroupBlock>, reader: BufferedFileReader): AsyncIterableIterator<DataGroupBlock<'linked'>> {
    let currentLink = startLink;
    
    while (getLink(currentLink) !== 0) {
        const dataGroup = await readDataGroupBlock(currentLink, reader);
        yield dataGroup;
        currentLink = dataGroup.dataGroupNext;
    }
}
