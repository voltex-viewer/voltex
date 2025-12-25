import instancedLineVertexShader from './shaders/instancedLineVertex.glsl?raw';
import bevelJoinVertexShader from './shaders/bevelJoinVertex.glsl?raw';
import enumVertexShader from './shaders/enumVertex.glsl?raw';
import expandedEnumVertexShader from './shaders/expandedEnumVertex.glsl?raw';
import lineFragmentShader from './shaders/lineFragment.glsl?raw';
import enumFragmentShader from './shaders/enumFragment.glsl?raw';
import expandedEnumFragmentShader from './shaders/expandedEnumFragment.glsl?raw';
import dotVertexShader from './shaders/dotVertex.glsl?raw';
import dotFragmentShader from './shaders/dotFragment.glsl?raw';
import { WebGLUtils } from '@voltex-viewer/plugin-api';
import { TypedProgram } from './typedProgram';

type Vec2 = [number, number];
type Vec4 = [number, number, number, number];

export type InstancedLineUniforms = {
    u_bounds: Vec2;
    u_width: number;
    u_timeOffsetHigh: number;
    u_timeOffsetLow: number;
    u_pxPerSecond: number;
    u_yScale: number;
    u_yOffset: number;
    u_color: Vec4;
    u_discrete: boolean;
};

export type EnumLineUniforms = {
    u_bounds: Vec2;
    u_timeOffsetHigh: number;
    u_timeOffsetLow: number;
    u_pxPerSecond: number;
    u_color: Vec4;
    u_nullValue: number;
    u_hasNullValue: boolean;
    u_borderWidth: number;
};

export type ExpandedEnumUniforms = {
    u_bounds: Vec2;
    u_topY: number;
    u_topHeight: number;
    u_bottomY: number;
    u_bottomHeight: number;
    u_timeOffsetHigh: number;
    u_timeOffsetLow: number;
    u_pxPerSecond: number;
    u_color: Vec4;
    u_nullValue: number;
    u_hasNullValue: boolean;
    u_borderWidth: number;
};

export type DotUniforms = {
    u_bounds: Vec2;
    u_width: number;
    u_timeOffsetHigh: number;
    u_timeOffsetLow: number;
    u_pxPerSecond: number;
    u_yScale: number;
    u_yOffset: number;
    u_color: Vec4;
};

export type InstancedLineAttributes = {
    position: { buffer: WebGLBuffer; size: 2; };
    pointATimeHigh: { buffer: WebGLBuffer; size: 1; stride: 4; offset: 0; divisor: 1; };
    pointBTimeHigh: { buffer: WebGLBuffer; size: 1; stride: 4; offset: 4; divisor: 1; };
    pointATimeLow: { buffer: WebGLBuffer; size: 1; stride: 4; offset: 0; divisor: 1; };
    pointBTimeLow: { buffer: WebGLBuffer; size: 1; stride: 4; offset: 4; divisor: 1; };
    pointAValue: { buffer: WebGLBuffer; size: 1; stride: 4; offset: 0; divisor: 1; };
    pointBValue: { buffer: WebGLBuffer; size: 1; stride: 4; offset: 4; divisor: 1; };
};

export type BevelJoinAttributes = {
    position: { buffer: WebGLBuffer; size: 2; };
    pointATimeHigh: { buffer: WebGLBuffer; size: 1; stride: 4; offset: 0; divisor: 1; };
    pointBTimeHigh: { buffer: WebGLBuffer; size: 1; stride: 4; offset: 4; divisor: 1; };
    pointCTimeHigh: { buffer: WebGLBuffer; size: 1; stride: 4; offset: 8; divisor: 1; };
    pointATimeLow: { buffer: WebGLBuffer; size: 1; stride: 4; offset: 0; divisor: 1; };
    pointBTimeLow: { buffer: WebGLBuffer; size: 1; stride: 4; offset: 4; divisor: 1; };
    pointCTimeLow: { buffer: WebGLBuffer; size: 1; stride: 4; offset: 8; divisor: 1; };
    pointAValue: { buffer: WebGLBuffer; size: 1; stride: 4; offset: 0; divisor: 1; };
    pointBValue: { buffer: WebGLBuffer; size: 1; stride: 4; offset: 4; divisor: 1; };
    pointCValue: { buffer: WebGLBuffer; size: 1; stride: 4; offset: 8; divisor: 1; };
};

export type DotAttributes = {
    timePosHigh: { buffer: WebGLBuffer; size: 1; };
    timePosLow: { buffer: WebGLBuffer; size: 1; };
    valuePos: { buffer: WebGLBuffer; size: 1; };
};

export type EnumLineAttributes = InstancedLineAttributes;

export type ExpandedEnumAttributes = {
    position: { buffer: WebGLBuffer; size: 2; };
    pointATimeHigh: { buffer: WebGLBuffer; size: 1; stride: number; offset: number; divisor: 1; };
    pointBTimeHigh: { buffer: WebGLBuffer; size: 1; stride: number; offset: number; divisor: 1; };
    pointATimeLow: { buffer: WebGLBuffer; size: 1; stride: number; offset: number; divisor: 1; };
    pointBTimeLow: { buffer: WebGLBuffer; size: 1; stride: number; offset: number; divisor: 1; };
    pointAValue: { buffer: WebGLBuffer; size: 1; stride: number; offset: number; divisor: 1; };
    bottomLeftX: { buffer: WebGLBuffer; size: 1; stride: number; offset: number; divisor: 1; };
    bottomRightX: { buffer: WebGLBuffer; size: 1; stride: number; offset: number; divisor: 1; };
};

export class WaveformShaders {
    instancedLine: TypedProgram<InstancedLineUniforms, InstancedLineAttributes>;
    bevelJoin: TypedProgram<InstancedLineUniforms, BevelJoinAttributes>;
    enumLine: TypedProgram<EnumLineUniforms, InstancedLineAttributes>;
    expandedEnum: TypedProgram<ExpandedEnumUniforms, ExpandedEnumAttributes>;
    dot: TypedProgram<DotUniforms, DotAttributes>;

    constructor(gl: WebGL2RenderingContext, glUtils: WebGLUtils) {
        const instancedLineVS = glUtils.createShader('vertex-shader', instancedLineVertexShader);
        const bevelJoinVS = glUtils.createShader('vertex-shader', bevelJoinVertexShader);
        const enumVS = glUtils.createShader('vertex-shader', enumVertexShader);
        const expandedEnumVS = glUtils.createShader('vertex-shader', expandedEnumVertexShader);
        const lineFS = glUtils.createShader('fragment-shader', lineFragmentShader);
        const enumFS = glUtils.createShader('fragment-shader', enumFragmentShader);
        const expandedEnumFS = glUtils.createShader('fragment-shader', expandedEnumFragmentShader);
        const dotVS = glUtils.createShader('vertex-shader', dotVertexShader);
        const dotFS = glUtils.createShader('fragment-shader', dotFragmentShader);

        const instancedLineProgram = glUtils.createProgram(instancedLineVS, lineFS);
        const bevelJoinProgram = glUtils.createProgram(bevelJoinVS, lineFS);
        const enumLineProgram = glUtils.createProgram(enumVS, enumFS);
        const expandedEnumProgram = glUtils.createProgram(expandedEnumVS, expandedEnumFS);
        const dotProgram = glUtils.createProgram(dotVS, dotFS);

        this.instancedLine = new TypedProgram<InstancedLineUniforms, InstancedLineAttributes>(gl, instancedLineProgram);
        this.bevelJoin = new TypedProgram<InstancedLineUniforms, BevelJoinAttributes>(gl, bevelJoinProgram);
        this.enumLine = new TypedProgram<EnumLineUniforms, InstancedLineAttributes>(gl, enumLineProgram);
        this.expandedEnum = new TypedProgram<ExpandedEnumUniforms, ExpandedEnumAttributes>(gl, expandedEnumProgram);
        this.dot = new TypedProgram<DotUniforms, DotAttributes>(gl, dotProgram);
    }
}
