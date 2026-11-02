import { PluginContext } from '@voltex-viewer/plugin-api';
import { voltexConfigSchema } from '../../voltexConfig';

export default (context: PluginContext): void => {
    context.loadConfig(voltexConfigSchema, {
        labelAreaWidth: 100,
        sidebarWidth: 320,
        timeMode: 'relative',
        timeZone: 'local',
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
            'enable-auto-fit': 'f',
        }
    });
};
