attribute vec2 position;
attribute vec2 pointA;
attribute vec2 pointB;

uniform vec2 u_bounds;
uniform float u_width;
uniform float u_pxPerSecond;
uniform float u_offset;
uniform float u_yScale;
uniform float u_yOffset;
uniform int u_discrete;

void main() {
    vec2 screenPointA, screenPointB;
    
    if (u_discrete == 1) {
        // For discrete signals, create horizontal line from pointA to pointB's time with pointA's value
        screenPointA = vec2(
            pointA.x * u_pxPerSecond - u_offset,
            u_bounds.y / 2.0 - (pointA.y + u_yOffset) * u_yScale * u_bounds.y * 0.4
        );
        
        screenPointB = vec2(
            pointB.x * u_pxPerSecond - u_offset,
            u_bounds.y / 2.0 - (pointA.y + u_yOffset) * u_yScale * u_bounds.y * 0.4  // Same Y as pointA
        );
    } else {
        // For continuous signals, use original point-to-point rendering
        screenPointA = vec2(
            pointA.x * u_pxPerSecond - u_offset,
            u_bounds.y / 2.0 - (pointA.y + u_yOffset) * u_yScale * u_bounds.y * 0.4
        );
        
        screenPointB = vec2(
            pointB.x * u_pxPerSecond - u_offset,
            u_bounds.y / 2.0 - (pointB.y + u_yOffset) * u_yScale * u_bounds.y * 0.4
        );
    }
    
    // Calculate line direction and perpendicular for width
    vec2 xBasis = screenPointB - screenPointA;
    vec2 yBasis = length(xBasis) > 0.0 ? normalize(vec2(-xBasis.y, xBasis.x)) : vec2(0.0, 1.0);
    
    // Create the line segment quad
    vec2 point = screenPointA + xBasis * position.x + yBasis * u_width * position.y;
    
    // Convert to clip space
    gl_Position = vec4((point / u_bounds * 2.0 - 1.0) * vec2(1, -1), 0, 1);
}
