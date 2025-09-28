import * as t from 'io-ts';
import { isRight } from 'fp-ts/Either';
import { pipe } from 'fp-ts/function';

export interface PluginConfigSchema<T = any> {
    name: string;
    schema: t.Type<T>;
    defaultConfig: T;
    config: T;
}

export interface ConfigChangeCallback<T = any> {
    (pluginName: string, newConfig: T, oldConfig: T): void;
}

export class PluginConfigManager {
    private configs = new Map<string, PluginConfigSchema>();
    private changeCallbacks: ConfigChangeCallback[] = [];
    private storageKey = 'voltex-plugin-configs';

    constructor() {
        this.loadFromStorage();
    }

    onConfigChanged(callback: ConfigChangeCallback): void {
        this.changeCallbacks.push(callback);
    }

    loadConfig<T>(pluginName: string, schema: t.Type<T>, defaultConfig: T): T {
        const isFirstLoad = !this.configs.has(pluginName);
        
        // Try to get stored config first
        const storedConfig = this.getStoredConfig(pluginName);
        const currentConfig = storedConfig || defaultConfig;
        
        // Validate the current config against the new schema
        const validationResult = schema.decode(currentConfig);
        const validConfig = isRight(validationResult) ? validationResult.right : defaultConfig;

        const configSchema = {
            name: pluginName,
            schema,
            defaultConfig,
            config: validConfig
        };

        this.configs.set(pluginName, configSchema);

        // Save to storage after registration
        this.saveToStorage();

        // Trigger change callbacks for first load so CommandManager can set up keybindings
        if (isFirstLoad) {
            this.changeCallbacks.forEach(callback => {
                try {
                    callback(pluginName, configSchema.config, {});
                } catch (error) {
                    console.error(`Error in config change callback:`, error);
                }
            });
        }

        return configSchema.config;
    }

    getConfig<T>(pluginName: string): T | undefined {
        return this.configs.get(pluginName)?.config as T | undefined;
    }

    updateConfig<T>(pluginName: string, newConfig: T): void {
        const configSchema = this.configs.get(pluginName);
        if (!configSchema) {
            throw new Error(`No config registered for plugin: ${pluginName}`);
        }

        const validationResult = configSchema.schema.decode(newConfig);
        if (!isRight(validationResult)) {
            throw new Error(`Invalid config for plugin ${pluginName}: ${JSON.stringify(validationResult.left)}`);
        }

        const oldConfig = { ...configSchema.config };
        Object.assign(configSchema.config, validationResult.right);
        this.saveToStorage();

        this.changeCallbacks.forEach(callback => {
            try {
                callback(pluginName, configSchema.config, oldConfig);
            } catch (error) {
                console.error(`Error in config change callback:`, error);
            }
        });
    }

    getConfigSchema(pluginName: string): PluginConfigSchema | undefined {
        return this.configs.get(pluginName);
    }

    getAllConfigSchemas(): PluginConfigSchema[] {
        return Array.from(this.configs.values());
    }

    hasConfig(pluginName: string): boolean {
        return this.configs.has(pluginName);
    }

    private loadFromStorage(): void {
        try {
            const stored = localStorage.getItem(this.storageKey);
            if (stored) {
                const parsedConfigs = JSON.parse(stored);
                // Store raw configs temporarily, they'll be validated when plugins register
                this.tempStoredConfigs = parsedConfigs;
            }
        } catch (error) {
            console.warn('Failed to load plugin configs from storage:', error);
        }
    }

    private tempStoredConfigs: Record<string, any> = {};

    private saveToStorage(): void {
        try {
            const configsToSave: Record<string, any> = {};
            for (const [name, config] of this.configs.entries()) {
                configsToSave[name] = config.config;
            }
            localStorage.setItem(this.storageKey, JSON.stringify(configsToSave));
        } catch (error) {
            console.warn('Failed to save plugin configs to storage:', error);
        }
    }

    // Used during registration to merge stored configs
    getStoredConfig(pluginName: string): any {
        return this.tempStoredConfigs[pluginName];
    }
}
