import type { RenderObject, RenderBounds, RenderContext, MouseEvent } from "@voltex-viewer/plugin-api";
import { getAbsoluteBounds, px } from "@voltex-viewer/plugin-api";

export class AutoModeButton {
    private autoMode: boolean = true;
    private cachedBuffers: {
        bgVertices: WebGLBuffer;
        borderVertices: WebGLBuffer;
        bgVertexCount: number;
        borderVertexCount: number;
        size: number;
    } | null = null;

    readonly renderObject: RenderObject;

    constructor(
        parent: RenderObject,
        private containerRenderObject: RenderObject,
        private scrollbarWidth: number,
        private onToggle: () => void,
    ) {
        const padding = 4;
        this.renderObject = parent.addChild({
            zIndex: 3001,
            viewport: true,
            x: px(0),
            y: px(padding),
            width: px(24),
            height: px(24),
            render: (context: RenderContext, bounds: RenderBounds): boolean => {
                this.render(context, bounds);
                const containerBounds = getAbsoluteBounds(this.containerRenderObject);
                this.renderObject.x = px(containerBounds.width - 24 - padding - this.scrollbarWidth);
                return false;
            },
            onMouseDown: (event: MouseEvent) => {
                event.stopPropagation();
                if (event.button === 0) {
                    this.onToggle();
                }
                return { preventDefault: true, captureMouse: true };
            },
            onMouseMove: (event: MouseEvent) => {
                event.stopPropagation();
                return { preventDefault: true };
            },
            onMouseUp: (event: MouseEvent) => {
                event.stopPropagation();
            }
        });
    }

    get enabled(): boolean {
        return this.autoMode;
    }

    setAutoMode(enabled: boolean): void {
        this.autoMode = enabled;
    }

    private ensureBuffers(gl: WebGL2RenderingContext, size: number): void {
        if (this.cachedBuffers && this.cachedBuffers.size === size) return;

        if (this.cachedBuffers) {
            gl.deleteBuffer(this.cachedBuffers.bgVertices);
            gl.deleteBuffer(this.cachedBuffers.borderVertices);
        }

        const padding = 1;
        const cornerRadius = 4;
        const borderWidth = 1;
        const segments = 8;

        // Generate background vertices
        const bgVertices = this.generateRoundedRect(padding, padding, size - padding * 2, size - padding * 2, cornerRadius, segments);
        const bgBuffer = gl.createBuffer()!;
        gl.bindBuffer(gl.ARRAY_BUFFER, bgBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(bgVertices), gl.STATIC_DRAW);

        // Generate border vertices
        const bx = padding + borderWidth / 2;
        const by = padding + borderWidth / 2;
        const bw = size - padding * 2 - borderWidth;
        const bh = size - padding * 2 - borderWidth;
        const br = cornerRadius - borderWidth / 2;

        const borderVertices: number[] = [];
        const corners = [
            { cx: bx + bw - br, cy: by + br, startAngle: -Math.PI / 2 },
            { cx: bx + bw - br, cy: by + bh - br, startAngle: 0 },
            { cx: bx + br, cy: by + bh - br, startAngle: Math.PI / 2 },
            { cx: bx + br, cy: by + br, startAngle: Math.PI },
        ];

        for (const corner of corners) {
            for (let i = 0; i <= segments; i++) {
                const angle = corner.startAngle + (i / segments) * (Math.PI / 2);
                borderVertices.push(corner.cx + Math.cos(angle) * br, corner.cy + Math.sin(angle) * br);
            }
        }
        borderVertices.push(borderVertices[0], borderVertices[1]);

        const borderBuffer = gl.createBuffer()!;
        gl.bindBuffer(gl.ARRAY_BUFFER, borderBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(borderVertices), gl.STATIC_DRAW);

        this.cachedBuffers = {
            bgVertices: bgBuffer,
            borderVertices: borderBuffer,
            bgVertexCount: bgVertices.length / 2,
            borderVertexCount: borderVertices.length / 2,
            size
        };
    }

    private generateRoundedRect(x: number, y: number, w: number, h: number, r: number, segments: number): number[] {
        const vertices: number[] = [];
        const cx = x + w / 2;
        const cy = y + h / 2;
        vertices.push(cx, cy);

        const corners = [
            { cx: x + w - r, cy: y + r, startAngle: -Math.PI / 2 },
            { cx: x + w - r, cy: y + h - r, startAngle: 0 },
            { cx: x + r, cy: y + h - r, startAngle: Math.PI / 2 },
            { cx: x + r, cy: y + r, startAngle: Math.PI },
        ];

        for (const corner of corners) {
            for (let i = 0; i <= segments; i++) {
                const angle = corner.startAngle + (i / segments) * (Math.PI / 2);
                vertices.push(corner.cx + Math.cos(angle) * r, corner.cy + Math.sin(angle) * r);
            }
        }
        vertices.push(vertices[1], vertices[2]);
        return vertices;
    }

    private render(context: RenderContext, bounds: RenderBounds): void {
        const { gl, utils } = context.render;

        const size = Math.min(bounds.width, bounds.height);
        this.ensureBuffers(gl, size);
        if (!this.cachedBuffers) return;

        gl.useProgram(utils.line);

        const positionLocation = gl.getAttribLocation(utils.line, 'a_position');
        const boundsLocation = gl.getUniformLocation(utils.line, 'u_bounds');
        const colorLocation = gl.getUniformLocation(utils.line, 'u_color');

        gl.uniform2f(boundsLocation, bounds.width, bounds.height);
        gl.enableVertexAttribArray(positionLocation);

        // Draw background
        gl.bindBuffer(gl.ARRAY_BUFFER, this.cachedBuffers.bgVertices);
        gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);
        if (this.autoMode) {
            gl.uniform4f(colorLocation, 0.14, 0.16, 0.20, 0.95);
        } else {
            gl.uniform4f(colorLocation, 0.12, 0.14, 0.18, 0.8);
        }
        gl.drawArrays(gl.TRIANGLE_FAN, 0, this.cachedBuffers.bgVertexCount);

        // Draw border
        gl.bindBuffer(gl.ARRAY_BUFFER, this.cachedBuffers.borderVertices);
        gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);
        const borderColor = this.autoMode
            ? [0.3, 0.5, 0.7, 0.8]
            : [0.25, 0.27, 0.32, 0.6];
        gl.uniform4f(colorLocation, borderColor[0], borderColor[1], borderColor[2], borderColor[3]);
        gl.drawArrays(gl.LINE_STRIP, 0, this.cachedBuffers.borderVertexCount);

        // Draw icon (dynamic based on autoMode state)
        this.renderIcon(gl, positionLocation, colorLocation, size);

        gl.disableVertexAttribArray(positionLocation);
    }

    private renderIcon(gl: WebGL2RenderingContext, positionLocation: number, colorLocation: WebGLUniformLocation | null, size: number): void {
        const iconColor = this.autoMode
            ? [0.45, 0.75, 1.0, 1.0]
            : [0.4, 0.42, 0.47, 0.8];
        gl.uniform4f(colorLocation, iconColor[0], iconColor[1], iconColor[2], iconColor[3]);

        const cx = size / 2;
        const cy = size / 2;
        const iconSize = size * 0.6;
        const arrowLen = iconSize * 0.35;
        const arrowHead = iconSize * 0.2;
        const arrowWidth = 1.5;
        const offset = iconSize * 0.15;

        const directions = [
            { dx: 1, dy: -1 },
            { dx: 1, dy: 1 },
            { dx: -1, dy: 1 },
            { dx: -1, dy: -1 },
        ];

        const buffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);

        for (const dir of directions) {
            const startX = cx + dir.dx * offset;
            const startY = cy + dir.dy * offset;
            const endX = cx + dir.dx * arrowLen;
            const endY = cy + dir.dy * arrowLen;

            const perpX = -dir.dy * arrowWidth / 2;
            const perpY = dir.dx * arrowWidth / 2;
            const shaftVertices = new Float32Array([
                startX + perpX, startY + perpY,
                startX - perpX, startY - perpY,
                endX + perpX, endY + perpY,
                endX - perpX, endY - perpY,
            ]);
            gl.bufferData(gl.ARRAY_BUFFER, shaftVertices, gl.STATIC_DRAW);
            gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);
            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

            const headVertices = new Float32Array([
                endX, endY,
                endX - dir.dx * arrowHead + dir.dy * arrowHead * 0.5, endY - dir.dy * arrowHead - dir.dx * arrowHead * 0.5,
                endX - dir.dx * arrowHead - dir.dy * arrowHead * 0.5, endY - dir.dy * arrowHead + dir.dx * arrowHead * 0.5,
            ]);
            gl.bufferData(gl.ARRAY_BUFFER, headVertices, gl.STATIC_DRAW);
            gl.drawArrays(gl.TRIANGLES, 0, 3);
        }

        gl.deleteBuffer(buffer);
    }
}
