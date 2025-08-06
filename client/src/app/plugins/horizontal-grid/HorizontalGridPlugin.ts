import { PluginContext } from '../../Plugin';
import { HorizontalGridRenderObject } from './HorizontalGridRenderObject';

export default (context: PluginContext): void => {
    context.onRowsChanged((event) => {
        for (const row of event.added) {
            if (row.signals.length > 0) {
                row.addRenderObject(new HorizontalGridRenderObject());
            }
        }
    });
}
