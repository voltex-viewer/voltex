import { RowImpl } from './RowImpl';
import type { RenderObject, WaveformState, RenderBounds, RenderContext, RowInsert, RowParameters, MouseEvent, WheelEvent, MouseCaptureConfig } from "@voltex-viewer/plugin-api";
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

    // Animation frame for momentum scrolling and zooming
    private animationFrame: number | null = null;
    private readonly panFriction = 0.7; // friction per frame for panning
    private readonly zoomFriction = 0.5; // friction per frame for zooming
    private readonly minVelocity = 0.1; // px/frame threshold to stop
    private readonly panAmount = 0.4; // fraction of viewport width to pan on command
    
    // Pan animation state
    private panVelocity: number = 0;
    
    // Zoom animation state
    private targetPxPerSecond: number | null = null;
    private zoomAnchorX: number | null = null;
    private zoomAnchorTime: number | null = null;
    
    // Constants
    private readonly minLabelWidth = 40;
    private readonly maxLabelWidth = 400;
    private readonly minRowHeight = 20;
    private readonly maxRowHeight = 1000;
    private readonly rowVerticalBorder = 1;
    private readonly resizeZoneWidth = 5;
    private readonly resizeZoneHeight = 5;
    private readonly minPxPerSecond = 1e-5;  // ~1 year visible on a typical screen
    private readonly maxPxPerSecond = 1e8;   // ~10 microseconds visible on a typical screen
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
                if (event.button !== 0) return; // Only left button
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
                    this.requestRender();
                    event.stopPropagation(); // Stop propagation to prevent row handlers from interfering
                    return { captureMouse: true, preventDefault: true };
                } else {
                    // Don't start panning if clicking in the label area
                    if (event.clientX < this.labelWidth) return {};
                    
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
                    
                    return { captureMouse: true, allowMouseMoveThrough: true, preventDefault: true };
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
                } else if (this.resizeState.type === 'time-offset') {
                    const now = performance.now();
                    
                    // Calculate new offset based on constant time at cursor
                    const currentMouseXInViewport = event.clientX - this.labelWidth;
                    this.state.offset = this.resizeState.startTimeAtCursor * this.state.pxPerSecond - currentMouseXInViewport;

                    const velocity = (event.clientX - this.resizeState.lastX) / (now - this.resizeState.lastTime + 0.0001);
                    
                    this.resizeState = {
                        ...this.resizeState,
                        lastX: event.clientX,
                        lastTime: now,
                        velocity: velocity
                    };
                    
                    this.requestRender();
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
            onMouseUp: ((event: MouseEvent) => {
                if (event.button !== 0) return; // Only left button
                if (this.resizeState.type === 'horizontal') {
                    this.requestRender();
                    this.resizeState = { type: 'none' };
                }
                else if (this.resizeState.type === 'vertical') {
                    this.requestRender();
                    this.resizeState = { type: 'none' };
                }
                else if (this.resizeState.type === 'time-offset') {
                    // Set pan velocity for momentum scrolling
                    const pxPerFrame = this.resizeState.velocity * 16.67;
                    if (Math.abs(pxPerFrame) > this.minVelocity) {
                        this.panVelocity = -pxPerFrame;
                        this.startUnifiedAnimation();
                    }
                    
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
                
                // Handle horizontal scrolling (panning)
                if (Math.abs(event.deltaX) > 0) {
                    this.startSmoothPan(event.deltaX);
                }
                
                // Handle vertical scrolling (zooming)
                if (Math.abs(event.deltaY) > 0) {
                    const zoomFactor = Math.pow(1.25, Math.abs(event.deltaY) / 50);
                    const currentTarget = this.targetPxPerSecond ?? this.state.pxPerSecond;
                    const newTarget = event.deltaY < 0
                        ? Math.min(this.maxPxPerSecond, currentTarget * zoomFactor)
                        : Math.max(this.minPxPerSecond, currentTarget / zoomFactor);
                    
                    this.startSmoothZoom(newTarget, event.clientX - this.labelWidth);
                }
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
                const targetPxPerSecond = Math.min(this.maxPxPerSecond, this.state.pxPerSecond * 2);
                const viewportWidth = getAbsoluteBounds(this.renderObject).width - this.labelWidth;
                this.startSmoothZoom(targetPxPerSecond, viewportWidth / 2);
            }
        });

        this.commandManager.registerCommand('Voltex', {
            id: 'voltex.zoom-out',
            action: () => {
                const targetPxPerSecond = Math.max(this.minPxPerSecond, this.state.pxPerSecond / 2);
                const viewportWidth = getAbsoluteBounds(this.renderObject).width - this.labelWidth;
                this.startSmoothZoom(targetPxPerSecond, viewportWidth / 2);
            }
        });

        this.commandManager.registerCommand('Voltex', {
            id: 'voltex.pan-left',
            action: () => {
                const viewportWidth = getAbsoluteBounds(this.renderObject).width - this.labelWidth;
                const initialVelocity = -viewportWidth * this.panAmount * (1 - this.panFriction);
                this.startSmoothPan(initialVelocity);
            }
        });

        this.commandManager.registerCommand('Voltex', {
            id: 'voltex.pan-right',
            action: () => {
                const viewportWidth = getAbsoluteBounds(this.renderObject).width - this.labelWidth;
                const initialVelocity = viewportWidth * this.panAmount * (1 - this.panFriction);
                this.startSmoothPan(initialVelocity);
            }
        });

        this.commandManager.registerCommand('Voltex', {
            id: 'voltex.fit-to-signal',
            action: () => {
                const selectedRowsArray = this.getSelectedRowsInOrder();
                const rowsToCheck = selectedRowsArray.length > 0 ? selectedRowsArray : this.rows;
                
                let minTime = Infinity;
                let maxTime = -Infinity;
                
                for (const row of rowsToCheck) {
                    for (const signal of row.signals) {
                        if (signal.time.length > 0) {
                            minTime = Math.min(minTime, signal.time.min);
                            maxTime = Math.max(maxTime, signal.time.max);
                        }
                    }
                }
                
                if (minTime !== Infinity && maxTime !== -Infinity) {
                    const timeRange = maxTime - minTime;
                    const viewportWidth = getAbsoluteBounds(this.renderObject).width - this.labelWidth;
                    
                    if (timeRange > 0 && viewportWidth > 0) {
                        // Set the zoom anchor to the center time we want to see
                        // This will make the zoom animate while keeping centerTime at zoomAnchorX
                        this.targetPxPerSecond = Math.max(this.minPxPerSecond, Math.min(this.maxPxPerSecond, viewportWidth / timeRange));
                        this.zoomAnchorX = viewportWidth / 2;
                        this.zoomAnchorTime = (minTime + maxTime) / 2;
                        this.panVelocity = 0; // Stop any existing pan
                        
                        this.startUnifiedAnimation();
                    }
                }
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

    private handleRowMouseDown(row: RowImpl, event: MouseEvent): MouseCaptureConfig {
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
            
            // Request capture immediately so we can track mouse and detect threshold
            return { captureMouse: true, preventDefault: true };
        } else {
            // Handle modifier key selections immediately
            handleRowClick(row, event);
            return { preventDefault: true };
        }
    }

    private handleRowMouseMove(event: MouseEvent): MouseCaptureConfig | void {
        // Check for potential drag threshold
        if (this.resizeState.type === 'potential-row-drag') {
            const deltaX = event.clientX - this.resizeState.startX;
            const deltaY = event.clientY - this.resizeState.startY;

            if (Math.sqrt(deltaX * deltaX + deltaY * deltaY) > this.dragThreshold) {
                // Exceeded threshold, start drag
                this.startRowDrag(this.resizeState.row, this.resizeState.event);
                return { captureMouse: true, preventDefault: true };
            }
            return;
        }
        
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
        // Handle potential drag that didn't exceed threshold (treat as click)
        if (this.resizeState.type === 'potential-row-drag') {
            const clickedRow = this.resizeState.row;
            this.resizeState = { type: 'none' };
            
            // Single selection
            if (this.selectedRows.size == 1 && this.selectedRows.has(clickedRow)) {
                // If this is the only selected row, deselect it
                clickedRow.selected = false;
                this.selectedRows.clear();
                this.lastSelectedRow = null;
            } else {
                // Otherwise select it
                for (const row of this.selectedRows) {
                    row.selected = false;
                }
                this.selectedRows.clear();
                this.selectedRows.add(clickedRow);
                clickedRow.selected = true;
                this.lastSelectedRow = clickedRow;
            }
            this.requestRender();
        } else if (this.resizeState.type === 'dragging-rows') {
            // Delegate to the overlay's mouse up handler for drag operations  

            // Finalize the row reordering
            this.finalizeDraggedRows();
            
            // Reset cursor
            document.body.style.cursor = '';
            
            this.resizeState = { type: 'none' };
        }
    }

    private startSmoothPan(panVelocity: number): void {
        // Set pan velocity
        this.panVelocity = panVelocity;
        
        // Start unified animation loop if not already running
        this.startUnifiedAnimation();
    }

    private startSmoothZoom(targetPxPerSecond: number, anchorX: number): void {
        // Update target zoom level
        this.targetPxPerSecond = targetPxPerSecond;
        
        // If anchor changed significantly or this is first zoom, recalculate anchor time
        if (this.zoomAnchorX === null || Math.abs(this.zoomAnchorX - anchorX) > 10) {
            this.zoomAnchorX = anchorX;
            this.zoomAnchorTime = (this.state.offset + anchorX) / this.state.pxPerSecond;
        }
        
        // Start unified animation loop if not already running
        this.startUnifiedAnimation();
    }

    private startUnifiedAnimation(): void {
        // Only start if not already running
        if (this.animationFrame !== null) return;
        
        const animate = () => {
            let needsAnotherFrame = false;
            
            // Handle panning
            if (Math.abs(this.panVelocity) > this.minVelocity) {
                this.state.offset += this.panVelocity;
                this.panVelocity *= this.panFriction;
                
                // If we're also zooming, update the anchor time to account for the pan
                if (this.zoomAnchorTime !== null && this.zoomAnchorX !== null) {
                    this.zoomAnchorTime = (this.state.offset + this.zoomAnchorX) / this.state.pxPerSecond;
                }
                
                needsAnotherFrame = true;
            } else {
                this.panVelocity = 0;
            }
            
            // Handle zooming
            if (this.targetPxPerSecond !== null && this.zoomAnchorTime !== null && this.zoomAnchorX !== null) {
                const diff = this.targetPxPerSecond - this.state.pxPerSecond;
                const relDiff = Math.abs(diff) / this.state.pxPerSecond;
                
                // Speed is proportional to distance from target
                const step = Math.min(1, 1 + relDiff * 2) * (1 - this.zoomFriction);
                const newPxPerSecond = this.state.pxPerSecond + diff * step;
                
                // Detect overshoot or close enough to target
                const wouldOvershoot = (diff > 0) ? newPxPerSecond > this.targetPxPerSecond : newPxPerSecond < this.targetPxPerSecond;
                
                if (wouldOvershoot || relDiff <= 0.001) {
                    // Snap to final value
                    this.state.pxPerSecond = this.targetPxPerSecond;
                    this.state.offset = this.zoomAnchorTime * this.state.pxPerSecond - this.zoomAnchorX;
                    this.targetPxPerSecond = null;
                    this.zoomAnchorX = null;
                    this.zoomAnchorTime = null;
                } else {
                    this.state.pxPerSecond = newPxPerSecond;
                    this.state.offset = this.zoomAnchorTime * this.state.pxPerSecond - this.zoomAnchorX;
                    needsAnotherFrame = true;
                }
            }
            
            this.requestRender();
            
            // Continue animation if needed
            if (needsAnotherFrame) {
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
            const row: RowImpl = new RowImpl(
                this.renderObject,
                channels,
                insert.row.height ?? 50,
                channels.length > 0 ? {
                    onMouseDown: (event): MouseCaptureConfig => {
                        if (event.button !== 0) return {}; // Only left button
                        return this.handleRowMouseDown(row, event);
                    },
                    onMouseMove: (event) => {
                        return this.handleRowMouseMove(event);
                    },
                    onMouseUp: (event) => {
                        if (event.button !== 0) return; // Only left button
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
