import * as t from 'io-ts';
import { isRight } from 'fp-ts/Either';
import { pipe } from 'fp-ts/function';

export interface PluginConfigSchema<T = any> {
    name: string;
    schema: t.Type<T, any, unknown>;
    defaultConfig: any;
    config: T;
}

export interface ConfigChangeCallback<T = any> {
    (pluginName: string, newConfig: T, oldConfig: T): void;
}

function computeDelta(config: any, defaultConfig: any): any {
    if (typeof config !== 'object' || config === null || typeof defaultConfig !== 'object' || defaultConfig === null) {
        return config === defaultConfig ? undefined : config;
    }
    
    if (Array.isArray(config) || Array.isArray(defaultConfig)) {
        return JSON.stringify(config) === JSON.stringify(defaultConfig) ? undefined : config;
    }
    
    const delta: any = {};
    let hasDifferences = false;
    
    for (const key in config) {
        if (config.hasOwnProperty(key)) {
            const configValue = config[key];
            const defaultValue = defaultConfig[key];
            
            if (typeof configValue === 'object' && configValue !== null && !Array.isArray(configValue) &&
                typeof defaultValue === 'object' && defaultValue !== null && !Array.isArray(defaultValue)) {
                const nestedDelta = computeDelta(configValue, defaultValue);
                if (nestedDelta !== undefined) {
                    delta[key] = nestedDelta;
                    hasDifferences = true;
                }
            } else if (JSON.stringify(configValue) !== JSON.stringify(defaultValue)) {
                delta[key] = configValue;
                hasDifferences = true;
            }
        }
    }
    
    return hasDifferences ? delta : undefined;
}

function validateAndMergeWithDefaults<A>(delta: any, defaultConfig: any, schema: t.Type<A, any, unknown>): A {
    if (!delta) {
        return { ...defaultConfig } as A;
    }
    
    // Try validating the entire merged config first (shallow merge for top-level test)
    const naiveMerge = { ...defaultConfig };
    for (const key in delta) {
        if (delta.hasOwnProperty(key)) {
            naiveMerge[key] = delta[key];
        }
    }
    
    const fullValidation = schema.decode(naiveMerge);
    if (isRight(fullValidation)) {
        return fullValidation.right;
    }
    
    // If full validation fails, validate property by property, bottom-up
    const result: any = { ...defaultConfig };
    
    for (const key in delta) {
        if (delta.hasOwnProperty(key)) {
            const deltaValue = delta[key];
            const defaultValue = defaultConfig[key];
            
            // If both are plain objects (not arrays), recurse
            if (typeof deltaValue === 'object' && deltaValue !== null && !Array.isArray(deltaValue) &&
                typeof defaultValue === 'object' && defaultValue !== null && !Array.isArray(defaultValue)) {
                
                // Recursively merge nested object
                const mergedNested = { ...defaultValue };
                for (const nestedKey in deltaValue) {
                    if (deltaValue.hasOwnProperty(nestedKey)) {
                        mergedNested[nestedKey] = deltaValue[nestedKey];
                    }
                }
                
                // Test if this nested merge is valid
                const testConfig = { ...defaultConfig, [key]: mergedNested };
                const validation = schema.decode(testConfig);
                
                if (isRight(validation)) {
                    result[key] = mergedNested;
                } else {
                    // Try property by property within the nested object
                    const nestedResult = { ...defaultValue };
                    for (const nestedKey in deltaValue) {
                        if (deltaValue.hasOwnProperty(nestedKey)) {
                            const testNested = { ...defaultValue, [nestedKey]: deltaValue[nestedKey] };
                            const testConfig = { ...defaultConfig, [key]: testNested };
                            const nestedValidation = schema.decode(testConfig);
                            
                            if (isRight(nestedValidation)) {
                                nestedResult[nestedKey] = deltaValue[nestedKey];
                            }
                        }
                    }
                    result[key] = nestedResult;
                }
            } else {
                // Non-object value, test directly
                const testConfig = { ...defaultConfig, [key]: deltaValue };
                const validation = schema.decode(testConfig);
                
                if (isRight(validation)) {
                    result[key] = deltaValue;
                }
                // If invalid, keep the default value already in result
            }
        }
    }
    
    return result as A;
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

    loadConfig<A, O = A, I = unknown>(pluginName: string, schema: t.Type<A, O, I>, defaultConfig: O): A {
        const isFirstLoad = !this.configs.has(pluginName);
        
        // Get stored delta from localStorage
        const storedDelta = this.tempStoredConfigs[pluginName];
        
        // Validate and merge delta with defaults (validation happens during merge)
        const validConfig = validateAndMergeWithDefaults(storedDelta, defaultConfig, schema as t.Type<A, any, unknown>);

        const configSchema: PluginConfigSchema<A> = {
            name: pluginName,
            schema: schema as t.Type<A, any, unknown>,
            defaultConfig,
            config: validConfig
        };

        this.configs.set(pluginName, configSchema);

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

        return validConfig;
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
            for (const [name, configSchema] of this.configs.entries()) {
                const delta = computeDelta(configSchema.config, configSchema.defaultConfig);
                if (delta !== undefined) {
                    configsToSave[name] = delta;
                }
            }
            localStorage.setItem(this.storageKey, JSON.stringify(configsToSave));
        } catch (error) {
            console.warn('Failed to save plugin configs to storage:', error);
        }
    }

    exportAllConfigs(): Record<string, any> {
        try {
            const stored = localStorage.getItem(this.storageKey);
            return stored ? JSON.parse(stored) : {};
        } catch (error) {
            console.warn('Failed to export plugin configs:', error);
            return {};
        }
    }

    importAllConfigs(configs: Record<string, any>): void {
        try {
            // Write directly to localStorage
            localStorage.setItem(this.storageKey, JSON.stringify(configs));
            
            // Reload all registered configs from the new localStorage data
            this.tempStoredConfigs = configs;
            
            for (const [pluginName, configSchema] of this.configs.entries()) {
                const storedDelta = configs[pluginName];
                const validConfig = validateAndMergeWithDefaults(storedDelta, configSchema.defaultConfig, configSchema.schema);
                
                const oldConfig = { ...configSchema.config };
                configSchema.config = validConfig;
                
                // Trigger callbacks for the change
                this.changeCallbacks.forEach(callback => {
                    try {
                        callback(pluginName, validConfig, oldConfig);
                    } catch (error) {
                        console.error(`Error in config change callback:`, error);
                    }
                });
            }
        } catch (error) {
            console.warn('Failed to import plugin configs:', error);
            throw error;
        }
    }
}
