import type { WaveformState } from './WaveformState';
import { WebGLUtils } from './WebGLUtils';

export interface RenderContext {
    canvas: HTMLCanvasElement;
    render: WebGlContext;
    state: WaveformState;
    dpr: number;
}

export interface WebGlContext {
    gl: WebGLRenderingContext;
    utils: WebGLUtils;
}

export interface RenderBounds {
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface MouseEvent {
    x: number;
    y: number;
    button: number;
    ctrlKey: boolean;
    metaKey: boolean;
    shiftKey: boolean;
    altKey: boolean;
    preventDefault(): void;
    stopPropagation(): void;
}

export interface WheelEvent extends MouseEvent {
    deltaY: number;
    deltaX: number;
    deltaZ: number;
}

export interface MouseEventHandlers {
    onMouseDown?: (event: MouseEvent) => void;
    onMouseUp?: (event: MouseEvent) => void;
    onMouseMove?: (event: MouseEvent) => void;
    onMouseEnter?: (event: MouseEvent) => void;
    onMouseLeave?: (event: MouseEvent) => void;
    onClick?: (event: MouseEvent) => void;
    onWheel?: (event: WheelEvent) => void;
}

export type PositionValue = 
    | { type: 'pixels'; value: number }
    | { type: 'percentage'; value: number };

// Helper functions for creating PositionValue objects
export function px(value: number): PositionValue {
    return { type: 'pixels', value };
}

export function percent(value: number): PositionValue {
    return { type: 'percentage', value };
}

export interface Position {
    x: PositionValue;
    y: PositionValue;
}

export interface Size {
    width: PositionValue;
    height: PositionValue;
}

export abstract class RenderObject {
    public zIndex: number = 0;
    protected children: RenderObject[] = [];
    protected parent: RenderObject | null = null;
    protected mouseEventHandlers: MouseEventHandlers = {};
    protected isMouseOver: boolean = false;
    public x: PositionValue = px(0);
    public y: PositionValue = px(0);
    public width: PositionValue = percent(100);
    public height: PositionValue = percent(100);

    constructor(zIndex: number = 0) {
        this.zIndex = zIndex;
    }
    
    abstract render(context: RenderContext, bounds: RenderBounds): boolean;

    addChild(child: RenderObject): void {
        if (child.parent) {
            child.parent.removeChild(child);
        }
        child.parent = this;
        this.children.push(child);
    }

    removeChild(child: RenderObject): void {
        const index = this.children.indexOf(child);
        if (index !== -1) {
            this.children.splice(index, 1);
            child.parent = null;
        }
    }

    getChildren(): readonly RenderObject[] {
        return this.children.toSorted((a, b) => a.zIndex - b.zIndex);
    }

    getParent(): RenderObject | null {
        return this.parent;
    }

    calculateBounds(parentBounds: RenderBounds): RenderBounds {
        return {
            x: parentBounds.x + this.resolvePositionValue(this.x, parentBounds.width),
            y: parentBounds.y + this.resolvePositionValue(this.y, parentBounds.height),
            width: this.resolvePositionValue(this.width, parentBounds.width),
            height: this.resolvePositionValue(this.height, parentBounds.height)
        };
    }

    getAbsoluteBounds(): RenderBounds {
        if (!this.parent) {
            return {
                x: this.resolvePositionValue(this.x, 0),
                y: this.resolvePositionValue(this.y, 0),
                width: this.resolvePositionValue(this.width, 0),
                height: this.resolvePositionValue(this.height, 0),
            };
        }
        return this.calculateBounds(this.parent.getAbsoluteBounds());
    }

    /**
     * Resolve a position value (discriminated union) to an absolute number
     */
    private resolvePositionValue(value: PositionValue, parentDimension: number): number {
        switch (value.type) {
            case 'pixels':
                return value.value;
            case 'percentage':
                return (value.value / 100) * parentDimension;
            default:
                throw new Error(`Unknown position value type: ${JSON.stringify(value)}`);
        }
    }

    addEventListener(eventType: keyof MouseEventHandlers, callback: (event: MouseEvent) => void): void {
        this.mouseEventHandlers[eventType] = callback;
    }

    onMouseDown(callback: (event: MouseEvent) => void): void {
        this.mouseEventHandlers.onMouseDown = callback;
    }

    onMouseUp(callback: (event: MouseEvent) => void): void {
        this.mouseEventHandlers.onMouseUp = callback;
    }

    onMouseMove(callback: (event: MouseEvent) => void): void {
        this.mouseEventHandlers.onMouseMove = callback;
    }

    onMouseEnter(callback: (event: MouseEvent) => void): void {
        this.mouseEventHandlers.onMouseEnter = callback;
    }

    onMouseLeave(callback: (event: MouseEvent) => void): void {
        this.mouseEventHandlers.onMouseLeave = callback;
    }

    onClick(callback: (event: MouseEvent) => void): void {
        this.mouseEventHandlers.onClick = callback;
    }

    onWheel(callback: (event: WheelEvent) => void): void {
        this.mouseEventHandlers.onWheel = callback;
    }

    emitMouseEvent(eventType: keyof MouseEventHandlers, event: MouseEvent): void {
        if (eventType === 'onWheel') {
            this.mouseEventHandlers[eventType]?.(event as WheelEvent);
        } else {
            (this.mouseEventHandlers[eventType] as ((event: MouseEvent) => void))?.(event);
        }
    }

    updateMouseOver(isOver: boolean, event: MouseEvent): void {
        if (isOver && !this.isMouseOver) {
            this.isMouseOver = true;
            this.mouseEventHandlers.onMouseEnter?.(event);
        } else if (!isOver && this.isMouseOver) {
            this.isMouseOver = false;
            this.mouseEventHandlers.onMouseLeave?.(event);
        }
    }

    dispose(): void {
        for (const child of this.children) {
            child.dispose();
        }
        this.children = [];
        this.parent?.removeChild(this);
        this.mouseEventHandlers = {};
    }
}
