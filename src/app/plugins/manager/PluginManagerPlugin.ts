import { getAvailablePlugins } from '..';
import type { PluginContext, SidebarEntryArgs } from '@voltex-viewer/plugin-api';
import type { PluginManager } from '../../PluginManager';
import { ConfigUIGenerator } from './ConfigUIGenerator';
import * as t from 'io-ts';
import { CustomPluginStorage } from './CustomPluginStorage';
import { VxpkgLoader } from './VxpkgLoader';
import { GitHubReleaseLoader } from './GitHubReleaseLoader';

const PluginManagerConfigSchema = t.type({
    enabledPlugins: t.record(t.string, t.boolean)
});

type PluginManagerConfig = t.TypeOf<typeof PluginManagerConfigSchema>;

let pluginManager: PluginManager | undefined;
let sidebarContainer: HTMLElement | undefined;
let context: PluginContext | undefined;
let config: PluginManagerConfig;
let customPluginStorage: CustomPluginStorage;
let customPluginNames = new Set<string>();
let availableUpdates = new Map<string, string>();
let currentlyDisplayedPluginName: string | null = null;

export default (pluginContext: PluginContext): void => {
    context = pluginContext;
    
    config = context.loadConfig(PluginManagerConfigSchema, {
        enabledPlugins: {
            '@voltex-viewer/fps-plugin': false,
            '@voltex-viewer/demo-signals-plugin': false,
            '@voltex-viewer/profiler-plugin': false,
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

    const plugins = await customPluginStorage.getAllPlugins();
    
    for (const [name, pluginData] of plugins) {
        const url = pluginData.metadata.url;
        if (!url) continue;

        try {
            const release = await GitHubReleaseLoader.fetchLatestRelease(url);
            if (!release) continue;

            const latestVersion = GitHubReleaseLoader.parseVersion(release.tag_name);
            const currentVersion = pluginData.metadata.version;

            if (GitHubReleaseLoader.compareVersions(currentVersion, latestVersion) < 0) {
                availableUpdates.set(name, latestVersion);
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

async function openPluginUpdate(pluginName: string): Promise<void> {
    if (!pluginManager || !customPluginStorage) return;

    const pluginData = await customPluginStorage.getPlugin(pluginName);
    if (!pluginData || !pluginData.metadata.url) {
        alert('Cannot update plugin: no repository URL found');
        return;
    }

    try {
        const release = await GitHubReleaseLoader.fetchLatestRelease(pluginData.metadata.url);
        if (!release) {
            alert('Failed to fetch latest release from GitHub');
            return;
        }

        const releaseUrl = GitHubReleaseLoader.getReleasePageUrl(release);
        
        // Open the release page
        if (window.waveformApi) {
            window.waveformApi.openExternalUrl(releaseUrl);
        } else {
            window.open(releaseUrl, '_blank');
        }
    } catch (error) {
        console.error('Failed to open release page:', error);
        alert(`Failed to open release page: ${error instanceof Error ? error.message : String(error)}`);
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
        </style>
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

    return container;
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
        pluginItem.setAttribute('data-plugin-name', pluginModule.metadata.name.toLowerCase());
        
        const isPluginManager = pluginModule.metadata.name === 'Plugin Manager';
        const isVoltexCore = pluginModule.metadata.name === 'Voltex';
        const canBeToggled = !isPluginManager && !isVoltexCore;
        const enabledPlugin = pluginManager!.getPlugins().find(p => p.metadata.name === pluginModule.metadata.name);
        const isEnabled = !!enabledPlugin;
        const hasConfig = pluginManager!.getConfigManager().hasConfig(pluginModule.metadata.name);
        const isCustomPlugin = customPluginNames.has(pluginModule.metadata.name);
        const displayName = pluginModule.metadata.displayName || pluginModule.metadata.name;
        const hasUpdate = availableUpdates.has(pluginModule.metadata.name);
        const updateVersion = availableUpdates.get(pluginModule.metadata.name);
        
        pluginItem.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; padding: 12px; background: #2c313a; border-radius: 6px; border: 1px solid #374151;">
            <span style="color: #e5e7eb; font-weight: 400; font-size: 13px; display: flex; align-items: center; overflow: hidden; flex: 1; min-width: 0;">
            <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${displayName}</span>
            </span>
            <div style="display: flex; align-items: center;">
            ${hasUpdate ? `
            <div class="update-icon" data-plugin="${pluginModule.metadata.name}" title="Update available: v${updateVersion}">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" stroke="none">
                <path d="M8 1c.55 0 1 .45 1 1v5.59l1.29-1.29a1 1 0 111.41 1.41l-3 3a1 1 0 01-1.41 0l-3-3a1 1 0 111.41-1.41L7 7.59V2c0-.55.45-1 1-1z"/>
                <rect x="2" y="11" width="12" height="3" rx="1.5"/>
            </svg>
            </div>
            ` : ''}
            ${hasConfig || isCustomPlugin ? `
            <div class="config-button" data-plugin="${pluginModule.metadata.name}" title="Configure plugin">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="none">
                <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z M12 15a3 3 0 1 1 0-6 3 3 0 0 1 0 6z"/>
            </svg>
            </div>
            ` : ''}
            ${canBeToggled ? 
            `<div class="toggle-switch ${isEnabled ? 'enabled' : ''}" data-plugin="${pluginModule.metadata.name}"></div>` :
            `<div style="width: 40px;"></div>`
            }
            </div>
            </div>
        `;

        const toggleSwitch = pluginItem.querySelector('.toggle-switch') as HTMLElement;
        if (toggleSwitch) {
            toggleSwitch.addEventListener('click', () => {
                return togglePlugin(pluginModule.metadata.name, toggleSwitch);
            });
        }

        // Add update icon event listener
        const updateIcon = pluginItem.querySelector('.update-icon') as HTMLElement;
        if (updateIcon) {
            updateIcon.addEventListener('click', async () => {
                await openPluginUpdate(pluginModule.metadata.name);
            });
        }

        // Add config button event listener
        const configButton = pluginItem.querySelector('.config-button') as HTMLElement;
        if (configButton) {
            configButton.addEventListener('click', () => {
                showConfigView(pluginModule.metadata.name);
            });
        }

        pluginListContainer.appendChild(pluginItem);
    }
}

function filterPlugins(searchTerm: string): void {
    if (!sidebarContainer) return;

    const pluginItems = sidebarContainer.querySelectorAll('.plugin-item');
    
    for (const item of pluginItems) {
        const pluginName = item.getAttribute('data-plugin-name') || '';
        const shouldShow = pluginName.includes(searchTerm);
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
    if (!configSchema) return;

    const pluginModule = pluginManager.getAvailablePlugins().find(p => p.metadata.name === pluginName);
    const displayName = pluginModule ? ((pluginModule.metadata as any).displayName || pluginModule.metadata.name) : pluginName;
    const enabledPlugin = pluginManager.getPlugins().find(p => p.metadata.name === pluginName);
    const isEnabled = !!enabledPlugin;
    const isCustomPlugin = customPluginNames.has(pluginName);
    const hasUpdate = availableUpdates.has(pluginName);
    const updateVersion = availableUpdates.get(pluginName);
    const currentVersion = pluginModule?.metadata.version;
    
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
    
    // Generate config UI
    const configUI = ConfigUIGenerator.generateConfigUI(configSchema, {
        onUpdate: (newConfig) => {
            pluginManager!.getConfigManager().updateConfig(pluginName, newConfig);
            if (context) {
                context.requestRender();
            }
        },
        onReset: () => {
            pluginManager!.getConfigManager().updateConfig(pluginName, configSchema.defaultConfig);
            // Refresh the config view with default values
            showConfigView(pluginName);
            if (context) {
                context.requestRender();
            }
        }
    });

    configContent.appendChild(configUI);
    
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
