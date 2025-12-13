import { 
    type PluginContext, 
    type RenderContext, 
    type RenderBounds,
    type RenderObject,
    type Row,
    type WebGLUtils
} from '@voltex-viewer/plugin-api';

const alpha = 0.8;

export class CursorRenderObject {
    private position: number | null = null;
    private renderObjects: RenderObject[] = [];
    private rectBuffer: { buffer: WebGLBuffer, vertexCount: number } | null = null;

    constructor(
        private context: PluginContext,
        private cursorNumber: number,
        private color: string,
        initialTime: number | null,
        hoveredRow?: Row
    ) {
        if (initialTime !== null) {
            this.position = this.snapToNearestPoint(initialTime, hoveredRow);
        }
    }

    updatePosition(time: number, hoveredRow?: Row): void {
        const snappedTime = this.snapToNearestPoint(time, hoveredRow);
        if (snappedTime !== null) {
            this.position = snappedTime;
        }
    }

    getPosition(): number | null {
        return this.position;
    }

    getCursorNumber(): number {
        return this.cursorNumber;
    }

    getColor(): string {
        return this.color;
    }

    cleanup(): void {
        for (const renderObject of this.renderObjects) {
            if (renderObject.parent) {
                renderObject.parent.removeChild(renderObject);
            }
        }
        this.renderObjects = [];
        
        if (this.rectBuffer) {
            this.context.webgl.gl.deleteBuffer(this.rectBuffer.buffer);
        }
    }

    addRowRenderObjects(rows: Row[]): void {
        for (const row of rows) {
            if (row.signals.length > 0) {
                this.renderObjects.push(row.mainArea.addChild({
                    zIndex: 1000,
                    render: this.render.bind(this),
                }));
            } else {
                this.renderObjects.push(row.mainArea.addChild({
                    zIndex: 1000,
                    render: this.renderTimeAxis.bind(this),
                }));
            }
        }
    }

    private timeToScreenX(time: number): number {
        const { state } = this.context;
        return time * state.pxPerSecond - state.offset;
    }

    private snapToNearestPoint(time: number, hoveredRow?: Row): number | null {
        // If no row is hovered, don't snap
        if (!hoveredRow) {
            return time;
        }
        
        const snapDistancePx = 10;
        const { state } = this.context;
        const snapDistanceTime = snapDistancePx / state.pxPerSecond;
        
        let nearestTime: number | null = null;
        let nearestDistance = snapDistanceTime;

        // Only snap to signals in the hovered row
        for (const signal of hoveredRow.signals) {
            const startIndex = this.binarySearch(signal.time, time - snapDistanceTime);
            const endIndex = this.binarySearch(signal.time, time + snapDistanceTime);
            
            for (let i = startIndex; i <= endIndex && i < signal.time.length; i++) {
                const pointTime = signal.time.valueAt(i);
                const distance = Math.abs(pointTime - time);
                
                if (distance < nearestDistance) {
                    nearestDistance = distance;
                    nearestTime = pointTime;
                }
            }
        }

        return nearestTime !== null ? nearestTime : time;
    }

    private binarySearch(sequence: { length: number; valueAt(index: number): number }, target: number): number {
        let left = 0;
        let right = sequence.length - 1;
        
        while (left < right) {
            const mid = Math.floor((left + right) / 2);
            if (sequence.valueAt(mid) < target) {
                left = mid + 1;
            } else {
                right = mid;
            }
        }
        
        return left;
    }

    private render(renderContext: RenderContext, bounds: RenderBounds): boolean {
        if (this.position === null) return false;
        
        const { render } = renderContext;
        const { gl, utils } = render;
        const x = Math.round(this.timeToScreenX(this.position));
        
        if (x < 0 || x > bounds.width) return false;

        gl.useProgram(utils.grid);
        const buffer = gl.createBuffer();
        if (!buffer) return false;

        const lineVertices = new Float32Array([
            x, 0,
            x, bounds.height
        ]);

        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.bufferData(gl.ARRAY_BUFFER, lineVertices, gl.STATIC_DRAW);
        
        const positionLocation = gl.getAttribLocation(utils.grid, 'a_position');
        gl.enableVertexAttribArray(positionLocation);
        gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);
        
        gl.uniform2f(gl.getUniformLocation(utils.grid, 'u_bounds'), bounds.width, bounds.height);
        gl.uniform2f(gl.getUniformLocation(utils.grid, 'u_offset'), 0, 0);
        
        const rgb = this.hexToRgb(this.color);
        gl.uniform4f(gl.getUniformLocation(utils.grid, 'u_color'), rgb[0], rgb[1], rgb[2], alpha);
        gl.uniform1i(gl.getUniformLocation(utils.grid, 'u_dashed'), 0);
        gl.uniform1i(gl.getUniformLocation(utils.grid, 'u_horizontal'), 0);
        
        gl.drawArrays(gl.LINES, 0, 2);
        
        gl.disableVertexAttribArray(positionLocation);
        gl.bindBuffer(gl.ARRAY_BUFFER, null);
        gl.deleteBuffer(buffer);

        return false;
    }

    private renderTimeAxis(renderContext: RenderContext, bounds: RenderBounds): boolean {
        if (this.position === null) return false;
        
        const { render } = renderContext;
        const { gl, utils } = render;
        const x = Math.round(this.timeToScreenX(this.position));
        
        if (x < -20 || x > bounds.width) return false;

        // Calculate blob dimensions first to know where to stop the line
        const label = `${this.cursorNumber}`;
        const { renderWidth: textWidth, renderHeight: textHeight } = utils.measureText(label);
        const padding = 4;
        const blobWidth = textWidth + padding * 2;
        const blobHeight = textHeight + padding * 2;
        const blobX = x - blobWidth / 2;
        const blobY = 2;
        const lineStartY = blobY + blobHeight;

        // Draw line from bottom of blob to bottom of bounds
        gl.useProgram(utils.grid);
        const buffer = gl.createBuffer();
        if (buffer) {
            const lineVertices = new Float32Array([
                x, lineStartY,
                x, bounds.height
            ]);

            gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
            gl.bufferData(gl.ARRAY_BUFFER, lineVertices, gl.STATIC_DRAW);
            
            const positionLocation = gl.getAttribLocation(utils.grid, 'a_position');
            gl.enableVertexAttribArray(positionLocation);
            gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);
            
            gl.uniform2f(gl.getUniformLocation(utils.grid, 'u_bounds'), bounds.width, bounds.height);
            gl.uniform2f(gl.getUniformLocation(utils.grid, 'u_offset'), 0, 0);
            
            const rgb = this.hexToRgb(this.color);
            gl.uniform4f(gl.getUniformLocation(utils.grid, 'u_color'), rgb[0], rgb[1], rgb[2], alpha);
            gl.uniform1i(gl.getUniformLocation(utils.grid, 'u_dashed'), 0);
            gl.uniform1i(gl.getUniformLocation(utils.grid, 'u_horizontal'), 0);
            
            gl.drawArrays(gl.LINES, 0, 2);
            
            gl.disableVertexAttribArray(positionLocation);
            gl.bindBuffer(gl.ARRAY_BUFFER, null);
            gl.deleteBuffer(buffer);
        }

        // Draw background blob with rounded corners
        const rgb = this.hexToRgb(this.color);
        this.drawRoundedRect(gl, utils, blobX, blobY, blobWidth, blobHeight, 6, [...rgb, alpha], bounds);
        
        // Draw text with contrasting color
        const contrastColor = this.getContrastColor(this.color);
        utils.drawText(label, blobX + padding, blobY + padding, bounds, {
            fillStyle: contrastColor
        });

        return false;
    }

    private drawRoundedRect(
        gl: WebGL2RenderingContext,
        utils: WebGLUtils,
        x: number,
        y: number,
        width: number,
        height: number,
        radius: number,
        rgb: [number, number, number, number],
        bounds: RenderBounds
    ): void {
        if (this.rectBuffer === null) {
            const segments = 8;
            const vertices: number[] = [];
            
            // Clamp radius to not exceed half of width or height
            radius = Math.min(radius, width / 2, height / 2);
            
            // Center point for triangle fan (relative to 0,0)
            const cx = width / 2;
            const cy = height / 2;
            
            // Add center point as first vertex for triangle fan
            vertices.push(cx, cy);
            
            // Helper to add a corner arc (relative to 0,0)
            const addCorner = (cornerX: number, cornerY: number, startAngle: number) => {
                for (let i = 0; i <= segments; i++) {
                    const angle = startAngle + (i / segments) * (Math.PI / 2);
                    const px = cornerX + Math.cos(angle) * radius;
                    const py = cornerY + Math.sin(angle) * radius;
                    vertices.push(px, py);
                }
            };
            
            // Top-left corner (starting from left edge going to top edge)
            addCorner(radius, radius, Math.PI);
            // Top-right corner (starting from top edge going to right edge)
            addCorner(width - radius, radius, -Math.PI / 2);
            // Bottom-right corner (starting from right edge going to bottom edge)
            addCorner(width - radius, height - radius, 0);
            // Bottom-left corner (starting from bottom edge going to left edge)
            addCorner(radius, height - radius, Math.PI / 2);
            
            // Close the shape by adding the first corner point again
            vertices.push(0, radius);
            
            const rectBuffer = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, rectBuffer);
            gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW);
            this.rectBuffer = {
                buffer: rectBuffer,
                vertexCount: vertices.length / 2
            }
        }

        gl.useProgram(utils.grid);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.rectBuffer.buffer);
        const rectPositionLocation = gl.getAttribLocation(utils.grid, 'a_position');
        gl.enableVertexAttribArray(rectPositionLocation);
        gl.vertexAttribPointer(rectPositionLocation, 2, gl.FLOAT, false, 0, 0);
        
        gl.uniform2f(gl.getUniformLocation(utils.grid, 'u_bounds'), bounds.width, bounds.height);
        gl.uniform2f(gl.getUniformLocation(utils.grid, 'u_offset'), x, y);
        gl.uniform4f(gl.getUniformLocation(utils.grid, 'u_color'), rgb[0], rgb[1], rgb[2], rgb[3]);
        gl.uniform1i(gl.getUniformLocation(utils.grid, 'u_dashed'), 0);
        gl.uniform1i(gl.getUniformLocation(utils.grid, 'u_horizontal'), 0);

        gl.drawArrays(gl.TRIANGLE_FAN, 0, this.rectBuffer.vertexCount);

        gl.disableVertexAttribArray(rectPositionLocation);
        gl.bindBuffer(gl.ARRAY_BUFFER, null);
    }

    private hexToRgb(hex: string): [number, number, number] {
        const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
        return result
            ? [
                parseInt(result[1], 16) / 255,
                parseInt(result[2], 16) / 255,
                parseInt(result[3], 16) / 255,
            ]
            : [1, 1, 1];
    }

    private getContrastColor(hex: string): string {
        const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
        if (!result) return '#000000';
        
        const r = parseInt(result[1], 16);
        const g = parseInt(result[2], 16);
        const b = parseInt(result[3], 16);
        
        // Calculate relative luminance
        const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
        
        // Return black for light colors, white for dark colors
        return luminance > 0.5 ? '#000000' : '#FFFFFF';
    }
}
