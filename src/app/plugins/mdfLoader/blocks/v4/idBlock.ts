export type IdHeader = "MDF     " | "UnFinMF ";

export interface Id {
    header: IdHeader;
    versionLong: string;
    program: string;
    littleEndian: boolean;
    version: number;
}

export const idLength = 64;

export function deserializeId(buffer: ArrayBuffer): Id {
    if (buffer.byteLength < idLength) {
        throw new Error(`Invalid length ID header (${buffer.byteLength} bytes, expected ${idLength})`);
    }

    const view = new DataView(buffer);
    
    const header = String.fromCharCode(...new Uint8Array(buffer, 0, 8));
    if (header !== "MDF     " && header !== "UnFinMF ") {
        throw new Error(`Invalid ID header: ${header}`);
    }
    return {
        header,
        versionLong: String.fromCharCode(...new Uint8Array(buffer, 8, 8)),
        program: String.fromCharCode(...new Uint8Array(buffer, 16, 8)),
        littleEndian: view.getUint16(24, true) === 0,
        version: view.getUint16(28, true),
    };
}

export function serializeId(view: DataView<ArrayBuffer>, id: Id): number {
    const arr = new Uint8Array(view.buffer, view.byteOffset, view.byteLength)

    const encoder = new TextEncoder();
    arr.set(encoder.encode(id.header), 0);
    arr.set(encoder.encode(id.versionLong), 8);
    arr.set(encoder.encode(id.program), 16);
    view.setUint16(28, id.version, true);

    return idLength;
}
