import * as t from 'io-ts';

// Config schema for WaveformRenderer
export const WaveformConfigSchema = t.type({
    dotSize: t.number,
    lineWidth: t.number,
    targetFps: t.number,
    hoverEnabled: t.boolean,
    formatTooltip: t.string,
    downsamplingMode: t.union([
        t.literal('aggressive'),
        t.literal('normal'),
        t.literal('lossless'),
        t.literal('off')
    ]),
});

export type WaveformConfig = t.TypeOf<typeof WaveformConfigSchema>;
