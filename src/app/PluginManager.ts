import type { PluginModule, PluginContext, SignalMetadataManager, RowsChangedCallback, SidebarEntryArgs, PluginFunction, PluginMetadata, SignalSourceManager, SignalSource, Row, RowParameters, RowInsert, ReadOnlyRenderProfiler, FileOpenHandler, FileSaveHandler, RenderObjectArgs, Command } from '@voltex-viewer/plugin-api';
import { RenderObjectImpl } from './RenderObject';
import type { WebGlContext, WaveformState } from "@voltex-viewer/plugin-api";
import { RowChangedEvent } from './RowManager';
import { PluginConfigManager } from './PluginConfigManager';
import { CommandManager } from './CommandManager';
import type { RenderProfiler } from './RenderProfiler';
import * as t from 'io-ts';
import { RowContainerRenderObject } from './RowContainerRenderObject';
import { RowImpl } from './RowImpl';

interface ActivePlugin {
    pluginFunction: PluginFunction;
    metadata: PluginMetadata;
    context: PluginContext;
}

interface PluginSignalSourceManager extends SignalSourceManager {
    add(...signals: SignalSource[]): void;
    remove(...signals: SignalSource[]): void;
}

interface PluginData {
    rowsChangedCallbacks: RowsChangedCallback[];
    beforeRenderCallbacks: (() => boolean)[];
    afterRenderCallbacks: (() => boolean)[];
    sidebarEntries: SidebarEntryArgs[];
    sidebarEntryInstances: import('./VerticalSidebar').SidebarEntry[];
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
        private onSidebarEntryAdded: (entry: SidebarEntryArgs) => import('./VerticalSidebar').SidebarEntry,
        private onSidebarEntryRemoved: (entry: import('./VerticalSidebar').SidebarEntry) => void,
        private requestRender: () => void,
        private renderProfiler: RenderProfiler,
        private configManager: PluginConfigManager,
        private commandManager: CommandManager,
    ) {
        rowManager.onChange((event: RowChangedEvent) => {
            this.onRowsChanged(event);
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

    enablePlugin(pluginModule: PluginModule): ActivePlugin {
        const existingPlugin = this.plugins.find(p => p.metadata.name === pluginModule.metadata.name);
        if (existingPlugin) {
            return existingPlugin;
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
                );
                const addedRows = this.rowManager.spliceRows(actualRowsToRemove, rowsToAdd);
                return addedRows.map(row => this.createProxyRow(plugin, row));
            },
            getRows: (): Row[] => {
                const allRows = this.rowManager.getAllRows();
                return allRows.map(row => this.createProxyRow(plugin, row));
            },
            loadConfig: <T>(schema: t.Type<T>, defaultConfig: T): T => {
                return this.configManager.loadConfig<T>(plugin.metadata.name, schema, defaultConfig);
            },
            getEnvironment: (): 'electron' | 'browser' => {
                // Check if we're in a browser environment first
                if (typeof window === 'undefined') {
                    return 'browser';
                }

                // Primary check: Electron exposes process.type === 'renderer' in the renderer process
                if (typeof (window as any).process === 'object' && 
                    (window as any).process.type === 'renderer') {
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
            pluginModule.plugin(context);
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
        
        if (data.signalSources.length > 0) {
            this.signalSources.remove(...data.signalSources);
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
        let sidebarEntry: import('./VerticalSidebar').SidebarEntry | undefined;
        
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
        const self = this;
        return {
            get available() {
                return self.signalSources.available;
            },
            changed: (callback) => {
                self.signalSources.changed(callback);
            },
            add: (...signals: SignalSource[]) => {
                const data = self.pluginData.get(plugin);
                if (data) {
                    data.signalSources.push(...signals);
                }
                
                self.signalSources.add(...signals);
            },
            remove: (...signals: SignalSource[]) => {
                const data = self.pluginData.get(plugin);
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
                
                self.signalSources.remove(...signals);
            }
        };
    }

    onBeforeRender(profiler: ReadOnlyRenderProfiler): boolean {
        let needsMoreRender = false;
        for (const plugin of this.plugins) {
            for (const callback of this.pluginData.get(plugin).beforeRenderCallbacks) {
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
            for (const callback of this.pluginData.get(plugin).afterRenderCallbacks) {
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
        const self = this;
        return {
            get lastFrame() {
                return self.renderProfiler.lastFrame;
            },
            getFilteredFrameRenderTime(): number {
                return self.renderProfiler.getFilteredFrameRenderTime();
            },
            startMeasure(name: string): void {
                self.renderProfiler.startMeasure(name);
            },
            endMeasure(): void {
                self.renderProfiler.endMeasure();
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
                for (const handler of this.pluginData.get(plugin).fileExtensionHandlers) {
                    if (handler.extensions.some(ext => ext.toLowerCase() === fileExtension)) {
                        try {
                            await handler.handler(file);
                            handled = true;
                        } catch (error) {
                            fileErrors.push(`Error in plugin ${plugin.metadata.name} while handling file ${file.name}: ${error.message}`);
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
        const individualTypes = this.plugins.flatMap(plugin =>
            this.pluginData.get(plugin).fileExtensionHandlers.map(handler => ({
                description: handler.description,
                accept: { [handler.mimeType]: handler.extensions }
            }))
        );

        if (individualTypes.length === 0) {
            return [];
        }

        const allExtensions = individualTypes.flatMap(type => 
            Object.values(type.accept).flat()
        );

        const allSupportedFiles: FilePickerAcceptType = {
            description: 'All Supported Files',
            accept: { '*/*': allExtensions }
        };

        return [allSupportedFiles, ...individualTypes];
    }

    async handleFileSave(name: string, file: FileSystemWritableFileStream): Promise<boolean> {
        let fileExtension = name.split('.').pop()?.toLowerCase();
        if (!fileExtension) {
            return false;
        }
        fileExtension = `.${fileExtension}`;

        for (const plugin of this.plugins) {
            for (const handler of this.pluginData.get(plugin).fileSaveHandlers) {
                if (handler.extensions.some(ext => ext.toLowerCase() === fileExtension)) {
                    await handler.handler(file);
                    return true;
                }
            }
        }

        return false;
    }

    getFileSaveTypes(): FilePickerAcceptType[] {
        return this.plugins.flatMap(plugin =>
            this.pluginData.get(plugin).fileSaveHandlers.map(handler => ({
                description: handler.description,
                accept: { [handler.mimeType]: handler.extensions }
            }))
        );
    }

    executeKeybinding(keybinding: string): boolean {
        return this.commandManager.executeCommand(keybinding);
    }
}
