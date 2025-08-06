import { type PluginContext } from '../../Plugin';
import { TimeAxisRenderObject } from './TimeAxisRenderObject';
import { GridRenderObject } from './GridRenderObject';

export default (context: PluginContext): void => {
    const timeAxisRow = context.spliceRows([], [{ index: 0, row: { height: TimeAxisRenderObject.getAxisHeight() } }])[0];
    timeAxisRow.addRenderObject(new TimeAxisRenderObject());

    // Add grid render object to new rows
    context.onRowsChanged((event) => {
        for (const row of event.added) {
            if (row != timeAxisRow) {
                row.addRenderObject(new GridRenderObject());
            }
        }
    });
}
