attribute vec2 position;
attribute float pointATimeHigh;
attribute float pointATimeLow;
attribute float pointAValue;
attribute float pointBTimeHigh;
attribute float pointBTimeLow;
attribute float pointBValue;

uniform vec2 u_bounds;
uniform float u_width;
uniform float u_timeOffsetHigh;
uniform float u_timeOffsetLow;
uniform float u_pxPerSecond;
uniform float u_yScale;
uniform float u_yOffset;
uniform int u_discrete;

void main() {
    // Emulated double precision - compute time differences identically for both points
    // This ensures pointB of instance N produces the same screen X as pointA of instance N+1
    float diffA = (pointATimeHigh - u_timeOffsetHigh) + (pointATimeLow - u_timeOffsetLow);
    float diffB = (pointBTimeHigh - u_timeOffsetHigh) + (pointBTimeLow - u_timeOffsetLow);
    
    float screenXA = diffA * u_pxPerSecond;
    float screenXB = diffB * u_pxPerSecond;
    
    float screenYA = (u_bounds.y - (pointAValue + u_yOffset) * u_yScale * u_bounds.y) * 0.5;
    float screenYB;
    
    if (u_discrete == 1) {
        screenYB = screenYA;  // Same Y as pointA for discrete
    } else {
        screenYB = (u_bounds.y - (pointBValue + u_yOffset) * u_yScale * u_bounds.y) * 0.5;
    }
    
    vec2 screenPointA = vec2(screenXA, screenYA);
    vec2 screenPointB = vec2(screenXB, screenYB);
    
    // Calculate perpendicular for line width
    vec2 lineDir = screenPointB - screenPointA;
    vec2 yBasis = length(lineDir) > 0.0 ? normalize(vec2(-lineDir.y, lineDir.x)) : vec2(0.0, 1.0);
    
    // Use conditional to select exact endpoint - avoids mix() precision issue
    // where A + (B-A)*1.0 may not equal B in floating point
    vec2 point = position.x < 0.5 ? screenPointA : screenPointB;
    point += yBasis * u_width * position.y;
    
    // Convert to clip space
    gl_Position = vec4((point / u_bounds * 2.0 - 1.0) * vec2(1, -1), 0, 1);
}
