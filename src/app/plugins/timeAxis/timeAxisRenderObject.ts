import { RenderObject, type RenderBounds, type RenderContext } from "@voltex-viewer/plugin-api";
import { getGridSpacing } from './timeAxisUtils';

const timeUnits = [
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

export class TimeAxisRenderObject {
    static readonly rowHeight = 14;
    static readonly gap = 4;
    
    constructor(parent: RenderObject) {
        parent.addChild({
            zIndex: -100, // Render behind other objects
            render: this.render.bind(this),
        });
    }
    
    static getAxisHeight(): number {
        return TimeAxisRenderObject.rowHeight * 2 + TimeAxisRenderObject.gap;
    }
    
    render(context: RenderContext, bounds: RenderBounds): boolean {
        const { render, state } = context;
        const { gl, utils } = render;

        const { pxPerSecond, offset: startPx } = state;
        const gridSpacing = getGridSpacing(pxPerSecond);
        const pxPerGrid = gridSpacing * pxPerSecond;
        const unitInfo = this.getTimeUnitAndScale(gridSpacing);
        const leftGridPx = Math.floor(startPx / (pxPerSecond * gridSpacing)) * gridSpacing * pxPerSecond;

        // Calculate sticky label
        const currentGridX = leftGridPx - startPx;
        const stickyLabelInfo = (currentGridX < 0 && leftGridPx + pxPerGrid - startPx > 150)
            ? { shouldShow: true, label: this.formatSplitTimeLabel(leftGridPx / pxPerSecond, unitInfo.scale), timePx: leftGridPx }
            : { shouldShow: false, label: '', timePx: 0 };

        // Draw major grid lines, labels, and subdivisions
        const subdivisions = 10;
        const rowHeight = TimeAxisRenderObject.rowHeight;
        const gap = TimeAxisRenderObject.gap;
        
        // Collect all line vertices
        const lineVertices: number[] = [];
        
        for (let px = leftGridPx, end = startPx + bounds.width + pxPerGrid; px < end; px += pxPerGrid) {
            const x = Math.round(px - startPx);
            
            // Draw major grid line and label if in bounds
            if (x <= bounds.width) {
                // Add major grid line vertices
                lineVertices.push(
                    x, 0,
                    x, bounds.height
                );
                
                // Draw time label (but not if it's the sticky label to avoid overlap)
                const t = px / pxPerSecond;
                const isCurrentStickyLabel = stickyLabelInfo.shouldShow && 
                    Math.abs(px - stickyLabelInfo.timePx) < 1; // Use small tolerance for floating point comparison
                
                if (!isCurrentStickyLabel) { // Only show normal label if it's not the sticky one
                    utils.drawText(this.formatSplitTimeLabel(t, unitInfo.scale), x, 2, bounds, {
                        font: utils.getDefaultFont('bold', '13px'),
                        fillStyle: '#ffffff'
                    });
                }
            }
            
            // Add subdivision line vertices
            for (let j = 1; j < subdivisions; j++) {
                const subPx = px + pxPerGrid * j / subdivisions;
                const subX = Math.round(subPx - startPx);
                
                if (subX <= bounds.width) {
                    // Add subdivision line vertices
                    lineVertices.push(
                        subX, rowHeight + gap / 2,
                        subX, bounds.height - rowHeight - gap / 2
                    );
                    
                    // Draw subdivision label
                    const offsetValue = gridSpacing * j / (subdivisions * unitInfo.scale);
                    const label = Math.abs(offsetValue) < 1 ? `+${offsetValue.toFixed(1)}${unitInfo.unit}` : `+${Math.round(offsetValue)}${unitInfo.unit}`;
                    
                    utils.drawText(label, subX - 3.5, rowHeight + gap + 1, bounds, {
                        font: utils.getDefaultFont('bold', '12px'),
                        fillStyle: '#ffffff'
                    });
                }
            }
        }
        
        // Draw sticky label if it should be shown
        if (stickyLabelInfo.shouldShow) {
            utils.drawText(stickyLabelInfo.label, 0, 2, bounds, {
                font: utils.getDefaultFont('bold', '13px'),
                fillStyle: '#ffffff'
            });
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
                gl.uniform2f(gl.getUniformLocation(utils.grid, 'u_offset'), 0, 0);
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
        
        for (const unit of timeUnits) {
            const value = abs / unit.scale;
            if (value >= 1 && value < 1000) {
                return { unit: unit.name, scale: unit.scale };
            }
        }
        
        const lastUnit = timeUnits[timeUnits.length - 1];
        if (abs / lastUnit.scale < 1) {
            return { unit: lastUnit.name, scale: lastUnit.scale };
        }
        return { unit: timeUnits[0].name, scale: timeUnits[0].scale };
    }
    
    private formatSplitTimeLabel(seconds: number, scale: number): string {
        let remainder = Math.round(Math.abs(seconds) / scale);
        
        const parts = [];
        for (const u of timeUnits.slice(0, timeUnits.findIndex(u => u.scale === scale) + 1)) {
            const unitCount = Math.floor(remainder * scale / u.scale);
            if (unitCount > 0 || (u.scale === scale && parts.length === 0)) {
                parts.push(`${unitCount}${u.name}`);
            }
            remainder -= unitCount * Math.round(u.scale / scale);
        }
        
        return (seconds < 0 ? '-' : '') + parts.join(' ');
    }
}
