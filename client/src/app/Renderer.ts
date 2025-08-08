import type { WaveformState } from './WaveformState';
import type { SignalParams } from './SignalParams';
import { SignalMetadataManager } from './SignalMetadataManager';
import { SignalSourceManagerImpl } from './SignalSourceManagerImpl';
import { WebGLUtils } from './WebGLUtils';
import { PluginManager } from './PluginManager';
import { setPluginManager } from './plugins/manager/PluginManagerPlugin';
import { RowManager } from './RowManager';
import { RenderProfiler } from './RenderProfiler';


import PluginManagerFunction from './plugins/manager/PluginManagerPlugin';
import PluginManagerMetadata from './plugins/manager/plugin.json';
import { PluginModule } from './Plugin';
import { RowImpl } from './RowImpl';

const PluginManagerPlugin: PluginModule = {
    plugin: PluginManagerFunction,
    metadata: PluginManagerMetadata
};

export class Renderer {
    private canvas: HTMLCanvasElement;
    private webglUtils: WebGLUtils;
    private pluginManager: PluginManager;
    private signalMetadata: SignalMetadataManager;
    private signalSources: SignalSourceManagerImpl;
    private rowManager: RowManager;
    private renderProfiler: RenderProfiler;
    
    constructor(
        private state: WaveformState,
        private signal: SignalParams, 
        private root: HTMLElement,
        canvas: HTMLCanvasElement,
        private verticalSidebar?: import('./VerticalSidebar').VerticalSidebar,
        private requestRender?: () => void
    ) {
        this.canvas = canvas;
        
        // Initialize WebGL context
        const gl = this.canvas.getContext('webgl');
        if (!gl) {
            throw new Error('WebGL not supported');
        }

        // Create shared WebGLUtils instance
        const webglUtils = new WebGLUtils(gl);
        this.webglUtils = webglUtils;
        
        this.signalMetadata = new SignalMetadataManager();
        this.signalSources = new SignalSourceManagerImpl();

        this.rowManager = new RowManager();
        
        this.renderProfiler = new RenderProfiler();
        
        this.pluginManager = new PluginManager(
            this.state, 
            this.signal,
            { gl, utils: webglUtils }, // WebGL context with shared utils
            this.signalMetadata,
            this.signalSources,
            this.rowManager,
            (entry) => this.verticalSidebar.addDynamicEntry(entry),
            (entry) => this.verticalSidebar.removeDynamicEntry(entry),
            this.requestRender,
            this.renderProfiler
        );
        
        // Register and enable default plugins (only Plugin Manager)
        this.pluginManager.registerPluginType(PluginManagerPlugin);
        this.pluginManager.enablePlugin(PluginManagerPlugin);
        setPluginManager(this.pluginManager);
    }

    resizeCanvases(): void {
        if (!this.root || !this.state || !this.canvas) return;

        // Get size from the canvas parent container instead of the canvas itself
        const container = this.canvas.parentElement;
        if (!container) return;

        const containerWidth = container.clientWidth;
        const containerHeight = container.clientHeight;
        const dpr = window.devicePixelRatio || 1;

        this.canvas.width = containerWidth * dpr;
        this.canvas.height = containerHeight * dpr;
        this.canvas.style.width = `${containerWidth}px`;
        this.canvas.style.height = `${containerHeight}px`;

        this.state.canvasWidth = containerWidth - this.state.labelWidth;
        this.requestRender();
    }
    
    render(): boolean {
        this.renderProfiler.startFrame();
        
        // Call beforeRender callbacks
        const beforeRenderRequested = this.pluginManager.onBeforeRender(this.renderProfiler);
        
        let renderRequested = false;
        const gl = this.canvas.getContext('webgl');
        if (!gl) {
            throw new Error('WebGL context not available');
        }
        
        const dpr = window.devicePixelRatio || 1;
        
        // Clear the entire canvas first
        gl.viewport(0, 0, this.canvas.width, this.canvas.height);
        gl.clearColor(0, 0, 0, 1.0); // Black background 
        gl.clear(gl.COLOR_BUFFER_BIT);
        
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

        let currentY = 0;
        const renderProfiler = this.renderProfiler;
        const baseContext = {
            canvas: this.canvas,
            render: {
                gl,
                utils: this.webglUtils
            },
            state: this.state,
            signal: this.signal,
            dpr
        };
        for (const row of this.rowManager.getAllRows()) {
            const rowHeight = row.height;
            this.renderProfiler.startMeasure(`row-${row.signals[0]?.source.name.join('.') || 'unknown'}`);
            renderRow.call(this, row, rowHeight);
            this.renderProfiler.endMeasure();
            currentY += row.height;
        }
        
        const afterRenderRequested = this.pluginManager.onAfterRender(this.renderProfiler);

        this.renderProfiler.endFrame();
        
        return renderRequested || beforeRenderRequested || afterRenderRequested;

        function renderRow(row: RowImpl, rowHeight: number) {
            // Set viewport for the label area
            const viewportY = currentY * dpr;
            const labelWidth = this.state.labelWidth * dpr;
            const viewportHeight = rowHeight * dpr;

            if (viewportY <= this.canvas.height) {
                const context = { ...baseContext, row };
                // Render labels
                gl.viewport(0, this.canvas.height - viewportY - viewportHeight, labelWidth, viewportHeight);
                const labelBounds = { x: 0, y: 0, width: this.state.labelWidth, height: rowHeight };

                for (const renderObject of [...row.labelRenderObjects].sort((a, b) => a.getZIndex() - b.getZIndex())) {
                    renderProfiler.startMeasure(`label-${renderObject.constructor.name}`);
                    const rerequest = renderObject.render(context, labelBounds);
                    renderProfiler.endMeasure();
                    renderRequested ||= rerequest;
                }

                // Render the main row content
                gl.viewport(labelWidth, this.canvas.height - viewportY - viewportHeight, this.canvas.width - labelWidth, viewportHeight);
                const bounds = { x: 0, y: 0, width: this.state.canvasWidth, height: row.height };

                for (const renderObject of [...row.renderObjects].sort((a, b) => a.getZIndex() - b.getZIndex())) {
                    renderProfiler.startMeasure(`main-${renderObject.constructor.name}`);
                    const rerequest = renderObject.render(context, bounds);
                    renderProfiler.endMeasure();
                    renderRequested ||= rerequest;
                }
            }
        }
    }
}
