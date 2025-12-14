import type { WaveformState, RenderBounds, RenderContext, PluginModule, MouseEvent, MouseEventHandlers, MouseCaptureConfig } from "@voltex-viewer/plugin-api";
import { calculateBounds, px } from "@voltex-viewer/plugin-api";
import { RenderObjectImpl } from './renderObject';
import { SignalMetadataManagerImpl } from './signalMetadataManager';
import { SignalSourceManagerImpl } from './signalSourceManagerImpl';
import { WebGLUtilsImpl } from './webGLUtils';
import { PluginManager } from './pluginManager';
import { setPluginManager } from './plugins/manager/pluginManagerPlugin';
import { RenderProfiler } from './renderProfiler';
import PluginManagerFunction from './plugins/manager/pluginManagerPlugin';
import PluginManagerMetadata from './plugins/manager/plugin.json';
import { RowContainerRenderObject } from './rowContainerRenderObject';
import { CommandManager } from "./commandManager";
import { PluginConfigManager } from "./pluginConfigManager";
import { VerticalSidebar } from "./verticalSidebar";

interface InternalMouseEvent extends MouseEvent {
    readonly stopPropagationCalled: boolean;
}

const pluginManagerPlugin: PluginModule = {
    plugin: PluginManagerFunction,
    metadata: PluginManagerMetadata
};

export class Renderer {
    private canvas: HTMLCanvasElement;
    private webglUtils: WebGLUtilsImpl;
    public readonly pluginManager: PluginManager;
    private signalMetadata: SignalMetadataManagerImpl;
    private signalSources: SignalSourceManagerImpl;
    private renderProfiler: RenderProfiler;
    private rootRenderObject: RenderObjectImpl;
    private rowContainer: RowContainerRenderObject;
    private mouseButtonsPressed: number = 0;
    private mouseCaptureMap: Map<number, { 
        renderObject: RenderObjectImpl; 
        bounds: RenderBounds; 
        config: MouseCaptureConfig;
    }> = new Map();
    private lastTouchDistance: number = 0;
    private isPinching: boolean = false;
    
    constructor(
        private state: WaveformState,
        canvas: HTMLCanvasElement,
        private verticalSidebar: VerticalSidebar,
        private requestRender: () => void
    ) {
        this.canvas = canvas;
        
        this.renderProfiler = new RenderProfiler();
        
        // Create root render object
        this.rootRenderObject = new RenderObjectImpl(null, { });
        
        // Initialize WebGL2 context
        const gl = this.canvas.getContext('webgl2');
        if (!gl) {
            throw new Error('WebGL2 not supported');
        }

        const webglUtils = new WebGLUtilsImpl(gl);
        
        // Profile all WebGLUtils function calls
        const proxiedWebglUtils = this.renderProfiler.createProxy(webglUtils, 'webgl');
        
        this.webglUtils = proxiedWebglUtils;
        
        this.signalMetadata = new SignalMetadataManagerImpl();
        this.signalSources = new SignalSourceManagerImpl();

        // Create row container and add it to root
        const configManager = new PluginConfigManager();
        const commandManager = new CommandManager(configManager);
        this.rowContainer = new RowContainerRenderObject(this.rootRenderObject, this.state, this.requestRender, commandManager);
        
        this.pluginManager = new PluginManager(
            this.state,
            { gl, utils: proxiedWebglUtils },
            this.signalMetadata,
            this.signalSources,
            this.rowContainer,
            this.rootRenderObject,
            (entry) => this.verticalSidebar.add(entry),
            (entry) => this.verticalSidebar.remove(entry),
            this.requestRender,
            this.renderProfiler,
            configManager,
            commandManager,
        );
        
        this.resizeCanvases(); // Setup the root size
        
        // Set up mouse event handlers on the canvas
        this.setupMouseEventHandlers();
        this.setupTouchEventHandlers();
        this.setupKeyboardEventHandlers();
    }

    async loadPlugins() {
        // Register and enable default plugins (only Plugin Manager)
        this.pluginManager.registerPluginType(pluginManagerPlugin);
        await this.pluginManager.enablePlugin(pluginManagerPlugin);
        await setPluginManager(this.pluginManager);
    }

    private setupMouseEventHandlers(): void {
        this.canvas.addEventListener('mousedown', (e): void => {
            this.canvas.focus();
            this.mouseButtonsPressed |= (1 << e.button);
            this.dispatchMouseEvent('onMouseDown', this.createMouseEvent(e));
        });
        window.addEventListener('mousemove', (e): void => {
            const mouseEvent = this.createGlobalMouseEvent(e);
            
            // Check if any button has captured the mouse
            const capture = this.mouseCaptureMap.get(0); // Only left button for now
            if (capture && (this.mouseButtonsPressed & 1)) {
                const offsetEvent = {
                    ...mouseEvent,
                    offsetX: mouseEvent.clientX - capture.bounds.x,
                    offsetY: mouseEvent.clientY - capture.bounds.y
                };
                
                // Always send to capturing object
                const handler = capture.renderObject.onMouseMove;
                const captureConfig = handler?.call(capture.renderObject, offsetEvent);
                
                // Handle preventDefault
                if (capture.config.preventDefault || captureConfig?.preventDefault) {
                    // Already handled via createGlobalMouseEvent
                }
                
                // Update capture config if returned from onMouseMove
                if (captureConfig) {
                    capture.config = { ...capture.config, ...captureConfig };
                }
                
                // If allowMouseMoveThrough, also dispatch to normal hierarchy
                if (capture.config.allowMouseMoveThrough) {
                    this.dispatchMouseEvent('onMouseMove', mouseEvent, true);
                    this.updateMouseOverStates(mouseEvent);
                }
            } else {
                // No capture, use normal hit-testing
                this.dispatchMouseEvent('onMouseMove', mouseEvent);
                this.updateMouseOverStates(mouseEvent);
            }
        });
        
        window.addEventListener('mouseup', (e): void => {
            const mouseEvent = this.createGlobalMouseEvent(e);
            this.mouseButtonsPressed &= ~(1 << e.button);
            
            // Check if this button has captured the mouse
            const capture = this.mouseCaptureMap.get(e.button);
            if (capture) {
                // Send mouseup to captured render object
                const handler = capture.renderObject.onMouseUp;
                if (handler) {
                    handler.call(capture.renderObject, {
                        ...mouseEvent,
                        offsetX: mouseEvent.clientX - capture.bounds.x,
                        offsetY: mouseEvent.clientY - capture.bounds.y
                    });
                }
                // Clear capture for this button
                this.mouseCaptureMap.delete(e.button);
            }
            
            // Always dispatch through normal hierarchy too, so other objects get mouseup
            this.dispatchMouseEvent('onMouseUp', mouseEvent);
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

    private setupTouchEventHandlers(): void {
        this.canvas.addEventListener('touchstart', (e): void => {
            e.preventDefault();
            this.canvas.focus();
            if (e.touches.length === 1 && !this.isPinching) {
                this.mouseButtonsPressed |= 1;
                this.dispatchMouseEvent('onMouseDown', this.createTouchEvent(e.touches[0]));
            } else if (e.touches.length === 2) {
                this.isPinching = true;
                this.mouseButtonsPressed = 0;
                this.mouseCaptureMap.clear();
                this.lastTouchDistance = this.getTouchDistance(e.touches);
            }
        }, { passive: false });

        this.canvas.addEventListener('touchmove', (e): void => {
            e.preventDefault();
            if (e.touches.length === 1 && !this.isPinching) {
                const touchEvent = this.createTouchEvent(e.touches[0]);
                this.dispatchMouseEvent('onMouseMove', touchEvent);
                this.updateMouseOverStates(touchEvent);
            } else if (e.touches.length === 2) {
                const newDistance = this.getTouchDistance(e.touches);
                const scale = newDistance / this.lastTouchDistance;
                this.dispatchMouseEvent('onWheel', this.createPinchWheelEvent(e.touches, (scale - 1) * -500));
                this.lastTouchDistance = newDistance;
            }
        }, { passive: false });

        this.canvas.addEventListener('touchend', (e): void => {
            e.preventDefault();
            const touchEvent = e.changedTouches.length > 0 
                ? this.createTouchEvent(e.changedTouches[0]) 
                : this.createTouchEvent({ clientX: 0, clientY: 0 } as Touch);
            if (e.touches.length === 0) {
                const wasPinching = this.isPinching;
                this.isPinching = false;
                this.mouseButtonsPressed = 0;
                this.mouseCaptureMap.clear();
                if (!wasPinching) {
                    this.dispatchMouseEvent('onMouseUp', touchEvent);
                }
                this.clearAllMouseOverStates(touchEvent);
            }
        }, { passive: false });

        this.canvas.addEventListener('touchcancel', (): void => {
            this.mouseButtonsPressed = 0;
            this.mouseCaptureMap.clear();
            this.isPinching = false;
            this.clearAllMouseOverStates(this.createTouchEvent({ clientX: -1, clientY: -1 } as Touch));
        });
    }

    private getTouchDistance(touches: TouchList): number {
        const dx = touches[1].clientX - touches[0].clientX;
        const dy = touches[1].clientY - touches[0].clientY;
        return Math.sqrt(dx * dx + dy * dy);
    }

    private createTouchEvent(touch: Touch): InternalMouseEvent {
        let stopPropagationCalled = false;
        const canvasRect = this.canvas.getBoundingClientRect();
        const clientX = touch.clientX - canvasRect.left;
        const clientY = touch.clientY - canvasRect.top;
        return {
            clientX, clientY, offsetX: clientX, offsetY: clientY,
            button: 0, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false,
            get stopPropagationCalled() { return stopPropagationCalled; },
            preventDefault: () => {},
            stopPropagation: () => { stopPropagationCalled = true; }
        };
    }

    private createPinchWheelEvent(touches: TouchList, deltaY: number): InternalMouseEvent & { deltaY: number; deltaX: number; deltaZ: number } {
        const event = this.createTouchEvent({
            clientX: (touches[0].clientX + touches[1].clientX) / 2,
            clientY: (touches[0].clientY + touches[1].clientY) / 2
        } as Touch);
        return { ...event, deltaY, deltaX: 0, deltaZ: 0 };
    }

    private setupKeyboardEventHandlers(): void {
        this.canvas.tabIndex = 0;
        this.canvas.style.outline = 'none';
        
        this.canvas.addEventListener('keydown', (e) => {
            const keybinding = this.buildKeybindingString(e);
            const handled = this.pluginManager.executeKeybinding(keybinding);
            if (handled) {
                e.preventDefault();
            }
        });
    }

    private buildKeybindingString(event: KeyboardEvent): string {
        const parts: string[] = [];
        if (event.ctrlKey) parts.push('ctrl');
        if (event.altKey) parts.push('alt');
        if (event.shiftKey) parts.push('shift');
        if (event.metaKey) parts.push('meta');
        parts.push(event.key.toLowerCase());
        return parts.join('+');
    }

    private createGlobalMouseEvent(e: globalThis.MouseEvent): InternalMouseEvent {
        let stopPropagationCalled = false;
        
        // Get canvas position to properly offset mouse coordinates
        const canvasRect = this.canvas.getBoundingClientRect();
        
        const mouseEvent: InternalMouseEvent = {
            clientX: e.clientX - canvasRect.left,
            clientY: e.clientY - canvasRect.top,
            offsetX: e.clientX - canvasRect.left,
            offsetY: e.clientY - canvasRect.top,
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

    private isMouseInCanvas(e: globalThis.MouseEvent): boolean {
        const canvasRect = this.canvas.getBoundingClientRect();
        return e.clientX >= canvasRect.left && 
               e.clientX < canvasRect.right && 
               e.clientY >= canvasRect.top && 
               e.clientY < canvasRect.bottom;
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

    private dispatchMouseEvent(eventType: keyof MouseEventHandlers, event: InternalMouseEvent & Partial<{ deltaY: number; deltaX: number; deltaZ: number }>, skipCapturingObject: boolean = false): void {
        const capturedObject = this.mouseCaptureMap.get(0)?.renderObject; // Only left button
        
        const dispatchMouseEventRecursive = (
            renderObject: RenderObjectImpl, 
            bounds: RenderBounds
        ): void => {
            // Skip the capturing object if requested (to avoid duplicate events)
            if (skipCapturingObject && renderObject === capturedObject) {
                return;
            }
            
            // Process children first (in reverse z-order)
            const children = [...renderObject.children].reverse();
            for (const child of children) {
                dispatchMouseEventRecursive(child as RenderObjectImpl, calculateBounds(child, bounds));
                if (event.stopPropagationCalled) {
                    return;
                }
            }

            if (isPointInBounds(event.clientX, event.clientY, bounds)) {
                const offsetEvent = {
                    ...event,
                    offsetX: event.clientX - bounds.x,
                    offsetY: event.clientY - bounds.y
                };
                
                if (eventType === 'onWheel') {
                    const handler = renderObject.onWheel;
                    handler?.call(renderObject, offsetEvent as typeof offsetEvent & { deltaY: number; deltaX: number; deltaZ: number });
                } else {
                    const handler = renderObject[eventType];
                    if (handler) {
                        const captureConfig = handler.call(renderObject, offsetEvent);
                        
                        // Handle capture on mousedown or mouseMove
                        if ((eventType === 'onMouseDown' || eventType === 'onMouseMove') && captureConfig && event.button === 0) {
                            if (captureConfig.captureMouse) {
                                this.mouseCaptureMap.set(event.button, {
                                    renderObject: renderObject,
                                    bounds: bounds,
                                    config: captureConfig
                                });
                            }
                        }
                    }
                }
            }
        }
        dispatchMouseEventRecursive(this.rootRenderObject, this.getRootBounds());
    }

    private updateMouseOverStates(event: InternalMouseEvent): void {
        const updateMouseOverStatesRecursive = (renderObject: RenderObjectImpl, event: InternalMouseEvent, bounds: RenderBounds): void => {
            renderObject.updateMouseOver(isPointInBounds(event.clientX, event.clientY, bounds), {
                    ...event,
                    offsetX: event.clientX - bounds.x,
                    offsetY: event.clientY - bounds.y
                });

            for (const child of renderObject.children) {
                updateMouseOverStatesRecursive(child as RenderObjectImpl, event, calculateBounds(child, bounds));
            }
        }
        updateMouseOverStatesRecursive(this.rootRenderObject, event, this.getRootBounds());
    }

    private clearAllMouseOverStates(event: InternalMouseEvent): void {
        const clearMouseOverStatesRecursive = (renderObject: RenderObjectImpl, event: InternalMouseEvent): void => {
            renderObject.updateMouseOver(false, event);

            // Clear children
            for (const child of renderObject.children) {
                clearMouseOverStatesRecursive(child as RenderObjectImpl, event);
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
        if (!container) {
            throw new Error('Canvas has no parent element for sizing');
        }

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

    onDprChanged(): void {
        this.webglUtils.clearTextureCache();
        this.resizeCanvases();
    }
    
    render(): boolean {
        this.renderProfiler.startFrame();
        this.webglUtils.startFrame();
        
        let renderRequested = false;

        renderRequested = this.pluginManager.onBeforeRender(this.renderProfiler) || renderRequested;
        
        const gl = this.canvas.getContext('webgl2');
        if (!gl) {
            throw new Error('WebGL2 context not available');
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

    private renderRecursive(renderObject: RenderObjectImpl, context: RenderContext, bounds: RenderBounds): boolean {
        let rerenderRequested = false;

        this.renderProfiler.startMeasure("render-" + renderObject.constructor.name);
        let nextContext = context;
        if ('viewport' in renderObject && renderObject.viewport) {
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
        if (renderObject.render) {
            rerenderRequested = renderObject.render(nextContext, bounds) || rerenderRequested;
        }
        for (const child of renderObject.children) {
            rerenderRequested = this.renderRecursive(child as RenderObjectImpl, nextContext, calculateBounds(child, bounds)) || rerenderRequested;
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
}

function isPointInBounds(x: number, y: number, bounds: RenderBounds): boolean {
    return x >= bounds.x && x < bounds.x + bounds.width &&
            y >= bounds.y && y < bounds.y + bounds.height;
}

