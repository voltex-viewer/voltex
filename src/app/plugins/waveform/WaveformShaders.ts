import instancedLineVertexShader from './shaders/instancedLineVertex.glsl?raw';
import bevelJoinVertexShader from './shaders/bevelJoinVertex.glsl?raw';
import enumVertexShader from './shaders/enumVertex.glsl?raw';
import lineFragmentShader from './shaders/lineFragment.glsl?raw';
import enumFragmentShader from './shaders/enumFragment.glsl?raw';
import dotVertexShader from './shaders/dotVertex.glsl?raw';
import dotFragmentShader from './shaders/dotFragment.glsl?raw';
import { WebGLUtils } from '@voltex/plugin-api';

export class WaveformShaders {
    instancedLine: WebGLProgram;
    bevelJoin: WebGLProgram;
    enumLine: WebGLProgram;
    dot: WebGLProgram;

    constructor(gl: WebGLUtils) {
        const instancedLineVS = gl.createShader('vertex-shader', instancedLineVertexShader);
        const bevelJoinVS = gl.createShader('vertex-shader', bevelJoinVertexShader);
        const enumVS = gl.createShader('vertex-shader', enumVertexShader);
        const lineFS = gl.createShader('fragment-shader', lineFragmentShader);
        const enumFS = gl.createShader('fragment-shader', enumFragmentShader);
        const dotVS = gl.createShader('vertex-shader', dotVertexShader);
        const dotFS = gl.createShader('fragment-shader', dotFragmentShader);

        this.instancedLine = gl.createProgram(instancedLineVS, lineFS);
        this.bevelJoin = gl.createProgram(bevelJoinVS, lineFS);
        this.enumLine = gl.createProgram(enumVS, enumFS);
        this.dot = gl.createProgram(dotVS, dotFS);
    }
}
