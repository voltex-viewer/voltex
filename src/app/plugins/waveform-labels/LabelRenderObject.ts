import { hexToRgba, RenderObject, type RenderBounds, type Row, type Signal, type SignalMetadataManager, type RenderContext } from '@voltex-viewer/plugin-api';

export class LabelRenderObject {
    private channels: Signal[];
    private signalMetadata: SignalMetadataManager;
    private row: Row;

    constructor(parent: RenderObject, channels: Signal[] | undefined, signalMetadata: SignalMetadataManager, row: Row, zIndex: number = 0) {
        parent.addChild({
            zIndex,
            render: this.render.bind(this),
        });
        this.channels = channels || [];
        this.signalMetadata = signalMetadata;
        this.row = row;
    }
    
    render(context: RenderContext, bounds: RenderBounds): boolean {
        const { render, state } = context;
        const { gl, utils } = render;
        
        const labelWidth = bounds.width;
        
        // Draw background
        const vertices = new Float32Array([
            0, 0,
            labelWidth, 0,
            0, bounds.height,
            labelWidth, bounds.height
        ]);
        
        const vertexBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
        
        gl.useProgram(utils.line);
        
        const positionLocation = gl.getAttribLocation(utils.line, 'a_position');
        gl.enableVertexAttribArray(positionLocation);
        gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);
        
        const resolutionLocation = gl.getUniformLocation(utils.line, 'u_bounds');
        gl.uniform2f(resolutionLocation, labelWidth, bounds.height);
        
        // Set background color
        const colorLocation = gl.getUniformLocation(utils.line, 'u_color');
        if (this.row.selected) {
            gl.uniform4f(colorLocation, 0.145, 0.388, 0.918, 1.0); // #2563eb
        } else {
            gl.uniform4f(colorLocation, 0.125, 0.141, 0.188, 1.0); // #202430
        }
        
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        
        // Add channel color borders if we have individual channels
        if (this.channels.length > 0) {
            const borderWidth = 4;
            const borderHeight = bounds.height / this.channels.length;

            const textColor = this.row.selected ? '#ffffff' : '#bfc7d5';
            const padding = 8;

            const channelHeight = bounds.height / this.channels.length;

            this.channels.forEach((channel, index) => {
                const channelColor = this.signalMetadata.get(channel).color;
                const y = index * borderHeight;
                const borderVertices = new Float32Array([
                    0, y,
                    borderWidth, y,
                    0, y + borderHeight,
                    borderWidth, y + borderHeight
                ]);
                
                gl.bufferData(gl.ARRAY_BUFFER, borderVertices, gl.STATIC_DRAW);
                const rgba = hexToRgba(channelColor);
                gl.uniform4f(colorLocation, rgba[0], rgba[1], rgba[2], rgba[3]);
                gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
            });

            this.channels.forEach((channel, index) => {
                const y = index * channelHeight + channelHeight / 2 - 6; // Center vertically within the channel's section
                const channelName = channel.source.name[channel.source.name.length - 1];
                utils.drawText(
                    channelName,
                    padding, // Start after color bar + small gap
                    y,
                    { width: labelWidth, height: bounds.height },
                    {
                        fillStyle: textColor
                    }
                );
            });
        }
        
        gl.deleteBuffer(vertexBuffer);
        gl.disableVertexAttribArray(positionLocation);
        
        return false;
    }
}
