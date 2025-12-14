import type { PluginModule, PluginContext, SignalMetadataManager, RowsChangedCallback, SidebarEntryArgs, PluginFunction, PluginMetadata, SignalSourceManager, SignalSource, Row, RowParameters, RowInsert, ReadOnlyRenderProfiler, FileOpenHandler, FileSaveHandler, Command, WritableFile } from '@voltex-viewer/plugin-api';
import { RenderObjectImpl } from './renderObject';
import type { WebGlContext, WaveformState } from "@voltex-viewer/plugin-api";
import { RowChangedEvent } from './rowManager';
import { PluginConfigManager } from './pluginConfigManager';
import { CommandManager } from './commandManager';
import type { RenderProfiler } from './renderProfiler';
import * as t from 'io-ts';
import { RowContainerRenderObject } from './rowContainerRenderObject';
import { RowImpl } from './rowImpl';
import { bigPush } from './bigPush';
import { SidebarEntryImpl } from './verticalSidebar';

interface ActivePlugin {
    pluginFunction: PluginFunction;
    metadata: PluginMetadata;
    context: PluginContext;
}

interface PluginSignalSourceManager extends SignalSourceManager {
    add(signals: SignalSource[]): void;
    remove(signals: SignalSource[]): void;
}

interface PluginData {
    rowsChangedCallbacks: RowsChangedCallback[];
    configChangedCallbacks: ((pluginName: string, newConfig: unknown) => void)[];
    beforeRenderCallbacks: (() => boolean)[];
    afterRenderCallbacks: (() => boolean)[];
    sidebarEntries: SidebarEntryArgs[];
    sidebarEntryInstances: SidebarEntryImpl[];
    renderObjects: RenderObjectImpl[];
    signalSources: SignalSource[];
    rowProxyCache: Map<RowImpl, Row>; // Cache proxy rows to maintain identity
    proxyToActualRowMap: Map<Row, RowImpl>; // Map proxy rows back to actual rows
    fileExtensionHandlers: FileOpenHandler[];
    fileSaveHandlers: FileSaveHandler[];
}

export class PluginManager {
    private plugins: ActivePlugin[] = [];
    private availablePlugins: PluginModule[] = [];
    private pluginData: Map<ActivePlugin, PluginData> = new Map();
    private pluginRegisteredCallbacks: (() => void)[] = [];

    constructor(
        private state: WaveformState,
        private webgl: WebGlContext,
        private signalMetadata: SignalMetadataManager,
        private signalSources: SignalSourceManager,
        private rowManager: RowContainerRenderObject,
        private rootRenderObject: RenderObjectImpl,
        private onSidebarEntryAdded: (entry: SidebarEntryArgs) => SidebarEntryImpl,
        private onSidebarEntryRemoved: (entry: SidebarEntryImpl) => void,
        private requestRender: () => void,
        private renderProfiler: RenderProfiler,
        private configManager: PluginConfigManager,
        private commandManager: CommandManager,
    ) {
        rowManager.onChange((event: RowChangedEvent) => {
            this.onRowsChanged(event);
        });

        configManager.onConfigChanged((pluginName, newConfig, _oldConfig) => {
            this.notifyConfigChanged(pluginName, newConfig);
        });
    }

    registerPluginType(pluginModule: PluginModule): void {
        this.availablePlugins.push(pluginModule);
        
        for (const callback of this.pluginRegisteredCallbacks) {
            callback();
        }
    }

    unregisterPluginType(pluginName: string): boolean {
        const index = this.availablePlugins.findIndex(p => p.metadata.name === pluginName);
        if (index === -1) {
            return false;
        }
        
        this.availablePlugins.splice(index, 1);
        
        for (const callback of this.pluginRegisteredCallbacks) {
            callback();
        }
        
        return true;
    }

    onPluginRegistered(callback: () => void): void {
        this.pluginRegisteredCallbacks.push(callback);
    }

    async enablePlugin(pluginModule: PluginModule): Promise<ActivePlugin> {
        const existingPlugin = this.plugins.find(p => p.metadata.name === pluginModule.metadata.name);
        if (existingPlugin) {
            return Promise.resolve(existingPlugin);
        }
        
        const plugin: ActivePlugin = {
            pluginFunction: pluginModule.plugin,
            metadata: pluginModule.metadata,
            context: {} as PluginContext
        };
        
        const context: PluginContext = {
            state: this.state,
            webgl: this.webgl,
            signalMetadata: this.signalMetadata,
            signalSources: this.createPluginSignalSourceManager(plugin),
            renderProfiler: this.createReadOnlyRenderProfiler(),
            rootRenderObject: this.rootRenderObject,
            onRowsChanged: (callback: RowsChangedCallback) => {
                const data = this.pluginData.get(plugin)!;
                data.rowsChangedCallbacks.push(callback);
            },
            onConfigChanged: (callback: (pluginName: string, newConfig: unknown) => void) => {
                const data = this.pluginData.get(plugin)!;
                data.configChangedCallbacks.push(callback);
            },
            onBeforeRender: (callback: () => boolean) => {
                const data = this.pluginData.get(plugin)!;
                data.beforeRenderCallbacks.push(callback);
            },
            onAfterRender: (callback: () => boolean) => {
                const data = this.pluginData.get(plugin)!;
                data.afterRenderCallbacks.push(callback);
            },
            addSidebarEntry: (entry: SidebarEntryArgs) => {
                return this.addSidebarEntry(plugin, entry);
            },
            requestRender: () => {
                if (this.requestRender) {
                    this.requestRender();
                }
            },
            createRows: (...rows: RowParameters[]): Row[] => {
                const createdRows = this.rowManager.createRows(...rows);
                return createdRows.map(row => this.createProxyRow(plugin, row));
            },
            spliceRows: (rowsToRemove: Row[], rowsToAdd: RowInsert[]): Row[] => {
                const data = this.pluginData.get(plugin)!;
                // Map proxy rows back to actual rows for removal
                const actualRowsToRemove = rowsToRemove.map(proxyRow => 
                    data.proxyToActualRowMap.get(proxyRow)
                ).filter((row): row is RowImpl => row !== undefined);
                const addedRows = this.rowManager.spliceRows(actualRowsToRemove, rowsToAdd);
                return addedRows.map(row => this.createProxyRow(plugin, row));
            },
            getRows: (): Row[] => {
                const allRows = this.rowManager.getAllRows();
                return allRows.map(row => this.createProxyRow(plugin, row));
            },
            loadConfig: <A, O = A, I = unknown>(schema: t.Type<A, O, I>, defaultConfig: O): A => {
                return this.configManager.loadConfig<A, O, I>(plugin.metadata.name, schema, defaultConfig);
            },
            getEnvironment: (): 'electron' | 'browser' => {
                // Check if we're in a browser environment first
                if (typeof window === 'undefined') {
                    return 'browser';
                }

                // Primary check: Electron exposes process.type === 'renderer' in the renderer process
                const win = window as Window & { process?: { type?: string } };
                if (typeof win.process === 'object' && 
                    win.process?.type === 'renderer') {
                    return 'electron';
                }

                // Fallback check: User agent contains 'Electron'
                if (typeof navigator === 'object' && 
                    typeof navigator.userAgent === 'string' && 
                    navigator.userAgent.indexOf('Electron') >= 0) {
                    return 'electron';
                }

                return 'browser';
            },
            registerFileOpenHandler: (handler: FileOpenHandler) => {
                const data = this.pluginData.get(plugin)!;
                data.fileExtensionHandlers.push(handler);
            },
            registerFileSaveHandler: (handler: FileSaveHandler) => {
                const data = this.pluginData.get(plugin)!;
                data.fileSaveHandlers.push(handler);
            },
            registerCommand: (command: Command) => {
                this.commandManager.registerCommand(plugin.metadata.name, command);
            },
        };

        plugin.context = context;

        this.plugins.push(plugin);
        this.pluginData.set(plugin, {
            rowsChangedCallbacks: [],
            configChangedCallbacks: [],
            beforeRenderCallbacks: [],
            afterRenderCallbacks: [],
            sidebarEntries: [],
            sidebarEntryInstances: [],
            renderObjects: [],
            signalSources: [],
            rowProxyCache: new Map(),
            proxyToActualRowMap: new Map(),
            fileExtensionHandlers: [],
            fileSaveHandlers: [],
        });
        
        try {
            const result = pluginModule.plugin(context);
            if (typeof(result) === "object") {
                await result
            }
        } catch (error) {
            console.error(`Error occurred while initializing plugin ${plugin.metadata.name}:`, error);
        }
        
        // Notify plugin about existing rows
        const existingRows = this.rowManager.getAllRows();
        if (existingRows.length > 0) {
            const proxyRows = existingRows.map(row => this.createProxyRow(plugin, row));
            const data = this.pluginData.get(plugin)!;
            for (const callback of data.rowsChangedCallbacks) {
                try {
                    callback({ added: proxyRows, removed: [] });
                } catch (error) {
                    console.error(`Error in rowsChanged callback of plugin ${plugin.metadata.name}:`, error);
                }
            }
        }
        
        return plugin;
    }

    disablePlugin(plugin: ActivePlugin): void {
        const pluginIndex = this.plugins.indexOf(plugin);
        if (pluginIndex === -1) {
            return;
        }
        
        const data = this.pluginData.get(plugin);
        
        if (!data) {
            return;
        }
        
        if (data.signalSources.length > 0) {
            this.signalSources.remove(data.signalSources);
        }
        
        // Remove render objects from all rows before disposing
        for (const renderObject of data.renderObjects) {
            if (renderObject.dispose) {
                renderObject.dispose();
            }
            (renderObject.parent as RenderObjectImpl)?.removeChild(renderObject);
        }
        
        for (const instance of data.sidebarEntryInstances) {
            if (this.onSidebarEntryRemoved) {
                this.onSidebarEntryRemoved(instance);
            }
        }
        
        this.plugins.splice(pluginIndex, 1);
        this.pluginData.delete(plugin);
    }

    private onRowsChanged(event: RowChangedEvent): void {
        for (const plugin of this.plugins) {
            const data = this.pluginData.get(plugin);
            if (data && data.rowsChangedCallbacks.length > 0) {
                const proxyEvent = {
                    added: event.added.map(row => this.createProxyRow(plugin, row)),
                    removed: event.removed.map(row => this.createProxyRow(plugin, row))
                };
                for (const callback of data.rowsChangedCallbacks) {
                    try {
                        callback(proxyEvent);
                    } catch (error) {
                        console.error(`Error in rowsChanged callback of plugin ${plugin.metadata.name}:`, error);
                    }
                }
            }
        }
    }

    getPlugins(): ActivePlugin[] {
        return [...this.plugins];
    }

    getAvailablePlugins(): PluginModule[] {
        return [...this.availablePlugins];
    }

    private addSidebarEntry(plugin: ActivePlugin, entry: SidebarEntryArgs): import('@voltex-viewer/plugin-api').SidebarEntry {
        const data = this.pluginData.get(plugin);
        let sidebarEntry: SidebarEntryImpl | undefined;
        
        if (data) {
            data.sidebarEntries.push(entry);
            
            if (this.onSidebarEntryAdded) {
                const instance = this.onSidebarEntryAdded(entry);
                if (instance) {
                    data.sidebarEntryInstances.push(instance);
                    sidebarEntry = instance;
                }
            }
        }
        
        return {
            open: () => {
                if (sidebarEntry) {
                    sidebarEntry.open();
                }
            }
        };
    }

    private createPluginSignalSourceManager(plugin: ActivePlugin): PluginSignalSourceManager {
        const signalSources = this.signalSources;
        const pluginData = this.pluginData;
        return {
            get available() {
                return signalSources.available;
            },
            changed: (callback) => {
                signalSources.changed(callback);
            },
            add: (signals: SignalSource[]) => {
                const data = pluginData.get(plugin);
                if (data) {
                    bigPush(data.signalSources, signals);
                }
                
                signalSources.add(signals);
            },
            remove: (signals: SignalSource[]) => {
                const data = pluginData.get(plugin);
                if (data) {
                    for (const signal of signals) {
                        const index = data.signalSources.findIndex((s: SignalSource) => 
                            s.name.length === signal.name.length && 
                            s.name.every((part: string, i: number) => part === signal.name[i])
                        );
                        if (index !== -1) {
                            data.signalSources.splice(index, 1);
                        }
                    }
                }
                
                signalSources.remove(signals);
            }
        };
    }

    onBeforeRender(profiler: ReadOnlyRenderProfiler): boolean {
        let needsMoreRender = false;
        for (const plugin of this.plugins) {
            const data = this.pluginData.get(plugin);
            if (!data) continue;
            for (const callback of data.beforeRenderCallbacks) {
                profiler.startMeasure(`beforeRender-${plugin.metadata.name}`);
                if (callback()) {
                    needsMoreRender = true;
                }
                profiler.endMeasure();
            }
        }
        return needsMoreRender;
    }

    onAfterRender(profiler: ReadOnlyRenderProfiler): boolean {
        let needsMoreRender = false;
        for (const plugin of this.plugins) {
            const data = this.pluginData.get(plugin);
            if (!data) continue;
            for (const callback of data.afterRenderCallbacks) {
                profiler.startMeasure(`afterRender-${plugin.metadata.name}`);
                if (callback()) {
                    needsMoreRender = true;
                }
                profiler.endMeasure();
            }
        }
        return needsMoreRender;
    }

    private createProxyRow(plugin: ActivePlugin, row: RowImpl): Row {
        const data = this.pluginData.get(plugin)!;
        
        // Return cached proxy if it exists
        if (data.rowProxyCache.has(row)) {
            return data.rowProxyCache.get(row)!;
        }
        // TODO: Push to data.renderObjects when render objects are added to the row

        const proxyRow = {
            get height() {
                return row.height;
            },
            get signals() {
                return row.signals;
            },
            get yScale() {
                return row.yScale;
            },
            get yOffset() {
                return row.yOffset;
            },
            get mainArea() {
                return row.mainArea;
            },
            get labelArea() {
                return row.labelArea;
            },
            setHeight: (height: number) => {
                row.setHeight(height);
                this.requestRender();
            },
            get selected() {
                return row.selected;
            },
        };
        
        // Cache the proxy row and maintain reverse mapping
        data.rowProxyCache.set(row, proxyRow);
        data.proxyToActualRowMap.set(proxyRow, row);
        return proxyRow;
    }

    getConfigManager(): PluginConfigManager {
        return this.configManager;
    }

    private createReadOnlyRenderProfiler(): ReadOnlyRenderProfiler {
        const profiler = this.renderProfiler;
        return {
            get lastFrame() {
                return profiler.lastFrame;
            },
            getFilteredFrameRenderTime: (): number => {
                return this.renderProfiler.getFilteredFrameRenderTime();
            },
            startMeasure: (name: string): void => {
                this.renderProfiler.startMeasure(name);
            },
            endMeasure: (): void => {
                this.renderProfiler.endMeasure();
            }
        };
    }

    async loadFiles(...files: File[]): Promise<void> {
        const errors: string[] = [];
        for (const file of files) {
            let fileExtension = file.name.split('.').pop()?.toLowerCase();
            if (!fileExtension) {
                errors.push(`No extension for file: ${file.name}`);
                continue;
            }
            fileExtension = `.${fileExtension}`;

            const fileErrors: string[] = [];
            let handled = false;
            for (const plugin of this.plugins) {
                const data = this.pluginData.get(plugin);
                if (!data) continue;
                for (const handler of data.fileExtensionHandlers) {
                    if (handler.extensions.some(ext => ext.toLowerCase() === fileExtension)) {
                        try {
                            await handler.handler(file);
                            handled = true;
                        } catch (error) {
                            console.error(error);
                            const errorMessage = error instanceof Error ? error.message : String(error);
                            fileErrors.push(`Error in plugin ${plugin.metadata.name} while handling file ${file.name}: ${errorMessage}`);
                        }
                    }
                }
            }
            if (!handled) {
                if (fileErrors.length === 0) {
                    fileErrors.push(`No plugin found to handle file: ${file.name}`);
                }
                errors.push(...fileErrors);
            }
        }
        if (errors.length > 0) {
            alert(`Errors occurred while loading file(s):\n${errors.join('\n')}`);
        }
    }

    getFileOpenTypes(): FilePickerAcceptType[] {
        // Collect all handlers and group by extensions
        const extensionMap = new Map<string, { description: string; mimeType: `${string}/${string}`; extensions: `.${string}`[] }>();
        
        for (const plugin of this.plugins) {
            const data = this.pluginData.get(plugin);
            if (!data) continue;
            for (const handler of data.fileExtensionHandlers) {
                const key = handler.extensions.map(e => e.toLowerCase()).sort().join(',');
                if (!extensionMap.has(key)) {
                    extensionMap.set(key, {
                        description: handler.description,
                        mimeType: handler.mimeType,
                        extensions: handler.extensions
                    });
                }
            }
        }

        const individualTypes = Array.from(extensionMap.values()).map(handler => ({
            description: handler.description,
            accept: { [handler.mimeType]: handler.extensions } as Record<`${string}/${string}`, `.${string}`[]>
        }));

        if (individualTypes.length === 0) {
            return [];
        }

        const allExtensions = individualTypes.flatMap(type => 
            Object.values(type.accept).flat()
        ) as `.${string}`[];

        const allSupportedFiles: FilePickerAcceptType = {
            description: 'All Supported Files',
            accept: { '*/*': allExtensions }
        };

        return [allSupportedFiles, ...individualTypes];
    }

    async handleFileSave(name: string, file: WritableFile): Promise<boolean> {
        let fileExtension = name.split('.').pop()?.toLowerCase();
        if (!fileExtension) {
            return false;
        }
        fileExtension = `.${fileExtension}`;

        for (const plugin of this.plugins) {
            const data = this.pluginData.get(plugin);
            if (!data) continue;
            for (const handler of data.fileSaveHandlers) {
                if (handler.extensions.some(ext => ext.toLowerCase() === fileExtension)) {
                    await handler.handler(file);
                    return true;
                }
            }
        }

        return false;
    }

    getFileSaveTypes(): FilePickerAcceptType[] {
        return this.plugins.flatMap(plugin => {
            const data = this.pluginData.get(plugin);
            if (!data) return [];
            return data.fileSaveHandlers.map(handler => ({
                description: handler.description,
                accept: { [handler.mimeType]: handler.extensions }
            }));
        });
    }

    executeKeybinding(keybinding: string): boolean {
        return this.commandManager.executeCommand(keybinding);
    }

    notifyConfigChanged(pluginName: string, newConfig: unknown): void {
        const plugin = this.plugins.find(p => p.metadata.name === pluginName);
        if (!plugin) return;

        const data = this.pluginData.get(plugin);
        if (!data) return;

        for (const callback of data.configChangedCallbacks) {
            try {
                callback(pluginName, newConfig);
            } catch (error) {
                console.error(`Error in configChanged callback of plugin ${plugin.metadata.name}:`, error);
            }
        }
    }
}
