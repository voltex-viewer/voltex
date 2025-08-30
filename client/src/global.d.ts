declare global {
  interface WaveformAPI {
    onOpenWaveformFile: (callback: (filePath: string) => void) => void;
    getHighResTime: () => bigint;
    openFileDialog: () => Promise<string | null>;
    quitApp: () => Promise<void>;
  }

  interface Window {
    waveformApi: WaveformAPI;
  }
}

export {};
