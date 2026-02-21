import { RenderMode } from '@voltex-viewer/plugin-api';
import type { SerializableConversionData, NumberType } from '@voltex-viewer/mdf-reader';

export interface SignalMetadata {
    name: string[];
    signalId: number;
    timeSequenceType: NumberType;
    valuesSequenceType: NumberType;
}

export type WorkerMessage = {
    type: 'loadFile';
    file: File;
} | {
    type: 'loadSignal';
    signalId: number;
}

export type WorkerResponse = {
    type: 'fileLoaded';
    signals: SignalMetadata[];
    fileName: string;
} | {
    type: 'fileLoadingProgress';
    channelCount: number;
} | {
    type: 'signalLoadingStarted';
    signalId: number;
    timeBuffer: SharedArrayBuffer;
    valuesBuffer: SharedArrayBuffer;
    timeConversion: SerializableConversionData;
    valuesConversion: SerializableConversionData;
    timeUnit: string | null| null;
    valueUnit: string | null;
    renderMode: RenderMode;
} | {
    type: 'signalLoadingComplete';
    signalId: number;
} | {
    type: 'error';
    error: string;
}
