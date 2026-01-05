interface FileOpenOptions {
    multiple?: boolean;
    types?: FilePickerAcceptType[];
}

interface FileSaveOptions {
    suggestedName?: string;
    types?: FilePickerAcceptType[];
}

interface WritableFile {
    write(data: BufferSource | Blob | string): Promise<void>;
    close(): Promise<void>;
}

interface FileSystemProvider {
    openFiles(options: FileOpenOptions): Promise<File[]>;
    saveFile(options: FileSaveOptions): Promise<{ name: string; writable: WritableFile }>;
}

class NativeFileSystemProvider implements FileSystemProvider {
    async openFiles(options: FileOpenOptions): Promise<File[]> {
        const fileHandles = await window.showOpenFilePicker({
            multiple: options.multiple ?? false,
            types: options.types,
        });
        return Promise.all(fileHandles.map(fh => fh.getFile()));
    }

    async saveFile(options: FileSaveOptions): Promise<{ name: string; writable: WritableFile }> {
        const fileHandle = await window.showSaveFilePicker({
            suggestedName: options.suggestedName,
            types: options.types,
        });
        const writable = await fileHandle.createWritable({ keepExistingData: false });
        return { name: fileHandle.name, writable };
    }
}

class FallbackFileSystemProvider implements FileSystemProvider {
    async openFiles(options: FileOpenOptions): Promise<File[]> {
        const accept = (options.types ?? [])
            .flatMap(t => Object.values(t.accept ?? {}).flat())
            .join(',');
        return new Promise((resolve, reject) => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = accept;
            input.multiple = options.multiple ?? false;
            input.onchange = () => {
                if (input.files && input.files.length > 0) {
                    resolve(Array.from(input.files));
                } else {
                    reject(new DOMException('No file selected', 'AbortError'));
                }
            };
            input.oncancel = () => reject(new DOMException('User cancelled', 'AbortError'));
            input.click();
        });
    }

    async saveFile(options: FileSaveOptions): Promise<{ name: string; writable: WritableFile }> {
        const defaultExt = Object.values(options.types?.[0]?.accept ?? {})[0]?.[0] ?? '';
        const suggestedName = options.suggestedName ?? `file${defaultExt}`;
        const name = prompt('Enter file name:', suggestedName);
        if (!name) {
            throw new DOMException('User cancelled', 'AbortError');
        }
        const chunks: BlobPart[] = [];
        const writable: WritableFile = {
            async write(data: BufferSource | Blob | string) {
                if (ArrayBuffer.isView(data)) {
                    chunks.push(new Uint8Array(data.buffer, data.byteOffset, data.byteLength).slice());
                } else if (data instanceof ArrayBuffer) {
                    chunks.push(new Uint8Array(data).slice());
                } else {
                    chunks.push(data);
                }
            },
            async close() {
                const blob = new Blob(chunks);
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = name;
                a.click();
                URL.revokeObjectURL(url);
            }
        };
        return { name, writable };
    }
}

export const fileSystemProvider: FileSystemProvider = 
    'showOpenFilePicker' in window 
        ? new NativeFileSystemProvider() 
        : new FallbackFileSystemProvider();
