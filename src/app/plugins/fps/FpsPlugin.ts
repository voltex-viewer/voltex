import type { PluginContext, Row } from '@voltex-viewer/plugin-api';
import { fpsRenderObject } from './FpsRenderObject';

export default (context: PluginContext): void => {
    let fpsRow: Row | null = null;
    context.onRowsChanged((event) => {
        if (fpsRow !== null && event.removed.includes(fpsRow)) {
            fpsRow = null;
        }
        if (!fpsRow && event.added.length > 0) {
            fpsRow = event.added[0];
            fpsRow.labelArea.addChild(fpsRenderObject());
        }
    });
}
