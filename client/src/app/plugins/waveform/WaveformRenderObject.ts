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
        const renderMode = this.config.renderMode;
        
        const color = this.color;
        
        // Set uniforms
        let bindUniforms = (width: number) => (program: WebGLProgram) => {
            gl.uniform2f(gl.getUniformLocation(program, 'u_bounds'), bounds.width, bounds.height);
            gl.uniform1f(gl.getUniformLocation(program, 'u_width'), width);
            gl.uniform1f(gl.getUniformLocation(program, 'u_pxPerSecond'), signal.pxPerSecond);
            gl.uniform1f(gl.getUniformLocation(program, 'u_offset'), state.offset);
            gl.uniform1i(gl.getUniformLocation(program, 'u_discrete'), this.signal.source.discrete ? 1 : 0);

            // Apply row-specific y-scale and y-offset
            gl.uniform1f(gl.getUniformLocation(program, 'u_yScale'), row.yScale);
            gl.uniform1f(gl.getUniformLocation(program, 'u_yOffset'), row.yOffset);

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
        }
        return false;
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
