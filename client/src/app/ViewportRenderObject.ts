import { RenderObject, type RenderContext, type RenderBounds } from './RenderObject';

export class ViewportRenderObject extends RenderObject {
    backgroundColor: [number, number, number, number] | null = null;

    constructor(zIndex: number = 0) {
        super(zIndex, true);
    }

    render(context: RenderContext, bounds: RenderBounds): boolean {
        // Clear background if color is set
        if (this.backgroundColor) {
            const [r, g, b, a] = this.backgroundColor;
            
            // Need scissor test for gl.clear() to only clear this viewport area
            const { gl } = context.render;
            gl.enable(gl.SCISSOR_TEST);
            gl.scissor(context.viewport[0], context.viewport[1], context.viewport[2], context.viewport[3]);
            gl.clearColor(r, g, b, a);
            gl.clear(gl.COLOR_BUFFER_BIT);
            gl.disable(gl.SCISSOR_TEST);
        }

        return false;
    }
}
