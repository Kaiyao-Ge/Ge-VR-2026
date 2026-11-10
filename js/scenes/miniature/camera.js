// A camera whose picture shows on a screen in the scene: the wrist panel's
// live view through the avatar's eyes. Clay draws every node into it too, as
// an offscreen view (see drawMesh in clay.js): a node marked view('main') is
// left out of it, one marked view('offscreen') goes only into it.
// There are two pictures: the screen shows one while the other is drawn, for
// WebGL refuses to draw into a texture that the program might be reading.
import * as cg from '../../render/core/cg.js';

const NEAR = .004, FAR = 40, FOV = Math.PI / 3;   // metres in the camera's frame, and the height it sees

export class Camera {
   constructor(gl, width = 512, height = 384) {
      Object.assign(this, { gl, width, height });
      const unit = gl.getParameter(gl.ACTIVE_TEXTURE), fb = gl.getParameter(gl.FRAMEBUFFER_BINDING);
      gl.activeTexture(gl.TEXTURE0);
      const bound = gl.getParameter(gl.TEXTURE_BINDING_2D);
      this.depth = gl.createRenderbuffer();
      gl.bindRenderbuffer(gl.RENDERBUFFER, this.depth);
      gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, width, height);
      this.pictures = [0, 1].map(() => {
         const texture = gl.createTexture(), framebuffer = gl.createFramebuffer();
         gl.bindTexture(gl.TEXTURE_2D, texture);
         gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, width, height);
         gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
         gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
         gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
         gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
         gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
         gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this.depth);
         return { texture, framebuffer };
      });
      gl.bindTexture(gl.TEXTURE_2D, bound);
      gl.activeTexture(unit);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      this.drawing = 0;   // the picture being drawn; the screen shows the other
      // Upside down, as Clay's screens show a canvas's top row at the top and a framebuffer's first row is its bottom:
      // the picture is turned over in the projection, and the triangles' front faces with it.
      const f = 1 / Math.tan(FOV / 2), a = width / height;
      this.projection = [f / a, 0, 0, 0, 0, -f, 0, 0, 0, 0, (FAR + NEAR) / (NEAR - FAR), -1, 0, 0, 2 * FAR * NEAR / (NEAR - FAR), 0];
   }

   // Show the picture on node (a Clay node with a 'square'): Clay gives it a texture unit, and the picture is bound there.
   show(node) {
      const gl = this.gl, blank = document.createElement('canvas');
      blank.width = blank.height = 1;
      node.setTxtr(blank, true);
      this.unit = node._txtr;
      if (window._canvas_txtr[this.unit]) window._canvas_txtr[this.unit].counter = 0;   // never upload the blank over the picture
      this.bind(this.pictures[1].texture);
      return node;
   }
   bind(texture) {
      const gl = this.gl, active = gl.getParameter(gl.ACTIVE_TEXTURE);
      gl.activeTexture(gl.TEXTURE0 + this.unit);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.activeTexture(active);
   }

   // This frame's view from the camera, a matrix in the global frame (no scale needed), for Clay and
   // for scandraw: the picture is cleared to sky and Clay draws into it. off() stops it.
   on(matrix) {
      const gl = this.gl, fb = gl.getParameter(gl.FRAMEBUFFER_BINDING), viewport = gl.getParameter(gl.VIEWPORT), clear = gl.getParameter(gl.COLOR_CLEAR_VALUE);
      // The screen shows what was drawn last; the other picture is drawn now.
      if (this.drawn) { this.bind(this.pictures[this.drawing].texture); this.drawing ^= 1; this.drawn = false; }
      const { framebuffer } = this.pictures[this.drawing];
      this.drawn = true;
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      gl.viewport(0, 0, this.width, this.height);
      gl.clearColor(.62, .7, .8, 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.clearColor(...clear);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.viewport(...viewport);
      const view = { framebuffer, width: this.width, height: this.height, frontFace: gl.CW,
         projectionMatrix: this.projection, viewMatrix: cg.mInverse(matrix), back: { framebuffer: fb, viewport } };
      window.clay.offscreenViews = [view];
      return view;
   }
   off() { if (window.clay) window.clay.offscreenViews = []; }

   dispose() {
      const gl = this.gl;
      this.off();
      for (const p of this.pictures) { gl.deleteFramebuffer(p.framebuffer); gl.deleteTexture(p.texture); }
      gl.deleteRenderbuffer(this.depth);
   }
}
