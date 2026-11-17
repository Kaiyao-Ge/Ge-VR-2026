// A canvas on a square quad of a node, for the cards, the timeline strip and the bus window. It is not in textures.js because the scene loads
// that one (to give the textures back), and G2 is not a module that Node can load.
import { G2 } from '../../util/g2.js';
import { ownTexture, uploadNow, touchTexture } from './textures.js';
import { colourOf } from './glyphs.js';

// A canvas on a square quad of the node, in the order that works in the headset: the texture is set, noted in `owned`, painted once by
// `paint(q)` (the card's or the strip's or a blank picture, so that no frame shows an empty canvas) and uploaded at once, before the first
// frame. `px` is the canvas's size [w, h] in pixels, `size` the quad's in metres, `colour` its [r, g, b] as the face is lit. Returns
// { canvas, ctx, face, unit, touch() }; `touch` asks for the next upload after the canvas was painted again. G2 is only the owner of the
// canvas and its context: it does no drawing here.
export function canvasQuad(node, owned, { px, size, colour, paint }) {
   const canvas = new G2(true, px[0], px[1]).getCanvas();
   const face = node.add('square').scale(size[0] / 2, size[1] / 2, 1).color(colourOf(colour)).setTxtr(canvas, true);
   const unit = face._txtr;
   ownTexture(owned, unit, canvas);
   const q = { canvas, ctx: canvas.context, face, unit, touch: () => touchTexture(unit) };
   if (paint) paint(q);
   uploadNow(unit, canvas);
   return q;
}
