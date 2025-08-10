import { ContainerRenderObject } from './ContainerRenderObject';
import { RowImpl } from './RowImpl';
import type { WaveformState } from './WaveformState';
import { px, type MouseEvent, type WheelEvent } from './RenderObject';
import { RowChangedCallback, RowChangedEvent } from './RowManager';
import { Row, RowInsert, RowParameters } from './Plugin';

type ResizeState = 
    | { type: 'none' }
    | { type: 'horizontal'; startX: number }
    | { type: 'vertical'; startY: number; row: RowImpl }
    | { type: 'dragging'; startX: number; startTimeAtCursor: number; lastX: number; lastTime: number; velocity: number };

export class RowContainerRenderObject extends ContainerRenderObject {
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
                        startX: event.x - this.labelWidth 
                    };
                    
                    document.body.style.cursor = 'ew-resize';
                } else if (mousePosition.type === 'vertical') {
                    this.resizeState = { 
                        type: 'vertical', 
                        startY: event.y - mousePosition.row.height,
                        row: mousePosition.row
                    };

                    document.body.style.cursor = 'ns-resize';
                }
                event.preventDefault();
                event.stopPropagation();
                this.requestRender();
            } else {
                // Don't start panning if clicking in the label area
                if (event.x < this.labelWidth) return;
                
                // Start drag-to-scroll
                const mouseXInViewport = event.x - this.labelWidth;
                const timeAtCursor = (this.state.offset + mouseXInViewport) / this.state.pxPerSecond;
                
                this.resizeState = {
                    type: 'dragging',
                    startX: event.x,
                    startTimeAtCursor: timeAtCursor,
                    lastX: event.x,
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
                    Math.min(this.maxLabelWidth, event.x - this.resizeState.startX)
                );
                
                if (newWidth !== this.labelWidth) {
                    this.labelWidth = newWidth;
                    this.updateViewportWidths();
                    this.requestRender();
                }
            } else if (this.resizeState.type === 'vertical') {
                const height = event.y - this.resizeState.startY;
                const newHeight = Math.max(
                    this.minRowHeight,
                    Math.min(this.maxRowHeight, height)
                );
                
                if (newHeight !== this.resizeState.row.height) {
                    this.resizeState.row.setHeight(newHeight);
                    this.updateRowPositions();
                    this.requestRender();
                }
            } else {
                // No ongoing operation, show the available operations
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
            
            const mouseX = event.x - this.labelWidth;
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
                    const selectedRowsArray = Array.from(this.selectedRows);
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
                    const selectedRowsArray = Array.from(this.selectedRows);
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
                this.spliceRows(Array.from(this.selectedRows), []);
                this.selectedRows.clear();
                requestRender();
            }
        });
    }

    private handleRowSelection(row: RowImpl, event: MouseEvent): void {
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

    private setupGlobalDragHandlers(): void {
        const handleMouseMove = (e: globalThis.MouseEvent) => {
            if (this.resizeState.type !== 'dragging') return;
            
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
            if (this.resizeState.type !== 'dragging') return;
            
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

    getAllRows(): RowImpl[] {
        return [...this.rows];
    }

    private updateRowPositions(): void {
        let currentY = 0;
        for (const row of this.rows) {
            row.rowRenderObject.y = px(currentY);
            row.rowRenderObject.height = px(row.height);
            row.labelViewport.y = px(this.rowVerticalBorder);
            row.labelViewport.height = px(row.height - this.rowVerticalBorder);
            row.mainViewport.y = px(this.rowVerticalBorder);
            row.mainViewport.height = px(row.height - this.rowVerticalBorder);

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
        if (event.x >= labelWidth - halfResizeZoneWidth &&
            event.x <= labelWidth + halfResizeZoneWidth &&
            event.y <= this.rows.map(r => r.height).reduce((a, b) => a + b, 0) + halfResizeZoneHeight) {
            return { type: 'horizontal' };
        }
        if (event.x >= 0 && event.x < labelWidth) {
            let currentY = 0;
            for (const row of this.rows) {
                const rowBottom = currentY + row.height;
                if (event.y >= rowBottom - halfResizeZoneHeight && event.y <= rowBottom + halfResizeZoneHeight) {
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
                    this.handleRowSelection(row, event);
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
}
