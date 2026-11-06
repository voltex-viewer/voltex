import { describe, it, expect } from 'vitest';
import { decodeLz4Frames, xxh32 } from './lz4';

const text = (b: Uint8Array) => new TextDecoder().decode(b);
const bytes = (s: string) => new TextEncoder().encode(s);
const base64 = (s: string) => Uint8Array.from(atob(s), c => c.charCodeAt(0));

function frame(blocks: [boolean, number[]][], content?: Uint8Array, blockChecksums = false): number[] {
    const flags = 0x60 | (blockChecksums ? 0x10 : 0) | (content ? 0x04 : 0);
    const descriptor = [flags, 0x40];
    const out = [0x04, 0x22, 0x4D, 0x18, ...descriptor, (xxh32(new Uint8Array(descriptor)) >>> 8) & 0xFF];
    const u32 = (v: number) => [v & 0xFF, (v >>> 8) & 0xFF, (v >>> 16) & 0xFF, v >>> 24];
    for (const [stored, data] of blocks) {
        out.push(...u32((data.length | (stored ? 0x80000000 : 0)) >>> 0), ...data);
        if (blockChecksums) out.push(...u32(xxh32(new Uint8Array(data))));
    }
    out.push(0, 0, 0, 0);
    if (content) out.push(...u32(xxh32(content)));
    return out;
}

const sample = new Uint8Array([...bytes('voltexd sampled stream '.repeat(9)), ...Array.from({ length: 256 }, (_, i) => i), ...bytes('tail!')]);
const checked = base64('BCJNGHxA1AEAAAAAAABxIwEAAP8Idm9sdGV4ZCBzYW1wbGVkIHN0cmVhbSAXAKXw9gABAgMEBQYHCAkKCwwNDg8QERITFBUWFxgZGhscHR4fICEiIyQlJicoKSorLC0uLzAxMjM0NTY3ODk6Ozw9Pj9AQUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVpbXF1eX2BhYmNkZWZnaGlqa2xtbm9wcXJzdHV2d3h5ent8fX5/gIGCg4SFhoeIiYqLjI2Oj5CRkpOUlZaXmJmam5ydnp+goaKjpKWmp6ipqqusra6vsLGys7S1tre4ubq7vL2+v8DBwsPExcbHyMnKy8zNzs/Q0dLT1NXW19jZ2tvc3d7f4OHi4+Tl5ufo6err7O3u7/Dx8vP09fb3+Pn6+/z9/v90YWlsIXLhE4IAAAAAvFTI2Q==');
const unchecked = base64('BCJNGGBAgiMBAAD/CHZvbHRleGQgc2FtcGxlZCBzdHJlYW0gFwCl8PYAAQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyAhIiMkJSYnKCkqKywtLi8wMTIzNDU2Nzg5Ojs8PT4/QEFCQ0RFRkdISUpLTE1OT1BRUlNUVVZXWFlaW1xdXl9gYWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXp7fH1+f4CBgoOEhYaHiImKi4yNjo+QkZKTlJWWl5iZmpucnZ6foKGio6SlpqeoqaqrrK2ur7CxsrO0tba3uLm6u7y9vr/AwcLDxMXGx8jJysvMzc7P0NHS09TV1tfY2drb3N3e3+Dh4uPk5ebn6Onq6+zt7u/w8fLz9PX29/j5+vv8/f7/dGFpbCEAAAAA');

describe('xxHash32', () => {
    it('matches the reference values', () => {
        expect(xxh32(new Uint8Array(0))).toBe(0x02CC5D05);
        expect(xxh32(bytes('a'))).toBe(0x550D7456);
        expect(xxh32(bytes('abc'))).toBe(0x32D153FF);
    });
});

describe('LZ4 frames', () => {
    it("decode another encoder's frames, checking their checksums", () => {
        expect(decodeLz4Frames(checked, sample.length)).toEqual(sample);
        expect(decodeLz4Frames(unchecked, sample.length)).toEqual(sample);
    });

    it('decode literals and overlapping matches', () => {
        const block = [0x35, 0x61, 0x62, 0x63, 0x03, 0x00, 0x10, 0x58];
        const f = new Uint8Array(frame([[false, block]], bytes('abcabcabcabcX'), true));
        expect(text(decodeLz4Frames(f, 13))).toBe('abcabcabcabcX');
    });

    it('decode stored blocks and frames one after another', () => {
        const f = frame([[true, [0x78, 0x79, 0x7A]], [false, [0x10, 0x21]]], bytes('xyz!'));
        expect(text(decodeLz4Frames(new Uint8Array([...f, ...f]), 8))).toBe('xyz!xyz!');
    });

    it('refuse damaged data', () => {
        // Literal changed
        const damaged = checked.slice();
        damaged[40] ^= 1;
        expect(() => decodeLz4Frames(damaged, sample.length)).toThrow(/checksum/);

        // Only the content checksum
        const f = frame([[false, [0x35, 0x61, 0x62, 0x63, 0x03, 0x00, 0x10, 0x58]]], bytes('abcabcabcabcX'));
        f[12] ^= 1;
        expect(() => decodeLz4Frames(new Uint8Array(f), 13)).toThrow(/content checksum/);

        // Damaged header
        const header = checked.slice();
        header[5] ^= 0x40;
        expect(() => decodeLz4Frames(header, sample.length)).toThrow(/header checksum/);
    });

    it('refuse data of the wrong length', () => {
        expect(() => decodeLz4Frames(new Uint8Array(frame([[true, [0x78, 0x79, 0x7A]]])), 4)).toThrow();
    });
});
