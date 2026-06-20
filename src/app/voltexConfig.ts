import * as t from 'io-ts';
import { Keybinding } from '@voltex-viewer/plugin-api';

export const voltexPluginName = '@voltex-viewer/voltex';

export const voltexConfigSchema = t.type({
    labelAreaWidth: t.number,
    sidebarWidth: t.number,
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
        'enable-auto-fit': Keybinding,
    }),
});

export type VoltexConfig = t.TypeOf<typeof voltexConfigSchema>;
