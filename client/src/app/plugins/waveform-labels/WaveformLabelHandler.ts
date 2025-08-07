import type { WaveformState } from '../../WaveformState';
import type { Row, PluginContext } from '../../Plugin';
import { LabelRenderObject } from './LabelRenderObject';
import type { SignalMetadataManager } from '../../SignalMetadataManager';

export class WaveformLabelHandler {
    private state: WaveformState;
    private canvas: HTMLCanvasElement;
    private signalMetadata: SignalMetadataManager;
    private context: PluginContext;
    private lastSelectedRow: Row | null = null;
    private selectedRows: Set<Row> = new Set();
    private labelRenderObjects: Map<Row, LabelRenderObject> = new Map();
    
    // Vertical row resizing state
    private isResizingRowHeight = false;
    private resizeStartY = 0;
    private resizeStartHeight = 0;
    private resizingRow: Row | null = null;
    private readonly minRowHeight = 20;
    private readonly maxRowHeight = 200;

    constructor(
        state: WaveformState, 
        canvas: HTMLCanvasElement, 
        signalMetadata: SignalMetadataManager,
        context: PluginContext
    ) {
        this.state = state;
        this.canvas = canvas;
        this.signalMetadata = signalMetadata;
        this.context = context;
        
        this.canvas.addEventListener('mousedown', this.handleMouseDown);
        this.canvas.addEventListener('mousemove', this.handleMouseMove);
        window.addEventListener('mousemove', this.handleGlobalMouseMove);
        window.addEventListener('mouseup', this.handleMouseUp);
        
        document.addEventListener('keydown', (e) => {
            // Ctrl+G or Cmd+G: Group selected channels
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'g' && !e.shiftKey) {
                e.preventDefault();
                if (this.selectedRows.size >= 2) {
                    const selectedRowsArray = Array.from(this.selectedRows);
                    const rows = this.context.getRows();
                    
                    const firstIndex = Math.min(...selectedRowsArray.map(row => rows.indexOf(row)));
                    
                    // Use spliceRows to remove selected rows and add merged row
                    const newRows = this.context.spliceRows(
                        selectedRowsArray, // rows to remove
                        [{ index: firstIndex, row: { channels: selectedRowsArray.flatMap(row => row.signals) } }] // rows to add
                    );
                    
                    this.selectedRows = new Set([newRows[0]]);
                    this.updateLabelSelectionStates();
                    this.context.requestRender();
                }
            }
            
            // Ctrl+Shift+G or Cmd+Shift+G: Ungroup selected channels
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'g' && e.shiftKey) {
                e.preventDefault();
                if (this.selectedRows.size > 0) {
                    const selectedRowsArray = Array.from(this.selectedRows);
                    const rows = this.context.getRows();
                    
                    // Find row indices for proper positioning
                    const firstIndex = Math.min(...selectedRowsArray.map(row => rows.indexOf(row)));

                    // Create individual row inserts - each channel gets inserted sequentially
                    this.selectedRows = new Set(this.context.spliceRows(
                        selectedRowsArray,
                        selectedRowsArray
                            .flatMap(row => row.signals.map(channel => ({ channels: [channel] })))
                            .map(value => ({ index: firstIndex, row: value }))
                    ));
                    this.updateLabelSelectionStates();
                    this.context.requestRender();
                }
            }
            
            // Delete key: Remove selected rows
            if (e.key === 'Delete' && this.selectedRows.size > 0) {
                e.preventDefault();
                this.context.spliceRows(Array.from(this.selectedRows), []);
                this.selectedRows.clear();
                this.updateLabelSelectionStates();
                this.context.requestRender();
            }
        });
        
        // Listen for row changes from the plugin context
        this.context.onRowsChanged((event) => {
            // Remove render objects for removed rows
            for (const row of event.removed) {
                this.labelRenderObjects.delete(row);
            }
            
            // Add render objects for new rows
            for (const row of event.added) {
                if (!this.labelRenderObjects.has(row)) {
                    const labelRenderObject = new LabelRenderObject(row.signals, this.signalMetadata);
                    this.labelRenderObjects.set(row, labelRenderObject);
                    row.addLabelRenderObject(labelRenderObject);
                }
            }
        });
    }

    private handleMouseDown = (e: MouseEvent): void => {
        const rect = this.canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        
        if (this.isInLabelResizeArea(x, y)) {
            this.state.isResizingLabel = true;
            this.state.resizeStartX = e.clientX;
            this.state.resizeStartWidth = this.state.labelWidth;
            
            document.body.style.cursor = 'ew-resize';
            e.preventDefault();
            e.stopPropagation();
        } else if (this.isInRowResizeArea(x, y)) {
            const row = this.getRowAtBottomBorder(y);
            if (row) {
                this.isResizingRowHeight = true;
                this.state.isResizingRowHeight = true; // Sync with global state to prevent dragging
                this.resizeStartY = e.clientY;
                this.resizeStartHeight = row.height;
                this.resizingRow = row;
                
                document.body.style.cursor = 'ns-resize';
                e.preventDefault();
                e.stopPropagation();
            }
        } else if (this.isInLabelArea(x, y)) {
            const row = this.getRowFromY(y);
            if (row) {
                this.handleLabelClick(row, e.ctrlKey || e.metaKey, e.shiftKey);
                e.preventDefault();
                e.stopPropagation();
            }
        }
    };

    private handleMouseMove = (e: MouseEvent): void => {
        if (this.state.isResizingLabel || this.isResizingRowHeight) return;
        
        const rect = this.canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        
        if (this.isInLabelResizeArea(x, y)) {
            this.canvas.style.cursor = 'ew-resize';
            e.stopPropagation();
        } else if (this.isInRowResizeArea(x, y)) {
            this.canvas.style.cursor = 'ns-resize';
            e.stopPropagation();
        } else {
            this.canvas.style.cursor = '';
        }
    };

    private handleGlobalMouseMove = (e: MouseEvent): void => {
        if (this.state.isResizingLabel) {
            const dx = e.clientX - this.state.resizeStartX;
            const newWidth = Math.max(
                this.state.minLabelWidth, 
                Math.min(this.state.maxLabelWidth, this.state.resizeStartWidth + dx)
            );
            
            if (newWidth !== this.state.labelWidth) {
                this.state.labelWidth = newWidth;
                this.context.requestRender();
            }
        } else if (this.isResizingRowHeight && this.resizingRow) {
            const dy = e.clientY - this.resizeStartY;
            const newHeight = Math.max(
                this.minRowHeight,
                Math.min(this.maxRowHeight, this.resizeStartHeight + dy)
            );
            
            // Set the height of the rows being resized
            if (this.selectedRows.has(this.resizingRow)) {
                for (const row of this.selectedRows) {
                    row.setHeight(newHeight);
                }
            } else {
                this.resizingRow.setHeight(newHeight);
            }
        }
    };

    private handleMouseUp = (): void => {
        if (this.state.isResizingLabel) {
            this.state.isResizingLabel = false;
            document.body.style.cursor = '';
            this.state.resizeStartX = 0;
        } else if (this.isResizingRowHeight) {
            this.isResizingRowHeight = false;
            this.state.isResizingRowHeight = false; // Sync with global state
            this.resizingRow = null;
            document.body.style.cursor = '';
            this.resizeStartY = 0;
        }
    };

    private isInLabelResizeArea(x: number, y: number): boolean {
        const resizeZoneWidth = 5;
        return x >= this.state.labelWidth - resizeZoneWidth && x <= this.state.labelWidth;
    }

    private isInRowResizeArea(x: number, y: number): boolean {
        if (!this.isInLabelArea(x, y)) return false;
        
        const resizeZoneHeight = 5;
        const rows = this.context.getRows();
        let offset = 0;
        
        for (const row of rows) {
            const rowBottom = offset + row.height;
            // Check if y is within the resize zone at the bottom of a row
            if (y >= rowBottom - resizeZoneHeight && y <= rowBottom) {
                return true;
            }
            offset = rowBottom;
        }
        return false;
    }

    private isInLabelArea(x: number, y: number): boolean {
        return x >= 0 && x < this.state.labelWidth;
    }

    private getRowFromY(y: number): Row | null {
        let offset = 0;
        for (const row of this.context.getRows()) {
            if (y < offset + row.height) return row;
            offset += row.height;
        }
        return null;
    }

    private getRowAtBottomBorder(y: number): Row | null {
        const resizeZoneHeight = 5;
        const rows = this.context.getRows();
        let offset = 0;
        
        for (const row of rows) {
            const rowBottom = offset + row.height;
            if (y >= rowBottom - resizeZoneHeight && y <= rowBottom) {
                return row;
            }
            offset = rowBottom;
        }
        return null;
    }

    private handleLabelClick(row: Row, ctrlOrCmd: boolean, shiftKey: boolean): void {
        if (row.signals.length == 0) return;

        const rows = this.context.getRows();        
        if (shiftKey && this.lastSelectedRow !== null) {
            // Handle range selection
            const startIndex = rows.indexOf(this.lastSelectedRow);
            const endIndex = rows.indexOf(row);
            
            if (startIndex !== -1 && endIndex !== -1) {
                const minIndex = Math.min(startIndex, endIndex);
                const maxIndex = Math.max(startIndex, endIndex);
                
                for (let i = minIndex; i <= maxIndex && i < rows.length; i++) {
                    const currentRow = rows[i];
                    if (currentRow && rows[0] !== currentRow) { // Skip time axis
                        this.selectedRows.add(currentRow);
                    }
                }
            }
        } else if (ctrlOrCmd) {
            // Handle toggle selection
            if (this.selectedRows.has(row)) {
                this.selectedRows.delete(row);
            } else {
                this.selectedRows.add(row);
            }
        } else {
            // Handle single selection
            this.selectedRows.clear();
            this.selectedRows.add(row);
            this.lastSelectedRow = row;
        }

        this.updateLabelSelectionStates();
        this.context.requestRender();
    }

    private updateLabelSelectionStates(): void {
        for (const [row, labelRenderObject] of this.labelRenderObjects) {
            labelRenderObject.setSelected(this.selectedRows.has(row));
        }
    }
}
