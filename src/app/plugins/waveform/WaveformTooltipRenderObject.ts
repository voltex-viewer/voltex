import { hexToRgba, type RenderBounds, type Signal, type WebGLUtils, type RenderContext, type RenderObject, type Row } from "../../Plugin";
import { WaveformConfig } from './WaveformConfig';
import { WaveformRowHoverOverlayRenderObject } from './WaveformRowHoverOverlayRenderObject';

export interface SignalTooltipData {
    signal: Signal;
    time: number;
    value: number;
    display: number | string;
    dataIndex: number;
    color: string;
}

export interface TooltipData {
    visible: boolean;
    x: number;
    y: number;
    signals: SignalTooltipData[];
    yScale: number;
}

export class WaveformTooltipRenderObject {
    constructor(
        parent: RenderObject,
        private config: WaveformConfig,
        private waveformOverlays: Map<Row, WaveformRowHoverOverlayRenderObject>,
        zIndex: number = 10000) { // Very high z-index to appear on top
        parent.addChild({
            zIndex: zIndex,
            render: this.render.bind(this),
        })
    }

    private formatValue(signalData: SignalTooltipData, yScale: number): string {
        try {
            const { signal, value, time, color, dataIndex, display } = signalData;
            const name = signal.source.name;
            
            const formatFunction = new Function(
                'value', 'time', 'name', 'color', 'dataIndex', 'yScale', 'display',
                `return ${this.config.formatTooltip}`);
            return String(formatFunction(value, time, name, color, dataIndex, yScale, display));
        } catch (error) {
            console.warn('Error in custom tooltip formatter:', error);
            return "Error";
        }
    }

    render(context: RenderContext, bounds: RenderBounds): boolean {
        const tooltipDatas = Array.from(this.waveformOverlays.values().map(overlay => overlay.tooltipData).filter(data => data !== null));
        if (tooltipDatas.length === 0) {
            return false;
        }
        const tooltipData = tooltipDatas[0];

        const { render } = context;
        const { utils, gl } = render;

        const font = '12px "Open Sans", sans-serif';
        const padding = 6;
        const lineHeight = utils.measureText('0123456789.', font).renderHeight + padding;
        const colorIndicatorSize = 8;
        const colorIndicatorPadding = 4;
        
        // Build lines of text with color information
        const lines: Array<{ text: string; color: string }> = [];
        
        for (const signal of tooltipData.signals) {
            lines.push({
                text: this.formatValue(signal, tooltipData.yScale),
                color: signal.color
            });
        }

        // Calculate tooltip dimensions
        const maxTextWidth = Math.max(...lines.map(line => utils.measureText(line.text, font).renderWidth));
        const tooltipWidth = maxTextWidth + colorIndicatorSize + colorIndicatorPadding + padding * 2;
        const tooltipHeight = lines.length * lineHeight + padding * 2;

        // Calculate tooltip position (offset from cursor to avoid blocking view)
        const tooltipX = Math.min(tooltipData.x + 15, bounds.width - tooltipWidth);
        const tooltipY = Math.max(tooltipData.y - 10, 20);

        // Draw background rectangle
        this.drawTooltipBackground(gl,
            utils,
            tooltipX - padding,
            tooltipY - padding,
            tooltipWidth,
            tooltipHeight,
            bounds
        );

        // Draw text lines with color indicators
        lines.forEach((line, index) => {
            const y = tooltipY + index * lineHeight;
            
            // Draw color indicator (small filled circle)
            this.drawColorIndicator(gl, utils, tooltipX, y + colorIndicatorSize / 2, colorIndicatorSize, line.color, bounds);
            
            // Draw text
            utils.drawText(
                line.text,
                tooltipX + colorIndicatorSize + colorIndicatorPadding,
                y,
                { width: bounds.width, height: bounds.height },
                {
                    font,
                    fillStyle: '#ffffff'
                }
            );
        });

        return false;
    }

    private drawColorIndicator(
        gl: WebGLRenderingContext,
        utils: WebGLUtils,
        x: number,
        y: number,
        size: number,
        color: string,
        bounds: RenderBounds
    ): void {
        const radius = size / 2;
        const vertices = this.createCircleVertices(x + radius, y, radius);

        gl.useProgram(utils.grid);

        const buffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);

        const positionLocation = gl.getAttribLocation(utils.grid, 'a_position');
        gl.enableVertexAttribArray(positionLocation);
        gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);

        gl.uniform2f(gl.getUniformLocation(utils.grid, 'u_bounds'), bounds.width, bounds.height);
        
        const rgba = hexToRgba(color);
        gl.uniform4f(gl.getUniformLocation(utils.grid, 'u_color'), rgba[0], rgba[1], rgba[2], rgba[3]);
        gl.uniform1i(gl.getUniformLocation(utils.grid, 'u_dashed'), 0);
        gl.uniform1i(gl.getUniformLocation(utils.grid, 'u_horizontal'), 0);

        gl.drawArrays(gl.TRIANGLES, 0, vertices.length / 2);

        gl.disableVertexAttribArray(positionLocation);
        gl.deleteBuffer(buffer);
    }

    private createCircleVertices(centerX: number, centerY: number, radius: number): Float32Array {
        const vertices: number[] = [];
        const segments = 12; // Number of triangle segments to approximate circle

        for (let i = 0; i < segments; i++) {
            const angle1 = (i / segments) * 2 * Math.PI;
            const angle2 = ((i + 1) / segments) * 2 * Math.PI;
            
            // Triangle from center to two points on circumference
            vertices.push(centerX, centerY);
            vertices.push(centerX + Math.cos(angle1) * radius, centerY + Math.sin(angle1) * radius);
            vertices.push(centerX + Math.cos(angle2) * radius, centerY + Math.sin(angle2) * radius);
        }

        return new Float32Array(vertices);
    }

    private drawTooltipBackground(
        gl: WebGLRenderingContext,
        utils: WebGLUtils, 
        x: number, 
        y: number, 
        width: number, 
        height: number, 
        bounds: RenderBounds
    ): void {
        const radius = 3;
        const vertices = this.createRoundedRectVertices(x, y, width, height, radius);

        // Use the grid program to draw the rounded rectangle
        gl.useProgram(utils.grid);

        const buffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);

        const positionLocation = gl.getAttribLocation(utils.grid, 'a_position');
        gl.enableVertexAttribArray(positionLocation);
        gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);

        gl.uniform2f(gl.getUniformLocation(utils.grid, 'u_bounds'), bounds.width, bounds.height);
        gl.uniform4f(gl.getUniformLocation(utils.grid, 'u_color'), 0.0, 0.0, 0.0, 0.7); // Semi-transparent black
        gl.uniform1i(gl.getUniformLocation(utils.grid, 'u_dashed'), 0);
        gl.uniform1i(gl.getUniformLocation(utils.grid, 'u_horizontal'), 0);

        gl.drawArrays(gl.TRIANGLES, 0, vertices.length / 2);

        gl.disableVertexAttribArray(positionLocation);
        gl.deleteBuffer(buffer);
    }

    private createRoundedRectVertices(x: number, y: number, width: number, height: number, radius: number): Float32Array {
        const vertices: number[] = [];
        const segments = 6; // Number of segments per corner for smoothness

        // Clamp radius to not exceed half of width or height
        const r = Math.min(radius, Math.min(width / 2, height / 2));

        // Create the main rectangle (without corners)
        const innerX1 = x + r;
        const innerX2 = x + width - r;
        const innerY1 = y + r;
        const innerY2 = y + height - r;

        // Main rectangle body (two triangles)
        vertices.push(innerX1, y, innerX2, y, innerX1, y + height);
        vertices.push(innerX2, y, innerX2, y + height, innerX1, y + height);

        // Left rectangle
        vertices.push(x, innerY1, innerX1, innerY1, x, innerY2);
        vertices.push(innerX1, innerY1, innerX1, innerY2, x, innerY2);

        // Right rectangle
        vertices.push(innerX2, innerY1, x + width, innerY1, innerX2, innerY2);
        vertices.push(x + width, innerY1, x + width, innerY2, innerX2, innerY2);

        // Create rounded corners
        const corners = [
            { centerX: innerX1, centerY: innerY1, startAngle: Math.PI },          // Bottom-left
            { centerX: innerX2, centerY: innerY1, startAngle: 3 * Math.PI / 2 },  // Bottom-right
            { centerX: innerX2, centerY: innerY2, startAngle: 0 },                // Top-right
            { centerX: innerX1, centerY: innerY2, startAngle: Math.PI / 2 }       // Top-left
        ];

        for (const corner of corners) {
            for (let i = 0; i < segments; i++) {
                const angle1 = corner.startAngle + (i / segments) * (Math.PI / 2);
                const angle2 = corner.startAngle + ((i + 1) / segments) * (Math.PI / 2);
                vertices.push(
                    corner.centerX, corner.centerY,
                    corner.centerX + Math.cos(angle1) * r, corner.centerY + Math.sin(angle1) * r,
                    corner.centerX + Math.cos(angle2) * r, corner.centerY + Math.sin(angle2) * r
                );
            }
        }

        return new Float32Array(vertices);
    }
}
