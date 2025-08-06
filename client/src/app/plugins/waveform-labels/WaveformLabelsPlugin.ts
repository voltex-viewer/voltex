import type { PluginContext } from '../../Plugin';
import { HorizontalSeparatorRenderObject } from './HorizontalSeparatorRenderObject';
import { WaveformLabelHandler } from './WaveformLabelHandler';

export default (context: PluginContext): void => {
    // Get the main canvas element
    const canvas = document.querySelector('.waveform-main-canvas') as HTMLCanvasElement;
    
    if (!canvas) {
        console.error('WaveformLabelsPlugin: Main canvas not found');
        return;
    }

    // Initialize the label handler
    new WaveformLabelHandler(
        context.state,
        canvas,
        context.signalMetadata,
        context
    );
    context.onRowsChanged(event => {
        for (const row of event.added) {
            row.addRenderObject(new HorizontalSeparatorRenderObject());
        }
    });
};
