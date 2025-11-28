import * as t from 'io-ts';
import { isRight } from 'fp-ts/Either';

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
type JsonObject = { [key: string]: JsonValue };

export interface PluginConfigSchema<T = unknown> {
    name: string;
    schema: t.Type<T, unknown, unknown>;
    defaultConfig: unknown;
    config: T;
}

export interface ConfigChangeCallback<T = unknown> {
    (pluginName: string, newConfig: T, oldConfig: T): void;
}

function computeDelta(config: unknown, defaultConfig: unknown): unknown {
    if (typeof config !== 'object' || config === null || typeof defaultConfig !== 'object' || defaultConfig === null) {
        return config === defaultConfig ? undefined : config;
    }
    
    if (Array.isArray(config) || Array.isArray(defaultConfig)) {
        return JSON.stringify(config) === JSON.stringify(defaultConfig) ? undefined : config;
    }
    
    const delta: JsonObject = {};
    let hasDifferences = false;
    
    const configObj = config as Record<string, unknown>;
    const defaultObj = defaultConfig as Record<string, unknown>;
    
    for (const key in configObj) {
        if (Object.hasOwn(configObj, key)) {
            const configValue = configObj[key];
            const defaultValue = defaultObj[key];
            
            if (typeof configValue === 'object' && configValue !== null && !Array.isArray(configValue) &&
                typeof defaultValue === 'object' && defaultValue !== null && !Array.isArray(defaultValue)) {
                const nestedDelta = computeDelta(configValue, defaultValue);
                if (nestedDelta !== undefined) {
                    delta[key] = nestedDelta as JsonValue;
                    hasDifferences = true;
                }
            } else if (JSON.stringify(configValue) !== JSON.stringify(defaultValue)) {
                delta[key] = configValue as JsonValue;
                hasDifferences = true;
            }
        }
    }
    
    return hasDifferences ? delta : undefined;
}

function validateAndMergeWithDefaults<A>(delta: unknown, defaultConfig: unknown, schema: t.Type<A, unknown, unknown>): A {
    if (!delta) {
        return JSON.parse(JSON.stringify(defaultConfig)) as A;
    }
    
    // Deep merge helper
    function deepMerge(target: unknown, source: unknown): unknown {
        if (typeof source !== 'object' || source === null || Array.isArray(source)) {
            return source;
        }
        
        const targetObj = (typeof target === 'object' && target !== null) ? target as Record<string, unknown> : {};
        const sourceObj = source as Record<string, unknown>;
        const result: Record<string, unknown> = { ...targetObj };
        for (const key in sourceObj) {
            if (Object.hasOwn(sourceObj, key)) {
                const sourceValue = sourceObj[key];
                const targetValue = targetObj[key];
                if (typeof sourceValue === 'object' && sourceValue !== null && !Array.isArray(sourceValue) &&
                    typeof targetValue === 'object' && targetValue !== null && !Array.isArray(targetValue)) {
                    result[key] = deepMerge(targetValue, sourceValue);
                } else {
                    result[key] = sourceValue;
                }
            }
        }
        return result;
    }

    // Try validating the entire merged config first
    const naiveMerge = deepMerge(defaultConfig, delta);
    
    const fullValidation = schema.decode(naiveMerge);
    if (isRight(fullValidation)) {
        return fullValidation.right;
    }
    
    // If full validation fails, validate property by property, bottom-up
    const result: Record<string, unknown> = JSON.parse(JSON.stringify(defaultConfig));
    const deltaObj = delta as Record<string, unknown>;
    const defaultObj = defaultConfig as Record<string, unknown>;
    
    for (const key in deltaObj) {
        if (Object.hasOwn(deltaObj, key)) {
            const deltaValue = deltaObj[key];
            const defaultValue = defaultObj[key];
            
            // If both are plain objects (not arrays), recurse
            if (typeof deltaValue === 'object' && deltaValue !== null && !Array.isArray(deltaValue) &&
                typeof defaultValue === 'object' && defaultValue !== null && !Array.isArray(defaultValue)) {
                
                // Recursively merge nested object using deep merge
                const mergedNested = deepMerge(defaultValue, deltaValue);
                
                // Test if this nested merge is valid
                const testConfig = deepMerge(defaultConfig, { [key]: mergedNested });
                const validation = schema.decode(testConfig);
                
                if (isRight(validation)) {
                    result[key] = mergedNested;
                } else {
                    // Try property by property within the nested object
                    const nestedResult: Record<string, unknown> = JSON.parse(JSON.stringify(defaultValue));
                    const deltaValueObj = deltaValue as Record<string, unknown>;
                    for (const nestedKey in deltaValueObj) {
                        if (Object.hasOwn(deltaValueObj, nestedKey)) {
                            const testNested = deepMerge(defaultValue, { [nestedKey]: deltaValueObj[nestedKey] });
                            const testConfig = deepMerge(defaultConfig, { [key]: testNested });
                            const nestedValidation = schema.decode(testConfig);
                            
                            if (isRight(nestedValidation)) {
                                nestedResult[nestedKey] = deltaValueObj[nestedKey];
                            }
                        }
                    }
                    result[key] = nestedResult;
                }
            } else {
                // Non-object value, test directly
                const testConfig = deepMerge(defaultConfig, { [key]: deltaValue });
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
        const validConfig = validateAndMergeWithDefaults(storedDelta, defaultConfig, schema as t.Type<A, unknown, unknown>);

        const configSchema: PluginConfigSchema<A> = {
            name: pluginName,
            schema: schema as t.Type<A, unknown, unknown>,
            defaultConfig,
            config: validConfig
        };

        this.configs.set(pluginName, configSchema as PluginConfigSchema);

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

        const oldConfig = { ...(configSchema.config as object) };
        Object.assign(configSchema.config as object, validationResult.right as object);
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

    private tempStoredConfigs: Record<string, unknown> = {};

    private saveToStorage(): void {
        try {
            const configsToSave: Record<string, unknown> = {};
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

    exportAllConfigs(): Record<string, unknown> {
        try {
            const stored = localStorage.getItem(this.storageKey);
            return stored ? JSON.parse(stored) as Record<string, unknown> : {};
        } catch (error) {
            console.warn('Failed to export plugin configs:', error);
            return {};
        }
    }

    importAllConfigs(configs: Record<string, unknown>): void {
        try {
            // Write directly to localStorage
            localStorage.setItem(this.storageKey, JSON.stringify(configs));
            
            // Reload all registered configs from the new localStorage data
            this.tempStoredConfigs = configs;
            
            for (const [pluginName, configSchema] of this.configs.entries()) {
                const storedDelta = configs[pluginName];
                const validConfig = validateAndMergeWithDefaults(storedDelta, configSchema.defaultConfig, configSchema.schema);
                
                const oldConfig = { ...(configSchema.config as object) };
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
