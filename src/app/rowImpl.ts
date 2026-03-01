import { Row, type RenderBounds, type RenderContext, px, type RenderObject, type Signal, type MouseEventHandlers } from '@voltex-viewer/plugin-api';
import { ViewportRenderObject } from './viewportRenderObject';

export class RowImpl implements Row {
    public readonly signals: Signal[] = [];
    public readonly rowRenderObject: RenderObject;
    public yScale: number = 1.0;
    public yOffset: number = 0.0;
    public minY: number = -1;
    public maxY: number = 1;
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
            this.updateSignalBounds();
            this.fitVertical();
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
    
    updateSignalBounds(): void {
        if (this.signals.length === 0) return;
        let minValue = Infinity;
        let maxValue = -Infinity;
        for (const signal of this.signals) {
            minValue = Math.min(minValue, signal.values.min);
            maxValue = Math.max(maxValue, signal.values.max);
        }
        if (minValue !== Infinity && maxValue !== -Infinity) {
            this.minY = minValue;
            this.maxY = maxValue;
        }
    }

    fitVertical(): void {
        this.setViewport(0, 0);
    }


    setViewport(yOffset: number, yScale: number): void {
        const maxBlankFraction = 0.3;
        const range = this.maxY - this.minY;
        const minFill = 1 - maxBlankFraction;
        const minYScale = range > 0 ? 2 * minFill / range : 1;
        this.yScale = Math.max(yScale, minYScale);
        const fill = range * this.yScale / 2;
        const blankFraction = maxBlankFraction * Math.min(1, Math.max(0, (fill - minFill) / maxBlankFraction));
        const k = (1 - 2 * blankFraction) / this.yScale;
        const minOffset = k - this.maxY;
        const maxOffset = -k - this.minY;
        if (minOffset > maxOffset) {
            this.yOffset = (minOffset + maxOffset) / 2;
        } else {
            this.yOffset = Math.max(minOffset, Math.min(maxOffset, yOffset));
        }
    }
}
