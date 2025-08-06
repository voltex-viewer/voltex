export class WebGLUtils {
    line: WebGLProgram;
    grid: WebGLProgram;
    private text: WebGLProgram;
    private textBuffer: WebGLBuffer;
    private textCanvas: HTMLCanvasElement;
    private textCtx: CanvasRenderingContext2D;
    private textTexture: WebGLTexture;

    constructor(private gl: WebGLRenderingContext) {
        const lineVertexShader = this.createShader('vertex-shader', `
            attribute vec2 a_position;
            uniform vec2 u_bounds;
            varying vec2 v_position;
            
            void main() {
                vec2 zeroToOne = a_position / u_bounds;
                vec2 zeroToTwo = zeroToOne * 2.0;
                vec2 clipSpace = zeroToTwo - 1.0;
                gl_Position = vec4(clipSpace * vec2(1, -1), 0, 1);
                v_position = a_position;
            }
        `);

        const lineFragmentShader = this.createShader('fragment-shader', `
            precision mediump float;
            uniform vec4 u_color;
            uniform bool u_dashed;
            uniform float u_dashSize;
            varying vec2 v_position;
            
            void main() {
                if (u_dashed) {
                    float dashCoord = v_position.y;
                    float dashPos = mod(floor(dashCoord / u_dashSize), 2.0);
                    if (dashPos > 0.5) {
                        discard;
                    }
                }
                gl_FragColor = u_color;
            }
        `);

        this.line = this.createProgram(lineVertexShader, lineFragmentShader);
        this.grid = this.createProgram(lineVertexShader, lineFragmentShader);

        const textVertexShader = this.createShader('vertex-shader', `
            attribute vec2 a_position;
            attribute vec2 a_texCoord;
            uniform vec2 u_bounds;
            varying vec2 v_texCoord;
            
            void main() {
                gl_Position = vec4((a_position / u_bounds * 2.0 - 1.0) * vec2(1, -1), 0, 1);
                v_texCoord = a_texCoord;
            }
        `);
        
        const textFragmentShader = this.createShader('fragment-shader', `
            precision mediump float;
            uniform sampler2D u_texture;
            varying vec2 v_texCoord;
            
            void main() {
                gl_FragColor = texture2D(u_texture, v_texCoord);
            }
        `);

        this.text = this.createProgram(textVertexShader, textFragmentShader);
        
        const textBuffer = this.gl.createBuffer();
        if (!textBuffer) {
            throw new Error('Failed to create text buffer');
        }
        this.textBuffer = textBuffer;

        this.textCanvas = document.createElement('canvas');
        const textCtx = this.textCanvas.getContext('2d');
        if (!textCtx) {
            throw new Error('Failed to create text canvas context');
        }
        this.textCtx = textCtx;

        const textTexture = this.gl.createTexture();
        if (!textTexture) {
            throw new Error('Failed to create text texture');
        }
        this.textTexture = textTexture;
    }

    createShader(type: 'fragment-shader' | 'vertex-shader', source: string): WebGLShader {
        const shader = this.gl.createShader(type === 'fragment-shader' ? this.gl.FRAGMENT_SHADER : this.gl.VERTEX_SHADER);
        if (!shader) {
            throw new Error('Failed to create WebGL shader');
        }

        this.gl.shaderSource(shader, source);
        this.gl.compileShader(shader);

        if (!this.gl.getShaderParameter(shader, this.gl.COMPILE_STATUS)) {
            const err = this.gl.getShaderInfoLog(shader);
            this.gl.deleteShader(shader);
            throw new Error('Shader compilation error: ' + err);
        }
        
        return shader;
    }

    createProgram(vertexShader: WebGLShader, fragmentShader: WebGLShader): WebGLProgram {
        const program = this.gl.createProgram();
        if (!program) {
            throw new Error('Failed to create WebGL program');
        }

        this.gl.attachShader(program, vertexShader);
        this.gl.attachShader(program, fragmentShader);
        this.gl.linkProgram(program);

        if (!this.gl.getProgramParameter(program, this.gl.LINK_STATUS)) {
            const err = this.gl.getProgramInfoLog(program);
            this.gl.deleteProgram(program);
            throw new Error('Program linking error: ' + err);
        }
        
        return program;
    }
    
    static hexToRgba(hex: string, alpha: number = 1.0): [number, number, number, number] {
        const r = parseInt(hex.slice(1, 3), 16) / 255;
        const g = parseInt(hex.slice(3, 5), 16) / 255;
        const b = parseInt(hex.slice(5, 7), 16) / 255;
        return [r, g, b, alpha];
    }

    createTextTexture(
        text: string, 
        font: string = '12px "Open Sans", sans-serif', 
        fillStyle: string = '#ffffff',
        strokeStyle?: string,
        strokeWidth?: number,
        padding: number = 0,
    ):  HTMLCanvasElement {
        const dpr = window.devicePixelRatio || 1;
        
        // Measure text at base resolution
        this.textCtx.font = font;
        const metrics = this.textCtx.measureText(text);
        const textWidth = Math.ceil(metrics.width) + padding * 2;
        const textHeight = Math.ceil(metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent) + padding * 2;

        // Create high-DPI canvas
        this.textCanvas.width = textWidth * dpr;
        this.textCanvas.height = textHeight * dpr;
        
        // Set CSS size to logical pixels
        this.textCanvas.style.width = `${textWidth}px`;
        this.textCanvas.style.height = `${textHeight}px`;

        // Scale context for high-DPI
        this.textCtx.scale(dpr, dpr);
        this.textCtx.font = font;
        this.textCtx.fillStyle = fillStyle;
        this.textCtx.textBaseline = 'top';
        this.textCtx.textAlign = 'left';
        
        // Chrome-specific text rendering improvements
        this.textCtx.imageSmoothingEnabled = false;
        
        if (strokeStyle && strokeWidth) {
            this.textCtx.strokeStyle = strokeStyle;
            this.textCtx.lineWidth = strokeWidth;
        }
        
        this.textCtx.clearRect(0, 0, textWidth, textHeight);
 
        if (strokeStyle && strokeWidth) {
            this.textCtx.strokeText(text, padding, padding);
        }
        this.textCtx.fillText(text, padding, padding);

        return this.textCanvas;
    }

    drawText(
        text: string,
        x: number,
        y: number,
        bounds: { width: number; height: number },
        options: {
            font?: string;
            fillStyle?: string;
            strokeStyle?: string;
            strokeWidth?: number;
        } = {}
    ): void {
        const padding = 2;
        const textCanvas = this.createTextTexture(
            text,
            options.font,
            options.fillStyle,
            options.strokeStyle,
            options.strokeWidth,
            padding
        );

        this.gl.bindTexture(this.gl.TEXTURE_2D, this.textTexture);
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, this.gl.NEAREST);
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, this.gl.NEAREST);
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_S, this.gl.CLAMP_TO_EDGE);
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_T, this.gl.CLAMP_TO_EDGE);
        this.gl.texImage2D(this.gl.TEXTURE_2D, 0, this.gl.RGBA, this.gl.RGBA, this.gl.UNSIGNED_BYTE, textCanvas);

        const dpr = window.devicePixelRatio || 1;
        const width = textCanvas.width / dpr;
        const height = textCanvas.height / dpr;

        const adjustedX = Math.floor(x - padding);
        const adjustedY = Math.floor(y - padding);
        const vertices = new Float32Array([
            adjustedX, adjustedY, 0, 0,
            adjustedX + width, adjustedY, 1, 0,
            adjustedX, adjustedY + height, 0, 1,
            adjustedX + width, adjustedY + height, 1, 1
        ]);

        this.gl.useProgram(this.text);
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.textBuffer);
        this.gl.bufferData(this.gl.ARRAY_BUFFER, vertices, this.gl.STATIC_DRAW);

        const positionLocation = this.gl.getAttribLocation(this.text, 'a_position');
        const texCoordLocation = this.gl.getAttribLocation(this.text, 'a_texCoord');

        this.gl.enableVertexAttribArray(positionLocation);
        this.gl.vertexAttribPointer(positionLocation, 2, this.gl.FLOAT, false, 4 * 4, 0);

        this.gl.enableVertexAttribArray(texCoordLocation);
        this.gl.vertexAttribPointer(texCoordLocation, 2, this.gl.FLOAT, false, 4 * 4, 2 * 4);

        const resolutionLocation = this.gl.getUniformLocation(this.text, 'u_bounds');
        this.gl.uniform2f(resolutionLocation, bounds.width, bounds.height);

        const textureLocation = this.gl.getUniformLocation(this.text, 'u_texture');
        this.gl.uniform1i(textureLocation, 0);

        this.gl.activeTexture(this.gl.TEXTURE0);
        this.gl.bindTexture(this.gl.TEXTURE_2D, this.textTexture);

        this.gl.drawArrays(this.gl.TRIANGLE_STRIP, 0, 4);

        this.gl.disableVertexAttribArray(positionLocation);
        this.gl.disableVertexAttribArray(texCoordLocation);
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, null);
        this.gl.bindTexture(this.gl.TEXTURE_2D, null);
        this.gl.useProgram(null);
    }
}
