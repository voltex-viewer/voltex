import { type PluginContext } from '@voltex-viewer/plugin-api';
import { TimeAxisRenderObject } from './TimeAxisRenderObject';
import { GridRenderObject } from './GridRenderObject';

export default (context: PluginContext): void => {
    const timeAxisRow = context.spliceRows([], [{ index: 0, row: { height: TimeAxisRenderObject.getAxisHeight() } }])[0];
    new TimeAxisRenderObject(timeAxisRow.mainArea);

    // Add grid render object to new rows
    context.onRowsChanged((event) => {
        for (const row of event.added) {
            if (row != timeAxisRow) {
                new GridRenderObject(row.mainArea);
            }
        }
    });
}
