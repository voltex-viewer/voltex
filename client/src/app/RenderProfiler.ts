import type { FrameInfo, ReadOnlyRenderProfiler } from './Plugin';

export class RenderProfiler implements ReadOnlyRenderProfiler {
    private lastFrameStart = 0;
    private filteredFrameRenderTime = 0; // Exponential moving average
    private _lastFrame: FrameInfo | null = null;

    get lastFrame(): FrameInfo | null {
        return this._lastFrame;
    }

    startFrame(): void {
        this.lastFrameStart = performance.now();
    }

    endFrame(): void {
        if (this.lastFrameStart === 0) return;
        
        const endTime = performance.now();
        const frameTime = endTime - this.lastFrameStart;
        
        // Update last frame info
        this._lastFrame = {
            startTime: this.lastFrameStart,
            endTime,
            frameTime
        };
        
        // Update filtered frame render time with exponential moving average
        this.filteredFrameRenderTime = this.filteredFrameRenderTime * 0.9 + frameTime * 0.1;
        
        this.lastFrameStart = 0;
    }

    getFilteredFrameRenderTime(): number {
        return this.filteredFrameRenderTime;
    }
}
