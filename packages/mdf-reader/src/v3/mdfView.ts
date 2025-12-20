import { getLink, Link, newLink } from "./common";

export class MdfView<TArrayBuffer extends ArrayBufferLike = ArrayBufferLike & { BYTES_PER_ELEMENT?: never; }>
{
    readonly dataView: DataView<TArrayBuffer>;
    readonly littleEndian: boolean;
    offset: number;

    constructor(buffer: TArrayBuffer, endianness: boolean, byteOffset?: number, byteLength?: number) {
        this.dataView = new DataView(buffer, byteOffset, byteLength);
        this.littleEndian = endianness;
        this.offset = 0;
    }

    get buffer() {
        return this.dataView.buffer;
    }

    get byteOffset() {
        return this.dataView.byteOffset + this.offset;
    }

    get remaining() {
        return this.dataView.byteLength - this.offset;
    }

    readString(length: number): string {
        const bytes = new Uint8Array(this.dataView.buffer, this.offset + this.dataView.byteOffset, length);
        const end = bytes.indexOf(0);
        this.offset += length;
        return new TextDecoder('utf-8').decode(bytes.subarray(0, end === -1 ? bytes.length : end));
    }

    writeString(value: string, length?: number) {
        const encoded = new TextEncoder().encode(value);
        length ??= encoded.length + 1;
        const arr = new Uint8Array(this.dataView.buffer, this.dataView.byteOffset + this.offset, length);
        if (encoded.length + 1 > length) {
            throw new Error("String longer than the space allocated");
        }
        arr.set(encoded, 0);
        arr.set(Array(length - encoded.length).map(() => 0), encoded.length); // null padding
        this.offset += length;
    }

    readUint8(): number {
        const result = this.dataView.getUint8(this.offset);
        this.offset += 1;
        return result;
    }

    writeUint8(value: number) {
        this.dataView.setUint8(this.offset++, value);
        this.offset += 1;
    }
    
    readUint16(): number {
        const result = this.dataView.getUint16(this.offset, this.littleEndian);
        this.offset += 2;
        return result;
    }

    writeUint16(value: number) {
        this.dataView.setUint16(this.offset, value, this.littleEndian);
        this.offset += 2;
    }
    
    readInt16(): number {
        const result = this.dataView.getInt16(this.offset, this.littleEndian);
        this.offset += 2;
        return result;
    }

    writeInt16(value: number) {
        this.dataView.setInt16(this.offset, value, this.littleEndian);
        this.offset += 2;
    }
    
    readUint32(): number {
        const result = this.dataView.getUint32(this.offset, this.littleEndian);
        this.offset += 4;
        return result;
    }

    writeUint32(value: number) {
        this.dataView.setUint32(this.offset, value, this.littleEndian);
        this.offset += 4;
    }
    
    readBigUint64(): bigint {
        const result = this.dataView.getBigUint64(this.offset, this.littleEndian);
        this.offset += 8;
        return result;
    }

    writeBigUint64(value: bigint) {
        this.dataView.setBigUint64(this.offset, value, this.littleEndian);
        this.offset += 8;
    }
    
    readBool(): boolean {
        const result = this.dataView.getUint16(this.offset, this.littleEndian) !== 0;
        this.offset += 2;
        return result;
    }

    writeBool(value: boolean) {
        this.dataView.setUint16(this.offset, value ? 1 : 0, this.littleEndian);
        this.offset += 2;
    }
    
    readReal(): number {
        const result = this.dataView.getFloat64(this.offset, this.littleEndian);
        this.offset += 8;
        return result;
    }

    writeReal(value: number) {
        this.dataView.setFloat64(this.offset, value, this.littleEndian);
        this.offset += 8;
    }
    
    readLink<T>(): Link<T> {
        const result = newLink(this.dataView.getUint32(this.offset, this.littleEndian));
        this.offset += 4;
        return result;
    }
    
    writeLink<T>(link: Link<T>) {
        this.dataView.setUint32(this.offset, getLink(link), this.littleEndian);
        this.offset += 4;
    }
}
