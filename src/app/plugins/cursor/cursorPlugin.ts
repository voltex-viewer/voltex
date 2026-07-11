import { type PluginContext, Keybinding, type MouseEvent, Row, type KeybindingBrand } from '@voltex-viewer/plugin-api';
import * as t from 'io-ts';
import { CursorRenderObject } from './cursorRenderObject';
import { CursorSidebar } from './cursorSidebar';

const cursorColors = [
    '#FF6B6B',
    '#4ECDC4',
    '#45B7D1',
    '#FFA07A',
    '#98D8C8',
    '#F7DC6F',
    '#BB8FCE',
    '#85C1E2',
    '#F8B739',
    '#52B788',
];

const cursorConfigSchema = t.type({
    keybindings: t.type({
        'add': Keybinding,
        'cancel': Keybinding,
    })
});

type CursorConfig = t.TypeOf<typeof cursorConfigSchema>;

export type { CursorConfig };

class MousePositionTracker {
    private lastMouseX: number | null = null;

    constructor(private context: PluginContext) {
        this.initialize();
    }

    private initialize(): void {
        this.context.rootRenderObject.addChild({
            zIndex: -1000, // Low z-index to not interfere with other interactions
            onMouseMove: (event: MouseEvent) => {
                // Store the clientX which is relative to the root
                this.lastMouseX = event.clientX;
            },
        });
    }

    getLastMouseX(): number | null {
        if (this.lastMouseX === null) return null;
        return this.toMainAreaX(this.lastMouseX);
    }

    toMainAreaX(clientX: number): number {
        // Subtract the label width to get position relative to main area
        const rows = this.context.getRows();
        if (rows.length === 0) return clientX;

        const firstRow = rows[0];
        const labelWidth = firstRow.labelArea.width;

        if (labelWidth.type !== 'pixels') return clientX;

        return clientX - labelWidth.value;
    }

    screenXToTime(screenX: number): number {
        const { state } = this.context;
        return (state.offset + screenX) / state.pxPerSecond;
    }
}

export default (context: PluginContext): void => {
    const config: CursorConfig = context.loadConfig(cursorConfigSchema, {
        keybindings: {
            'add': 'c' as t.Branded<string, KeybindingBrand>,
            'cancel': 'escape' as t.Branded<string, KeybindingBrand>,
        }
    });

    const mouseTracker = new MousePositionTracker(context);
    const cursors: CursorRenderObject[] = [];
    let isAddingCursor = false;
    let nextCursorNumber = 1;
    let activeCursor: CursorRenderObject | null = null;
    let mouseDownPosition: { x: number; y: number } | null = null;
    let hoveredRow: Row | undefined = undefined;
    // Set while an existing cursor is being drag-moved; holds the position to restore on cancel
    let movingOriginalPosition: number | null = null;
    let markerUnderMouse: CursorRenderObject | null = null;
    let hoveredMarker: CursorRenderObject | null = null;

    const setHoveredMarker = (marker: CursorRenderObject | null) => {
        if (hoveredMarker === marker) return;
        hoveredMarker?.setMarkerHovered(false);
        marker?.setMarkerHovered(true);
        hoveredMarker = marker;
        context.requestRender();
    };

    const removeCursor = (cursor: CursorRenderObject) => {
        cursor.cleanup();
        const index = cursors.indexOf(cursor);
        if (index > -1) {
            cursors.splice(index, 1);
        }
        if (activeCursor === cursor) {
            activeCursor = null;
            isAddingCursor = false;
            movingOriginalPosition = null;
        }
        if (markerUnderMouse === cursor) {
            markerUnderMouse = null;
        }
        if (hoveredMarker === cursor) {
            hoveredMarker = null;
        }
        cursorSidebar.updateContent();
        context.requestRender();
    };

    const cursorSidebar = new CursorSidebar(context, cursors, removeCursor, config);
    
    context.addSidebarEntry({
        title: 'Cursors',
        iconHtml: `<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="8" y="3" width="8" height="8" rx="2"/>
            <line x1="12" y1="11" x2="12" y2="21"/>
        </svg>`,
        renderContent: () => cursorSidebar.render()
    });

    context.onRowsChanged((event) => {
        for (const cursor of cursors) {
            cursor.addRowRenderObjects(event.added);
        }
        
        // Set up hover tracking for each row
        for (const row of event.added) {
            row.mainArea.addChild({
                zIndex: -999,
                onMouseEnter: () => {
                    hoveredRow = row;
                },
                onMouseLeave: () => {
                    if (hoveredRow === row) {
                        hoveredRow = undefined;
                    }
                }
            });

            // Rows without signals show the numbered markers (see CursorRenderObject).
            // Track which marker is under the mouse here, where row-local coordinates
            // are available; the global handler below uses it to start a drag-move.
            if (row.signals.length === 0) {
                row.mainArea.addChild({
                    zIndex: 1001,
                    onMouseMove: (event: MouseEvent) => {
                        markerUnderMouse = cursors.find(c => c.hitTestMarker(event.offsetX, event.offsetY)) ?? null;
                        // Highlight the hovered marker, or the grabbed one while dragging
                        setHoveredMarker(!activeCursor || markerUnderMouse === activeCursor ? markerUnderMouse : null);
                        if (markerUnderMouse && !activeCursor) {
                            document.body.style.cursor = 'pointer';
                        }
                    },
                    onMouseLeave: () => {
                        markerUnderMouse = null;
                        // Keep the grabbed marker highlighted while dragging below the axis
                        setHoveredMarker(movingOriginalPosition !== null ? activeCursor : null);
                    }
                });
            }
        }
        
        cursorSidebar.updateContent();
    });

    // Set up global mouse tracking for active cursor
    context.rootRenderObject.addChild({
        zIndex: 1001, // Higher than cursor render objects
        onMouseMove: (event: MouseEvent) => {
            if (!activeCursor) return;

            const time = mouseTracker.screenXToTime(mouseTracker.toMainAreaX(event.clientX));
            activeCursor.updatePosition(time, hoveredRow);
            cursorSidebar.updateContent();
            context.requestRender();

            // Clear mousedown position if mouse moved significantly
            if (mouseDownPosition) {
                const dx = Math.abs(event.clientX - mouseDownPosition.x);
                const dy = Math.abs(event.clientY - mouseDownPosition.y);
                if (dx > 3 || dy > 3) {
                    mouseDownPosition = null;
                }
            }
        },
        onMouseDown: (event: MouseEvent) => {
            if (event.button !== 0) return;

            if (activeCursor) {
                mouseDownPosition = { x: event.clientX, y: event.clientY };
                return;
            }

            // Grab a marker in the time axis to drag-move its cursor. Re-check the x
            // position: the view may have panned/zoomed under a stationary mouse since
            // markerUnderMouse was last updated.
            if (markerUnderMouse && !event.altKey && !event.ctrlKey &&
                markerUnderMouse.hitTestMarkerX(mouseTracker.toMainAreaX(event.clientX))) {
                const position = markerUnderMouse.getPosition();
                if (position === null) return;

                activeCursor = markerUnderMouse;
                movingOriginalPosition = position;
                context.requestRender();
                // Claim this mousedown before the pan handler sees it
                event.stopPropagation();
                return { captureMouse: true, allowMouseMoveThrough: true, preventDefault: true };
            }
        },
        onMouseUp: (event: MouseEvent) => {
            if (event.button !== 0 || !activeCursor) return;

            if (movingOriginalPosition !== null) {
                // End of a drag-move: drop the cursor where the button was released
                activeCursor = null;
                movingOriginalPosition = null;
                setHoveredMarker(markerUnderMouse);
                cursorSidebar.updateContent();
                context.requestRender();
                return;
            }

            if (mouseDownPosition) {
                // Only place cursor if mouse didn't move significantly
                const position = activeCursor.getPosition();
                if (position !== null) {
                    activeCursor = null;
                    isAddingCursor = false;
                    cursorSidebar.updateContent();
                    context.requestRender();
                }
            }

            mouseDownPosition = null;
        }
    });

    context.registerCommand({
        id: 'add',
        action: () => {
            if (isAddingCursor || activeCursor) return;

            isAddingCursor = true;
            
            // Find the smallest available cursor number
            const usedNumbers = new Set(cursors.map(c => c.getCursorNumber()));
            let cursorNumber = 1;
            while (usedNumbers.has(cursorNumber)) {
                cursorNumber++;
            }
            nextCursorNumber = Math.max(nextCursorNumber, cursorNumber + 1);
            
            const color = cursorColors[(cursorNumber - 1) % cursorColors.length];
            
            // Get initial position from mouse tracker
            const mouseX = mouseTracker.getLastMouseX();
            const initialTime = mouseX !== null ? mouseTracker.screenXToTime(mouseX) : null;
            
            const cursor = new CursorRenderObject(
                context,
                cursorNumber,
                color,
                initialTime,
                hoveredRow
            );
            cursor.addRowRenderObjects(context.getRows());
            
            activeCursor = cursor;
            cursors.push(cursor);
            cursorSidebar.updateContent();
            context.requestRender();
        }
    });

    context.registerCommand({
        id: 'cancel',
        action: () => {
            if (!activeCursor) return;

            if (movingOriginalPosition !== null) {
                // Moving an existing cursor: put it back instead of deleting it
                activeCursor.setPosition(movingOriginalPosition);
                activeCursor = null;
                movingOriginalPosition = null;
                mouseDownPosition = null;
                markerUnderMouse = null;
                setHoveredMarker(null);
                cursorSidebar.updateContent();
                context.requestRender();
                return;
            }

            if (markerUnderMouse === activeCursor) {
                markerUnderMouse = null;
            }
            if (hoveredMarker === activeCursor) {
                hoveredMarker = null;
            }
            activeCursor.cleanup();
            const index = cursors.indexOf(activeCursor);
            if (index > -1) {
                cursors.splice(index, 1);
            }
            activeCursor = null;
            isAddingCursor = false;
            nextCursorNumber--;
            mouseDownPosition = null;
            cursorSidebar.updateContent();
            context.requestRender();
        }
    });
};
