import { getAvailablePlugins } from '..';
import type { PluginContext, SidebarEntry } from '@voltex-viewer/plugin-api';
import type { PluginManager } from '../../PluginManager';
import { ConfigUIGenerator } from './ConfigUIGenerator';
import * as t from 'io-ts';

const PluginManagerConfigSchema = t.type({
    enabledPlugins: t.record(t.string, t.boolean)
});

type PluginManagerConfig = t.TypeOf<typeof PluginManagerConfigSchema>;

let pluginManager: PluginManager | undefined;
let sidebarContainer: HTMLElement | undefined;
let context: PluginContext | undefined;
let config: PluginManagerConfig;

export default (pluginContext: PluginContext): void => {
    context = pluginContext;
    
    config = context.loadConfig(PluginManagerConfigSchema, {
        enabledPlugins: {
            'FPS': false,
        }
    });
    
    const sidebarEntry: SidebarEntry = {
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

export function setPluginManager(manager: PluginManager): void {
    pluginManager = manager;
    
    // Register all available plugins with the plugin manager
    const availablePlugins = getAvailablePlugins();
    for (const plugin of availablePlugins) {
        pluginManager.registerPluginType(plugin);
    }
    
    // Apply saved plugin states from config
    restorePluginStates();
    
    // Register to be notified when new plugins are registered
    pluginManager.onPluginRegistered(() => {
        refreshPluginList();
    });
    
    refreshPluginList();
}

function restorePluginStates(): void {
    if (!pluginManager || !config) return;
    
    const availablePlugins = pluginManager.getAvailablePlugins();
    
    for (const pluginModule of availablePlugins) {
        const pluginName = pluginModule.metadata.name;
        
        // Skip the Plugin Manager itself
        if (pluginName === 'Plugin Manager') continue;
        
        const savedState = config.enabledPlugins[pluginName];
        const shouldBeEnabled = savedState !== undefined ? savedState : true; // Default to enabled
        const currentlyEnabled = pluginManager.getPlugins().some(p => p.metadata.name === pluginName);
        
        if (shouldBeEnabled && !currentlyEnabled) {
            pluginManager.enablePlugin(pluginModule);
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
    pluginManager.getConfigManager().updateConfig('Plugin Manager', config);
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

function togglePlugin(pluginName: string, toggleElement: HTMLElement): void {
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
            pluginManager.enablePlugin(pluginModule);
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

    for (const pluginModule of pluginManager.getAvailablePlugins().sort((a, b) => a.metadata.name.localeCompare(b.metadata.name))) {
        const pluginItem = document.createElement('div');
        pluginItem.className = 'plugin-item';
        pluginItem.setAttribute('data-plugin-name', pluginModule.metadata.name.toLowerCase());
        
        const isPluginManager = pluginModule.metadata.name === 'Plugin Manager';
        const isVoltexCore = pluginModule.metadata.name === 'Voltex';
        const canBeToggled = !isPluginManager && !isVoltexCore;
        const enabledPlugin = pluginManager!.getPlugins().find(p => p.metadata.name === pluginModule.metadata.name);
        const isEnabled = !!enabledPlugin;
        const hasConfig = pluginManager!.getConfigManager().hasConfig(pluginModule.metadata.name);
        
        pluginItem.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; padding: 12px; background: #2c313a; border-radius: 6px; border: 1px solid #374151;">
            <span style="color: #e5e7eb; font-weight: 400; font-size: 13px;">
            ${pluginModule.metadata.name}
            </span>
            <div style="display: flex; align-items: center;">
            ${hasConfig ? `
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
                togglePlugin(pluginModule.metadata.name, toggleSwitch);
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
    
    const listView = sidebarContainer.querySelector('#list-view') as HTMLElement;
    const configView = sidebarContainer.querySelector('#config-view') as HTMLElement;
    
    listView.classList.remove('hidden');
    configView.classList.remove('active');
}

function showConfigView(pluginName: string): void {
    if (!pluginManager || !sidebarContainer) return;

    const configSchema = pluginManager.getConfigManager().getConfigSchema(pluginName);
    if (!configSchema) return;

    const enabledPlugin = pluginManager.getPlugins().find(p => p.metadata.name === pluginName);
    const isEnabled = !!enabledPlugin;
    
    const listView = sidebarContainer.querySelector('#list-view') as HTMLElement;
    const configView = sidebarContainer.querySelector('#config-view') as HTMLElement;
    const configContent = sidebarContainer.querySelector('#config-content') as HTMLElement;
    const pluginNameSpan = sidebarContainer.querySelector('#config-plugin-name') as HTMLElement;
    const configToggle = sidebarContainer.querySelector('#config-toggle') as HTMLElement;
    
    // Update plugin name
    pluginNameSpan.textContent = pluginName;
    
    // Update toggle state
    configToggle.className = `toggle-switch ${isEnabled ? 'enabled' : ''}`;
    
    // Add toggle functionality
    configToggle.onclick = () => {
        togglePlugin(pluginName, configToggle);
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
}
