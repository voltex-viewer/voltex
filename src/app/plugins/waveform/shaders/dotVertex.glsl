attribute float timePosHigh;
attribute float timePosLow;
attribute float valuePos;
uniform vec2 u_bounds;
uniform float u_width;
uniform float u_timeOffsetHigh;
uniform float u_timeOffsetLow;
uniform float u_pxPerSecond;
uniform float u_yScale;
uniform float u_yOffset;

void main() {
    // Emulated double precision
    float diff = (timePosHigh - u_timeOffsetHigh) + (timePosLow - u_timeOffsetLow);
    
    vec2 screenPos = vec2(
        diff * u_pxPerSecond,
        (u_bounds.y - (valuePos + u_yOffset) * u_yScale * u_bounds.y) * 0.5
    );
    gl_Position = vec4((screenPos / u_bounds * 2.0 - 1.0) * vec2(1, -1), 0, 1);
    gl_PointSize = u_width;
}
