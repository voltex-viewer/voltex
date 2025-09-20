import { RenderObjectArgs, type RenderBounds, type RenderContext } from "@voltex-viewer/plugin-api";

export function fpsRenderObject(): RenderObjectArgs {
    let frameCount = 0;
    let fps = 0;
    let updateInterval = 500; // Update FPS every 500ms
    let lastUpdate = performance.now();
    
    function updateFps(): void {
        const now = performance.now();
        frameCount++;

        if (now - lastUpdate >= updateInterval) {
            fps = Math.round((frameCount * 1000) / (now - lastUpdate));
            frameCount = 0;
            lastUpdate = now;
        }
    }

    return {
        zIndex: 1000,
        
        render(context: RenderContext, bounds: RenderBounds): boolean {
            updateFps();

            const text = `FPS: ${fps}`;
            const x = bounds.x + 0;
            const y = bounds.y + 5;
            
            context.render.utils.drawText(text, x, y, bounds, {
                fillStyle: '#ffffff'
            });

            return false;
        }
    };
}
