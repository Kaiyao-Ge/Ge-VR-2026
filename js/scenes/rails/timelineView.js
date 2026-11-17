// The timeline strip of Rails in Clay: one 2048 x 82 canvas on a quad of 1.5 m by 0.03 m (0.06 m while paused), and the playhead
// as two small quads on top of it, so that scrubbing moves a quad and repaints nothing. The picture (timeline.js) is painted again
// only when what it shows changes, and at most 10 times a second, by setting the texture's counter for one upload (as the cards do,
// cards.js). The canvas is made, painted and uploaded here, at creation and before the first frame, and its texture goes into
// `owned`, for the scene to release in deinit. The canvas is opaque all over and sits on a dark plate a little larger than itself
// (one more quad), so that the bright room seen through the headset shows through nowhere.
import { TIMELINE, STRIP, drawTimeline, StripPaint, fractionOf, xOfFraction } from './timeline.js';
import { canvasQuad } from './canvasQuad.js';
import { colourOf, quadAt, PLATE } from './glyphs.js';

const PLATE_PAD = 0.006;                // the plate reaches this far past the strip all round (metres)
const PLAYHEAD = { live: '#ffffff', paused: '#ffb000' };

// node: where the strip hangs (its frame: x right, y up, facing +z; the caller puts it 0.40 m above the eye).
// Returns { update(state, t), dispose(), stats }: state is { window, playhead, paused, playing, density }, t in seconds
// (the clock for the repaint rate; any increasing number).
export function createTimeline(node, { owned, now = () => performance.now() / 1000 }) {
   const { ctx, face, touch } = canvasQuad(node, owned, { px: [STRIP.w, STRIP.h], size: [TIMELINE.w, TIMELINE.h], colour: [1, 1, 1],
      paint: q => drawTimeline(q.ctx, { window: [0, 0], density: [], paused: false }) });          // a blank strip is in the canvas before the first frame
   const quad = colour => node.add('square').color(colourOf(colour)).opacity(1);
   const bar = quad(PLAYHEAD.live), head = quad(PLAYHEAD.live);
   const plate = node.add('square').color(colourOf(PLATE)).opacity(1);
   const platePlace = h => quadAt(plate, 0, 0, TIMELINE.w / 2 + PLATE_PAD, h / 2 + PLATE_PAD, -0.001);
   platePlace(TIMELINE.h);
   const paint = new StripPaint();
   const stats = { painted: 0, moved: 0 };
   let height = TIMELINE.h, atX = null, atH = null, atPaused = null;

   return {
      update(state, t = now()) {
         const s = state || {};
         if (paint.changed(s, t)) {
            ctx.clearRect(0, 0, STRIP.w, STRIP.h);
            drawTimeline(ctx, s);
            touch();
            stats.painted++;
         }
         const paused = !!s.paused, h = paused ? TIMELINE.hPaused : TIMELINE.h;
         if (h !== height) { height = h; face.identity().scale(TIMELINE.w / 2, h / 2, 1); platePlace(h); }
         const x = xOfFraction(fractionOf(paused ? s.playhead : null, s.window));
         if (x !== atX || h !== atH || paused !== atPaused) {
            atX = x; atH = h; atPaused = paused; stats.moved++;
            quadAt(bar, x, 0, 0.0025, h / 2 + 0.004, 0.002);
            quadAt(head, x, h / 2 + 0.01, 0.007, 0.007, 0.002);
            const colour = colourOf(paused ? PLAYHEAD.paused : PLAYHEAD.live);
            bar.color(colour); head.color(colour);
         }
      },
      get stats() { return stats; },
      dispose() { [face, bar, head, plate].forEach(n => node.remove(n)); },
   };
}
