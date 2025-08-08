import type { FrameInfo, ReadOnlyRenderProfiler, MeasureInfo } from './Plugin';

export class RenderProfiler implements ReadOnlyRenderProfiler {
    private filteredFrameRenderTime = 0; // Exponential moving average
    private _lastFrame: FrameInfo | null = null;
    private measureStack: MeasureInfo[][] = [];
    private currentDepth = 0;
    private now: () => number;

    constructor() {
        if ((window as any).waveformApi?.getHighResTime) {
            this.now = () => {
                const now = (window as any).waveformApi.getHighResTime() as bigint;
                return Number(now) / 1000000;
            };
        } else {
            this.now = performance.now.bind(performance);
        }
    }

    get lastFrame(): FrameInfo | null {
        return this._lastFrame;
    }

    startFrame(): void {
        this.measureStack = [];
        this.currentDepth = 0;
        this.startMeasure('render');
    }

    startMeasure(name: string): void {
        // Ensure we have an array for this depth level
        if (!this.measureStack[this.currentDepth]) {
            this.measureStack[this.currentDepth] = [];
        } else {
            // Check if the previous measure at this depth was properly closed
            const lastMeasure = this.measureStack[this.currentDepth][this.measureStack[this.currentDepth].length - 1];
            if (lastMeasure.endTime === undefined) {
                throw new Error(`Previous measure "${lastMeasure.name}" at depth ${this.currentDepth} was not closed`);
            }
        }

        this.measureStack[this.currentDepth].push({
            name,
            startTime: this.now(),
            endTime: undefined,
        });
        this.currentDepth++;
    }

    endMeasure(): void {
        this.currentDepth--;
        const depthArray = this.measureStack[this.currentDepth];
        if (!depthArray || depthArray.length === 0) {
            throw new Error('No measures to end at current depth');
        }
        
        const measure = depthArray[depthArray.length - 1];
        if (measure.endTime !== undefined) {
            throw new Error('Measure already ended - profiling logic error');
        }
        
        measure.endTime = this.now();
    }

    endFrame(): void {
        this.endMeasure();

        // Validate that we're back at depth 0
        if (this.currentDepth !== 0) {
            throw new Error(`endFrame called with depth ${this.currentDepth}, expected 0 - missing endMeasure calls`);
        }

        // Validate that there's exactly one measure at depth 0 (the 'render' measure)
        if (!this.measureStack[0] || this.measureStack[0].length !== 1) {
            throw new Error(`Expected exactly one measure at depth 0, found ${this.measureStack[0]?.length || 0}`);
        }

        const renderMeasure = this.measureStack[0][0];
        if (!renderMeasure.endTime) {
            throw new Error('Render measure was not properly ended');
        }

        const frameTime = renderMeasure.endTime - renderMeasure.startTime;

        // Update last frame info
        this._lastFrame = {
            startTime: renderMeasure.startTime,
            endTime: renderMeasure.endTime,
            frameTime,
            measures: this.measureStack,
        };
        
        // Update filtered frame render time with exponential moving average
        this.filteredFrameRenderTime = this.filteredFrameRenderTime * 0.9 + frameTime * 0.1;
    }

    getFilteredFrameRenderTime(): number {
        return this.filteredFrameRenderTime;
    }
}
