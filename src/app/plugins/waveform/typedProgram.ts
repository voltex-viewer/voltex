type Vec2 = [number, number];
type Vec3 = [number, number, number];
type Vec4 = [number, number, number, number];

type UniformValue = number | boolean | Vec2 | Vec3 | Vec4;

type AttributeConfig = {
    buffer: WebGLBuffer;
    size: 1 | 2 | 3 | 4;
    stride?: number;
    offset?: number;
    divisor?: number;
};

export class TypedVAO<TAttributes extends Record<string, AttributeConfig>> {
    constructor(
        private gl: WebGL2RenderingContext,
        readonly vao: WebGLVertexArrayObject,
        readonly attributes: TAttributes
    ) {}

    matches(attributes: TAttributes): boolean {
        const keys = Object.keys(attributes);
        return keys.every(k => this.attributes[k].buffer === attributes[k].buffer);
    }

    delete(): void {
        this.gl.deleteVertexArray(this.vao);
    }
}

export class TypedProgram<
    TUniforms extends Record<string, UniformValue>,
    TAttributes extends Record<string, AttributeConfig>
> {
    private uniformLocations: Map<string, WebGLUniformLocation>;
    private attributeLocations: Map<string, number>;

    constructor(
        private gl: WebGL2RenderingContext,
        public readonly program: WebGLProgram
    ) {
        this.uniformLocations = new Map();
        const numUniforms = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
        for (let i = 0; i < numUniforms; i++) {
            const info = gl.getActiveUniform(program, i);
            if (info) {
                const location = gl.getUniformLocation(program, info.name);
                if (location) this.uniformLocations.set(info.name, location);
            }
        }

        this.attributeLocations = new Map();
        const numAttributes = gl.getProgramParameter(program, gl.ACTIVE_ATTRIBUTES);
        for (let i = 0; i < numAttributes; i++) {
            const info = gl.getActiveAttrib(program, i);
            if (info) {
                this.attributeLocations.set(info.name, gl.getAttribLocation(program, info.name));
            }
        }
    }

    bind(uniforms: Partial<TUniforms>, vao: TypedVAO<TAttributes>): void {
        this.gl.useProgram(this.program);
        this.gl.bindVertexArray(vao.vao);
        const gl = this.gl;
        for (const [name, location] of this.uniformLocations) {
            const value = uniforms[name as keyof TUniforms];
            if (value === undefined) {
                throw new Error(`Uniform ${name} required by shader but not provided.`);
            }

            if (typeof value === 'number') {
                gl.uniform1f(location, value);
            } else if (typeof value === 'boolean') {
                gl.uniform1i(location, value ? 1 : 0);
            } else if (Array.isArray(value)) {
                if (value.length === 2) {
                    gl.uniform2f(location, value[0], value[1]);
                } else if (value.length === 3) {
                    gl.uniform3f(location, value[0], value[1], value[2]);
                } else if (value.length === 4) {
                    gl.uniform4f(location, value[0], value[1], value[2], value[3]);
                }
            }
        }
    }

    createVAO(attributes: TAttributes): TypedVAO<TAttributes> {
        const gl = this.gl;
        const vao = gl.createVertexArray()!;
        gl.bindVertexArray(vao);

        for (const [name, location] of this.attributeLocations) {
            const config = attributes[name];
            if (!config) {
                throw new Error(`Attribute ${name} required by shader but not provided.`);
            }

            gl.bindBuffer(gl.ARRAY_BUFFER, config.buffer);
            gl.enableVertexAttribArray(location);
            gl.vertexAttribPointer(
                location,
                config.size,
                gl.FLOAT,
                false,
                config.stride ?? 0,
                config.offset ?? 0
            );
            gl.vertexAttribDivisor(location, config.divisor ?? 0);
        }

        gl.bindVertexArray(null);
        return new TypedVAO(gl, vao, attributes);
    }

    unbind(): void {
        this.gl.bindVertexArray(null);
    }
}
