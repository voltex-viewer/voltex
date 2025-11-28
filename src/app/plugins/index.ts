import type { PluginModule } from '@voltex-viewer/plugin-api';
import FpsPluginFunction from './fps/fpsPlugin';
import FpsPluginMetadata from './fps/plugin.json';
import HorizontalGridFunction from './horizontalGrid/horizontalGridPlugin';
import HorizontalGridMetadata from './horizontalGrid/plugin.json';
import SignalManagerFunction from './signalManager/signalManagerPlugin';
import SignalManagerMetadata from './signalManager/plugin.json';
import WaveformRendererFunction from './waveform/waveformRendererPlugin';
import WaveformRendererMetadata from './waveform/plugin.json';
import DemoSignalsFunction from './demoSignals/demoSignalsPlugin';
import DemoSignalsMetadata from './demoSignals/plugin.json';
import TimeAxisFunction from './timeAxis/timeAxisPlugin';
import TimeAxisMetadata from './timeAxis/plugin.json';
import WaveformLabelsFunction from './waveformLabels/waveformLabelsPlugin';
import WaveformLabelsMetadata from './waveformLabels/plugin.json';
import ProfilerFunction from './profiler/profilerPlugin';
import ProfilerMetadata from './profiler/plugin.json';
import mdfLoaderFunction from './mdfLoader/mdfLoaderPlugin';
import mdfLoaderMetadata from './mdfLoader/plugin.json';
import csvLoaderFunction from './csvLoader/csvLoaderPlugin';
import csvLoaderMetadata from './csvLoader/plugin.json';
import voltexFunction from './voltex/voltexPlugin';
import voltexMetadata from './voltex/plugin.json';
import CursorFunction from './cursor/cursorPlugin';
import CursorMetadata from './cursor/plugin.json';
import SignalPropertiesFunction from './signalProperties/signalPropertiesPlugin';
import SignalPropertiesMetadata from './signalProperties/plugin.json';

const fpsPlugin: PluginModule = {
    plugin: FpsPluginFunction,
    metadata: FpsPluginMetadata
};

const horizontalGridPlugin: PluginModule = {
    plugin: HorizontalGridFunction,
    metadata: HorizontalGridMetadata
};

const signalManagerPlugin: PluginModule = {
    plugin: SignalManagerFunction,
    metadata: SignalManagerMetadata
};

const waveformRendererPlugin: PluginModule = {
    plugin: WaveformRendererFunction,
    metadata: WaveformRendererMetadata
};

const demoSignalsPlugin: PluginModule = {
    plugin: DemoSignalsFunction,
    metadata: DemoSignalsMetadata
};

const timeAxisPlugin: PluginModule = {
    plugin: TimeAxisFunction,
    metadata: TimeAxisMetadata
};

const waveformLabelsPlugin: PluginModule = {
    plugin: WaveformLabelsFunction,
    metadata: WaveformLabelsMetadata
};

const profilerPlugin: PluginModule = {
    plugin: ProfilerFunction,
    metadata: ProfilerMetadata
};

const mdfLoaderPlugin: PluginModule = {
    plugin: mdfLoaderFunction,
    metadata: mdfLoaderMetadata
};

const csvLoaderPlugin: PluginModule = {
    plugin: csvLoaderFunction,
    metadata: csvLoaderMetadata
};

const voltexPlugin: PluginModule = {    
    plugin: voltexFunction,
    metadata: voltexMetadata,
}

const cursorPlugin: PluginModule = {
    plugin: CursorFunction,
    metadata: CursorMetadata,
}

const signalPropertiesPlugin: PluginModule = {
    plugin: SignalPropertiesFunction,
    metadata: SignalPropertiesMetadata,
}

export function getAvailablePlugins(): PluginModule[] {
    return [
        fpsPlugin,
        horizontalGridPlugin,
        timeAxisPlugin,
        signalManagerPlugin,
        waveformRendererPlugin,
        waveformLabelsPlugin,
        demoSignalsPlugin,
        profilerPlugin,
        mdfLoaderPlugin,
        csvLoaderPlugin,
        voltexPlugin,
        cursorPlugin,
        signalPropertiesPlugin,
    ];
}
