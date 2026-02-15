import * as t from 'io-ts';

// eslint-disable-next-line @typescript-eslint/naming-convention
export const DEFAULT_VALUE = Symbol('DEFAULT_VALUE');

export type WithDefaults<T> = {
    [P in keyof T]?: T[P] | typeof DEFAULT_VALUE;
};

// Branded type for keybindings
export interface KeybindingBrand {
    readonly Keybinding: unique symbol;
}

// eslint-disable-next-line @typescript-eslint/naming-convention
export const Keybinding = t.brand(
    t.string,
    (s): s is t.Branded<string, KeybindingBrand> => typeof s === 'string',
    'Keybinding'
);

export interface Command {
    id: string;
    action: () => void;
}

export interface MouseEvent {
    clientX: number;
    clientY: number;
    offsetX: number;
    offsetY: number;
    button: number;
    ctrlKey: boolean;
    metaKey: boolean;
    shiftKey: boolean;
    altKey: boolean;
    preventDefault(): void;
    stopPropagation(): void;
}

export interface WheelEvent extends MouseEvent {
    deltaY: number;
    deltaX: number;
    deltaZ: number;
}

export interface MouseCaptureConfig {
    captureMouse?: boolean;
    allowMouseMoveThrough?: boolean;
    preventDefault?: boolean;
}

export interface MouseEventHandlers {
    onMouseDown?: (event: MouseEvent) => MouseCaptureConfig | void;
    onMouseUp?: (event: MouseEvent) => void;
    onMouseMove?: (event: MouseEvent) => MouseCaptureConfig | void;
    onMouseEnter?: (event: MouseEvent) => void;
    onMouseLeave?: (event: MouseEvent) => void;
    onClick?: (event: MouseEvent) => void;
    onWheel?: (event: WheelEvent) => void;
}

export enum RenderMode {
    Lines = 'lines',
    Discrete = 'discrete',
    Dots = 'dots',
    Enum = 'enum',
    ExpandedEnum = 'expanded-enum',
    Off = 'off',
}

export interface MeasureInfo {
    name: string;
    startTime: number;
    endTime: number;
}

export interface FrameInfo {
    startTime: number;
    endTime: number;
    frameTime: number;
    measures: MeasureInfo[][];
}

export interface ReadOnlyRenderProfiler {
    readonly lastFrame: FrameInfo | null;
    getFilteredFrameRenderTime(): number;
    startMeasure(name: string): void;
    endMeasure(): void;
}

export interface Row {
    readonly height: number;
    readonly signals: Signal[];
    readonly yScale: number;
    readonly yOffset: number;
    readonly selected: boolean;
    readonly mainArea: RenderObject;
    readonly labelArea: RenderObject;

    setHeight(height: number): void;
}

export interface SignalSource {
    name: string[];
    signal(): Promise<Signal>;
}

export interface RowsChangedEvent {
    added: Row[];
    removed: Row[];
}

export interface SignalsAvailableChangedEvent {
    added: SignalSource[];
    removed: SignalSource[];
}

export interface SignalSourceManager {
    available: SignalSource[];

    changed(callback: (event: SignalsAvailableChangedEvent) => void): void;

    add(signals: SignalSource[]): void;
    remove(signals: SignalSource[]): void;
}

export type RowsChangedCallback = (event: RowsChangedEvent) => void;
export type SignalsAvailableChangedCallback = (event: SignalsAvailableChangedEvent) => void;

export interface SidebarEntryArgs {
    title: string;
    iconHtml: string;
    renderContent(): string | HTMLElement;
}

export interface SidebarEntry {
    open(): void;
}

export interface RowParameters {
    channels?: Signal[];
    height?: number;
}

export interface RowInsert {
    index: number;
    row: RowParameters;
}

export interface FileOpenHandler {
    extensions: `.${string}`[];
    description: string;
    mimeType: `${string}/${string}`;
    handler: (file: File) => Promise<SignalSource[]>;
}

export interface WritableFile {
    write(data: BufferSource | Blob | string): Promise<void>;
    close(): Promise<void>;
}

export interface FileSaveHandler {
    extensions: `.${string}`[];
    description: string;
    mimeType: `${string}/${string}`;
    handler: (file: WritableFile) => Promise<void>;
}

export interface SignalMetadata {
    color: string;
    renderMode: RenderMode;
    display: 'decimal' | 'hex';
}

export interface SignalMetadataManager {
    get(signal: Signal): SignalMetadata;
    set(signal: Signal, value: WithDefaults<SignalMetadata>): void;
}

export interface RenderObjectArgs extends Partial<MouseEventHandlers> {
    zIndex?: number;
    viewport?: boolean;
    x?: PositionValue;
    y?: PositionValue;
    width?: PositionValue;
    height?: PositionValue;

    render?(context: RenderContext, bounds: RenderBounds): boolean;
    dispose?(): void;
}

export interface PluginContext {
    state: WaveformState;
    webgl: WebGlContext;
    signalMetadata: SignalMetadataManager;
    signalSources: SignalSourceManager;
    renderProfiler: ReadOnlyRenderProfiler;
    rootRenderObject: RenderObject,
    onRowsChanged(callback: RowsChangedCallback): void;
    onConfigChanged(callback: (pluginName: string, newConfig: unknown) => void): void;
    onBeforeRender(callback: () => boolean): void;
    onAfterRender(callback: () => boolean): void;
    addSidebarEntry(entry: SidebarEntryArgs): SidebarEntry;
    requestRender(): void;
    createRows(...rows: RowParameters[]): Row[];
    spliceRows(rowsToRemove: Row[], rowsToAdd: RowInsert[]): Row[];
    getRows(): Row[];
    loadConfig<A, O = A, I = unknown>(schema: t.Type<A, O, I>, defaultConfig: O): A;
    getEnvironment(): 'electron' | 'browser';
    loadFiles(...files: File[]): Promise<SignalSource[]>;
    registerFileOpenHandler(handler: FileOpenHandler): void;
    registerFileSaveHandler(handler: FileSaveHandler): void;
    registerCommand(command: Command): void;
}

export interface RenderObject {
    zIndex: number;
    readonly children: readonly RenderObject[];
    readonly parent: RenderObject | null;
    x: PositionValue;
    y: PositionValue;
    width: PositionValue;
    height: PositionValue;
    readonly viewport?: boolean;

    addChild(args: RenderObjectArgs): RenderObject;
    removeChild(child: RenderObject): void;
}

export interface PluginMetadata {
    name: string;
    displayName?: string;
    version: string;
    description?: string;
    author?: string;
    url?: string;
}

export type PluginFunction = (context: PluginContext) => void | Promise<void>;

export interface PluginModule {
    plugin: PluginFunction;
    metadata: PluginMetadata;
}

export interface WaveformState {
    offset: number,
    pxPerSecond: number,
}

export interface TextValue {
    text: string;
    value?: number;
}

export interface Sequence {
    /** Minimum value in the sequence */
    min: number;
    /** Maximum value in the sequence */
    max: number;
    /** Number of values in the sequence */
    length: number;
    /** Optional value representing null/missing data */
    null?: number;
    /** Unit of measurement for the sequence values */
    unit?: string;
    /** Returns the value at the specified index used for plotting */
    valueAt(index: number): number;
    /** Returns the converted/formatted value at the specified index used for tooltips/display */
    convertedValueAt?(index: number): number | bigint | string;
}

export interface Signal {
    source: SignalSource;
    time: Sequence;
    values: Sequence;
    renderHint: RenderMode;
}
export interface RenderContext {
    canvas: HTMLCanvasElement;
    render: WebGlContext;
    state: WaveformState;
    dpr: number;
    viewport: [number, number, number, number];
}
export interface WebGlContext {
    gl: WebGL2RenderingContext;
    utils: WebGLUtils;
}

export interface WebGLUtils {
    line: WebGLProgram;
    grid: WebGLProgram;

    createShader(type: 'fragment-shader' | 'vertex-shader', source: string): WebGLShader;

    createProgram(vertexShader: WebGLShader, fragmentShader: WebGLShader): WebGLProgram;

    getDefaultFont(fontWeight?: string, fontSize?: string): string;

    drawText(
        text: string,
        x: number,
        y: number,
        bounds: { width: number; height: number },
        options?: {
            font?: string;
            fillStyle?: string;
            strokeStyle?: string;
            strokeWidth?: number;
        }
    ): void;

    measureText(text: string, font?: string, padding?: number, strokeWidth?: number): {metrics: TextMetrics, renderWidth: number, renderHeight: number};
}

export interface RenderBounds {
    x: number;
    y: number;
    width: number;
    height: number;
}

export type PositionValue =
    { type: 'pixels'; value: number; } |
    { type: 'percentage'; value: number; };


export function px(value: number): PositionValue {
    return { type: 'pixels', value };
}

export function percent(value: number): PositionValue {
    return { type: 'percentage', value };
}

export function hexToRgba(hex: string, alpha: number = 1.0): [number, number, number, number] {
    const r = parseInt(hex.slice(1, 3), 16) / 255;
    const g = parseInt(hex.slice(3, 5), 16) / 255;
    const b = parseInt(hex.slice(5, 7), 16) / 255;
    return [r, g, b, alpha];
}

export function calculateBounds(object: RenderObject, parentBounds: RenderBounds): RenderBounds {
    return {
        x: parentBounds.x + resolvePositionValue(object.x, parentBounds.width),
        y: parentBounds.y + resolvePositionValue(object.y, parentBounds.height),
        width: resolvePositionValue(object.width, parentBounds.width),
        height: resolvePositionValue(object.height, parentBounds.height)
    };
}

export function getAbsoluteBounds(object: RenderObject): RenderBounds {
    if (!object.parent) {
        return {
            x: resolvePositionValue(object.x, 0),
            y: resolvePositionValue(object.y, 0),
            width: resolvePositionValue(object.width, 0),
            height: resolvePositionValue(object.height, 0),
        };
    }
    return calculateBounds(object, getAbsoluteBounds(object.parent));
}

export function resolvePositionValue(value: PositionValue, parentDimension: number): number {
    switch (value.type) {
        case 'pixels':
            return value.value;
        case 'percentage':
            return (value.value / 100) * parentDimension;
        default:
            throw new Error(`Unknown position value type: ${JSON.stringify(value)}`);
    }
}

export function formatValueForDisplay(value: number | bigint | string, displayMode: 'decimal' | 'hex'): string {
    switch (typeof value) {
        case 'string':
            return value;
        case 'bigint':
            if (displayMode === 'hex') {
                const hex = value.toString(16);
                return value < 0n ? `-0x${hex.slice(1).toUpperCase()}` : `0x${hex.toUpperCase()}`;
            } else {
                return value.toString();
            }
        case 'number':
            if (displayMode === 'hex') {
                const hex = Math.round(value).toString(16);
                return value < 0 ? `-0x${hex.slice(1).toUpperCase()}` : `0x${hex.toUpperCase()}`;
            } else if (Math.abs(value) >= 1e6 || (Math.abs(value) < 1e-3 && value !== 0)) {
                return value.toExponential(3);
            } else {
                return value.toFixed(6);
            }
    }
}
