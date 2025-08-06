import type { WaveformState } from './WaveformState';
import type { SignalParams } from './SignalParams';
import type { RenderObject, WebGlContext } from './RenderObject';
import type { SignalMetadataManager } from './SignalMetadataManager';
import { Signal } from './Signal';
import * as t from 'io-ts';

export interface Row {
    readonly height: number;
    readonly signals: Signal[];
    readonly addRenderObject: (renderObject: RenderObject) => void;
    readonly yScale: number;
    readonly yOffset: number;
    addLabelRenderObject(renderObject: RenderObject): void;
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

export interface PluginContext {
    state: WaveformState;
    signal: SignalParams;
    webgl: WebGlContext;
    signalMetadata: SignalMetadataManager;
    signalSources: SignalSourceManager;
    onRowsChanged(callback: RowsChangedCallback): void;
    onRender(callback: () => boolean): void;
    addSidebarEntry(entry: SidebarEntry): void;
    requestRender(): void;
    createRows(...rows: RowParameters[]): Row[];
    spliceRows(rowsToRemove: Row[], rowsToAdd: RowInsert[]): Row[];
    getRows(): Row[];
    loadConfig<T>(schema: t.Type<T>, defaultConfig: T): T;
    getEnvironment(): 'electron' | 'browser';
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
