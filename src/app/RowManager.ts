import { RowImpl } from './RowImpl';

export interface RowChangedEvent {
    added: RowImpl[];
    removed: RowImpl[];
}

export type RowChangedCallback = (event: RowChangedEvent) => void;
