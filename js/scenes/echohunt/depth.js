// The headset's depth, read back to the page. Quest gives it as a depth
// texture (an array, a layer per eye) that cannot be read directly: a small
// pass fetches every 4th texel, a different one of the 16 each frame, turns it
// into metres along the view axis and packs them into bytes; the bytes come
// back a frame or two later through a pixel buffer, so the GPU never waits.
import * as cg from '../../render/core/cg.js';

const N = 80;   // samples a side

const VERT = `#version 300 es
void main() { gl_Position = vec4(vec2(gl_VertexID & 1, gl_VertexID >> 1) * 4. - 1., 0., 1.); }`;
const FRAG = `#version 300 es
precision highp float;
uniform highp sampler2DArray uDepth;
uniform int uLayer;
uniform ivec2 uOffset, uSize;
uniform mat4 uInvProj;
out vec4 fragColor;
void main() {
   ivec2 t = ivec2(gl_FragCoord.xy) * 4 + uOffset;
   float d = texelFetch(uDepth, ivec3(t, uLayer), 0).r;
   vec2 ndc = (vec2(t) + .5) / vec2(uSize) * 2. - 1.;   // row 0 is the bottom of the view
   vec4 v = uInvProj * vec4(ndc, d * 2. - 1., 1.);
   float mm = d > 0. && d < 1. ? clamp(-v.z / v.w * 1000., 0., 65535.) : 0.;
   float hi = floor(mm / 256.);
   fragColor = vec4(hi / 255., (mm - hi * 256.) / 255., 0., 1.);
}`;

export class DepthReader {
   constructor(gl, session) {
      this.gl = gl;
      this.binding = new XRWebGLBinding(session, gl);
      this.frame = 0;
      this.pending = [];   // { pbo, fence, pose, invProj, offset, size }
      this.free = [];
      const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
         if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
      this.program = gl.createProgram();
      gl.attachShader(this.program, sh(gl.VERTEX_SHADER, VERT));
      gl.attachShader(this.program, sh(gl.FRAGMENT_SHADER, FRAG));
      gl.linkProgram(this.program);
      if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(this.program));
      this.vao = gl.createVertexArray();
      this.target = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.target);
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, N, N);
      this.fb = gl.createFramebuffer();
      const old = gl.getParameter(gl.FRAMEBUFFER_BINDING);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.target, 0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, old);
      this.U = name => gl.getUniformLocation(this.program, name);
   }

   // Start a read of this frame's depth for a view. False if there is none.
   capture(view) {
      const gl = this.gl, d = this.binding.getDepthInformation(view);
      if (!d?.texture || this.pending.length > 3) return false;
      const o = this.frame++ % 16, offset = [o % 4, o >> 2];
      const s = {
         fb: gl.getParameter(gl.FRAMEBUFFER_BINDING), viewport: gl.getParameter(gl.VIEWPORT), program: gl.getParameter(gl.CURRENT_PROGRAM),
         vao: gl.getParameter(gl.VERTEX_ARRAY_BINDING), unit: gl.getParameter(gl.ACTIVE_TEXTURE), pack: gl.getParameter(gl.PIXEL_PACK_BUFFER_BINDING),
         depth: gl.isEnabled(gl.DEPTH_TEST), blend: gl.isEnabled(gl.BLEND), scissor: gl.isEnabled(gl.SCISSOR_TEST), mask: gl.getParameter(gl.COLOR_WRITEMASK),
      };
      gl.activeTexture(gl.TEXTURE0);
      const arr = gl.getParameter(gl.TEXTURE_BINDING_2D_ARRAY);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fb);
      gl.viewport(0, 0, N, N);
      gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND); gl.disable(gl.SCISSOR_TEST); gl.colorMask(true, true, true, true);
      gl.useProgram(this.program);
      gl.bindVertexArray(this.vao);
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, d.texture);
      gl.uniform1i(this.U('uDepth'), 0);
      gl.uniform1i(this.U('uLayer'), d.imageIndex ?? 0);
      gl.uniform2i(this.U('uOffset'), ...offset);
      gl.uniform2i(this.U('uSize'), d.width, d.height);
      const invProj = cg.mInverse(Array.from(d.projectionMatrix));
      gl.uniformMatrix4fv(this.U('uInvProj'), false, invProj);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      const pbo = this.free.pop() || gl.createBuffer();
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo);
      gl.bufferData(gl.PIXEL_PACK_BUFFER, N * N * 4, gl.STREAM_READ);
      gl.readPixels(0, 0, N, N, gl.RGBA, gl.UNSIGNED_BYTE, 0);
      this.pending.push({ pbo, fence: gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0), pose: Array.from(d.transform.matrix), invProj, offset, size: [d.width, d.height] });
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, s.pack);
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, arr);
      gl.activeTexture(s.unit);
      gl.bindVertexArray(s.vao);
      gl.useProgram(s.program);
      gl.bindFramebuffer(gl.FRAMEBUFFER, s.fb);
      gl.viewport(...s.viewport);
      if (s.depth) gl.enable(gl.DEPTH_TEST); if (s.blend) gl.enable(gl.BLEND); if (s.scissor) gl.enable(gl.SCISSOR_TEST);
      gl.colorMask(...s.mask);
      return true;
   }

   // The reads that are done: [{ points (x, y, z in the reference space, metres), origin }].
   poll() {
      const gl = this.gl, out = [], bytes = new Uint8Array(N * N * 4);
      while (this.pending.length) {
         const r = this.pending[0], st = gl.clientWaitSync(r.fence, 0, 0);
         if (st === gl.TIMEOUT_EXPIRED) break;
         this.pending.shift();
         gl.deleteSync(r.fence);
         const old = gl.getParameter(gl.PIXEL_PACK_BUFFER_BINDING);
         gl.bindBuffer(gl.PIXEL_PACK_BUFFER, r.pbo);
         gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, bytes);
         gl.bindBuffer(gl.PIXEL_PACK_BUFFER, old);
         this.free.push(r.pbo);
         out.push(unproject(bytes, r));
      }
      return out;
   }

   dispose() {
      const gl = this.gl;
      for (const r of this.pending) { gl.deleteSync(r.fence); gl.deleteBuffer(r.pbo); }
      this.free.forEach(b => gl.deleteBuffer(b));
      gl.deleteProgram(this.program); gl.deleteVertexArray(this.vao); gl.deleteTexture(this.target); gl.deleteFramebuffer(this.fb);
   }
}

// Bytes of view depths to points: each texel's ray through the inverse projection, as far as its depth.
export function unproject(bytes, { pose, invProj, offset, size }) {
   const pts = [], M = pose;
   for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const k = 4 * (j * N + i), mm = bytes[k] * 256 + bytes[k + 1];
      if (!mm) continue;
      const tx = i * 4 + offset[0], ty = j * 4 + offset[1];
      const x = (tx + .5) / size[0] * 2 - 1, y = (ty + .5) / size[1] * 2 - 1;
      // A point on the ray (on the near plane), then scaled to the depth.
      const q = mul(invProj, [x, y, -1, 1]), s = (mm / 1000) / -(q[2] / q[3]);
      const v = [q[0] / q[3] * s, q[1] / q[3] * s, q[2] / q[3] * s];
      pts.push(M[0] * v[0] + M[4] * v[1] + M[8] * v[2] + M[12], M[1] * v[0] + M[5] * v[1] + M[9] * v[2] + M[13], M[2] * v[0] + M[6] * v[1] + M[10] * v[2] + M[14]);
   }
   return { points: pts, origin: [M[12], M[13], M[14]] };
}

const mul = (m, v) => [0, 1, 2, 3].map(r => m[r] * v[0] + m[4 + r] * v[1] + m[8 + r] * v[2] + m[12 + r] * v[3]);
