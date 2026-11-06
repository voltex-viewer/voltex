// LZ4 frames (https://github.com/lz4/lz4/blob/dev/doc/lz4_Frame_format.md) zip types 4 and 5, for MDF 4.3 DZ blocks

const frameMagic = 0x184D2204;

/** Decodes the LZ4 frames in `input` into `size` bytes */
export function decodeLz4Frames(input: Uint8Array, size: number): Uint8Array {
    const out = new Uint8Array(size);
    const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
    let pos = 0;
    let written = 0;
    while (pos + 4 <= input.length) {
        const magic = view.getUint32(pos, true);
        pos += 4;
        if ((magic & 0xFFFFFFF0) === 0x184D2A50) {
            // A skippable frame
            pos += 4 + view.getUint32(pos, true);
            continue;
        }
        if (magic !== frameMagic) throw new Error(`Bad LZ4 frame magic 0x${magic.toString(16)}`);
        const flags = input[pos];
        if (flags >> 6 !== 1) throw new Error(`Unsupported LZ4 frame version ${flags >> 6}`);
        const blockChecksum = (flags & 0x10) !== 0;
        const contentSize = (flags & 0x08) !== 0;
        const contentChecksum = (flags & 0x04) !== 0;
        const dictionary = (flags & 0x01) !== 0;
        const descriptor = 2 + (contentSize ? 8 : 0) + (dictionary ? 4 : 0);
        if (pos + descriptor >= input.length) throw new Error('LZ4 frame header cut short');
        const headerChecksum = (xxh32(input.subarray(pos, pos + descriptor)) >>> 8) & 0xFF;
        if (input[pos + descriptor] !== headerChecksum) throw new Error('LZ4 frame header checksum mismatch');
        pos += descriptor + 1;
        const frameStart = written;
        for (;;) {
            if (pos + 4 > input.length) throw new Error('LZ4 frame cut short');
            const word = view.getUint32(pos, true);
            pos += 4;
            if (word === 0) break;
            const length = word & 0x7FFFFFFF;
            if (pos + length + (blockChecksum ? 4 : 0) > input.length) throw new Error('LZ4 block cut short');
            const data = input.subarray(pos, pos + length);
            if (blockChecksum && view.getUint32(pos + length, true) !== xxh32(data)) {
                throw new Error('LZ4 block checksum mismatch');
            }
            if (word & 0x80000000) {
                if (written + length > size) throw new Error('LZ4 data is longer than the block says');
                out.set(data, written);
                written += length;
            } else {
                written = decodeBlock(input, pos, pos + length, out, written);
            }
            pos += length + (blockChecksum ? 4 : 0);
        }
        if (contentChecksum) {
            if (pos + 4 > input.length) throw new Error('LZ4 frame cut short');
            if (view.getUint32(pos, true) !== xxh32(out.subarray(frameStart, written))) {
                throw new Error('LZ4 content checksum mismatch');
            }
            pos += 4;
        }
    }
    if (written !== size) throw new Error(`LZ4 data gave ${written} bytes, not ${size}`);
    return out;
}

function decodeBlock(input: Uint8Array, start: number, end: number, out: Uint8Array, at: number): number {
    let i = start;
    let o = at;
    while (i < end) {
        const token = input[i++];
        let literals = token >> 4;
        if (literals === 15) {
            let b;
            do { b = input[i++]; literals += b; } while (b === 255);
        }
        if (o + literals > out.length || i + literals > end) throw new Error('Bad LZ4 block');
        out.set(input.subarray(i, i + literals), o);
        i += literals;
        o += literals;
        if (i >= end) break;
        const offset = input[i] | (input[i + 1] << 8);
        i += 2;
        let match = (token & 15) + 4;
        if ((token & 15) === 15) {
            let b;
            do { b = input[i++]; match += b; } while (b === 255);
        }
        if (offset === 0 || offset > o || o + match > out.length) throw new Error('Bad LZ4 match');
        let from = o - offset;
        if (offset >= match) {
            out.copyWithin(o, from, from + match);
            o += match;
        } else {
            // Overlapping: a byte at a time
            for (let k = 0; k < match; k++) out[o++] = out[from++];
        }
    }
    return o;
}

const prime1 = 0x9E3779B1;
const prime2 = 0x85EBCA77;
const prime3 = 0xC2B2AE3D;
const prime4 = 0x27D4EB2F;
const prime5 = 0x165667B1;

const rotl = (x: number, r: number) => (x << r) | (x >>> (32 - r));
const round = (acc: number, lane: number) => Math.imul(rotl((acc + Math.imul(lane, prime2)) | 0, 13), prime1);

/** xxHash32 of `data` with seed 0 (https://github.com/Cyan4973/xxHash/blob/dev/doc/xxhash_spec.md), unsigned */
export function xxh32(data: Uint8Array): number {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const n = data.length;
    let i = 0;
    let acc: number;
    if (n >= 16) {
        let v1 = (prime1 + prime2) | 0;
        let v2 = prime2 | 0;
        let v3 = 0;
        let v4 = -prime1 | 0;
        for (; i + 16 <= n; i += 16) {
            v1 = round(v1, view.getUint32(i, true));
            v2 = round(v2, view.getUint32(i + 4, true));
            v3 = round(v3, view.getUint32(i + 8, true));
            v4 = round(v4, view.getUint32(i + 12, true));
        }
        acc = (rotl(v1, 1) + rotl(v2, 7) + rotl(v3, 12) + rotl(v4, 18)) | 0;
    } else {
        acc = prime5 | 0;
    }
    acc = (acc + n) | 0;
    for (; i + 4 <= n; i += 4) {
        acc = Math.imul(rotl((acc + Math.imul(view.getUint32(i, true), prime3)) | 0, 17), prime4);
    }
    for (; i < n; i++) {
        acc = Math.imul(rotl((acc + Math.imul(data[i], prime5)) | 0, 11), prime1);
    }
    acc ^= acc >>> 15;
    acc = Math.imul(acc, prime2);
    acc ^= acc >>> 13;
    acc = Math.imul(acc, prime3);
    acc ^= acc >>> 16;
    return acc >>> 0;
}
