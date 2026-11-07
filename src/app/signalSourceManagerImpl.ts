import type { SignalBackend, SignalSource, SignalSourceManager, SignalsAvailableChangedEvent } from '@voltex-viewer/plugin-api';
import { bigPush } from './bigPush';
import type { SignalCache } from './signalCache';

export class SignalSourceManagerImpl implements SignalSourceManager {
    private internalAvailable: SignalSource[] = [];
    private callbacks: ((event: SignalsAvailableChangedEvent) => void)[] = [];

    constructor(private readonly cache: SignalCache) {}

    wrap(sources: SignalSource<SignalBackend>[]): SignalSource[] {
        return sources.map(source => this.cache.source(source));
    }

    get available(): SignalSource[] {
        return [...this.internalAvailable];
    }

    changed(callback: (event: SignalsAvailableChangedEvent) => void): void {
        this.callbacks.push(callback);
    }

    add(sources: SignalSource<SignalBackend>[]): void {
        if (sources.length === 0) return;
        const signals = this.wrap(sources);
        
        bigPush(this.internalAvailable, signals);
        
        const event: SignalsAvailableChangedEvent = {
            added: [...signals],
            removed: []
        };
        
        this.notifyCallbacks(event);
    }

    remove(signals: SignalSource<SignalBackend>[]): void {
        if (signals.length === 0) return;
        
        const removedSignals: SignalSource[] = [];
        
        for (const signal of signals) {
            const index = this.internalAvailable.findIndex(s => 
                s.name.length === signal.name.length && 
                s.name.every((part, i) => part === signal.name[i])
            );
            
            if (index !== -1) {
                const removed = this.internalAvailable.splice(index, 1)[0];
                removedSignals.push(removed);
            }
        }
        
        if (removedSignals.length > 0) {
            const event: SignalsAvailableChangedEvent = {
                added: [],
                removed: removedSignals
            };
            
            this.notifyCallbacks(event);
        }
    }

    private notifyCallbacks(event: SignalsAvailableChangedEvent): void {
        for (const callback of this.callbacks) {
            try {
                callback(event);
            } catch (error) {
                console.error('Error in signal source change callback:', error);
            }
        }
    }
}
