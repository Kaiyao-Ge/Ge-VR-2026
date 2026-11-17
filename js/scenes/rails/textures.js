// The canvas textures of Rails (the five cards, the timeline and the bus window), made so that they are in the
// GPU before the first frame and can be given back when the scene is left. Copied from doorways/symbols.js (ownTexture,
// uploadNow) instead of imported, so that this scene does not depend on another one. Nothing here reads a clock.
// There are at most 7 canvases in the scene: Clay has 14 texture channels and the rest is line font.

// Note the GL texture that setTxtr has just bound to the channel, in owned (if there is one), for the caller to delete
// later. Call it right after setTxtr, while that texture is still the one bound. Without a GL context (Node) it does nothing.
export function ownTexture(owned, channel, canvas) {
   const gl = owned && globalThis.window?.clay?.gl;
   if (!gl) return;
   gl.activeTexture(gl.TEXTURE0 + channel);
   owned.push({ channel, texture: gl.getParameter(gl.TEXTURE_BINDING_2D), canvas });
}

// Give back what ownTexture noted: each texture channel and GL texture. A channel that another scene has taken since is not ours
// to free. Empties `owned`.
export function releaseTextures(owned) {
   const w = globalThis.window;
   for (const t of owned) {
      if (w?._canvas_txtr?.[t.channel]?.src === t.canvas) {
         delete w._canvas_txtr[t.channel];
         w.txtrChannel = (w.txtrChannel || []).filter(c => c !== t.channel);
      }
      w?.clay?.gl?.deleteTexture(t.texture);
   }
   owned.length = 0;
}

// Put the canvas's pixels into the texture that setTxtr has just bound on the unit now, instead of at the first draw of a
// node that uses it (Clay uploads a canvas texture in drawMesh, while its counter is above 0; the HW8 headset showed
// textures missing when they were uploaded lazily), and set the counter to 0 so that the first draw does not upload again.
// Without a GL context there is nothing to upload to.
export function uploadNow(unit, canvas) {
   const gl = globalThis.window?.clay?.gl, entry = globalThis.window?._canvas_txtr?.[unit];
   if (!gl || !entry) return;
   const was = gl.getParameter(gl.ACTIVE_TEXTURE);
   gl.activeTexture(gl.TEXTURE0 + unit);
   gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
   gl.activeTexture(was);
   entry.counter = 0;
}

// Ask Clay to upload the canvas of this channel once more, at its next draw (after the canvas was painted again).
export function touchTexture(unit) {
   const entry = globalThis.window?._canvas_txtr?.[unit];
   if (entry) entry.counter = 1;
}
