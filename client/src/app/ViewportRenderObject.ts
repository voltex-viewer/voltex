import { RenderObject, type RenderContext, type RenderBounds } from './RenderObject';

export class ViewportRenderObject extends RenderObject {
    backgroundColor: [number, number, number, number] | null = null;

    constructor(zIndex: number = 0) {
        super(zIndex);
    }

    render(context: RenderContext, bounds: RenderBounds): boolean {
        const dpr = context.dpr;
        const { gl } = context.render;

        gl.viewport(
            bounds.x * dpr,
            context.canvas.height - (bounds.y + bounds.height) * dpr,
            bounds.width * dpr,
            bounds.height * dpr
        );

        // Clear background if color is set
        if (this.backgroundColor) {
            const [r, g, b, a] = this.backgroundColor;
            
            // Need scissor test for gl.clear() to only clear this viewport area
            const canvasHeight = context.canvas.height;
            const scissorX = Math.round(bounds.x * dpr);
            const scissorY = Math.round(canvasHeight - (bounds.y + bounds.height) * dpr);
            const scissorWidth = Math.round(bounds.width * dpr);
            const scissorHeight = Math.round(bounds.height * dpr);
            
            gl.enable(gl.SCISSOR_TEST);
            gl.scissor(scissorX, scissorY, scissorWidth, scissorHeight);
            gl.clearColor(r, g, b, a);
            gl.clear(gl.COLOR_BUFFER_BIT);
            gl.disable(gl.SCISSOR_TEST);
        }

        return false;
    }
}
