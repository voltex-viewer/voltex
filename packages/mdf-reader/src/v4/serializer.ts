import { GenericBlockHeader } from "./common";
import { serializeId } from "./idBlock";

export type SerializeWriteChunk = Uint8Array | { size: number; fill: (view: DataView<ArrayBuffer>) => void };
export type SerializeWriteFunction = (chunk: SerializeWriteChunk) => Promise<void>;
type SerializeFunction<T> = (write: SerializeWriteFunction, context: SerializeContext, object: T) => Promise<void>;

export interface WritableFile {
    write(data: BufferSource | Blob | string | Uint8Array<ArrayBufferLike>): Promise<void>;
}

class BufferedSink {
    private readonly buffer: Uint8Array;
    private offset = 0;

    constructor(private readonly file: WritableFile, bufferSize: number = 65536) {
        this.buffer = new Uint8Array(bufferSize);
    }

    private async flushInternal(): Promise<void> {
        if (this.offset === 0) return;
        await this.file.write(this.buffer.subarray(0, this.offset));
        this.offset = 0;
    }

    async write(chunk: SerializeWriteChunk): Promise<void> {
        if (!(chunk instanceof Uint8Array)) {
            if (chunk.size <= 0) return;

            if (chunk.size >= this.buffer.byteLength) {
                await this.flushInternal();
                const temp = new Uint8Array(chunk.size);
                chunk.fill(new DataView(temp.buffer));
                await this.file.write(temp);
                return;
            }

            if (this.offset + chunk.size > this.buffer.byteLength) {
                await this.flushInternal();
            }

            const view = new DataView(this.buffer.buffer as ArrayBuffer, this.offset, chunk.size);
            chunk.fill(view);
            this.offset += chunk.size;
            return;
        }

        if (chunk.byteLength === 0) return;

        if (chunk.byteLength >= this.buffer.byteLength) {
            await this.flushInternal();
            await this.file.write(chunk);
            return;
        }

        if (this.offset + chunk.byteLength > this.buffer.byteLength) {
            await this.flushInternal();
        }

        this.buffer.set(chunk, this.offset);
        this.offset += chunk.byteLength;
    }

    async close(): Promise<void> {
        await this.flushInternal();
    }
}

export class SerializeContext {
    private offset: bigint = 64n;
    private blocks: Map<unknown, [offset: bigint, metadata: GenericBlockHeader, serialize: SerializeFunction<unknown>]> = new Map([
        [null, [0n, { type: "", length: 0n, linkCount: 0n }, async () => {}]]
    ]);

    public get(object: unknown): bigint {
        return this.blocks.get(object)?.[0] ?? 0n;
    }

    public resolve<T>(object: T | null, metadata: GenericBlockHeader, serialize: SerializeFunction<T>, create?: (object: T) => void): bigint {
        const existingOffset = this.blocks.get(object);
        if (existingOffset !== undefined)
        {
            return existingOffset[0];
        }
        
        const offset = this.offset;
        this.blocks.set(object, [offset, metadata, serialize as SerializeFunction<unknown>]);
        const totalLength = metadata.length + 24n; // header (24 bytes) + data
        const roundedLength = (totalLength + 7n) & ~7n; // align to 8-byte boundary
        this.offset += roundedLength;
        if (typeof(create) !== "undefined") {
            create(object!);
        }
        return offset;
    }

    public async serialize(file: WritableFile): Promise<void> {
        const sink = new BufferedSink(file);

        await sink.write({
            size: 64,
            fill: (view: DataView<ArrayBuffer>) => {
                serializeId(view, {
                    header: "MDF     ",
                    program: "Voltex  ",
                    versionLong: "4.10   ",
                    version: 410,
                    littleEndian: true,
                });
            },
        });

        const sortedList = Array.from(this.blocks.entries()).sort(([, [offsetA]], [, [offsetB]]) => Number(offsetA - offsetB));
        let fileOffset = 64n;
        for (const [object, [offset, metadata, serialize]] of sortedList) {
            if (object === null) continue;
            if (fileOffset < offset) {
                // Fill gap with zeros
                const gapSize = Number(offset - fileOffset);
                await sink.write({ size: gapSize, fill: (view: DataView<ArrayBuffer>) => new Uint8Array(view.buffer, view.byteOffset, view.byteLength).fill(0) });
                fileOffset += BigInt(gapSize);
            } else if (fileOffset > offset) {
                throw new Error("Internal error: blocks have not allocated the correct amount of space");
            }

            const lengthWithHeader = 24n + metadata.length;
            await sink.write({
                size: 24,
                fill: (view: DataView<ArrayBuffer>) => {
                    const bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
                    for (let i = 0; i < 4; i++) {
                        bytes[i] = metadata.type.charCodeAt(i);
                    }
                    view.setUint32(4, 0, true); // reserved
                    view.setBigUint64(8, lengthWithHeader, true);
                    view.setBigUint64(16, metadata.linkCount, true);
                },
            });

            await serialize(sink.write.bind(sink), this, object);

            fileOffset += lengthWithHeader;
        }
        await sink.close();
    }
}
