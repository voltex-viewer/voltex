import { GenericBlockHeader, Link, newLink } from "./common";
import { MdfView } from "./mdfView";

type SerializeFunction<T> = (view: MdfView<ArrayBuffer>, context: SerializeContext, object: T) => void;

export class SerializeContext {
    private offset: number = 64;
    private blocks: Map<unknown, [offset: number, metadata: GenericBlockHeader, serialize: SerializeFunction<unknown>]> = new Map([
        [null, [0, { type: "", length: 0, }, () => {}]]
    ]);

    public get(object: unknown): Link<unknown> {
        return newLink(this.blocks.get(object)?.[0] ?? 0);
    }

    public resolve<T>(object: T | null, metadata: GenericBlockHeader, serialize: SerializeFunction<T>, create?: (object: T) => void): number {
        const existingOffset = this.blocks.get(object);
        if (existingOffset !== undefined)
        {
            return existingOffset[0];
        }
        
        const offset = this.offset;
        this.blocks.set(object, [offset, metadata, serialize as SerializeFunction<unknown>]);
        const totalLength = metadata.length + 8; // header (8 bytes) + data
        const roundedLength = (totalLength + 3) & ~3; // align to 4-byte boundary
        this.offset += roundedLength;
        if (typeof(create) !== "undefined") {
            create(object!);
        }
        return offset;
    }

    public async serialize(file: WritableStreamDefaultWriter<Uint8Array>): Promise<void> {
        // 64 KB block size is pretty good for random access on SSDs
        const buffer = new ArrayBuffer(65536);
        const sortedList = Array.from(this.blocks.entries()).sort(([, [offsetA]], [, [offsetB]]) => Number(offsetA - offsetB));
        let bufferOffset = 0;
        let fileOffset = 0;
        for (const [object, [offset, metadata, serialize]] of sortedList) {
            if (object === null) continue;
            if (fileOffset < offset) {
                // Fill gap with zeros
                const gapSize = offset - fileOffset;
                if (bufferOffset + gapSize > buffer.byteLength) {
                    // Flush buffer to the file
                    await file.write(new Uint8Array(buffer, 0, bufferOffset));
                    bufferOffset = 0;
                }
                new Uint8Array(buffer, bufferOffset, gapSize).fill(0);
                bufferOffset += gapSize;
                fileOffset += gapSize;
            } else if (fileOffset > offset) {
                throw new Error("Internal error: blocks have not allocated the correct amount of space");
            }
            const lengthWithHeader = 4 + metadata.length;
            if (bufferOffset + Number(lengthWithHeader) > buffer.byteLength) {
                // Flush buffer to the file
                await file.write(new Uint8Array(buffer, 0, bufferOffset));
                bufferOffset = 0;
            }
            const view = new DataView(buffer, bufferOffset, Number(lengthWithHeader));
            
            // Write block header metadata
            for (let i = 0; i < 2; i++) {
                view.setUint8(i, metadata.type.charCodeAt(i));
            }
            view.setUint16(2, lengthWithHeader);

            // Write data
            serialize(new MdfView(view.buffer, true, view.byteOffset + 4, Number(metadata.length)), this, object);
            
            bufferOffset += Number(lengthWithHeader);
            fileOffset += lengthWithHeader;
        }
        await file.write(new Uint8Array(buffer, 0, bufferOffset));
    }
}
