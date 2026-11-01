import { describe, it, expect } from 'vitest';
import { RenderMode, type SignalSource } from '@voltex-viewer/plugin-api';
import { InMemoryBigUint64Sequence, InMemoryFloat64Sequence, InMemorySequence, SequenceSignal } from '@voltex-viewer/signal-utils';
import { openMdfFile, v4 } from '@voltex-viewer/mdf-reader';
import { buildMdfHeader } from './mdfExport';

function source(name: string[]): SignalSource {
    return { name, signal: () => Promise.reject(new Error('unused')) };
}

async function serialize(header: v4.Header<'instanced'>): Promise<File> {
    const context = new v4.SerializeContext();
    v4.resolveHeaderOffset(context, header);
    const chunks: Uint8Array[] = [];
    await context.serialize({
        write: async (chunk: BufferSource | Blob | string) => { chunks.push(new Uint8Array(chunk as ArrayBuffer)); },
    });
    return new File(chunks as BlobPart[], 'test.mf4');
}

async function readBack(file: File): Promise<Map<string, (number | bigint)[]>> {
    const mdf = await openMdfFile(file);
    const values = new Map<string, (number | bigint)[]>();
    const reads = mdf.getGroups().flatMap(group => group.channelGroups.flatMap(channelGroup => channelGroup.channels.map(channel => {
        const out: (number | bigint)[] = [];
        values.set(`${channelGroup.name}/${channel.name}`, out);
        return { channel, buffer: { push: (v: number | bigint) => { out.push(v); } } };
    })));
    await mdf.read(reads);
    return values;
}

describe('MDF export', () => {
    it('keeps 64-bit values exact and writes each signal with its own time', async () => {
        const bigTime = new InMemoryFloat64Sequence();
        const big = new InMemoryBigUint64Sequence();
        bigTime.push(0, 1, 2);
        big.push(2n ** 64n - 1n, 2n ** 53n + 1n, 7n);

        const floatTime = new InMemoryFloat64Sequence();
        const floats = new InMemorySequence();
        floatTime.push(0.5, 1.5);
        floats.push(0.25, -3);

        const header = await buildMdfHeader([
            new SequenceSignal(source(['file', 'Big']), bigTime, big, RenderMode.Lines),
            new SequenceSignal(source(['file', 'Float']), floatTime, floats, RenderMode.Lines),
        ], 0n);
        const values = await readBack(await serialize(header));

        expect(values.get('file/Big')).toEqual([2n ** 64n - 1n, 2n ** 53n + 1n, 7n]);
        const floatGroup = [...values.entries()].filter(([name]) => name.endsWith('/Float'));
        expect(floatGroup.map(([, v]) => v)).toEqual([[0.25, -3]]);
    });
});
