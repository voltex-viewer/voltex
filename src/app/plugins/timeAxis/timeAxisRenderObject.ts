import { RenderObject, type RenderBounds, type RenderContext } from "@voltex-viewer/plugin-api";
import { getAxisTicks } from './timeTicks';

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

        const ticks = getAxisTicks(state, bounds.width);
        const rowHeight = TimeAxisRenderObject.rowHeight;
        const gap = TimeAxisRenderObject.gap;

        const lineVertices: number[] = [];

        // Top row: major labels (coarse context). The first major can sit left of the viewport - pin
        // its label to the left edge so the context stays visible. Hide that pinned label once the
        // next major's label gets close, so the two never overlap as you pan.
        const topFont = utils.getDefaultFont('bold', '13px');
        const labelGap = 6;
        const sticky = ticks.major.length > 0 && ticks.major[0].x < 0 ? ticks.major[0] : null;
        const firstVisibleMajor = ticks.major.find(m => Math.round(m.x) >= 0) ?? null;
        if (sticky) {
            const stickyWidth = utils.measureText(sticky.label, topFont).renderWidth;
            if (!firstVisibleMajor || firstVisibleMajor.x > stickyWidth + labelGap) {
                utils.drawText(sticky.label, 0, 2, bounds, { font: topFont, fillStyle: '#ffffff' });
            }
        }
        for (const tick of ticks.major) {
            const x = Math.round(tick.x);
            if (x < 0 || x > bounds.width) continue;
            lineVertices.push(x, 0, x, bounds.height);
            utils.drawText(tick.label, x, 2, bounds, { font: topFont, fillStyle: '#ffffff' });
        }

        // Bottom row: minor labels. Keep a label rendered until its right edge scrolls off the left,
        // so it doesn't pop out of existence the moment the tick crosses the left edge.
        const bottomFont = utils.getDefaultFont('bold', '12px');
        for (const tick of ticks.minor) {
            const x = Math.round(tick.x);
            if (x >= 0 && x <= bounds.width) {
                lineVertices.push(x, rowHeight + gap / 2, x, bounds.height - rowHeight - gap / 2);
            }
            const labelX = x - 3.5;
            const labelWidth = utils.measureText(tick.label, bottomFont).renderWidth;
            if (labelX + labelWidth > 0 && labelX < bounds.width) {
                utils.drawText(tick.label, labelX, rowHeight + gap + 1, bounds, { font: bottomFont, fillStyle: '#ffffff' });
            }
        }

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
}
