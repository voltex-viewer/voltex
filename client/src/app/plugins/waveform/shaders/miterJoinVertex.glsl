attribute vec3 position;
attribute vec2 pointA;
attribute vec2 pointB;
attribute vec2 pointC;

uniform vec2 u_bounds;
uniform float u_width;
uniform float u_pxPerSecond;
uniform float u_offset;
uniform float u_yScale;
uniform float u_yOffset;

void main() {
    // Transform signal points to screen coordinates first
    vec2 screenPointA = vec2(
        pointA.x * u_pxPerSecond - u_offset,
        u_bounds.y / 2.0 - (pointA.y + u_yOffset) * u_yScale * u_bounds.y * 0.4
    );
    
    vec2 screenPointB = vec2(
        pointB.x * u_pxPerSecond - u_offset,
        u_bounds.y / 2.0 - (pointB.y + u_yOffset) * u_yScale * u_bounds.y * 0.4
    );
    
    vec2 screenPointC = vec2(
        pointC.x * u_pxPerSecond - u_offset,
        u_bounds.y / 2.0 - (pointC.y + u_yOffset) * u_yScale * u_bounds.y * 0.4
    );
    
    // Calculate the miter vector
    vec2 tangent = normalize(normalize(screenPointC - screenPointB) + normalize(screenPointB - screenPointA));
    vec2 miter = vec2(-tangent.y, tangent.x);
    
    // Find the two perpendicular vectors for each line
    vec2 ab = screenPointB - screenPointA;
    vec2 cb = screenPointB - screenPointC;
    vec2 abNorm = length(ab) > 0.0 ? normalize(vec2(-ab.y, ab.x)) : vec2(0.0, 1.0);
    vec2 cbNorm = length(cb) > 0.0 ? -normalize(vec2(-cb.y, cb.x)) : vec2(0.0, 1.0);
    
    // Determine the direction of the bend
    float sigma = sign(dot(ab + cb, miter));
    
    // Calculate basis vectors for the miter geometry
    vec2 p0 = 0.5 * u_width * sigma * (sigma < 0.0 ? abNorm : cbNorm);
    vec2 p1 = 0.5 * miter * sigma * u_width / max(0.001, dot(miter, abNorm));
    vec2 p2 = 0.5 * u_width * sigma * (sigma < 0.0 ? cbNorm : abNorm);
    
    // Calculate the final vertex position using the basis vectors and position coefficients
    vec2 point = screenPointB + position.x * p0 + position.y * p1 + position.z * p2;
    
    // Convert to clip space
    gl_Position = vec4((point / u_bounds * 2.0 - 1.0) * vec2(1, -1), 0, 1);
}
