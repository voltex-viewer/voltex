import type { PluginModule, PluginMetadata } from '@voltex-viewer/plugin-api';

export interface CustomPluginData {
    metadata: PluginMetadata;
    code: string;
    uploadedAt: number;
}

export class CustomPluginStorage {
    private static STORAGE_DIR = 'custom-plugins';
    private root: FileSystemDirectoryHandle | null = null;

    async initialize(): Promise<void> {
        if (typeof navigator.storage?.getDirectory === 'undefined') {
            throw new Error('OPFS not supported in this environment');
        }
        this.root = await navigator.storage.getDirectory();
    }

    private async ensureStorageDir(): Promise<FileSystemDirectoryHandle> {
        if (!this.root) {
            await this.initialize();
        }
        return await this.root!.getDirectoryHandle(CustomPluginStorage.STORAGE_DIR, { create: true });
    }

    async savePlugin(name: string, code: string, metadata: PluginMetadata): Promise<void> {
        const dir = await this.ensureStorageDir();
        
        const pluginData: CustomPluginData = {
            metadata,
            code,
            uploadedAt: Date.now()
        };

        const sanitizedName = this.sanitizeFilename(name);
        const fileHandle = await dir.getFileHandle(`${sanitizedName}.json`, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(JSON.stringify(pluginData));
        await writable.close();
    }

    async getPlugin(name: string): Promise<CustomPluginData | null> {
        try {
            const dir = await this.ensureStorageDir();
            const sanitizedName = this.sanitizeFilename(name);
            const fileHandle = await dir.getFileHandle(`${sanitizedName}.json`);
            const file = await fileHandle.getFile();
            const text = await file.text();
            return JSON.parse(text) as CustomPluginData;
        } catch {
            return null;
        }
    }

    async getAllPlugins(): Promise<Map<string, CustomPluginData>> {
        const plugins = new Map<string, CustomPluginData>();
        
        try {
            const dir = await this.ensureStorageDir();
            
            for await (const entry of dir.values()) {
                if (entry.kind === 'file' && entry.name.endsWith('.json')) {
                    try {
                        const fileHandle = entry as FileSystemFileHandle;
                        const file = await fileHandle.getFile();
                        const text = await file.text();
                        const data = JSON.parse(text) as CustomPluginData;
                        plugins.set(data.metadata.name, data);
                    } catch (error) {
                        console.error(`Failed to load custom plugin from ${entry.name}:`, error);
                    }
                }
            }
        } catch (error) {
            console.error('Failed to load custom plugins:', error);
        }
        
        return plugins;
    }

    async deletePlugin(name: string): Promise<boolean> {
        try {
            const dir = await this.ensureStorageDir();
            const sanitizedName = this.sanitizeFilename(name);
            await dir.removeEntry(`${sanitizedName}.json`);
            return true;
        } catch {
            return false;
        }
    }

    async hasPlugin(name: string): Promise<boolean> {
        const plugin = await this.getPlugin(name);
        return plugin !== null;
    }

    private sanitizeFilename(name: string): string {
        return name.replace(/[^a-z0-9_-]/gi, '_').toLowerCase();
    }

    async loadPluginModule(pluginData: CustomPluginData): Promise<PluginModule> {
        // Create a blob URL from the code to load it as an ES module
        const blob = new Blob([pluginData.code], { type: 'application/javascript' });
        const url = URL.createObjectURL(blob);
        
        try {
            // Import the module dynamically
            const module = await import(/* @vite-ignore */ url);
            
            const pluginFunc = module.default;
            
            if (typeof pluginFunc !== 'function') {
                throw new Error('Plugin does not export a default function');
            }
            
            return {
                plugin: pluginFunc,
                metadata: pluginData.metadata
            };
        } finally {
            URL.revokeObjectURL(url);
        }
    }
}
