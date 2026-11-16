// The six symbols that mark the rooms of Doorways, drawn with G2 in simple flat
// shapes, and the textures the rugs get from them. Each symbol is drawn once, on a
// static canvas, and every rug that shows it shares that one texture unit.
import { G2 } from '../../util/g2.js';

const RUG = '#7a5238', BORDER = '#e8d9a8', SIZE = 256;   // the rug's colour, its border, the canvas's width in pixels

// Points on a circle of radius r about (cx, cy), from angle a0 to a1.
const arc = (cx, cy, r, a0, a1, n = 16) => Array.from({ length: n + 1 }, (_, i) => {
   const a = a0 + (a1 - a0) * i / n;
   return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
});

// A crescent opening to the right: a circle with a smaller one bitten out of it.
// Both circles meet at angles t0 (on the big one) and t1 (on the small one).
const crescent = (x, y, s) => {
   const R = 1, r = .8, d = .45, px = (R * R - r * r + d * d) / (2 * d), py = Math.sqrt(R * R - px * px);
   const t0 = Math.atan2(py, px), t1 = Math.atan2(py, px - d);
   return [...arc(0, 0, R, t0, 2 * Math.PI - t0, 24), ...arc(d, 0, r, 2 * Math.PI - t1, t1, 24)].map(([u, v]) => [x + u * s, y + v * s]);
};

const star = (x, y, s) => Array.from({ length: 10 }, (_, i) => {
   const a = Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? .42 : 1;
   return [x + r * s * Math.cos(a), y + r * s * Math.sin(a)];
});

const triangle = (x, y, w, h) => [[x - w, y], [x + w, y], [x, y + h]];

const DRAW = {
   moon: (g, x, y, s) => g.setColor('#f2e7b0').fillPath(crescent(x, y, s)),
   star: (g, x, y, s) => g.setColor('#ffd23f').fillPath(star(x, y, s)),
   sun: (g, x, y, s) => {
      g.setColor('#ff9d1c').lineWidth(.04 * s);
      for (let i = 0; i < 8; i++) {
         const a = i * Math.PI / 4;
         g.line([x + .65 * s * Math.cos(a), y + .65 * s * Math.sin(a)], [x + s * Math.cos(a), y + s * Math.sin(a)]);
      }
      g.setColor('#ffcf33').fillOval(x - .5 * s, y - .5 * s, s, s);
   },
   tree: (g, x, y, s) => {
      g.setColor('#6b4423').fillRect(x - .12 * s, y - s, .24 * s, .6 * s);
      g.setColor('#2f9e44').fillPath(triangle(x, y - .55 * s, .65 * s, .9 * s)).fillPath(triangle(x, y - .05 * s, .5 * s, .9 * s));
   },
   fish: (g, x, y, s) => {
      g.setColor('#38b6e8').fillOval(x - .85 * s, y - .45 * s, 1.5 * s, .9 * s);
      g.fillPath([[x + .5 * s, y], [x + s, y + .45 * s], [x + s, y - .45 * s]]);
      g.setColor('#10222e').fillOval(x - .55 * s, y + .05 * s, .16 * s, .16 * s);
   },
   mountain: (g, x, y, s) => {
      g.setColor('#8d99a6').fillPath(triangle(x - .35 * s, y - .6 * s, .75 * s, 1.4 * s)).fillPath(triangle(x + .5 * s, y - .6 * s, .55 * s, .95 * s));
      g.setColor('#f4f7fa').fillPath([[x - .35 * s - .107 * s, y + .6 * s], [x - .35 * s + .107 * s, y + .6 * s], [x - .35 * s, y + .8 * s]]);
   },
};

// Note the GL texture that setTxtr has just bound to the channel, in owned (if there is one), for the caller to delete later.
// Call it right after setTxtr, while that texture is still the one bound.
export function ownTexture(owned, channel, canvas) {
   const gl = owned && globalThis.window?.clay?.gl;
   if (!gl) return;
   gl.activeTexture(gl.TEXTURE0 + channel);
   owned.push({ channel, texture: gl.getParameter(gl.TEXTURE_BINDING_2D), canvas });
}

// The symbol name, drawn in the square of half width size centred on (x, y), in G2's [-1, 1] units.
export function drawSymbol(g2, name, x, y, size) {
   DRAW[name](g2, x, y, size);
   return g2;
}

// Put the canvas's pixels into the texture that setTxtr has just bound on the unit now, instead of at the first draw of a node
// that uses it (Clay uploads a canvas texture in drawMesh, while its counter is above 0), and set the counter to 0 so that the
// first draw does not upload again. Without a GL context (Node) there is nothing to upload to.
const uploadNow = (unit, canvas) => {
   const gl = globalThis.window?.clay?.gl, entry = globalThis.window?._canvas_txtr?.[unit];
   if (!gl || !entry) return;
   const was = gl.getParameter(gl.ACTIVE_TEXTURE);
   gl.activeTexture(gl.TEXTURE0 + unit);
   gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
   gl.activeTexture(was);
   entry.counter = 0;
};

// Give node the rug texture of the symbol. cache, a Map the caller owns, remembers
// each symbol's texture unit: the first use paints a static canvas, uploads it and makes its texture, the rest share it.
// owned, an array the caller owns, gets { channel, texture, canvas } of each new texture so that the
// caller can release it (see ownTexture).
export function symbolTexture(node, name, cache, owned) {
   if (cache.has(name)) return node.txtr(cache.get(name));
   const g2 = new G2(true, SIZE, SIZE);
   g2.render = function () {
      this.setColor(RUG).fillRect(-1, -1, 2, 2);
      this.setColor(BORDER).lineWidth(.03).drawRect(-.9, -.9, 1.8, 1.8);
      drawSymbol(this, name, 0, 0, .55);
   };
   g2.update();   // paints the one time; the canvas is a still picture from here on
   node.setTxtr(g2.getCanvas(), true);
   ownTexture(owned, node._txtr, g2.getCanvas());
   uploadNow(node._txtr, g2.getCanvas());
   cache.set(name, node._txtr);
   return node;
}
