import { type RenderContext, RenderObject, type RenderBounds } from "@voltex-viewer/plugin-api";
import { getAxisTicks } from './timeTicks';

export class GridRenderObject {
    constructor(parent: RenderObject) {
        parent.addChild({
            zIndex: -50,
            render: this.render.bind(this),
        });
    }

    render(context: RenderContext, bounds: RenderBounds): boolean {
        const { render, state } = context;
        const { gl, utils } = render;

        const ticks = getAxisTicks(state, bounds.width);
        const realtime = state.timeMode === 'realtime';

        const normal: number[] = [];
        const strong: number[] = [];
        for (const tick of ticks.minor) {
            const x = Math.round(tick.x);
            if (x < 0 || x > bounds.width) continue;
            normal.push(x, 0, x, bounds.height);
        }
        for (const tick of ticks.major) {
            const x = Math.round(tick.x);
            if (x < 0 || x > bounds.width) continue;
            (realtime ? strong : normal).push(x, 0, x, bounds.height);
        }

        const program = utils.grid;
        gl.useProgram(program);
        const positionBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);

        const positionLocation = gl.getAttribLocation(program, 'a_position');
        gl.enableVertexAttribArray(positionLocation);
        gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);

        gl.uniform2f(gl.getUniformLocation(program, 'u_bounds'), bounds.width, bounds.height);
        gl.uniform2f(gl.getUniformLocation(program, 'u_offset'), 0, 0);
        gl.uniform1i(gl.getUniformLocation(program, 'u_dashed'), 1);
        gl.uniform1i(gl.getUniformLocation(program, 'u_horizontal'), 0);
        gl.uniform1f(gl.getUniformLocation(program, 'u_dashSize'), 4.0);

        const colorLocation = gl.getUniformLocation(program, 'u_color');
        const draw = (lines: number[], color: [number, number, number, number]) => {
            if (lines.length === 0) return;
            gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(lines), gl.STATIC_DRAW);
            gl.uniform4f(colorLocation, ...color);
            gl.drawArrays(gl.LINES, 0, lines.length / 2);
        };
        draw(normal, [0.267, 0.267, 0.267, 0.8]);
        draw(strong, [0.45, 0.45, 0.45, 0.9]);

        gl.deleteBuffer(positionBuffer);
        gl.disableVertexAttribArray(positionLocation);

        return false;
    }
}
