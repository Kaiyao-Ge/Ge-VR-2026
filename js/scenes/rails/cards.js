// A code card of Rails in Clay: one 640 px canvas texture on a square of 0.50 m, with the quads that sit on it (cardView.js)
// and the picture of the card (cardDraw.js, which draws with a plain 2D context). The canvas is made, painted and
// uploaded to the GPU here, at creation and before the first frame (the HW8 headset showed textures missing when they
// were uploaded at the first draw); it is painted again only when what it shows changes, by setting the texture's counter
// for one upload (the trick of doorways/panel.js). Its texture goes into `owned`, for the scene to release in deinit.
import { CARD } from './layout.js';
import { canvasQuad } from './canvasQuad.js';
import { createCardView, BRIGHT } from './cardView.js';

export { drawCard } from './cardDraw.js';

// node: where the card hangs (a Clay node whose frame is the card's: x right, y up, facing +z).
// owned: the list for the textures this creates (see textures.js). Returns { update(state), dispose(), draws }, where
// state is { name, ver, buffer, status, error, editError, bindings, unplugged, queued, zoom, scrollX, focused, charging, pending,
// echo, notice, command } (hovered and time are also read; see cardView.update).
export function createCard(node, { owned }) {
   let view;
   canvasQuad(node, owned, { px: [CARD.px, CARD.px], size: [CARD.w, CARD.h], colour: [BRIGHT.idle, BRIGHT.idle, BRIGHT.idle],
      paint: q => { view = createCardView(node, { ctx: q.ctx, face: q.face, onDraw: q.touch }); } });
   return view;
}
