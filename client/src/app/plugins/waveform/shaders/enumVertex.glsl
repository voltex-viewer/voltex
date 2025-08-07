attribute vec2 position;
attribute vec2 pointA;
attribute vec2 pointB;

uniform vec2 u_bounds;
uniform float u_width;
uniform float u_pxPerSecond;
uniform float u_offset;
uniform float u_yScale;
uniform float u_yOffset;

varying float v_value;

void main() {
    // Pass the value to fragment shader for coloring
    v_value = pointA.y;
    
    // For enum rendering, create horizontal lines across the entire viewport height
    // We expect pairs of points with the same value for start/end of each segment
    vec2 screenPointA = vec2(
        pointA.x * u_pxPerSecond - u_offset,
        u_bounds.y / 2.0  // Center vertically regardless of value
    );
    
    vec2 screenPointB = vec2(
        pointB.x * u_pxPerSecond - u_offset,
        u_bounds.y / 2.0  // Center vertically regardless of value
    );
    
    // Calculate line direction and perpendicular for width
    vec2 xBasis = screenPointB - screenPointA;
    vec2 yBasis = length(xBasis) > 0.0 ? normalize(vec2(-xBasis.y, xBasis.x)) : vec2(0.0, 1.0);
    
    // For enum mode, extend the line to cover the full viewport height
    // position.y ranges from -0.5 to 0.5, so scale it to full height
    vec2 point = screenPointA + xBasis * position.x + vec2(0.0, (position.y * u_bounds.y));
    
    // Convert to clip space
    gl_Position = vec4((point / u_bounds * 2.0 - 1.0) * vec2(1, -1), 0, 1);
}
