import { type PluginContext, Keybinding, type MouseEvent } from '@voltex-viewer/plugin-api';
import * as t from 'io-ts';
import { CursorRenderObject } from './CursorRenderObject';

const CURSOR_COLORS = [
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

const CursorConfigSchema = t.type({
    keybindings: t.type({
        'cursor.add': Keybinding,
        'cursor.cancel': Keybinding,
    })
});

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
        
        // Subtract the label width to get position relative to main area
        const rows = this.context.getRows();
        if (rows.length === 0) return this.lastMouseX;
        
        const firstRow = rows[0];
        const labelWidth = firstRow.labelArea.width;
        
        if (labelWidth.type !== 'pixels') return this.lastMouseX;
        
        return this.lastMouseX - labelWidth.value;
    }

    screenXToTime(screenX: number): number {
        const { state } = this.context;
        return (state.offset + screenX) / state.pxPerSecond;
    }
}

export default (context: PluginContext): void => {
    const config = context.loadConfig(CursorConfigSchema, {
        keybindings: {
            'cursor.add': 'c',
            'cursor.cancel': 'escape',
        }
    });

    const mouseTracker = new MousePositionTracker(context);
    const cursors: CursorRenderObject[] = [];
    let isAddingCursor = false;
    let nextCursorNumber = 1;
    let activeCursor: CursorRenderObject | null = null;
    let mouseDownPosition: { x: number; y: number } | null = null;

    context.onRowsChanged((event) => {
        for (const cursor of cursors) {
            cursor.addRowRenderObjects(event.added);
        }
    });

    // Set up global mouse tracking for active cursor
    context.rootRenderObject.addChild({
        zIndex: 1001, // Higher than cursor render objects
        onMouseMove: (event: MouseEvent) => {
            if (!activeCursor) return;
            
            const mouseX = mouseTracker.getLastMouseX();
            if (mouseX !== null) {
                const time = mouseTracker.screenXToTime(mouseX);
                activeCursor.updatePosition(time);
                context.requestRender();
            }
            
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
            if (!activeCursor) return;
            
            if (event.button === 0) {
                mouseDownPosition = { x: event.clientX, y: event.clientY };
            }
        },
        onMouseUp: (event: MouseEvent) => {
            if (!activeCursor) return;
            
            if (event.button === 0 && mouseDownPosition) {
                // Only place cursor if mouse didn't move significantly
                const position = activeCursor.getPosition();
                if (position !== null) {
                    activeCursor = null;
                    isAddingCursor = false;
                    context.requestRender();
                }
            }
            
            mouseDownPosition = null;
        }
    });

    context.registerCommand({
        id: 'cursor.add',
        action: () => {
            if (isAddingCursor) return;
            
            isAddingCursor = true;
            const cursorNumber = nextCursorNumber++;
            const color = CURSOR_COLORS[(cursorNumber - 1) % CURSOR_COLORS.length];
            
            // Get initial position from mouse tracker
            const mouseX = mouseTracker.getLastMouseX();
            const initialTime = mouseX !== null ? mouseTracker.screenXToTime(mouseX) : null;
            
            const cursor = new CursorRenderObject(
                context,
                cursorNumber,
                color,
                initialTime
            );
            cursor.addRowRenderObjects(context.getRows());
            
            activeCursor = cursor;
            cursors.push(cursor);
            context.requestRender();
        }
    });

    context.registerCommand({
        id: 'cursor.cancel',
        action: () => {
            if (!activeCursor) return;
            
            activeCursor.cleanup();
            const index = cursors.indexOf(activeCursor);
            if (index > -1) {
                cursors.splice(index, 1);
            }
            activeCursor = null;
            isAddingCursor = false;
            nextCursorNumber--;
            mouseDownPosition = null;
            context.requestRender();
        }
    });
};
