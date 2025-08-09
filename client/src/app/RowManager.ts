import { RowImpl } from './RowImpl';
import { Row, RowParameters, RowInsert } from './Plugin';
import { RowContainerRenderObject } from './RowContainerRenderObject';

export interface RowChangedEvent {
    added: RowImpl[];
    removed: RowImpl[];
}

export type RowChangedCallback = (event: RowChangedEvent) => void;

export class RowManager {
    private changeCallbacks: RowChangedCallback[] = [];

    constructor(private readonly rowContainer: RowContainerRenderObject) {
    }
    
    onChange(callback: RowChangedCallback): void {
        this.changeCallbacks.push(callback);
    }

    createRows(...rowParams: RowParameters[]): Row[] {
        const newRows = rowParams.map(({ channels, height }) => {
            const row = new RowImpl(channels, height);
            this.rowContainer.addRow(row);
            return row;
        });
        this.notifyChange({ added: newRows, removed: [] });
        return newRows;
    }
    
    removeRow(row: RowImpl): void {
        this.rowContainer.removeRow(row);
        this.notifyChange({ added: [], removed: [row] });
    }
    
    mergeRows(rowsToMerge: RowImpl[]): RowImpl {
        if (rowsToMerge.length === 0) {
            throw new Error('Cannot merge empty row list');
        }
        
        // Use the row container to group rows
        const mergedRow = this.rowContainer.groupRows(rowsToMerge);

        this.notifyChange({ added: [mergedRow], removed: rowsToMerge });
        return mergedRow;
    }
    
    splitRows(rowsToSplit: RowImpl[]): RowImpl[] {
        const newRows: RowImpl[] = [];
        
        for (const row of rowsToSplit) {
            // Use the row container to ungroup rows
            const individualRows = this.rowContainer.ungroupRows([row]);
            newRows.push(...individualRows);
        }
        
        this.notifyChange({ added: newRows, removed: rowsToSplit });
        return newRows;
    }
    
    spliceRows(rowsToRemove: Row[], rowsToAdd: RowInsert[]): Row[] {
        const removedRows: RowImpl[] = [];
        const addedRows: RowImpl[] = [];
        
        // Remove specified rows
        for (const row of rowsToRemove) {
            this.rowContainer.removeRow(row as RowImpl);
            removedRows.push(row as RowImpl);
        }
        
        // Add new rows at specified indices (sort by index descending to avoid index shifting)
        const sortedInserts = [...rowsToAdd].sort((a, b) => b.index - a.index);
        for (const insert of sortedInserts) {
            const newRow = new RowImpl(insert.row.channels, insert.row.height);
            this.rowContainer.insertRowAtIndex(newRow, insert.index);
            addedRows.push(newRow);
        }
        
        this.notifyChange({ added: addedRows, removed: removedRows });
        return addedRows;
    }
    
    getAllRows(): RowImpl[] {
        return this.rowContainer.getAllRows();
    }
    
    private notifyChange(event: RowChangedEvent): void {
        for (const callback of this.changeCallbacks) {
            callback(event);
        }
    }
}
