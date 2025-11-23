import { PluginContext, Keybinding } from '@voltex-viewer/plugin-api';
import * as t from 'io-ts';

export default (context: PluginContext): void => {
    context.loadConfig(
        t.type({
            keybindings: t.type({
                'select-all-rows': Keybinding,
                'clear-selection': Keybinding,
                'group-selected-rows': Keybinding,
                'ungroup-selected-rows': Keybinding,
                'delete-selected-rows': Keybinding,
                'zoom-in': Keybinding,
                'zoom-out': Keybinding,
                'pan-left': Keybinding,
                'pan-right': Keybinding,
                'fit-to-signal': Keybinding,
            })
        }), {
        keybindings: {
            'select-all-rows': 'ctrl+a',
            'clear-selection': 'escape',
            'group-selected-rows': 'ctrl+g',
            'ungroup-selected-rows': 'ctrl+shift+g',
            'delete-selected-rows': 'delete',
            'zoom-in': 'w',
            'zoom-out': 's',
            'pan-left': 'a',
            'pan-right': 'd',
            'fit-to-signal': 'f',
        }
    });
};
