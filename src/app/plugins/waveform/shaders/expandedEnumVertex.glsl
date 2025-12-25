#version 300 es
precision mediump float;

in vec2 position;
in float pointATimeHigh;
in float pointATimeLow;
in float pointBTimeHigh;
in float pointBTimeLow;
in float pointAValue;
in float bottomLeftX;
in float bottomRightX;

uniform vec2 u_bounds;
uniform float u_topY;
uniform float u_topHeight;
uniform float u_bottomY;
uniform float u_bottomHeight;
uniform float u_timeOffsetHigh;
uniform float u_timeOffsetLow;
uniform float u_pxPerSecond;

flat out float v_value;
out vec2 v_screenPos;

// Pass edge X coordinates to fragment (flat = no interpolation)
flat out float v_topLeftX;
flat out float v_topRightX;
flat out float v_bottomLeftX;
flat out float v_bottomRightX;

// Pass Y boundaries (flat)
flat out float v_topY;
flat out float v_topEnd;
flat out float v_bottomStart;
flat out float v_bottomEnd;

void main() {
    v_value = pointAValue;
    
    // Calculate top edge positions using double precision math
    float diffA = (pointATimeHigh - u_timeOffsetHigh) + (pointATimeLow - u_timeOffsetLow);
    float diffB = (pointBTimeHigh - u_timeOffsetHigh) + (pointBTimeLow - u_timeOffsetLow);
    float topLeftX = diffA * u_pxPerSecond;
    float topRightX = diffB * u_pxPerSecond;
    
    // Use ternary to select exact values - avoids any interpolation error
    bool isRightEdge = position.x > 0.5;
    float topX = isRightEdge ? topRightX : topLeftX;
    float bottomX = isRightEdge ? bottomRightX : bottomLeftX;
    
    v_topLeftX = topLeftX;
    v_topRightX = topRightX;
    v_bottomLeftX = bottomLeftX;
    v_bottomRightX = bottomRightX;
    
    float topEnd = u_topY + u_topHeight;
    float bottomEnd = u_bottomY + u_bottomHeight;
    float totalHeight = bottomEnd;
    
    v_topY = u_topY;
    v_topEnd = topEnd;
    v_bottomStart = u_bottomY;
    v_bottomEnd = bottomEnd;
    
    float normTopEnd = topEnd / totalHeight;
    float normBottomStart = u_bottomY / totalHeight;
    
    float screenX;
    float screenY;
    
    if (position.y <= normTopEnd) {
        float t = position.y / normTopEnd;
        screenY = u_topY + t * u_topHeight;
        screenX = topX;
    } else if (position.y <= normBottomStart) {
        float t = (position.y - normTopEnd) / (normBottomStart - normTopEnd);
        screenY = topEnd + t * (u_bottomY - topEnd);
        // Interpolate vertically, then select left or right
        float leftX = mix(topLeftX, bottomLeftX, t);
        float rightX = mix(topRightX, bottomRightX, t);
        screenX = isRightEdge ? rightX : leftX;
    } else {
        float t = (position.y - normBottomStart) / (1.0 - normBottomStart);
        screenY = u_bottomY + t * u_bottomHeight;
        screenX = bottomX;
    }
    
    v_screenPos = vec2(screenX, screenY);

    gl_Position = vec4((v_screenPos / u_bounds * 2.0 - 1.0) * vec2(1, -1), 0, 1);
}
