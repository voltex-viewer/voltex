import type { TypedProgram, TypedVAO } from '../typedProgram';
import type { ExpandedEnumAttributes, ExpandedEnumUniforms } from '../waveformShaders';
import { topHeightRatio, trapezoidHeightRatio } from './animation';

const topEnd = topHeightRatio;
const bottomStart = topHeightRatio + trapezoidHeightRatio;

export const expandedGeometry = new Float32Array([
    // Top rectangle
    0, 0, 1, 0, 1, topEnd,
    0, 0, 1, topEnd, 0, topEnd,
    // Trapezoid
    0, topEnd, 1, topEnd, 1, bottomStart,
    0, topEnd, 1, bottomStart, 0, bottomStart,
    // Bottom rectangle
    0, bottomStart, 1, bottomStart, 1, 1,
    0, bottomStart, 1, 1, 0, 1,
]);

export type ExpandedEnumVAO = TypedVAO<ExpandedEnumAttributes>;

export class ExpandedEnumResources {
    readonly geometryBuffer: WebGLBuffer;

    constructor(private gl: WebGL2RenderingContext) {
        const buffer = gl.createBuffer();
        if (!buffer) throw new Error('Failed to create expanded enum geometry buffer');
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.bufferData(gl.ARRAY_BUFFER, expandedGeometry, gl.STATIC_DRAW);
        this.geometryBuffer = buffer;
    }

    createVAO(
        program: TypedProgram<ExpandedEnumUniforms, ExpandedEnumAttributes>,
        dataBuffer: WebGLBuffer,
        timeBuffer: WebGLBuffer
    ): ExpandedEnumVAO {
        return program.createVAO({
            position: { buffer: this.geometryBuffer, size: 2 },
            pointATimeHigh: { buffer: timeBuffer, size: 1, stride: 20, offset: 0, divisor: 1 },
            pointBTimeHigh: { buffer: timeBuffer, size: 1, stride: 20, offset: 4, divisor: 1 },
            pointATimeLow: { buffer: timeBuffer, size: 1, stride: 20, offset: 8, divisor: 1 },
            pointBTimeLow: { buffer: timeBuffer, size: 1, stride: 20, offset: 12, divisor: 1 },
            pointAValue: { buffer: timeBuffer, size: 1, stride: 20, offset: 16, divisor: 1 },
            bottomLeftX: { buffer: dataBuffer, size: 1, stride: 8, offset: 0, divisor: 1 },
            bottomRightX: { buffer: dataBuffer, size: 1, stride: 8, offset: 4, divisor: 1 },
        });
    }

    dispose(): void {
        this.gl.deleteBuffer(this.geometryBuffer);
    }
}

export interface ExpandedInstanceBuffers {
    timeBuffer: WebGLBuffer;
    dataBuffer: WebGLBuffer;
    timeData: Float32Array;
    dataData: Float32Array;
    capacity: number;
}

export function createInstanceBuffers(gl: WebGL2RenderingContext, initialCapacity: number): ExpandedInstanceBuffers {
    const timeBuffer = gl.createBuffer();
    const dataBuffer = gl.createBuffer();
    if (!timeBuffer || !dataBuffer) throw new Error('Failed to create instance buffers');

    return {
        timeBuffer,
        dataBuffer,
        timeData: new Float32Array(initialCapacity * 5), // 5 floats per instance: aTimeH, bTimeH, aTimeL, bTimeL, value
        dataData: new Float32Array(initialCapacity * 2), // 2 floats per instance: bottomLeftX, bottomRightX
        capacity: initialCapacity,
    };
}

export function ensureInstanceBufferCapacity(
    buffers: ExpandedInstanceBuffers,
    requiredCapacity: number
): void {
    if (buffers.capacity >= requiredCapacity) return;

    const newCapacity = Math.max(requiredCapacity, buffers.capacity * 2);
    buffers.timeData = new Float32Array(newCapacity * 5);
    buffers.dataData = new Float32Array(newCapacity * 2);
    buffers.capacity = newCapacity;
}

export function disposeInstanceBuffers(gl: WebGL2RenderingContext, buffers: ExpandedInstanceBuffers): void {
    gl.deleteBuffer(buffers.timeBuffer);
    gl.deleteBuffer(buffers.dataBuffer);
}
