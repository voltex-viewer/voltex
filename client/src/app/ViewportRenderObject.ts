import { RenderObject, type RenderContext, type RenderBounds } from './RenderObject';

export class ViewportRenderObject extends RenderObject {

    constructor(zIndex: number = 0) {
        super(zIndex);
    }

    render(context: RenderContext, bounds: RenderBounds): boolean {
        const dpr = context.dpr;

        context.render.gl.viewport(
            bounds.x * dpr,
            context.canvas.height - (bounds.y + bounds.height) * dpr,
            bounds.width * dpr,
            bounds.height * dpr
        );

        return false;
    }
}
