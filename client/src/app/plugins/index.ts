import type { PluginModule } from '../Plugin';
import FpsPluginFunction from './fps/FpsPlugin';
import FpsPluginMetadata from './fps/plugin.json';
import HorizontalGridFunction from './horizontal-grid/HorizontalGridPlugin';
import HorizontalGridMetadata from './horizontal-grid/plugin.json';
import PluginManagerFunction from './manager/PluginManagerPlugin';
import PluginManagerMetadata from './manager/plugin.json';
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
import FileLoaderFunction from './file-loader/FileLoaderPlugin';
import FileLoaderMetadata from './file-loader/plugin.json';

const FpsPlugin: PluginModule = {
    plugin: FpsPluginFunction,
    metadata: FpsPluginMetadata
};

const HorizontalGridPlugin: PluginModule = {
    plugin: HorizontalGridFunction,
    metadata: HorizontalGridMetadata
};

const PluginManagerPlugin: PluginModule = {
    plugin: PluginManagerFunction,
    metadata: PluginManagerMetadata
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

const FileLoaderPlugin: PluginModule = {
    plugin: FileLoaderFunction,
    metadata: FileLoaderMetadata
};

export { FpsPlugin, HorizontalGridPlugin, PluginManagerPlugin, SignalManagerPlugin, WaveformRendererPlugin, DemoSignalsPlugin, TimeAxisPlugin, WaveformLabelsPlugin, FileLoaderPlugin };
