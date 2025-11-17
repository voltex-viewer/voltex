import { RenderMode } from '@voltex-viewer/plugin-api';
import type { SerializableConversionData } from './serializableConversion';
import type { NumberType } from './decoder';

export interface SignalMetadata {
    name: string[];
    conversion: SerializableConversionData;
    renderMode: RenderMode;
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
    length: number;
} | {
    type: 'signalLoadingProgress';
    signalId: number;
    timeBuffer?: SharedArrayBuffer;
    valuesBuffer?: SharedArrayBuffer;
    length: number;
} | {
    type: 'signalLoadingComplete';
    signalId: number;
    timeBuffer?: SharedArrayBuffer;
    valuesBuffer?: SharedArrayBuffer;
    length: number;
} | {
    type: 'error';
    error: string;
}
