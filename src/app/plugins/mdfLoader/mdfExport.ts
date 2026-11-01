import type { Signal } from '@voltex-viewer/plugin-api';
import { rawSamples } from '@voltex-viewer/signal-utils';
import { v4 } from '@voltex-viewer/mdf-reader';

interface Samples {
    time: Float64Array;
    value: Float64Array;
    // Set when every sample has an exact 64-bit value equal to the plotted one, so it can be written as an integer
    exact: BigInt64Array | BigUint64Array | null;
}

async function collectSamples(signal: Signal): Promise<Samples> {
    const times: Float64Array[] = [];
    const values: Float64Array[] = [];
    const exacts: (BigInt64Array | BigUint64Array)[] = [];
    let allExact = true;
    for await (const chunk of rawSamples(signal)) {
        times.push(chunk.time);
        values.push(chunk.value);
        if (chunk.exact) exacts.push(chunk.exact);
        else allExact = false;
    }
    const length = times.reduce((sum, t) => sum + t.length, 0);
    const time = new Float64Array(length);
    const value = new Float64Array(length);
    let offset = 0;
    for (let i = 0; i < times.length; i++) {
        time.set(times[i], offset);
        value.set(values[i], offset);
        offset += times[i].length;
    }

    let exact: BigInt64Array | BigUint64Array | null = null;
    if (allExact && exacts.length > 0) {
        const signed = exacts.some(e => e instanceof BigInt64Array);
        exact = signed ? new BigInt64Array(length) : new BigUint64Array(length);
        offset = 0;
        for (const e of exacts) {
            for (let i = 0; i < e.length; i++) exact[offset + i] = e[i];
            offset += e.length;
        }
        // A numeric conversion would be lost writing the stored integer, so the plotted value is written instead
        for (let i = 0; i < length && exact; i++) {
            if (Number(exact[i]) !== value[i]) exact = null;
        }
    }
    return { time, value, exact };
}

// Values the signal shows as text, so they survive as a value to text conversion
function buildConversion(signal: Signal, samples: Samples): v4.ChannelConversionBlock<'instanced'> | null {
    if (!signal.format) return null;
    const valueToText = new Map<number, string>();
    for (let i = 0; i < samples.value.length; i++) {
        const raw = samples.exact ? Number(samples.exact[i]) : samples.value[i];
        if (valueToText.has(raw)) continue;
        const converted = signal.format(samples.exact ? samples.exact[i] : samples.value[i]);
        if (typeof converted === 'string') valueToText.set(raw, converted);
    }
    if (valueToText.size === 0) return null;

    const values: number[] = [];
    const refs: (v4.TextBlock | null)[] = [];
    for (const [value, text] of valueToText) {
        values.push(value);
        refs.push({ data: text });
    }
    refs.push(null);

    return {
        type: v4.ConversionType.ValueToTextOrScale,
        values,
        refs,
        txName: null,
        mdUnit: null,
        mdComment: null,
        inverse: null,
        precision: 0,
        flags: 0,
        physicalRangeMinimum: 0,
        physicalRangeMaximum: 0,
    } satisfies v4.ChannelConversionBlock<'instanced'>;
}

function channel(name: string, index: number, dataType: v4.DataType, conversion: v4.ChannelConversionBlock<'instanced'> | null): v4.ChannelBlock<'instanced'> {
    return {
        channelNext: null,
        component: null,
        txName: { data: name },
        siSource: null,
        conversion,
        data: null,
        unit: null,
        comment: null,
        channelType: index == 0 ? 2 : 0,
        syncType: index == 0 ? 1 : 0,
        dataType,
        bitOffset: 0,
        byteOffset: index * 8,
        bitCount: 64,
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
    } as v4.ChannelBlock<'instanced'>;
}

// One channel group per signal, with its own time channel
async function buildDataGroup(signal: Signal): Promise<v4.DataGroupBlock<'instanced'>> {
    const samples = await collectSamples(signal);
    const length = samples.time.length;
    const prefix = signal.source.name.slice(0, -1);
    const name = signal.source.name[signal.source.name.length - 1];

    const valueType = samples.exact instanceof BigUint64Array ? v4.DataType.UintLe
        : samples.exact instanceof BigInt64Array ? v4.DataType.IntLe
        : v4.DataType.FloatLe;
    const timeChannel = channel('time', 0, v4.DataType.FloatLe, null);
    const valueChannel = channel(name, 1, valueType, buildConversion(signal, samples));
    timeChannel.channelNext = valueChannel;

    const recordBytes = 16;
    const maxBytesPerArray = 65536 - 24; // 64 KB block size minus header
    const samplesPerArray = Math.floor(maxBytesPerArray / recordBytes);
    const arrays: v4.DataTableBlock[] = [];
    for (let start = 0; start < length; start += samplesPerArray) {
        const end = Math.min(start + samplesPerArray, length);
        const view = new DataView(new ArrayBuffer((end - start) * recordBytes));
        for (let i = start; i < end; i++) {
            const offset = (i - start) * recordBytes;
            view.setFloat64(offset, samples.time[i], true);
            if (samples.exact instanceof BigUint64Array) view.setBigUint64(offset + 8, samples.exact[i], true);
            else if (samples.exact instanceof BigInt64Array) view.setBigInt64(offset + 8, samples.exact[i], true);
            else view.setFloat64(offset + 8, samples.value[i], true);
        }
        arrays.push({ data: view });
    }

    return {
        dataGroupNext: null,
        channelGroupFirst: {
            channelGroupNext: null,
            channelFirst: timeChannel,
            acquisitionName: {
                data: prefix.join('.'),
            },
            acquisitionSource: null,
            sampleReductionFirst: null,
            comment: null,
            recordId: 0n,
            cycleCount: BigInt(length),
            flags: 0,
            pathSeparator: 0,
            dataBytes: recordBytes,
            invalidationBytes: 0,
        },
        data: arrays.length == 1 ? arrays[0] : {
            dataListNext: null,
            data: arrays,
            flags: 0,
        } as v4.DataListBlock<'instanced'>,
        comment: null,
        recordIdSize: 0,
    } as v4.DataGroupBlock<'instanced'>;
}

export async function buildMdfHeader(signals: Signal[], now: bigint): Promise<v4.Header<'instanced'>> {
    const dataGroups: v4.DataGroupBlock<'instanced'>[] = [];
    for (const signal of signals) {
        dataGroups.push(await buildDataGroup(signal));
    }
    for (let i = 1; i < dataGroups.length; i++) {
        dataGroups[i - 1].dataGroupNext = dataGroups[i];
    }
    return {
        firstDataGroup: dataGroups[0] ?? null,
        fileHistory: {
            fileHistoryNext: null,
            comment: {
                data: `<FHcomment xmlns='http://www.asam.net/mdf/v4'><TX>File was created.</TX><tool_id>Voltex</tool_id><tool_vendor>Voltex</tool_vendor><tool_version>1.0</tool_version><user_name>User</user_name></FHcomment>`,
            },
            time: now,
            timeZone: 0,
            dstOffset: 0,
            timeFlags: 0,
        },
        channelHierarchy: null,
        attachment: null,
        event: null,
        comment: null,
        startTime: now,
        timeZone: 0,
        dstOffset: 0,
        timeFlags: 0,
        timeQuality: 0,
        flags: 0,
        startAngle: 0n,
        startDistance: 0n,
    };
}
