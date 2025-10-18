precision mediump float;
uniform vec4 u_color;
uniform float u_maxValue;
uniform float u_nullValue;
uniform int u_hasNullValue;

varying float v_value;
varying vec2 v_rectPosition;
varying vec2 v_rectSize;

vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

void main() {
    // Discard fragments with null values if null handling is enabled
    if (u_hasNullValue == 1 && abs(v_value - u_nullValue) < 0.001) {
        discard;
        return;
    }
    
    // Generate color based on value using HSV
    float hue = fract(v_value * 0.618034); // Golden ratio for good color distribution
    float saturation = 0.7;
    float brightness = 0.8;
    
    vec3 hsvColor = vec3(hue, saturation, brightness);
    vec3 rgbColor = hsv2rgb(hsvColor);
    
    // Mix with base color for consistency
    vec3 finalColor = mix(u_color.rgb, rgbColor, 0.6);
    
    // Check if fragment is within 2px of any edge for border
    float borderWidth = 1.0;
    bool isLeftEdge = v_rectPosition.x < borderWidth;
    bool isRightEdge = v_rectPosition.x > v_rectSize.x - borderWidth;
    bool isTopEdge = v_rectPosition.y < borderWidth;
    bool isBottomEdge = v_rectPosition.y > v_rectSize.y - borderWidth;
    bool isBorder = isLeftEdge || isRightEdge || isTopEdge || isBottomEdge;
    
    if (isBorder) {
        // Draw border as darkened version of rect color
        gl_FragColor = vec4(finalColor * 0.8, u_color.a);
    } else {
        gl_FragColor = vec4(finalColor, u_color.a);
    }
}
