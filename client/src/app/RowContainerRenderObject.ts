import { ContainerRenderObject } from './ContainerRenderObject';
import { RowImpl } from './RowImpl';
import type { WaveformState } from './WaveformState';
import { px, RenderBounds, RenderContext, RenderObject, type MouseEvent, type WheelEvent } from './RenderObject';
import { RowChangedCallback } from './RowManager';
import { RowInsert, RowParameters } from './Plugin';

type ResizeState = 
    | { type: 'none' }
    | { type: 'horizontal'; startX: number }
    | { type: 'vertical'; startY: number; row: RowImpl }
    | { type: 'time-offset'; startX: number; startTimeAtCursor: number; lastX: number; lastTime: number; velocity: number }
    | { type: 'dragging-rows'; draggedRows: RowImpl[]; startY: number; offsetY: number; offsetX: number; insertIndex: number }
    | { type: 'potential-row-drag'; row: RowImpl; startX: number; startY: number; event: MouseEvent };

export class RowContainerRenderObject extends RenderObject {
    private rows: RowImpl[] = [];
    private changeCallbacks: RowChangedCallback[] = [];
    
    // Unified state for resizing and dragging
    private resizeState: ResizeState = { type: 'none' };
    
    // Selection state
    private selectedRows: Set<RowImpl> = new Set();
    private lastSelectedRow: RowImpl | null = null;
    
    private labelWidth = 100; // initial label width in pixels

    // Animation frame for momentum scrolling
    private animationFrame: number | null = null;
    private readonly decay = 0.85; // friction per frame (faster decay)
    private readonly minVelocity = 0.1; // px/frame threshold to stop
    
    // Constants
    private readonly minLabelWidth = 40;
    private readonly maxLabelWidth = 400;
    private readonly minRowHeight = 20;
    private readonly maxRowHeight = 200;
    private readonly rowVerticalBorder = 1;
    private readonly resizeZoneWidth = 5;
    private readonly resizeZoneHeight = 5;
    private readonly minPxPerSecond = 1e-9;
    private readonly maxPxPerSecond = 1e12;
    private readonly dragThreshold = 5; // pixels to move before starting drag

    constructor(
        private state: WaveformState,
        private requestRender: () => void
    ) {
        super();

        // Create a high z-order overlay to intercept resize events
        const resizeOverlay = new ContainerRenderObject(1000);
        
        // Set up mouse event handlers on the overlay
        resizeOverlay.onMouseDown((event: MouseEvent) => {
            const mousePosition = this.getMousePosition(event);
            
            if (mousePosition.type !== 'none') {
                if (mousePosition.type === 'horizontal') {
                    this.resizeState = { 
                        type: 'horizontal', 
                        startX: event.clientX - this.labelWidth 
                    };
                    
                    document.body.style.cursor = 'ew-resize';
                } else if (mousePosition.type === 'vertical') {
                    this.resizeState = { 
                        type: 'vertical', 
                        startY: event.clientY - mousePosition.row.height,
                        row: mousePosition.row
                    };

                    document.body.style.cursor = 'ns-resize';
                }
                event.preventDefault();
                event.stopPropagation();
                this.requestRender();
            } else {
                // Don't start panning if clicking in the label area
                if (event.clientX < this.labelWidth) return;
                
                // Start drag-to-scroll
                const mouseXInViewport = event.clientX - this.labelWidth;
                const timeAtCursor = (this.state.offset + mouseXInViewport) / this.state.pxPerSecond;
                
                this.resizeState = {
                    type: 'time-offset',
                    startX: event.clientX,
                    startTimeAtCursor: timeAtCursor,
                    lastX: event.clientX,
                    lastTime: performance.now(),
                    velocity: 0
                };
                
                if (this.animationFrame !== null) {
                    cancelAnimationFrame(this.animationFrame);
                    this.animationFrame = null;
                }
                event.preventDefault();
                
                // Set up global mouse move and up handlers
                this.setupGlobalDragHandlers();
            }
        });
        
        resizeOverlay.onMouseMove((event: MouseEvent) => {
            // Handle ongoing resize operations
            if (this.resizeState.type === 'horizontal') {
                const newWidth = Math.max(
                    this.minLabelWidth, 
                    Math.min(this.maxLabelWidth, event.clientX - this.resizeState.startX)
                );
                
                if (newWidth !== this.labelWidth) {
                    this.labelWidth = newWidth;
                    this.updateViewportWidths();
                    this.requestRender();
                }
            } else if (this.resizeState.type === 'vertical') {
                const height = event.clientY - this.resizeState.startY;
                const newHeight = Math.max(
                    this.minRowHeight,
                    Math.min(this.maxRowHeight, height)
                );
                
                if (newHeight !== this.resizeState.row.height) {
                    this.resizeState.row.setHeight(newHeight);
                    this.updateRowPositions();
                    this.requestRender();
                }
            } else if (this.resizeState.type !== 'dragging-rows') {
                // No ongoing operation, show the available operations (but not during row drag)
                const mousePosition = this.getMousePosition(event);
                document.body.style.cursor = 
                    mousePosition.type === 'horizontal' ? 'ew-resize' :
                    mousePosition.type === 'vertical' ? 'ns-resize' : '';
            }
        });
        
        resizeOverlay.onMouseUp((_event: MouseEvent) => {
            if (this.resizeState.type === 'horizontal') {
                this.requestRender();
                this.resizeState = { type: 'none' };
            }
            else if (this.resizeState.type === 'vertical') {
                this.requestRender();
                this.resizeState = { type: 'none' };
            }
        });
        resizeOverlay.onMouseLeave(() => {
            document.body.style.cursor = '';
        });

        resizeOverlay.onWheel((event: WheelEvent) => {
            event.preventDefault();
            const zoomFactor = 1.25;
            const oldPxPerSecond = this.state.pxPerSecond;
            
            if (event.deltaY < 0) {
                this.state.pxPerSecond = Math.min(this.maxPxPerSecond, this.state.pxPerSecond * zoomFactor);
            } else {
                this.state.pxPerSecond = Math.max(this.minPxPerSecond, this.state.pxPerSecond / zoomFactor);
            }
            
            const mouseX = event.clientX - this.labelWidth;
            const mouseTime = (this.state.offset + mouseX) / oldPxPerSecond;
            this.state.offset = mouseTime * this.state.pxPerSecond - mouseX;
            
            this.requestRender();
        });

        this.addChild(resizeOverlay);
            
        // Set up global event listeners for keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            if (e.key === 'a' && (e.ctrlKey || e.metaKey)) {
                // Select all rows
                e.preventDefault();
                for (const row of this.rows.filter(r => r.signals.length > 0)) {
                    this.selectedRows.add(row);
                    row.selected = true;
                }
                this.requestRender();
            } else if (e.key === 'Escape') {
                // Clear selection
                for (const row of this.selectedRows) {
                    row.selected = false;
                }
                this.selectedRows.clear();
                this.requestRender();
            }
            else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'g' && !e.shiftKey) {
                // Ctrl+G or Cmd+G: Group selected channels
                e.preventDefault();
                if (this.selectedRows.size >= 2) {
                    const selectedRowsArray = this.getSelectedRowsInOrder();
                    const firstIndex = Math.min(...selectedRowsArray.map(row => this.rows.indexOf(row)));
                    
                    // Use spliceRows to remove selected rows and add merged row
                    this.selectedRows = new Set(this.spliceRows(
                        selectedRowsArray, // rows to remove
                        [{ index: firstIndex, row: { channels: selectedRowsArray.flatMap(row => row.signals) } }] // rows to add
                    ));

                    for (const row of this.selectedRows) {
                        row.selected = true;
                    }
                    requestRender();
                }
            } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'g' && e.shiftKey) {
                // Ctrl+Shift+G or Cmd+Shift+G: Ungroup selected channels
                e.preventDefault();
                if (this.selectedRows.size > 0) {
                    const selectedRowsArray = this.getSelectedRowsInOrder();
                    const firstIndex = Math.min(...selectedRowsArray.map(row => this.rows.indexOf(row)));

                    // Create individual row inserts - each channel gets inserted sequentially
                    this.selectedRows = new Set(this.spliceRows(
                        selectedRowsArray,
                        selectedRowsArray
                            .flatMap(row => row.signals.map(channel => ({ channels: [channel] })))
                            .map(value => ({ index: firstIndex, row: value }))
                    ));
                    for (const row of this.selectedRows) {
                        row.selected = true;
                    }
                    requestRender();
                }
            } else if (e.key === 'Delete' && this.selectedRows.size > 0) {
                // Delete key: Remove selected rows
                e.preventDefault();
                this.spliceRows(this.getSelectedRowsInOrder(), []);
                this.selectedRows.clear();
                requestRender();
            }
        });
    }

    private getSelectedRowsInOrder(): RowImpl[] {
        // Convert Set to array sorted by row position in this.rows
        return this.rows.filter(row => this.selectedRows.has(row));
    }

    private handleRowMouseDown(row: RowImpl, event: MouseEvent): void {
        const handleRowClick = (row: RowImpl, event: MouseEvent): void => {
            if (event.ctrlKey || event.metaKey) {
                // Toggle selection
                if (row.selected) {
                    this.selectedRows.delete(row);
                    row.selected = false;
                } else {
                    this.selectedRows.add(row);
                    row.selected = true;
                }
                this.lastSelectedRow = row;
            } else if (event.shiftKey && this.lastSelectedRow) {
                // Range selection
                const fromIndex = this.rows.indexOf(this.lastSelectedRow);
                const toIndex = this.rows.indexOf(row);
                const startIndex = Math.min(fromIndex, toIndex);
                const endIndex = Math.max(fromIndex, toIndex);
                
                // Select range
                for (let i = startIndex; i <= endIndex; i++) {
                    const rowToSelect = this.rows[i];
                    this.selectedRows.add(rowToSelect);
                    rowToSelect.selected = true;
                }
            } else {
                // Single selection
                if (this.selectedRows.size == 1 && this.selectedRows.has(row)) {
                    // If this is the only selected row, deselect it
                    row.selected = false;
                    this.selectedRows.clear();
                    this.lastSelectedRow = null;
                } else {
                    // Otherwise select it
                    for (const row of this.selectedRows) {
                        row.selected = false;
                    }
                    this.selectedRows.clear();
                    this.selectedRows.add(row);
                    row.selected = true;
                    this.lastSelectedRow = row;
                }
            }
            
            this.requestRender();
        }

        // Don't handle selection/drag with modifier keys for drag (they're for selection)
        if (!event.ctrlKey && !event.metaKey && !event.shiftKey) {
            // Store initial click position for potential drag
            this.resizeState = {
                type: 'potential-row-drag',
                row: row,
                startX: event.clientX,
                startY: event.clientY,
                event: event
            };
            
            // Set up temporary global handlers to detect drag vs click
            const handleMouseMove = (e: globalThis.MouseEvent) => {
                if (this.resizeState.type !== 'potential-row-drag') return;
                
                const deltaX = e.clientX - this.resizeState.startX;
                const deltaY = e.clientY - this.resizeState.startY;

                if (Math.sqrt(deltaX * deltaX + deltaY * deltaY) > this.dragThreshold) {
                    // Exceeded threshold, start drag
                    window.removeEventListener('mousemove', handleMouseMove);
                    window.removeEventListener('mouseup', handleMouseUp);
                    this.startRowDrag(this.resizeState.row, this.resizeState.event);
                }
            };
            
            const handleMouseUp = () => {
                if (this.resizeState.type !== 'potential-row-drag') return;
                
                // Mouse up without exceeding threshold, treat as click
                window.removeEventListener('mousemove', handleMouseMove);
                window.removeEventListener('mouseup', handleMouseUp);
                
                const clickedRow = this.resizeState.row;
                const originalEvent = this.resizeState.event;
                this.resizeState = { type: 'none' };
                
                // Handle as normal selection
                handleRowClick(clickedRow, originalEvent);
            };
            
            window.addEventListener('mousemove', handleMouseMove);
            window.addEventListener('mouseup', handleMouseUp);
        } else {
            // Handle modifier key selections immediately
            handleRowClick(row, event);
        }
    }

    private setupGlobalDragHandlers(): void {
        const handleMouseMove = (e: globalThis.MouseEvent) => {
            if (this.resizeState.type !== 'time-offset') return;
            
            const now = performance.now();
            
            // Calculate new offset based on constant time at cursor
            const currentMouseXInViewport = e.clientX - this.labelWidth;
            this.state.offset = this.resizeState.startTimeAtCursor * this.state.pxPerSecond - currentMouseXInViewport;

            const velocity = (e.clientX - this.resizeState.lastX) / (now - this.resizeState.lastTime + 0.0001);
            
            this.resizeState = {
                ...this.resizeState,
                lastX: e.clientX,
                lastTime: now,
                velocity: velocity
            };
            
            this.requestRender();
        };

        const handleMouseUp = () => {
            if (this.resizeState.type !== 'time-offset') return;
            
            // Handle momentum scrolling
            let pxPerFrame = this.resizeState.velocity * 16.67;
            if (Math.abs(pxPerFrame) > this.minVelocity) {
                const animate = () => {
                    pxPerFrame *= this.decay;
                    this.state.offset = this.state.offset - pxPerFrame;
                    this.requestRender();
                    if (Math.abs(pxPerFrame) > this.minVelocity) {
                        this.animationFrame = requestAnimationFrame(animate);
                    } else {
                        this.animationFrame = null;
                    }
                };
                this.animationFrame = requestAnimationFrame(animate);
            }
            
            this.resizeState = { type: 'none' };
            
            // Clean up global handlers
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        };

        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseup', handleMouseUp);
    }

    private startRowDrag(clickedRow: RowImpl, event: MouseEvent): void {
        // Determine which rows to drag
        const rowsToDrag = clickedRow.selected && this.selectedRows.size > 0 
            ? this.getSelectedRowsInOrder()
            : [clickedRow];
        
        // Clear selection if dragging a single unselected row
        if (!clickedRow.selected) {
            for (const row of this.selectedRows) {
                row.selected = false;
            }
            this.selectedRows.clear();
            this.lastSelectedRow = null;
        }

        // Calculate offset from first dragged row to clicked row
        let offsetToClickedRow = 0;
        for (let i = 0; i < rowsToDrag.indexOf(clickedRow); i++) {
            offsetToClickedRow += rowsToDrag[i].height;
        }
        
        const clickedRowBounds = clickedRow.rowRenderObject.getAbsoluteBounds();
        
        this.resizeState = {
            type: 'dragging-rows',
            draggedRows: rowsToDrag,
            startY: event.clientY,
            offsetY: event.clientY - (clickedRowBounds.y - offsetToClickedRow),
            offsetX: event.clientX - clickedRowBounds.x,
            insertIndex: this.rows.indexOf(rowsToDrag[0])
        };

        // Set up global mouse handlers
        this.setupGlobalRowDragHandlers();
        
        // Set visual feedback
        document.body.style.cursor = 'grabbing';
        
        this.requestRender();
    }

    private setupGlobalRowDragHandlers(): void {
        const handleMouseMove = (e: globalThis.MouseEvent) => {
            if (this.resizeState.type !== 'dragging-rows') return;

            const dragState = this.resizeState; // Capture resizeState so that the closure knows the type

            const calculateInsertIndex = (mouseY: number): number => {
                let currentY = 0;
                let insertIndex = 0;
                
                for (const row of this.rows) {
                    if (dragState.draggedRows.includes(row)) {
                        insertIndex++;
                        continue;
                    }
                    
                    if (mouseY < currentY + row.height / 2) {
                        return insertIndex;
                    }
                    
                    currentY += row.height;
                    insertIndex++;
                }
                
                return this.rows.length;
            }
            
            const mouseX = e.clientX - dragState.offsetX;
            const mouseY = e.clientY - dragState.offsetY;
            
            // Update dragged rows positions
            let currentY = mouseY;
            for (const row of dragState.draggedRows) {
                row.rowRenderObject.x = px(mouseX); // Use the offset-corrected mouse position
                row.rowRenderObject.y = px(currentY);
                row.rowRenderObject.zIndex = 1000; // Bring to front
                currentY += row.height;
            }
            
            // Calculate where to insert the rows
            const insertIndex = calculateInsertIndex(mouseY);
            if (insertIndex !== dragState.insertIndex) {
                this.resizeState = {
                    ...dragState,
                    insertIndex
                };
                this.updateRowPositionsForDrag();
            }
            
            this.requestRender();
        };

        const handleMouseUp = () => {
            if (this.resizeState.type !== 'dragging-rows') return;
            
            // Finalize the row reordering
            this.finalizeDraggedRows();
            
            // Reset cursor
            document.body.style.cursor = '';
            
            // Clean up global handlers
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        };

        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseup', handleMouseUp);
    }

    private updateRowPositionsForDrag(): void {
        if (this.resizeState.type !== 'dragging-rows') return;
        
        
        // Count how many dragged rows come before the insert index to adjust it
        let draggedRowsBeforeInsert = 0;
        for (let i = 0; i < this.resizeState.insertIndex && i < this.rows.length; i++) {
            if (this.resizeState.draggedRows.includes(this.rows[i])) {
                draggedRowsBeforeInsert++;
            }
        }
        const adjustedInsertIndex = this.resizeState.insertIndex - draggedRowsBeforeInsert;

        // Calculate total height of dragged rows
        const draggedHeight = this.resizeState.draggedRows.reduce((sum, row) => sum + row.height, 0);

        let currentY = 0;
        let visualIndex = 0; // Index among non-dragged rows
        for (const row of this.rows) {
            // Skip positioning dragged rows (they follow the mouse)
            if (this.resizeState.draggedRows.includes(row)) {
                continue;
            }
            
            // If we've reached the insert position, leave space for dragged rows
            if (visualIndex === adjustedInsertIndex) {
                currentY += draggedHeight;
            }

            row.rowRenderObject.y = px(currentY);
            
            currentY += row.height;
            visualIndex++; // Only increment for non-dragged rows
        }
    }

    private finalizeDraggedRows(): void {
        if (this.resizeState.type !== 'dragging-rows') return;
        
        const { draggedRows, insertIndex } = this.resizeState;
        
        // Remove dragged rows and calculate adjusted insert index
        let adjustedInsertIndex = insertIndex;
        for (const row of draggedRows) {
            const currentIndex = this.rows.indexOf(row);
            if (currentIndex < insertIndex) {
                adjustedInsertIndex--;
            }
            this.rows.splice(currentIndex, 1);
        }
        
        // Insert at adjusted position
        this.rows.splice(adjustedInsertIndex, 0, ...draggedRows);
        
        // Reset z-index and position for dragged rows
        for (const row of draggedRows) {
            row.rowRenderObject.x = px(0); // Reset x position
            row.rowRenderObject.zIndex = 0; // Reset z-index
        }
        
        this.resizeState = { type: 'none' };
        this.updateRowPositions();
        this.requestRender();
    }

    getAllRows(): RowImpl[] {
        return [...this.rows];
    }

    private updateRowPositions(): void {
        let currentY = 0;
        for (const row of this.rows) {
            row.rowRenderObject.x = px(0); // Reset x position
            row.rowRenderObject.y = px(currentY);
            row.rowRenderObject.height = px(row.height);
            row.labelViewport.y = px(this.rowVerticalBorder);
            row.labelViewport.height = px(row.height - this.rowVerticalBorder * 2);
            row.mainViewport.y = px(this.rowVerticalBorder);
            row.mainViewport.height = px(row.height - this.rowVerticalBorder * 2);

            currentY += row.height;
        }
    }

    updateViewportWidths(): void {
        const containerBounds = this.getAbsoluteBounds();
        const labelWidth = this.labelWidth;
        const mainWidth = Math.max(0, containerBounds.width - labelWidth);

        for (const row of this.rows) {
            row.labelViewport.width = px(labelWidth);
            row.mainViewport.x = px(labelWidth);
            row.mainViewport.width = px(mainWidth);
        }
    }

    private getMousePosition(event: MouseEvent): 
        | { type: 'horizontal' }
        | { type: 'vertical'; row: RowImpl }
        | { type: 'none' } {
        const labelWidth = this.labelWidth;
        const halfResizeZoneWidth = this.resizeZoneWidth / 2;
        const halfResizeZoneHeight = this.resizeZoneHeight / 2;
        if (event.clientX >= labelWidth - halfResizeZoneWidth &&
            event.clientX <= labelWidth + halfResizeZoneWidth &&
            event.clientY <= this.rows.map(r => r.height).reduce((a, b) => a + b, 0) + halfResizeZoneHeight) {
            return { type: 'horizontal' };
        }
        if (event.clientX >= 0 && event.clientX < labelWidth) {
            let currentY = 0;
            for (const row of this.rows) {
                const rowBottom = currentY + row.height;
                if (event.clientY >= rowBottom - halfResizeZoneHeight && event.clientY <= rowBottom + halfResizeZoneHeight) {
                    return { type: 'vertical', row };
                }
                currentY = rowBottom;
            }
        }
        return { type: 'none' };
    }
    
    onChange(callback: RowChangedCallback): void {
        this.changeCallbacks.push(callback);
    }

    createRows(...rowParams: RowParameters[]): RowImpl[] {
        return this.spliceRows([], rowParams.map(row => ({ index: this.rows.length, row })));
    }
    
    spliceRows(rowsToRemove: RowImpl[], rowsToAdd: RowInsert[]): RowImpl[] {
        const removedRows: RowImpl[] = [];
        const addedRows: RowImpl[] = [];
        
        // Remove specified rows
        for (const row of rowsToRemove) {
            if (this.lastSelectedRow === row) {
                this.lastSelectedRow = null;
            }
            this.selectedRows.delete(row);
            this.rows.splice(this.rows.indexOf(row), 1);
            removedRows.push(row);
            row.rowRenderObject.dispose();
        }
        
        // Add new rows at specified indices (sort by index descending to avoid index shifting)
        for (const insert of [...rowsToAdd].reverse().sort((a, b) => b.index - a.index)) {
            const row = new RowImpl(insert.row.channels, insert.row.height);
            this.rows.splice(Math.max(0, Math.min(insert.index, this.rows.length)), 0, row);
            this.addChild(row.rowRenderObject);
            if (row.signals.length > 0) {
                row.labelViewport.onMouseDown((event: MouseEvent) => {
                    this.handleRowMouseDown(row, event);
                    event.preventDefault();
                    event.stopPropagation();
                });
            }
            addedRows.push(row);
        }
        
        this.updateViewportWidths();
        this.updateRowPositions();
        this.requestRender();
        
        // Notify of the change
        for (const callback of this.changeCallbacks) {
            callback({ added: addedRows, removed: removedRows });
        }
        return addedRows;
    }

    render(context: RenderContext, bounds: RenderBounds): boolean {
        return false;
    }
}
