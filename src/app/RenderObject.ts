import { percent, px, RenderBounds, RenderObjectArgs, RenderObject as RenderObject, type PositionValue, type RenderContext } from "@voltex/plugin-api";

export interface MouseEvent {
    clientX: number;
    clientY: number;
    offsetX: number;
    offsetY: number;
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

export class RenderObjectImpl implements RenderObject, MouseEventHandlers {
    public zIndex: number;
    protected _children: RenderObjectImpl[] = [];
    protected _parent: RenderObjectImpl | null = null;
    protected isMouseOver: boolean = false;
    public x: PositionValue = px(0);
    public y: PositionValue = px(0);
    public width: PositionValue = percent(100);
    public height: PositionValue = percent(100);
    public readonly viewport: boolean;
    onClick?: (event: MouseEvent) => void;
    onMouseDown: (event: MouseEvent) => void;
    onMouseUp: (event: MouseEvent) => void;
    onMouseMove: (event: MouseEvent) => void;
    onMouseEnter: (event: MouseEvent) => void;
    onMouseLeave: (event: MouseEvent) => void;
    onWheel: (event: WheelEvent) => void;

    constructor(parent: RenderObjectImpl, args: RenderObjectArgs) {
        this.zIndex = args.zIndex ?? 0;
        this.viewport = args.viewport ?? false;
        this._parent = parent;
        this.render = args.render;
        this.dispose = args.dispose;
        this.onClick = args.onClick;
        this.onMouseDown = args.onMouseDown;
        this.onMouseUp = args.onMouseUp;
        this.onMouseMove = args.onMouseMove;
        this.onMouseEnter = args.onMouseEnter;
        this.onMouseLeave = args.onMouseLeave;
        this.onWheel = args.onWheel;
    }

    public readonly render?: (context: RenderContext, bounds: RenderBounds) => boolean;

    public readonly dispose?: () => void;

    addChild(args: RenderObjectArgs): RenderObject {
        const child = new RenderObjectImpl(this, args);
        this._children.push(child);
        return child;
    }

    removeChild(child: RenderObject): void {
        const index = this._children.indexOf(child as RenderObjectImpl);
        if (index !== -1) {
            this._children.splice(index, 1);
        }
    }
    
    get children(): readonly RenderObject[] {
        return this._children.toSorted((a, b) => a.zIndex - b.zIndex);
    }

    get parent(): RenderObject | null {
        return this._parent;
    }

    updateMouseOver(isOver: boolean, event: MouseEvent): void {
        if (isOver && !this.isMouseOver) {
            this.isMouseOver = true;
            this.onMouseEnter?.(event);
        } else if (!isOver && this.isMouseOver) {
            this.isMouseOver = false;
            this.onMouseLeave?.(event);
        }
    }
}
