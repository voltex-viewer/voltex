import { Row, type RenderBounds, type RenderContext, px, type RenderObject, type Signal, type MouseEvent, type MouseEventHandlers } from '@voltex-viewer/plugin-api';
import { ViewportRenderObject } from './ViewportRenderObject';

export class RowImpl implements Row {
    public readonly signals: Signal[] = [];
    public readonly rowRenderObject: RenderObject;
    public yScale: number = 1.0;
    public yOffset: number = 0.0;
    public selected: boolean = false;
    public readonly labelViewport: ViewportRenderObject;
    public readonly mainViewport: ViewportRenderObject;
    
    constructor(
        parent: RenderObject,
        signals: Signal[],
        height: number,
        mouseEventHandlers?: Partial<MouseEventHandlers>,
    ) {
        this.rowRenderObject = parent.addChild({
            render: (context: RenderContext, bounds: RenderBounds): boolean => {
                const { gl } = context.render;
                const { dpr } = context;
                
                // Convert UI coordinates to WebGL coordinates
                // WebGL has (0,0) at bottom-left, UI has (0,0) at top-left
                const canvasHeight = context.canvas.height;
                const scissorX = Math.round(bounds.x * dpr);
                const scissorY = Math.round(canvasHeight - (bounds.y + bounds.height) * dpr);
                const scissorWidth = Math.round(bounds.width * dpr);
                const scissorHeight = Math.round(bounds.height * dpr);
                
                // Clear background
                gl.enable(gl.SCISSOR_TEST);
                gl.scissor(scissorX, scissorY, scissorWidth, scissorHeight);
                gl.clearColor(0.2, 0.2, 0.2, 1.0);
                gl.clear(gl.COLOR_BUFFER_BIT);
                gl.disable(gl.SCISSOR_TEST);
                
                return false;
            },
            height: px(height),
        });
        this.labelViewport = new ViewportRenderObject(this.rowRenderObject, -1, mouseEventHandlers);
        this.mainViewport = new ViewportRenderObject(this.rowRenderObject, -1);

        // Set black background for main viewport
        this.mainViewport.backgroundColor = [0.0, 0.0, 0.0, 1.0];

        if (signals) {
            this.signals = [...signals];
            this.calculateOptimalScaleAndOffset();
        }
    }
    get mainArea(): RenderObject {
        return this.mainViewport.renderObject;
    }

    get labelArea(): RenderObject {
        return this.labelViewport.renderObject;
    }

    get height(): number {
        if (this.rowRenderObject.height.type !== 'pixels') {
            throw new Error('Row height is not in pixels');
        }
        return this.rowRenderObject.height.value;
    }

    setHeight(height: number): void {
        this.rowRenderObject.height = px(height);
    }
    
    calculateOptimalScaleAndOffset(): void {
        if (this.signals.length === 0) {
            this.yScale = 1.0;
            this.yOffset = 0.0;
            return;
        }
        
        let minValue = Infinity;
        let maxValue = -Infinity;
        const padding = 0.7;
        
        for (const signal of this.signals) {
            minValue = Math.min(minValue, signal.values.min);
            maxValue = Math.max(maxValue, signal.values.max);
        }
        
        if (minValue === Infinity || maxValue === -Infinity) {
            this.yScale = 1.0;
            this.yOffset = 0.0;
        } else if (minValue === maxValue) {
            this.yScale = 1.0;
            this.yOffset = -minValue;
        } else {
            this.yScale = 2.0 / (maxValue - minValue) * padding;
            this.yOffset = -(maxValue + minValue) / 2.0;
        }
    }
}
