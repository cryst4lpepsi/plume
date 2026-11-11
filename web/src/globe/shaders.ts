// GLSL for the globe. The aurora glow lives here and nowhere else in the app.

/** Field bounds shared by the interpolation pass and the atmosphere (degrees). */
export const FIELD = { lon0: -30, lon1: 155, lat0: -15, lat1: 75, w: 592, h: 288 }

export const fieldVert = /* glsl */ `
out vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`

// Inverse-distance weighting of station values on the sphere, evaluated once per replay hour into a
// small float texture. R = value (ug/m3 or error), G = confidence (fades away from stations so empty
// areas stay dark instead of showing invented values), B/A = interpolated wind u/v (m/s).
export const fieldFrag = /* glsl */ `
precision highp float;
uniform sampler2D uStations;   // [N,1] xyz = unit position, w = value (<0 = missing)
uniform sampler2D uWind;       // [N,1] xy = wind u,v m/s
uniform int uN;
uniform vec4 uBounds;          // lon0, lon1, lat0, lat1 (radians)
in vec2 vUv;
layout(location = 0) out highp vec4 outColor;

void main() {
  float lon = mix(uBounds.x, uBounds.y, vUv.x), lat = mix(uBounds.z, uBounds.w, vUv.y);
  vec3 dir = vec3(cos(lat) * cos(lon), sin(lat), -cos(lat) * sin(lon));
  float sw = 0.0, sv = 0.0, cover = 0.0; vec2 wind = vec2(0.0); float sww = 0.0;
  for (int i = 0; i < 1024; i++) {
    if (i >= uN) break;
    vec4 s = texelFetch(uStations, ivec2(i, 0), 0);
    float d = acos(clamp(dot(dir, s.xyz), -1.0, 1.0)) * 6371.0;   // km
    float w = 1.0 / (d * d + 900.0);                               // 30 km softening
    vec2 uv = texelFetch(uWind, ivec2(i, 0), 0).xy;
    wind += w * uv; sww += w;
    if (s.w < 0.0) continue;
    sw += w; sv += w * s.w;
    cover += exp(-d * d / (140.0 * 140.0));
  }
  float value = sw > 0.0 ? sv / sw : 0.0;
  float conf = 1.0 - exp(-1.6 * cover);
  outColor = vec4(value, conf, sww > 0.0 ? wind / sww : vec2(0.0));
}
`

export const earthVert = /* glsl */ `
varying vec2 vUv; varying vec3 vN; varying vec3 vView;
void main() {
  vUv = uv; vN = normalize(normalMatrix * normal);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vView = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}
`
export const earthFrag = /* glsl */ `
uniform sampler2D uMap; uniform float uLights; uniform vec3 uInk;
varying vec2 vUv; varying vec3 vN; varying vec3 vView;
void main() {
  vec3 tex = texture2D(uMap, vUv).rgb;
  float lum = dot(tex, vec3(0.299, 0.587, 0.114));
  // keep land/sea faintly legible, city lights low and slightly warm
  vec3 col = uInk * (0.55 + 2.2 * smoothstep(0.0, 0.12, lum)) + vec3(1.0, 0.86, 0.66) * pow(lum, 1.6) * uLights;
  float rim = pow(1.0 - max(dot(vN, vView), 0.0), 3.0);
  col += uInk * rim * 1.6;
  gl_FragColor = vec4(col, 1.0);
}
`

export const atmoVert = /* glsl */ `
varying vec3 vWorld;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`
// Ray-march through a thin shell above the surface. Density = low haze that thickens with pollution
// + vertical curtains (noise in lat/lon, extruded in altitude) that shimmer where air is clean.
export const atmoFrag = /* glsl */ `
precision highp float;
uniform sampler2D uFieldA, uFieldB, uRamp, uNoise;
uniform float uMix, uTime, uR0, uR1, uGain, uErr, uDim;
uniform int uSteps;
uniform vec4 uBounds;
varying vec3 vWorld;

const float PI = 3.14159265;
float rampT(float v) {
  // piecewise-linear over band edges 0,5,15,25,50,75,150,400 -> [0,1]
  float e[8]; e[0]=0.;e[1]=5.;e[2]=15.;e[3]=25.;e[4]=50.;e[5]=75.;e[6]=150.;e[7]=400.;
  v = clamp(v, 0.0, 400.0);
  for (int i = 0; i < 7; i++) if (v <= e[i+1]) return (float(i) + (v - e[i]) / (e[i+1] - e[i])) / 7.0;
  return 1.0;
}
vec2 sphereHit(vec3 ro, vec3 rd, float r) {
  float b = dot(ro, rd), c = dot(ro, ro) - r * r, h = b * b - c;
  if (h < 0.0) return vec2(-1.0);
  h = sqrt(h); return vec2(-b - h, -b + h);
}
void main() {
  vec3 ro = cameraPosition, rd = normalize(vWorld - cameraPosition);
  vec2 outer = sphereHit(ro, rd, uR1);
  if (outer.y < 0.0) discard;
  vec2 inner = sphereHit(ro, rd, uR0);
  float t0 = max(outer.x, 0.0);
  float t1 = inner.x > 0.0 ? inner.x : outer.y;
  float seg = t1 - t0;
  if (seg <= 0.0) discard;
  float dt = seg / float(uSteps);
  // grazing rays cross far more shell than vertical ones; damp them so the limb does not burn out
  float limb = clamp(0.1 / seg, 0.16, 1.0);
  // per-pixel jitter hides banding at low step counts
  float jit = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
  vec3 acc = vec3(0.0);
  for (int i = 0; i < 16; i++) {
    if (i >= uSteps) break;
    vec3 p = ro + rd * (t0 + (float(i) + jit) * dt);
    float r = length(p); vec3 n = p / r;
    float alt = clamp((r - uR0) / (uR1 - uR0), 0.0, 1.0);
    float lat = asin(clamp(n.y, -1.0, 1.0)), lon = atan(-n.z, n.x);
    vec2 uv = vec2((lon - uBounds.x) / (uBounds.y - uBounds.x), (lat - uBounds.z) / (uBounds.w - uBounds.z));
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) continue;
    vec4 f = mix(texture2D(uFieldA, uv), texture2D(uFieldB, uv), uMix);
    float edge = smoothstep(0.0, 0.03, uv.x) * smoothstep(1.0, 0.97, uv.x) * smoothstep(0.0, 0.04, uv.y) * smoothstep(1.0, 0.96, uv.y);
    float conf = f.g * edge;
    if (conf < 0.004) continue;
    // error mode uses a square-root scale to 75 ug/m3: most errors are a few ug/m3 and should still read
    float t = uErr > 0.5 ? clamp(sqrt(f.r / 75.0), 0.0, 1.0) : rampT(f.r);
    vec3 col = texture2D(uRamp, vec2(t, uErr > 0.5 ? 0.75 : 0.25)).rgb;
    // flow-mapped noise: two phases of wind advection cross-faded so the pattern drifts downwind without stretching
    vec2 q = vec2(lon, lat) * vec2(7.0, 11.0);
    vec2 flow = f.ba * 0.012;
    float ph = fract(uTime * 0.05), ph2 = fract(uTime * 0.05 + 0.5);
    float na = texture2D(uNoise, q + flow * ph * 6.0 + vec2(0.0, uTime * 0.004)).r;
    float nb = texture2D(uNoise, q + flow * ph2 * 6.0 + vec2(0.37, 0.11 + uTime * 0.004)).r;
    float nz = mix(na, nb, abs(2.0 * ph - 1.0));
    float fine = texture2D(uNoise, q * 3.1 + vec2(uTime * 0.011, 0.0)).g;
    // curtains: ridged noise -> thin filaments, extruded vertically, brighter low and fading upward
    float ridge = 1.0 - abs(2.0 * nz - 1.0);
    float curtain = pow(ridge, 5.0) * (0.55 + 0.45 * fine);
    float clean = uErr > 0.5 ? 0.0 : 1.0 - smoothstep(0.2, 0.42, t);  // below ~15-25 ug/m3; no aurora in error mode
    float aur = clean * curtain * smoothstep(0.0, 0.12, alt) * exp(-alt * 2.2) * 1.5;
    float hazeAmt = uErr > 0.5 ? mix(0.3, 1.0, t) : mix(0.035, 1.0, smoothstep(0.2, 0.8, t));
    float haze = hazeAmt * exp(-alt * 5.5) * (0.7 + 0.5 * nz) * 1.25;
    acc += col * (aur + haze) * conf * dt;
  }
  acc *= uGain * uDim * limb * 30.0;
  // compress brightness on the largest channel only, so strong haze keeps its hue instead of bleaching
  float mx = max(acc.r, max(acc.g, acc.b));
  if (mx > 0.0) acc *= (1.0 - exp(-mx * 1.15)) / mx;
  gl_FragColor = vec4(acc, 1.0);
}
`

export const pointsVert = /* glsl */ `
attribute float aValue; attribute float aSel;
uniform float uSize, uPx; uniform sampler2D uRamp; uniform float uErr;
varying vec3 vCol; varying float vSel; varying float vFacing;
float rampT(float v) {
  float e[8]; e[0]=0.;e[1]=5.;e[2]=15.;e[3]=25.;e[4]=50.;e[5]=75.;e[6]=150.;e[7]=400.;
  v = clamp(v, 0.0, 400.0);
  for (int i = 0; i < 7; i++) if (v <= e[i+1]) return (float(i) + (v - e[i]) / (e[i+1] - e[i])) / 7.0;
  return 1.0;
}
void main() {
  vec4 mv = modelViewMatrix * vec4(position * 1.003, 1.0);
  gl_Position = projectionMatrix * mv;
  vec3 n = normalize(normalMatrix * position);
  vFacing = dot(n, normalize(-mv.xyz));
  vSel = aSel;
  vCol = aValue < 0.0 ? vec3(0.13, 0.15, 0.2) : texture2D(uRamp, vec2(uErr > 0.5 ? clamp(sqrt(aValue / 75.0), 0.0, 1.0) : rampT(aValue), uErr > 0.5 ? 0.75 : 0.25)).rgb;
  float s = uSize * (aValue < 0.0 ? 0.7 : 1.0) * (1.0 + aSel * 1.6);
  gl_PointSize = s * uPx * clamp(2.4 / -mv.z, 0.6, 2.2);
}
`
export const pointsFrag = /* glsl */ `
varying vec3 vCol; varying float vSel; varying float vFacing;
void main() {
  if (vFacing < 0.02) discard;
  vec2 c = gl_PointCoord - 0.5; float d = length(c) * 2.0;
  float core = smoothstep(1.0, 0.55, d);
  float ring = vSel * smoothstep(0.62, 0.72, d) * smoothstep(1.0, 0.9, d);
  if (core + ring < 0.01) discard;
  vec3 col = mix(vCol * 1.25, vec3(0.93, 0.96, 1.0), ring);
  gl_FragColor = vec4(col, max(core * (1.0 - vSel * 0.0), ring) * smoothstep(0.02, 0.25, vFacing));
}
`

// Influence arcs. Each vertex knows its edge endpoints and its position t along the arc; the vertex
// shader does the great-circle interpolation so only one weight attribute changes per forecast issue.
export const arcVert = /* glsl */ `
attribute vec3 aSrc; attribute vec3 aDst; attribute float aT; attribute float aW; attribute float aPhase;
uniform float uTime, uPx, uParticle;
varying float vW; varying float vT; varying float vPhase;
vec3 slerp(vec3 a, vec3 b, float t) {
  float om = acos(clamp(dot(a, b), -1.0, 1.0));
  if (om < 1e-4) return a;
  return (sin((1.0 - t) * om) * a + sin(t * om) * b) / sin(om);
}
void main() {
  float t = uParticle > 0.5 ? fract(uTime * 0.16 + aPhase) : aT;
  float om = acos(clamp(dot(aSrc, aDst), -1.0, 1.0));
  vec3 p = slerp(aSrc, aDst, t) * (1.006 + sin(3.14159 * t) * min(0.05, om * 0.35));
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = uPx * (1.6 + 3.2 * aW) * clamp(2.4 / -mv.z, 0.6, 2.0);
  vW = aW; vT = t; vPhase = aPhase;
}
`
export const arcFrag = /* glsl */ `
uniform float uParticle; uniform vec3 uColor;
varying float vW; varying float vT; varying float vPhase;
void main() {
  if (vW < 0.004) discard;
  if (uParticle > 0.5) {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    float a = smoothstep(1.0, 0.3, d) * smoothstep(0.0, 0.08, vT) * smoothstep(1.0, 0.92, vT);
    gl_FragColor = vec4(uColor * 1.5, a * min(1.0, 0.35 + vW * 1.4));
  } else {
    // brighter toward the destination: reads as direction even with motion frozen
    gl_FragColor = vec4(uColor, (0.10 + 0.5 * vT) * min(1.0, vW * 1.6 + 0.08));
  }
}
`
