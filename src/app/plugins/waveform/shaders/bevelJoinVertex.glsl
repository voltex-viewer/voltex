attribute vec2 position;
attribute float pointATimeHigh;
attribute float pointATimeLow;
attribute float pointAValue;
attribute float pointBTimeHigh;
attribute float pointBTimeLow;
attribute float pointBValue;
attribute float pointCTimeHigh;
attribute float pointCTimeLow;
attribute float pointCValue;

uniform vec2 u_bounds;
uniform float u_width;
uniform float u_timeOffsetHigh;
uniform float u_timeOffsetLow;
uniform float u_pxPerSecond;
uniform float u_yScale;
uniform float u_yOffset;
uniform float u_nullValue;
uniform bool u_hasNullValue;

void main() {
    // Discard bevel joins connected to null values
    if (u_hasNullValue && (abs(pointAValue - u_nullValue) < 0.001 || abs(pointBValue - u_nullValue) < 0.001 || abs(pointCValue - u_nullValue) < 0.001)) {
        gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
        return;
    }
    // Emulated double precision
    float diffA = (pointATimeHigh - u_timeOffsetHigh) + (pointATimeLow - u_timeOffsetLow);
    float diffB = (pointBTimeHigh - u_timeOffsetHigh) + (pointBTimeLow - u_timeOffsetLow);
    float diffC = (pointCTimeHigh - u_timeOffsetHigh) + (pointCTimeLow - u_timeOffsetLow);
    
    // Transform signal points to screen coordinates
    vec2 screenPointA = vec2(
        diffA * u_pxPerSecond,
        u_bounds.y / 2.0 - (pointAValue + u_yOffset) * u_yScale * u_bounds.y * 0.5
    );
    
    vec2 screenPointB = vec2(
        diffB * u_pxPerSecond,
        u_bounds.y / 2.0 - (pointBValue + u_yOffset) * u_yScale * u_bounds.y * 0.5
    );
    
    vec2 screenPointC = vec2(
        diffC * u_pxPerSecond,
        u_bounds.y / 2.0 - (pointCValue + u_yOffset) * u_yScale * u_bounds.y * 0.5
    );
    
    // Calculate tangent and normal vectors
    vec2 tangent = normalize(normalize(screenPointC - screenPointB) + normalize(screenPointB - screenPointA));
    vec2 normal = vec2(-tangent.y, tangent.x);
    
    // Calculate perpendicular vectors for each segment
    vec2 ab = screenPointB - screenPointA;
    vec2 cb = screenPointB - screenPointC;
    vec2 abn = normalize(vec2(-ab.y, ab.x));
    vec2 cbn = -normalize(vec2(-cb.y, cb.x));
    
    // Determine the direction of the bend
    float sigma = sign(dot(ab + cb, normal));
    
    // Calculate basis vectors for the bevel geometry
    vec2 p0 = 0.5 * sigma * u_width * (sigma < 0.0 ? abn : cbn);
    vec2 p1 = 0.5 * sigma * u_width * (sigma < 0.0 ? cbn : abn);
    
    // Calculate the final vertex position using the basis vectors and position coefficients
    vec2 point = screenPointB + position.x * p0 + position.y * p1;
    
    // Convert to clip space
    gl_Position = vec4((point / u_bounds * 2.0 - 1.0) * vec2(1, -1), 0, 1);
}
