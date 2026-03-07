import { computeIntegrity } from './integrityUtil';

export interface RegistryPlugin {
    name: string;
    displayName?: string;
    version: string;
    description?: string;
    author?: string;
    main: string; // full path relative to repo root, e.g. "plugins/notepad/index.js"
    integrity?: string; // "sha256-<base64>" — computed by CI, verified by Voltex
}

export interface PluginRegistry {
    name: string;
    description?: string;
    plugins: RegistryPlugin[];
}

interface RegistryPluginRef {
    path: string;      // path to plugin directory, e.g. "plugins/notepad"
    main?: string;     // entry file name within that directory, defaults to "index.js"
    integrity?: string;
}

interface RawRegistry {
    name: string;
    description?: string;
    plugins: RegistryPluginRef[];
}

// RFC-1918, loopback, and link-local ranges
const privateHostPatterns = [
    /^localhost$/i,
    /^127\./,
    /^10\./,
    /^192\.168\./,
    /^172\.(1[6-9]|2[0-9]|3[01])\./,
    /^169\.254\./,
    /^::1$/,
    /^\[::1\]$/,
];

export class RegistryClient {
    private static readonly fetchTimeoutMs = 10_000;

    private static fetchWithTimeout(url: string): Promise<Response> {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.fetchTimeoutMs);
        return fetch(url, { signal: controller.signal }).finally(() => clearTimeout(timer));
    }

    private static isPrivateHost(host: string): boolean {
        return privateHostPatterns.some(p => p.test(host));
    }

    // Validates a plugin directory path: no traversal, no leading/trailing slashes, safe chars only
    private static isValidPluginPath(path: string): boolean {
        if (!path || path.startsWith('/') || path.endsWith('/')) return false;
        return path.split('/').every(
            seg => seg.length > 0 && seg !== '.' && seg !== '..' && /^[a-zA-Z0-9_.-]+$/.test(seg)
        );
    }

    // Validates a main filename: bare name only, no path separators
    private static isValidMainFile(name: string): boolean {
        return /^[a-zA-Z0-9_.-]+$/.test(name);
    }

    static parseGitHubUrl(url: string): { host: string; owner: string; repo: string } | null {
        const match = url.match(/^https:\/\/([^/]+)\/([^/]+)\/([^/.]+)/);
        if (!match) return null;
        const host = match[1];
        if (this.isPrivateHost(host)) return null;
        return { host, owner: match[2], repo: match[3] };
    }

    static getRawUrl(host: string, owner: string, repo: string, path: string): string {
        const cleanPath = path.startsWith('/') ? path.slice(1) : path;
        if (host === 'github.com') {
            return `https://raw.githubusercontent.com/${owner}/${repo}/HEAD/${cleanPath}`;
        }
        // GitHub Enterprise Server raw content URL format
        return `https://${host}/${owner}/${repo}/raw/HEAD/${cleanPath}`;
    }

    static async fetchRegistry(repoUrl: string): Promise<PluginRegistry> {
        const parsed = this.parseGitHubUrl(repoUrl);
        if (!parsed) {
            throw new Error(`Invalid GitHub URL: ${repoUrl}`);
        }

        const registryUrl = this.getRawUrl(parsed.host, parsed.owner, parsed.repo, 'voltex-registry.json');
        const response = await this.fetchWithTimeout(registryUrl);

        if (!response.ok) {
            throw new Error(`Failed to fetch registry from ${repoUrl}: ${response.status} ${response.statusText}`);
        }

        const raw: RawRegistry = await response.json();

        if (!raw.name || !Array.isArray(raw.plugins)) {
            throw new Error('Invalid voltex-registry.json: missing required fields (name, plugins)');
        }

        // Fetch all plugin.json files concurrently
        const plugins = await Promise.all(
            raw.plugins.map(ref => this.resolvePlugin(parsed.host, parsed.owner, parsed.repo, ref))
        );

        return {
            name: raw.name,
            description: raw.description,
            plugins: plugins.filter((p): p is RegistryPlugin => p !== null),
        };
    }

    private static async resolvePlugin(
        host: string,
        owner: string,
        repo: string,
        ref: RegistryPluginRef
    ): Promise<RegistryPlugin | null> {
        if (!this.isValidPluginPath(ref.path)) {
            console.error(`Invalid plugin path "${ref.path}": must not contain path traversal or special characters`);
            return null;
        }
        if (ref.main !== undefined && !this.isValidPluginPath(ref.main)) {
            console.error(`Invalid main file "${ref.main}" for plugin at "${ref.path}"`);
            return null;
        }

        // Metadata lives in the plugin's package.json (same convention as Tom's plugins)
        const packageJsonUrl = this.getRawUrl(host, owner, repo, `${ref.path}/package.json`);

        try {
            const response = await this.fetchWithTimeout(packageJsonUrl);
            if (!response.ok) {
                console.error(`Failed to fetch package.json for ${ref.path}: ${response.status}`);
                return null;
            }

            const pkg = await response.json();

            if (!pkg.name || !pkg.version) {
                console.error(`Invalid package.json at ${ref.path}: missing name or version`);
                return null;
            }

            // Validate name: npm naming rules, max 214 chars
            const npmNameRe = /^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/;
            if (typeof pkg.name !== 'string' || pkg.name.length > 214 || !npmNameRe.test(pkg.name)) {
                console.error(`Invalid package name "${pkg.name}" at ${ref.path}`);
                return null;
            }

            // Validate version: semver major.minor.patch with optional pre-release/build
            const semverRe = /^\d+\.\d+\.\d+(?:[-+].{0,200})?$/;
            if (typeof pkg.version !== 'string' || !semverRe.test(pkg.version)) {
                console.error(`Invalid version "${pkg.version}" at ${ref.path}`);
                return null;
            }

            // Clamp description to 500 chars
            if (typeof pkg.description === 'string' && pkg.description.length > 500) {
                pkg.description = pkg.description.slice(0, 500);
            }

            // author can be a string or an npm person object { name, email, url }
            const author = typeof pkg.author === 'string'
                ? pkg.author
                : pkg.author?.name as string | undefined;

            // Entry point priority: registry ref override > package.json main > default
            const mainFile = ref.main ?? pkg.main ?? 'dist/index.js';

            // Validate the resolved entry point regardless of where it came from.
            // Use isValidPluginPath (not isValidMainFile) because mainFile may be a
            // relative sub-path like "dist/index.js" — not a bare filename.
            if (!this.isValidPluginPath(mainFile)) {
                console.error(`Invalid main file "${mainFile}" for plugin at "${ref.path}"`);
                return null;
            }

            return {
                name: pkg.name,
                displayName: pkg.displayName,
                version: pkg.version,
                description: pkg.description,
                author,
                main: `${ref.path}/${mainFile}`,
                integrity: ref.integrity,
            };
        } catch (error) {
            console.error(`Failed to resolve plugin at ${ref.path}:`, error);
            return null;
        }
    }

    static async fetchPluginCode(repoUrl: string, plugin: RegistryPlugin): Promise<string> {
        const parsed = this.parseGitHubUrl(repoUrl);
        if (!parsed) {
            throw new Error(`Invalid GitHub URL: ${repoUrl}`);
        }

        const codeUrl = this.getRawUrl(parsed.host, parsed.owner, parsed.repo, plugin.main);
        const response = await this.fetchWithTimeout(codeUrl);

        if (!response.ok) {
            throw new Error(`Failed to fetch plugin code for "${plugin.name}": ${response.status} ${response.statusText}`);
        }

        const code = await response.text();

        if (!plugin.integrity) {
            throw new Error(`Plugin "${plugin.name}" has no integrity hash in the registry — refusing to install`);
        }

        const computed = await computeIntegrity(code);
        if (computed !== plugin.integrity) {
            throw new Error(`Integrity check failed for "${plugin.name}": downloaded file does not match registry checksum`);
        }

        return code;
    }
}
