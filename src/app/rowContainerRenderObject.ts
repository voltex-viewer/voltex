import { RowImpl } from './rowImpl';
import type { RenderObject, WaveformState, RenderBounds, RenderContext, RowInsert, RowParameters, MouseEvent, WheelEvent, MouseCaptureConfig } from "@voltex-viewer/plugin-api";
import { getAbsoluteBounds, px } from "@voltex-viewer/plugin-api";
import { RowChangedCallback } from './rowManager';
import { CommandManager } from './commandManager';
import { AutoModeButton } from './autoModeButton';

type ResizeState = 
    | { type: 'none' }
    | { type: 'horizontal'; startX: number }
    | { type: 'vertical'; startY: number; row: RowImpl }
    | { type: 'time-offset'; startX: number; startTimeAtCursor: number; lastX: number; lastTime: number; velocity: number }
    | { type: 'dragging-rows'; draggedRows: RowImpl[]; startY: number; offsetY: number; offsetX: number; insertIndex: number }
    | { type: 'potential-row-drag'; row: RowImpl; startX: number; startY: number; event: MouseEvent }
    | { type: 'scrollbar'; startY: number; startOffset: number };

interface ViewTransform {
    time: number;
    pxPerSecond: number;
}

export class RowContainerRenderObject {
    private rows: RowImpl[] = [];
    private changeCallbacks: RowChangedCallback[] = [];
    
    // Unified state for resizing and dragging
    private resizeState: ResizeState = { type: 'none' };
    
    // Selection state
    private selectedRows: Set<RowImpl> = new Set();
    private lastSelectedRow: RowImpl | null = null;
    
    private labelWidth = 100; // initial label width in pixels

    // Vertical scrolling state
    private verticalScrollOffset = 0; // Pixels scrolled from top
    private scrollbarWidth = 8;

    // Animation frame for momentum scrolling and zooming
    private animationFrame: number | null = null;
    private animationLastTime: number = 0;
    private readonly friction = 0.7;
    private readonly panAmount = 0.4;
    
    // Animation state - viewport transform
    private targetTransform: ViewTransform;
    private zoomAnchorTime: number | null = null;
    
    // Auto mode state
    private lastSignalMaxTime: number = -Infinity;
    private isRealTimeTracking: boolean = false;
    private autoModeButton: AutoModeButton;
    
    // Constants
    private readonly minLabelWidth = 40;
    private readonly maxLabelWidth = 400;
    private readonly minRowHeight = 20;
    private readonly maxRowHeight = 1000;
    private readonly rowVerticalBorder = 1;
    private readonly resizeZoneWidth = 5;
    private readonly resizeZoneHeight = 5;
    private readonly minPxPerSecond = 1e-7;  // ~100 years visible on a typical screen
    private readonly maxPxPerSecond = 1e8;   // ~10 microseconds visible on a typical screen
    private readonly dragThreshold = 5; // pixels to move before starting drag

    private readonly renderObject: RenderObject;

    constructor(
        parent: RenderObject,
        private state: WaveformState,
        private requestRender: () => void,
        private commandManager: CommandManager,
    ) {
        // Initialize targetTransform to current state
        this.targetTransform = this.getCurrentTransform();
        
        this.renderObject = parent.addChild({
            render: (_context: RenderContext, bounds: RenderBounds): boolean => {
                this.rows.forEach(row => row.calculateOptimalScaleAndOffset());
                return this.updateAutoMode(bounds);
            }
        });
        
        this.autoModeButton = new AutoModeButton(
            parent,
            this.renderObject,
            this.scrollbarWidth,
            () => this.setAutoMode(!this.autoModeButton.enabled)
        );

        // Create a separate render object for the scrollbar
        parent.addChild({
            zIndex: 3000,
            render: (context: RenderContext, bounds: RenderBounds): boolean => {
                this.renderScrollbar(context, bounds);
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
                    if (mousePosition.type === 'scrollbar') {
                        this.resizeState = {
                            type: 'scrollbar',
                            startY: event.clientY,
                            startOffset: this.verticalScrollOffset
                        };
                        
                        document.body.style.cursor = 'default';
                        return { captureMouse: true, preventDefault: true, allowMouseMoveThrough: true };
                    } else if (mousePosition.type === 'horizontal') {
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
                    const mouseXInViewport = event.clientX - this.labelWidth;
                    if (mouseXInViewport < 0) return {};
                    
                    this.resizeState = {
                        type: 'time-offset',
                        startX: event.clientX,
                        startTimeAtCursor: (this.state.offset + mouseXInViewport) / this.state.pxPerSecond,
                        lastX: mouseXInViewport,
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
                if (this.resizeState.type === 'scrollbar') {
                    const viewportHeight = getAbsoluteBounds(this.renderObject).height;
                    const totalHeight = this.getTotalRowsHeight();
                    const deltaY = event.clientY - this.resizeState.startY;
                    
                    // Convert screen delta to content delta
                    const scrollRatio = totalHeight / viewportHeight;
                    this.verticalScrollOffset = this.resizeState.startOffset + deltaY * scrollRatio;
                    this.clampScrollOffset(viewportHeight);
                    
                    this.updateRowPositions();
                    this.requestRender();
                } else if (this.resizeState.type === 'horizontal') {
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
                    const mouseXInViewport = event.clientX - this.labelWidth;
                    
                    this.setAutoMode(false);
                    this.state.offset = this.resizeState.startTimeAtCursor * this.state.pxPerSecond - mouseXInViewport;
                    this.targetTransform = {
                        time: this.resizeState.startTimeAtCursor - mouseXInViewport / this.targetTransform.pxPerSecond,
                        pxPerSecond: this.targetTransform.pxPerSecond
                    };
                    
                    if (this.zoomAnchorTime !== null) {
                        this.zoomAnchorTime = this.resizeState.startTimeAtCursor;
                    }

                    this.resizeState = {
                        ...this.resizeState,
                        lastX: mouseXInViewport,
                        lastTime: now,
                        velocity: (mouseXInViewport - this.resizeState.lastX) / (now - this.resizeState.lastTime + 0.0001)
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
                if (this.resizeState.type === 'scrollbar') {
                    this.requestRender();
                    this.resizeState = { type: 'none' };
                }
                else if (this.resizeState.type === 'horizontal') {
                    this.requestRender();
                    this.resizeState = { type: 'none' };
                }
                else if (this.resizeState.type === 'vertical') {
                    this.requestRender();
                    this.resizeState = { type: 'none' };
                }
                else if (this.resizeState.type === 'time-offset') {
                    const pxPerFrame = this.resizeState.velocity * 16.67;
                    if (Math.abs(pxPerFrame) > 0.1) {
                        this.startSmoothPan(-pxPerFrame);
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
                
                const mouseXInViewport = event.clientX - this.labelWidth;
                
                // If mouse is over the label area, scroll vertically through rows
                if (mouseXInViewport < 0 && Math.abs(event.deltaY) > 0) {
                    const viewportHeight = getAbsoluteBounds(this.renderObject).height;
                    this.verticalScrollOffset += event.deltaY;
                    this.clampScrollOffset(viewportHeight);
                    this.updateRowPositions();
                    this.requestRender();
                    return;
                }
                
                // Handle horizontal scrolling (panning)
                if (Math.abs(event.deltaX) > 0) {
                    this.startSmoothPan(event.deltaX);
                }
                
                // Handle vertical scrolling (zooming)
                if (Math.abs(event.deltaY) > 0) {
                    const zoomFactor = Math.pow(1.25, Math.abs(event.deltaY) / 50);
                    const currentTarget = this.targetTransform.pxPerSecond;
                    const newTarget = event.deltaY < 0
                        ? Math.min(this.maxPxPerSecond, currentTarget * zoomFactor)
                        : Math.max(this.minPxPerSecond, currentTarget / zoomFactor);
                    
                    this.startSmoothZoom(newTarget, event.clientX - this.labelWidth);
                }
            }),
        });

        this.commandManager.registerCommand('@voltex-viewer/voltex', {
            id: 'select-all-rows',
            action: () => {
                for (const row of this.rows.filter(r => r.signals.length > 0)) {
                    this.selectedRows.add(row);
                    row.selected = true;
                }
                this.requestRender();
            }
        });

        this.commandManager.registerCommand('@voltex-viewer/voltex', {
            id: 'clear-selection',
            action: () => {
                for (const row of this.selectedRows) {
                    row.selected = false;
                }
                this.selectedRows.clear();
                this.requestRender();
            }
        });

        this.commandManager.registerCommand('@voltex-viewer/voltex', {
            id: 'group-selected-rows',
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

        this.commandManager.registerCommand('@voltex-viewer/voltex', {
            id: 'ungroup-selected-rows',
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

        this.commandManager.registerCommand('@voltex-viewer/voltex', {
            id: 'delete-selected-rows',
            action: () => {
                if (this.selectedRows.size > 0) {
                    this.spliceRows(this.getSelectedRowsInOrder(), []);
                    this.selectedRows.clear();
                    this.requestRender();
                }
            }
        });

        this.commandManager.registerCommand('@voltex-viewer/voltex', {
            id: 'zoom-in',
            action: () => {
                const viewportWidth = getAbsoluteBounds(this.renderObject).width - this.labelWidth;
                const anchorX = this.resizeState.type === 'time-offset' 
                    ? this.resizeState.lastX : viewportWidth / 2;
                this.startSmoothZoom(Math.min(this.maxPxPerSecond, this.state.pxPerSecond * 2), anchorX);
            }
        });

        this.commandManager.registerCommand('@voltex-viewer/voltex', {
            id: 'zoom-out',
            action: () => {
                const viewportWidth = getAbsoluteBounds(this.renderObject).width - this.labelWidth;
                const anchorX = this.resizeState.type === 'time-offset' 
                    ? this.resizeState.lastX : viewportWidth / 2;
                this.startSmoothZoom(Math.max(this.minPxPerSecond, this.state.pxPerSecond / 2), anchorX);
            }
        });

        this.commandManager.registerCommand('@voltex-viewer/voltex', {
            id: 'pan-left',
            action: () => {
                if (this.resizeState.type === 'time-offset') return;
                const viewportWidth = getAbsoluteBounds(this.renderObject).width - this.labelWidth;
                this.startSmoothPan(-viewportWidth * this.panAmount * (1 - this.friction));
            }
        });

        this.commandManager.registerCommand('@voltex-viewer/voltex', {
            id: 'pan-right',
            action: () => {
                if (this.resizeState.type === 'time-offset') return;
                const viewportWidth = getAbsoluteBounds(this.renderObject).width - this.labelWidth;
                this.startSmoothPan(viewportWidth * this.panAmount * (1 - this.friction));
            }
        });

        this.commandManager.registerCommand('@voltex-viewer/voltex', {
            id: 'fit-to-signal',
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
                    
                    if (viewportWidth > 0) {
                        console.log('Fitting to signal range:', minTime, maxTime);
                        const centerTime = (minTime + maxTime) / 2;
                        const targetPxPerSecond = timeRange > 0 
                            ? Math.max(this.minPxPerSecond, Math.min(this.maxPxPerSecond, viewportWidth / timeRange))
                            : this.state.pxPerSecond;
                        
                        this.targetTransform = {
                            time: centerTime - (viewportWidth / 2) / targetPxPerSecond,
                            pxPerSecond: targetPxPerSecond
                        };
                        this.zoomAnchorTime = null;
                        this.startUnifiedAnimation();
                    }
                }
            }
        });

        this.commandManager.registerCommand('@voltex-viewer/voltex', {
            id: 'toggle-auto-mode',
            action: () => {
                this.setAutoMode(!this.autoModeButton.enabled);
            }
        });
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

    private handleRowMouseUp(_event: MouseEvent): void {
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

    private startSmoothPan(velocity: number): void {
        this.setAutoMode(false);
        
        const stoppingDistanceTime = velocity / (1 - this.friction) / this.targetTransform.pxPerSecond;
        
        this.targetTransform = {
            time: this.targetTransform.time + stoppingDistanceTime,
            pxPerSecond: this.targetTransform.pxPerSecond
        };
        
        if (this.zoomAnchorTime !== null) {
            this.zoomAnchorTime += stoppingDistanceTime;
        } else {
            this.zoomAnchorTime = null;
        }
        
        this.startUnifiedAnimation();
    }

    private startSmoothZoom(targetPxPerSecond: number, anchorX: number): void {
        if (this.autoModeButton.enabled && this.isRealTimeTracking) {
            // Real-time tracking: only animate zoom, position handled by updateAutoMode
            this.targetTransform.pxPerSecond = targetPxPerSecond;
            this.zoomAnchorTime = null;
        } else {
            // Static signal or auto mode off: disable auto mode and anchor to mouse
            this.setAutoMode(false);
            this.zoomAnchorTime = this.targetTransform.time + anchorX / this.targetTransform.pxPerSecond;
            this.targetTransform = {
                time: this.zoomAnchorTime - anchorX / targetPxPerSecond,
                pxPerSecond: targetPxPerSecond
            };
        }
        this.startUnifiedAnimation();
    }

    private getCurrentTransform(): ViewTransform {
        return {
            time: this.state.offset / this.state.pxPerSecond,
            pxPerSecond: this.state.pxPerSecond
        };
    }

    private updateStateFromTransform(transform: ViewTransform): void {
        this.state.pxPerSecond = transform.pxPerSecond;
        this.state.offset = transform.time * transform.pxPerSecond;
    }

    private startUnifiedAnimation(): void {
        if (this.animationFrame !== null) return;
        
        this.animationLastTime = performance.now();
        const animate = (currentTime: number) => {
            const deltaTime = currentTime - this.animationLastTime;
            this.animationLastTime = currentTime;
            
            const current = this.getCurrentTransform();
            const step = Math.min(1, 1 - Math.pow(this.friction, deltaTime / 16.67));
            const diffZoom = this.targetTransform.pxPerSecond - current.pxPerSecond;
            const diffTime = this.targetTransform.time - current.time;
            
            // Check if we're close enough to stop animating
            const zoomClose = Math.abs(diffZoom / current.pxPerSecond) < 0.001;
            const timeClose = Math.abs(diffTime * current.pxPerSecond) < 0.5;
            
            if (this.zoomAnchorTime !== null) {
                const currentAnchorScreenPos = (this.zoomAnchorTime - current.time) * current.pxPerSecond;
                const targetAnchorScreenPos = (this.zoomAnchorTime - this.targetTransform.time) * this.targetTransform.pxPerSecond;
                const anchorClose = Math.abs(currentAnchorScreenPos - targetAnchorScreenPos) < 0.5;
                
                if (anchorClose && zoomClose) {
                    this.updateStateFromTransform(this.targetTransform);
                    this.zoomAnchorTime = null;
                    this.requestRender();
                    this.animationFrame = null;
                } else {
                    const newPxPerSecond = current.pxPerSecond + diffZoom * step;
                    const newAnchorScreenPos = currentAnchorScreenPos + (targetAnchorScreenPos - currentAnchorScreenPos) * step;
                    this.updateStateFromTransform({
                        time: this.zoomAnchorTime - newAnchorScreenPos / newPxPerSecond,
                        pxPerSecond: newPxPerSecond
                    });
                }
            } else {
                if (timeClose && zoomClose) {
                    this.updateStateFromTransform(this.targetTransform);
                    this.requestRender();
                    this.animationFrame = null;
                } else {   
                    this.updateStateFromTransform({
                        time: current.time + diffTime * step,
                        pxPerSecond: current.pxPerSecond + diffZoom * step
                    });
                }
            }
            
            this.requestRender();
            this.animationFrame = requestAnimationFrame(animate);
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
        let currentY = -this.verticalScrollOffset; // Apply vertical scroll offset
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
        | { type: 'scrollbar' }
        | { type: 'none' } {
        const labelWidth = this.labelWidth;
        const halfResizeZoneWidth = this.resizeZoneWidth / 2;
        const halfResizeZoneHeight = this.resizeZoneHeight / 2;
        
        // Check for scrollbar (only show if content overflows)
        const totalHeight = this.getTotalRowsHeight();
        const viewportHeight = getAbsoluteBounds(this.renderObject).height;
        const viewportWidth = getAbsoluteBounds(this.renderObject).width;
        if (totalHeight > viewportHeight) {
            const scrollbarX = viewportWidth - this.scrollbarWidth;
            if (event.clientX >= scrollbarX && event.clientX <= scrollbarX + this.scrollbarWidth) {
                return { type: 'scrollbar' };
            }
        }
        
        if (event.clientX >= labelWidth - halfResizeZoneWidth &&
            event.clientX <= labelWidth + halfResizeZoneWidth &&
            event.clientY <= this.rows.map(r => r.height).reduce((a, b) => a + b, 0) + halfResizeZoneHeight) {
            return { type: 'horizontal' };
        }
        if (event.clientX >= 0 && event.clientX < labelWidth) {
            let currentY = -this.verticalScrollOffset;
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

    private getTotalRowsHeight(): number {
        return this.rows.reduce((sum, row) => sum + row.height, 0);
    }

    private getMaxScrollOffset(viewportHeight: number): number {
        const totalHeight = this.getTotalRowsHeight();
        return Math.max(0, totalHeight - viewportHeight);
    }

    private clampScrollOffset(viewportHeight: number): void {
        const maxOffset = this.getMaxScrollOffset(viewportHeight);
        this.verticalScrollOffset = Math.max(0, Math.min(maxOffset, this.verticalScrollOffset));
    }

    private renderScrollbar(context: RenderContext, bounds: RenderBounds): void {
        const totalHeight = this.getTotalRowsHeight();
        const viewportHeight = bounds.height;
        
        // Don't show scrollbar if all content fits
        if (totalHeight <= viewportHeight) {
            return;
        }

        const { gl, utils } = context.render;
        
        // Calculate scrollbar dimensions
        const scrollbarHeight = Math.max(20, (viewportHeight / totalHeight) * viewportHeight);
        const scrollbarY = (this.verticalScrollOffset / totalHeight) * viewportHeight;
        const scrollbarX = bounds.width - this.scrollbarWidth;
        
        // Draw scrollbar track
        const trackVertices = new Float32Array([
            scrollbarX, 0,
            scrollbarX + this.scrollbarWidth, 0,
            scrollbarX, viewportHeight,
            scrollbarX + this.scrollbarWidth, viewportHeight
        ]);
        
        const trackBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, trackBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, trackVertices, gl.STATIC_DRAW);
        
        gl.useProgram(utils.line);
        
        const positionLocation = gl.getAttribLocation(utils.line, 'a_position');
        gl.enableVertexAttribArray(positionLocation);
        gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);
        
        const resolutionLocation = gl.getUniformLocation(utils.line, 'u_bounds');
        gl.uniform2f(resolutionLocation, bounds.width, bounds.height);
        
        const colorLocation = gl.getUniformLocation(utils.line, 'u_color');
        gl.uniform4f(colorLocation, 0.125, 0.141, 0.188, 0.5); // Semi-transparent dark background
        
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        
        // Draw scrollbar thumb
        const thumbVertices = new Float32Array([
            scrollbarX, scrollbarY,
            scrollbarX + this.scrollbarWidth, scrollbarY,
            scrollbarX, scrollbarY + scrollbarHeight,
            scrollbarX + this.scrollbarWidth, scrollbarY + scrollbarHeight
        ]);
        
        gl.bufferData(gl.ARRAY_BUFFER, thumbVertices, gl.STATIC_DRAW);
        gl.uniform4f(colorLocation, 0.35, 0.37, 0.42, 0.8); // Lighter thumb color
        
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        
        gl.deleteBuffer(trackBuffer);
        gl.disableVertexAttribArray(positionLocation);
    }

    private getSignalTimeRange(): { min: number; max: number } | null {
        let minTime = Infinity;
        let maxTime = -Infinity;
        
        for (const row of this.rows) {
            for (const signal of row.signals) {
                if (signal.time.length > 0) {
                    minTime = Math.min(minTime, signal.time.min);
                    maxTime = Math.max(maxTime, signal.time.max);
                }
            }
        }
        
        if (minTime === Infinity || maxTime === -Infinity) {
            return null;
        }
        return { min: minTime, max: maxTime };
    }

    private updateAutoMode(bounds: RenderBounds): boolean {
        if (!this.autoModeButton.enabled) {
            this.isRealTimeTracking = false;
            return false;
        }
        
        const range = this.getSignalTimeRange();
        if (!range) {
            this.isRealTimeTracking = false;
            return false;
        }
        
        const viewportWidth = bounds.width - this.labelWidth;
        if (viewportWidth <= 0) return false;
        
        const isRealTime = range.max > this.lastSignalMaxTime;
        this.lastSignalMaxTime = range.max;
        this.isRealTimeTracking = isRealTime;
        
        const padding = 0.05;
        if (isRealTime) {
            // Real-time mode: position is calculated from CURRENT zoom and applied directly
            // This avoids fighting with the animation system during zoom
            const currentPxPerSecond = this.state.pxPerSecond;
            const visibleDuration = viewportWidth / currentPxPerSecond;
            const paddedRightEdge = range.max + visibleDuration * padding;
            const correctStartTime = paddedRightEdge - visibleDuration;
            
            // Apply position directly to state (no animation for position)
            this.state.offset = correctStartTime * currentPxPerSecond;
            
            // Keep targetTransform.time in sync so animation system doesn't fight us
            this.targetTransform.time = correctStartTime;
        } else {
            // Fit-to-data mode: show entire signal range with padding
            const timeRange = range.max - range.min;
            const paddedRange = timeRange > 0 ? timeRange * (1 + padding * 2) : 1;
            const targetPxPerSecond = Math.max(
                this.minPxPerSecond,
                Math.min(this.maxPxPerSecond, viewportWidth / paddedRange)
            );
            const centerTime = (range.min + range.max) / 2;
            const targetStartTime = centerTime - (viewportWidth / 2) / targetPxPerSecond;
            
            // Check if we need to animate
            const currentCenter = this.targetTransform.time + viewportWidth / (2 * this.targetTransform.pxPerSecond);
            const zoomDiff = Math.abs(this.targetTransform.pxPerSecond - targetPxPerSecond) / targetPxPerSecond;
            const timeDiff = Math.abs(currentCenter - centerTime) * targetPxPerSecond;
            
            if (zoomDiff > 0.01 || timeDiff > 1) {
                this.targetTransform = {
                    time: targetStartTime,
                    pxPerSecond: targetPxPerSecond
                };
                this.zoomAnchorTime = null;
                this.startUnifiedAnimation();
            }
        }
        
        return false;
    }

    private setAutoMode(enabled: boolean): void {
        if (this.autoModeButton.enabled !== enabled) {
            this.autoModeButton.setAutoMode(enabled);
            if (enabled) {
                // Set to current max time so we correctly detect real-time vs static
                // on the next frame (only if max increases will it be real-time)
                const range = this.getSignalTimeRange();
                this.lastSignalMaxTime = range?.max ?? -Infinity;
            } else {
                this.isRealTimeTracking = false;
            }
            this.requestRender();
        }
    }
}
