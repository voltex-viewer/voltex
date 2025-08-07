import { InMemorySignal } from './Signal';
import type { SignalSource, PluginContext } from './Plugin';

export class RenderProfiler {
    private frameData: Array<{ timestamp: number; frameTime: number }> = [];
    private maxFrames = 1000;
    private lastFrameStart = 0;
    private firstFrameTimestamp = 0;
    private signalSource: SignalSource | null = null;
    private context: PluginContext | null = null;

    setContext(context: PluginContext): void {
        this.context = context;
        this.createSignalSource();
    }

    startFrame(): void {
        this.lastFrameStart = performance.now();
    }

    endFrame(): void {
        if (this.lastFrameStart === 0) return;
        
        const now = performance.now();
        const frameTime = now - this.lastFrameStart;
        
        // Initialize first frame timestamp
        if (this.frameData.length === 0) {
            this.firstFrameTimestamp = now;
        }
        
        // Calculate relative timestamp from first frame
        const relativeTimestamp = (now - this.firstFrameTimestamp) / 1000; // Convert to seconds
        
        this.frameData.push({ timestamp: relativeTimestamp, frameTime });
        
        if (this.frameData.length > this.maxFrames) {
            this.frameData.shift();
            // Update first frame timestamp when we remove the oldest frame
            if (this.frameData.length > 0) {
                this.firstFrameTimestamp = performance.now() - (this.frameData[this.frameData.length - 1].timestamp * 1000);
            }
        }
        
        this.lastFrameStart = 0;
    }

    private createSignalSource(): void {
        if (!this.context) return;

        this.signalSource = {
            name: ['Profiler', 'Frame Time (ms)'],
            discrete: false,
            signal: () => {
                // Create a dynamic signal that always reflects current frame data
                const self = this;
                return {
                    source: this.signalSource!,
                    data: (index: number) => {
                        if (index < 0 || index >= self.frameData.length) {
                            return [0, 0] as [number, number];
                        }
                        const frameEntry = self.frameData[index];
                        return [frameEntry.timestamp, frameEntry.frameTime] as [number, number];
                    },
                    get length() {
                        return self.frameData.length;
                    },
                    get minTime() {
                        return self.frameData.length > 0 ? self.frameData[0].timestamp : 0;
                    },
                    get maxTime() {
                        return self.frameData.length > 0 ? self.frameData[self.frameData.length - 1].timestamp : 0;
                    },
                    get minValue() {
                        if (self.frameData.length === 0) return 0;
                        return Math.min(...self.frameData.map((d: { timestamp: number; frameTime: number }) => d.frameTime));
                    },
                    get maxValue() {
                        if (self.frameData.length === 0) return 0;
                        return Math.max(...self.frameData.map((d: { timestamp: number; frameTime: number }) => d.frameTime));
                    }
                };
            }
        };

        this.context.signalSources.add(this.signalSource);
    }

    getFrameTimes(): readonly number[] {
        return this.frameData.map(({ frameTime }) => frameTime);
    }

    getAverageFrameTime(): number {
        if (this.frameData.length === 0) return 0;
        const frameTimes = this.frameData.map(({ frameTime }) => frameTime);
        return frameTimes.reduce((sum, time) => sum + time, 0) / frameTimes.length;
    }

    getCurrentFPS(): number {
        const avgFrameTime = this.getAverageFrameTime();
        return avgFrameTime > 0 ? 1000 / avgFrameTime : 0;
    }

    getFrameData(): ReadonlyArray<{ timestamp: number; frameTime: number }> {
        return this.frameData;
    }
}
