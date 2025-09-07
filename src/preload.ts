
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('waveformApi', {
  getHighResTime: () => process.hrtime.bigint(),
  openFileDialog: () => ipcRenderer.invoke('open-file-dialog'),
  quitApp: () => ipcRenderer.invoke('quit-app'),
});
