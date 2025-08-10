import { Row } from './Plugin';
import { RenderObject, type RenderContext, type RenderBounds } from './RenderObject';
import { px } from './RenderObject';
import type { Signal } from './Signal';
import { ViewportRenderObject } from './ViewportRenderObject';

class RowRenderObject extends RenderObject {
    render(context: RenderContext, bounds: RenderBounds): boolean {
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
    }
}

export class RowImpl implements Row {
    public readonly signals: Signal[] = [];
    public readonly rowRenderObject: RowRenderObject;
    public yScale: number = 1.0;
    public yOffset: number = 0.0;
    private _height: number;
    public readonly labelViewport: ViewportRenderObject;
    public readonly mainViewport: ViewportRenderObject;
    
    constructor(
        signals?: Signal[],
        height: number = 50
    ) {
        this._height = height;
        this.rowRenderObject = new RowRenderObject();
        this.labelViewport = new ViewportRenderObject(-1);
        this.mainViewport = new ViewportRenderObject(-1);
        
        // Set black background for main viewport
        this.mainViewport.backgroundColor = [0.0, 0.0, 0.0, 1.0];
        
        this.rowRenderObject.addChild(this.labelViewport);
        this.rowRenderObject.addChild(this.mainViewport);

        if (signals) {
            this.signals = [...signals];
            this.calculateOptimalScaleAndOffset();
        }
    }

    get height(): number {
        return this._height;
    }

    setHeight(height: number): void {
        this._height = Math.max(20, height); // Minimum height of 20px
        this.rowRenderObject.height = px(this._height);
    }

    addRenderObject(renderObject: RenderObject): void {
        this.mainViewport.addChild(renderObject);
    }
    
    addLabelRenderObject(renderObject: RenderObject): void {
        this.labelViewport.addChild(renderObject);
    }
    
    private calculateOptimalScaleAndOffset(): void {
        if (this.signals.length === 0) {
            this.yScale = 1.0;
            this.yOffset = 0.0;
            return;
        }
        
        let minValue = Infinity;
        let maxValue = -Infinity;
        const padding = 0.7;
        
        for (const signal of this.signals) {
            minValue = Math.min(minValue, signal.minValue);
            maxValue = Math.max(maxValue, signal.maxValue);
        }
        
        if (minValue === Infinity || maxValue === -Infinity || minValue === maxValue) {
            this.yScale = 1.0;
            this.yOffset = 0.0;
        } else {
            this.yScale = 2.0 / (maxValue - minValue) * padding;
            this.yOffset = -(maxValue + minValue) / 2.0;
        }
    }
}
