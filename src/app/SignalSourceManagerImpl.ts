import type { SignalSource, SignalSourceManager, SignalsAvailableChangedEvent } from '@voltex/plugin-api';

export class SignalSourceManagerImpl implements SignalSourceManager {
    private _available: SignalSource[] = [];
    private _callbacks: ((event: SignalsAvailableChangedEvent) => void)[] = [];

    get available(): SignalSource[] {
        return [...this._available];
    }

    changed(callback: (event: SignalsAvailableChangedEvent) => void): void {
        this._callbacks.push(callback);
    }

    add(...signals: SignalSource[]): void {
        if (signals.length === 0) return;
        
        this._available.push(...signals);
        
        const event: SignalsAvailableChangedEvent = {
            added: [...signals],
            removed: []
        };
        
        this._notifyCallbacks(event);
    }

    remove(...signals: SignalSource[]): void {
        if (signals.length === 0) return;
        
        const removedSignals: SignalSource[] = [];
        
        for (const signal of signals) {
            const index = this._available.findIndex(s => 
                s.name.length === signal.name.length && 
                s.name.every((part, i) => part === signal.name[i])
            );
            
            if (index !== -1) {
                const removed = this._available.splice(index, 1)[0];
                removedSignals.push(removed);
            }
        }
        
        if (removedSignals.length > 0) {
            const event: SignalsAvailableChangedEvent = {
                added: [],
                removed: removedSignals
            };
            
            this._notifyCallbacks(event);
        }
    }

    private _notifyCallbacks(event: SignalsAvailableChangedEvent): void {
        for (const callback of this._callbacks) {
            try {
                callback(event);
            } catch (error) {
                console.error('Error in signal source change callback:', error);
            }
        }
    }
}
