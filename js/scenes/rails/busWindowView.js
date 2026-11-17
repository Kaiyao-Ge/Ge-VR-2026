// The bus window of Rails in Clay: one 1024 x 640 canvas on a quad of 0.90 x 0.56 m (the panel of busWindow.js), 1.0 m from the head,
// at the yaw the window was opened at. It is the seventh canvas of the scene (five cards, the timeline strip and this): made, painted and uploaded at creation, before the first
// frame, and its texture goes into `owned`, for the scene to release in deinit. The picture (busWindowDraw.js) is painted again only
// when the view's `bus` object changed, at most 4 times a second live (a change of the person's making at once); while the window is
// closed the quad is hidden and nothing is touched. The canvas is opaque all over, so the room shows through nowhere.
import { busWindowFrame } from './layout.js';
import { WIN } from './busWindow.js';
import { BusPaint, drawBusWindow } from './busWindowDraw.js';
import { canvasQuad } from './canvasQuad.js';

// node: where the window hangs (this places it, from the workspace and the bus's frameYaw).
// Returns { update(bus, ws, t), dispose(), stats }: `bus` is the view's `bus` (closed: { open: false }), `ws` the workspace, t in seconds.
export function createBusWindowView(node, { owned, now = () => performance.now() / 1000 }) {
   const { ctx, face, touch } = canvasQuad(node, owned, { px: WIN.px, size: [WIN.w, WIN.h], colour: [1, 1, 1],
      paint: q => drawBusWindow(q.ctx, null) });                           // an empty window is in the canvas before the first frame
   face.ignore = true;
   const paint = new BusPaint();
   const stats = { painted: 0, shown: false };
   let atWs = null, atYaw = null;

   return {
      update(bus, ws, t = now()) {
         if (!bus || !bus.open || !ws) {
            if (stats.shown) { stats.shown = false; face.ignore = true; }
            paint.reset();
            return;
         }
         if (ws !== atWs || bus.frameYaw !== atYaw) { atWs = ws; atYaw = bus.frameYaw; node.setMatrix(busWindowFrame(ws, Number.isFinite(atYaw) ? atYaw : 0)); }
         if (paint.changed(bus, t)) { drawBusWindow(ctx, bus); touch(); stats.painted++; }
         if (!stats.shown) { stats.shown = true; face.ignore = false; }
      },
      get stats() { return stats; },
      dispose() { node.remove(face); },
   };
}
