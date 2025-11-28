import { percent, px, RenderBounds, RenderObjectArgs, RenderObject as RenderObject, type PositionValue, type RenderContext, type MouseEvent, type WheelEvent, type MouseEventHandlers, type MouseCaptureConfig } from "@voltex-viewer/plugin-api";

export class RenderObjectImpl implements RenderObject, MouseEventHandlers {
    public zIndex: number;
    protected internalChildren: RenderObjectImpl[] = [];
    protected internalParent: RenderObjectImpl | null = null;
    protected isMouseOver: boolean = false;
    public x: PositionValue;
    public y: PositionValue;
    public width: PositionValue;
    public height: PositionValue;
    public readonly viewport: boolean;
    onClick?: (event: MouseEvent) => void;
    onMouseDown?: (event: MouseEvent) => MouseCaptureConfig | void;
    onMouseUp?: (event: MouseEvent) => void;
    onMouseMove?: (event: MouseEvent) => MouseCaptureConfig | void;
    onMouseEnter?: (event: MouseEvent) => void;
    onMouseLeave?: (event: MouseEvent) => void;
    onWheel?: (event: WheelEvent) => void;

    constructor(parent: RenderObjectImpl | null, args: RenderObjectArgs) {
        this.zIndex = args.zIndex ?? 0;
        this.viewport = args.viewport ?? false;
        this.internalParent = parent;
        this.height = args.height ?? percent(100);
        this.width = args.width ?? percent(100);
        this.x = args.x ?? px(0);
        this.y = args.y ?? px(0);
        if (args.render) this.render = args.render;
        if (args.dispose) this.dispose = args.dispose;
        if (args.onClick) this.onClick = args.onClick;
        if (args.onMouseDown) this.onMouseDown = args.onMouseDown;
        if (args.onMouseUp) this.onMouseUp = args.onMouseUp;
        if (args.onMouseMove) this.onMouseMove = args.onMouseMove;
        if (args.onMouseEnter) this.onMouseEnter = args.onMouseEnter;
        if (args.onMouseLeave) this.onMouseLeave = args.onMouseLeave;
        if (args.onWheel) this.onWheel = args.onWheel;
    }

    public readonly render?: (context: RenderContext, bounds: RenderBounds) => boolean;

    public readonly dispose?: () => void;

    addChild(args: RenderObjectArgs): RenderObject {
        const child = new RenderObjectImpl(this, args);
        this.internalChildren.push(child);
        return child;
    }

    removeChild(child: RenderObject): void {
        const index = this.internalChildren.indexOf(child as RenderObjectImpl);
        if (index !== -1) {
            this.internalChildren.splice(index, 1);
        }
    }
    
    get children(): readonly RenderObject[] {
        return this.internalChildren.toSorted((a, b) => a.zIndex - b.zIndex);
    }

    get parent(): RenderObject | null {
        return this.internalParent;
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
