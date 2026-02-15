import { RenderMode, type PluginContext, type RenderBounds, type RenderContext, type Row, type Signal } from '@voltex-viewer/plugin-api';
import { waveformConfigSchema } from './waveformConfig';
import { WaveformRenderObject } from './waveformRenderObject';
import { WaveformRowHoverOverlayRenderObject } from './waveformRowHoverOverlayRenderObject';
import { WaveformTooltipRenderObject } from './waveformTooltipRenderObject';
import { WaveformShaders } from './waveformShaders';
import { createGradientDownsampler } from './downsamplers/gradientDownsampler';
import { createEnumDownsampler } from './downsamplers/enumDownsampler';
import type { Downsampler } from './downsamplers/types';
import { createRawDownsampler } from './downsamplers/rawDownsampler';
import {
    binarySearchTimeIndex,
    animationLerpFactor,
    ExpandedEnumResources,
} from './expandedEnum';

export interface BufferData {
    timeHighBuffer: WebGLBuffer;
    timeLowBuffer: WebGLBuffer;
    valueBuffer: WebGLBuffer;
    downsamplingMode: string;
    bufferCapacity: number;
    bufferLength: number;
}

interface SignalBufferData extends BufferData {
    generator: Downsampler;
    overwriteNext: boolean;
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
            formatTooltip: "name[name.length - 1] + ': ' + (typeof(display) === 'string' ? display : value.toFixed(Math.min(6, Math.max(0, Math.ceil(Math.log10(Math.abs(yScale)) + 2))))) + units",
            hoverEnabled: true,
            downsamplingMode: 'lossless' as const,
            enumExpansionEnabled: true,
            minExpandedWidth: 50,
        });

    // Create a single global tooltip render object
    const waveformOverlays: Map<Row, WaveformRowHoverOverlayRenderObject> = new Map();
    new WaveformTooltipRenderObject(context.rootRenderObject, config, waveformOverlays);

    const buffers = new Map<Signal, SignalBufferData>();
    const dotOverlayBuffers = new Map<Signal, BufferData>();
    
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

    const maxPoints = 4096;

    type DownsamplingMode = typeof config.downsamplingMode | 'enum';

    const downsamplerFactories: Record<DownsamplingMode, (signal: Signal) => Downsampler> = {
        off: (signal) => createRawDownsampler(signal, maxPoints),
        aggressive: (signal) => createGradientDownsampler(signal, 1, maxPoints),
        normal: (signal) => createGradientDownsampler(signal, 0.1, maxPoints),
        lossless: (signal) => createGradientDownsampler(signal, 0, maxPoints),
        enum: (signal) => createEnumDownsampler(signal, maxPoints),
    };

    let currentDownsamplingMode = config.downsamplingMode;

    context.onBeforeRender(() => {
        frameStartTime = performance.now();
        
        // Check if downsampling mode changed and recreate generators
        if (currentDownsamplingMode !== config.downsamplingMode) {
            currentDownsamplingMode = config.downsamplingMode;
            for (const [signal, bufferData] of buffers.entries()) {
                const metadata = context.signalMetadata.get(signal);
                const mode: DownsamplingMode = metadata.renderMode === RenderMode.Enum ? 'enum' : config.downsamplingMode;
                bufferData.downsamplingMode = mode;
                bufferData.generator = downsamplerFactories[mode](signal);
                bufferData.bufferLength = 0;
                bufferData.overwriteNext = false;
            }
        }
        
        // Adapt chunk size based on previous frame performance
        const targetFrameTime = 1000 / config.targetFps; // Convert FPS to milliseconds
        
        let anyBufferNeedsUpdate = false;
        const availableTime = Math.max(1, targetFrameTime - frameTimeOverhead);

        for (const [signal, bufferData] of buffers.entries()) {
            const remainingTime = availableTime - (performance.now() - frameStartTime);
            if (remainingTime <= 0) {
                anyBufferNeedsUpdate = true;
                break;
            }

            const gl = context.webgl.gl as WebGL2RenderingContext;
            const seqLen = Math.min(signal.time.length, signal.values.length);
            
            if (bufferData.bufferCapacity < seqLen) {
                // Power-of-two growth strategy
                const newCapacity = Math.max(256, 1 << Math.ceil(Math.log2(seqLen)));
                
                // Create new buffers
                const newTimeHighBuffer = gl.createBuffer()!;
                const newTimeLowBuffer = gl.createBuffer()!;
                const newValueBuffer = gl.createBuffer()!;
                
                // Allocate new buffers
                gl.bindBuffer(gl.ARRAY_BUFFER, newTimeHighBuffer);
                gl.bufferData(gl.ARRAY_BUFFER, newCapacity * 4, gl.DYNAMIC_DRAW);
                gl.bindBuffer(gl.ARRAY_BUFFER, newTimeLowBuffer);
                gl.bufferData(gl.ARRAY_BUFFER, newCapacity * 4, gl.DYNAMIC_DRAW);
                gl.bindBuffer(gl.ARRAY_BUFFER, newValueBuffer);
                gl.bufferData(gl.ARRAY_BUFFER, newCapacity * 4, gl.DYNAMIC_DRAW);
                
                // Copy existing data on GPU if there's any
                if (bufferData.bufferLength > 0) {
                    gl.bindBuffer(gl.COPY_READ_BUFFER, bufferData.timeHighBuffer);
                    gl.bindBuffer(gl.COPY_WRITE_BUFFER, newTimeHighBuffer);
                    gl.copyBufferSubData(gl.COPY_READ_BUFFER, gl.COPY_WRITE_BUFFER, 0, 0, bufferData.bufferLength * 4);

                    gl.bindBuffer(gl.COPY_READ_BUFFER, bufferData.timeLowBuffer);
                    gl.bindBuffer(gl.COPY_WRITE_BUFFER, newTimeLowBuffer);
                    gl.copyBufferSubData(gl.COPY_READ_BUFFER, gl.COPY_WRITE_BUFFER, 0, 0, bufferData.bufferLength * 4);
                    
                    gl.bindBuffer(gl.COPY_READ_BUFFER, bufferData.valueBuffer);
                    gl.bindBuffer(gl.COPY_WRITE_BUFFER, newValueBuffer);
                    gl.copyBufferSubData(gl.COPY_READ_BUFFER, gl.COPY_WRITE_BUFFER, 0, 0, bufferData.bufferLength * 4);
                }
                
                // Delete old buffers and swap
                gl.deleteBuffer(bufferData.timeHighBuffer);
                gl.deleteBuffer(bufferData.timeLowBuffer);
                gl.deleteBuffer(bufferData.valueBuffer);
                bufferData.timeHighBuffer = newTimeHighBuffer;
                bufferData.timeLowBuffer = newTimeLowBuffer;
                bufferData.valueBuffer = newValueBuffer;
                bufferData.bufferCapacity = newCapacity;
            }

            const result = bufferData.generator.next();
            if (result.done) throw new Error('Downsampler generator unexpectedly returned');
            
            const { hasMore, overwriteNext } = result.value;
            const bufferOffset = bufferData.generator.buffer.length;

            if (bufferData.overwriteNext && bufferOffset > 0 && bufferData.bufferLength > 0) {
                bufferData.bufferLength--;
            }

            // Upload new data
            gl.bindBuffer(gl.ARRAY_BUFFER, bufferData.timeHighBuffer);
            gl.bufferSubData(gl.ARRAY_BUFFER, bufferData.bufferLength * 4, bufferData.generator.buffer.timeHighBuffer.subarray(0, bufferOffset));
            gl.bindBuffer(gl.ARRAY_BUFFER, bufferData.timeLowBuffer);
            gl.bufferSubData(gl.ARRAY_BUFFER, bufferData.bufferLength * 4, bufferData.generator.buffer.timeLowBuffer.subarray(0, bufferOffset));
            gl.bindBuffer(gl.ARRAY_BUFFER, bufferData.valueBuffer);
            gl.bufferSubData(gl.ARRAY_BUFFER, bufferData.bufferLength * 4, bufferData.generator.buffer.valueBuffer.subarray(0, bufferOffset));
            bufferData.bufferLength += bufferOffset;
            
            if (bufferOffset > 0) {
                bufferData.overwriteNext = overwriteNext ?? false;
            }

            if (hasMore) {
                anyBufferNeedsUpdate = true;
            }
        }
        return anyBufferNeedsUpdate;
    });

    // Add a render callback that updates the dot buffer and conditionally renders
    context.rootRenderObject.addChild({
        zIndex: -100,
        render: (renderContext, bounds) => {
            const { state } = renderContext;
            
            for (const [channel, dotRenderBuffer] of dotOverlayBuffers.entries()) {
                // Calculate visible time range
                const viewStartTime = state.offset / state.pxPerSecond;
                const viewEndTime = (state.offset + bounds.width) / state.pxPerSecond;
                
                // Binary search for visible point range
                let startIdx = 0;
                let endIdx = channel.time.length - 1;
                
                // Find first visible point
                let left = 0, right = channel.time.length - 1;
                while (left <= right) {
                    const mid = Math.floor((left + right) / 2);
                    const time = channel.time.valueAt(mid);
                    if (time < viewStartTime) {
                        left = mid + 1;
                    } else {
                        startIdx = mid;
                        right = mid - 1;
                    }
                }
                
                // Find last visible point
                left = startIdx;
                right = channel.time.length - 1;
                while (left <= right) {
                    const mid = Math.floor((left + right) / 2);
                    const time = channel.time.valueAt(mid);
                    if (time <= viewEndTime) {
                        endIdx = mid;
                        left = mid + 1;
                    } else {
                        right = mid - 1;
                    }
                }
                
                const visibleCount = endIdx - startIdx + 1;
                
                const pointVisibilityThreshold = config.dotVisibilityThreshold;
                if (visibleCount > pointVisibilityThreshold || visibleCount <= 0) {
                    dotRenderBuffer.bufferLength = 0;
                    continue;
                }
                
                // Allocate buffer if needed
                if (dotRenderBuffer.bufferCapacity < pointVisibilityThreshold) {
                    const gl = context.webgl.gl;
                    gl.bindBuffer(gl.ARRAY_BUFFER, dotRenderBuffer.timeHighBuffer);
                    gl.bufferData(gl.ARRAY_BUFFER, pointVisibilityThreshold * 4, gl.DYNAMIC_DRAW);
                    gl.bindBuffer(gl.ARRAY_BUFFER, dotRenderBuffer.timeLowBuffer);
                    gl.bufferData(gl.ARRAY_BUFFER, pointVisibilityThreshold * 4, gl.DYNAMIC_DRAW);
                    gl.bindBuffer(gl.ARRAY_BUFFER, dotRenderBuffer.valueBuffer);
                    gl.bufferData(gl.ARRAY_BUFFER, pointVisibilityThreshold * 4, gl.DYNAMIC_DRAW);
                    dotRenderBuffer.bufferCapacity = pointVisibilityThreshold;
                }
                
                // Copy visible points to dot buffer
                const dotTimeHighArr = new Float32Array(visibleCount);
                const dotTimeLowArr = new Float32Array(visibleCount);
                const dotValueArr = new Float32Array(visibleCount);
                for (let i = 0; i < visibleCount; i++) {
                    const time = channel.time.valueAt(startIdx + i);
                    const high = Math.fround(time);
                    dotTimeHighArr[i] = high;
                    dotTimeLowArr[i] = time - high;
                    dotValueArr[i] = channel.values.valueAt(startIdx + i);
                }
                
                const gl = context.webgl.gl;
                gl.bindBuffer(gl.ARRAY_BUFFER, dotRenderBuffer.timeHighBuffer);
                gl.bufferSubData(gl.ARRAY_BUFFER, 0, dotTimeHighArr);
                gl.bindBuffer(gl.ARRAY_BUFFER, dotRenderBuffer.timeLowBuffer);
                gl.bufferSubData(gl.ARRAY_BUFFER, 0, dotTimeLowArr);
                gl.bindBuffer(gl.ARRAY_BUFFER, dotRenderBuffer.valueBuffer);
                gl.bufferSubData(gl.ARRAY_BUFFER, 0, dotValueArr);
                
                dotRenderBuffer.bufferLength = visibleCount;
            }
            
            return false;
        }
    });
    
    context.onRowsChanged((event) => {
        for (const row of event.added) {
            const rowSignals: Signal[] = [];
            const enumRenderObjects = new Map<Signal, WaveformRenderObject>();
            
            for (const channel of row.signals) {
                // Create buffers
                if (!buffers.has(channel)) {
                    const timeHighBuffer = context.webgl.gl.createBuffer();
                    if (!timeHighBuffer) {
                        throw new Error('Failed to create WebGL buffer for sequence');
                    }
                    const timeLowBuffer = context.webgl.gl.createBuffer();
                    if (!timeLowBuffer) {
                        throw new Error('Failed to create WebGL buffer for sequence');
                    }
                    const valueBuffer = context.webgl.gl.createBuffer();
                    if (!valueBuffer) {
                        throw new Error('Failed to create WebGL buffer for sequence');
                    }
                    const metadata = context.signalMetadata.get(channel);
                    const downsamplingMode: DownsamplingMode = metadata.renderMode === RenderMode.Enum ? 'enum' : config.downsamplingMode;
                    buffers.set(channel, {
                        timeHighBuffer,
                        timeLowBuffer,
                        valueBuffer,
                        downsamplingMode,
                        bufferCapacity: 0,
                        bufferLength: 0,
                        generator: downsamplerFactories[downsamplingMode](channel),
                        overwriteNext: false,
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
                            (config.enumExpansionEnabled && shouldUseExpandedMode(channel, ctx, bounds, expandedState.wasExpanded, config.minExpandedWidth));
                        
                        const targetProgress = shouldBeExpanded ? 1 : 0;
                        expandedState.wasExpanded = shouldBeExpanded;
                        
                        const lerped = expandedState.progress + (targetProgress - expandedState.progress) * animationLerpFactor;
                        expandedState.progress = Math.abs(lerped - targetProgress) < 0.01 ? targetProgress : lerped;
                        
                        enumRenderObject.expandedModeProgress = expandedState.progress;
                        return expandedState.progress !== targetProgress;
                    }
                });

                // Create dot overlay buffers
                const dotTimeHighBuffer = context.webgl.gl.createBuffer();
                const dotTimeLowBuffer = context.webgl.gl.createBuffer();
                const dotValueBuffer = context.webgl.gl.createBuffer();
                if (!dotTimeHighBuffer || !dotTimeLowBuffer || !dotValueBuffer) {
                    throw new Error('Failed to create WebGL buffers for dot overlay');
                }
                
                // Create BufferData wrapper for the dot render object
                const dotRenderBuffer: BufferData = {
                    timeHighBuffer: dotTimeHighBuffer,
                    timeLowBuffer: dotTimeLowBuffer,
                    valueBuffer: dotValueBuffer,
                    downsamplingMode: 'off',
                    bufferCapacity: 0,
                    bufferLength: 0,
                };
                dotOverlayBuffers.set(channel, dotRenderBuffer);
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
                    dotRenderBuffer,
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
                buffers.delete(signal);
            }
        }
        
        for (const [signal, dotBufferData] of dotOverlayBuffers.entries()) {
            if (!activeSignals.has(signal)) {
                context.webgl.gl.deleteBuffer(dotBufferData.timeHighBuffer);
                context.webgl.gl.deleteBuffer(dotBufferData.timeLowBuffer);
                context.webgl.gl.deleteBuffer(dotBufferData.valueBuffer);
                dotOverlayBuffers.delete(signal);
            }
        }
    });
};

function shouldUseExpandedMode(
    signal: Signal,
    context: RenderContext,
    bounds: RenderBounds,
    wasExpanded: boolean,
    minExpandedWidth: number
): boolean {
    const { state } = context;
    const startTime = state.offset / state.pxPerSecond;
    const endTime = (state.offset + bounds.width) / state.pxPerSecond;

    const maxUpdateIndex = Math.min(signal.time.length, signal.values.length);

    const startIndex = binarySearchTimeIndex(signal, startTime, 0, maxUpdateIndex - 1, true);
    const endIndex = binarySearchTimeIndex(signal, endTime, startIndex, maxUpdateIndex - 1, false);

    const maxTransitionsForExpansion = Math.floor(bounds.width / minExpandedWidth);
    const maxTransitionsHysteresis = 5;
    const maxPossibleThreshold = maxTransitionsForExpansion + maxTransitionsHysteresis;

    const nullValue = "null" in signal.values ? signal.values.null : null;
    let visibleTransitions = 1;
    let hasNarrowSegment = false;
    let segmentStartTime = signal.time.valueAt(startIndex);
    let segmentValue = signal.values.valueAt(startIndex);

    for (let i = startIndex + 1; i <= maxUpdateIndex && i <= endIndex + 1; i++) {
        const isAtEnd = i >= maxUpdateIndex;
        const val = isAtEnd ? null : signal.values.valueAt(i);
        const isValueChange = val !== segmentValue;
        const isPastViewport = i > endIndex;

        if (isValueChange || isPastViewport) {
            const segmentEndTime = isAtEnd ? segmentStartTime : signal.time.valueAt(i);
            const segmentWidth = (segmentEndTime - segmentStartTime) * state.pxPerSecond;
            const isNullSegment = nullValue !== null && segmentValue === nullValue;
            if (!isNullSegment && segmentWidth < minExpandedWidth) {
                hasNarrowSegment = true;
            }

            if (isValueChange && !isAtEnd) {
                visibleTransitions++;
                if (visibleTransitions > maxPossibleThreshold) {
                    return false;
                }
                segmentValue = val!;
                segmentStartTime = segmentEndTime;
            }
        }
    }

    const threshold = wasExpanded ? maxPossibleThreshold : maxTransitionsForExpansion;
    return visibleTransitions <= threshold && hasNarrowSegment;
}
