import type { TimeValueBuffer } from './timeValueBuffer';

export interface DownsampleResult {
    hasMore: boolean;
    overwriteNext?: boolean;
}

export interface Downsampler extends Generator<DownsampleResult, void, void> {
    buffer: TimeValueBuffer;
}
