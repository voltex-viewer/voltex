export class WebGLUtilsImpl {
    line: WebGLProgram;
    grid: WebGLProgram;
    private text: WebGLProgram;
    private textBuffer: WebGLBuffer;
    private textCanvas: HTMLCanvasElement;
    private textCtx: CanvasRenderingContext2D;
    private textureCache: Map<string, { texture: WebGLTexture; width: number; height: number; usedThisFrame: boolean }> = new Map();
    private cacheKeysUsedThisFrame: Set<string> = new Set();
    private measureTextCache: Map<string, {metrics: TextMetrics, renderWidth: number, renderHeight: number}> = new Map();

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
            uniform bool u_horizontal;
            uniform float u_dashSize;
            varying vec2 v_position;
            
            void main() {
                if (u_dashed) {
                    float dashCoord = u_horizontal ? v_position.x : v_position.y;
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
            uniform vec2 u_translation;
            uniform vec2 u_scale;
            varying vec2 v_texCoord;
            
            void main() {
                vec2 scaledPosition = a_position * u_scale + u_translation;
                gl_Position = vec4((scaledPosition / u_bounds * 2.0 - 1.0) * vec2(1, -1), 0, 1);
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
        
        // Create reusable quad buffer with normalized coordinates
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.textBuffer);
        const quadVertices = new Float32Array([
            0, 0, 0, 0,  // bottom-left
            1, 0, 1, 0,  // bottom-right
            0, 1, 0, 1,  // top-left
            1, 1, 1, 1   // top-right
        ]);
        this.gl.bufferData(this.gl.ARRAY_BUFFER, quadVertices, this.gl.STATIC_DRAW);
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, null);

        this.textCanvas = document.createElement('canvas');
        const textCtx = this.textCanvas.getContext('2d');
        if (!textCtx) {
            throw new Error('Failed to create text canvas context');
        }
        this.textCtx = textCtx;
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

    measureText(text: string, font: string = '12px sans-serif', padding: number = 0, strokeWidth: number = 0): {metrics: TextMetrics, renderWidth: number, renderHeight: number} {
        const cacheKey = `${text}|${font}|${padding}|${strokeWidth}`;
        
        // Check cache first
        const cachedResult = this.measureTextCache.get(cacheKey);
        if (cachedResult) {
            return cachedResult;
        }
        
        this.textCtx.save();
        this.textCtx.font = font;
        const metrics = this.textCtx.measureText(text);
        this.textCtx.restore();
        
        // Account for stroke width extending beyond the text bounds
        const strokePadding = strokeWidth > 0 ? Math.ceil(strokeWidth) : 0;
        
        const result = {
            metrics,
            renderWidth: Math.ceil(metrics.width) + padding * 2 + strokePadding * 2,
            renderHeight: Math.ceil(metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent) + padding * 2 + strokePadding * 2
        };
        
        // Cache the result
        this.measureTextCache.set(cacheKey, result);
        
        return result;
    }

    createTextTexture(
        text: string, 
        font: string = '12px "Open Sans", sans-serif', 
        fillStyle: string = '#ffffff',
        strokeStyle?: string,
        strokeWidth?: number,
        padding: number = 0,
    ): { texture: WebGLTexture; width: number; height: number } {
        const dpr = window.devicePixelRatio || 1;
        
        // Measure text at base resolution, accounting for stroke width
        const { renderWidth, renderHeight } = this.measureText(text, font, padding, strokeWidth || 0);
        const textWidth = renderWidth;
        const textHeight = renderHeight;

        // Use shared canvas for rendering
        const canvas = this.textCanvas;
        const ctx = this.textCtx;

        // Create high-DPI canvas
        canvas.width = textWidth * dpr;
        canvas.height = textHeight * dpr;
        
        // Set CSS size to logical pixels
        canvas.style.width = `${textWidth}px`;
        canvas.style.height = `${textHeight}px`;

        // Reset and scale context for high-DPI
        ctx.save();
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.font = font;
        ctx.fillStyle = fillStyle;
        ctx.textBaseline = 'top';
        ctx.textAlign = 'left';
        
        // Disable image smoothing for crisp text
        ctx.imageSmoothingEnabled = false;
        
        if (strokeStyle && strokeWidth) {
            ctx.strokeStyle = strokeStyle;
            ctx.lineWidth = strokeWidth;
            ctx.lineJoin = 'round';
            ctx.lineCap = 'round';
        }
        
        ctx.clearRect(0, 0, textWidth, textHeight);
        
        // Snap to pixel boundary for crisp rendering
        const textX = Math.round(padding + (strokeWidth || 0) / 2);
        const textY = Math.round(padding + (strokeWidth || 0) / 2);
 
        if (strokeStyle && strokeWidth) {
            ctx.strokeText(text, textX, textY);
        }
        ctx.fillText(text, textX, textY);
        
        ctx.restore();

        // Create WebGL texture
        const texture = this.gl.createTexture();
        if (!texture) {
            throw new Error('Failed to create text texture');
        }

        // Upload canvas data to texture
        this.gl.bindTexture(this.gl.TEXTURE_2D, texture);
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, this.gl.NEAREST);
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, this.gl.NEAREST);
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_S, this.gl.CLAMP_TO_EDGE);
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_T, this.gl.CLAMP_TO_EDGE);
        this.gl.texImage2D(this.gl.TEXTURE_2D, 0, this.gl.RGBA, this.gl.RGBA, this.gl.UNSIGNED_BYTE, canvas);

        return { texture, width: textWidth, height: textHeight };
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
        
        const cacheKey = `${text}|${options.font}|${options.fillStyle}|${options.strokeStyle}|${options.strokeWidth}|${padding}`;

        // Check if texture exists in cache
        let textureInfo = this.textureCache.get(cacheKey);
        if (textureInfo) {
            textureInfo.usedThisFrame = true;
            this.cacheKeysUsedThisFrame.add(cacheKey);
        } else {
            // Create new texture with resolved values
            const newTextureInfo = this.createTextTexture(
                text,
                options.font,
                options.fillStyle,
                options.strokeStyle,
                options.strokeWidth,
                padding
            );
            
            // Cache the texture
            textureInfo = {
                texture: newTextureInfo.texture,
                width: newTextureInfo.width,
                height: newTextureInfo.height,
                usedThisFrame: true
            };
            this.textureCache.set(cacheKey, textureInfo);
            this.cacheKeysUsedThisFrame.add(cacheKey);
        }

        this.gl.bindTexture(this.gl.TEXTURE_2D, textureInfo.texture);

        const width = textureInfo.width;
        const height = textureInfo.height;

        const adjustedX = Math.floor(x - padding);
        const adjustedY = Math.floor(y - padding);

        this.gl.useProgram(this.text);
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.textBuffer);

        const positionLocation = this.gl.getAttribLocation(this.text, 'a_position');
        const texCoordLocation = this.gl.getAttribLocation(this.text, 'a_texCoord');

        this.gl.enableVertexAttribArray(positionLocation);
        this.gl.vertexAttribPointer(positionLocation, 2, this.gl.FLOAT, false, 4 * 4, 0);

        this.gl.enableVertexAttribArray(texCoordLocation);
        this.gl.vertexAttribPointer(texCoordLocation, 2, this.gl.FLOAT, false, 4 * 4, 2 * 4);

        const boundsLocation = this.gl.getUniformLocation(this.text, 'u_bounds');
        this.gl.uniform2f(boundsLocation, bounds.width, bounds.height);

        const translationLocation = this.gl.getUniformLocation(this.text, 'u_translation');
        this.gl.uniform2f(translationLocation, adjustedX, adjustedY);

        const scaleLocation = this.gl.getUniformLocation(this.text, 'u_scale');
        this.gl.uniform2f(scaleLocation, width, height);

        const textureLocation = this.gl.getUniformLocation(this.text, 'u_texture');
        this.gl.uniform1i(textureLocation, 0);

        this.gl.activeTexture(this.gl.TEXTURE0);
        this.gl.bindTexture(this.gl.TEXTURE_2D, textureInfo.texture);

        this.gl.drawArrays(this.gl.TRIANGLE_STRIP, 0, 4);

        this.gl.disableVertexAttribArray(positionLocation);
        this.gl.disableVertexAttribArray(texCoordLocation);
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, null);
        this.gl.bindTexture(this.gl.TEXTURE_2D, null);
        this.gl.useProgram(null);
    }

    startFrame(): void {
        this.cacheKeysUsedThisFrame.clear();
        for (const cached of this.textureCache.values()) {
            cached.usedThisFrame = false;
        }
    }

    endFrame(): void {
        const keysToDelete: string[] = [];
        for (const [key, cached] of this.textureCache.entries()) {
            if (!cached.usedThisFrame) {
                this.gl.deleteTexture(cached.texture);
                keysToDelete.push(key);
            }
        }
        for (const key of keysToDelete) {
            this.textureCache.delete(key);
        }
    }
}
