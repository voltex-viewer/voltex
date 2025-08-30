
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('waveformApi', {
  onOpenWaveformFile: (callback: (filePath: string) => void) => {
    ipcRenderer.on('open-waveform-file', (_event, filePath) => {
      callback(filePath);
    });
  },
  getHighResTime: () => process.hrtime.bigint(),
  openFileDialog: () => ipcRenderer.invoke('open-file-dialog'),
  quitApp: () => ipcRenderer.invoke('quit-app'),
});
