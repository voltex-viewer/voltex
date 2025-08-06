import { RenderObject, type RenderContext, type RenderBounds } from '../../RenderObject';

export class HorizontalSeparatorRenderObject extends RenderObject {
    constructor() {
        super(-40); // Lower z-index to render behind other elements
    }
    
    render(context: RenderContext, bounds: RenderBounds): boolean {
        const { render: { gl, utils } } = context;

        gl.useProgram(utils.line);
        
        const vertexBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
        
        // Draw horizontal lines at the top and bottom of the row
        const lineVertices = new Float32Array([
            0, 0, bounds.width, 0,
            0, bounds.height, bounds.width, bounds.height
        ]);
        
        gl.bufferData(gl.ARRAY_BUFFER, lineVertices, gl.STATIC_DRAW);
        
        const positionLocation = gl.getAttribLocation(utils.line, 'a_position');
        gl.enableVertexAttribArray(positionLocation);
        gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);
        
        gl.uniform2f(gl.getUniformLocation(utils.line, 'u_bounds'), bounds.width, bounds.height);
        
        // Use the same border color as LabelRenderObject
        gl.uniform4f(gl.getUniformLocation(utils.line, 'u_color'), 0.2, 0.2, 0.2, 1.0); // #333
        
        gl.drawArrays(gl.LINES, 0, 4);
        
        gl.deleteBuffer(vertexBuffer);
        gl.disableVertexAttribArray(positionLocation);
        
        return false;
    }
}
