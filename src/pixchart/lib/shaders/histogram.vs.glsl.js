module.exports = function getShaderCode(customParticleInterpolation) {
  var interpolateParticleCode = (customParticleInterpolation || linearParticleInterpolation)();

  return `
precision highp float;
uniform sampler2D u_image;

// Everything we need to know about frame
// [0] - currentFrameNumber
// [1] - minFrame value
// [2] - maxFrame value
uniform vec4 u_frame;
uniform float u_max_y_value;
uniform vec2 mouse_pos;
uniform vec4 u_sizes;

// [0] is x coordinate of a particle
// [1] is y coordinate of a particle
// [2] is particle lifespan
// [3] is particle index in the texture.
attribute vec4 a_particle;

varying vec4 v_color;

float ease(float t) {
  return t < 0.5 ? 2. * t * t : -1. + (4. - 2. * t) * t;
}

vec2 bezier(vec2 p0, vec2 p1, vec2 p2, vec2 p3, float t) {
  float one_minus_t = 1. - t;

  return one_minus_t * one_minus_t * one_minus_t * p0 + 
    3. * one_minus_t * one_minus_t * t * p1 + 
    3. * one_minus_t * t * t * p2 +
    t * t * t * p3;
}

float bease(float t, vec2 p1, vec2 p2) {
  vec2 p0 = vec2(0.);
  vec2 p3 = vec2(1.);
  vec2 res = bezier(p0, p1, p2, p3, t);
  return res.y;
}

const vec3 rand_constants = vec3(12.9898, 78.233, 4375.85453);

float rand(const vec2 co) {
  float t = dot(rand_constants.xy, co);
  return fract(sin(t) * (rand_constants.z + t));
} 

vec3 rgb2hsv(vec3 c) {
    vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
    vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
    vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));

    float d = q.x - min(q.w, q.y);
    float e = 1.0e-10;
    return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}

vec3 mod289(vec3 x) {
  return x - floor(x * (1.0 / 289.0)) * 289.0;
}

vec2 mod289(vec2 x) {
  return x - floor(x * (1.0 / 289.0)) * 289.0;
}

vec3 permute(vec3 x) {
  return mod289(((x*34.0)+1.0)*x);
}

float snoise(vec2 v) {
  const vec4 C = vec4(0.211324865405187,  // (3.0-sqrt(3.0))/6.0
                      0.366025403784439,  // 0.5*(sqrt(3.0)-1.0)
                     -0.577350269189626,  // -1.0 + 2.0 * C.x
                      0.024390243902439); // 1.0 / 41.0
// First corner
  vec2 i  = floor(v + dot(v, C.yy));
  vec2 x0 = v -   i + dot(i, C.xx);
// Other corners
  vec2 i1;
  //i1.x = step( x0.y, x0.x ); // x0.x > x0.y ? 1.0 : 0.0
  //i1.y = 1.0 - i1.x;
  i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  // x0 = x0 - 0.0 + 0.0 * C.xx ;
  // x1 = x0 - i1 + 1.0 * C.xx ;
  // x2 = x0 - 1.0 + 2.0 * C.xx ;
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
// Permutations
  i = mod289(i); // Avoid truncation effects in permutation
  vec3 p = permute( permute( i.y + vec3(0.0, i1.y, 1.0 ))
		+ i.x + vec3(0.0, i1.x, 1.0 ));
  vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.0);
  m = m*m ;
  m = m*m ;
// Gradients: 41 points uniformly over a line, mapped onto a diamond.
// The ring size 17*17 = 289 is close to a multiple of 41 (41*7 = 287)
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
// Normalise gradients implicitly by scaling m
// Approximation of: m *= inversesqrt( a0*a0 + h*h );
  m *= 1.79284291400159 - 0.85373472095314 * ( a0*a0 + h*h );
// Compute final noise value at P
  vec3 g;
  g.x  = a0.x  * x0.x  + h.x  * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}

vec2 cmpxmul(in vec2 a, in vec2 b) {
	return vec2(a.x * b.x - a.y * b.y, a.y * b.x + a.x * b.y);
}

void main() { 
  vec2 texture_pos = vec2(
    fract(a_particle[3] / u_sizes.x) + 0.5/u_sizes.x,
    floor(a_particle[3] / u_sizes.x)/(u_sizes.y) + 0.5/u_sizes.y
  );

  v_color = texture2D(u_image, texture_pos);
  if (texture_pos.x >= 1.0 || texture_pos.y >= 1.) {
    // This point is beyond texture edge. ignore.
    v_color.a = 0.;
  }

  float factor = min(u_sizes[3]/u_sizes[1], u_sizes[2]/u_sizes[0]);
  vec2 source = vec2(
    (2. * (texture_pos.x) - 1.),
    1. - 2.* texture_pos.y
  ) * factor * u_sizes.xy/u_sizes.zw;

  vec2 target = vec2(
    (2. * (a_particle.x)   - 1.) * 0.9,
    (2. * a_particle.y/(u_max_y_value) - 1.) * 0.9
  ) * factor * u_sizes.xy/u_sizes.zw; 
  

// This particle is allowed to live timeSpan steps, while current frame (u_frame[0]) is
// advancing. Their time zero is counted at u_frame[1].
  float timeSpan = a_particle.z;
  float t0 = clamp((u_frame[0] - u_frame[1])/(timeSpan - u_frame[1]), 0., 1.);
  float t = bease(t0, vec2(0., 0.19), vec2(0.61, 1)); // easeInOutCubic
  //float t = ease(t0);

  if (a_particle.x < 0.) {
    // these particles are filtered out.
    // target.x = 0.; //source.x; //cos(atan(source.y, source.x)) * 2.;
    // target.y = 0.; //source.y; //sin(atan(source.y, source.x)) * 2.;
    v_color.a = 0.; //mix(0.1, 0., t);
  }

  // // This would give 3d
  vec3 h = rgb2hsv(v_color.rgb);
  // float z = mix(0., h[0], t);
  // float zCam = 2.;
  // target.x = -target.x/(z - zCam);
  // target.y = -target.y/(z - zCam);

  // we want to have fast start/slow cool down on each animation phase
  float tmin = 1. - t;
  ${interpolateParticleCode}
  // vec2 dest = tmin * tmin * source + 2. * tmin * arrival0 * t + t * t * target;
  //vec2 dest = tmin * tmin * tmin * source + 3. * tmin * tmin * vec2(0., 0.1) * t + 3. * tmin * t * t * target/2. + target * t * t * t; 
  //v_color.a = mix(1.0, 0.8, t);
  //gl_Position = vec4(dest, 0, 1);
  //gl_Position = vec4(dest, 0, 1);
  gl_Position = vec4(dest, 0, 1);
  gl_PointSize = max(1., ceil(factor));//= mix(srcSize, destSize, t);
}
`
}

function linearParticleInterpolation() {
  return `
vec2 dest = u_frame[3] == 2. ? tmin * target + t * source : tmin * source + t * target;
  `
}