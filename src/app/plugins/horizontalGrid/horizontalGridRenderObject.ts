import { RenderObject, type RenderBounds, type RenderContext } from "@voltex-viewer/plugin-api";
import { GridLinePosition } from './horizontalGridPlugin';

export class HorizontalGridRenderObject {
    constructor(
        parent: RenderObject,
        private calculateGridPositions: (bounds: { height: number }) => GridLinePosition[],
        private visible: () => boolean,
    ) {
        parent.addChild({
            zIndex: -40,
            render: this.render.bind(this),
        });
    }
    
    render(context: RenderContext, bounds: RenderBounds): boolean {
        if (!this.visible()) {
            return false;
        }
        const { render } = context;
        const { gl, utils } = render;
        
        // Get grid line positions from shared function
        const gridPositions = this.calculateGridPositions(bounds);
        
        if (gridPositions.length === 0) {
            return false;
        }
        
        const lineVertices: number[] = [];
        
        for (const position of gridPositions) {
            // Add horizontal grid line vertices
            lineVertices.push(
                0, position.y,
                bounds.width, position.y
            );
        }
        
        // Draw all grid lines in a single draw call
        if (lineVertices.length > 0) {
            gl.useProgram(utils.grid);
            
            const positionBuffer = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
            gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(lineVertices), gl.STATIC_DRAW);
            
            const positionLocation = gl.getAttribLocation(utils.grid, 'a_position');
            gl.enableVertexAttribArray(positionLocation);
            gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);
            
            gl.uniform2f(gl.getUniformLocation(utils.grid, 'u_bounds'), bounds.width, bounds.height);
            gl.uniform2f(gl.getUniformLocation(utils.grid, 'u_offset'), 0, 0);
            gl.uniform4f(gl.getUniformLocation(utils.grid, 'u_color'), 0.2, 0.2, 0.2, 0.8);
            gl.uniform1i(gl.getUniformLocation(utils.grid, 'u_dashed'), 1);
            gl.uniform1i(gl.getUniformLocation(utils.grid, 'u_horizontal'), 1);
            gl.uniform1f(gl.getUniformLocation(utils.grid, 'u_dashSize'), 4.0);
            
            gl.drawArrays(gl.LINES, 0, lineVertices.length / 2);
            
            gl.deleteBuffer(positionBuffer);
        }

        return false;
    }
}
