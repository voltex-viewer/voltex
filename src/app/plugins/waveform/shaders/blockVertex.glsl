attribute vec2 position;
attribute float startTimeHigh;
attribute float startTimeLow;
attribute float endTimeHigh;
attribute float endTimeLow;
attribute float minValue;
attribute float maxValue;

uniform vec2 u_bounds;
uniform float u_width;
uniform float u_timeOffsetHigh;
uniform float u_timeOffsetLow;
uniform float u_pxPerSecond;
uniform float u_yScale;
uniform float u_yOffset;

void main() {
    // Emulated double precision
    float startX = ((startTimeHigh - u_timeOffsetHigh) + (startTimeLow - u_timeOffsetLow)) * u_pxPerSecond;
    float endX = ((endTimeHigh - u_timeOffsetHigh) + (endTimeLow - u_timeOffsetLow)) * u_pxPerSecond;

    // Grown by half the line width, to match the lines either side
    float topY = (u_bounds.y - (maxValue + u_yOffset) * u_yScale * u_bounds.y) * 0.5 - u_width * 0.5;
    float bottomY = (u_bounds.y - (minValue + u_yOffset) * u_yScale * u_bounds.y) * 0.5 + u_width * 0.5;

    vec2 point = vec2(mix(startX, endX, position.x), mix(topY, bottomY, position.y + 0.5));
    gl_Position = vec4((point / u_bounds * 2.0 - 1.0) * vec2(1, -1), 0, 1);
}
