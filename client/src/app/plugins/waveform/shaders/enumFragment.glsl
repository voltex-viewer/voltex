precision mediump float;
uniform vec4 u_color;
uniform float u_maxValue;

varying float v_value;

vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

void main() {
    if (v_value < 0.0) {
        // Invalid value, don't render
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
    
    gl_FragColor = vec4(finalColor, u_color.a);
}
