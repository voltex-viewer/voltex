import type { WaveformState } from './WaveformState';
import { RenderObject, RenderBounds, px, percent, MouseEvent, MouseEventHandlers, RenderContext } from './RenderObject';
import { SignalMetadataManager } from './SignalMetadataManager';
import { SignalSourceManagerImpl } from './SignalSourceManagerImpl';
import { WebGLUtils } from './WebGLUtils';
import { PluginManager } from './PluginManager';
import { setPluginManager } from './plugins/manager/PluginManagerPlugin';
import { RenderProfiler } from './RenderProfiler';
import PluginManagerFunction from './plugins/manager/PluginManagerPlugin';
import PluginManagerMetadata from './plugins/manager/plugin.json';
import { PluginModule } from './Plugin';
import { ContainerRenderObject } from './ContainerRenderObject';
import { RowContainerRenderObject } from './RowContainerRenderObject';
import { Signal } from './Signal';

interface InternalMouseEvent extends MouseEvent {
    readonly stopPropagationCalled: boolean;
}

const PluginManagerPlugin: PluginModule = {
    plugin: PluginManagerFunction,
    metadata: PluginManagerMetadata
};

export class Renderer {
    private canvas: HTMLCanvasElement;
    private webglUtils: WebGLUtils;
    public readonly pluginManager: PluginManager;
    private signalMetadata: SignalMetadataManager;
    private signalSources: SignalSourceManagerImpl;
    private renderProfiler: RenderProfiler;
    private rootRenderObject: ContainerRenderObject;
    private rowContainer: RowContainerRenderObject;
    
    constructor(
        private state: WaveformState,
        canvas: HTMLCanvasElement,
        private verticalSidebar?: import('./VerticalSidebar').VerticalSidebar,
        private requestRender?: () => void
    ) {
        this.canvas = canvas;
        
        this.renderProfiler = new RenderProfiler();
        
        // Create root render object
        this.rootRenderObject = new ContainerRenderObject();
        
        // Initialize WebGL context
        const gl = this.canvas.getContext('webgl');
        if (!gl) {
            throw new Error('WebGL not supported');
        }

        const webglUtils = new WebGLUtils(gl);
        
        // Profile all WebGLUtils function calls
        const proxiedWebglUtils = this.renderProfiler.createProxy(webglUtils, 'webgl');
        
        this.webglUtils = proxiedWebglUtils;
        
        this.signalMetadata = new SignalMetadataManager();
        this.signalSources = new SignalSourceManagerImpl();

        // Create row container and add it to root
        this.rowContainer = new RowContainerRenderObject(this.state, this.requestRender, this.canvas);
        this.rootRenderObject.addChild(this.rowContainer);
        
        this.pluginManager = new PluginManager(
            this.state,
            { gl, utils: proxiedWebglUtils },
            this.signalMetadata,
            this.signalSources,
            this.rowContainer,
            this.rootRenderObject,
            (entry) => this.verticalSidebar.addDynamicEntry(entry),
            (entry) => this.verticalSidebar.removeDynamicEntry(entry),
            this.requestRender,
            this.renderProfiler
        );
        
        this.resizeCanvases(); // Setup the root size

        // Register and enable default plugins (only Plugin Manager)
        this.pluginManager.registerPluginType(PluginManagerPlugin);
        this.pluginManager.enablePlugin(PluginManagerPlugin);
        setPluginManager(this.pluginManager);

        (window as any).saveCsv = this.saveCsv.bind(this);
        
        // Set up mouse event handlers on the canvas
        this.setupMouseEventHandlers();
    }

    private setupMouseEventHandlers(): void {
        this.canvas.addEventListener('mousedown', (e): void => {
            this.dispatchMouseEvent('onMouseDown', this.createMouseEvent(e));
        });
        this.canvas.addEventListener('mousemove', (e): void => {
            const mouseEvent = this.createMouseEvent(e);
            this.dispatchMouseEvent('onMouseMove', mouseEvent);
            this.updateMouseOverStates(mouseEvent);
        });
        this.canvas.addEventListener('mouseup', (e): void => {
            this.dispatchMouseEvent('onMouseUp', this.createMouseEvent(e));
        });
        this.canvas.addEventListener('click', (e): void => {
            this.dispatchMouseEvent('onClick', this.createMouseEvent(e));
        });
        this.canvas.addEventListener('mouseenter', (e): void => {
            this.dispatchMouseEvent('onMouseEnter', this.createMouseEvent(e));
        });
        this.canvas.addEventListener('mouseleave', (e): void => {
            const mouseEvent = this.createMouseEvent(e);
            this.dispatchMouseEvent('onMouseLeave', mouseEvent);
            this.clearAllMouseOverStates(mouseEvent);
        });
        this.canvas.addEventListener('wheel', (e): void => {
            this.dispatchMouseEvent('onWheel', this.createWheelEvent(e));
        }, { passive: false });
    }

    private createMouseEvent(e: globalThis.MouseEvent): InternalMouseEvent {
        let stopPropagationCalled = false;
        
        // Get canvas position to properly offset mouse coordinates
        const canvasRect = this.canvas.getBoundingClientRect();
        
        const mouseEvent: InternalMouseEvent = {
            clientX: e.clientX - canvasRect.left,
            clientY: e.clientY - canvasRect.top,
            offsetX: e.offsetX,
            offsetY: e.offsetY,
            button: e.button,
            ctrlKey: e.ctrlKey,
            metaKey: e.metaKey,
            shiftKey: e.shiftKey,
            altKey: e.altKey,
            get stopPropagationCalled() {
                return stopPropagationCalled;
            },
            preventDefault: () => {
                e.preventDefault();
            },
            stopPropagation: () => {
                stopPropagationCalled = true;
                e.stopPropagation();
            }
        };
        
        return mouseEvent;
    }

    private createWheelEvent(e: globalThis.WheelEvent): InternalMouseEvent & { deltaY: number; deltaX: number; deltaZ: number } {
        return {
            ...this.createMouseEvent(e),
            deltaY: e.deltaY,
            deltaX: e.deltaX,
            deltaZ: e.deltaZ
        };
    }

    private dispatchMouseEvent(eventType: keyof MouseEventHandlers, event: InternalMouseEvent): void {
        const dispatchMouseEventRecursive = (
            renderObject: RenderObject, 
            bounds: RenderBounds
        ): void => {
            // Process children first (in reverse z-order)
            const children = [...renderObject.getChildren()].reverse();
            for (const child of children) {
                dispatchMouseEventRecursive(child, child.calculateBounds(bounds));
                if (event.stopPropagationCalled) {
                    return;
                }
            }

            if (isPointInBounds(event.clientX, event.clientY, bounds)) {
                renderObject.emitMouseEvent(eventType, {
                    ...event,
                    offsetX: event.clientX - bounds.x,
                    offsetY: event.clientY - bounds.y
                });
            }
        }
        dispatchMouseEventRecursive(this.rootRenderObject, this.getRootBounds());
    }

    private updateMouseOverStates(event: InternalMouseEvent): void {
        const updateMouseOverStatesRecursive = (renderObject: RenderObject, event: InternalMouseEvent, bounds: RenderBounds): void => {
            renderObject.updateMouseOver(isPointInBounds(event.clientX, event.clientY, bounds), {
                    ...event,
                    offsetX: event.clientX - bounds.x,
                    offsetY: event.clientY - bounds.y
                });

            for (const child of renderObject.getChildren()) {
                updateMouseOverStatesRecursive(child, event, child.calculateBounds(bounds));
            }
        }
        updateMouseOverStatesRecursive(this.rootRenderObject, event, this.getRootBounds());
    }

    private clearAllMouseOverStates(event: InternalMouseEvent): void {
        const clearMouseOverStatesRecursive = (renderObject: RenderObject, event: InternalMouseEvent): void => {
            renderObject.updateMouseOver(false, event);

            // Clear children
            for (const child of renderObject.getChildren()) {
                clearMouseOverStatesRecursive(child, event);
            }
        }
        clearMouseOverStatesRecursive(this.rootRenderObject, event);
    }


    private getRootBounds(): RenderBounds {
        const root = this.rootRenderObject;
        if (root.x.type !== 'pixels' || root.y.type !== 'pixels' || 
            root.width.type !== 'pixels' || root.height.type !== 'pixels') {
            throw new Error('Root render object dimensions must be in pixels');
        }
        
        return {
            x: root.x.value,
            y: root.y.value,
            width: root.width.value,
            height: root.height.value
        };
    }

    resizeCanvases(): void {
        // Get size from the canvas parent container instead of the canvas itself
        const container = this.canvas.parentElement;

        const containerWidth = container.clientWidth;
        const containerHeight = container.clientHeight;
        const dpr = window.devicePixelRatio || 1;

        this.canvas.width = containerWidth * dpr;
        this.canvas.height = containerHeight * dpr;
        this.canvas.style.width = `${containerWidth}px`;
        this.canvas.style.height = `${containerHeight}px`;

        this.rootRenderObject.width = px(containerWidth);
        this.rootRenderObject.height = px(containerHeight);

        this.rowContainer.updateViewportWidths();

        this.requestRender();
    }
    
    render(): boolean {
        this.renderProfiler.startFrame();
        this.webglUtils.startFrame();
        
        let renderRequested = false;

        renderRequested = this.pluginManager.onBeforeRender(this.renderProfiler) || renderRequested;
        
        const gl = this.canvas.getContext('webgl');
        if (!gl) {
            throw new Error('WebGL context not available');
        }
        
        const dpr = window.devicePixelRatio || 1;

        const baseContext = {
            canvas: this.canvas,
            render: {
                gl,
                utils: this.webglUtils
            },
            state: this.state,
            dpr,
            viewport: [ 0, 0, this.canvas.width, this.canvas.height ] as [number, number, number, number],
        };

        // Clear the entire canvas first
        gl.viewport(baseContext.viewport[0], baseContext.viewport[1], baseContext.viewport[2], baseContext.viewport[3]);
        gl.clearColor(0, 0, 0, 1.0); // Black background 
        gl.clear(gl.COLOR_BUFFER_BIT);
        
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

        const rootBounds = this.getRootBounds();

        renderRequested = this.renderRecursive(this.rootRenderObject, baseContext, rootBounds) || renderRequested;

        renderRequested = this.pluginManager.onAfterRender(this.renderProfiler) || renderRequested;

        this.webglUtils.endFrame();
        this.renderProfiler.endFrame();

        return renderRequested;
    }

    private renderRecursive(renderObject: RenderObject, context: RenderContext, bounds: RenderBounds): boolean {
        let rerenderRequested = false;

        this.renderProfiler.startMeasure("render-" + renderObject.constructor.name);
        let nextContext = context;
        if (renderObject.viewport) {
            nextContext = {
                ...context,
                viewport: [
                    bounds.x * context.dpr,
                    context.canvas.height - (bounds.y + bounds.height) * context.dpr,
                    bounds.width * context.dpr,
                    bounds.height * context.dpr
                ]
            };
            context.render.gl.viewport(
                nextContext.viewport[0],
                nextContext.viewport[1],
                nextContext.viewport[2],
                nextContext.viewport[3]
            );
        }
        rerenderRequested = renderObject.render(nextContext, bounds) || rerenderRequested;
        for (const child of renderObject.getChildren()) {
            rerenderRequested = this.renderRecursive(child, nextContext, child.calculateBounds(bounds)) || rerenderRequested;
        }
        context.render.gl.viewport(
            context.viewport[0],
            context.viewport[1],
            context.viewport[2],
            context.viewport[3]
        );
        this.renderProfiler.endMeasure();
        
        return rerenderRequested;
    }

    async saveCsv(): Promise<void> {
        const rows = this.rowContainer.getAllRows();

        // Collect all signals from all rows
        const allSignals: Array<{signal: Signal, rowIndex: number, signalIndex: number}> = [];
        for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
            const row = rows[rowIndex];
            if (row.selected) {
                for (let signalIndex = 0; signalIndex < row.signals.length; signalIndex++) {
                    allSignals.push({
                        signal: row.signals[signalIndex],
                        rowIndex,
                        signalIndex
                    });
                }
            }
        }

        // Create a separate CSV file for each signal
        for (const {signal, rowIndex, signalIndex} of allSignals) {
            const signalName = signal.source.name.join('_') || `Row${rowIndex}_Signal${signalIndex}`;
            
            // Generate CSV content for this signal
            let csvContent = 'Time,Value\n';
            
            // Add all data points for this signal
            for (let i = 0; i < signal.length; i++) {
                const [time, value] = signal.data(i);
                csvContent += `${time},${value}\n`;
            }

            // Use browser download API to save this signal's CSV
            const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
            const link = document.createElement('a');
            const url = URL.createObjectURL(blob);
            link.setAttribute('href', url);
            link.setAttribute('download', `${signalName}.csv`);
            link.style.visibility = 'hidden';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);
        }
    }
}

    
function isPointInBounds(x: number, y: number, bounds: RenderBounds): boolean {
    return x >= bounds.x && x < bounds.x + bounds.width &&
            y >= bounds.y && y < bounds.y + bounds.height;
}