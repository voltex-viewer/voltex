import type { PluginContext, Row } from '../../Plugin';
import type { Signal } from '../../Signal';
import { WaveformConfigSchema } from './WaveformConfig';
import { WaveformRenderObject } from './WaveformRenderObject';
import { WaveformRowHoverOverlayRenderObject } from './WaveformRowHoverOverlayRenderObject';
import { WaveformTooltipRenderObject } from './WaveformTooltipRenderObject';
import { WaveformShaders } from './WaveformShaders';

export interface ChannelBufferData {
    timeBuffer: WebGLBuffer;
    valueBuffer: WebGLBuffer;
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

    const channelBuffers = new Map<Signal, ChannelBufferData>();
    
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

        for (const [channel, bufferData] of channelBuffers.entries()) {
            const renderTime = performance.now() - frameStartTime;
            if (renderTime >= availableTime) {
                anyBufferNeedsUpdate = true;
                break;
            }

            const gl = context.webgl.gl;
            const sigLen = channel.length;
            
            if (bufferData.lastDataLength !== sigLen) {
                // Allocate separate buffers for time and value data
                gl.bindBuffer(gl.ARRAY_BUFFER, bufferData.timeBuffer);
                gl.bufferData(gl.ARRAY_BUFFER, sigLen * 4, gl.DYNAMIC_DRAW);
                
                gl.bindBuffer(gl.ARRAY_BUFFER, bufferData.valueBuffer);
                gl.bufferData(gl.ARRAY_BUFFER, sigLen * 4, gl.DYNAMIC_DRAW);
                
                bufferData.lastDataLength = sigLen;
                bufferData.updateIndex = 0;
                bufferData.pointCount = sigLen;
            }
            
            if (bufferData.updateIndex < sigLen) {
                const remainingTime = availableTime - (performance.now() - frameStartTime);
                if (remainingTime <= 0) {
                    anyBufferNeedsUpdate = true;
                    break;
                }
                
                // Estimate how many points we can process in remaining time
                const pointsPerMs = adaptiveChunkSize / Math.max(1, frameRenderTime || 5);
                const maxPointsThisFrame = Math.min(
                    sigLen - bufferData.updateIndex,
                    Math.max(100, Math.floor(pointsPerMs * remainingTime))
                );
                
                const endIndex = Math.min(bufferData.updateIndex + maxPointsThisFrame, sigLen);
                const timeBuffer = new Float32Array(endIndex - bufferData.updateIndex);
                const valueBuffer = new Float32Array(endIndex - bufferData.updateIndex);

                for (let i = 0, j = bufferData.updateIndex; j < endIndex; i++, j++) {
                    const [time, value] = channel.data(j);
                    timeBuffer[i] = time;
                    valueBuffer[i] = value;
                }

                // Upload time data
                gl.bindBuffer(gl.ARRAY_BUFFER, bufferData.timeBuffer);
                gl.bufferSubData(gl.ARRAY_BUFFER, bufferData.updateIndex * 4, timeBuffer);
                
                // Upload value data
                gl.bindBuffer(gl.ARRAY_BUFFER, bufferData.valueBuffer);
                gl.bufferSubData(gl.ARRAY_BUFFER, bufferData.updateIndex * 4, valueBuffer);
                
                bufferData.updateIndex = endIndex;
                
                if (bufferData.updateIndex < sigLen) {
                    anyBufferNeedsUpdate = true;
                }
            }
        }
        return anyBufferNeedsUpdate;
    });
    
    context.onRowsChanged((event) => {
        for (const row of event.added) {
            const rowSignals: Signal[] = [];
            const rowSignalBuffers = new Map<Signal, ChannelBufferData>();
            
            for (const channel of row.signals) {
                if (!channelBuffers.has(channel)) {
                    const timeBuffer = context.webgl.gl.createBuffer();
                    const valueBuffer = context.webgl.gl.createBuffer();
                    if (!timeBuffer || !valueBuffer) {
                        throw new Error('Failed to create WebGL buffers');
                    }
                    channelBuffers.set(channel, {
                        timeBuffer,
                        valueBuffer,
                        lastDataLength: 0,
                        updateIndex: 0,
                        pointCount: 0
                    });
                }
                
                const bufferData = channelBuffers.get(channel)!;
                rowSignals.push(channel);
                rowSignalBuffers.set(channel, bufferData);
                
                row.addRenderObject(new WaveformRenderObject(
                    config,
                    bufferData,
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

        const activeChannels = new Set<Signal>(context.getRows().flatMap(row => row.signals));
        for (const row of event.removed) {
            for (const channel of row.signals) {
                if (!activeChannels.has(channel)) {
                    const bufferData = channelBuffers.get(channel);
                    if (bufferData) {
                        context.webgl.gl.deleteBuffer(bufferData.timeBuffer);
                        context.webgl.gl.deleteBuffer(bufferData.valueBuffer);
                        channelBuffers.delete(channel);
                    }
                }
            }
        }
    });
};
