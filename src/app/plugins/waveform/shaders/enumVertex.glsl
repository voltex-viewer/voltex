attribute vec2 position;
attribute float pointATime;
attribute float pointAValue;
attribute float pointBTime;
attribute float pointBValue;

uniform vec2 u_bounds;
uniform float u_timeOffsetHigh;
uniform float u_timeOffsetLow;
uniform float u_pxPerSecond;

varying float v_value;
varying vec2 v_rectPosition;
varying vec2 v_rectSize;

void main() {
    vec2 pointA = vec2(pointATime, pointAValue);
    vec2 pointB = vec2(pointBTime, pointBValue);
    
    // Pass the value to fragment shader for coloring
    v_value = pointA.y;
    
    // Emulated double precision
    float diffA = (pointA.x - u_timeOffsetHigh) - u_timeOffsetLow;
    float diffB = (pointB.x - u_timeOffsetHigh) - u_timeOffsetLow;
    
    // For enum rendering, create horizontal lines across the entire viewport height
    // We expect pairs of points with the same value for start/end of each segment
    vec2 screenPointA = vec2(
        diffA * u_pxPerSecond,
        u_bounds.y / 2.0  // Center vertically regardless of value
    );
    
    vec2 screenPointB = vec2(
        diffB * u_pxPerSecond,
        u_bounds.y / 2.0  // Center vertically regardless of value
    );
    
    // Calculate line direction and perpendicular for width
    vec2 xBasis = screenPointB - screenPointA;
    
    // For enum mode, extend the line to cover the full viewport height
    // position.y ranges from -0.5 to 0.5, so scale it to full height
    vec2 point = screenPointA + xBasis * position.x + vec2(0.0, (position.y * u_bounds.y));
    
    // Pass rectangle dimensions and position for border detection
    v_rectSize = vec2(length(xBasis), u_bounds.y);
    v_rectPosition = vec2(position.x * v_rectSize.x, (position.y + 0.5) * v_rectSize.y);
    
    // Convert to clip space
    gl_Position = vec4((point / u_bounds * 2.0 - 1.0) * vec2(1, -1), 0, 1);
}
