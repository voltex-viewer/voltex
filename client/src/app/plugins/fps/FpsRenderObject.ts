import { RenderObject, type RenderContext, type RenderBounds } from '../../RenderObject';
import { WebGLUtils } from '../../WebGLUtils';

export class FpsRenderObject extends RenderObject {
    private frameCount = 0;
    private fps = 0;
    private updateInterval = 500; // Update FPS every 500ms
    private lastUpdate = performance.now();

    constructor() {
        super(1000); // High z-index to render on top
    }
    
    render(context: RenderContext, bounds: RenderBounds): boolean {
        this.updateFps();
        
        const text = `FPS: ${this.fps}`;
        const x = bounds.x + 0;
        const y = bounds.y + 5;
        
        context.render.utils.drawText(text, x, y, bounds, {
            fillStyle: '#ffffff'
        });

        return false;
    }
    
    private updateFps(): void {
        const now = performance.now();
        this.frameCount++;
        
        if (now - this.lastUpdate >= this.updateInterval) {
            this.fps = Math.round((this.frameCount * 1000) / (now - this.lastUpdate));
            this.frameCount = 0;
            this.lastUpdate = now;
        }
    }
}
