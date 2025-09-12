import type { PluginContext, Row } from '../../Plugin';
import type { Signal, Sequence } from '../../Signal';
import { WaveformConfigSchema } from './WaveformConfig';
import { WaveformRenderObject } from './WaveformRenderObject';
import { WaveformRowHoverOverlayRenderObject } from './WaveformRowHoverOverlayRenderObject';
import { WaveformTooltipRenderObject } from './WaveformTooltipRenderObject';
import { WaveformShaders } from './WaveformShaders';

export interface BufferData {
    timeBuffer: WebGLBuffer;
    valueBuffer: WebGLBuffer;
    bufferCapacity: number;
    bufferLength: number;
    signalIndex: number;
}

export default (context: PluginContext): void => {
    const waveformPrograms = new WaveformShaders(context.webgl.utils);

    // Initialize instancing extension once
    const instancingExt = context.webgl.gl.getExtension('ANGLE_instanced_arrays');
    if (!instancingExt) {
        throw new Error('ANGLE_instanced_arrays extension is not supported - instanced line rendering will not be available');
    }

    const config = context.loadConfig(
        WaveformConfigSchema,
        {
            dotSize: 6.0,
            lineWidth: 1.5,
            targetFps: 120,
            formatTooltip: "name[name.length - 1] + ': ' + (typeof(display) === 'string' ? display : (valueTable.get(value) ?? value.toFixed(Math.min(6, Math.max(0, Math.ceil(Math.log10(Math.abs(yScale)) + 2))))))",
            hoverEnabled: true,
        });


    // Create a single global tooltip render object
    const tooltipRenderObject = new WaveformTooltipRenderObject(config);
    context.addRootRenderObject(tooltipRenderObject);

    const buffers = new Map<Signal, BufferData>();
    
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
    let adaptiveChunkSize = 1000;

    const maxPoints = 4096;
    const timeBuffer = new Float32Array(maxPoints);
    const valueBuffer = new Float32Array(maxPoints);

    context.onBeforeRender(() => {
        frameStartTime = performance.now();
        
        // Adapt chunk size based on previous frame performance
        const targetFrameTime = 1000 / config.targetFps; // Convert FPS to milliseconds
        const frameRenderTime = context.renderProfiler.getFilteredFrameRenderTime();
        if (frameRenderTime > 0) { // Only adjust after we have some frame time data
            if (frameRenderTime > targetFrameTime) {
                adaptiveChunkSize = Math.max(100, adaptiveChunkSize * 0.8);
            } else if (frameRenderTime < targetFrameTime * 0.7) {
                adaptiveChunkSize = Math.min(10000, adaptiveChunkSize * 1.1);
            }
        }
        
        let anyBufferNeedsUpdate = false;
        const availableTime = Math.max(1, targetFrameTime - frameTimeOverhead);

        for (const [sequence, bufferData] of buffers.entries()) {
            const remainingTime = availableTime - (performance.now() - frameStartTime);
            if (remainingTime <= 0) {
                anyBufferNeedsUpdate = true;
                break;
            }

            const gl = context.webgl.gl;
            const seqLen = Math.min(sequence.time.length, sequence.values.length);
            
            if (bufferData.bufferCapacity !== seqLen) {
                // Allocate buffer for sequence data
                gl.bindBuffer(gl.ARRAY_BUFFER, bufferData.timeBuffer);
                gl.bufferData(gl.ARRAY_BUFFER, seqLen * 4, gl.DYNAMIC_DRAW);

                gl.bindBuffer(gl.ARRAY_BUFFER, bufferData.valueBuffer);
                gl.bufferData(gl.ARRAY_BUFFER, seqLen * 4, gl.DYNAMIC_DRAW);
                
                bufferData.bufferCapacity = seqLen;
                bufferData.bufferLength = 0;
                bufferData.signalIndex = 0;
            }
            
            if (bufferData.signalIndex < seqLen) {
                let bufferOffset = 0;
                let lastTime = sequence.time.valueAt(bufferData.signalIndex);
                let lastValue = sequence.values.valueAt(bufferData.signalIndex);
                timeBuffer[0] = lastTime;
                valueBuffer[0] = lastValue;
                let lastGradient = Infinity;
                let signalIndex;
                for (signalIndex = bufferData.signalIndex + 1; bufferOffset < maxPoints && signalIndex < seqLen; signalIndex++) {
                    const time = sequence.time.valueAt(signalIndex);
                    const value = sequence.values.valueAt(signalIndex);
                    let gradient = (value - lastValue) / (time - lastTime);
                    if (Math.abs(gradient - lastGradient) > 1) {
                        // The gradient has changed significantly, add a new point
                        bufferOffset++;
                        timeBuffer[bufferOffset] = time;
                        valueBuffer[bufferOffset] = value;
                        lastGradient = gradient;
                    } else {
                        // If the gradient hasn't changed much, overwrite the last point
                        timeBuffer[bufferOffset] = time;
                        valueBuffer[bufferOffset] = value;
                    }
                    lastTime = time;
                    lastValue = value;
                }

                // Upload sequence data
                gl.bindBuffer(gl.ARRAY_BUFFER, bufferData.timeBuffer);
                gl.bufferSubData(gl.ARRAY_BUFFER, bufferData.bufferLength * 4, timeBuffer.subarray(0, bufferOffset));
                gl.bindBuffer(gl.ARRAY_BUFFER, bufferData.valueBuffer);
                gl.bufferSubData(gl.ARRAY_BUFFER, bufferData.bufferLength * 4, valueBuffer.subarray(0, bufferOffset));
                bufferData.bufferLength += bufferOffset;

                bufferData.signalIndex = signalIndex;
                
                if (bufferData.signalIndex < seqLen) {
                    anyBufferNeedsUpdate = true;
                }
            }
        }
        return anyBufferNeedsUpdate;
    });
    
    context.onRowsChanged((event) => {
        for (const row of event.added) {
            const rowSignals: Signal[] = [];
            
            for (const channel of row.signals) {
                // Create buffers
                if (!buffers.has(channel)) {
                    const timeBuffer = context.webgl.gl.createBuffer();
                    if (!timeBuffer) {
                        throw new Error('Failed to create WebGL buffer for sequence');
                    }
                    const valueBuffer = context.webgl.gl.createBuffer();
                    if (!valueBuffer) {
                        throw new Error('Failed to create WebGL buffer for sequence');
                    }
                    buffers.set(channel, {
                        timeBuffer,
                        valueBuffer,
                        bufferCapacity: 0,
                        bufferLength: 0,
                        signalIndex: 0,
                    });
                }
                
                rowSignals.push(channel);
                
                row.addRenderObject(new WaveformRenderObject(
                    config,
                    buffers.get(channel)!,
                    sharedInstanceGeometryBuffer,
                    sharedBevelJoinGeometryBuffer,
                    instancingExt,
                    context.signalMetadata.getColor(channel),
                    waveformPrograms,
                    channel,
                    row,
                ));
            }

            // Add a single hover overlay for the entire row
            if (rowSignals.length > 0) {
                row.addRenderObject(new WaveformRowHoverOverlayRenderObject(
                    context,
                    config,
                    row,
                    tooltipRenderObject,
                    rowSignals,
                    buffers,
                    sharedInstanceGeometryBuffer,
                    sharedBevelJoinGeometryBuffer,
                    instancingExt,
                    waveformPrograms,
                    99
                ));
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
                context.webgl.gl.deleteBuffer(bufferData.timeBuffer);
                context.webgl.gl.deleteBuffer(bufferData.valueBuffer);
                buffers.delete(signal);
            }
        }
    });
};
