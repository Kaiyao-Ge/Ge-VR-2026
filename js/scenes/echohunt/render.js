// Draws the room as the sound sees it, with its own WebGL program, before
// Clay draws the scene's objects into the same frame. The triangles never
// move: each face is drawn as a thin shell above itself, and each pixel
// marches its view ray into the shell until it meets a 3D wave function, so
// crests hide troughs and the surface has real relief.
import { MATERIALS, STRIDE } from './room.js';
import { DT, SLOTS, HISTORY, CHANNELS, MAX_SRC, SPEED } from './field.js';
import { UNIT } from './paths.js';

const NMAT = MATERIALS.length;
const COMMON = `#version 300 es
precision highp float;
#define MAX_SRC ${MAX_SRC}
#define NMAT ${NMAT}
#define ROWS ${CHANNELS * NMAT}.
#define DT ${DT.toFixed(3)}
#define SLOTS ${SLOTS}.
#define PI 3.14159265
`;

const VERT = COMMON + `
in vec3 aPos, aNor, aTu, aTv; in vec4 aUV; in vec2 aMat;
uniform mat4 uViewProj;
uniform float uShell;
out vec3 vPos, vNor, vTu, vTv; out vec4 vUV; flat out vec2 vMat;
void main() {
   // A box face also grows sideways by the shell, so neighbouring shells still meet at the edges.
   vec2 out_ = aUV.z < 100. ? (aUV.xy * 2. - 1.) * uShell : vec2(0.);
   vPos = aPos + aNor * uShell + aTu * out_.x + aTv * out_.y; vNor = aNor; vTu = aTu; vTv = aTv; vMat = aMat;
   vUV = vec4(aUV.xy + out_ / aUV.zw, aUV.zw);   // the face's own coordinates, past 0..1 where it grew
   gl_Position = uViewProj * vec4(vPos, 1.);
}`;

const FRAG = COMMON + `
in vec3 vPos, vNor, vTu, vTv; in vec4 vUV; flat in vec2 vMat;
out vec4 fragColor;
uniform float uNow, uSpeed, uFalloff, uGain, uAmp, uWave, uShell, uReveal, uChladniAmt, uMaxSteps;
uniform bool uPrepass;
uniform vec2 uChladni;
uniform vec3 uEye;
uniform int uSrcCount;
uniform vec4 uSrcA[MAX_SRC], uSrcB[MAX_SRC], uSrcC[MAX_SRC], uSrcD[MAX_SRC];
uniform float uSrcSlot[MAX_SRC];   // which part of uPath holds each source's paths, or -1
uniform highp sampler3D uPath;     // path fields, a grid per source stacked along z
uniform vec3 uGridMin, uGridN;
uniform float uCell;
uniform vec3 uWeight[NMAT];
uniform float uGrain[NMAT], uStiff[NMAT], uDecay[NMAT];
uniform sampler2D uEnv;          // x: time ring, y: channel and material; rgb bands with afterglow, a transient

float hash(vec3 p) { p = fract(p * .3183099 + .1); p *= 17.; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float noise(vec3 x) {
   vec3 i = floor(x), f = fract(x); f = f * f * (3. - 2. * f);
   return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
              mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
}
// Ridged noise: thin sharp crests, the bristles.
float ridge(vec3 p) { float r = 1. - abs(noise(p) * 2. - 1.); return r * r * r * r; }
// The extra way (m) sound from source k takes round things to reach p, from its
// path field; past 100 where no way leads. No field yet: straight.
float excess(int k, vec3 p) {
   float s = uSrcSlot[k];
   if (s < 0.) return 0.;
   vec3 c = clamp((p - uGridMin) / uCell, vec3(.5), uGridN - .5);
   // Level 0 by hand: inside the loop over sources the screen derivatives texture() needs are undefined.
   float v = textureLod(uPath, vec3(c.xy / uGridN.xy, (s * uGridN.z + c.z) / (uGridN.z * float(MAX_SRC))), 0.).r * 255.;
   return v > 250. ? 1e3 : v * ${UNIT};
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
   // No discard here, so a tiled GPU keeps its early depth test.
   if (uPrepass) { fragColor = vec4(0., 0., 0., 1.); return; }
   vec3 n = normalize(vNor), tu = normalize(vTu), tv = normalize(vTv), rd = normalize(vPos - uEye);
   float cosv = -dot(rd, n);
   // A shell seen from behind, where it overhangs a corner: the dark inside.
   if (cosv <= 0.) { fragColor = vec4(0., 0., 0., 1.); return; }
   // Where the view ray meets the face itself. Where the shell overhangs the
   // face, the nearest point of the face: never a crack at the edges.
   vec3 flat_ = vPos + rd * (uShell / cosv), off0 = flat_ - (vPos - n * uShell);
   vec2 uv0 = vUV.xy + vec2(dot(off0, tu), dot(off0, tv)) / vUV.zw, c0 = clamp(uv0, 0., 1.);
   flat_ += (tu * (c0.x - uv0.x) * vUV.z + tv * (c0.y - uv0.y) * vUV.w) * step(vUV.z, 100.);
   uv0 = c0;
   float px = length(fwidth(vPos));   // metres per pixel here
   int m = int(vMat.x + .5);
   vec3 base = vPos - n * uShell;   // this pixel's point on the face itself
   vec3 acc = vec3(0.);
   float front = 0., best = 0., weight = 0.;
   gS = base + n;
   for (int k = 0; k < MAX_SRC; k++) {
      if (k >= uSrcCount) break;
      vec3 toS = uSrcA[k].xyz - base;
      float straight = length(toS);
      // Not here yet even by the straight way: no need to read the way round.
      if (uNow - straight / uSpeed < uSrcA[k].w) continue;
      // Round whatever is in the way: later, and weaker the further round. Read a cell out from the surface, in the air.
      float ex = excess(k, base + n * .1);
      if (ex > 100.) continue;
      float d = straight + ex, te = uNow - d / uSpeed;   // when the sound now arriving here left
      if (te < uSrcA[k].w || te >= uSrcB[k].w || uNow - te > ${HISTORY.toFixed(3)}) continue;
      vec3 L = toS / straight;
      vec4 D = uSrcD[k];
      float cosi = dot(n, L);
      if (cosi <= -.1 * D.w) continue;
      float facing = .5 + .5 * dot(uSrcB[k].xyz, -L);   // a voice is a cardioid, loudest ahead
      float geo = mix(max(cosi, 0.), 1., D.w) * (.25 + .75 * facing) / (1. + uFalloff * D.z * d * d) * exp(-ex / .5);
      vec4 e;
      float c = uSrcC[k].w;
      if (c >= 0.) e = textureLod(uEnv, vec2((te / DT + .5) / SLOTS, (c * float(NMAT) + float(m) + .5) / ROWS), 0.);
      else {
         float tau = te - uSrcA[k].w;
         e = vec4(uSrcC[k].rgb * D.x * (tau < D.y ? 1. : exp(-(tau - D.y) / uDecay[m])), tau < .04 ? D.x : 0.);
      }
      if (geo * (e.r + e.g + e.b + e.a) < 1e-3) continue;
      float w = geo * dot(e.rgb, uWeight[m]);
      acc += geo * e.rgb;
      front += geo * e.a;
      weight += w;
      if (w > best) { best = w; gS = uSrcA[k].xyz; }
   }
   float I = dot(acc, uWeight[m]) * uGain, Ic = clamp(I, 0., 1.), F = min(front * uGain, 1.5);
   vec2 ed = min(vUV.xy, 1. - vUV.xy) * vUV.zw;
   float edge = 1. - smoothstep(0., .02, min(ed.x, ed.y));
   float hi = acc.b / (acc.r + acc.g + acc.b + 1e-4);
   gA = .001 * uAmp * uStiff[m] * (1. + 1.5 * edge);
   gR = .6 * clamp(weight * uGain, 0., 1.);
   gI = Ic; gF = F;
   gGrain = uGrain[m] * mix(.7, 1.6, hi);
   gFine = 1. - smoothstep(.15, .5, px / uWave);
   gFiner = 1. - smoothstep(.2, .6, px * gGrain * 2.);

   // March the view ray down through the shell until it is below the surface.
   vec3 p = flat_;
   float h = 0.;
   // March only where the relief spans at least a pixel, with about one step per pixel of it.
   float steps = clamp(2. * gA / (px * max(cosv, .1)), 0., uMaxSteps);
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
      if (hit) {
         for (int i = 0; i < 4; i++) {
            float t = .5 * (t0 + t1);
            if (uShell - t * cosv <= H(vPos + rd * t)) t1 = t; else t0 = t;
         }
         p = vPos + rd * t1;
         h = uShell - t1 * cosv;
      }
   }
   // Silent, too small to see in relief, missed, or past the face's edge: the flat face.
   // Every pixel the pre-pass kept is shaded, so nothing behind shows through.
   vec3 off = p - base;
   vec2 uv = vUV.xy + vec2(dot(off, tu), dot(off, tv)) / vUV.zw;
   if (any(lessThan(uv, vec2(0.))) || any(greaterThan(uv, vec2(1.)))) { p = flat_; uv = uv0; h = 0.; }

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

// A full-screen triangle in one colour and depth: the backdrop, drawn rather
// than cleared, since a headset showed its camera through cleared pixels.
const FILL_VERT = `#version 300 es
uniform float uDepth;
void main() { gl_Position = vec4(vec2(gl_VertexID & 1, gl_VertexID >> 1) * 4. - 1., uDepth * 2. - 1., 1.); }`;
const FILL_FRAG = `#version 300 es
precision highp float;
uniform vec4 uColor;
out vec4 fragColor;
void main() { fragColor = uColor; }`;

const ENV_UNIT = 15, PATH_UNIT = 14;
export const LOOK = { falloff: .12, gain: 1, amp: 6, wave: 4 };

export class EchoRenderer {
   constructor(gl) {
      this.gl = gl;
      const shader = (type, src) => {
         const s = gl.createShader(type);
         gl.shaderSource(s, src); gl.compileShader(s);
         if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
         return s;
      };
      const link = (vert, frag) => {
         const p = gl.createProgram();
         gl.attachShader(p, shader(gl.VERTEX_SHADER, vert));
         gl.attachShader(p, shader(gl.FRAGMENT_SHADER, frag));
         gl.linkProgram(p);
         if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
         return p;
      };
      const prog = this.prog = link(VERT, FRAG);
      this.fill = link(FILL_VERT, FILL_FRAG);
      const locations = {};
      this.U = name => locations[name] ??= gl.getUniformLocation(prog, name);
      this.vao = gl.createVertexArray();
      this.vbo = gl.createBuffer();
      this.ibo = gl.createBuffer();
      this.count = 0;
      const saved = this.save();
      gl.bindVertexArray(this.vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo);
      for (const [name, size, offset] of [['aPos', 3, 0], ['aNor', 3, 3], ['aUV', 4, 6], ['aMat', 2, 10], ['aTu', 3, 12], ['aTv', 3, 15]]) {
         const loc = gl.getAttribLocation(prog, name);
         gl.enableVertexAttribArray(loc);
         gl.vertexAttribPointer(loc, size, gl.FLOAT, false, STRIDE * 4, offset * 4);
      }
      this.env = gl.createTexture();
      gl.activeTexture(gl.TEXTURE0 + ENV_UNIT);
      gl.bindTexture(gl.TEXTURE_2D, this.env);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.useProgram(prog);
      gl.uniform1i(this.U('uEnv'), ENV_UNIT);
      gl.uniform1i(this.U('uPath'), PATH_UNIT);
      gl.uniform1fv(this.U('uStiff'), MATERIALS.map(m => m.stiff));
      gl.uniform3fv(this.U('uWeight'), MATERIALS.flatMap(m => m.weight));
      gl.uniform1fv(this.U('uGrain'), MATERIALS.map(m => m.grain));
      gl.uniform1fv(this.U('uDecay'), MATERIALS.map(m => m.decay));
      gl.uniform1f(this.U('uSpeed'), SPEED);
      this.restore(saved);
   }
   // Clay keeps its own program, vertex array and textures bound between draws.
   save() {
      const gl = this.gl;
      gl.activeTexture(gl.TEXTURE0 + ENV_UNIT);
      return { program: gl.getParameter(gl.CURRENT_PROGRAM), vao: gl.getParameter(gl.VERTEX_ARRAY_BINDING),
         vbo: gl.getParameter(gl.ARRAY_BUFFER_BINDING), tex: gl.getParameter(gl.TEXTURE_BINDING_2D),
         viewport: gl.getParameter(gl.VIEWPORT), cull: gl.isEnabled(gl.CULL_FACE), blend: gl.isEnabled(gl.BLEND),
         scissor: gl.isEnabled(gl.SCISSOR_TEST), clear: gl.getParameter(gl.COLOR_CLEAR_VALUE) };
   }
   restore(s) {
      const gl = this.gl;
      gl.bindTexture(gl.TEXTURE_2D, s.tex);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindVertexArray(s.vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, s.vbo);
      gl.useProgram(s.program);
      gl.viewport(...s.viewport);
      if (s.cull) gl.enable(gl.CULL_FACE);
      if (s.blend) gl.enable(gl.BLEND);
      if (s.scissor) gl.enable(gl.SCISSOR_TEST);
      gl.clearColor(...s.clear);
      gl.colorMask(true, true, true, true); gl.depthMask(true); gl.depthFunc(gl.LEQUAL);
   }
   setGeometry({ vertices, indices }) {
      const gl = this.gl, saved = this.save();
      gl.bindVertexArray(this.vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
      gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
      this.count = indices.length;
      this.restore(saved);
   }
   // views: [{ viewProj, eye, viewport }] in world coordinates; no viewport keeps the current one.
   // lockAlpha: leave alpha unwritable for the rest of the frame, so nothing Clay
   // draws after this can open a hole to the passthrough camera.
   // paths: each source's path field ({ data } from Paths), or null.
   draw(views, { now, field, sources, paths = [], reveal, chladni, maxSteps, lockAlpha, gap = [0, 0, 0, 1], gapDepth = 1 }) {
      const gl = this.gl, U = this.U, saved = this.save();
      gl.useProgram(this.prog);
      gl.bindVertexArray(this.vao);
      gl.bindTexture(gl.TEXTURE_2D, this.env);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, SLOTS, CHANNELS * MATERIALS.length, 0, gl.RGBA, gl.FLOAT, field.ring);
      const pack = key => { const a = new Float32Array(MAX_SRC * 4); sources.forEach((s, i) => a.set(s[key], i * 4)); return a; };
      gl.uniform1i(U('uSrcCount'), sources.length);
      for (const k of ['a', 'b', 'c', 'd']) gl.uniform4fv(U('uSrc' + k.toUpperCase()), pack(k));
      gl.uniform1fv(U('uSrcSlot'), this.slotsFor(paths));
      if (this.grid) {
         gl.uniform3fv(U('uGridMin'), this.grid.min);
         gl.uniform3fv(U('uGridN'), this.grid.n);
         gl.uniform1f(U('uCell'), this.grid.cell);
      }
      gl.uniform1f(U('uNow'), now);
      gl.uniform1f(U('uFalloff'), LOOK.falloff);
      gl.uniform1f(U('uGain'), LOOK.gain);
      gl.uniform1f(U('uAmp'), LOOK.amp);
      gl.uniform1f(U('uWave'), LOOK.wave / 100);
      // Thick enough for the stiffest material at an edge.
      gl.uniform1f(U('uShell'), .001 * LOOK.amp * Math.max(...MATERIALS.map(m => m.stiff)) * 2.5 + 1e-4);
      gl.uniform1f(U('uReveal'), reveal);
      gl.uniform1f(U('uMaxSteps'), maxSteps);
      gl.uniform2fv(U('uChladni'), chladni.mode);
      gl.uniform1f(U('uChladniAmt'), chladni.amount);
      gl.disable(gl.CULL_FACE); gl.disable(gl.BLEND); gl.enable(gl.DEPTH_TEST);
      // Opaque black first: in a headset, the cracks between the faces' shells
      // and discarded edge pixels would otherwise show the passthrough camera.
      gl.disable(gl.SCISSOR_TEST);
      gl.colorMask(true, true, true, true);
      gl.clearColor(...gap);   // test build: blue in a headset, to tell what shows in the cracks
      // Nothing left at the far plane either: the headset seems to treat far
      // depth as empty, and blends the camera in there.
      gl.clearDepth(gapDepth); gl.depthMask(true);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.clearDepth(1);
      for (const v of views) {
         if (v.viewport) gl.viewport(...v.viewport);
         gl.useProgram(this.fill);
         gl.uniform4fv(gl.getUniformLocation(this.fill, 'uColor'), gap);
         gl.uniform1f(gl.getUniformLocation(this.fill, 'uDepth'), gapDepth);
         gl.depthFunc(gl.ALWAYS); gl.depthMask(true);
         gl.drawArrays(gl.TRIANGLES, 0, 3);
         gl.useProgram(this.prog);
         gl.uniformMatrix4fv(U('uViewProj'), false, v.viewProj);
         gl.uniform3fv(U('uEye'), v.eye);
         // Depth of the shells first, then shade only the front one per pixel.
         gl.colorMask(false, false, false, false); gl.depthMask(true); gl.depthFunc(gl.LESS);
         gl.uniform1i(U('uPrepass'), 1);
         gl.drawElements(gl.TRIANGLES, this.count, gl.UNSIGNED_INT, 0);
         gl.colorMask(true, true, true, true); gl.depthMask(false); gl.depthFunc(gl.LEQUAL);
         gl.uniform1i(U('uPrepass'), 0);
         gl.drawElements(gl.TRIANGLES, this.count, gl.UNSIGNED_INT, 0);
      }
      this.restore(saved);
      if (lockAlpha) gl.colorMask(true, true, true, false);
   }
   // The grid the path fields are on: a 3D texture with room for a field per source.
   setPathGrid(grid) {
      const gl = this.gl, [nx, ny, nz] = grid.n;
      gl.activeTexture(gl.TEXTURE0 + PATH_UNIT);
      if (this.path) gl.deleteTexture(this.path);
      this.path = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_3D, this.path);
      gl.texStorage3D(gl.TEXTURE_3D, 1, gl.R8, nx, ny, nz * MAX_SRC);
      for (const p of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T, gl.TEXTURE_WRAP_R]) gl.texParameteri(gl.TEXTURE_3D, p, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.activeTexture(gl.TEXTURE0);
      this.grid = grid;
      this.owner = new Array(MAX_SRC).fill(null);
   }
   // A part of the texture for each source's field: kept while it is heard, filled when it is new.
   slotsFor(paths) {
      const out = new Float32Array(MAX_SRC).fill(-1);
      if (!this.grid) return out;
      const gl = this.gl, [nx, ny, nz] = this.grid.n, live = new Set(paths);
      paths.forEach((f, i) => {
         if (!f?.data || f.data.length !== nx * ny * nz) return;
         let s = this.owner.indexOf(f);
         if (s < 0) {
            s = this.owner.findIndex(o => !live.has(o));
            if (s < 0) return;
            this.owner[s] = f;
            gl.activeTexture(gl.TEXTURE0 + PATH_UNIT);
            gl.bindTexture(gl.TEXTURE_3D, this.path);
            gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
            gl.texSubImage3D(gl.TEXTURE_3D, 0, 0, 0, s * nz, nx, ny, nz, gl.RED, gl.UNSIGNED_BYTE, f.data);
            gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
            gl.activeTexture(gl.TEXTURE0 + ENV_UNIT);
         }
         out[i] = s;
      });
      return out;
   }
   dispose() {
      const gl = this.gl;
      if (this.path) gl.deleteTexture(this.path);
      gl.deleteProgram(this.prog); gl.deleteProgram(this.fill); gl.deleteVertexArray(this.vao);
      gl.deleteBuffer(this.vbo); gl.deleteBuffer(this.ibo); gl.deleteTexture(this.env);
   }
}
