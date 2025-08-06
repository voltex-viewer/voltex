import instancedLineVertexShader from './shaders/instancedLineVertex.glsl?raw';
import miterJoinVertexShader from './shaders/miterJoinVertex.glsl?raw';
import lineFragmentShader from './shaders/lineFragment.glsl?raw';
import dotVertexShader from './shaders/dotVertex.glsl?raw';
import dotFragmentShader from './shaders/dotFragment.glsl?raw';
import { WebGLUtils } from 'src/app/WebGLUtils';

export class WaveformShaders {
    instancedLine: WebGLProgram;
    miterJoin: WebGLProgram;
    dot: WebGLProgram;

    constructor(gl: WebGLUtils) {
        const instancedLineVS = gl.createShader('vertex-shader', instancedLineVertexShader);
        const miterJoinVS = gl.createShader('vertex-shader', miterJoinVertexShader);
        const lineFS = gl.createShader('fragment-shader', lineFragmentShader);
        const dotVS = gl.createShader('vertex-shader', dotVertexShader);
        const dotFS = gl.createShader('fragment-shader', dotFragmentShader);

        this.instancedLine = gl.createProgram(instancedLineVS, lineFS);
        this.miterJoin = gl.createProgram(miterJoinVS, lineFS);
        this.dot = gl.createProgram(dotVS, dotFS);
    }
}
