import { RowImpl } from './rowImpl';

export interface RowChangedEvent {
    added: RowImpl[];
    removed: RowImpl[];
}

export type RowChangedCallback = (event: RowChangedEvent) => void;
