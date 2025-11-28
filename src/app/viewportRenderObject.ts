import { RenderObject, type RenderBounds, type RenderContext, type MouseEventHandlers } from "@voltex-viewer/plugin-api";

export class ViewportRenderObject {
    backgroundColor: [number, number, number, number] | null = null;
    public readonly renderObject: RenderObject;

    constructor(
        parent: RenderObject,
        zIndex: number = 0,
        mouseEventHandlers?: Partial<MouseEventHandlers>,
    ) {
        this.renderObject = parent.addChild({
            zIndex,
            viewport: true,
            render: (context: RenderContext, _bounds: RenderBounds) => {
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
            },
            ...mouseEventHandlers,
        });
    }

}
