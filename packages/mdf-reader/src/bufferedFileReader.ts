interface CacheEntry {
    buffer: ArrayBuffer;
    offset: number;
    lastUsed: number;
}

export class BufferedFileReader {
    private _file: File;
    private bufferSize: number;
    private maxBuffers: number;
    private cache: Map<number, CacheEntry> = new Map();
    public version: number = 0;
    public littleEndian: boolean;

    constructor(file: File, bufferSize: number = 1024 * 1024, maxBuffers: number = 4) {
        this._file = file;
        this.bufferSize = bufferSize;
        this.maxBuffers = maxBuffers;
        this.littleEndian = true;
    }

    get file(): File {
        return this._file;
    }

    async readBytes(offset: number, length: number): Promise<ArrayBuffer> {
        // For very large requests (more than 2 buffer sizes), read directly from file
        if (length > this.bufferSize * 2) {
            return await this._file.slice(offset, offset + length).arrayBuffer();
        }

        // Fast path: Check if request fits within a single buffer
        const startAlignedOffset = Math.floor(offset / this.bufferSize) * this.bufferSize;
        const endOffset = offset + length;
        
        // If the request fits within a single buffer boundary
        if (endOffset <= startAlignedOffset + this.bufferSize) {
            let cacheEntry = this.cache.get(startAlignedOffset);
            
            if (cacheEntry) {
                // Update last used counter and return slice
                cacheEntry.lastUsed = Date.now();
                const bufferOffset = offset - startAlignedOffset;
                return cacheEntry.buffer.slice(bufferOffset, bufferOffset + length);
            } else {
                // Cache miss: Load the buffer from file
                const bufferEnd = Math.min(this._file.size, startAlignedOffset + this.bufferSize);
                const buffer = await this._file.slice(startAlignedOffset, bufferEnd).arrayBuffer();
                
                cacheEntry = {
                    buffer: buffer,
                    offset: startAlignedOffset,
                    lastUsed: Date.now()
                };
                
                if (this.cache.size >= this.maxBuffers) {
                    this.evictLeastRecentlyUsed();
                }
                
                this.cache.set(startAlignedOffset, cacheEntry);
                
                const bufferOffset = offset - startAlignedOffset;
                return buffer.slice(bufferOffset, bufferOffset + length);
            }
        }

        // Multi-buffer or cache miss: Calculate the range of aligned buffers we need
        const endAlignedOffset = Math.floor((endOffset - 1) / this.bufferSize) * this.bufferSize;
        
        const neededBuffers: CacheEntry[] = [];
        for (let alignedOffset = startAlignedOffset; alignedOffset <= endAlignedOffset; alignedOffset += this.bufferSize) {
            let cacheEntry = this.cache.get(alignedOffset);
            
            if (!cacheEntry) {
                const bufferEnd = Math.min(this._file.size, alignedOffset + this.bufferSize);
                const buffer = await this._file.slice(alignedOffset, bufferEnd).arrayBuffer();
                
                cacheEntry = {
                    buffer: buffer,
                    offset: alignedOffset,
                    lastUsed: Date.now()
                };
                
                if (this.cache.size >= this.maxBuffers) {
                    this.evictLeastRecentlyUsed();
                }
                
                this.cache.set(alignedOffset, cacheEntry);
            } else {
                cacheEntry.lastUsed = Date.now();
            }
            
            neededBuffers.push(cacheEntry);
        }
        
        if (neededBuffers.length === 1) {
            const bufferOffset = offset - neededBuffers[0].offset;
            return neededBuffers[0].buffer.slice(bufferOffset, bufferOffset + length);
        }
        
        const result = new Uint8Array(length);
        let resultOffset = 0;
        let remainingLength = length;
        let currentOffset = offset;
        
        for (const entry of neededBuffers) {
            const bufferStart = Math.max(currentOffset, entry.offset);
            const bufferEnd = Math.min(currentOffset + remainingLength, entry.offset + entry.buffer.byteLength);
            const copyLength = bufferEnd - bufferStart;
            
            if (copyLength > 0) {
                const sourceOffset = bufferStart - entry.offset;
                const sourceData = new Uint8Array(entry.buffer, sourceOffset, copyLength);
                result.set(sourceData, resultOffset);
                resultOffset += copyLength;
                remainingLength -= copyLength;
                currentOffset += copyLength;
            }
        }
        
        return result.buffer;
    }
    
    private evictLeastRecentlyUsed(): void {
        let oldestOffset = -1;
        let oldestAccess = Infinity;
        
        for (const [offset, entry] of this.cache) {
            if (entry.lastUsed < oldestAccess) {
                oldestAccess = entry.lastUsed;
                oldestOffset = offset;
            }
        }
        
        if (oldestOffset !== -1) {
            this.cache.delete(oldestOffset);
        }
    }

    get size(): number {
        return this._file.size;
    }

    clearBuffer(): void {
        this.cache.clear();
    }
    
    getCacheStats(): { entries: number, totalMemory: number } {
        let totalMemory = 0;
        for (const entry of this.cache.values()) {
            totalMemory += entry.buffer.byteLength;
        }
        
        return {
            entries: this.cache.size,
            totalMemory: totalMemory
        };
    }
}
