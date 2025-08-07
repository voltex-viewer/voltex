import * as t from 'io-ts';

export enum RenderMode {
    Lines = 'lines',
    LinesDots = 'lines-dots',
    Dots = 'dots',
    Enum = 'enum',
}

// Config schema for WaveformRenderer
export const WaveformConfigSchema = t.type({
    renderMode: t.union([
        t.literal(RenderMode.Lines),
        t.literal(RenderMode.LinesDots),
        t.literal(RenderMode.Dots),
        t.literal(RenderMode.Enum)
    ]),
    dotSize: t.number,
    lineWidth: t.number,
    targetFps: t.number,
});

export type WaveformConfig = t.TypeOf<typeof WaveformConfigSchema>;
