import * as t from 'io-ts';
import { isRight } from 'fp-ts/Either';
import { pipe } from 'fp-ts/function';

export interface PluginConfigSchema<T = any> {
    name: string;
    schema: t.Type<T>;
    defaultConfig: T;
    config: T;
}

export class PluginConfigManager {
    private configs = new Map<string, PluginConfigSchema>();
    private storageKey = 'voltex-plugin-configs';

    constructor() {
        this.loadFromStorage();
    }

    loadConfig<T>(pluginName: string, schema: t.Type<T>, defaultConfig: T): T {
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

        return configSchema.config;
    }

    getConfig<T>(pluginName: string): T {
        const config = this.configs.get(pluginName);
        if (!config) {
            throw new Error(`No config registered for plugin: ${pluginName}`);
        }
        return config.config as T;
    }

    updateConfig<T>(pluginName: string, newConfig: T): void {
        const configSchema = this.configs.get(pluginName);
        if (!configSchema) {
            throw new Error(`No config registered for plugin: ${pluginName}`);
        }

        // Validate the new config
        const validationResult = configSchema.schema.decode(newConfig);
        if (!isRight(validationResult)) {
            throw new Error(`Invalid config for plugin ${pluginName}: ${JSON.stringify(validationResult.left)}`);
        }

        // Update the config object in-place to preserve references
        Object.assign(configSchema.config, validationResult.right);
        this.saveToStorage();
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
