import { GenericBlockHeader } from "./common";
import { serializeId } from "./idBlock";

type SerializeFunction<T> = (view: DataView<ArrayBuffer>, context: SerializeContext, object: T) => void;

export class SerializeContext {
    private offset: bigint = 64n;
    private blocks: Map<unknown, [offset: bigint, metadata: GenericBlockHeader, serialize: SerializeFunction<unknown>]> = new Map([[null, [0n, { type: "", length: 0n, links: 0n }, () => {}]]]);

    public get(object: unknown): bigint {
        return this.blocks.get(object)?.[0] ?? 0n;
    }


    public resolve<T>(object: T, metadata: GenericBlockHeader, serialize: SerializeFunction<T>, create?: (object: T) => void): bigint {
        const existingOffset = this.blocks.get(object);
        if (existingOffset !== undefined)
        {
            return existingOffset[0];
        }
        
        const offset = this.offset;
        this.blocks.set(object, [offset, metadata, serialize]);
        this.offset += metadata.length + 24n;
        if (typeof(create) !== "undefined") {
            create(object);
        }
        return offset;
    }

    public async serialize(file: WritableStreamDefaultWriter<any>): Promise<void> {
        // 64 KB block size is pretty good for random access on SSDs
        const buffer = new ArrayBuffer(65536);
        let bufferOffset = serializeId(new DataView(buffer, 0), {
            header: "MDF     ",
            program: "Voltex  ",
            versionLong: "4.10   ",
            version: 410,
        });
        const sortedList = Array.from(this.blocks.entries()).sort(([, [offsetA]], [, [offsetB]]) => Number(offsetA - offsetB));
        let fileOffset = BigInt(bufferOffset);
        for (const [object, [offset, metadata, serialize]] of sortedList) {
            if (object === null) continue;
            if (fileOffset < offset) {
                // Fill gap with zeros
                const gapSize = Number(offset - fileOffset);
                if (bufferOffset + gapSize > buffer.byteLength) {
                    // Flush buffer to the file
                    await file.write(new DataView(buffer, 0, bufferOffset));
                    bufferOffset = 0;
                }
                new Uint8Array(buffer, bufferOffset, gapSize).fill(0);
                await file.write(new DataView(buffer, bufferOffset, gapSize));
                bufferOffset += gapSize;
                fileOffset += BigInt(gapSize);
            }
            const lengthWithHeader = Number(24n + metadata.length);
            if (bufferOffset + lengthWithHeader > buffer.byteLength) {
                // Flush buffer to the file
                await file.write(new DataView(buffer, 0, bufferOffset));
                bufferOffset = 0;
            }
            const view = new DataView(buffer, bufferOffset, lengthWithHeader);
            
            // Write block header metadata
            const typeBytes = new Uint8Array(4);
            for (let i = 0; i < 4; i++) {
                typeBytes[i] = metadata.type.charCodeAt(i);
            }
            new Uint8Array(view.buffer, view.byteOffset, 4).set(typeBytes);
            view.setUint32(4, 0, true); // reserved
            view.setBigUint64(8, metadata.length, true);
            view.setBigUint64(16, metadata.linkCount, true);

            // Write data
            serialize(new DataView(view.buffer, view.byteOffset + 24, Number(metadata.length)), this, object);
            
            bufferOffset += lengthWithHeader;
            fileOffset += BigInt(lengthWithHeader);
        }
        await file.write(new DataView(buffer, 0, bufferOffset));
    }
}
