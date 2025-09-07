import type { PluginContext, Row } from '../../Plugin';
import { FpsRenderObject } from './FpsRenderObject';

export default (context: PluginContext): void => {
    let fpsRow: Row | null = null;
    context.onRowsChanged((event) => {
        if (event.removed.includes(fpsRow)){
            fpsRow = null;
        }
        if (!fpsRow && event.added.length > 0) {
            fpsRow = event.added[0];
            fpsRow.addLabelRenderObject(new FpsRenderObject());
        }
    });
}
