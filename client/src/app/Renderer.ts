import type { WaveformState } from './WaveformState';
import type { SignalParams } from './SignalParams';
import { RenderObject } from './RenderObject';
import { SignalMetadataManager } from './SignalMetadataManager';
import { SignalSourceManagerImpl } from './SignalSourceManagerImpl';
import { WebGLUtils } from './WebGLUtils';
import { PluginManager } from './PluginManager';
import { getDefaultPlugins } from './PluginRegistry';
import { setPluginManager } from './plugins/manager/PluginManagerPlugin';
import { RowManager } from './RowManager';

export class Renderer {
    private canvas: HTMLCanvasElement;
    private webglUtils: WebGLUtils;
    private pluginManager: PluginManager;
    private signalMetadata: SignalMetadataManager;
    private signalSources: SignalSourceManagerImpl;
    private rowManager: RowManager;
    
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
        
        this.pluginManager = new PluginManager(
            this.state, 
            this.signal,
            { gl, utils: webglUtils }, // WebGL context with shared utils
            this.signalMetadata,
            this.signalSources,
            this.rowManager,
            (entry) => this.verticalSidebar.addDynamicEntry(entry),
            (entry) => this.verticalSidebar.removeDynamicEntry(entry),
            this.requestRender
        );
        
        // Register and enable all plugin types
        for (const pluginModule of getDefaultPlugins()) {
            this.pluginManager.registerPluginType(pluginModule);
        }
        
        // Enable all plugins now that WebGL is available
        let pluginManagerPlugin: any = null;
        for (const pluginModule of getDefaultPlugins()) {
            const plugin = this.pluginManager.enablePlugin(pluginModule);
            
            // Store reference to the Plugin Manager plugin
            if (plugin.metadata.name === 'Plugin Manager') {
                pluginManagerPlugin = plugin;
            }
        }
        
        // Set plugin manager reference after all plugins are enabled
        if (pluginManagerPlugin) {
            setPluginManager(this.pluginManager);
        }
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
            const context = { ...baseContext, row };

            // Set viewport for the label area
            const viewportY = currentY * dpr;
            const labelWidth = this.state.labelWidth * dpr;
            const viewportHeight = rowHeight * dpr;
            
            if (viewportY <= this.canvas.height) {
                // Render labels
                gl.viewport(0, this.canvas.height - viewportY - viewportHeight, labelWidth, viewportHeight);
                const labelBounds = { x: 0, y: 0, width: this.state.labelWidth, height: rowHeight };
        
                for (const renderObject of [...row.labelRenderObjects].sort((a, b) => a.getZIndex() - b.getZIndex())) {
                    const rerequest = renderObject.render(context, labelBounds);
                    renderRequested ||= rerequest;
                }

                // Render the main row content
                gl.viewport(labelWidth, this.canvas.height - viewportY - viewportHeight, this.canvas.width - labelWidth, viewportHeight);
                const bounds = { x: 0, y: 0, width: this.state.canvasWidth, height: row.height };
                
                for (const renderObject of [...row.renderObjects].sort((a, b) => a.getZIndex() - b.getZIndex())) {
                    const rerequest = renderObject.render(context, bounds);
                    renderRequested ||= rerequest;
                }
            }

            currentY += row.height;
        }
        
        // Call plugin render callbacks
        const pluginRenderRequested = this.pluginManager.onRender();
        renderRequested ||= pluginRenderRequested;
        
        return renderRequested;
    }
}
