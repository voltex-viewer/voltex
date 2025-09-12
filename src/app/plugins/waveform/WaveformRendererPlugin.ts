import type { PluginContext, Row } from '../../Plugin';
import type { Signal, Sequence } from '../../Signal';
import { WaveformConfigSchema } from './WaveformConfig';
import { WaveformRenderObject } from './WaveformRenderObject';
import { WaveformRowHoverOverlayRenderObject } from './WaveformRowHoverOverlayRenderObject';
import { WaveformTooltipRenderObject } from './WaveformTooltipRenderObject';
import { WaveformShaders } from './WaveformShaders';

export interface SequenceBufferData {
    buffer: WebGLBuffer;
    lastDataLength: number;
    updateIndex: number;
    pointCount: number;
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

    const sequenceBuffers = new Map<Sequence, SequenceBufferData>();
    
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

        for (const [sequence, bufferData] of sequenceBuffers.entries()) {
            const renderTime = performance.now() - frameStartTime;
            if (renderTime >= availableTime) {
                anyBufferNeedsUpdate = true;
                break;
            }

            const gl = context.webgl.gl;
            const seqLen = sequence.length;
            
            if (bufferData.lastDataLength !== seqLen) {
                // Allocate buffer for sequence data
                gl.bindBuffer(gl.ARRAY_BUFFER, bufferData.buffer);
                gl.bufferData(gl.ARRAY_BUFFER, seqLen * 4, gl.DYNAMIC_DRAW);
                
                bufferData.lastDataLength = seqLen;
                bufferData.updateIndex = 0;
                bufferData.pointCount = seqLen;
            }
            
            if (bufferData.updateIndex < seqLen) {
                const remainingTime = availableTime - (performance.now() - frameStartTime);
                if (remainingTime <= 0) {
                    anyBufferNeedsUpdate = true;
                    break;
                }
                
                // Estimate how many points we can process in remaining time
                const pointsPerMs = adaptiveChunkSize / Math.max(1, frameRenderTime || 5);
                const maxPointsThisFrame = Math.min(
                    seqLen - bufferData.updateIndex,
                    Math.max(100, Math.floor(pointsPerMs * remainingTime))
                );
                
                const endIndex = Math.min(bufferData.updateIndex + maxPointsThisFrame, seqLen);
                const dataBuffer = new Float32Array(endIndex - bufferData.updateIndex);

                for (let i = 0, j = bufferData.updateIndex; j < endIndex; i++, j++) {
                    dataBuffer[i] = sequence.valueAt(j);
                }

                // Upload sequence data
                gl.bindBuffer(gl.ARRAY_BUFFER, bufferData.buffer);
                gl.bufferSubData(gl.ARRAY_BUFFER, bufferData.updateIndex * 4, dataBuffer);
                
                bufferData.updateIndex = endIndex;
                
                if (bufferData.updateIndex < seqLen) {
                    anyBufferNeedsUpdate = true;
                }
            }
        }
        return anyBufferNeedsUpdate;
    });
    
    context.onRowsChanged((event) => {
        for (const row of event.added) {
            const rowSignals: Signal[] = [];
            const rowSignalBuffers = new Map<Signal, { timeBuffer: SequenceBufferData, valueBuffer: SequenceBufferData }>();
            
            for (const channel of row.signals) {
                // Create buffers
                for (const sequence of [channel.time, channel.values]) {
                    if (!sequenceBuffers.has(sequence)) {
                        const buffer = context.webgl.gl.createBuffer();
                        if (!buffer) {
                            throw new Error('Failed to create WebGL buffer for sequence');
                        }
                        sequenceBuffers.set(sequence, {
                            buffer,
                            lastDataLength: 0,
                            updateIndex: 0,
                            pointCount: 0
                        });
                    }
                }
                
                const timeBufferData = sequenceBuffers.get(channel.time)!;
                const valueBufferData = sequenceBuffers.get(channel.values)!;
                rowSignals.push(channel);
                rowSignalBuffers.set(channel, { timeBuffer: timeBufferData, valueBuffer: valueBufferData });
                
                row.addRenderObject(new WaveformRenderObject(
                    config,
                    timeBufferData,
                    valueBufferData,
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
                    rowSignalBuffers,
                    sharedInstanceGeometryBuffer,
                    sharedBevelJoinGeometryBuffer,
                    instancingExt,
                    waveformPrograms,
                    99
                ));
            }
        }

        const activeSequences = new Set<Sequence>();
        for (const row of context.getRows()) {
            for (const signal of row.signals) {
                activeSequences.add(signal.time);
                activeSequences.add(signal.values);
            }
        }
        
        for (const [sequence, bufferData] of sequenceBuffers.entries()) {
            if (!activeSequences.has(sequence)) {
                context.webgl.gl.deleteBuffer(bufferData.buffer);
                sequenceBuffers.delete(sequence);
            }
        }
    });
};
