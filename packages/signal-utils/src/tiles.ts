import type { Signal, Tile, Sample } from '@voltex-viewer/plugin-api';

/** Whether every sample in the tile's range is in the tile. */
export function isRawTile(tile: Tile): boolean {
    return tile.samples === tile.time.length;
}

export function tileSample(tile: Tile, i: number): Sample {
    const point: Sample = { time: tile.time[i], value: tile.value[i] };
    if (tile.exact) point.exact = tile.exact[i];
    return point;
}

/** The form of a sample to display, before formatting as hex or decimal. */
export function displayValue(signal: Signal, point: Sample): number | bigint | string {
    const value = point.exact ?? point.value;
    return signal.format ? signal.format(value) : value;
}
