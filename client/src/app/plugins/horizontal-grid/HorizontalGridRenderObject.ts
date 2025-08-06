import { RenderObject, type RenderContext, type RenderBounds } from '../../RenderObject';
import type { WebGLUtils } from '../../WebGLUtils';

export class HorizontalGridRenderObject extends RenderObject {
    constructor() {
        super(-50);
    }
    
    render(context: RenderContext, bounds: RenderBounds): boolean {
        const {render} = context;
        const { gl, utils } = render;

        const program = utils.grid;

        gl.useProgram(program);
        
        const positionBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
        
        const centerY = bounds.height / 2;
        
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, centerY, bounds.width, centerY]), gl.STATIC_DRAW);
        
        const positionLocation = gl.getAttribLocation(program, 'a_position');
        gl.enableVertexAttribArray(positionLocation);
        gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);
        
        gl.uniform2f(gl.getUniformLocation(program, 'u_bounds'), bounds.width, bounds.height);
        gl.uniform4f(gl.getUniformLocation(program, 'u_color'), 0.267, 0.267, 0.267, 1.0);
        gl.uniform1i(gl.getUniformLocation(program, 'u_dashed'), 0);
        
        gl.drawArrays(gl.LINES, 0, 2);
        
        gl.deleteBuffer(positionBuffer);

        return false;
    }
}