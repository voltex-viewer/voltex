#version 300 es
precision mediump float;

// Constants
const float GOLDEN_RATIO_CONJUGATE = 0.618034;
const float HSV_SATURATION = 0.7;
const float HSV_VALUE = 0.8;
const float COLOR_MIX_FACTOR = 0.6;
const float BORDER_DARKEN_FACTOR = 0.8;
const float NULL_VALUE_EPSILON = 0.001;
const float SEGMENT_DEGENERATE_THRESHOLD = 0.0001;
const float AA_EDGE_WIDTH = 0.5;

uniform vec4 u_color;
uniform float u_nullValue;
uniform bool u_hasNullValue;
uniform float u_borderWidth;

flat in float v_value;
in vec2 v_screenPos;
flat in float v_topLeftX;
flat in float v_topRightX;
flat in float v_bottomLeftX;
flat in float v_bottomRightX;
flat in float v_topY;
flat in float v_topEnd;
flat in float v_bottomStart;
flat in float v_bottomEnd;

out vec4 fragColor;

vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

// Distance from point p to line segment a-b
float distToSegment(vec2 p, vec2 a, vec2 b) {
    vec2 ab = b - a;
    float len2 = dot(ab, ab);
    if (len2 < SEGMENT_DEGENERATE_THRESHOLD) return length(p - a);
    float t = clamp(dot(p - a, ab) / len2, 0.0, 1.0);
    vec2 proj = a + t * ab;
    return length(p - proj);
}

void main() {
    if (u_hasNullValue && abs(v_value - u_nullValue) < NULL_VALUE_EPSILON) {
        discard;
    }
    
    vec2 p = v_screenPos;
    
    // Define diagonal edge vertices
    vec2 topRightEnd = vec2(v_topRightX, v_topEnd);
    vec2 bottomRightStart = vec2(v_bottomRightX, v_bottomStart);
    vec2 bottomLeftStart = vec2(v_bottomLeftX, v_bottomStart);
    vec2 topLeftEnd = vec2(v_topLeftX, v_topEnd);
    
    // Horizontal edges
    float d = min(abs(p.y - v_topY), abs(p.y - v_bottomEnd));
    
    // Vertical edges (only in top and bottom sections, not trapezoid)
    if (p.y <= v_topEnd) {
        d = min(d, min(abs(p.x - v_topLeftX), abs(p.x - v_topRightX)));
    }
    if (p.y >= v_bottomStart) {
        d = min(d, min(abs(p.x - v_bottomLeftX), abs(p.x - v_bottomRightX)));
    }
    
    // Diagonal edges
    d = min(d, distToSegment(p, topRightEnd, bottomRightStart));
    d = min(d, distToSegment(p, bottomLeftStart, topLeftEnd));
    
    // Generate color using golden ratio for even hue distribution
    float hue = fract(v_value * GOLDEN_RATIO_CONJUGATE);
    vec3 hsvColor = vec3(hue, HSV_SATURATION, HSV_VALUE);
    vec3 rgbColor = hsv2rgb(hsvColor);
    vec3 finalColor = mix(u_color.rgb, rgbColor, COLOR_MIX_FACTOR);
    
    // Border or fill based on distance with anti-aliasing
    vec3 borderColor = finalColor * BORDER_DARKEN_FACTOR;
    float aa = smoothstep(u_borderWidth - AA_EDGE_WIDTH, u_borderWidth + AA_EDGE_WIDTH, d);
    vec3 color = mix(borderColor, finalColor, aa);
    
    fragColor = vec4(color, u_color.a);
}
