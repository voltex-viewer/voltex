import type { PluginModule } from './Plugin';
import { FpsPlugin, SignalManagerPlugin, WaveformRendererPlugin, DemoSignalsPlugin, TimeAxisPlugin, WaveformLabelsPlugin, FileLoaderPlugin, HorizontalGridPlugin } from './plugins/index';

export function getAvailablePlugins(): PluginModule[] {
    return [
        FpsPlugin,
        HorizontalGridPlugin,
        TimeAxisPlugin,
        SignalManagerPlugin,
        WaveformRendererPlugin,
        WaveformLabelsPlugin,
        DemoSignalsPlugin,
        FileLoaderPlugin,
    ];
}
