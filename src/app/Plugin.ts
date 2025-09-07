import type { WaveformState } from './WaveformState';
import type { RenderObject, WebGlContext } from './RenderObject';
import type { SignalMetadataManager } from './SignalMetadataManager';
import { Signal } from './Signal';
import * as t from 'io-ts';

export enum RenderMode {
    Lines = 'lines',
    LinesDots = 'lines-dots',
    Dots = 'dots',
    Enum = 'enum',
}

export interface MeasureInfo {
    name: string;
    startTime: number;
    endTime: number;
}

export interface FrameInfo {
    startTime: number;
    endTime: number;
    frameTime: number;
    measures: MeasureInfo[][];
}

export interface ReadOnlyRenderProfiler {
    readonly lastFrame: FrameInfo | null;
    getFilteredFrameRenderTime(): number;
    startMeasure(name: string): void;
    endMeasure(): void;
}

export interface Row {
    readonly height: number;
    readonly signals: Signal[];
    readonly addRenderObject: (renderObject: RenderObject) => void;
    readonly yScale: number;
    readonly yOffset: number;
    readonly addLabelRenderObject: (renderObject: RenderObject) => void;
    readonly selected: boolean;
    readonly renderMode: RenderMode;
    setHeight(height: number): void;
}

export interface SignalSource {
    name: string[];
    signal(): Signal;
    discrete: boolean;
}

export interface RowsChangedEvent {
    added: Row[];
    removed: Row[];
}

export interface SignalsAvailableChangedEvent {
    added: SignalSource[];
    removed: SignalSource[];
}

export interface SignalSourceManager {
    available: SignalSource[];

    changed(callback: (event: SignalsAvailableChangedEvent) => void): void;

    add(...signals: SignalSource[]): void;
    remove(...signals: SignalSource[]): void;
}

export type RowsChangedCallback = (event: RowsChangedEvent) => void;
export type SignalsAvailableChangedCallback = (event: SignalsAvailableChangedEvent) => void;

export interface SidebarEntry {
    title: string;
    iconHtml: string;
    renderContent(): string | HTMLElement;
}

export interface RowParameters {
    channels?: Signal[];
    height?: number;
}

export interface RowInsert {
    index: number;
    row: RowParameters;
}

export interface FileHandler {
    extensions: `.${string}`[];
    description: string;
    mimeType: `${string}/${string}`;
    handler: (file: File) => Promise<void>;
}

export interface FileSaveHandler {
    extensions: `.${string}`[];
    description: string;
    mimeType: `${string}/${string}`;
    handler: (file: FileSystemWritableFileStream) => Promise<void>;
}

export interface PluginContext {
    state: WaveformState;
    webgl: WebGlContext;
    signalMetadata: SignalMetadataManager;
    signalSources: SignalSourceManager;
    renderProfiler: ReadOnlyRenderProfiler;
    onRowsChanged(callback: RowsChangedCallback): void;
    onBeforeRender(callback: () => boolean): void;
    onAfterRender(callback: () => boolean): void;
    addSidebarEntry(entry: SidebarEntry): void;
    addRootRenderObject(renderObject: RenderObject): void;
    removeRootRenderObject(renderObject: RenderObject): void;
    requestRender(): void;
    createRows(...rows: RowParameters[]): Row[];
    spliceRows(rowsToRemove: Row[], rowsToAdd: RowInsert[]): Row[];
    getRows(): Row[];
    loadConfig<T>(schema: t.Type<T>, defaultConfig: T): T;
    getEnvironment(): 'electron' | 'browser';
    registerFileOpenHandler(handler: FileHandler): void;
    registerFileSaveHandler(handler: FileSaveHandler): void;
}

export interface PluginMetadata {
    name: string;
    version: string;
    description?: string;
    author?: string;
}

export type PluginFunction = (context: PluginContext) => void;

export interface PluginModule {
    plugin: PluginFunction;
    metadata: PluginMetadata;
}
