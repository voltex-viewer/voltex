import type { WaveformState } from './WaveformState';
import type { SignalParams } from './SignalParams';

export class ZoomHandler {
    state: WaveformState;
    signal: SignalParams;
    drawAllWaves: () => void;
    constructor(state: WaveformState, signal: SignalParams, drawAllWaves: () => void) {
        this.state = state;
        this.signal = signal;
        this.drawAllWaves = drawAllWaves;
    }
    handleZoom(e: WheelEvent) {
        const target = e.target as HTMLElement;
        if (
            target.classList.contains('waveform-main-canvas')
        ) {
            e.preventDefault();
            const zoomFactor = 1.25;
            let oldPxPerSecond = this.signal.pxPerSecond;
            if (e.deltaY < 0) {
                this.signal.pxPerSecond = Math.min(this.signal.maxPxPerSecond, this.signal.pxPerSecond * zoomFactor);
            } else {
                this.signal.pxPerSecond = Math.max(this.signal.minPxPerSecond, this.signal.pxPerSecond / zoomFactor);
            }
            const rect = target.getBoundingClientRect();
            const mouseX = e.clientX - rect.left - this.state.labelWidth;
            const mouseTime = (this.state.offset + mouseX) / oldPxPerSecond;
            this.state.offset = mouseTime * this.signal.pxPerSecond - mouseX;
            this.drawAllWaves();
        }
    }
}
