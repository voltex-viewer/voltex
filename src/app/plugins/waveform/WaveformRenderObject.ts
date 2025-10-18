import { hexToRgba, RenderMode, Row, type RenderContext, type RenderBounds, type RenderObject, type Signal } from "@voltex-viewer/plugin-api";
import type { BufferData } from './WaveformRendererPlugin';
import { WaveformConfig } from './WaveformConfig';
import { WaveformShaders } from './WaveformShaders';

export class WaveformRenderObject {
    constructor(
        parent: RenderObject,
        private config: WaveformConfig,
        private bufferData: BufferData,
        private sharedInstanceGeometryBuffer: WebGLBuffer,
        private sharedBevelJoinGeometryBuffer: WebGLBuffer,
        private instancingExt: ANGLE_instanced_arrays,
        private color: string,
        private waveformPrograms: WaveformShaders,
        private signal: Signal,
        private row: Row,
        private renderMode: RenderMode,
        zIndex: number = 0
    ) {
        parent.addChild({
            zIndex: zIndex,
            render: this.render.bind(this),
        });
    }
    
    render(context: RenderContext, bounds: RenderBounds): boolean {
        const {render, state} = context;
        const { gl } = render;
        
        const color = this.color;
            
        // Calculate left time with high precision
        const leftTimeDouble = state.offset / state.pxPerSecond;
        
        // Split double precision into two float32 values for GPU
        // This emulates double precision arithmetic on the GPU
        const timeOffsetHigh = Math.fround(leftTimeDouble); // Round to float32
        const timeOffsetLow = leftTimeDouble - timeOffsetHigh; // Remaining precision
        
        // Set uniforms
        let bindUniforms = (width: number) => (program: WebGLProgram) => {
            gl.uniform2f(gl.getUniformLocation(program, 'u_bounds'), bounds.width, bounds.height);
            gl.uniform1f(gl.getUniformLocation(program, 'u_width'), width);
            gl.uniform1f(gl.getUniformLocation(program, 'u_timeOffsetHigh'), timeOffsetHigh);
            gl.uniform1f(gl.getUniformLocation(program, 'u_timeOffsetLow'), timeOffsetLow);
            gl.uniform1f(gl.getUniformLocation(program, 'u_pxPerSecond'), state.pxPerSecond);
            
            gl.uniform1i(gl.getUniformLocation(program, 'u_discrete'), this.signal.source.renderHint == RenderMode.Discrete ? 1 : 0);

            // Apply row-specific y-scale and y-offset
            gl.uniform1f(gl.getUniformLocation(program, 'u_yScale'), this.row.yScale);
            gl.uniform1f(gl.getUniformLocation(program, 'u_yOffset'), this.row.yOffset);

            const [r, g, b, a] = hexToRgba(color);
            gl.uniform4f(gl.getUniformLocation(program, 'u_color'), r, g, b, a);
        };

        // Special uniform binding for enum mode to pass max value for coloring
        let enumLinesBindUniforms = (program: WebGLProgram) => {
            gl.uniform2f(gl.getUniformLocation(program, 'u_bounds'), bounds.width, bounds.height);
            gl.uniform1f(gl.getUniformLocation(program, 'u_timeOffsetHigh'), timeOffsetHigh);
            gl.uniform1f(gl.getUniformLocation(program, 'u_timeOffsetLow'), timeOffsetLow);
            gl.uniform1f(gl.getUniformLocation(program, 'u_pxPerSecond'), state.pxPerSecond);

            // Pass max value for color generation
            gl.uniform1f(gl.getUniformLocation(program, 'u_maxValue'), this.signal.values.max);

            const [r, g, b, a] = hexToRgba(color);
            gl.uniform4f(gl.getUniformLocation(program, 'u_color'), r, g, b, a);

            if ("null" in this.signal.values) {
                gl.uniform1f(gl.getUniformLocation(program, 'u_nullValue'), this.signal.values.null);
                gl.uniform1i(gl.getUniformLocation(program, 'u_hasNullValue'), 1);
            } else {
                gl.uniform1f(gl.getUniformLocation(program, 'u_nullValue'), this.signal.values.max + 1.0);
                gl.uniform1i(gl.getUniformLocation(program, 'u_hasNullValue'), 0);
            }
        };

        let linesBindUniforms = bindUniforms(this.config.lineWidth);
        let dotsBindUniforms = bindUniforms(this.config.dotSize);
        
        const renderMode = this.renderMode;
        if (renderMode === RenderMode.Lines) {
            this.renderInstancedLines(gl, this.waveformPrograms.instancedLine, linesBindUniforms);
            this.renderBevelJoins(gl, this.waveformPrograms.bevelJoin, linesBindUniforms);
        } else if (renderMode === RenderMode.Discrete) {
            this.renderInstancedLines(gl, this.waveformPrograms.instancedLine, linesBindUniforms);
        } else if (renderMode === RenderMode.Dots) {
            this.renderSignal(gl, this.waveformPrograms.dot, dotsBindUniforms);
        } else if (renderMode === RenderMode.Enum) {
            this.renderInstancedLines(gl, this.waveformPrograms.enumLine, enumLinesBindUniforms);
        } else if (renderMode === RenderMode.Text) {
            this.renderEnumText(context, bounds);
        }
        return false;
    }

    private renderEnumText(
        context: RenderContext,
        bounds: RenderBounds,
    ): void {
        const { render, state } = context;
        const { utils } = render;

        // Calculate visible time range
        const startTime = state.offset / state.pxPerSecond;
        const endTime = (state.offset + bounds.width) / state.pxPerSecond;

        const padding = 5; // Padding around text
        const font = '12px "Open Sans", sans-serif'; // Match the font used in drawText

        // Pre-calculate expensive measurements
        const ellipsisWidth = utils.measureText('...', font).renderWidth;
        const baselineMetrics = utils.measureText('Ag', font); // Use consistent reference text for baseline
        const y = (bounds.height - baselineMetrics.renderHeight) / 2;

        // Binary search to find the indices of visible segments
        const maxUpdateIndex = Math.min(this.signal.time.length, this.signal.values.length);
        const startIndex = this.binarySearchTimeIndex(startTime, 0, maxUpdateIndex - 1, true);
        const endIndex = this.binarySearchTimeIndex(endTime, startIndex, maxUpdateIndex - 1, false);

        // Render text for segments in the visible range
        for (let i = startIndex; i <= endIndex && i < maxUpdateIndex - 1; i++) {
            const segmentStartTime = this.signal.time.valueAt(i);
            const value = this.signal.values.valueAt(i);
            
            // Get the end time of this segment, extending it to include consecutive segments with the same value
            let segmentEndTime = this.signal.time.valueAt(i + 1);
            let j = i + 1;
            while (j < maxUpdateIndex - 1 && this.signal.values.valueAt(j) === value) {
                segmentEndTime = this.signal.time.valueAt(j + 1);
                j++;
            }
            // Skip ahead to avoid rendering duplicate labels for the same value
            i = j - 1;
            
            let enumText = "convertedValueAt" in this.signal.values ? this.signal.values.convertedValueAt(i).toString() : value.toString();

            if (enumText == "null") continue;
            
            // Calculate segment boundaries in pixel space
            const segmentStartX = segmentStartTime * state.pxPerSecond - state.offset;
            const segmentEndX = segmentEndTime * state.pxPerSecond - state.offset;
            
            // Determine text position - snap to left edge if segment starts off-screen
            const textX = Math.max(padding, segmentStartX + padding);
            
            // Calculate available width from text position to segment end
            const availableWidth = Math.max(0, segmentEndX - textX - padding);
                
            if (availableWidth > 0) {
                // Measure the actual text width
                const textMetrics = utils.measureText(enumText, font);
                const textWidth = textMetrics.renderWidth;
                
                // Handle text truncation if it doesn't fit
                let displayText = enumText;
                if (textWidth > availableWidth) {
                    // Try to fit text with ellipsis
                    const availableForText = availableWidth - ellipsisWidth;
                    
                    if (availableForText <= 0) {
                        // Not enough space even for ellipsis
                        continue;
                    }
                    
                    // Use character-based estimate to reduce binary search iterations
                    const avgCharWidth = textWidth / enumText.length;
                    const estimatedLength = Math.floor(availableForText / avgCharWidth);
                    
                    // Binary search to find the longest text that fits
                    let left = Math.max(1, estimatedLength - 5);
                    let right = Math.min(enumText.length - 1, estimatedLength + 5);
                    let bestLength = 0;
                    
                    while (left <= right) {
                        const mid = Math.floor((left + right) / 2);
                        const truncatedWidth = utils.measureText(enumText.substring(0, mid), font).renderWidth;
                        
                        if (truncatedWidth <= availableForText) {
                            bestLength = mid;
                            left = mid + 1;
                        } else {
                            right = mid - 1;
                        }
                    }
                    
                    if (bestLength === 0) {
                        // Can't fit any meaningful text
                        continue;
                    }
                    
                    displayText = enumText.substring(0, bestLength) + '...';
                }
                
                // Render text at center of viewport height using consistent baseline positioning
                // Render text with white fill and black stroke for better visibility
                utils.drawText(
                    displayText,
                    textX, // Use calculated text position (snapped to left edge if needed)
                    y,
                    { width: bounds.width, height: bounds.height },
                    {
                        font,
                        fillStyle: '#ffffff',
                        strokeStyle: '#000000',
                        strokeWidth: 2
                    }
                );
            }
        }
    }

    /**
     * Binary search to find the appropriate index for a given time.
     * @param targetTime The time to search for
     * @param left The left boundary of the search range
     * @param right The right boundary of the search range
     * @param findStart If true, finds the leftmost index where time >= targetTime (for start).
     *                  If false, finds the rightmost index where time <= targetTime (for end).
     * @returns The appropriate index
     */
    private binarySearchTimeIndex(targetTime: number, left: number, right: number, findStart: boolean): number {
        if (left > right) {
            return findStart ? left : right;
        }

        let result = findStart ? right + 1 : left - 1;
        const maxUpdateIndex = this.bufferData.signalIndex;

        while (left <= right) {
            const mid = Math.floor((left + right) / 2);
            const midTime = this.signal.time.valueAt(mid);

            if (findStart) {
                // For start index: find leftmost position where segment might be visible
                // A segment at index i is visible if signal.time.valueAt(i+1) >= startTime
                if (mid + 1 < maxUpdateIndex) {
                    const nextTime = this.signal.time.valueAt(mid + 1);
                    if (nextTime >= targetTime) {
                        result = mid;
                        right = mid - 1;
                    } else {
                        left = mid + 1;
                    }
                } else {
                    // Last segment, check if it starts before target time
                    if (midTime <= targetTime) {
                        result = mid;
                    }
                    right = mid - 1;
                }
            } else {
                // For end index: find rightmost position where segment might be visible
                // A segment at index i is visible if signal.time.valueAt(i) <= endTime
                if (midTime <= targetTime) {
                    result = mid;
                    left = mid + 1;
                } else {
                    right = mid - 1;
                }
            }
        }

        // Clamp result to valid range
        return Math.max(0, Math.min(maxUpdateIndex - 1, result));
    }
    
    private renderSignal(
        gl: WebGLRenderingContext,
        program: WebGLProgram,
        bindUniforms: (program: WebGLProgram) => void,
    ): void {
        gl.useProgram(program);
        bindUniforms(program);
        
        // Bind time buffer to first attribute
        gl.bindBuffer(gl.ARRAY_BUFFER, this.bufferData.timeBuffer);
        const timeLocation = gl.getAttribLocation(program, 'timePos');
        gl.enableVertexAttribArray(timeLocation);
        gl.vertexAttribPointer(timeLocation, 1, gl.FLOAT, false, 0, 0);
        
        // Bind value buffer to second attribute  
        gl.bindBuffer(gl.ARRAY_BUFFER, this.bufferData.valueBuffer);
        const valueLocation = gl.getAttribLocation(program, 'valuePos');
        gl.enableVertexAttribArray(valueLocation);
        gl.vertexAttribPointer(valueLocation, 1, gl.FLOAT, false, 0, 0);

        gl.drawArrays(gl.POINTS, 0, this.bufferData.bufferLength);
        
        // Clean up
        gl.disableVertexAttribArray(timeLocation);
        gl.disableVertexAttribArray(valueLocation);
    }
    
    private renderInstancedLines(
        gl: WebGLRenderingContext,
        program: WebGLProgram,
        bindUniforms: (program: WebGLProgram) => void,
    ): void {
        gl.useProgram(program);
        bindUniforms(program);
        
        // Bind instance geometry (the quad geometry for each line segment)
        gl.bindBuffer(gl.ARRAY_BUFFER, this.sharedInstanceGeometryBuffer);
        const positionLocation = gl.getAttribLocation(program, 'position');
        gl.enableVertexAttribArray(positionLocation);
        gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);
        this.instancingExt.vertexAttribDivisorANGLE(positionLocation, 0);
        
        // Bind time buffer for pointA times (instanced data)
        gl.bindBuffer(gl.ARRAY_BUFFER, this.bufferData.timeBuffer);
        const pointATimeLocation = gl.getAttribLocation(program, 'pointATime');
        gl.enableVertexAttribArray(pointATimeLocation);
        gl.vertexAttribPointer(pointATimeLocation, 1, gl.FLOAT, false, 4, 0); // stride: 1 float, offset: 0
        this.instancingExt.vertexAttribDivisorANGLE(pointATimeLocation, 1);
        
        const pointBTimeLocation = gl.getAttribLocation(program, 'pointBTime');
        gl.enableVertexAttribArray(pointBTimeLocation);
        gl.vertexAttribPointer(pointBTimeLocation, 1, gl.FLOAT, false, 4, 4); // stride: 1 float, offset: 1 float
        this.instancingExt.vertexAttribDivisorANGLE(pointBTimeLocation, 1);
        
        // Bind value buffer for pointA/pointB values (instanced data)
        gl.bindBuffer(gl.ARRAY_BUFFER, this.bufferData.valueBuffer);
        const pointAValueLocation = gl.getAttribLocation(program, 'pointAValue');
        gl.enableVertexAttribArray(pointAValueLocation);
        gl.vertexAttribPointer(pointAValueLocation, 1, gl.FLOAT, false, 4, 0); // stride: 1 float, offset: 0
        this.instancingExt.vertexAttribDivisorANGLE(pointAValueLocation, 1);
        
        const pointBValueLocation = gl.getAttribLocation(program, 'pointBValue');
        gl.enableVertexAttribArray(pointBValueLocation);
        gl.vertexAttribPointer(pointBValueLocation, 1, gl.FLOAT, false, 4, 4); // stride: 1 float, offset: 1 float
        this.instancingExt.vertexAttribDivisorANGLE(pointBValueLocation, 1);
        
        // Draw instanced
        const instanceCount = this.bufferData.bufferLength - 1;
        if (instanceCount > 0) {
            this.instancingExt.drawArraysInstancedANGLE(gl.TRIANGLES, 0, 6, instanceCount);
        }
        
        // Clean up divisors
        this.instancingExt.vertexAttribDivisorANGLE(positionLocation, 0);
        this.instancingExt.vertexAttribDivisorANGLE(pointATimeLocation, 0);
        this.instancingExt.vertexAttribDivisorANGLE(pointBTimeLocation, 0);
        this.instancingExt.vertexAttribDivisorANGLE(pointAValueLocation, 0);
        this.instancingExt.vertexAttribDivisorANGLE(pointBValueLocation, 0);
        
        // Disable vertex attribute arrays
        gl.disableVertexAttribArray(positionLocation);
        gl.disableVertexAttribArray(pointATimeLocation);
        gl.disableVertexAttribArray(pointBTimeLocation);
        gl.disableVertexAttribArray(pointAValueLocation);
        gl.disableVertexAttribArray(pointBValueLocation);
    }
    
    private renderBevelJoins(
        gl: WebGLRenderingContext,
        program: WebGLProgram,
        bindUniforms: (program: WebGLProgram) => void,
    ): void {
        gl.useProgram(program);
        bindUniforms(program);
        
        // Bind bevel join geometry (3 vertices for 1 triangle)
        gl.bindBuffer(gl.ARRAY_BUFFER, this.sharedBevelJoinGeometryBuffer);
        const positionLocation = gl.getAttribLocation(program, 'position');
        gl.enableVertexAttribArray(positionLocation);
        gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);
        this.instancingExt.vertexAttribDivisorANGLE(positionLocation, 0);
        
        // Bind time buffer for three consecutive point times (A, B, C)
        gl.bindBuffer(gl.ARRAY_BUFFER, this.bufferData.timeBuffer);
        const pointATimeLocation = gl.getAttribLocation(program, 'pointATime');
        gl.enableVertexAttribArray(pointATimeLocation);
        gl.vertexAttribPointer(pointATimeLocation, 1, gl.FLOAT, false, 4, 0); // offset: 0
        this.instancingExt.vertexAttribDivisorANGLE(pointATimeLocation, 1);
        
        const pointBTimeLocation = gl.getAttribLocation(program, 'pointBTime');
        gl.enableVertexAttribArray(pointBTimeLocation);
        gl.vertexAttribPointer(pointBTimeLocation, 1, gl.FLOAT, false, 4, 4); // offset: 1 float
        this.instancingExt.vertexAttribDivisorANGLE(pointBTimeLocation, 1);
        
        const pointCTimeLocation = gl.getAttribLocation(program, 'pointCTime');
        gl.enableVertexAttribArray(pointCTimeLocation);
        gl.vertexAttribPointer(pointCTimeLocation, 1, gl.FLOAT, false, 4, 8); // offset: 2 floats
        this.instancingExt.vertexAttribDivisorANGLE(pointCTimeLocation, 1);
        
        // Bind value buffer for three consecutive point values (A, B, C)
        gl.bindBuffer(gl.ARRAY_BUFFER, this.bufferData.valueBuffer);
        const pointAValueLocation = gl.getAttribLocation(program, 'pointAValue');
        gl.enableVertexAttribArray(pointAValueLocation);
        gl.vertexAttribPointer(pointAValueLocation, 1, gl.FLOAT, false, 4, 0); // offset: 0
        this.instancingExt.vertexAttribDivisorANGLE(pointAValueLocation, 1);
        
        const pointBValueLocation = gl.getAttribLocation(program, 'pointBValue');
        gl.enableVertexAttribArray(pointBValueLocation);
        gl.vertexAttribPointer(pointBValueLocation, 1, gl.FLOAT, false, 4, 4); // offset: 1 float
        this.instancingExt.vertexAttribDivisorANGLE(pointBValueLocation, 1);
        
        const pointCValueLocation = gl.getAttribLocation(program, 'pointCValue');
        gl.enableVertexAttribArray(pointCValueLocation);
        gl.vertexAttribPointer(pointCValueLocation, 1, gl.FLOAT, false, 4, 8); // offset: 2 floats
        this.instancingExt.vertexAttribDivisorANGLE(pointCValueLocation, 1);
        
        // Draw instanced bevel joins - need 3 consecutive points
        const instanceCount = this.bufferData.bufferLength - 2;
        if (instanceCount > 0) {
            this.instancingExt.drawArraysInstancedANGLE(gl.TRIANGLES, 0, 3, instanceCount);
        }
        
        // Clean up divisors
        this.instancingExt.vertexAttribDivisorANGLE(positionLocation, 0);
        this.instancingExt.vertexAttribDivisorANGLE(pointATimeLocation, 0);
        this.instancingExt.vertexAttribDivisorANGLE(pointBTimeLocation, 0);
        this.instancingExt.vertexAttribDivisorANGLE(pointCTimeLocation, 0);
        this.instancingExt.vertexAttribDivisorANGLE(pointAValueLocation, 0);
        this.instancingExt.vertexAttribDivisorANGLE(pointBValueLocation, 0);
        this.instancingExt.vertexAttribDivisorANGLE(pointCValueLocation, 0);
        
        // Disable vertex attribute arrays
        gl.disableVertexAttribArray(positionLocation);
        gl.disableVertexAttribArray(pointATimeLocation);
        gl.disableVertexAttribArray(pointBTimeLocation);
        gl.disableVertexAttribArray(pointCTimeLocation);
        gl.disableVertexAttribArray(pointAValueLocation);
        gl.disableVertexAttribArray(pointBValueLocation);
        gl.disableVertexAttribArray(pointCValueLocation);
    }
}
