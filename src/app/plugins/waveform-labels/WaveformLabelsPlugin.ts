import type { PluginContext, Row } from '@voltex/plugin-api';
import { LabelRenderObject } from './LabelRenderObject';

export default (context: PluginContext): void => {
    const signalMetadata = context.signalMetadata;
    let labelRenderObjects: Map<Row, LabelRenderObject> = new Map();
    
    context.onRowsChanged((event) => {
        // Remove render objects for removed rows
        for (const row of event.removed) {
            labelRenderObjects.delete(row);
        }
        
        // Add render objects for new rows
        for (const row of event.added) {
            const labelRenderObject = new LabelRenderObject(row.labelArea, row.signals, signalMetadata, row);
            labelRenderObjects.set(row, labelRenderObject);
        }
    });
};
