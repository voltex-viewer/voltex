import { describe, it, expect } from 'vitest';
import { openMdfFile } from './mdfFile';
import { ChannelType } from './decoder';
import { SerializeContext } from './v4/serializer';
import { resolveHeaderOffset } from './v4/headerBlock';
import type { Header } from './v4/headerBlock';
import type { DataGroupBlock } from './v4/dataGroupBlock';
import type { ChannelGroupBlock } from './v4/channelGroupBlock';
import { DataType, type ChannelBlock } from './v4/channelBlock';
import type { TextBlock } from './v4/textBlock';
import type { DataTableBlock } from './v4/dataTableBlock';

async function createMdf4File(groups: { name: string; channels: { name: string; type: 'time' | 'signal'; dataType: DataType; bitCount: number; values: number[] }[] }[]): Promise<File> {
    const context = new SerializeContext();

    let lastDataGroup: DataGroupBlock<'instanced'> | null = null;

    for (const group of groups) {
        const recordSize = group.channels.reduce((acc, ch) => acc + Math.ceil(ch.bitCount / 8), 0);
        const recordCount = group.channels[0]?.values.length ?? 0;
        const dataBuffer = new ArrayBuffer(recordSize * recordCount);
        const dataView = new DataView(dataBuffer);

        let byteOffset = 0;
        let lastChannel: ChannelBlock<'instanced'> | null = null;

        for (const channel of group.channels) {
            const channelName: TextBlock = { data: channel.name };
            const byteSize = Math.ceil(channel.bitCount / 8);

            for (let i = 0; i < channel.values.length; i++) {
                const offset = i * recordSize + byteOffset;
                if (channel.bitCount === 64) {
                    dataView.setFloat64(offset, channel.values[i], true);
                } else if (channel.bitCount === 32) {
                    dataView.setFloat32(offset, channel.values[i], true);
                } else if (channel.bitCount === 16) {
                    dataView.setUint16(offset, channel.values[i], true);
                } else {
                    dataView.setUint8(offset, channel.values[i]);
                }
            }

            const channelBlock: ChannelBlock<'instanced'> = {
                channelNext: lastChannel,
                component: null,
                txName: channelName,
                siSource: null,
                conversion: null,
                data: null,
                unit: null,
                comment: null,
                channelType: channel.type === 'time' ? 2 : 0,
                syncType: 0,
                dataType: channel.dataType,
                bitOffset: 0,
                byteOffset,
                bitCount: channel.bitCount,
                flags: 0,
                invalidationBitPosition: 0,
                precision: 0,
                attachmentCount: 0,
                valueRangeMinimum: 0,
                valueRangeMaximum: 0,
                limitMinimum: 0,
                limitMaximum: 0,
                limitExtendedMinimum: 0,
                limitExtendedMaximum: 0,
            };

            lastChannel = channelBlock;
            byteOffset += byteSize;
        }

        const dataTable: DataTableBlock = { data: dataView };

        const channelGroup: ChannelGroupBlock<'instanced'> = {
            channelGroupNext: null,
            channelFirst: lastChannel,
            acquisitionName: { data: group.name },
            acquisitionSource: null,
            sampleReductionFirst: null,
            comment: null,
            recordId: 0n,
            cycleCount: BigInt(recordCount),
            flags: 0,
            pathSeparator: 0,
            dataBytes: recordSize,
            invalidationBytes: 0,
        };

        const dataGroup: DataGroupBlock<'instanced'> = {
            dataGroupNext: lastDataGroup,
            channelGroupFirst: channelGroup,
            data: dataTable,
            comment: null,
            recordIdSize: 0,
        };

        lastDataGroup = dataGroup;
    }

    const header: Header<'instanced'> = {
        firstDataGroup: lastDataGroup,
        fileHistory: null,
        channelHierarchy: null,
        attachment: null,
        event: null,
        comment: null,
        startTime: 0n,
        timeZone: 0,
        dstOffset: 0,
        timeFlags: 0,
        timeQuality: 0,
        flags: 0,
        startAngle: 0n,
        startDistance: 0n,
    };

    resolveHeaderOffset(context, header);

    const chunks: Uint8Array[] = [];
    const mockWriter = {
        write: async (chunk: BufferSource) => { chunks.push(new Uint8Array(chunk as ArrayBuffer)); },
        close: async () => {},
    };

    await context.serialize(mockWriter);

    const totalLength = chunks.reduce((acc, c) => acc + c.length, 0);
    const result = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.length;
    }

    return new File([result], 'test.mf4', { type: 'application/octet-stream' });
}

function makeBuffer() {
    const values: number[] = [];
    return {
        push: (v: number | bigint) => { values.push(Number(v)); },
        get values() { return values; },
    };
}

describe('mdfFile v4', () => {
    it('should open a v4 file and read groups', async () => {
        const file = await createMdf4File([
            {
                name: 'Group1',
                channels: [
                    { name: 'Time', type: 'time', dataType: DataType.FloatLe, bitCount: 64, values: [0, 1, 2, 3, 4] },
                    { name: 'Signal1', type: 'signal', dataType: DataType.FloatLe, bitCount: 64, values: [10, 20, 30, 40, 50] },
                ],
            },
        ]);

        const mdf = await openMdfFile(file);

        expect(mdf.version).toBe(410);
        expect(mdf.filename).toBe('test.mf4');

        const groups = mdf.getGroups();
        expect(groups.length).toBe(1);

        const channels = groups[0].channelGroups[0].channels;
        expect(channels.length).toBe(2);

        const timeChannel = channels.find(c => c.channelType === ChannelType.Time);
        const valueChannel = channels.find(c => c.channelType === ChannelType.Signal);

        expect(timeChannel).toBeDefined();
        expect(valueChannel).toBeDefined();
        expect(timeChannel!.name).toBe('Time');
        expect(valueChannel!.name).toBe('Signal1');
    });

    it('should read signal data', async () => {
        const timeValues = [0, 0.5, 1.0, 1.5, 2.0];
        const signalValues = [100, 200, 300, 400, 500];

        const file = await createMdf4File([
            {
                name: 'TestGroup',
                channels: [
                    { name: 'Time', type: 'time', dataType: DataType.FloatLe, bitCount: 64, values: timeValues },
                    { name: 'Voltage', type: 'signal', dataType: DataType.FloatLe, bitCount: 64, values: signalValues },
                ],
            },
        ]);

        const mdf = await openMdfFile(file);
        const groups = mdf.getGroups();
        const channels = groups[0].channelGroups[0].channels;

        const timeChannel = channels.find(c => c.name === 'Time')!;
        const voltageChannel = channels.find(c => c.name === 'Voltage')!;
        const timeBuf = makeBuffer();
        const voltageBuf = makeBuffer();

        await mdf.read([
            { channel: timeChannel, buffer: timeBuf },
            { channel: voltageChannel, buffer: voltageBuf },
        ]);

        expect(timeBuf.values.length).toBe(5);
        expect(voltageBuf.values.length).toBe(5);

        for (let i = 0; i < 5; i++) {
            expect(timeBuf.values[i]).toBeCloseTo(timeValues[i]);
            expect(voltageBuf.values[i]).toBeCloseTo(signalValues[i]);
        }
    });

    it('should handle multiple groups', async () => {
        const file = await createMdf4File([
            {
                name: 'Group1',
                channels: [
                    { name: 'T1', type: 'time', dataType: DataType.FloatLe, bitCount: 64, values: [0, 1] },
                    { name: 'S1', type: 'signal', dataType: DataType.FloatLe, bitCount: 64, values: [10, 20] },
                ],
            },
            {
                name: 'Group2',
                channels: [
                    { name: 'T2', type: 'time', dataType: DataType.FloatLe, bitCount: 64, values: [0, 1, 2] },
                    { name: 'S2', type: 'signal', dataType: DataType.FloatLe, bitCount: 64, values: [100, 200, 300] },
                ],
            },
        ]);

        const mdf = await openMdfFile(file);
        const groups = mdf.getGroups();

        expect(groups.length).toBe(2);

        const allChannels = groups.flatMap(dg => dg.channelGroups.flatMap(cg => cg.channels));
        const bufs = new Map(allChannels.map(ch => [ch, makeBuffer()]));

        await mdf.read(allChannels.map(ch => ({ channel: ch, buffer: bufs.get(ch)! })));

        const s1Buf = bufs.get(allChannels.find(c => c.name === 'S1')!)!;
        const s2Buf = bufs.get(allChannels.find(c => c.name === 'S2')!)!;
        expect(s1Buf.values.length).toBe(2);
        expect(s2Buf.values.length).toBe(3);
    });

    it('should call onProgress during file loading', async () => {
        const file = await createMdf4File([
            {
                name: 'Group1',
                channels: [
                    { name: 'Time', type: 'time', dataType: DataType.FloatLe, bitCount: 64, values: [0, 1, 2] },
                    { name: 'Signal', type: 'signal', dataType: DataType.FloatLe, bitCount: 64, values: [1, 2, 3] },
                ],
            },
        ]);

        let progressCalled = false;
        await openMdfFile(file, {
            onProgress: () => {
                progressCalled = true;
            },
        });

        expect(progressCalled).toBe(true);
    });

    it('should read channels into caller-provided buffers', async () => {
        const file = await createMdf4File([
            {
                name: 'Group1',
                channels: [
                    { name: 'Time', type: 'time', dataType: DataType.FloatLe, bitCount: 64, values: [0, 1, 2] },
                    { name: 'Signal', type: 'signal', dataType: DataType.FloatLe, bitCount: 64, values: [10, 20, 30] },
                ],
            },
        ]);

        const mdf = await openMdfFile(file);
        const channels = mdf.getGroups()[0].channelGroups[0].channels;

        const timeBuf = makeBuffer();
        const signalBuf = makeBuffer();

        await mdf.read([
            { channel: channels.find(c => c.name === 'Time')!, buffer: timeBuf },
            { channel: channels.find(c => c.name === 'Signal')!, buffer: signalBuf },
        ]);

        expect(timeBuf.values).toEqual([0, 1, 2]);
        expect(signalBuf.values).toEqual([10, 20, 30]);
    });

    it('benchmark: read 1 signal from group with 100 channels', async () => {
        const rowCount = 10_000;
        const channelCount = 100;
        const values = Array.from({ length: rowCount }, (_, i) => i * 0.01);

        const file = await createMdf4File([
            {
                name: 'BenchGroup',
                channels: [
                    { name: 'Time', type: 'time', dataType: DataType.FloatLe, bitCount: 32, values },
                    ...Array.from({ length: channelCount - 1 }, (_, i) => ({
                        name: `Signal${i}`,
                        type: 'signal' as const,
                        dataType: DataType.FloatLe,
                        bitCount: 32,
                        values,
                    })),
                ],
            },
        ]);

        const mdf = await openMdfFile(file);
        const channels = mdf.getGroups()[0].channelGroups[0].channels;
        const targetChannel = channels.find(c => c.name === 'Signal0')!;
        const timeChannel = channels.find(c => c.channelType === ChannelType.Time)!;

        const timeBuf = makeBuffer();
        const targetBuf = makeBuffer();

        const start = performance.now();
        await mdf.read([
            { channel: timeChannel, buffer: timeBuf },
            { channel: targetChannel, buffer: targetBuf },
        ]);
        const duration = performance.now() - start;

        console.log(`Read 1/${channelCount} signals, ${rowCount} rows: ${duration.toFixed(1)} ms`);
        expect(duration).toBeGreaterThan(0);
    });
});
