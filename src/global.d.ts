declare global {
  interface Window {
    // The Launch Handler API is not in TypeScript's DOM lib yet.
    launchQueue?: {
        setConsumer(consumer: (params: { readonly files: readonly FileSystemFileHandle[] }) => void): void;
    };
  }

  // eslint-disable-next-line @typescript-eslint/naming-convention
  const __GIT_COMMIT_HASH__: string;
}

export {};
