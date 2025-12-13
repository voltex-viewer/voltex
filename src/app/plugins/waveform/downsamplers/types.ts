export interface DownsampleResult {
    bufferOffset: number;
    hasMore: boolean;
    overwriteNext?: boolean;
}

export interface Downsampler extends Generator<DownsampleResult, void, void> {
    timeBuffer: Float32Array;
    valueBuffer: Float32Array;
}
