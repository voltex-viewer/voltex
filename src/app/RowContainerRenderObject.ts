import { RowImpl } from './RowImpl';
import type { RenderObject, WaveformState, RenderBounds, RenderContext, RowInsert, RowParameters, MouseEvent, WheelEvent } from "@voltex-viewer/plugin-api";
import { getAbsoluteBounds, px } from "@voltex-viewer/plugin-api";
import { RowChangedCallback } from './RowManager';
import { CommandManager } from './CommandManager';

type ResizeState = 
    | { type: 'none' }
    | { type: 'horizontal'; startX: number }
    | { type: 'vertical'; startY: number; row: RowImpl }
    | { type: 'time-offset'; startX: number; startTimeAtCursor: number; lastX: number; lastTime: number; velocity: number }
    | { type: 'dragging-rows'; draggedRows: RowImpl[]; startY: number; offsetY: number; offsetX: number; insertIndex: number }
    | { type: 'potential-row-drag'; row: RowImpl; startX: number; startY: number; event: MouseEvent };

export class RowContainerRenderObject {
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
    private readonly maxRowHeight = 1000;
    private readonly rowVerticalBorder = 1;
    private readonly resizeZoneWidth = 5;
    private readonly resizeZoneHeight = 5;
    private readonly minPxPerSecond = 1e-9;
    private readonly maxPxPerSecond = 1e12;
    private readonly dragThreshold = 5; // pixels to move before starting drag

    private readonly renderObject: RenderObject;

    constructor(
        parent: RenderObject,
        private state: WaveformState,
        private requestRender: () => void,
        private canvas: HTMLCanvasElement,
        private commandManager: CommandManager,
    ) {
        this.renderObject = parent.addChild({
            render: (context: RenderContext, bounds: RenderBounds): boolean => {
                this.rows.forEach(row => row.calculateOptimalScaleAndOffset());
                return false;
            }
        });

        // Create a high z-order overlay to intercept resize events
        this.renderObject.addChild({
            zIndex: 2000,
            onMouseDown: ((event: MouseEvent) => {
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
            }),
            onMouseMove: ((event: MouseEvent) => {
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
                } else if (this.resizeState.type === 'dragging-rows') {
                    // Handle row dragging
                    const dragState = this.resizeState;
                    
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
                    
                    const mouseX = event.clientX - dragState.offsetX;
                    const mouseY = event.clientY - dragState.offsetY;
                    
                    // Update dragged rows positions
                    let currentY = mouseY;
                    for (const row of dragState.draggedRows) {
                        row.rowRenderObject.x = px(mouseX);
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
                } else {
                    // No ongoing operation, show the available operations
                    const mousePosition = this.getMousePosition(event);
                    document.body.style.cursor = 
                        mousePosition.type === 'horizontal' ? 'ew-resize' :
                        mousePosition.type === 'vertical' ? 'ns-resize' : '';
                }
            }),
            onMouseUp: ((_event: MouseEvent) => {
                if (this.resizeState.type === 'horizontal') {
                    this.requestRender();
                    this.resizeState = { type: 'none' };
                }
                else if (this.resizeState.type === 'vertical') {
                    this.requestRender();
                    this.resizeState = { type: 'none' };
                }
                else if (this.resizeState.type === 'dragging-rows') {
                    // Finalize the row reordering
                    this.finalizeDraggedRows();
                    
                    // Reset cursor
                    document.body.style.cursor = '';
                    
                    this.resizeState = { type: 'none' };
                }
            }),
            onMouseLeave: (() => {
                document.body.style.cursor = '';
            }),

            onWheel: ((event: WheelEvent) => {
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
            }),
        });

        this.commandManager.registerCommand('Voltex', {
            id: 'voltex.select-all-rows',
            action: () => {
                for (const row of this.rows.filter(r => r.signals.length > 0)) {
                    this.selectedRows.add(row);
                    row.selected = true;
                }
                this.requestRender();
            }
        });

        this.commandManager.registerCommand('Voltex', {
            id: 'voltex.clear-selection',
            action: () => {
                for (const row of this.selectedRows) {
                    row.selected = false;
                }
                this.selectedRows.clear();
                this.requestRender();
            }
        });

        this.commandManager.registerCommand('Voltex', {
            id: 'voltex.group-selected-rows',
            action: () => {
                if (this.selectedRows.size >= 2) {
                    const selectedRowsArray = this.getSelectedRowsInOrder();
                    const firstIndex = Math.min(...selectedRowsArray.map(row => this.rows.indexOf(row)));
                    
                    this.selectedRows = new Set(this.spliceRows(
                        selectedRowsArray,
                        [{ index: firstIndex, row: { channels: selectedRowsArray.flatMap(row => row.signals) } }]
                    ));

                    for (const row of this.selectedRows) {
                        row.selected = true;
                    }
                    this.requestRender();
                }
            }
        });

        this.commandManager.registerCommand('Voltex', {
            id: 'voltex.ungroup-selected-rows',
            action: () => {
                if (this.selectedRows.size > 0) {
                    const selectedRowsArray = this.getSelectedRowsInOrder();
                    const firstIndex = Math.min(...selectedRowsArray.map(row => this.rows.indexOf(row)));

                    this.selectedRows = new Set(this.spliceRows(
                        selectedRowsArray,
                        selectedRowsArray
                            .flatMap(row => row.signals.map(channel => ({ channels: [channel] })))
                            .map(value => ({ index: firstIndex, row: value }))
                    ));
                    for (const row of this.selectedRows) {
                        row.selected = true;
                    }
                    this.requestRender();
                }
            }
        });

        this.commandManager.registerCommand('Voltex', {
            id: 'voltex.delete-selected-rows',
            action: () => {
                if (this.selectedRows.size > 0) {
                    this.spliceRows(this.getSelectedRowsInOrder(), []);
                    this.selectedRows.clear();
                    this.requestRender();
                }
            }
        });

        this.commandManager.registerCommand('Voltex', {
            id: 'voltex.zoom-in',
            action: () => {
                const zoomFactor = 1.25;
                const centerTime = (this.state.offset + (this.canvas.width - this.labelWidth) / 2) / this.state.pxPerSecond;
                this.state.pxPerSecond = Math.min(this.maxPxPerSecond, this.state.pxPerSecond * zoomFactor);
                this.state.offset = centerTime * this.state.pxPerSecond - (this.canvas.width - this.labelWidth) / 2;
                this.requestRender();
            }
        });

        this.commandManager.registerCommand('Voltex', {
            id: 'voltex.zoom-out',
            action: () => {
                const zoomFactor = 1.25;
                const centerTime = (this.state.offset + (this.canvas.width - this.labelWidth) / 2) / this.state.pxPerSecond;
                this.state.pxPerSecond = Math.max(this.minPxPerSecond, this.state.pxPerSecond / zoomFactor);
                this.state.offset = centerTime * this.state.pxPerSecond - (this.canvas.width - this.labelWidth) / 2;
                this.requestRender();
            }
        });

        this.commandManager.registerCommand('Voltex', {
            id: 'voltex.pan-left',
            action: () => {
                const panAmount = (this.canvas.width - this.labelWidth) * 0.2;
                this.startSmoothPan(-panAmount);
            }
        });

        this.commandManager.registerCommand('Voltex', {
            id: 'voltex.pan-right',
            action: () => {
                const panAmount = (this.canvas.width - this.labelWidth) * 0.2;
                this.startSmoothPan(panAmount);
            }
        });
    }

    // Helper method to convert global mouse coordinates to canvas-relative coordinates
    private convertGlobalMouseToCanvasCoords(globalX: number, globalY: number): { x: number; y: number } {
        const canvasRect = this.canvas.getBoundingClientRect();
        return {
            x: globalX - canvasRect.left,
            y: globalY - canvasRect.top
        };
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
                
                const canvasCoords = this.convertGlobalMouseToCanvasCoords(e.clientX, e.clientY);
                const deltaX = canvasCoords.x - this.resizeState.startX;
                const deltaY = canvasCoords.y - this.resizeState.startY;

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

    private handleRowMouseMove(event: MouseEvent): void {
        // Delegate to the overlay's mouse move handler for drag operations
        if (this.resizeState.type === 'dragging-rows') {
            const dragState = this.resizeState;
            
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
            
            const mouseX = event.clientX - dragState.offsetX;
            const mouseY = event.clientY - dragState.offsetY;
            
            // Update dragged rows positions
            let currentY = mouseY;
            for (const row of dragState.draggedRows) {
                row.rowRenderObject.x = px(mouseX);
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
        }
    }

    private handleRowMouseUp(event: MouseEvent): void {
        // Delegate to the overlay's mouse up handler for drag operations  
        if (this.resizeState.type === 'dragging-rows') {
            // Finalize the row reordering
            this.finalizeDraggedRows();
            
            // Reset cursor
            document.body.style.cursor = '';
            
            this.resizeState = { type: 'none' };
        }
    }

    private setupGlobalDragHandlers(): void {
        const handleMouseMove = (e: globalThis.MouseEvent) => {
            if (this.resizeState.type !== 'time-offset') return;
            
            const now = performance.now();
            
            // Calculate new offset based on constant time at cursor
            const canvasCoords = this.convertGlobalMouseToCanvasCoords(e.clientX, e.clientY);
            const currentMouseXInViewport = canvasCoords.x - this.labelWidth;
            this.state.offset = this.resizeState.startTimeAtCursor * this.state.pxPerSecond - currentMouseXInViewport;

            const velocity = (canvasCoords.x - this.resizeState.lastX) / (now - this.resizeState.lastTime + 0.0001);
            
            this.resizeState = {
                ...this.resizeState,
                lastX: canvasCoords.x,
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

    private startSmoothPan(offsetDelta: number): void {
        // Cancel any existing animation
        if (this.animationFrame !== null) {
            cancelAnimationFrame(this.animationFrame);
            this.animationFrame = null;
        }

        // Start smooth panning animation
        let pxPerFrame = offsetDelta / 10; // Spread the pan over ~10 frames for smoothness
        const animate = () => {
            pxPerFrame *= this.decay;
            this.state.offset += pxPerFrame;
            this.requestRender();
            if (Math.abs(pxPerFrame) > this.minVelocity) {
                this.animationFrame = requestAnimationFrame(animate);
            } else {
                this.animationFrame = null;
            }
        };
        this.animationFrame = requestAnimationFrame(animate);
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
        
        const clickedRowBounds = getAbsoluteBounds(clickedRow.rowRenderObject);
        
        this.resizeState = {
            type: 'dragging-rows',
            draggedRows: rowsToDrag,
            startY: event.clientY,
            offsetY: event.clientY - (clickedRowBounds.y - offsetToClickedRow),
            offsetX: event.clientX - clickedRowBounds.x,
            insertIndex: this.rows.indexOf(rowsToDrag[0])
        };
        
        // Set visual feedback
        document.body.style.cursor = 'grabbing';
        
        this.requestRender();
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
            row.labelArea.y = px(this.rowVerticalBorder);
            row.labelArea.height = px(row.height - this.rowVerticalBorder * 2);
            row.mainArea.y = px(this.rowVerticalBorder);
            row.mainArea.height = px(row.height - this.rowVerticalBorder * 2);

            currentY += row.height;
        }
    }

    updateViewportWidths(): void {
        const containerBounds = getAbsoluteBounds(this.renderObject);
        const labelWidth = this.labelWidth;
        const mainWidth = Math.max(0, containerBounds.width - labelWidth);

        for (const row of this.rows) {
            row.labelArea.width = px(labelWidth);
            row.mainArea.x = px(labelWidth);
            row.mainArea.width = px(mainWidth);
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
            const parent = row.rowRenderObject.parent;
            if (parent) {
                parent.removeChild(row.rowRenderObject);
            }
        }
        
        // Add new rows at specified indices (sort by index descending to avoid index shifting)
        for (const insert of [...rowsToAdd].reverse().sort((a, b) => b.index - a.index)) {
            const channels = insert.row.channels ?? [];
            const row = new RowImpl(
                this.renderObject,
                channels,
                insert.row.height ?? 50,
                channels.length > 0 ? {
                    onMouseDown: (event) => {
                        this.handleRowMouseDown(row, event);
                        event.preventDefault();
                        event.stopPropagation();
                    },
                    onMouseMove: (event) => {
                        this.handleRowMouseMove(event);
                    },
                    onMouseUp: (event) => {
                        this.handleRowMouseUp(event);
                    }
                } : undefined
            );
            this.rows.splice(Math.max(0, Math.min(insert.index, this.rows.length)), 0, row);
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
}
