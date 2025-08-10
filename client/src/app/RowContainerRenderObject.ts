import { ContainerRenderObject } from './ContainerRenderObject';
import { RowImpl } from './RowImpl';
import type { WaveformState } from './WaveformState';
import { px, type MouseEvent, type WheelEvent } from './RenderObject';

type ResizeState = 
    | { type: 'none' }
    | { type: 'horizontal'; startX: number }
    | { type: 'vertical'; startY: number; row: RowImpl }
    | { type: 'dragging'; startX: number; startTimeAtCursor: number; lastX: number; lastTime: number; velocity: number };

export class RowContainerRenderObject extends ContainerRenderObject {
    private rows: RowImpl[] = [];
    
    // Unified state for resizing and dragging
    private resizeState: ResizeState = { type: 'none' };
    
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
                this.updateCursor(event);
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

    addRow(row: RowImpl): void {
        this.insertRowAtIndex(row, this.rows.length);
    }

    insertRowAtIndex(row: RowImpl, index: number): void {
        const insertIndex = Math.max(0, Math.min(index, this.rows.length));
        this.rows.splice(insertIndex, 0, row);
        this.addChild(row.rowRenderObject);
        this.updateRowPositions();
        this.updateViewportWidths();
        this.requestRender();
    }

    removeRow(row: RowImpl): void {
        const index = this.rows.indexOf(row);
        if (index === -1) return;
        
        this.rows.splice(index, 1);

        row.rowRenderObject.dispose();
        
        this.updateRowPositions();
        this.requestRender();
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

    private updateCursor(event: MouseEvent): void {
        const mousePosition = this.getMousePosition(event);
        document.body.style.cursor = 
            mousePosition.type === 'horizontal' ? 'ew-resize' :
            mousePosition.type === 'vertical' ? 'ns-resize' : '';
    }

    groupRows(rowsToMerge: RowImpl[]): RowImpl {
        if (rowsToMerge.length === 0) {
            throw new Error('Cannot merge empty row list');
        }
        
        const firstRowIndex = this.rows.findIndex(r => rowsToMerge.includes(r));
        
        // Collect all channels from rows to merge
        const allChannels = Array.from(new Set(rowsToMerge.flatMap(row => row.signals)));
        
        // Create new merged row (don't call addRow yet)
        const mergedRow = new RowImpl(allChannels);
        
        // Remove old rows from our internal array first
        this.rows = this.rows.filter(r => !rowsToMerge.includes(r));
        
        // Remove old rows from the render tree and clean up their viewports
        for (const row of rowsToMerge) {
            row.rowRenderObject.dispose();
        }
        
        // Add the merged row at the appropriate position
        const adjustedIndex = Math.min(Math.max(0, firstRowIndex), this.rows.length);
        this.rows.splice(adjustedIndex, 0, mergedRow);
        
        // Set up the merged row properly
        this.addChild(mergedRow.rowRenderObject);

        this.updateRowPositions();
        this.updateViewportWidths();
        this.requestRender();
        
        return mergedRow;
    }

    ungroupRows(rowsToSplit: RowImpl[]): RowImpl[] {
        const newRows: RowImpl[] = [];
        
        for (const row of rowsToSplit) {
            const index = this.rows.indexOf(row);
            if (index !== -1) {
                // Create individual rows
                const individualRows = row.signals.map(channel => new RowImpl([channel]));
                
                // Remove the old row from our internal array
                this.rows.splice(index, 1);
                
                row.rowRenderObject.dispose();
                
                // Insert individual rows at the same position
                this.rows.splice(index, 0, ...individualRows);
                
                // Set up each new row
                for (const newRow of individualRows) {
                    this.addChild(newRow.rowRenderObject);
                }
                
                newRows.push(...individualRows);
            }
        }
        
        this.updateRowPositions();
        this.updateViewportWidths();
        this.requestRender();
        
        return newRows;
    }
}
