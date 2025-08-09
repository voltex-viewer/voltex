import { RenderObject, RenderContext, RenderBounds } from './RenderObject';

export class ContainerRenderObject extends RenderObject {
    render(context: RenderContext, bounds: RenderBounds): boolean {
        return false;
    }
}
