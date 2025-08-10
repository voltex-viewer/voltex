import { RenderObject, type RenderContext, type RenderBounds } from '../../RenderObject';
import { GridLinePosition } from './HorizontalGridPlugin';

export class HorizontalGridLabelRenderObject extends RenderObject {
    constructor(
        private calculateGridPositions: (bounds: { height: number }) => GridLinePosition[]
    ) {
        super(100); // High z-index to render on top of other elements
    }
    
    private determineFormatting(values: number[]): { unit: string; scale: number; decimalPlaces: number } {
        if (values.length === 0) {
            return { unit: '', scale: 1, decimalPlaces: 1 };
        }
        
        // Find the maximum absolute value to determine the appropriate unit
        const maxAbsValue = Math.max(...values.map(v => Math.abs(v)));
        
        let unit = '';
        let scale = 1;
        
        if (maxAbsValue >= 1e6) {
            unit = 'M';
            scale = 1e6;
        } else if (maxAbsValue >= 1e3) {
            unit = 'k';
            scale = 1e3;
        } else if (maxAbsValue < 1 && maxAbsValue >= 1e-3) {
            unit = 'm';
            scale = 1e-3;
        } else if (maxAbsValue < 1e-3 && maxAbsValue >= 1e-6) {
            unit = 'µ';
            scale = 1e-6;
        } else if (maxAbsValue < 1e-6 && maxAbsValue > 0) {
            unit = 'n';
            scale = 1e-9;
        }
        
        // Calculate the minimum decimal places needed for each value
        const decimalPlaces = Math.max(...values.map(v => v / scale).map(value => {
            // Handle edge cases
            if (value === 0 || !isFinite(value)) {
                return 0;
            }
            
            // Use tolerance to account for floating-point inaccuracies
            const tolerance = 1e-10;
            
            // Find the fractional part after removing the integer part
            const fractionalPart = Math.abs(value - Math.trunc(value));
            
            // If the fractional part is negligible, no decimal places needed
            if (fractionalPart < tolerance) {
                return 0;
            }
            
            // Calculate decimal places needed by finding when the fractional part
            // becomes close to an integer when multiplied by powers of 10
            const decimalPlaces = Math.max(0, Math.min(6, Math.ceil(-Math.log10(fractionalPart))));
            
            // Verify the result is actually needed by checking if rounding works
            const rounded = Math.round(value * Math.pow(10, decimalPlaces)) / Math.pow(10, decimalPlaces);
            return Math.abs(value - rounded) < tolerance ? decimalPlaces : Math.min(6, decimalPlaces + 1);
        }));
        
        return { unit, scale, decimalPlaces };
    }
    
    private formatValue(value: number, unit: string, scale: number, decimalPlaces: number): string {
        const scaledValue = value / scale;
        return scaledValue.toFixed(decimalPlaces) + unit;
    }
    
    render(context: RenderContext, bounds: RenderBounds): boolean {
        const { render } = context;
        const { gl, utils } = render;
        
        // Get grid line positions from shared function
        const gridPositions = this.calculateGridPositions(bounds);
        
        if (gridPositions.length === 0) {
            return false;
        }
        
        // Determine consistent formatting for all labels
        const values = gridPositions.map(pos => pos.value);
        const { unit, scale, decimalPlaces } = this.determineFormatting(values);
        
        // Measure nominal text height using reference string
        const font = '12px "Open Sans"';
        const { renderHeight } = utils.measureText('0123456789', font);
        const textCenterOffset = renderHeight / 2;
        
        // Collect background rectangles for all labels
        const backgroundVertices: number[] = [];
        const labelData: { label: string; x: number; y: number }[] = [];
        
        for (const position of gridPositions) {
            const label = this.formatValue(position.value, unit, scale, decimalPlaces);
            const { renderWidth } = utils.measureText(label, font);
            
            const x = 5;
            const y = position.y - textCenterOffset;
            
            // Add padding around the text
            const padding = 2;
            const bgX = x - padding;
            const bgY = y - padding;
            const bgWidth = renderWidth + padding * 2;
            const bgHeight = renderHeight + padding * 2;
            
            // Add rectangle vertices (two triangles)
            backgroundVertices.push(
                // First triangle
                bgX, bgY,
                bgX + bgWidth, bgY,
                bgX, bgY + bgHeight,
                // Second triangle
                bgX + bgWidth, bgY,
                bgX + bgWidth, bgY + bgHeight,
                bgX, bgY + bgHeight
            );
            
            // Store label data for later rendering
            labelData.push({ label, x, y });
        }
        
        // Draw all background rectangles
        if (backgroundVertices.length > 0) {
            gl.useProgram(utils.grid);
            
            const positionBuffer = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
            gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(backgroundVertices), gl.STATIC_DRAW);
            
            const positionLocation = gl.getAttribLocation(utils.grid, 'a_position');
            gl.enableVertexAttribArray(positionLocation);
            gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);
            
            gl.uniform2f(gl.getUniformLocation(utils.grid, 'u_bounds'), bounds.width, bounds.height);
            // Semi-transparent black background
            gl.uniform4f(gl.getUniformLocation(utils.grid, 'u_color'), 0.0, 0.0, 0.0, 0.7);
            gl.uniform1i(gl.getUniformLocation(utils.grid, 'u_dashed'), 0);
            gl.uniform1i(gl.getUniformLocation(utils.grid, 'u_horizontal'), 0);
            
            gl.drawArrays(gl.TRIANGLES, 0, backgroundVertices.length / 2);
            
            gl.deleteBuffer(positionBuffer);
        }
        
        // Draw all text labels on top of backgrounds
        for (const { label, x, y } of labelData) {
            utils.drawText(label, x, y, bounds, {
                font: font,
                fillStyle: '#cccccc'
            });
        }

        return false;
    }
}
