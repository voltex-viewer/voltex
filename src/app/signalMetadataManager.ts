import { type Signal, type SignalMetadataManager, type SignalMetadata, RenderMode, DEFAULT_VALUE } from '@voltex-viewer/plugin-api';
import { shortestUniqueSuffixes } from './displayNames';

const defaultColors = [
    '#00eaff', '#ff6b6b', '#51cf66', '#ffd43b',
    '#845ef7', '#ff8cc8', '#74c0fc', '#ffa8a8',
    '#8ce99a', '#ffec99', '#b197fc', '#ffc9c9'
];

function generateDefaultColor(name: string): string {
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
        const char = name.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
    }

    return defaultColors[Math.abs(hash) % defaultColors.length];
}

function metadataKey(signal: Signal): string {
    const name = signal.source.name;
    return (name.length > 1 ? name.slice(1) : name).join('\u0000');
}

type InternalSignalMetadata = {
    color: string | typeof DEFAULT_VALUE;
    renderMode: RenderMode | typeof DEFAULT_VALUE | undefined;
    display: 'decimal' | 'hex' | typeof DEFAULT_VALUE;
};

export class SignalMetadataManagerImpl implements SignalMetadataManager {
    private metadata = new Map<string, InternalSignalMetadata>();
    private displayNames = new Map<Signal, string[]>();

    get(signal: Signal): SignalMetadata {
        const key = metadataKey(signal);
        let internalMetadata = this.metadata.get(key);
        if (!internalMetadata) {
            internalMetadata = {
                color: generateDefaultColor(key),
                renderMode: undefined,
                display: 'decimal',
            };
            this.metadata.set(key, internalMetadata);
        }

        return new Proxy(internalMetadata, {
            get: (target, prop) => {
                if (prop === 'renderMode') {
                    const value = target.renderMode;
                    if (value === DEFAULT_VALUE || value === undefined) {
                        return signal.renderHint;
                    }
                    return value;
                }
                if (prop === 'color') {
                    const value = target.color;
                    if (value === DEFAULT_VALUE) {
                        return generateDefaultColor(key);
                    }
                    return value;
                }
                if (prop === 'display') {
                    const value = target.display;
                    if (value === DEFAULT_VALUE) {
                        return 'decimal';
                    }
                    return value;
                }
                return target[prop as keyof InternalSignalMetadata];
            },
            set: (target, prop, value) => {
                target[prop as keyof InternalSignalMetadata] = value;
                return true;
            },
        }) as SignalMetadata;
    }

    set(signal: Signal, metadata: SignalMetadata): void {
        const existing = this.get(signal);
        Object.assign(existing, metadata);
    }

    displayName(signal: Signal): string[] {
        return this.displayNames.get(signal) ?? [signal.source.name[signal.source.name.length - 1]];
    }

    updatePlottedSignals(signals: Signal[]): void {
        const unique = Array.from(new Set(signals));
        const suffixes = shortestUniqueSuffixes(unique.map(signal => signal.source.name));
        this.displayNames = new Map(unique.map((signal, index) => [signal, suffixes[index]]));
    }
}
