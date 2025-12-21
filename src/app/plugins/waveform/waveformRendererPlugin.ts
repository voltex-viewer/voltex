import { RenderMode, type PluginContext, type Row, type Signal } from '@voltex-viewer/plugin-api';
import { waveformConfigSchema } from './waveformConfig';
import { WaveformRenderObject } from './waveformRenderObject';
import { WaveformRowHoverOverlayRenderObject } from './waveformRowHoverOverlayRenderObject';
import { WaveformTooltipRenderObject } from './waveformTooltipRenderObject';
import { WaveformShaders } from './waveformShaders';
import { createGradientDownsampler } from './downsamplers/gradientDownsampler';
import { createEnumDownsampler } from './downsamplers/enumDownsampler';
import type { Downsampler } from './downsamplers/types';
import { createRawDownsampler } from './downsamplers/rawDownsampler';

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
    const waveformPrograms = new WaveformShaders(context.webgl.utils);

    const config = context.loadConfig(
        waveformConfigSchema,
        {
            dotSize: 4.0,
            lineWidth: 1.5,
            dotVisibilityThreshold: 200,
            targetFps: 120,
            formatTooltip: "name[name.length - 1] + ': ' + (typeof(display) === 'string' ? display : value.toFixed(Math.min(6, Math.max(0, Math.ceil(Math.log10(Math.abs(yScale)) + 2)))))",
            hoverEnabled: true,
            downsamplingMode: 'lossless' as const,
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
                new WaveformRenderObject(
                    row.mainArea,
                    config,
                    buffer,
                    sharedInstanceGeometryBuffer,
                    sharedBevelJoinGeometryBuffer,
                    metadata,
                    waveformPrograms,
                    channel,
                    row,
                    0,
                );

                // Add the text renderer to the enum signals
                const enumTextMetadata = new Proxy(metadata, {
                    get: (target, prop) => {
                        if (prop === 'renderMode') {
                            return target.renderMode === RenderMode.Enum ? RenderMode.Text : RenderMode.Off;
                        }
                        return target[prop as keyof typeof target];
                    }
                });
                new WaveformRenderObject(
                    row.mainArea,
                    config,
                    buffer,
                    sharedInstanceGeometryBuffer,
                    sharedBevelJoinGeometryBuffer,
                    enumTextMetadata,
                    waveformPrograms,
                    channel,
                    row,
                    100,
                );

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
                    config,
                    dotRenderBuffer,
                    sharedInstanceGeometryBuffer,
                    sharedBevelJoinGeometryBuffer,
                    dotOverlayMetadata,
                    waveformPrograms,
                    channel,
                    row,
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
                        waveformPrograms
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
