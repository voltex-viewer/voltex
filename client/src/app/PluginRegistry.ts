import type { PluginModule } from './Plugin';
import { FpsPlugin, PluginManagerPlugin, SignalManagerPlugin, WaveformRendererPlugin, DemoSignalsPlugin, TimeAxisPlugin, WaveformLabelsPlugin, FileLoaderPlugin, HorizontalGridPlugin } from './plugins/index';

export function getDefaultPlugins(): PluginModule[] {
    return [
        FpsPlugin,
        HorizontalGridPlugin,
        TimeAxisPlugin,
        PluginManagerPlugin,
        SignalManagerPlugin,
        WaveformRendererPlugin,
        WaveformLabelsPlugin,
        DemoSignalsPlugin,
        FileLoaderPlugin,
    ];
}
