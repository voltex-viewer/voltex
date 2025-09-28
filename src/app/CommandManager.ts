import type { Command } from '@voltex-viewer/plugin-api';
import type { PluginConfigManager } from './PluginConfigManager';

interface CommandEntry {
    command: Command;
    pluginName: string;
}

export class CommandManager {
    private commands = new Map<string, CommandEntry>();
    private globalKeybindingMap = new Map<string, string>();

    constructor(private pluginConfigManager: PluginConfigManager) {
        this.pluginConfigManager.onConfigChanged((pluginName, newConfig, oldConfig) => {
            for (const [commandId, { pluginName: cmdPluginName }] of this.commands) {
                if (cmdPluginName === pluginName) {
                    this.updateCommandKeybinding(commandId, pluginName);
                }
            }
        });
    }

    registerCommand(pluginName: string, command: Command): void {
        this.commands.set(command.id, { command, pluginName });
        this.updateCommandKeybinding(command.id, pluginName);
    }

    unregisterCommand(commandId: string): void {
        const commandEntry = this.commands.get(commandId);
        if (commandEntry) {
            for (const [keybinding, cmdId] of this.globalKeybindingMap) {
                if (cmdId === commandId) {
                    this.globalKeybindingMap.delete(keybinding);
                    break;
                }
            }
            this.commands.delete(commandId);
        }
    }

    executeCommand(keybinding: string): boolean {
        const commandId = this.globalKeybindingMap.get(keybinding);
        if (commandId) {
            const commandEntry = this.commands.get(commandId);
            if (commandEntry) {
                commandEntry.command.action();
                return true;
            }
        }
        return false;
    }

    private updateCommandKeybinding(commandId: string, pluginName: string): void {
        const pluginConfig = this.pluginConfigManager.getConfig(pluginName) as any;
        if (!pluginConfig || !pluginConfig.keybindings) return;
        
        const keybinding = pluginConfig.keybindings[commandId] || null;
        
        for (const [kb, cmdId] of this.globalKeybindingMap) {
            if (cmdId === commandId) {
                this.globalKeybindingMap.delete(kb);
                break;
            }
        }

        if (keybinding) {
            if (this.globalKeybindingMap.has(keybinding)) {
                console.warn(`Keybinding conflict: ${keybinding} is already used by command ${this.globalKeybindingMap.get(keybinding)}, overriding with ${commandId}`);
            }
            this.globalKeybindingMap.set(keybinding, commandId);
        }
    }
}