import { getAvailablePlugins } from '..';
import type { PluginContext, SidebarEntryArgs } from '@voltex-viewer/plugin-api';
import type { PluginManager } from '../../pluginManager';
import { ConfigUIGenerator } from './configUIGenerator';
import * as t from 'io-ts';
import { CustomPluginStorage } from './customPluginStorage';
import { VxpkgLoader } from './vxpkgLoader';
import { GitHubReleaseLoader } from './gitHubReleaseLoader';
import { RegistryClient, type RegistryPlugin } from './registryClient';

const pluginManagerConfigSchema = t.type({
    enabledPlugins: t.record(t.string, t.boolean)
});

type PluginManagerConfig = t.TypeOf<typeof pluginManagerConfigSchema>;

let pluginManager: PluginManager | undefined;
let sidebarContainer: HTMLElement | undefined;
let context: PluginContext | undefined;
let config: PluginManagerConfig;
let customPluginStorage: CustomPluginStorage;
const customPluginNames = new Set<string>();
const availableUpdates = new Map<string, string>();
const installingPlugins = new Set<string>();
let currentlyDisplayedPluginName: string | null = null;

const registriesStorageKey = 'voltex-registries';

function loadRegistries(): string[] {
    try {
        const raw = localStorage.getItem(registriesStorageKey);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed.filter((u): u is string => typeof u === 'string') : [];
    } catch {
        return [];
    }
}

function saveRegistries(urls: string[]): void {
    localStorage.setItem(registriesStorageKey, JSON.stringify(urls));
}

export default (pluginContext: PluginContext): void => {
    context = pluginContext;
    
    config = context.loadConfig(pluginManagerConfigSchema, {
        enabledPlugins: {
            '@voltex-viewer/fps-plugin': false,
            '@voltex-viewer/demo-signals-plugin': false,
            '@voltex-viewer/profiler-plugin': false,
            '@voltex-viewer/mdf-block-viewer-plugin': false,
        }
    });

    customPluginStorage = new CustomPluginStorage();
    
    // Register file handler for .vxpkg files
    context.registerFileOpenHandler({
        extensions: ['.vxpkg'],
        description: 'Voltex Plugin Package',
        mimeType: 'application/zip',
        handler: async (file: File) => {
            await handleVxpkgUpload(file);
            return [];
        }
    });
    
    // Register command to check for updates
    context.registerCommand({
        id: 'checkForUpdates',
        action: () => {
            checkForUpdates();
        }
    });
    
    const sidebarEntry: SidebarEntryArgs = {
        title: 'Plugin Manager',
        iconHtml: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" title="Plugin Manager">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
            <path d="M9 12l2 2 4-4"/>
            <circle cx="12" cy="12" r="2"/>
        </svg>`,
        renderContent: renderContent
    };
    
    context.addSidebarEntry(sidebarEntry);
}

export async function setPluginManager(manager: PluginManager): Promise<void> {
    pluginManager = manager;
    
    // Load custom plugins from OPFS, then restore states
    await loadCustomPlugins();

    // Register all available plugins with the plugin manager
    const availablePlugins = getAvailablePlugins();
    for (const plugin of availablePlugins) {
        pluginManager.registerPluginType(plugin);
    }
    
    // Apply saved plugin states from config (after custom plugins are loaded)
    await restorePluginStates();
    
    refreshPluginList();
    
    // Register to be notified when new plugins are registered
    pluginManager.onPluginRegistered(() => {
        refreshPluginList();
    });
    
    // Listen for config changes to update the currently displayed config view
    pluginManager.getConfigManager().onConfigChanged((pluginName) => {
        if (currentlyDisplayedPluginName === pluginName && sidebarContainer && pluginManager) {
            const configContent = sidebarContainer.querySelector('#config-content') as HTMLElement;
            const configUI = configContent?.querySelector('.config-ui-root') as HTMLElement;
            const configSchema = pluginManager.getConfigManager().getConfigSchema(pluginName);
            
            if (configUI && configSchema) {
                ConfigUIGenerator.updateConfigUI(configUI, configSchema);
            }
        }
    });
}

async function loadCustomPlugins(): Promise<void> {
    if (!pluginManager || !customPluginStorage) return;
    
    try {
        const plugins = await customPluginStorage.getAllPlugins();
        
        for (const [name, pluginData] of plugins) {
            try {
                const pluginModule = await customPluginStorage.loadPluginModule(pluginData);
                pluginManager.registerPluginType(pluginModule);
                customPluginNames.add(name);
            } catch (error) {
                console.error(`Failed to load custom plugin ${name}:`, error);
            }
        }
    } catch (error) {
        console.error('Failed to load custom plugins:', error);
    }
}

async function checkForUpdates(): Promise<void> {
    if (!pluginManager || !customPluginStorage) return;

    availableUpdates.clear();
    const plugins = await customPluginStorage.getAllPlugins();
    const registryCache = new Map<string, Awaited<ReturnType<typeof RegistryClient.fetchRegistry>>>();

    for (const [name, pluginData] of plugins) {
        if (!pluginData.registryUrl) continue;

        try {
            let registry = registryCache.get(pluginData.registryUrl);
            if (!registry) {
                registry = await RegistryClient.fetchRegistry(pluginData.registryUrl);
                registryCache.set(pluginData.registryUrl, registry);
            }

            const registryPlugin = registry.plugins.find(p => p.name === name);
            if (!registryPlugin) continue;

            try {
                if (GitHubReleaseLoader.compareVersions(pluginData.metadata.version, registryPlugin.version) < 0) {
                    availableUpdates.set(name, registryPlugin.version);
                }
            } catch {
                console.error(`Skipping update check for "${name}": malformed version string`);
            }
        } catch (error) {
            console.error(`Failed to check updates for ${name}:`, error);
        }
    }

    if (availableUpdates.size > 0) {
        refreshPluginList();
    }
}

async function handleVxpkgUpload(file: File): Promise<void> {
    try {
        const contents = await VxpkgLoader.loadFromFile(file);
        const metadata = contents.manifest;
        
        // Save to OPFS
        await customPluginStorage.savePlugin(metadata.name, contents.code, metadata);
        
        // Load the plugin module
        const pluginData = await customPluginStorage.getPlugin(metadata.name);
        if (pluginData) {
            const pluginModule = await customPluginStorage.loadPluginModule(pluginData);
            
            // Check if plugin already exists
            const existingPlugin = pluginManager?.getAvailablePlugins().find(p => p.metadata.name === metadata.name);
            if (existingPlugin) {
                // Disable existing plugin first
                const enabledPlugin = pluginManager?.getPlugins().find(p => p.metadata.name === metadata.name);
                if (enabledPlugin) {
                    pluginManager?.disablePlugin(enabledPlugin);
                }
            }
            
            // Register the new/updated plugin
            pluginManager?.registerPluginType(pluginModule);
            customPluginNames.add(metadata.name);
            
            // Enable the plugin
            await pluginManager?.enablePlugin(pluginModule);
            savePluginState(metadata.name, true);
            
            refreshPluginList();
            context?.requestRender();
        }
    } catch (error) {
        console.error('Failed to upload plugin:', error);
        alert(`Failed to upload plugin: ${error instanceof Error ? error.message : String(error)}`);
    }
}

async function deleteCustomPlugin(pluginName: string): Promise<void> {
    if (!pluginManager || !customPluginStorage) return;
    
    // Disable the plugin first
    const enabledPlugin = pluginManager.getPlugins().find(p => p.metadata.name === pluginName);
    if (enabledPlugin) {
        pluginManager.disablePlugin(enabledPlugin);
    }
    
    // Unregister the plugin type from available plugins
    pluginManager.unregisterPluginType(pluginName);
    
    // Delete from OPFS
    await customPluginStorage.deletePlugin(pluginName);
    customPluginNames.delete(pluginName);
    
    // Remove from config
    delete config.enabledPlugins[pluginName];
    pluginManager.getConfigManager().updateConfig('@voltex-viewer/manager-plugin', config);
    
    refreshPluginList();
    context?.requestRender();
}

async function autoUpdatePlugin(pluginName: string): Promise<void> {
    if (!pluginManager || !customPluginStorage) return;

    const pluginData = await customPluginStorage.getPlugin(pluginName);
    if (!pluginData?.registryUrl || !pluginData?.registryMain) {
        alert('Cannot auto-update plugin: no registry source found. Please reinstall from the Browse tab.');
        return;
    }

    try {
        // Re-fetch the registry to get the latest plugin metadata + integrity hash
        const registry = await RegistryClient.fetchRegistry(pluginData.registryUrl);
        const registryPlugin = registry.plugins.find(p => p.name === pluginName);
        if (!registryPlugin) {
            alert(`Plugin "${pluginName}" not found in its source registry. It may have been removed.`);
            return;
        }

        const confirmed = confirm(
            `Update "${registryPlugin.displayName || pluginName}" to v${registryPlugin.version}?\n\n` +
            `Source: ${pluginData.registryUrl}\n\n` +
            `This will download and execute new code from the registry.`
        );
        if (!confirmed) return;

        await installFromRegistry(pluginData.registryUrl, registryPlugin);
        availableUpdates.delete(pluginName);
        refreshPluginList();
    } catch (error) {
        console.error('Failed to auto-update plugin:', error);
        alert(`Update failed: ${error instanceof Error ? error.message : String(error)}`);
    }
}

async function installFromRegistry(repoUrl: string, plugin: RegistryPlugin): Promise<void> {
    if (!pluginManager || !customPluginStorage) return;
    if (installingPlugins.has(plugin.name)) return;

    installingPlugins.add(plugin.name);
    try {
    const code = await RegistryClient.fetchPluginCode(repoUrl, plugin);

    const metadata = {
        name: plugin.name,
        displayName: plugin.displayName,
        version: plugin.version,
        description: plugin.description,
        author: plugin.author,
    };

    // Disable and unregister existing version if present
    const existingEnabled = pluginManager.getPlugins().find(p => p.metadata.name === plugin.name);
    if (existingEnabled) {
        pluginManager.disablePlugin(existingEnabled);
    }
    const existingAvailable = pluginManager.getAvailablePlugins().find(p => p.metadata.name === plugin.name);
    if (existingAvailable) {
        pluginManager.unregisterPluginType(plugin.name);
    }

    // Save to OPFS with registry tracking and integrity hash
    await customPluginStorage.savePlugin(plugin.name, code, metadata, {
        registryUrl: repoUrl,
        registryMain: plugin.main,
        integrity: plugin.integrity,
    });

    const pluginData = await customPluginStorage.getPlugin(plugin.name);
    if (!pluginData) throw new Error('Failed to save plugin to storage');

    const pluginModule = await customPluginStorage.loadPluginModule(pluginData);
    pluginManager.registerPluginType(pluginModule);
    customPluginNames.add(plugin.name);

    await pluginManager.enablePlugin(pluginModule);
    savePluginState(plugin.name, true);

    refreshPluginList();
    context?.requestRender();
    } finally {
        installingPlugins.delete(plugin.name);
    }
}

async function restorePluginStates() {
    if (!pluginManager || !config) return;
    
    const availablePlugins = pluginManager.getAvailablePlugins();
    
    for (const pluginModule of availablePlugins) {
        const pluginName = pluginModule.metadata.name;
        
        // Skip the Plugin Manager itself
        if (pluginName === '@voltex-viewer/manager-plugin') continue;
        
        const savedState = config.enabledPlugins[pluginName];
        const shouldBeEnabled = savedState !== undefined ? savedState : true; // Default to enabled
        const currentlyEnabled = pluginManager.getPlugins().some(p => p.metadata.name === pluginName);
        
        if (shouldBeEnabled && !currentlyEnabled) {
            await pluginManager.enablePlugin(pluginModule);
        } else if (!shouldBeEnabled && currentlyEnabled) {
            const enabledPlugin = pluginManager.getPlugins().find(p => p.metadata.name === pluginName);
            if (enabledPlugin) {
                pluginManager.disablePlugin(enabledPlugin);
            }
        }
    }
}

function savePluginState(pluginName: string, enabled: boolean): void {
    if (!config || !pluginManager) return;
    
    config.enabledPlugins[pluginName] = enabled;
    pluginManager.getConfigManager().updateConfig('@voltex-viewer/manager-plugin', config);
}

function renderContent(): HTMLElement {
    const container = document.createElement('div');
    container.innerHTML = `
        <style>
            .tab-bar {
                display: flex;
                border-bottom: 1px solid #374151;
                margin-bottom: 16px;
            }
            .tab-btn {
                flex: 1;
                padding: 8px 0;
                background: transparent;
                border: none;
                color: #6b7280;
                font-size: 13px;
                cursor: pointer;
                transition: color 0.2s;
                border-bottom: 2px solid transparent;
                margin-bottom: -1px;
            }
            .tab-btn.active {
                color: #e5e7eb;
                border-bottom-color: #6366f1;
            }
            .tab-btn:hover:not(.active) {
                color: #9ca3af;
            }
            .tab-panel {
                display: none;
            }
            .tab-panel.active {
                display: block;
            }
            .search-container {
                position: relative;
                margin-bottom: 16px;
            }
            .search-icon {
                position: absolute;
                left: 10px;
                top: 50%;
                transform: translateY(-35%);
                color: #6b7280;
                font-size: 14px;
                pointer-events: none;
                filter: grayscale(100%);
            }
            .search-input {
                width: 100%;
                padding: 10px 10px 10px 36px;
                background: #2c313a;
                border: 1px solid #444;
                color: #e5e7eb;
                border-radius: 6px;
                font-size: 13px;
                box-sizing: border-box;
            }
            .search-input:focus {
                outline: none;
                border-color: #6366f1;
            }
            .search-input::placeholder {
                color: #6b7280;
            }
            .toggle-switch {
                position: relative;
                width: 40px;
                height: 20px;
                background: #374151;
                border-radius: 10px;
                cursor: pointer;
                transition: background-color 0.2s;
            }
            .toggle-switch.enabled {
                background: #10b981;
            }
            .toggle-switch::after {
                content: '';
                position: absolute;
                top: 2px;
                left: 2px;
                width: 16px;
                height: 16px;
                background: white;
                border-radius: 50%;
                transition: transform 0.2s;
            }
            .toggle-switch.enabled::after {
                transform: translateX(20px);
            }
            .config-button {
                width: 24px;
                height: 24px;
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: center;
                color: #9ca3af;
                transition: all 0.2s;
                margin-right: 8px;
            }
            .config-button:hover {
                color: #e5e7eb;
            }
            .delete-button {
                width: 24px;
                height: 24px;
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: center;
                color: #9ca3af;
                transition: all 0.2s;
                margin-right: 8px;
            }
            .delete-button:hover {
                color: #ef4444;
            }
            .update-icon {
                width: 16px;
                height: 16px;
                color: #3b82f6;
                margin-right: 8px;
                cursor: pointer;
                transition: all 0.2s;
            }
            .update-icon:hover {
                color: #60a5fa;
            }
            .action-button {
                padding: 8px 12px;
                background: #374151;
                color: #e5e7eb;
                border: 1px solid #4b5563;
                border-radius: 6px;
                cursor: pointer;
                font-size: 13px;
                transition: all 0.2s;
                width: 100%;
                margin-top: 12px;
            }
            .action-button:hover {
                background: #4b5563;
                border-color: #6b7280;
            }
            .back-button {
                display: flex;
                align-items: center;
                gap: 8px;
                padding: 8px 12px;
                cursor: pointer;
                color: #e5e7eb;
                font-size: 13px;
                margin-bottom: 16px;
                transition: all 0.2s;
                border: none;
                background: transparent;
                border-radius: 4px;
            }
            .back-button:hover {
                background: #374151;
            }
            .config-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 16px;
                padding: 8px 0;
            }
            .config-title {
                display: flex;
                align-items: center;
                gap: 8px;
                cursor: pointer;
                color: #e5e7eb;
                font-size: 13px;
                font-weight: 500;
                transition: all 0.2s;
                border-radius: 4px;
                padding: 4px 8px;
                margin: -4px -8px;
            }
            .config-title:hover {
                background: #374151;
            }
            .config-view {
                display: none;
            }
            .config-view.active {
                display: block;
            }
            .list-view {
                display: block;
            }
            .list-view.hidden {
                display: none;
            }
            .registry-add-form {
                display: none;
                margin-bottom: 12px;
                gap: 6px;
            }
            .registry-add-form.open {
                display: flex;
            }
            .registry-url-input {
                flex: 1;
                padding: 7px 10px;
                background: #2c313a;
                border: 1px solid #444;
                color: #e5e7eb;
                border-radius: 6px;
                font-size: 12px;
                min-width: 0;
            }
            .registry-url-input:focus {
                outline: none;
                border-color: #6366f1;
            }
            .registry-url-input::placeholder {
                color: #6b7280;
            }
            .registry-url-input:disabled {
                opacity: 0.5;
            }
            .registry-add-btn {
                padding: 7px 12px;
                background: #6366f1;
                color: #fff;
                border: none;
                border-radius: 6px;
                cursor: pointer;
                font-size: 12px;
                white-space: nowrap;
                transition: background 0.2s;
            }
            .registry-add-btn:hover:not(:disabled) {
                background: #4f46e5;
            }
            .registry-add-btn:disabled {
                opacity: 0.5;
                cursor: not-allowed;
            }
            .registry-section {
                margin-bottom: 16px;
            }
            .registry-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 8px;
            }
            .registry-name {
                font-size: 12px;
                font-weight: 600;
                color: #9ca3af;
                text-transform: uppercase;
                letter-spacing: 0.05em;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
                flex: 1;
                min-width: 0;
            }
            .registry-remove-btn {
                background: transparent;
                border: none;
                color: #6b7280;
                cursor: pointer;
                font-size: 16px;
                line-height: 1;
                padding: 0 4px;
                transition: color 0.2s;
                flex-shrink: 0;
            }
            .registry-remove-btn:hover {
                color: #ef4444;
            }
            .registry-plugin-item {
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 10px 12px;
                background: #2c313a;
                border-radius: 6px;
                border: 1px solid #374151;
                margin-bottom: 6px;
            }
            .registry-plugin-info {
                flex: 1;
                min-width: 0;
                margin-right: 8px;
            }
            .registry-plugin-name {
                font-size: 13px;
                color: #e5e7eb;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            }
            .registry-plugin-meta {
                font-size: 11px;
                color: #6b7280;
                margin-top: 2px;
            }
            .registry-install-btn {
                padding: 4px 10px;
                background: #6366f1;
                color: #fff;
                border: none;
                border-radius: 4px;
                cursor: pointer;
                font-size: 12px;
                white-space: nowrap;
                transition: background 0.2s;
                flex-shrink: 0;
            }
            .registry-install-btn:hover:not(:disabled) {
                background: #4f46e5;
            }
            .registry-install-btn:disabled {
                opacity: 0.6;
                cursor: not-allowed;
            }
            .registry-install-btn.installed {
                background: #374151;
                color: #10b981;
                cursor: default;
            }
            .registry-loading {
                font-size: 12px;
                color: #6b7280;
                padding: 8px 0;
                text-align: center;
            }
            .open-registry-btn {
                display: flex;
                align-items: center;
                gap: 6px;
                padding: 8px 12px;
                background: #2c313a;
                border: 1px dashed #4b5563;
                border-radius: 6px;
                color: #9ca3af;
                font-size: 13px;
                cursor: pointer;
                width: 100%;
                transition: all 0.2s;
                box-sizing: border-box;
                margin-bottom: 12px;
            }
            .open-registry-btn:hover {
                border-color: #6366f1;
                color: #e5e7eb;
            }
        </style>

        <div class="tab-bar">
            <button class="tab-btn active" id="tab-installed">Installed</button>
            <button class="tab-btn" id="tab-browse">Browse</button>
        </div>

        <div class="tab-panel active" id="panel-installed">
            <div class="list-view" id="list-view">
                <div class="search-container">
                    <div class="search-icon">
                        <svg width="20" height="20" viewBox="0 0 16 16" fill="none">
                            <circle cx="6" cy="6" r="3" stroke="#6b7280" stroke-width="1.5" fill="none"/>
                            <line x1="8.5" y1="8.5" x2="12" y2="12" stroke="#6b7280" stroke-width="1.5" stroke-linecap="round"/>
                        </svg>
                    </div>
                    <input type="text" id="plugin-search" placeholder="Search plugins..." class="search-input">
                </div>
                <div id="plugin-list" style="display: flex; flex-direction: column; gap: 8px;">
                </div>
            </div>
            <div class="config-view" id="config-view">
                <div class="config-header">
                    <div class="config-title" id="config-title">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <polyline points="15,18 9,12 15,6"></polyline>
                        </svg>
                        <span id="config-plugin-name"></span>
                    </div>
                    <div class="toggle-switch" id="config-toggle">
                    </div>
                </div>
                <div id="config-content">
                </div>
            </div>
        </div>

        <div class="tab-panel" id="panel-browse">
            <button class="open-registry-btn" id="open-registry-btn">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                </svg>
                Add Registry
            </button>
            <div class="registry-add-form" id="registry-add-form">
                <input type="text" class="registry-url-input" id="registry-url-input" placeholder="https://github.com/user/my-registry">
                <button class="registry-add-btn" id="registry-confirm-btn">Add</button>
            </div>
            <div id="registry-list">
            </div>
        </div>
    `;

    sidebarContainer = container;
    renderPluginList();

    const searchInput = container.querySelector('#plugin-search') as HTMLInputElement;
    searchInput.addEventListener('input', (e) => {
        const searchTerm = (e.target as HTMLInputElement).value.toLowerCase();
        filterPlugins(searchTerm);
    });

    const backButton = container.querySelector('#config-title') as HTMLElement;
    backButton.addEventListener('click', () => {
        showListView();
    });

    // Tab switching
    const tabInstalled = container.querySelector('#tab-installed') as HTMLButtonElement;
    const tabBrowse = container.querySelector('#tab-browse') as HTMLButtonElement;
    const panelInstalled = container.querySelector('#panel-installed') as HTMLElement;
    const panelBrowse = container.querySelector('#panel-browse') as HTMLElement;

    tabInstalled.addEventListener('click', () => {
        tabInstalled.classList.add('active');
        tabBrowse.classList.remove('active');
        panelInstalled.classList.add('active');
        panelBrowse.classList.remove('active');
    });

    tabBrowse.addEventListener('click', () => {
        tabBrowse.classList.add('active');
        tabInstalled.classList.remove('active');
        panelBrowse.classList.add('active');
        panelInstalled.classList.remove('active');
        renderRegistryList();
    });

    // Add Registry toggle
    const openRegistryBtn = container.querySelector('#open-registry-btn') as HTMLButtonElement;
    const registryAddForm = container.querySelector('#registry-add-form') as HTMLElement;
    const registryUrlInput = container.querySelector('#registry-url-input') as HTMLInputElement;
    const registryConfirmBtn = container.querySelector('#registry-confirm-btn') as HTMLButtonElement;

    openRegistryBtn.addEventListener('click', () => {
        registryAddForm.classList.toggle('open');
        if (registryAddForm.classList.contains('open')) {
            registryUrlInput.focus();
        }
    });

    const doAddRegistry = async () => {
        const url = registryUrlInput.value.trim();
        if (!url) return;

        registryUrlInput.disabled = true;
        registryConfirmBtn.disabled = true;
        registryConfirmBtn.textContent = 'Adding...';

        try {
            await addRegistry(url);
            registryUrlInput.value = '';
            registryAddForm.classList.remove('open');
            renderRegistryList();
        } catch (error) {
            alert(`Failed to add registry: ${error instanceof Error ? error.message : String(error)}`);
        } finally {
            registryUrlInput.disabled = false;
            registryConfirmBtn.disabled = false;
            registryConfirmBtn.textContent = 'Add';
        }
    };

    registryConfirmBtn.addEventListener('click', doAddRegistry);
    registryUrlInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') doAddRegistry();
    });

    return container;
}

async function addRegistry(repoUrl: string): Promise<void> {
    // Validate by fetching the registry
    await RegistryClient.fetchRegistry(repoUrl);

    const registries = loadRegistries();
    const normalizedUrl = repoUrl.replace(/\/$/, '');
    if (!registries.includes(normalizedUrl)) {
        registries.push(normalizedUrl);
        saveRegistries(registries);
    }
}

function removeRegistry(repoUrl: string): void {
    const normalizedUrl = repoUrl.replace(/\/$/, '');
    const registries = loadRegistries().filter(u => u !== normalizedUrl);
    saveRegistries(registries);
}

async function renderRegistryList(): Promise<void> {
    if (!sidebarContainer) return;

    const registryListEl = sidebarContainer.querySelector('#registry-list') as HTMLElement;
    if (!registryListEl) return;

    const registries = loadRegistries();

    if (registries.length === 0) {
        registryListEl.innerHTML = `<div class="registry-loading">No registries added yet.</div>`;
        return;
    }

    // Render skeleton sections first, then fill async
    registryListEl.innerHTML = '';

    // Snapshot installed plugins once so all registry renders see the same state
    const installedPlugins = await customPluginStorage.getAllPlugins();

    for (const repoUrl of registries) {
        const section = document.createElement('div');
        section.className = 'registry-section';
        section.innerHTML = `
            <div class="registry-header">
                <span class="registry-name"></span>
                <button class="registry-remove-btn" title="Remove registry">&times;</button>
            </div>
            <div class="registry-loading">Loading...</div>
        `;
        (section.querySelector('.registry-name') as HTMLElement).textContent = repoUrl;

        const removeBtn = section.querySelector('.registry-remove-btn') as HTMLButtonElement;
        removeBtn.addEventListener('click', () => {
            removeRegistry(repoUrl);
            section.remove();
            const registryListEl2 = sidebarContainer?.querySelector('#registry-list') as HTMLElement;
            if (registryListEl2 && registryListEl2.children.length === 0) {
                registryListEl2.innerHTML = `<div class="registry-loading">No registries added yet.</div>`;
            }
        });

        registryListEl.appendChild(section);

        // Async load
        RegistryClient.fetchRegistry(repoUrl).then(registry => {
            const nameEl = section.querySelector('.registry-name') as HTMLElement;
            nameEl.textContent = registry.name;
            nameEl.title = repoUrl;

            const loadingEl = section.querySelector('.registry-loading') as HTMLElement;
            loadingEl.remove();

            for (const plugin of registry.plugins) {
                    const isInstalled = installedPlugins.has(plugin.name);
                    const pluginEl = document.createElement('div');
                    pluginEl.className = 'registry-plugin-item';

                    const infoDiv = document.createElement('div');
                    infoDiv.className = 'registry-plugin-info';

                    const nameDiv = document.createElement('div');
                    nameDiv.className = 'registry-plugin-name';
                    nameDiv.textContent = plugin.displayName || plugin.name;

                    const metaDiv = document.createElement('div');
                    metaDiv.className = 'registry-plugin-meta';
                    const metaParts = [`v${plugin.version}`];
                    if (plugin.author) metaParts.push(plugin.author);
                    if (plugin.description) metaParts.push(plugin.description);
                    metaDiv.textContent = metaParts.join(' · ');

                    infoDiv.appendChild(nameDiv);
                    infoDiv.appendChild(metaDiv);

                    const installBtn = document.createElement('button');
                    installBtn.className = `registry-install-btn${isInstalled ? ' installed' : ''}`;
                    installBtn.disabled = isInstalled;
                    installBtn.textContent = isInstalled ? 'Installed' : 'Install';

                    if (!isInstalled) {
                        installBtn.addEventListener('click', async () => {
                            installBtn.disabled = true;
                            installBtn.textContent = 'Installing...';
                            try {
                                await installFromRegistry(repoUrl, plugin);
                                installBtn.textContent = 'Installed';
                                installBtn.classList.add('installed');
                            } catch (error) {
                                console.error('Failed to install plugin:', error);
                                alert(`Install failed: ${error instanceof Error ? error.message : String(error)}`);
                                installBtn.disabled = false;
                                installBtn.textContent = 'Install';
                            }
                        });
                    }

                    pluginEl.appendChild(infoDiv);
                    pluginEl.appendChild(installBtn);
                    section.appendChild(pluginEl);
                }
        }).catch(error => {
            const loadingEl = section.querySelector('.registry-loading') as HTMLElement;
            loadingEl.textContent = `Failed to load registry: ${error instanceof Error ? error.message : String(error)}`;
        });
    }
}

async function togglePlugin(pluginName: string, toggleElement: HTMLElement) {
    if (!pluginManager) return;
    
    const currentEnabledPlugin = pluginManager.getPlugins().find(p => p.metadata.name === pluginName);
    const currentIsEnabled = !!currentEnabledPlugin;
    
    if (currentIsEnabled && currentEnabledPlugin) {
        pluginManager.disablePlugin(currentEnabledPlugin);
        toggleElement.classList.remove('enabled');
        savePluginState(pluginName, false);
    } else {
        const pluginModule = pluginManager.getAvailablePlugins().find(p => p.metadata.name === pluginName);
        if (pluginModule) {
            await pluginManager.enablePlugin(pluginModule);
            toggleElement.classList.add('enabled');
            savePluginState(pluginName, true);
        }
    }
    refreshPluginList();
    if (context) {
        context.requestRender();
    }
}

function renderPluginList(): void {
    if (!pluginManager || !sidebarContainer) return;

    const pluginListContainer = sidebarContainer.querySelector('#plugin-list');
    if (!pluginListContainer) return;

    pluginListContainer.innerHTML = '';

    for (const pluginModule of pluginManager.getAvailablePlugins().sort((a, b) => (a.metadata.displayName || a.metadata.name).localeCompare(b.metadata.displayName || b.metadata.name))) {
        const pluginItem = document.createElement('div');
        pluginItem.className = 'plugin-item';
        const isPluginManager = pluginModule.metadata.name === '@voltex-viewer/manager-plugin';
        const isVoltexCore = pluginModule.metadata.name === '@voltex-viewer/voltex';
        const canBeToggled = !isPluginManager && !isVoltexCore;
        const enabledPlugin = pluginManager!.getPlugins().find(p => p.metadata.name === pluginModule.metadata.name);
        const isEnabled = !!enabledPlugin;
        const hasConfig = pluginManager!.getConfigManager().hasConfig(pluginModule.metadata.name);
        const isCustomPlugin = customPluginNames.has(pluginModule.metadata.name);
        const displayName = pluginModule.metadata.displayName || pluginModule.metadata.name;
        pluginItem.setAttribute('data-plugin-name', pluginModule.metadata.name.toLowerCase());
        pluginItem.setAttribute('data-plugin-display-name', displayName.toLowerCase());
        const hasUpdate = availableUpdates.has(pluginModule.metadata.name);
        const updateVersion = availableUpdates.get(pluginModule.metadata.name);
        
        const inner = document.createElement('div');
        inner.style.cssText = 'display: flex; justify-content: space-between; align-items: center; padding: 12px; background: #2c313a; border-radius: 6px; border: 1px solid #374151;';

        const nameSpan = document.createElement('span');
        nameSpan.style.cssText = 'color: #e5e7eb; font-weight: 400; font-size: 13px; display: flex; align-items: center; overflow: hidden; flex: 1; min-width: 0;';
        const nameInner = document.createElement('span');
        nameInner.style.cssText = 'overflow: hidden; text-overflow: ellipsis; white-space: nowrap;';
        nameInner.textContent = displayName;
        nameSpan.appendChild(nameInner);

        const actionsDiv = document.createElement('div');
        actionsDiv.style.cssText = 'display: flex; align-items: center;';

        if (hasUpdate) {
            const updateIcon = document.createElement('div');
            updateIcon.className = 'update-icon';
            updateIcon.setAttribute('title', `Update available: v${updateVersion}`);
            updateIcon.innerHTML = `<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" stroke="none"><path d="M8 1c.55 0 1 .45 1 1v5.59l1.29-1.29a1 1 0 111.41 1.41l-3 3a1 1 0 01-1.41 0l-3-3a1 1 0 111.41-1.41L7 7.59V2c0-.55.45-1 1-1z"/><rect x="2" y="11" width="12" height="3" rx="1.5"/></svg>`;
            updateIcon.addEventListener('click', async () => {
                await autoUpdatePlugin(pluginModule.metadata.name);
            });
            actionsDiv.appendChild(updateIcon);
        }

        if (hasConfig || isCustomPlugin) {
            const configButton = document.createElement('div');
            configButton.className = 'config-button';
            configButton.setAttribute('title', 'Configure plugin');
            configButton.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z M12 15a3 3 0 1 1 0-6 3 3 0 0 1 0 6z"/></svg>`;
            configButton.addEventListener('click', () => {
                showConfigView(pluginModule.metadata.name);
            });
            actionsDiv.appendChild(configButton);
        }

        if (canBeToggled) {
            const toggleSwitch = document.createElement('div');
            toggleSwitch.className = `toggle-switch${isEnabled ? ' enabled' : ''}`;
            toggleSwitch.addEventListener('click', () => togglePlugin(pluginModule.metadata.name, toggleSwitch));
            actionsDiv.appendChild(toggleSwitch);
        } else {
            const spacer = document.createElement('div');
            spacer.style.width = '40px';
            actionsDiv.appendChild(spacer);
        }

        inner.appendChild(nameSpan);
        inner.appendChild(actionsDiv);
        pluginItem.appendChild(inner);

        pluginListContainer.appendChild(pluginItem);
    }
}

function filterPlugins(searchTerm: string): void {
    if (!sidebarContainer) return;

    const pluginItems = sidebarContainer.querySelectorAll('.plugin-item');
    
    for (const item of pluginItems) {
        const pluginName = item.getAttribute('data-plugin-name') || '';
        const pluginDisplayName = item.getAttribute('data-plugin-display-name') || '';
        const shouldShow = pluginName.includes(searchTerm) || pluginDisplayName.includes(searchTerm);
        (item as HTMLElement).style.display = shouldShow ? 'block' : 'none';
    }
}

function refreshPluginList(): void {
    renderPluginList();
}

function showListView(): void {
    if (!sidebarContainer) return;
    
    currentlyDisplayedPluginName = null;
    
    const listView = sidebarContainer.querySelector('#list-view') as HTMLElement;
    const configView = sidebarContainer.querySelector('#config-view') as HTMLElement;
    
    listView.classList.remove('hidden');
    configView.classList.remove('active');
}

function showConfigView(pluginName: string): void {
    if (!pluginManager || !sidebarContainer) return;

    currentlyDisplayedPluginName = pluginName;

    const configSchema = pluginManager.getConfigManager().getConfigSchema(pluginName);
    const isCustomPlugin = customPluginNames.has(pluginName);
    if (!configSchema && !isCustomPlugin) return;

    const pluginModule = pluginManager.getAvailablePlugins().find(p => p.metadata.name === pluginName);
    const displayName = pluginModule ? (pluginModule.metadata.displayName || pluginModule.metadata.name) : pluginName;
    const enabledPlugin = pluginManager.getPlugins().find(p => p.metadata.name === pluginName);
    const isEnabled = !!enabledPlugin;

    const listView = sidebarContainer.querySelector('#list-view') as HTMLElement;
    const configView = sidebarContainer.querySelector('#config-view') as HTMLElement;
    const configContent = sidebarContainer.querySelector('#config-content') as HTMLElement;
    const pluginNameSpan = sidebarContainer.querySelector('#config-plugin-name') as HTMLElement;
    const configToggle = sidebarContainer.querySelector('#config-toggle') as HTMLElement;
    
    // Update plugin name
    pluginNameSpan.textContent = displayName;
    
    // Update toggle state
    configToggle.className = `toggle-switch ${isEnabled ? 'enabled' : ''}`;
    
    // Add toggle functionality
    configToggle.onclick = () => {
        return togglePlugin(pluginName, configToggle);
    };
    
    // Hide list view and show config view
    listView.classList.add('hidden');
    configView.classList.add('active');
    
    // Clear previous config content
    configContent.innerHTML = '';
    
    // Generate config UI (only if schema exists)
    if (configSchema) {
        const configUI = ConfigUIGenerator.generateConfigUI(configSchema, {
            onUpdate: (newConfig) => {
                pluginManager!.getConfigManager().updateConfig(pluginName, newConfig);
                if (context) {
                    context.requestRender();
                }
            },
            onReset: () => {
                pluginManager!.getConfigManager().updateConfig(pluginName, configSchema.defaultConfig);
                showConfigView(pluginName);
                if (context) {
                    context.requestRender();
                }
            }
        });
        configContent.appendChild(configUI);
    }
    
    // Add delete button for custom plugins
    if (isCustomPlugin) {
        const deleteButton = document.createElement('button');
        deleteButton.className = 'action-button';
        deleteButton.textContent = 'Delete Plugin';
        deleteButton.addEventListener('click', async () => {
            if (confirm(`Are you sure you want to delete the custom plugin "${pluginName}"?`)) {
                await deleteCustomPlugin(pluginName);
                showListView();
            }
        });
        configContent.appendChild(deleteButton);
    }
}
