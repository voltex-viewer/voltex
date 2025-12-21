attribute vec2 position;
attribute float pointATimeHigh;
attribute float pointATimeLow;
attribute float pointAValue;
attribute float pointBTimeHigh;
attribute float pointBTimeLow;
attribute float pointBValue;

uniform vec2 u_bounds;
uniform float u_timeOffsetHigh;
uniform float u_timeOffsetLow;
uniform float u_pxPerSecond;

varying float v_value;
varying vec2 v_rectPosition;
varying vec2 v_rectSize;

void main() {
    // Pass the value to fragment shader for coloring
    v_value = pointAValue;
    
    // Interpolate time (high and low parts separately) to ensure adjacent rects share exact edge positions
    float timeHigh = mix(pointATimeHigh, pointBTimeHigh, position.x);
    float timeLow = mix(pointATimeLow, pointBTimeLow, position.x);
    
    // Emulated double precision: subtract offset from both parts
    float diff = (timeHigh - u_timeOffsetHigh) + (timeLow - u_timeOffsetLow);
    float screenX = diff * u_pxPerSecond;
    
    // Calculate rect width for border detection
    float diffA = (pointATimeHigh - u_timeOffsetHigh) + (pointATimeLow - u_timeOffsetLow);
    float diffB = (pointBTimeHigh - u_timeOffsetHigh) + (pointBTimeLow - u_timeOffsetLow);
    float rectWidth = (diffB - diffA) * u_pxPerSecond;
    
    // position.y ranges from -0.5 to 0.5, scale to full viewport height
    vec2 point = vec2(screenX, u_bounds.y / 2.0 + position.y * u_bounds.y);
    
    // Pass rectangle dimensions and position for border detection
    v_rectSize = vec2(rectWidth, u_bounds.y);
    v_rectPosition = vec2(position.x * rectWidth, (position.y + 0.5) * v_rectSize.y);
    
    // Convert to clip space
    gl_Position = vec4((point / u_bounds * 2.0 - 1.0) * vec2(1, -1), 0, 1);
}
