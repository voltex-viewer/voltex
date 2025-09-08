import * as t from 'io-ts';

// Config schema for WaveformRenderer
export const WaveformConfigSchema = t.type({
    dotSize: t.number,
    lineWidth: t.number,
    targetFps: t.number,
    hoverEnabled: t.boolean,
    formatTooltip: t.string,
});

export type WaveformConfig = t.TypeOf<typeof WaveformConfigSchema>;
