import type { PluginContext } from '../../Plugin';
import type { Signal } from '../../Signal';
import { RenderMode, WaveformConfigSchema } from './WaveformConfig';
import { WaveformRenderObject } from './WaveformRenderObject';
import { WaveformShaders } from './WaveformShaders';

export interface ChannelBufferData {
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
            renderMode: RenderMode.Lines,
            dotSize: 6.0,
            lineWidth: 1.5,
            targetFps: 120,
        });

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
    
    // Create miter join instance geometry (2 triangles, 6 vertices, 3 coefficients each)
    const miterJoinInstanceGeometry = new Float32Array([
        0, 0, 0,
        1, 0, 0,
        0, 1, 0,
        0, 0, 0,
        0, 1, 0,
        0, 0, 1
    ]);
    
    // Create shared instance geometry buffer
    const sharedInstanceGeometryBuffer = context.webgl.gl.createBuffer();
    if (!sharedInstanceGeometryBuffer) {
        throw new Error('Failed to create shared instance geometry buffer');
    }
    context.webgl.gl.bindBuffer(context.webgl.gl.ARRAY_BUFFER, sharedInstanceGeometryBuffer);
    context.webgl.gl.bufferData(context.webgl.gl.ARRAY_BUFFER, segmentInstanceGeometry, context.webgl.gl.STATIC_DRAW);
    
    // Create shared miter join geometry buffer
    const sharedMiterJoinGeometryBuffer = context.webgl.gl.createBuffer();
    if (!sharedMiterJoinGeometryBuffer) {
        throw new Error('Failed to create shared miter join geometry buffer');
    }
    context.webgl.gl.bindBuffer(context.webgl.gl.ARRAY_BUFFER, sharedMiterJoinGeometryBuffer);
    context.webgl.gl.bufferData(context.webgl.gl.ARRAY_BUFFER, miterJoinInstanceGeometry, context.webgl.gl.STATIC_DRAW);

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
                gl.bindBuffer(gl.ARRAY_BUFFER, bufferData.buffer);
                const totalPoints = sigLen * 2;
                gl.bufferData(gl.ARRAY_BUFFER, totalPoints * 4, gl.DYNAMIC_DRAW);
                
                bufferData.lastDataLength = sigLen;
                bufferData.updateIndex = 0;
                bufferData.pointCount = sigLen;
            } else {
                gl.bindBuffer(gl.ARRAY_BUFFER, bufferData.buffer);
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
                const buffer = new Float32Array((endIndex - bufferData.updateIndex) * 2);

                for (let i = 0, j = bufferData.updateIndex; j < endIndex; i += 2, j++) {
                    [buffer[i], buffer[i + 1]] = channel.data(j);
                }

                gl.bufferSubData(gl.ARRAY_BUFFER, bufferData.updateIndex * 2 * 4, buffer);
                bufferData.updateIndex = endIndex;
                
                if (bufferData.updateIndex < sigLen) {
                    anyBufferNeedsUpdate = true;
                }
            }
        }
        return anyBufferNeedsUpdate;
    });

    context.onAfterRender(() => {
        // Frame timing is now handled by the RenderProfiler
        return false; // Don't request additional renders
    });
    
    context.onRowsChanged((event) => {
        for (const row of event.added) {
            for (const channel of row.signals) {
                if (!channelBuffers.has(channel)) {
                    const buffer = context.webgl.gl.createBuffer();
                    if (!buffer) {
                        throw new Error('Failed to create WebGL buffer');
                    }
                    channelBuffers.set(channel, {
                        buffer,
                        lastDataLength: 0,
                        updateIndex: 0,
                        pointCount: 0
                    });
                }
                row.addRenderObject(
                    new WaveformRenderObject(
                        config,
                        channelBuffers.get(channel),
                        sharedInstanceGeometryBuffer,
                        sharedMiterJoinGeometryBuffer,
                        instancingExt,
                        context.signalMetadata.getColor(channel),
                        waveformPrograms,
                        channel
                    )
                );
            }
        }

        const activeChannels = new Set<Signal>(context.getRows().flatMap(row => row.signals));
        for (const row of event.removed) {
            for (const channel of row.signals) {
                if (!activeChannels.has(channel)) {
                    context.webgl.gl.deleteBuffer(channelBuffers.get(channel).buffer);
                    channelBuffers.delete(channel);
                }
            }
        }
    });
};
