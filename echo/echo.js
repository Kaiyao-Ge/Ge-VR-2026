// Echo, step 1: a dark room that trembles where your voice arrives.
// The microphone's envelope is written to a ring texture; a surface point at
// distance d from where the voice left shows envelope(now - d / speed), so a
// spoken word sweeps across the room as one wave per syllable. Sound has no
// colour, so the room is grey; surfaces show the sound by trembling. The
// triangles never move: each face is drawn as a thin shell above itself, and
// each pixel marches its view ray into the shell until it meets a 3D wave
// function, so crests hide troughs and the surface has real relief.

const DT = .02, SLOTS = 128, HISTORY = (SLOTS - 2) * DT;   // 20 ms slots, about 2.5 s
const MAX_SRC = 16, MAX_BOX = 24;

// decay: how long a surface rings after it is hit (s); weight: response to
// low, mid and high bands; grain: tremor cells per metre; stiff: how hard it trembles.
const MATERIALS = [
   { name: 'concrete', decay: .12, weight: [.8, 1, .9], grain: 55, stiff: .6 },
   { name: 'wood', decay: .25, weight: [1, .9, .5], grain: 35, stiff: .8 },
   { name: 'fabric', decay: .04, weight: [.7, .35, .15], grain: 18, stiff: .35 },
   { name: 'metal', decay: 1.2, weight: [.6, 1, 1.3], grain: 90, stiff: 1.2 },
   { name: 'glass', decay: .5, weight: [.4, .9, 1.3], grain: 70, stiff: 1 },
];
const MAT = Object.fromEntries(MATERIALS.map((m, i) => [m.name, i]));

// Room 6 x 3 x 6 m, origin at the floor's centre. Furniture: [min, max, material, plate top].
const ROOM = { min: [-3, 0, -3], max: [3, 3, 3] };
const FURNITURE = [
   [[-.6, .72, -1.6], [.6, .76, -.9], 'wood', true],           // table
   [[-.58, 0, -1.58], [-.54, .72, -1.54], 'metal'],
   [[.54, 0, -1.58], [.58, .72, -1.54], 'metal'],
   [[-.58, 0, -.96], [-.54, .72, -.92], 'metal'],
   [[.54, 0, -.96], [.58, .72, -.92], 'metal'],
   [[-.25, 0, -.75], [.25, .45, -.3], 'wood'],                 // chair
   [[-.25, .45, -.35], [.25, .95, -.3], 'wood'],
   [[1.2, 0, 1.7], [2.8, .42, 2.6], 'fabric'],                 // sofa
   [[1.2, .42, 2.35], [2.8, .9, 2.6], 'fabric'],
   [[1.2, .42, 1.7], [1.4, .62, 2.35], 'fabric'],
   [[2.6, .42, 1.7], [2.8, .62, 2.35], 'fabric'],
   [[-2.95, 0, .4], [-2.6, 1.9, 1.8], 'metal'],                // shelf
   [[1.4, 0, -1.4], [1.8, 3, -1], 'concrete'],                 // pillar
   [[-.9, 1, -2.99], [.9, 2.2, -2.96], 'glass'],               // window
];

// Per vertex: position 3, normal 3, face uv 2, face size 2 (m), material,
// plate, and the face's axes along u and v (3 + 3).
function addBox(V, I, min, max, faceMat, inward = false, plateTop = false) {
   for (let a = 0; a < 3; a++) for (const s of [-1, 1]) {
      const b = (a + 1) % 3, c = (a + 2) % 3, n = [0, 0, 0], tu = [0, 0, 0], tv = [0, 0, 0], first = V.length / 18;
      n[a] = inward ? -s : s; tu[b] = 1; tv[c] = 1;
      const size = [max[b] - min[b], max[c] - min[c]], mat = faceMat(a, s), plate = plateTop && a === 1 && s === 1 ? 1 : 0;
      for (const [i, j] of [[0, 0], [1, 0], [1, 1], [0, 1]]) {
         const p = [];
         p[a] = s > 0 ? max[a] : min[a]; p[b] = i ? max[b] : min[b]; p[c] = j ? max[c] : min[c];
         V.push(...p, ...n, i, j, ...size, mat, plate, ...tu, ...tv);
      }
      I.push(first, first + 1, first + 2, first, first + 2, first + 3);
   }
}
const vertices = [], indices = [];
addBox(vertices, indices, ROOM.min, ROOM.max, (a, s) => a === 1 && s < 0 ? MAT.wood : MAT.concrete, true);
for (const [min, max, mat, plate] of FURNITURE) addBox(vertices, indices, min, max, () => MAT[mat], false, plate);

const COMMON = `#version 300 es
precision highp float;
#define MAX_SRC ${MAX_SRC}
#define MAX_BOX ${MAX_BOX}
#define NMAT ${MATERIALS.length}
#define DT ${DT.toFixed(3)}
#define SLOTS ${SLOTS}.
#define PI 3.14159265
`;

// The shell: each face pushed out along its normal by the largest amplitude.
const VERT = COMMON + `
in vec3 aPos, aNor, aTu, aTv; in vec4 aUV; in vec2 aMat;
uniform mat4 uViewProj;
uniform float uShell;
out vec3 vPos, vNor, vTu, vTv; out vec4 vUV; flat out vec2 vMat;
void main() {
   vPos = aPos + aNor * uShell; vNor = aNor; vTu = aTu; vTv = aTv; vUV = aUV; vMat = aMat;
   gl_Position = uViewProj * vec4(vPos, 1.);
}`;

const FRAG = COMMON + `
in vec3 vPos, vNor, vTu, vTv; in vec4 vUV; flat in vec2 vMat;
out vec4 fragColor;
uniform float uNow, uSpeed, uFalloff, uGain, uGrainScale, uAmp, uWave, uShell, uHistory, uReveal, uChladniAmt;
uniform bool uPrepass;
uniform vec2 uChladni;
uniform vec3 uEye;
uniform int uSrcCount, uBoxCount;
uniform vec4 uSrc[MAX_SRC];      // xyz mouth, w start time
uniform vec4 uSrcDir[MAX_SRC];   // xyz facing, w end time
uniform vec3 uBoxMin[MAX_BOX], uBoxMax[MAX_BOX];
uniform vec3 uWeight[NMAT];
uniform float uGrain[NMAT], uStiff[NMAT];
uniform sampler2D uEnv;          // x: time ring, y: material; rgb bands with afterglow, a transient

float hash(vec3 p) { p = fract(p * .3183099 + .1); p *= 17.; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float noise(vec3 x) {
   vec3 i = floor(x), f = fract(x); f = f * f * (3. - 2. * f);
   return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
              mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
}
// Ridged noise: thin sharp crests, the bristles.
float ridge(vec3 p) { float r = 1. - abs(noise(p) * 2. - 1.); return r * r * r * r; }
// Does the segment a-b pass through a piece of furniture? The sound shadow.
bool blocked(vec3 a, vec3 b) {
   vec3 d = b - a, inv = 1. / (d + sign(d) * 1e-6 + vec3(equal(d, vec3(0.))) * 1e-6);
   for (int i = 0; i < MAX_BOX; i++) {
      if (i >= uBoxCount) break;
      vec3 t1 = (uBoxMin[i] - a) * inv, t2 = (uBoxMax[i] - a) * inv;
      vec3 lo = min(t1, t2), hi = max(t1, t2);
      float tin = max(max(lo.x, lo.y), lo.z), tout = min(min(hi.x, hi.y), hi.z);
      if (tout > max(tin, 0.) && tin < 1.) return true;
   }
   return false;
}

// The sound at this pixel, found once at the shell and held while marching.
float gA, gR, gI, gF, gGrain;   // amplitude (m), ring, tremor and burst weights, cells per metre
float gFine, gFiner;            // fade of the rings and the noise when smaller than a pixel
vec3 gS;                        // the loudest source here

// Height of the trembling surface above the face at a 3D point, in metres:
// a spherical wave from the source, fast 3D noise and sharp crests.
float H(vec3 p) {
   vec3 q = p * gGrain, drift = vec3(0., uNow * 23., uNow * 17.);
   float b = gFiner * ridge(q * 2. - drift);
   float s = gFine * gR * sin(2. * PI * (distance(p, gS) / uWave - uNow * 6.))
           + gI * (.6 * gFiner * (noise(q + drift) * 2. - 1.) + 1.2 * b) + 1.2 * gF * b;
   return gA * clamp(s, -1., 1.);
}

void main() {
   // Depth pre-pass: the shell's depth only, so the real pass shades each pixel once.
   if (uPrepass) { fragColor = vec4(0.); return; }
   float px = length(fwidth(vPos));   // metres per pixel here
   vec3 n = normalize(vNor), tu = normalize(vTu), tv = normalize(vTv);
   int m = int(vMat.x + .5);
   vec3 base = vPos - n * uShell;   // this pixel's point on the face itself
   vec3 acc = vec3(0.);
   float front = 0., best = 0., weight = 0.;
   gS = base + n;
   for (int k = 0; k < MAX_SRC; k++) {
      if (k >= uSrcCount) break;
      vec3 toS = uSrc[k].xyz - base;
      float d = length(toS), te = uNow - d / uSpeed;   // when the sound now arriving here left the mouth
      if (te < uSrc[k].w || te >= uSrcDir[k].w || uNow - te > uHistory) continue;
      vec3 L = toS / d;
      float cosi = dot(n, L);
      if (cosi <= 0. || blocked(base + n * .005, uSrc[k].xyz)) continue;
      float facing = .5 + .5 * dot(uSrcDir[k].xyz, -L);   // the voice is a cardioid, loudest ahead
      float geo = cosi * (.25 + .75 * facing) / (1. + uFalloff * d * d);
      vec4 e = texture(uEnv, vec2((te / DT + .5) / SLOTS, (float(m) + .5) / float(NMAT)));
      float w = geo * dot(e.rgb, uWeight[m]);
      acc += geo * e.rgb;
      front += geo * e.a;
      weight += w;
      if (w > best) { best = w; gS = uSrc[k].xyz; }
   }
   float I = dot(acc, uWeight[m]) * uGain, Ic = clamp(I, 0., 1.), F = min(front * uGain, 1.5);
   vec2 ed = min(vUV.xy, 1. - vUV.xy) * vUV.zw;
   float edge = 1. - smoothstep(0., .02, min(ed.x, ed.y));
   float hi = acc.b / (acc.r + acc.g + acc.b + 1e-4);
   gA = .001 * uAmp * uStiff[m] * (1. + 1.5 * edge);
   gR = .6 * clamp(weight * uGain, 0., 1.);
   gI = Ic; gF = F;
   gGrain = uGrain[m] * uGrainScale * mix(.7, 1.6, hi);
   gFine = 1. - smoothstep(.15, .5, px / uWave);
   gFiner = 1. - smoothstep(.2, .6, px * gGrain * 2.);

   // March the view ray down through the shell until it is below the surface.
   vec3 rd = normalize(vPos - uEye);
   float cosv = -dot(rd, n);
   if (cosv <= 0.) discard;
   vec3 p;
   float h = 0.;
   // March only where the relief spans at least a pixel, with about one step per pixel of it.
   float steps = clamp(2. * gA / (px * max(cosv, .1)), 0., 40.);
   if (gA * (gR + gI + gF) > 1e-6 && steps >= 1.) {
      steps = max(steps, 8.);
      float tMax = 2. * uShell / max(cosv, .1), dt = tMax / steps, t0 = 0., t1 = 0.;
      bool hit = false;
      for (int i = 1; i <= 40; i++) {
         if (float(i) > steps) break;
         t1 = float(i) * dt;
         if (uShell - t1 * cosv <= H(vPos + rd * t1)) { hit = true; break; }
         t0 = t1;
      }
      if (!hit) discard;
      for (int i = 0; i < 4; i++) {
         float t = .5 * (t0 + t1);
         if (uShell - t * cosv <= H(vPos + rd * t)) t1 = t; else t0 = t;
      }
      p = vPos + rd * t1;
      h = uShell - t1 * cosv;
   } else p = vPos + rd * (uShell / cosv);   // silent, or too small to see in relief: the flat face
   // Rays that leave the face sideways miss it: ragged edges.
   vec3 off = p - base;
   vec2 uv = vUV.xy + vec2(dot(off, tu), dot(off, tv)) / vUV.zw;
   if (any(lessThan(uv, vec2(0.))) || any(greaterThan(uv, vec2(1.)))) discard;

   // Normal from the wave function's slope along the face.
   float e = .0015, h0 = H(p);
   vec3 N = normalize(n - tu * (H(p + tu * e) - h0) / e - tv * (H(p + tv * e) - h0) / e);
   vec3 L = normalize(gS - p), V = -rd;
   float facet = max(dot(N, L), 0.), glint = pow(max(dot(reflect(-L, N), V), 0.), 24.);
   // Troughs are darker: less of the sound reaches into them.
   float depth = gA > 0. ? .3 + .7 * smoothstep(-gA, gA, h) : 1.;
   float lum = (Ic * (.1 + .9 * facet * facet) * (1. + 1.2 * edge) + Ic * glint + F * (.3 + .7 * facet + glint)) * depth + .1 * Ic * Ic;
   // Chladni figure on plates: sand gathers on the nodal lines of the sung pitch.
   if (vMat.y > .5 && uChladniAmt > 0.) {
      float a = uChladni.x * PI, b = uChladni.y * PI;
      float c = cos(a * uv.x) * cos(b * uv.y) - cos(b * uv.x) * cos(a * uv.y);
      lum *= mix(1., .15 + 2.5 * (1. - smoothstep(0., .15, abs(c))), uChladniAmt);
   }
   lum += uReveal * (.04 + .05 * max(n.y, 0.));
   fragColor = vec4(vec3(1. - exp(-lum * 1.6)), 1.);
}`;

// ---------- WebGL ----------
const canvas = document.getElementById('view');
const gl = canvas.getContext('webgl2', { antialias: true });
function shader(type, src) {
   const s = gl.createShader(type);
   gl.shaderSource(s, src); gl.compileShader(s);
   if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
   return s;
}
const prog = gl.createProgram();
gl.attachShader(prog, shader(gl.VERTEX_SHADER, VERT));
gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, FRAG));
gl.linkProgram(prog);
if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
gl.useProgram(prog);
const U = name => gl.getUniformLocation(prog, name);

gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW);
gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(indices), gl.STATIC_DRAW);
for (const [name, size, offset] of [['aPos', 3, 0], ['aNor', 3, 12], ['aUV', 4, 24], ['aMat', 2, 40], ['aTu', 3, 48], ['aTv', 3, 60]]) {
   const loc = gl.getAttribLocation(prog, name);
   gl.enableVertexAttribArray(loc);
   gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 72, offset);
}

const boxes = FURNITURE.slice(0, MAX_BOX);
gl.uniform1i(U('uBoxCount'), boxes.length);
gl.uniform3fv(U('uBoxMin'), boxes.flatMap(b => b[0]));
gl.uniform3fv(U('uBoxMax'), boxes.flatMap(b => b[1]));
gl.uniform1fv(U('uStiff'), MATERIALS.map(m => m.stiff));
gl.uniform3fv(U('uWeight'), MATERIALS.flatMap(m => m.weight));
gl.uniform1fv(U('uGrain'), MATERIALS.map(m => m.grain));
gl.uniform1f(U('uHistory'), HISTORY);

const envTex = gl.createTexture();
gl.activeTexture(gl.TEXTURE0);
gl.bindTexture(gl.TEXTURE_2D, envTex);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
gl.uniform1i(U('uEnv'), 0);
gl.enable(gl.DEPTH_TEST);

// ---------- Sound: microphone features and the envelope ring ----------
const audio = { an: null, time: null, freq: null, rate: 48000, slow: 0, pitch: 0, conf: 0 };
async function startMic() {
   const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
   const ctx = new AudioContext();
   await ctx.resume();
   audio.an = ctx.createAnalyser();
   audio.an.fftSize = 2048; audio.an.smoothingTimeConstant = 0;
   ctx.createMediaStreamSource(stream).connect(audio.an);
   audio.time = new Float32Array(2048); audio.freq = new Float32Array(1024); audio.rate = ctx.sampleRate;
}

// [low, mid, high, transient] in 0..1, plus pitch in Hz (0 if none).
function listen() {
   if (!audio.an) return [0, 0, 0, 0, 0];
   const { an, time, freq, rate } = audio;
   an.getFloatTimeDomainData(time); an.getFloatFrequencyData(freq);
   let sq = 0;
   for (const x of time) sq += x * x;
   const db = 10 * Math.log10(sq / time.length + 1e-12);
   const level = Math.min(1, Math.max(0, (db - settings.gate) / 40));
   const band = [0, 0, 0], hz = rate / an.fftSize;
   for (let i = 1; i < freq.length; i++) {
      const f = i * hz, p = 10 ** (freq[i] / 10);
      if (f >= 80 && f < 300) band[0] += p; else if (f >= 300 && f < 2000) band[1] += p; else if (f >= 2000 && f < 8000) band[2] += p;
   }
   const total = band[0] + band[1] + band[2] + 1e-20;
   const bands = [1.6, 2.5, 6].map((k, i) => level * Math.min(1, band[i] / total * k));
   const transient = Math.min(1, Math.max(0, level - audio.slow) * 3);
   audio.slow += (level - audio.slow) * .15;
   // Pitch by autocorrelation, only when there is something to hear.
   audio.pitch = 0; audio.conf = 0;
   if (level > .15) {
      let r0 = 0, best = 0, lag0 = 0;
      for (let i = 0; i < 1024; i++) r0 += time[i] * time[i];
      for (let lag = Math.floor(rate / 800); lag <= Math.ceil(rate / 70); lag++) {
         let r = 0;
         for (let i = 0; i < 1024; i++) r += time[i] * time[i + lag];
         if (r > best) { best = r; lag0 = lag; }
      }
      audio.conf = best / (r0 + 1e-12);
      if (audio.conf > .6) audio.pitch = rate / lag0;
   }
   return [...bands, transient, audio.pitch];
}

// Synthetic sounds, one frame per 20 ms slot: [low, mid, high, transient, pitch].
const ramp = (n, peak, pitch) => Array.from({ length: n }, (_, i) => {
   const g = Math.min(1, i / 3, (n - i) / 5);
   return [...peak.map(v => v * g), i === 0 ? .4 : 0, pitch];
});
const SYNTH = {
   Digit1: [[.3, .7, 1, 1, 0], [.1, .3, .4, 0, 0]],
   Digit2: ramp(35, [.85, .35, .05], 220),
   Digit3: [...ramp(11, [.6, .75, .3], 200), ...ramp(4, [0, 0, 0], 0), ...ramp(15, [.7, .6, .2], 170)],
};
let synth = [];

// Ring of SLOTS slots per material: the envelope with that material's
// afterglow (peak hold with exponential release), and the raw transient.
const ring = new Float32Array(SLOTS * MATERIALS.length * 4);
const glow = MATERIALS.map(() => [0, 0, 0]);
let lastSlot = -1, heard = [0, 0, 0, 0, 0];
function record(now) {
   const cur = Math.floor(now / DT), mic = listen();
   if (lastSlot < 0) lastSlot = cur - 1;
   for (let s = lastSlot + 1; s <= cur; s++) {
      const sy = synth.shift() || [0, 0, 0, 0, 0];
      heard = mic.map((v, j) => Math.max(s === lastSlot + 1 || j !== 3 ? v : 0, sy[j]));
      const i = s % SLOTS;
      MATERIALS.forEach((m, k) => {
         const r = Math.exp(-DT / m.decay);
         for (let b = 0; b < 3; b++) glow[k][b] = Math.max(heard[b], glow[k][b] * r);
         ring.set([...glow[k], heard[3]], (k * SLOTS + i) * 4);
      });
   }
   // Clear the oldest slot, so filtering at the write head never blends in stale sound.
   const next = (cur + 1) % SLOTS;
   MATERIALS.forEach((_, k) => ring.fill(0, (k * SLOTS + next) * 4, (k * SLOTS + next) * 4 + 4));
   lastSlot = cur;
   gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, SLOTS, MATERIALS.length, 0, gl.RGBA, gl.FLOAT, ring);
}
// Loudest value recorded between two times, over all materials.
function energy(t0, t1, now) {
   let e = 0;
   for (let s = Math.max(0, Math.floor(t0 / DT), Math.floor((now - HISTORY) / DT)); s <= Math.min(Math.ceil(t1 / DT), Math.floor(now / DT)); s++)
      for (let k = 0; k < MATERIALS.length; k++) {
         const o = (k * SLOTS + s % SLOTS) * 4;
         e = Math.max(e, ring[o], ring[o + 1], ring[o + 2], ring[o + 3]);
      }
   return e;
}

// Where the voice left from: a new source whenever the mouth moves 20 cm or
// turns 20 degrees, so waves already travelling keep their origin.
const sources = [];
function track(now, mouth, facing) {
   const last = sources.at(-1);
   if (!last || dist(last.pos, mouth) > .2 || dot(last.facing, facing) < .94) sources.push({ t0: now, pos: mouth, facing });
   while (sources.length > 1 && sources[1].t0 < now - HISTORY) sources.shift();
   const live = [];
   for (let i = sources.length - 1; i >= 0 && live.length < MAX_SRC; i--) {
      const s = sources[i], t1 = sources[i + 1]?.t0 ?? 1e9;
      if (energy(s.t0, Math.min(t1, now), now) > 1e-3) live.push({ ...s, t1 });
   }
   const src = new Float32Array(MAX_SRC * 4), dir = new Float32Array(MAX_SRC * 4);
   live.forEach((s, i) => { src.set([...s.pos, s.t0], i * 4); dir.set([...s.facing, s.t1], i * 4); });
   gl.uniform1i(U('uSrcCount'), live.length);
   gl.uniform4fv(U('uSrc'), src);
   gl.uniform4fv(U('uSrcDir'), dir);
   return live.length;
}

// Chladni modes (n, m), two semitones apart from 110 Hz.
const MODES = [[1, 2], [1, 3], [2, 3], [1, 4], [3, 4], [2, 5], [3, 5], [1, 5], [4, 5], [2, 7], [3, 7], [5, 6]];
const chladni = { mode: MODES[0], amount: 0 };
function updateChladni(pitch) {
   if (pitch > 0) {
      const i = Math.round(6 * Math.log2(pitch / 110));
      chladni.mode = MODES[Math.min(MODES.length - 1, Math.max(0, i))];
      chladni.amount += (1 - chladni.amount) * .2;
   } else chladni.amount *= .97;
   gl.uniform2fv(U('uChladni'), chladni.mode);
   gl.uniform1f(U('uChladniAmt'), chladni.amount);
}

// ---------- Camera and input ----------
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const normalize = a => { const l = Math.hypot(...a); return a.map(v => v / l); };
const cam = { pos: [0, 1.6, 1.2], yaw: 0, pitch: -.15 };
const keys = new Set();
let reveal = 0;
addEventListener('keydown', e => {
   keys.add(e.code);
   if (SYNTH[e.code]) synth = SYNTH[e.code].map(f => [...f]);
   if (e.code === 'KeyG') reveal = 1 - reveal;
});
addEventListener('keyup', e => keys.delete(e.code));
canvas.addEventListener('click', () => canvas.requestPointerLock?.());
addEventListener('mousemove', e => {
   if (document.pointerLockElement !== canvas) return;
   cam.yaw -= e.movementX * .0025;
   cam.pitch = Math.max(-1.4, Math.min(1.4, cam.pitch - e.movementY * .0025));
});

function viewProj(forward) {
   const aspect = canvas.width / canvas.height, f = 1 / Math.tan(35 * Math.PI / 180), near = .05, far = 30;
   const P = [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) / (near - far), -1, 0, 0, 2 * far * near / (near - far), 0];
   const z = forward.map(v => -v), x = normalize(cross([0, 1, 0], z)), y = cross(z, x), e = cam.pos;
   const V = [x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x, e), -dot(y, e), -dot(z, e), 1];
   const out = new Array(16).fill(0);
   for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) out[c * 4 + r] += P[k * 4 + r] * V[c * 4 + k];
   return out;
}

// ---------- Settings, HUD ----------
const settings = {};
for (const id of ['speed', 'falloff', 'gain', 'grain', 'amp', 'wave', 'gate', 'res']) {
   const input = document.getElementById(id), show = document.getElementById(id + 'V');
   const set = () => { settings[id] = +input.value; show.textContent = input.value; };
   input.addEventListener('input', set); set();
}
const hud = document.getElementById('hud').getContext('2d');
function drawHud(count, fps) {
   const { canvas: c } = hud, W = c.width, H = c.height, graph = H - 40;
   hud.clearRect(0, 0, W, H);
   // The fabric row barely rings, so it is close to the raw envelope.
   const row = MAT.fabric, now = lastSlot;
   [['#ff7a45', 0], ['#ffd84d', 1], ['#4de6ff', 2], ['#ffffff', 3]].forEach(([color, ch]) => {
      hud.strokeStyle = color; hud.beginPath();
      for (let s = 0; s < SLOTS - 1; s++) {
         const slot = now - (SLOTS - 2) + s, v = ring[(row * SLOTS + ((slot % SLOTS) + SLOTS) % SLOTS) * 4 + ch];
         const x = 8 + s / (SLOTS - 2) * (W - 16), y = 8 + graph - v * graph;
         s ? hud.lineTo(x, y) : hud.moveTo(x, y);
      }
      hud.stroke();
   });
   hud.fillStyle = '#9fb3c8'; hud.font = '12px system-ui';
   const pitch = heard[4] ? `${Math.round(heard[4])} Hz  模态 ${chladni.mode.join(',')}` : '—';
   hud.fillText(`低 中 高 瞬态 · 最近 2.5 s   音高 ${pitch}`, 8, H - 22);
   hud.fillText(`声源 ${count}   ${audio.an ? '麦克风已开' : '无麦克风（1/2/3 合成）'}   ${fps.toFixed(0)} fps`, 8, H - 6);
}

// ---------- Start ----------
const msg = document.getElementById('msg');
document.getElementById('go').addEventListener('click', async () => {
   document.getElementById('start').remove();
   try { await startMic(); } catch (e) { msg.textContent = `麦克风不可用（${e.name}），可用 1/2/3 键合成声音`; }
});

// Time starts at the first frame: a frame's timestamp can be earlier than
// performance.now() at load, and a negative time would index the ring below 0.
let t0 = null, prev = 0, fps = 60;
function frame(ms) {
   if (t0 === null) prev = t0 = ms;
   const now = (ms - t0) / 1000, dt = Math.min(.1, (ms - prev) / 1000);
   prev = ms; fps += (1 / Math.max(dt, 1e-3) - fps) * .05;
   const dpr = settings.res;
   if (canvas.width !== Math.round(innerWidth * dpr) || canvas.height !== Math.round(innerHeight * dpr)) {
      canvas.width = Math.round(innerWidth * dpr); canvas.height = Math.round(innerHeight * dpr);
   }
   const forward = [-Math.sin(cam.yaw) * Math.cos(cam.pitch), Math.sin(cam.pitch), -Math.cos(cam.yaw) * Math.cos(cam.pitch)];
   const flat = normalize([forward[0], 0, forward[2]]), side = [-flat[2], 0, flat[0]];
   const move = (keys.has('KeyW') - keys.has('KeyS')), strafe = (keys.has('KeyD') - keys.has('KeyA'));
   for (const i of [0, 2]) cam.pos[i] = Math.max(-2.8, Math.min(2.8, cam.pos[i] + (flat[i] * move + side[i] * strafe) * 1.5 * dt));
   const mouth = [cam.pos[0] + flat[0] * .08, cam.pos[1] - .08, cam.pos[2] + flat[2] * .08];

   record(now);
   const count = track(now, mouth, forward);
   updateChladni(heard[4]);
   gl.uniform1f(U('uNow'), now);
   gl.uniform1f(U('uSpeed'), settings.speed);
   gl.uniform1f(U('uFalloff'), settings.falloff);
   gl.uniform1f(U('uGain'), settings.gain);
   gl.uniform1f(U('uGrainScale'), settings.grain);
   gl.uniform1f(U('uAmp'), settings.amp);
   gl.uniform1f(U('uWave'), settings.wave / 100);
   // Thick enough for the stiffest material at an edge.
   gl.uniform1f(U('uShell'), .001 * settings.amp * Math.max(...MATERIALS.map(m => m.stiff)) * 2.5 + 1e-4);
   gl.uniform1f(U('uReveal'), reveal);
   gl.uniformMatrix4fv(U('uViewProj'), false, viewProj(forward));
   gl.uniform3fv(U('uEye'), cam.pos);
   gl.viewport(0, 0, canvas.width, canvas.height);
   gl.clearColor(0, 0, 0, 1);
   gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
   // Depth of the shells first, then shade only the front one per pixel.
   gl.colorMask(false, false, false, false); gl.depthMask(true); gl.depthFunc(gl.LESS);
   gl.uniform1i(U('uPrepass'), 1);
   gl.drawElements(gl.TRIANGLES, indices.length, gl.UNSIGNED_INT, 0);
   gl.colorMask(true, true, true, true); gl.depthMask(false); gl.depthFunc(gl.LEQUAL);
   gl.uniform1i(U('uPrepass'), 0);
   gl.drawElements(gl.TRIANGLES, indices.length, gl.UNSIGNED_INT, 0);
   gl.depthMask(true);
   drawHud(count, fps);
   requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
