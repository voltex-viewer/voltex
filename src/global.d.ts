declare global {
  interface WaveformAPI {
    onOpenWaveformFile: (callback: (filePath: string) => void) => void;
    getHighResTime: () => bigint;
    openFileDialog: () => Promise<string | null>;
    openExternalUrl: (url: string) => Promise<void>;
    quitApp: () => Promise<void>;
  }

  interface Window {
    waveformApi: WaveformAPI;
  }

  // eslint-disable-next-line @typescript-eslint/naming-convention
  const __GIT_COMMIT_HASH__: string;
}

export {};
