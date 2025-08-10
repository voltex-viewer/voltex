import { RenderObject, type RenderContext, type RenderBounds } from '../../RenderObject';
import { WebGLUtils } from '../../WebGLUtils';
import { getGridSpacing } from './TimeAxisUtils';

const TIME_UNITS = [
    { name: 'yr', scale: 60 * 60 * 24 * 365 },
    { name: 'd', scale: 60 * 60 * 24 },
    { name: 'h', scale: 60 * 60 },
    { name: 'm', scale: 60 },
    { name: 's', scale: 1 },
    { name: 'ms', scale: 1e-3 },
    { name: 'µs', scale: 1e-6 },
    { name: 'ns', scale: 1e-9 },
    { name: 'ps', scale: 1e-12 },
    { name: 'fs', scale: 1e-15 },
    { name: 'as', scale: 1e-18 },
    { name: 'zs', scale: 1e-21 },
    { name: 'ys', scale: 1e-24 },
];

export class TimeAxisRenderObject extends RenderObject {
    static readonly ROW_HEIGHT = 14;
    static readonly GAP = 4;
    
    constructor() {
        super(-100); // Render behind other objects
    }
    
    static getAxisHeight(): number {
        return TimeAxisRenderObject.ROW_HEIGHT * 2 + TimeAxisRenderObject.GAP;
    }
    
    render(context: RenderContext, bounds: RenderBounds): boolean {
        const { render, state } = context;
        const { gl, utils } = render;

        const gridSpacing = getGridSpacing(state.pxPerSecond);
        const pxPerGrid = gridSpacing * state.pxPerSecond;
        const startPx = state.offset;

        const unitInfo = this.getTimeUnitAndScale(gridSpacing);

        const leftGridPx = Math.floor(startPx / state.pxPerSecond / gridSpacing) * gridSpacing * state.pxPerSecond;

        // Draw major grid lines, labels, and subdivisions
        const subdivisions = 10;
        const rowHeight = TimeAxisRenderObject.ROW_HEIGHT;
        const gap = TimeAxisRenderObject.GAP;
        
        // Collect all line vertices
        const lineVertices: number[] = [];
        
        for (let px = leftGridPx; px < startPx + bounds.width + pxPerGrid; px += pxPerGrid) {
            const x = Math.round(((px - startPx) / bounds.width) * bounds.width);
            
            // Draw major grid line and label if in bounds
            if (x <= bounds.width) {
                // Add major grid line vertices
                lineVertices.push(
                    x, 0,
                    x, bounds.height
                );
                
                // Draw time label
                const t = px / state.pxPerSecond;
                utils.drawText(this.formatSplitTimeLabel(t, unitInfo.scale), x, 2, bounds, {
                    font: 'bold 14px "Open Sans"',
                    fillStyle: '#ffffff'
                });
            }
            
            // Add subdivision line vertices
            for (let j = 1; j < subdivisions; j++) {
                const subPx = px + (pxPerGrid * j / subdivisions);
                const subX = Math.round(((subPx - startPx) / bounds.width) * bounds.width);
                
                if (subX <= bounds.width) {
                    // Add subdivision line vertices
                    lineVertices.push(
                        subX, rowHeight + gap / 2,
                        subX, bounds.height - rowHeight - gap / 2
                    );
                    
                    // Draw subdivision label
                    const offsetValue = (gridSpacing * j / subdivisions) / unitInfo.scale;
                    const label = Math.abs(offsetValue) < 1 
                        ? `+${offsetValue.toFixed(1)}${unitInfo.unit}`
                        : `+${Math.round(offsetValue)}${unitInfo.unit}`;
                    
                    utils.drawText(label, subX - 3.5, rowHeight + gap + 1, bounds, {
                        font: 'bold 12px "Open Sans"',
                        fillStyle: '#ffffff'
                    });
                }
            }
        }
        
        // Draw all lines in a single draw call
        if (lineVertices.length > 0) {
            gl.useProgram(utils.grid);
            const buffer = gl.createBuffer();
            if (buffer) {
                gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
                gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(lineVertices), gl.STATIC_DRAW);
                
                const positionLocation = gl.getAttribLocation(utils.grid, 'a_position');
                gl.enableVertexAttribArray(positionLocation);
                gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);
                
                gl.uniform2f(gl.getUniformLocation(utils.grid, 'u_bounds'), bounds.width, bounds.height);
                gl.uniform4f(gl.getUniformLocation(utils.grid, 'u_color'), 0.267, 0.267, 0.267, 1.0);
                gl.uniform1i(gl.getUniformLocation(utils.grid, 'u_dashed'), 1);
                gl.uniform1i(gl.getUniformLocation(utils.grid, 'u_horizontal'), 0);
                gl.uniform1f(gl.getUniformLocation(utils.grid, 'u_dashSize'), 3.0);
                
                gl.drawArrays(gl.LINES, 0, lineVertices.length / 2);
                
                gl.disableVertexAttribArray(positionLocation);
                gl.bindBuffer(gl.ARRAY_BUFFER, null);
                gl.deleteBuffer(buffer);
            }
        }

        return false;
    }
    
    private getTimeUnitAndScale(seconds: number): { unit: string; scale: number } {
        const abs = Math.abs(seconds);
        
        for (const unit of TIME_UNITS) {
            const value = abs / unit.scale;
            if (value >= 1 && value < 1000) {
                return { unit: unit.name, scale: unit.scale };
            }
        }
        
        const lastUnit = TIME_UNITS[TIME_UNITS.length - 1];
        if (abs / lastUnit.scale < 1) {
            return { unit: lastUnit.name, scale: lastUnit.scale };
        }
        return { unit: TIME_UNITS[0].name, scale: TIME_UNITS[0].scale };
    }
    
    private formatSplitTimeLabel(seconds: number, scale: number): string {
        let remainder = Math.round(Math.abs(seconds) / scale);
        
        let parts = [];
        for (const u of TIME_UNITS.slice(0, TIME_UNITS.findIndex(u => u.scale === scale) + 1)) {
            const unitCount = Math.floor(remainder * scale / u.scale);
            if (unitCount > 0 || (u.scale === scale && parts.length === 0)) {
                parts.push(`${unitCount}${u.name}`);
            }
            remainder -= unitCount * Math.round(u.scale / scale);
        }
        
        return (seconds < 0 ? '-' : '') + parts.join(' ');
    }
}
