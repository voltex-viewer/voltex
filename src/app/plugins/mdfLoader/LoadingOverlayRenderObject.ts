import { RenderObjectArgs, type RenderBounds, type RenderContext, px } from "@voltex-viewer/plugin-api";

export function loadingOverlayRenderObject(): RenderObjectArgs & { updateChannelCount(count: number): void } {
    let channelCount = 0;
    let rotation = 0;

    return {
        zIndex: 10000,
        x: px(0),
        y: px(0),
        width: { type: 'percentage', value: 100 },
        height: { type: 'percentage', value: 100 },
        
        updateChannelCount(count: number) {
            channelCount = count;
        },
        
        render(context: RenderContext, bounds: RenderBounds): boolean {
            const gl = context.render.gl;
            const utils = context.render.utils;
            
            // Semi-transparent background - cover entire canvas
            gl.enable(gl.BLEND);
            gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
            gl.disable(gl.SCISSOR_TEST);
            gl.viewport(0, 0, context.canvas.width, context.canvas.height);
            gl.clearColor(0, 0, 0, 0.7);
            gl.clear(gl.COLOR_BUFFER_BIT);
            
            // Center position
            const centerX = bounds.x + bounds.width / 2;
            const centerY = bounds.y + bounds.height / 2;
            
            // Update rotation for animation
            rotation += 0.1;
            
            // Draw spinner dots using WebGL points
            const spinnerRadius = 25;
            const segments = 8;
            const dotRadius = 5;
            
            // Create shader program for drawing circles
            const vertexShaderSource = `
                attribute vec2 position;
                uniform vec2 resolution;
                void main() {
                    vec2 clipSpace = ((position / resolution) * 2.0 - 1.0) * vec2(1, -1);
                    gl_Position = vec4(clipSpace, 0, 1);
                    gl_PointSize = ${dotRadius * 2.0 * context.dpr}.0;
                }
            `;
            
            const fragmentShaderSource = `
                precision mediump float;
                uniform vec4 color;
                void main() {
                    vec2 coord = gl_PointCoord - vec2(0.5);
                    if (length(coord) > 0.5) {
                        discard;
                    }
                    gl_FragColor = color;
                }
            `;
            
            const vertexShader = utils.createShader('vertex-shader', vertexShaderSource);
            const fragmentShader = utils.createShader('fragment-shader', fragmentShaderSource);
            const program = utils.createProgram(vertexShader, fragmentShader);
            
            gl.useProgram(program);
            
            const positionLoc = gl.getAttribLocation(program, 'position');
            const resolutionLoc = gl.getUniformLocation(program, 'resolution');
            const colorLoc = gl.getUniformLocation(program, 'color');
            
            gl.uniform2f(resolutionLoc, context.canvas.width, context.canvas.height);
            
            const positions = new Float32Array(segments * 2);
            for (let i = 0; i < segments; i++) {
                const angle = rotation + (i * Math.PI * 2) / segments;
                positions[i * 2] = (centerX + Math.cos(angle) * spinnerRadius) * context.dpr;
                positions[i * 2 + 1] = (centerY + Math.sin(angle) * spinnerRadius) * context.dpr;
            }
            
            const buffer = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
            gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);
            
            gl.enableVertexAttribArray(positionLoc);
            gl.vertexAttribPointer(positionLoc, 2, gl.FLOAT, false, 0, 0);
            
            for (let i = 0; i < segments; i++) {
                const opacity = 0.3 + (i / segments) * 0.7;
                gl.uniform4f(colorLoc, 100/255, 150/255, 255/255, opacity);
                gl.drawArrays(gl.POINTS, i, 1);
            }
            
            gl.deleteBuffer(buffer);
            gl.deleteProgram(program);
            gl.deleteShader(vertexShader);
            gl.deleteShader(fragmentShader);
            
            // Draw channel count
            const countText = `${channelCount} channel${channelCount !== 1 ? 's' : ''} loaded`;
            const countFont = utils.getDefaultFont('normal', '13px');
            const countMetrics = utils.measureText(countText, countFont);
            utils.drawText(
                countText,
                centerX - countMetrics.renderWidth / 2,
                centerY + 45,
                bounds,
                {
                    fillStyle: '#aaaaaa',
                    font: countFont
                }
            );
            
            return true; // Request next frame for animation
        }
    };
}

