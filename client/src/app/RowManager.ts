import { RowImpl } from './RowImpl';
import { Row, RowParameters, RowInsert } from './Plugin';

export interface RowChangedEvent {
    added: RowImpl[];
    removed: RowImpl[];
}

export type RowChangedCallback = (event: RowChangedEvent) => void;

export class RowManager {
    private rows: RowImpl[] = [];
    private changeCallbacks: RowChangedCallback[] = [];
    
    onChange(callback: RowChangedCallback): void {
        this.changeCallbacks.push(callback);
    }

    createRows(...rowParams: RowParameters[]): Row[] {
        const newRows = rowParams.map(({ channels, height }) => {
            const row = new RowImpl(channels, height);
            return row;
        });
        this.rows.push(...newRows);
        this.notifyChange({ added: newRows, removed: [] });
        return newRows;
    }
    
    removeRow(row: RowImpl): void {
        const index = this.rows.indexOf(row);
        if (index !== -1) {
            this.rows.splice(index, 1);
            this.notifyChange({ added: [], removed: [row] });
        }
    }
    
    mergeRows(rowsToMerge: RowImpl[]): RowImpl {
        if (rowsToMerge.length === 0) {
            throw new Error('Cannot merge empty row list');
        }
        
        const firstRowIndex = this.rows.findIndex(r => rowsToMerge.includes(r));
        
        // Collect all channels from rows to merge
        const allChannels = Array.from(new Set(rowsToMerge.flatMap(row => row.signals)));
        
        // Create new merged row
        const mergedRow = new RowImpl(allChannels);

        // Remove old rows and insert new one
        this.rows = this.rows.filter(r => !rowsToMerge.includes(r));
        
        if (firstRowIndex >= 0) {
            this.rows.splice(firstRowIndex, 0, mergedRow);
        } else {
            this.rows.push(mergedRow);
        }
        
        this.notifyChange({ added: [mergedRow], removed: rowsToMerge });
        return mergedRow;
    }
    
    splitRows(rowsToSplit: RowImpl[]): RowImpl[] {
        const newRows: RowImpl[] = [];
        
        for (const row of rowsToSplit) {
            const index = this.rows.indexOf(row);
            if (index !== -1) {
                this.rows.splice(index, 1);
                
                const individualRows = row.signals.map(channel => new RowImpl([channel]));
                this.rows.splice(index, 0, ...individualRows);
                newRows.push(...individualRows);
            }
        }
        
        this.notifyChange({ added: newRows, removed: rowsToSplit });
        return newRows;
    }
    
    spliceRows(rowsToRemove: Row[], rowsToAdd: RowInsert[]): Row[] {
        const removedRows: RowImpl[] = [];
        const addedRows: RowImpl[] = [];
        
        // Remove specified rows
        for (const row of rowsToRemove) {
            const index = this.rows.indexOf(row as RowImpl);
            if (index !== -1) {
                const removed = this.rows.splice(index, 1)[0];
                removedRows.push(removed);
            }
        }
        
        // Add new rows at specified indices (sort by index descending to avoid index shifting)
        const sortedInserts = [...rowsToAdd].sort((a, b) => b.index - a.index);
        for (const insert of sortedInserts) {
            const newRow = new RowImpl(insert.row.channels, insert.row.height);
            const insertIndex = Math.min(insert.index, this.rows.length);
            this.rows.splice(insertIndex, 0, newRow);
            addedRows.push(newRow);
        }
        
        this.notifyChange({ added: addedRows, removed: removedRows });
        return addedRows;
    }
    
    getAllRows(): RowImpl[] {
        return [...this.rows];
    }
    
    getRowCount(): number {
        return this.rows.length;
    }
    
    private notifyChange(event: RowChangedEvent): void {
        for (const callback of this.changeCallbacks) {
            callback(event);
        }
    }
}
