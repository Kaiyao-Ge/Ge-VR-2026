// Draws the scanned room with a program and a buffer of its own, before Clay
// draws the rest into the same frame (as echohunt/render.js does its room).
// Clay keeps one vertex buffer and uploads a mesh to it again whenever the mesh
// drawn differs from the one before: a scanned room drawn among the table and
// the house would go up to the GPU every frame, megabytes of it. Here it goes
// up once, in 20 bytes a vertex (see compact in scanned.js), and is shaded as
// Clay shades a white, dull surface: the two default directional lights, a
// colour a vertex, and the same square root.
import * as cg from '../../render/core/cg.js';
import { compact } from './scanned.js';

const VERT = `#version 300 es
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aNor;
layout(location = 2) in vec3 aRGB;
uniform mat4 uViewProj;   // projection * view * model
uniform mat4 uModel;
out vec3 vNor, vRGB;
void main() {
   vNor = mat3(uModel) * aNor;
   vRGB = aRGB;
   gl_Position = uViewProj * vec4(aPos, 1.);
}`;
const FRAG = `#version 300 es
precision highp float;
uniform float uOpacity;
in vec3 vNor, vRGB;
out vec4 fragColor;
void main() {
   // Clay's lights are a pair facing each other, so the one that faces a surface lights it.
   float light = .2 + .8 * abs(dot(normalize(vNor), vec3(.57735)));
   fragColor = vec4(sqrt(light * vRGB) * uOpacity, uOpacity);
}`;

export class ScanDraw {
   constructor(gl) {
      this.gl = gl;
      const shader = (type, src) => {
         const s = gl.createShader(type);
         gl.shaderSource(s, src); gl.compileShader(s);
         if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
         return s;
      };
      const p = this.program = gl.createProgram();
      gl.attachShader(p, shader(gl.VERTEX_SHADER, VERT));
      gl.attachShader(p, shader(gl.FRAGMENT_SHADER, FRAG));
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
      this.U = Object.fromEntries(['uViewProj', 'uModel', 'uOpacity'].map(n => [n, gl.getUniformLocation(p, n)]));
      this.vao = gl.createVertexArray();
      this.vbo = gl.createBuffer();
      this.source = null;   // the triangles the buffer holds
      this.count = 0;
      const saved = this.save();
      gl.bindVertexArray(this.vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 20, 0);
      gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.BYTE, true, 20, 12);
      gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 3, gl.UNSIGNED_BYTE, true, 20, 16);
      this.restore(saved);
   }
   // Clay keeps its own program, vertex array and buffer bound between draws.
   save() {
      const gl = this.gl;
      return { program: gl.getParameter(gl.CURRENT_PROGRAM), vao: gl.getParameter(gl.VERTEX_ARRAY_BINDING),
         vbo: gl.getParameter(gl.ARRAY_BUFFER_BINDING), viewport: gl.getParameter(gl.VIEWPORT), fb: gl.getParameter(gl.FRAMEBUFFER_BINDING) };
   }
   restore(s) {
      const gl = this.gl;
      gl.bindVertexArray(s.vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, s.vbo);
      gl.useProgram(s.program);
      gl.bindFramebuffer(gl.FRAMEBUFFER, s.fb);
      gl.frontFace(gl.CCW);
      gl.viewport(...s.viewport);
   }
   // views: Clay's, or an offscreen one (camera.js); model: the scan's matrix in the world (global, with the root's); triangles: as roomMesh makes them, or null.
   draw(views, model, triangles, opacity) {
      const gl = this.gl;
      if (!triangles || opacity < .01) return;
      const saved = this.save();
      gl.bindVertexArray(this.vao);
      if (triangles !== this.source) {
         gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
         gl.bufferData(gl.ARRAY_BUFFER, compact(triangles), gl.STATIC_DRAW);
         this.source = triangles;
         this.count = triangles.length / 16;
      }
      gl.useProgram(this.program);
      gl.uniformMatrix4fv(this.U.uModel, false, model);
      gl.uniform1f(this.U.uOpacity, opacity);
      for (const v of views) {
         if (v.framebuffer) {
            gl.bindFramebuffer(gl.FRAMEBUFFER, v.framebuffer);
            gl.viewport(0, 0, v.width, v.height);
            gl.frontFace(v.frontFace || gl.CCW);
         }
         else if (views.length > 1) gl.viewport(v.viewport.x, v.viewport.y, v.viewport.width, v.viewport.height);
         gl.uniformMatrix4fv(this.U.uViewProj, false, cg.mMultiply(v.projectionMatrix, cg.mMultiply(v.viewMatrix, model)));
         gl.drawArrays(gl.TRIANGLES, 0, this.count);
      }
      this.restore(saved);
   }
   dispose() {
      const gl = this.gl;
      gl.deleteProgram(this.program); gl.deleteVertexArray(this.vao); gl.deleteBuffer(this.vbo);
   }
}
