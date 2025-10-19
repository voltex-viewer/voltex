
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('waveformApi', {
  getHighResTime: () => process.hrtime.bigint(),
  openFileDialog: () => ipcRenderer.invoke('open-file-dialog'),
  openExternalUrl: (url: string) => ipcRenderer.invoke('open-external-url', url),
  quitApp: () => ipcRenderer.invoke('quit-app'),
});
