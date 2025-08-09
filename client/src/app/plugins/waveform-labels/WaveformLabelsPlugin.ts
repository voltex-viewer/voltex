import type { PluginContext, Row } from '../../Plugin';
import { HorizontalSeparatorRenderObject } from './HorizontalSeparatorRenderObject';
import { LabelRenderObject } from './LabelRenderObject';

export default (context: PluginContext): void => {
    const signalMetadata = context.signalMetadata;
    let lastSelectedRow: Row | null = null;
    let selectedRows: Set<Row> = new Set();
    let labelRenderObjects: Map<Row, LabelRenderObject> = new Map();
    
    // Set up global event listeners for keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        // Ctrl+G or Cmd+G: Group selected channels
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'g' && !e.shiftKey) {
            e.preventDefault();
            if (selectedRows.size >= 2) {
                const selectedRowsArray = Array.from(selectedRows);
                const rows = context.getRows();
                
                const firstIndex = Math.min(...selectedRowsArray.map(row => rows.indexOf(row)));
                
                // Use spliceRows to remove selected rows and add merged row
                const newRows = context.spliceRows(
                    selectedRowsArray, // rows to remove
                    [{ index: firstIndex, row: { channels: selectedRowsArray.flatMap(row => row.signals) } }] // rows to add
                );
                
                selectedRows = new Set([newRows[0]]);
                updateLabelSelectionStates();
                context.requestRender();
            }
        }
        
        // Ctrl+Shift+G or Cmd+Shift+G: Ungroup selected channels
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'g' && e.shiftKey) {
            e.preventDefault();
            if (selectedRows.size > 0) {
                const selectedRowsArray = Array.from(selectedRows);
                const rows = context.getRows();
                
                // Find row indices for proper positioning
                const firstIndex = Math.min(...selectedRowsArray.map(row => rows.indexOf(row)));

                // Create individual row inserts - each channel gets inserted sequentially
                selectedRows = new Set(context.spliceRows(
                    selectedRowsArray,
                    selectedRowsArray
                        .flatMap(row => row.signals.map(channel => ({ channels: [channel] })))
                        .map(value => ({ index: firstIndex, row: value }))
                ));
                updateLabelSelectionStates();
                context.requestRender();
            }
        }
        
        // Delete key: Remove selected rows
        if (e.key === 'Delete' && selectedRows.size > 0) {
            e.preventDefault();
            context.spliceRows(Array.from(selectedRows), []);
            selectedRows.clear();
            updateLabelSelectionStates();
            context.requestRender();
        }
    });
    
    context.onRowsChanged((event) => {
        // Remove render objects for removed rows
        for (const row of event.removed) {
            labelRenderObjects.delete(row);
        }
        
        // Add render objects for new rows
        for (const row of event.added) {
            const labelRenderObject = new LabelRenderObject(row.signals, signalMetadata);
            labelRenderObjects.set(row, labelRenderObject);
            labelRenderObject.onMouseDown((event) => {
                handleLabelClick(row, event.ctrlKey || event.metaKey, event.shiftKey);
                event.preventDefault();
                event.stopPropagation();
            });
            row.addLabelRenderObject(labelRenderObject);
            row.addRenderObject(new HorizontalSeparatorRenderObject());
        }
    });

    const handleLabelClick = (row: Row, ctrlOrCmd: boolean, shiftKey: boolean): void => {
        if (row.signals.length == 0) return;

        if (shiftKey && lastSelectedRow !== null) {
            // Handle range selection
            const rows = context.getRows();        
            const startIndex = rows.indexOf(lastSelectedRow);
            const endIndex = rows.indexOf(row);
            
            if (startIndex !== -1 && endIndex !== -1) {
                const minIndex = Math.min(startIndex, endIndex);
                const maxIndex = Math.max(startIndex, endIndex);
                
                for (let i = minIndex; i <= maxIndex && i < rows.length; i++) {
                    const currentRow = rows[i];
                    if (currentRow && rows[0] !== currentRow) { // Skip time axis
                        selectedRows.add(currentRow);
                    }
                }
            }
        } else if (ctrlOrCmd) {
            // Handle toggle selection
            if (selectedRows.has(row)) {
                selectedRows.delete(row);
            } else {
                selectedRows.add(row);
            }
        } else {
            // Handle single selection or deselection
            if (selectedRows.size === 1 && selectedRows.has(row)) {
                // If only this row is selected, deselect it
                selectedRows.clear();
                lastSelectedRow = null;
            } else {
                // Otherwise, select only this row
                selectedRows.clear();
                selectedRows.add(row);
                lastSelectedRow = row;
            }
        }

        updateLabelSelectionStates();
        context.requestRender();
    }

    const updateLabelSelectionStates = (): void => {
        for (const [row, labelRenderObject] of labelRenderObjects) {
            labelRenderObject.setSelected(selectedRows.has(row));
        }
    }
};
