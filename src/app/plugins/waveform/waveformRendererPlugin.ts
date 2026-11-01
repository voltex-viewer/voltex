import { RenderMode, signalShift, type PluginContext, type RenderBounds, type RenderContext, type Row, type Signal } from '@voltex-viewer/plugin-api';
import { waveformConfigSchema } from './waveformConfig';
import { WaveformRenderObject } from './waveformRenderObject';
import { WaveformRowHoverOverlayRenderObject } from './waveformRowHoverOverlayRenderObject';
import { WaveformTooltipRenderObject } from './waveformTooltipRenderObject';
import { WaveformShaders } from './waveformShaders';
import { LodView, type LodGeometry } from './lod/lodView';
import { EnumRuns } from './lod/enumRuns';
import {
    animationLerpFactor,
    ExpandedEnumResources,
} from './expandedEnum';

export interface BufferData {
    timeHighBuffer: WebGLBuffer;
    timeLowBuffer: WebGLBuffer;
    valueBuffer: WebGLBuffer;
    bufferCapacity: number;
    bufferLength: number;
    blocks?: { buffer: WebGLBuffer; count: number };
    runs?: EnumRuns;
}

type UploadedKind = 'lines' | 'enum';

export interface SignalBufferData extends BufferData {
    blocks: { buffer: WebGLBuffer; count: number; capacity: number };
    runs: EnumRuns;
    lod: LodView;
    uploaded: UploadedKind | null;
    // Draws the same points as dots, when they are every sample and few enough to see apart
    dots: BufferData;
}

function isEnumMode(mode: RenderMode): boolean {
    return mode === RenderMode.Enum || mode === RenderMode.ExpandedEnum;
}

// Grows by powers of two, so most uploads only write into the existing storage
function grownCapacity(capacity: number, needed: number): number {
    return capacity >= needed ? capacity : Math.max(256, 1 << Math.ceil(Math.log2(needed)));
}

function writeBuffer(gl: WebGL2RenderingContext, buffer: WebGLBuffer, data: Float32Array, reallocateBytes: number | null): void {
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    if (reallocateBytes !== null) gl.bufferData(gl.ARRAY_BUFFER, reallocateBytes, gl.DYNAMIC_DRAW);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, data);
}

// Times are split into high and low parts for emulated double precision
const scratch = {
    timeHigh: new Float32Array(1024),
    timeLow: new Float32Array(1024),
    value: new Float32Array(1024),
};

function uploadPoints(gl: WebGL2RenderingContext, bufferData: SignalBufferData, length: number, time: (i: number) => number, value: (i: number) => number): void {
    if (scratch.value.length < length) {
        const size = grownCapacity(scratch.value.length, length);
        scratch.timeHigh = new Float32Array(size);
        scratch.timeLow = new Float32Array(size);
        scratch.value = new Float32Array(size);
    }
    for (let i = 0; i < length; i++) {
        const t = time(i);
        const high = Math.fround(t);
        scratch.timeHigh[i] = high;
        scratch.timeLow[i] = t - high;
        scratch.value[i] = value(i);
    }
    const capacity = grownCapacity(bufferData.bufferCapacity, length);
    const pointBytes = capacity !== bufferData.bufferCapacity ? capacity * 4 : null;
    writeBuffer(gl, bufferData.timeHighBuffer, scratch.timeHigh.subarray(0, length), pointBytes);
    writeBuffer(gl, bufferData.timeLowBuffer, scratch.timeLow.subarray(0, length), pointBytes);
    writeBuffer(gl, bufferData.valueBuffer, scratch.value.subarray(0, length), pointBytes);
    bufferData.bufferCapacity = capacity;
    bufferData.bufferLength = length;
}

function uploadLines(gl: WebGL2RenderingContext, bufferData: SignalBufferData, geometry: LodGeometry): void {
    uploadPoints(gl, bufferData, geometry.length, i => geometry.time[i], i => geometry.value[i]);

    const blocks = bufferData.blocks;
    const blockCapacity = grownCapacity(blocks.capacity, geometry.blockCount);
    const blockBytes = blockCapacity !== blocks.capacity ? blockCapacity * 24 : null;
    writeBuffer(gl, blocks.buffer, geometry.blocks.subarray(0, geometry.blockCount * 6), blockBytes);
    blocks.capacity = blockCapacity;
    blocks.count = geometry.blockCount;
}

// One point per run, then one to end the last run
function uploadEnum(gl: WebGL2RenderingContext, bufferData: SignalBufferData, runs: EnumRuns): void {
    const last = runs.count - 1;
    const length = last < 0 ? 0 : runs.end(last) > runs.start(last) ? runs.count + 1 : runs.count;
    uploadPoints(gl, bufferData, length, i => i <= last ? runs.start(i) : runs.end(last), i => runs.value(Math.min(i, last)));
    bufferData.blocks.count = 0;
}

export default (context: PluginContext): void => {
    const waveformPrograms = new WaveformShaders(context.webgl.gl, context.webgl.utils);

    const config = context.loadConfig(
        waveformConfigSchema,
        {
            dotSize: 4.0,
            lineWidth: 1.5,
            dotVisibilityThreshold: 200,
            targetFps: 120,
            formatTooltip: "displayName + ': ' + (typeof(display) === 'string' ? display : value.toFixed(Math.min(6, Math.max(0, Math.ceil(Math.log10(Math.abs(yScale)) + 2))))) + units",
            hoverEnabled: true,
            enumExpansionEnabled: true,
            minExpandedWidth: 50,
        });

    // Create a single global tooltip render object
    const waveformOverlays: Map<Row, WaveformRowHoverOverlayRenderObject> = new Map();
    new WaveformTooltipRenderObject(context.rootRenderObject, config, waveformOverlays, context.signalMetadata);

    const buffers = new Map<Signal, SignalBufferData>();
    
    // Create shared instance geometry for line segments (2 triangles, 6 vertices)
    const segmentInstanceGeometry = new Float32Array([
        0, -0.5,
        1, -0.5,
        1,  0.5,
        0, -0.5,
        1,  0.5,
        0,  0.5
    ]);
    
    // Create bevel join instance geometry (1 triangle, 3 vertices, 2 coefficients each)
    const bevelJoinInstanceGeometry = new Float32Array([
        0, 0,
        1, 0,
        0, 1
    ]);
    
    // Create shared instance geometry buffer
    const sharedInstanceGeometryBuffer = context.webgl.gl.createBuffer();
    if (!sharedInstanceGeometryBuffer) {
        throw new Error('Failed to create shared instance geometry buffer');
    }
    context.webgl.gl.bindBuffer(context.webgl.gl.ARRAY_BUFFER, sharedInstanceGeometryBuffer);
    context.webgl.gl.bufferData(context.webgl.gl.ARRAY_BUFFER, segmentInstanceGeometry, context.webgl.gl.STATIC_DRAW);
    
    // Create shared bevel join geometry buffer
    const sharedBevelJoinGeometryBuffer = context.webgl.gl.createBuffer();
    if (!sharedBevelJoinGeometryBuffer) {
        throw new Error('Failed to create shared bevel join geometry buffer');
    }
    context.webgl.gl.bindBuffer(context.webgl.gl.ARRAY_BUFFER, sharedBevelJoinGeometryBuffer);
    context.webgl.gl.bufferData(context.webgl.gl.ARRAY_BUFFER, bevelJoinInstanceGeometry, context.webgl.gl.STATIC_DRAW);

    // Create shared expanded enum resources
    const expandedEnumResources = new ExpandedEnumResources(context.webgl.gl);

    // Frame timing variables
    let frameStartTime = 0;
    const frameTimeOverhead = 2; // ms overhead to avoid losing performance
    let firstSignal = 0;

    const updateLod = (signal: Signal, bufferData: SignalBufferData, deadline: number): boolean => {
        const gl = context.webgl.gl;
        const state = context.state;
        const view = bufferData.lod;
        const dpr = window.devicePixelRatio || 1;
        const start = state.offset / state.pxPerSecond - signalShift(signal, state);
        const end = start + gl.canvas.width / dpr / state.pxPerSecond;
        // Data held back by the display delay is about to scroll into view, so fetch its tiles early
        const aheadTo = end >= state.displayEndTime - signalShift(signal, state) ? Math.max(end, signal.timeRange[1]) : end;
        const { changed, busy } = view.update(start, end, state.pxPerSecond * dpr, deadline, aheadTo);
        if (changed) {
            bufferData.runs.build(view.geometry!);
        }
        // The render mode can change at any time, so the same view is uploaded either way
        const kind: UploadedKind = isEnumMode(context.signalMetadata.get(signal).renderMode) ? 'enum' : 'lines';
        if (view.geometry && (changed || bufferData.uploaded !== kind)) {
            if (kind === 'enum') uploadEnum(gl, bufferData, bufferData.runs);
            else uploadLines(gl, bufferData, view.geometry);
            bufferData.uploaded = kind;
        }
        const geometry = view.geometry;
        const showDots = kind === 'lines' && geometry !== null && geometry.raw &&
            pointsBetween(geometry, start, end) <= config.dotVisibilityThreshold;
        bufferData.dots.bufferLength = showDots ? bufferData.bufferLength : 0;
        return busy;
    };

    context.onBeforeRender(() => {
        frameStartTime = performance.now();
        
        // Adapt chunk size based on previous frame performance
        const targetFrameTime = 1000 / config.targetFps; // Convert FPS to milliseconds
        
        let anyBufferNeedsUpdate = false;
        const availableTime = Math.max(1, targetFrameTime - frameTimeOverhead);

        const frameDeadline = frameStartTime + availableTime;
        const entries = [...buffers.entries()];
        // Started from a different signal each frame, so the same ones aren't always left with no time to fetch
        const first = entries.length > 0 ? firstSignal++ % entries.length : 0;
        for (let k = 0; k < entries.length; k++) {
            const [signal, bufferData] = entries[(first + k) % entries.length];
            const now = performance.now();
            // Shared out, so one large signal doesn't hold up the others. Out of time, signals still update from the
            // tiles they have, so none are left showing a view that is no longer on screen.
            const deadline = now + Math.max(0, frameDeadline - now) / (entries.length - k);

            const needsMore = updateLod(signal, bufferData, deadline);
            anyBufferNeedsUpdate ||= needsMore;
        }
        return anyBufferNeedsUpdate;
    });

    context.onRowsChanged((event) => {
        for (const row of event.added) {
            const rowSignals: Signal[] = [];
            const enumRenderObjects = new Map<Signal, WaveformRenderObject>();
            
            for (const channel of row.signals) {
                // Create buffers
                if (!buffers.has(channel)) {
                    const createBuffer = () => {
                        const buffer = context.webgl.gl.createBuffer();
                        if (!buffer) {
                            throw new Error('Failed to create WebGL buffer for sequence');
                        }
                        return buffer;
                    };
                    const timeHighBuffer = createBuffer();
                    const timeLowBuffer = createBuffer();
                    const valueBuffer = createBuffer();
                    buffers.set(channel, {
                        timeHighBuffer,
                        timeLowBuffer,
                        valueBuffer,
                        bufferCapacity: 0,
                        bufferLength: 0,
                        blocks: { buffer: createBuffer(), count: 0, capacity: 0 },
                        runs: new EnumRuns(),
                        lod: new LodView(channel, () => context.requestRender()),
                        uploaded: null,
                        dots: { timeHighBuffer, timeLowBuffer, valueBuffer, bufferCapacity: 0, bufferLength: 0 },
                    });
                }
                
                rowSignals.push(channel);
                
                const buffer = buffers.get(channel)!;
                const metadata = context.signalMetadata.get(channel);
                
                // Track expanded enum state for this signal
                const expandedState = {
                    wasExpanded: false,
                    progress: 0, // 0 = collapsed, 1 = fully expanded
                };
                
                // Create metadata proxy that handles expanded enum mode switching
                const enumMetadata = new Proxy(metadata, {
                    get: (target, prop) => {
                        if (prop === 'renderMode') {
                            // If explicitly set to ExpandedEnum, always use it
                            if (target.renderMode === RenderMode.ExpandedEnum) return RenderMode.ExpandedEnum;
                            if (target.renderMode !== RenderMode.Enum) return target.renderMode;
                            // When animating, always show expanded mode (it handles the progress)
                            if (expandedState.progress > 0) return RenderMode.ExpandedEnum;
                            return RenderMode.Enum;
                        }
                        return target[prop as keyof typeof target];
                    }
                });
                
                const enumRenderObject = new WaveformRenderObject(
                    row.mainArea,
                    context.webgl.gl,
                    config,
                    buffer,
                    sharedInstanceGeometryBuffer,
                    sharedBevelJoinGeometryBuffer,
                    enumMetadata,
                    waveformPrograms,
                    channel,
                    row,
                    expandedEnumResources,
                    0,
                );
                enumRenderObjects.set(channel, enumRenderObject);
                
                // Mode switching render object - decides when to enter/exit expanded mode
                row.mainArea.addChild({
                    zIndex: -1,
                    render: (ctx: RenderContext, bounds: RenderBounds) => {
                        if (metadata.renderMode !== RenderMode.Enum && metadata.renderMode !== RenderMode.ExpandedEnum) {
                            expandedState.progress = 0;
                            expandedState.wasExpanded = false;
                            enumRenderObject.expandedModeProgress = 0;
                            return false;
                        }
                        
                        // ExpandedEnum always expands, Enum uses heuristic
                        const shouldBeExpanded = metadata.renderMode === RenderMode.ExpandedEnum ||
                            (config.enumExpansionEnabled && shouldUseExpandedMode(channel, ctx, bounds, expandedState.wasExpanded, config.minExpandedWidth, buffer.runs));
                        
                        const targetProgress = shouldBeExpanded ? 1 : 0;
                        expandedState.wasExpanded = shouldBeExpanded;
                        
                        const lerped = expandedState.progress + (targetProgress - expandedState.progress) * animationLerpFactor;
                        expandedState.progress = Math.abs(lerped - targetProgress) < 0.01 ? targetProgress : lerped;
                        
                        enumRenderObject.expandedModeProgress = expandedState.progress;
                        return expandedState.progress !== targetProgress;
                    }
                });

                const dotOverlayMetadata = new Proxy(metadata, {
                    get: (target, prop) => {
                        if (prop === 'renderMode') {
                            return [RenderMode.Lines, RenderMode.Discrete].includes(target.renderMode) ? RenderMode.Dots : RenderMode.Off;
                        }
                        return target[prop as keyof typeof target];
                    }
                });
                // Create a WaveformRenderObject for rendering the dots
                new WaveformRenderObject(
                    row.mainArea,
                    context.webgl.gl,
                    config,
                    buffer.dots,
                    sharedInstanceGeometryBuffer,
                    sharedBevelJoinGeometryBuffer,
                    dotOverlayMetadata,
                    waveformPrograms,
                    channel,
                    row,
                    null, // No expanded enum resources for dot overlay
                    2 // Higher zIndex to render on top
                );
            }

            // Add a single hover overlay for the entire row
            if (rowSignals.length > 0) {
                waveformOverlays.set(
                    row,
                    new WaveformRowHoverOverlayRenderObject(
                        row.mainArea,
                        context,
                        config,
                        row,
                        rowSignals,
                        buffers,
                        sharedInstanceGeometryBuffer,
                        sharedBevelJoinGeometryBuffer,
                        waveformPrograms,
                        enumRenderObjects,
                        expandedEnumResources
                    ));
            }
        }

        for (const row of event.removed) {
            const overlay = waveformOverlays.get(row);
            if (overlay) {
                overlay.dispose();
                waveformOverlays.delete(row);
            }
        }

        const activeSignals = new Set<Signal>();
        for (const row of context.getRows()) {
            for (const signal of row.signals) {
                activeSignals.add(signal);
            }
        }
        
        for (const [signal, bufferData] of buffers.entries()) {
            if (!activeSignals.has(signal)) {
                context.webgl.gl.deleteBuffer(bufferData.timeHighBuffer);
                context.webgl.gl.deleteBuffer(bufferData.timeLowBuffer);
                context.webgl.gl.deleteBuffer(bufferData.valueBuffer);
                context.webgl.gl.deleteBuffer(bufferData.blocks.buffer);
                buffers.delete(signal);
            }
        }

    });
};

function lowerBound(time: Float64Array, length: number, t: number): number {
    let lo = 0;
    let hi = length;
    while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (time[mid] < t) lo = mid + 1;
        else hi = mid;
    }
    return lo;
}

function pointsBetween(geometry: LodGeometry, start: number, end: number): number {
    return lowerBound(geometry.time, geometry.length, end) - lowerBound(geometry.time, geometry.length, start);
}

function shouldUseExpandedMode(
    signal: Signal,
    context: RenderContext,
    bounds: RenderBounds,
    wasExpanded: boolean,
    minExpandedWidth: number,
    runs: EnumRuns,
): boolean {
    const { state } = context;
    const startTime = state.offset / state.pxPerSecond;
    const endTime = (state.offset + bounds.width) / state.pxPerSecond;

    const maxTransitionsForExpansion = Math.floor(bounds.width / minExpandedWidth);
    const maxTransitionsHysteresis = 5;
    const maxPossibleThreshold = maxTransitionsForExpansion + maxTransitionsHysteresis;

    const nullValue = signal.null ?? null;

    const [visibleRunStart, visibleRunEnd] = runs.visibleRange(startTime, endTime);

    let visibleTransitions = 0;
    let hasNarrowSegment = false;

    for (let run = visibleRunStart; run <= visibleRunEnd; run++) {
        const segmentWidth = (runs.end(run) - runs.start(run)) * state.pxPerSecond;
        const isNullSegment = nullValue !== null && runs.value(run) === nullValue;

        if (!isNullSegment && segmentWidth < minExpandedWidth) {
            hasNarrowSegment = true;
        }

        // Changes hidden inside a run count too. If they aren't known (NaN), the run could hide any number.
        visibleTransitions += 1 + runs.hidden(run);
        if (!(visibleTransitions <= maxPossibleThreshold)) {
            return false;
        }
    }

    const threshold = wasExpanded ? maxPossibleThreshold : maxTransitionsForExpansion;
    return visibleTransitions <= threshold && hasNarrowSegment;
}
