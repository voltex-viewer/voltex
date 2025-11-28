import JSZip from 'jszip';
import type { PluginMetadata } from '@voltex-viewer/plugin-api';

export interface VxpkgManifest extends PluginMetadata {
    voltexApiVersion: string;
    main: string;
}

export interface VxpkgContents {
    manifest: VxpkgManifest;
    code: string;
}

export class VxpkgLoader {
    static async loadFromFile(file: File): Promise<VxpkgContents> {
        const zip = await JSZip.loadAsync(file);
        
        // Read manifest.json
        const manifestFile = zip.file('manifest.json');
        if (!manifestFile) {
            throw new Error('Invalid .vxpkg file: manifest.json not found');
        }
        
        const manifestText = await manifestFile.async('text');
        const manifest: VxpkgManifest = JSON.parse(manifestText);
        
        // Validate manifest
        if (!manifest.name || !manifest.version || !manifest.main) {
            throw new Error('Invalid manifest.json: missing required fields (name, version, main)');
        }
        
        // Read main plugin file
        const mainFile = zip.file(manifest.main);
        if (!mainFile) {
            throw new Error(`Invalid .vxpkg file: main file "${manifest.main}" not found`);
        }
        
        const code = await mainFile.async('text');
        
        return {
            manifest,
            code
        };
    }

    static isValidVxpkgFile(file: File): boolean {
        return file.name.endsWith('.vxpkg') || file.type === 'application/zip';
    }
}
