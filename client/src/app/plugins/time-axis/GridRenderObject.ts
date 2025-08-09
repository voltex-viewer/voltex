import { RenderObject, type RenderContext, type RenderBounds } from '../../RenderObject';
import { getGridSpacing } from './TimeAxisUtils';

export class GridRenderObject extends RenderObject {
    constructor() {
        super(-50);
    }
    
    render(context: RenderContext, bounds: RenderBounds): boolean {
        const {render, state} = context;
        const { gl, utils } = render;
        
        const gridSpacing = getGridSpacing(state.pxPerSecond);
        const pxPerGrid = gridSpacing * state.pxPerSecond;
        const startPx = state.offset;
        const subdivisions = 10;
        const firstMajorPx = Math.floor(startPx / pxPerGrid) * pxPerGrid;

        const program = utils.grid;
        
        gl.useProgram(program);
        
        const positionBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
        
        const lines: number[] = [];
        
        for (let px = firstMajorPx; px < startPx + bounds.width; px += pxPerGrid) {
            const x = Math.round(((px - startPx) / bounds.width) * bounds.width);
            lines.push(x, 0, x, bounds.height);
        }

        for (let majorPx = firstMajorPx; majorPx < startPx + bounds.width; majorPx += pxPerGrid) {
            for (let j = 1; j < subdivisions; j++) {
                const frac = j / subdivisions;
                const px = majorPx + pxPerGrid * frac;
                if (px < startPx || px > startPx + bounds.width) continue;

                const x = Math.round(((px - startPx) / bounds.width) * bounds.width);
                lines.push(x, 0, x, bounds.height);
            }
        }
        
        if (lines.length > 0) {
            gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(lines), gl.STATIC_DRAW);
            
            const positionLocation = gl.getAttribLocation(program, 'a_position');
            const resolutionLocation = gl.getUniformLocation(program, 'u_bounds');
            const colorLocation = gl.getUniformLocation(program, 'u_color');
            const dashedLocation = gl.getUniformLocation(program, 'u_dashed');
            const dashSizeLocation = gl.getUniformLocation(program, 'u_dashSize');
            
            gl.enableVertexAttribArray(positionLocation);
            gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);
            
            gl.uniform2f(resolutionLocation, bounds.width, bounds.height);
            gl.uniform4f(colorLocation, 0.267, 0.267, 0.267, 0.8);
            gl.uniform1i(dashedLocation, 1);
            gl.uniform1f(dashSizeLocation, 4.0);
            
            gl.drawArrays(gl.LINES, 0, lines.length / 2);
        }
        
        gl.deleteBuffer(positionBuffer);

        return false;
    }
}
