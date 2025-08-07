import { RenderObject, type RenderContext, type RenderBounds } from '../../RenderObject';
import { WebGLUtils } from '../../WebGLUtils';
import type { ChannelBufferData } from './WaveformRendererPlugin';
import { RenderMode, WaveformConfig } from './WaveformConfig';
import { WaveformShaders } from './WaveformShaders';
import type { Signal } from '../../Signal';

export class WaveformRenderObject extends RenderObject {
    private bufferData: ChannelBufferData;
    private sharedInstanceGeometryBuffer: WebGLBuffer;
    private sharedBevelJoinGeometryBuffer: WebGLBuffer;
    private color: string;
    private waveformPrograms: WaveformShaders;
    private config: WaveformConfig;
    private instancingExt: ANGLE_instanced_arrays;
    private signal: Signal;

    private getSignalRenderMode(signal: Signal, defaultMode: RenderMode): RenderMode {
        if (signal.source.discrete && 'valueTable' in signal) {
            return RenderMode.Enum;
        }
        return defaultMode;
    }

    constructor(config: WaveformConfig, bufferData: ChannelBufferData, sharedInstanceGeometryBuffer: WebGLBuffer, sharedBevelJoinGeometryBuffer: WebGLBuffer, instancingExt: ANGLE_instanced_arrays, color: string, waveformPrograms: WaveformShaders, signal: Signal, zIndex: number = 0) {
        super(zIndex);
        this.config = config;
        this.bufferData = bufferData;
        this.sharedInstanceGeometryBuffer = sharedInstanceGeometryBuffer;
        this.sharedBevelJoinGeometryBuffer = sharedBevelJoinGeometryBuffer;
        this.instancingExt = instancingExt;
        this.color = color;
        this.waveformPrograms = waveformPrograms;
        this.signal = signal;
    }
    
    render(context: RenderContext, bounds: RenderBounds): boolean {
        const {render, state, signal, row} = context;
        const { gl } = render;
        const renderMode = this.getSignalRenderMode(this.signal, this.config.renderMode);
        
        const color = this.color;
            
        // Calculate left time with high precision
        const leftTimeDouble = state.offset / signal.pxPerSecond;
        
        // Split double precision into two float32 values for GPU
        // This emulates double precision arithmetic on the GPU
        const timeOffsetHigh = Math.fround(leftTimeDouble); // Round to float32
        const timeOffsetLow = leftTimeDouble - timeOffsetHigh; // Remaining precision
        
        // Set uniforms
        let bindUniforms = (width: number) => (program: WebGLProgram) => {
            gl.uniform2f(gl.getUniformLocation(program, 'u_bounds'), bounds.width, bounds.height);
            gl.uniform1f(gl.getUniformLocation(program, 'u_width'), width);
            gl.uniform1f(gl.getUniformLocation(program, 'u_timeOffsetHigh'), timeOffsetHigh);
            gl.uniform1f(gl.getUniformLocation(program, 'u_timeOffsetLow'), timeOffsetLow);
            gl.uniform1f(gl.getUniformLocation(program, 'u_pxPerSecond'), signal.pxPerSecond);
            
            gl.uniform1i(gl.getUniformLocation(program, 'u_discrete'), this.signal.source.discrete ? 1 : 0);

            // Apply row-specific y-scale and y-offset
            gl.uniform1f(gl.getUniformLocation(program, 'u_yScale'), row.yScale);
            gl.uniform1f(gl.getUniformLocation(program, 'u_yOffset'), row.yOffset);

            const [r, g, b, a] = WebGLUtils.hexToRgba(color);
            gl.uniform4f(gl.getUniformLocation(program, 'u_color'), r, g, b, a);
        };

        // Special uniform binding for enum mode to pass max value for coloring
        let enumLinesBindUniforms = (program: WebGLProgram) => {
            gl.uniform2f(gl.getUniformLocation(program, 'u_bounds'), bounds.width, bounds.height);
            gl.uniform1f(gl.getUniformLocation(program, 'u_timeOffsetHigh'), timeOffsetHigh);
            gl.uniform1f(gl.getUniformLocation(program, 'u_timeOffsetLow'), timeOffsetLow);
            gl.uniform1f(gl.getUniformLocation(program, 'u_pxPerSecond'), signal.pxPerSecond);

            // Pass max value for color generation
            gl.uniform1f(gl.getUniformLocation(program, 'u_maxValue'), this.signal.maxValue);

            const [r, g, b, a] = WebGLUtils.hexToRgba(color);
            gl.uniform4f(gl.getUniformLocation(program, 'u_color'), r, g, b, a);
        };

        let linesBindUniforms = bindUniforms(this.config.lineWidth);
        let dotsBindUniforms = bindUniforms(this.config.dotSize);
        
        if (renderMode === RenderMode.Lines) {
            this.renderInstancedLines(gl, this.waveformPrograms.instancedLine, linesBindUniforms);
            this.renderBevelJoins(gl, this.waveformPrograms.bevelJoin, linesBindUniforms);
        } else if (renderMode === RenderMode.Dots) {
            this.renderSignal(gl, this.waveformPrograms.dot, dotsBindUniforms);
        } else if (renderMode === RenderMode.LinesDots) {
            this.renderInstancedLines(gl, this.waveformPrograms.instancedLine, linesBindUniforms);
            this.renderBevelJoins(gl, this.waveformPrograms.bevelJoin, linesBindUniforms);
            this.renderSignal(gl, this.waveformPrograms.dot, dotsBindUniforms);
        } else if (renderMode === RenderMode.Enum) {
            this.renderEnumSignal(gl, this.waveformPrograms.enumLine, enumLinesBindUniforms, context, bounds);
        }
        return false;
    }
    
    private renderEnumSignal(
        gl: WebGLRenderingContext,
        program: WebGLProgram,
        bindUniforms: (program: WebGLProgram) => void,
        context: RenderContext,
        bounds: RenderBounds
    ): void {
        // Only render for discrete signals with valueTable
        if (!this.signal.source.discrete || !('valueTable' in this.signal)) {
            return;
        }

        const valueTable = (this.signal as any).valueTable as Map<number, string>;
        if (!valueTable) {
            return;
        }

        // Use custom instanced line rendering for enum signals to handle pairs correctly
        this.renderEnumInstancedLines(gl, program, bindUniforms);

        // Check if we should render text based on zoom level
        const { signal, state } = context;
        const pixelsPerSecond = signal.pxPerSecond;
        const minPixelsForText = 50; // Minimum pixels between points to show text (reduced threshold)

        if (pixelsPerSecond > minPixelsForText) {
            this.renderEnumText(context, bounds, valueTable);
        }
    }

    private renderEnumText(
        context: RenderContext,
        bounds: RenderBounds,
        valueTable: Map<number, string>
    ): void {
        const { render, state, signal } = context;
        const { utils } = render;

        // Calculate visible time range
        const startTime = state.offset / signal.pxPerSecond;
        const endTime = (state.offset + bounds.width) / signal.pxPerSecond;

        const padding = 5; // Padding around text
        const font = '12px "Open Sans", sans-serif'; // Match the font used in drawText

        // Find data points and determine which segments are visible
        // We render text for segments that are at least partially visible
        for (let i = 0; i < this.bufferData.updateIndex; i += 2) {
            const [segmentStartTime, value] = this.signal.data(i);
            
            // Get the end time of this segment (the second point of this pair)
            if (i + 1 >= this.bufferData.updateIndex) continue;
            const [segmentEndTime] = this.signal.data(i + 1);
            
            // Check if segment overlaps with visible time range
            if (segmentEndTime < startTime || segmentStartTime > endTime) {
                continue; // Segment is completely outside visible range
            }
            
            let enumText = valueTable.get(value) || value.toString();
            
            // Calculate segment boundaries in pixel space
            const segmentStartX = segmentStartTime * signal.pxPerSecond - state.offset;
            const segmentEndX = segmentEndTime * signal.pxPerSecond - state.offset;
            
            // Determine text position - snap to left edge if segment starts off-screen
            const textX = Math.max(padding, segmentStartX + padding);
            
            // Calculate available width from text position to segment end
            const availableWidth = Math.max(0, segmentEndX - textX - padding);
                
            if (availableWidth > 0) {
                // Measure the actual text width
                const textMetrics = utils.measureText(enumText, font);
                const textWidth = textMetrics.renderWidth;
                
                // Handle text truncation if it doesn't fit
                let displayText = enumText;
                if (textWidth > availableWidth) {
                    // Try to fit text with ellipsis
                    const ellipsisWidth = utils.measureText('...', font).renderWidth;
                    const availableForText = availableWidth - ellipsisWidth;
                    
                    if (availableForText <= 0) {
                        // Not enough space even for ellipsis
                        continue;
                    }
                    
                    // Binary search to find the longest text that fits
                    let left = 1;
                    let right = enumText.length - 1;
                    let bestLength = 0;
                    
                    while (left <= right) {
                        const mid = Math.floor((left + right) / 2);
                        const truncatedWidth = utils.measureText(enumText.substring(0, mid), font).renderWidth;
                        
                        if (truncatedWidth <= availableForText) {
                            bestLength = mid;
                            left = mid + 1;
                        } else {
                            right = mid - 1;
                        }
                    }
                    
                    if (bestLength === 0) {
                        // Can't fit any meaningful text
                        continue;
                    }
                    
                    displayText = enumText.substring(0, bestLength) + '...';
                }
                
                // Final check - ensure we have meaningful text
                if (displayText.length < 2) {
                    continue;
                }
                
                // Render text at center of viewport height using consistent baseline positioning
                // Use font metrics for consistent vertical centering regardless of text content
                const baselineMetrics = utils.measureText('Ag', font); // Use consistent reference text for baseline
                const y = (bounds.height - baselineMetrics.renderHeight) / 2;
                
                // Render text with white fill and black stroke for better visibility
                utils.drawText(
                    displayText,
                    textX, // Use calculated text position (snapped to left edge if needed)
                    y,
                    { width: bounds.width, height: bounds.height },
                    {
                        font,
                        fillStyle: '#ffffff',
                        strokeStyle: '#000000',
                        strokeWidth: 2
                    }
                );
            }
        }
    }
    
    private renderEnumInstancedLines(
        gl: WebGLRenderingContext,
        program: WebGLProgram,
        bindUniforms: (program: WebGLProgram) => void,
    ): void {
        gl.useProgram(program);
        bindUniforms(program);
        
        // Bind instance geometry (the quad geometry for each line segment)
        gl.bindBuffer(gl.ARRAY_BUFFER, this.sharedInstanceGeometryBuffer);
        const positionLocation = gl.getAttribLocation(program, 'position');
        gl.enableVertexAttribArray(positionLocation);
        gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);
        this.instancingExt.vertexAttribDivisorANGLE(positionLocation, 0);
        
        // Bind points buffer for instanced data - reuse the main buffer
        gl.bindBuffer(gl.ARRAY_BUFFER, this.bufferData.buffer);
        
        // For enum signals, we have pairs of points (start, end) with same value
        // So we need to render every pair as a line segment, stride by 2 points
        const pointALocation = gl.getAttribLocation(program, 'pointA');
        gl.enableVertexAttribArray(pointALocation);
        gl.vertexAttribPointer(pointALocation, 2, gl.FLOAT, false, 4 * 4, 0); // stride: 4 floats (2 points), offset: 0
        this.instancingExt.vertexAttribDivisorANGLE(pointALocation, 1);
        
        const pointBLocation = gl.getAttribLocation(program, 'pointB');
        gl.enableVertexAttribArray(pointBLocation);
        gl.vertexAttribPointer(pointBLocation, 2, gl.FLOAT, false, 4 * 4, 2 * 4); // stride: 4 floats, offset: 1 point (2 floats)
        this.instancingExt.vertexAttribDivisorANGLE(pointBLocation, 1);
        
        // Draw instanced - render every pair of points
        const instanceCount = Math.floor(this.bufferData.updateIndex / 2);
        if (instanceCount > 0) {
            this.instancingExt.drawArraysInstancedANGLE(gl.TRIANGLES, 0, 6, instanceCount);
        }
        
        // Clean up divisors
        this.instancingExt.vertexAttribDivisorANGLE(positionLocation, 0);
        this.instancingExt.vertexAttribDivisorANGLE(pointALocation, 0);
        this.instancingExt.vertexAttribDivisorANGLE(pointBLocation, 0);
        
        // Disable vertex attribute arrays
        gl.disableVertexAttribArray(positionLocation);
        gl.disableVertexAttribArray(pointALocation);
        gl.disableVertexAttribArray(pointBLocation);
    }
    
    private renderSignal(
        gl: WebGLRenderingContext,
        program: WebGLProgram,
        bindUniforms: (program: WebGLProgram) => void,
    ): void {
        gl.useProgram(program);
        bindUniforms(program);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.bufferData.buffer);
        
        const positionLocation = gl.getAttribLocation(program, 'position');
        gl.enableVertexAttribArray(positionLocation);
        gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);

        gl.drawArrays(gl.POINTS, 0, this.bufferData.updateIndex);
        
        // Clean up
        gl.disableVertexAttribArray(positionLocation);
    }
    
    private renderInstancedLines(
        gl: WebGLRenderingContext,
        program: WebGLProgram,
        bindUniforms: (program: WebGLProgram) => void,
    ): void {
        gl.useProgram(program);
        bindUniforms(program);
        
        // Bind instance geometry (the quad geometry for each line segment)
        gl.bindBuffer(gl.ARRAY_BUFFER, this.sharedInstanceGeometryBuffer);
        const positionLocation = gl.getAttribLocation(program, 'position');
        gl.enableVertexAttribArray(positionLocation);
        gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);
        this.instancingExt.vertexAttribDivisorANGLE(positionLocation, 0);
        
        // Bind points buffer for instanced data - reuse the main buffer
        gl.bindBuffer(gl.ARRAY_BUFFER, this.bufferData.buffer);
        
        const pointALocation = gl.getAttribLocation(program, 'pointA');
        gl.enableVertexAttribArray(pointALocation);
        gl.vertexAttribPointer(pointALocation, 2, gl.FLOAT, false, 2 * 4, 0); // stride: 2 floats, offset: 0
        this.instancingExt.vertexAttribDivisorANGLE(pointALocation, 1);
        
        const pointBLocation = gl.getAttribLocation(program, 'pointB');
        gl.enableVertexAttribArray(pointBLocation);
        gl.vertexAttribPointer(pointBLocation, 2, gl.FLOAT, false, 2 * 4, 2 * 4); // stride: 2 floats, offset: 1 point (2 floats)
        this.instancingExt.vertexAttribDivisorANGLE(pointBLocation, 1);
        
        // Draw instanced
        const instanceCount = this.bufferData.updateIndex - 1;
        if (instanceCount > 0) {
            this.instancingExt.drawArraysInstancedANGLE(gl.TRIANGLES, 0, 6, instanceCount);
        }
        
        // Clean up divisors
        this.instancingExt.vertexAttribDivisorANGLE(positionLocation, 0);
        this.instancingExt.vertexAttribDivisorANGLE(pointALocation, 0);
        this.instancingExt.vertexAttribDivisorANGLE(pointBLocation, 0);
        
        // Disable vertex attribute arrays
        gl.disableVertexAttribArray(positionLocation);
        gl.disableVertexAttribArray(pointALocation);
        gl.disableVertexAttribArray(pointBLocation);
    }
    
    private renderBevelJoins(
        gl: WebGLRenderingContext,
        program: WebGLProgram,
        bindUniforms: (program: WebGLProgram) => void,
    ): void {
        // Skip bevel joins for discrete signals as they use horizontal lines
        if (this.signal.source.discrete) {
            return;
        }
        
        gl.useProgram(program);
        bindUniforms(program);
        
        // Bind bevel join geometry (3 vertices for 1 triangle)
        gl.bindBuffer(gl.ARRAY_BUFFER, this.sharedBevelJoinGeometryBuffer);
        const positionLocation = gl.getAttribLocation(program, 'position');
        gl.enableVertexAttribArray(positionLocation);
        gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);
        this.instancingExt.vertexAttribDivisorANGLE(positionLocation, 0);
        
        // Bind points buffer for instanced data - three consecutive points (A, B, C)
        gl.bindBuffer(gl.ARRAY_BUFFER, this.bufferData.buffer);
        
        const pointALocation = gl.getAttribLocation(program, 'pointA');
        gl.enableVertexAttribArray(pointALocation);
        gl.vertexAttribPointer(pointALocation, 2, gl.FLOAT, false, 2 * 4, 0); // offset: 0
        this.instancingExt.vertexAttribDivisorANGLE(pointALocation, 1);
        
        const pointBLocation = gl.getAttribLocation(program, 'pointB');
        gl.enableVertexAttribArray(pointBLocation);
        gl.vertexAttribPointer(pointBLocation, 2, gl.FLOAT, false, 2 * 4, 2 * 4); // offset: 1 point
        this.instancingExt.vertexAttribDivisorANGLE(pointBLocation, 1);
        
        const pointCLocation = gl.getAttribLocation(program, 'pointC');
        gl.enableVertexAttribArray(pointCLocation);
        gl.vertexAttribPointer(pointCLocation, 2, gl.FLOAT, false, 2 * 4, 4 * 4); // offset: 2 points
        this.instancingExt.vertexAttribDivisorANGLE(pointCLocation, 1);
        
        // Draw instanced bevel joins - need 3 consecutive points
        const instanceCount = this.bufferData.updateIndex - 2;
        if (instanceCount > 0) {
            this.instancingExt.drawArraysInstancedANGLE(gl.TRIANGLES, 0, 3, instanceCount);
        }
        
        // Clean up divisors
        this.instancingExt.vertexAttribDivisorANGLE(positionLocation, 0);
        this.instancingExt.vertexAttribDivisorANGLE(pointALocation, 0);
        this.instancingExt.vertexAttribDivisorANGLE(pointBLocation, 0);
        this.instancingExt.vertexAttribDivisorANGLE(pointCLocation, 0);
        
        // Disable vertex attribute arrays
        gl.disableVertexAttribArray(positionLocation);
        gl.disableVertexAttribArray(pointALocation);
        gl.disableVertexAttribArray(pointBLocation);
        gl.disableVertexAttribArray(pointCLocation);
    }
}
