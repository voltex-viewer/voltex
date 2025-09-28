import { PluginContext, KeybindingConfigType } from '@voltex-viewer/plugin-api';
import * as t from 'io-ts';

export default (context: PluginContext): void => {
    context.loadConfig(
        t.type({
            keybindings: KeybindingConfigType
        }), {
        keybindings: {
            'voltex.select-all-rows': 'ctrl+a',
            'voltex.clear-selection': 'escape',
            'voltex.group-selected-rows': 'ctrl+g',
            'voltex.ungroup-selected-rows': 'ctrl+shift+g',
            'voltex.delete-selected-rows': 'delete',
        }
    });
};
