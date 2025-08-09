import { Row } from './Plugin';
import type { RenderObject } from './RenderObject';
import { px } from './RenderObject';
import type { Signal } from './Signal';
import { ContainerRenderObject } from './ContainerRenderObject';
import type { RowContainerRenderObject } from './RowContainerRenderObject';
import { ViewportRenderObject } from './ViewportRenderObject';

export class RowImpl implements Row {
    public readonly signals: Signal[] = [];
    public readonly rowRenderObject: ContainerRenderObject;
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
        this.rowRenderObject = new ContainerRenderObject();
        this.labelViewport = new ViewportRenderObject(-1);
        this.mainViewport = new ViewportRenderObject(-1);
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
        
        for (const signal of this.signals) {
            minValue = Math.min(minValue, signal.minValue);
            maxValue = Math.max(maxValue, signal.maxValue);
        }
        
        if (minValue === Infinity || maxValue === -Infinity || minValue === maxValue) {
            this.yScale = 1.0;
            this.yOffset = 0.0;
        } else {
            this.yScale = 2.0 / (maxValue - minValue);
            this.yOffset = -(maxValue + minValue) / 2.0;
        }
    }
}
