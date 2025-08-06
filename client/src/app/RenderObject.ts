import type { WaveformState } from './WaveformState';
import type { SignalParams } from './SignalParams';
import type { Row } from './Plugin';
import { WebGLUtils } from './WebGLUtils';

export interface RenderContext {
    canvas: HTMLCanvasElement;
    render: WebGlContext;
    state: WaveformState;
    signal: SignalParams;
    row?: Row;
    dpr: number;
}

export interface WebGlContext {
    gl: WebGLRenderingContext;
    utils: WebGLUtils;
}

export interface RenderBounds {
    x: number;
    y: number;
    width: number;
    height: number;
}

export abstract class RenderObject {
    protected zIndex: number = 0;
    
    constructor(zIndex: number = 0) {
        this.zIndex = zIndex;
    }
    
    /**
     * Main render method that must be implemented by subclasses
     */
    abstract render(context: RenderContext, bounds: RenderBounds): boolean;
    
    /**
     * Get the z-index for rendering order (higher values render on top)
     */
    getZIndex(): number {
        return this.zIndex;
    }

    dispose(): void {
    }
}
