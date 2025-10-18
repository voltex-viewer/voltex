import { PluginContext, Keybinding } from '@voltex-viewer/plugin-api';
import * as t from 'io-ts';

export default (context: PluginContext): void => {
    context.loadConfig(
        t.type({
            keybindings: t.type({
                'voltex.select-all-rows': Keybinding,
                'voltex.clear-selection': Keybinding,
                'voltex.group-selected-rows': Keybinding,
                'voltex.ungroup-selected-rows': Keybinding,
                'voltex.delete-selected-rows': Keybinding,
                'voltex.zoom-in': Keybinding,
                'voltex.zoom-out': Keybinding,
                'voltex.pan-left': Keybinding,
                'voltex.pan-right': Keybinding,
                'voltex.fit-to-signal': Keybinding,
            })
        }), {
        keybindings: {
            'voltex.select-all-rows': 'ctrl+a',
            'voltex.clear-selection': 'escape',
            'voltex.group-selected-rows': 'ctrl+g',
            'voltex.ungroup-selected-rows': 'ctrl+shift+g',
            'voltex.delete-selected-rows': 'delete',
            'voltex.zoom-in': 'w',
            'voltex.zoom-out': 's',
            'voltex.pan-left': 'a',
            'voltex.pan-right': 'd',
            'voltex.fit-to-signal': 'f',
        }
    });
};
