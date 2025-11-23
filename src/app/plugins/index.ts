import type { PluginModule } from '@voltex-viewer/plugin-api';
import FpsPluginFunction from './fps/FpsPlugin';
import FpsPluginMetadata from './fps/plugin.json';
import HorizontalGridFunction from './horizontal-grid/HorizontalGridPlugin';
import HorizontalGridMetadata from './horizontal-grid/plugin.json';
import SignalManagerFunction from './signal-manager/SignalManagerPlugin';
import SignalManagerMetadata from './signal-manager/plugin.json';
import WaveformRendererFunction from './waveform/WaveformRendererPlugin';
import WaveformRendererMetadata from './waveform/plugin.json';
import DemoSignalsFunction from './demo-signals/DemoSignalsPlugin';
import DemoSignalsMetadata from './demo-signals/plugin.json';
import TimeAxisFunction from './time-axis/TimeAxisPlugin';
import TimeAxisMetadata from './time-axis/plugin.json';
import WaveformLabelsFunction from './waveform-labels/WaveformLabelsPlugin';
import WaveformLabelsMetadata from './waveform-labels/plugin.json';
import ProfilerFunction from './profiler/ProfilerPlugin';
import ProfilerMetadata from './profiler/plugin.json';
import mdfLoaderFunction from './mdfLoader/mdfLoaderPlugin';
import mdfLoaderMetadata from './mdfLoader/plugin.json';
import csvLoaderFunction from './csvLoader/csvLoaderPlugin';
import csvLoaderMetadata from './csvLoader/plugin.json';
import voltexFunction from './voltex/voltexPlugin';
import voltexMetadata from './voltex/plugin.json';
import CursorFunction from './cursor/CursorPlugin';
import CursorMetadata from './cursor/plugin.json';
import SignalPropertiesFunction from './signal-properties/SignalPropertiesPlugin';
import SignalPropertiesMetadata from './signal-properties/plugin.json';

const FpsPlugin: PluginModule = {
    plugin: FpsPluginFunction,
    metadata: FpsPluginMetadata
};

const HorizontalGridPlugin: PluginModule = {
    plugin: HorizontalGridFunction,
    metadata: HorizontalGridMetadata
};

const SignalManagerPlugin: PluginModule = {
    plugin: SignalManagerFunction,
    metadata: SignalManagerMetadata
};

const WaveformRendererPlugin: PluginModule = {
    plugin: WaveformRendererFunction,
    metadata: WaveformRendererMetadata
};

const DemoSignalsPlugin: PluginModule = {
    plugin: DemoSignalsFunction,
    metadata: DemoSignalsMetadata
};

const TimeAxisPlugin: PluginModule = {
    plugin: TimeAxisFunction,
    metadata: TimeAxisMetadata
};

const WaveformLabelsPlugin: PluginModule = {
    plugin: WaveformLabelsFunction,
    metadata: WaveformLabelsMetadata
};

const ProfilerPlugin: PluginModule = {
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

const CursorPlugin: PluginModule = {
    plugin: CursorFunction,
    metadata: CursorMetadata,
}

const SignalPropertiesPlugin: PluginModule = {
    plugin: SignalPropertiesFunction,
    metadata: SignalPropertiesMetadata,
}

export function getAvailablePlugins(): PluginModule[] {
    return [
        FpsPlugin,
        HorizontalGridPlugin,
        TimeAxisPlugin,
        SignalManagerPlugin,
        WaveformRendererPlugin,
        WaveformLabelsPlugin,
        DemoSignalsPlugin,
        ProfilerPlugin,
        mdfLoaderPlugin,
        csvLoaderPlugin,
        voltexPlugin,
        CursorPlugin,
        SignalPropertiesPlugin,
    ];
}
