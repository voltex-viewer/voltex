import { Row } from './Plugin';
import type { RenderObject } from './RenderObject';
import type { Signal } from './Signal';

export class RowImpl implements Row {
    public readonly signals: Signal[] = [];
    public readonly labelRenderObjects: RenderObject[] = [];
    public readonly renderObjects: RenderObject[] = [];
    public yScale: number = 1.0;
    public yOffset: number = 0.0;
    private _height: number;
    
    constructor(
        signals?: Signal[],
        height: number = 50
    ) {
        this._height = height;
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
    }

    addRenderObject(renderObject: RenderObject): void {
        this.renderObjects.push(renderObject);
    }
    
    addLabelRenderObject(renderObject: RenderObject): void {
        this.labelRenderObjects.push(renderObject);
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
