import type { Signal } from '@voltex-viewer/plugin-api';

export class SignalMetadataManager {
    private colorMap = new Map<string, string>();
    private readonly defaultColors = [
        '#00eaff', '#ff6b6b', '#51cf66', '#ffd43b', 
        '#845ef7', '#ff8cc8', '#74c0fc', '#ffa8a8',
        '#8ce99a', '#ffec99', '#b197fc', '#ffc9c9'
    ];

    getColor(signal: Signal): string {
        const signalName = signal.source.name[signal.source.name.length - 1];
        let color = this.colorMap.get(signalName);
        if (!color) {
            color = this.generateDefaultColor(signalName);
            this.colorMap.set(signalName, color);
        }
        return color;
    }

    setColor(signal: Signal, color: string): void {
        const signalName = signal.source.name[signal.source.name.length - 1];
        this.colorMap.set(signalName, color);
    }

    private generateDefaultColor(name: string): string {
        let hash = 0;
        for (let i = 0; i < name.length; i++) {
            const char = name.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash;
        }
        
        return this.defaultColors[Math.abs(hash) % this.defaultColors.length];
    }
}
