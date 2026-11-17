// The IDE of Rails, in the headset: five code cards on a cylinder around the seated head, the stage mat on the desk, and
// the state machine behind them (ideCore.js, which is tested in Node and decides everything that is not Clay). This file
// is only the Clay side: it makes a node and a canvas for each of the five card slots at the start, and one for the timeline
// strip and one for the bus window (seven textures in all, the most the scene may have, all in `owned` for the scene to give
// back), puts the nodes where the workspace says, and each frame hands the head and the hands to the core and what the core
// returns to the cards, the timeline, the bus window (busWindowView.js: opaque, under the gaze, hidden while closed), the stage and
// the bus (bus3d.js: the band under the cards, a plug with its drop line and dot for each card, and the pulses; no texture, no text) and
// the gaze cursor (reticle.js: a ring where the smoothed gaze meets what it hits, three drawn nodes, drawn from the view's `gaze`).
// The cards that publish or take the variable selected in the bus window get a bright frame (cardView.js).
//
// createIde({model, link, owned}) -> {frame(head, hands), setActive(bool), recentre(desk), dispose(), debug, test}. `link` is the routed
// facade of rails.js (the loopback in role `both`, the real Link otherwise; it has no `tick`). `debug` feeds the log line
// (focus, cards, rails: no text). `test` is for the browser test: it does carry text, and is not read by anything else; it is
// the core's inspector with `bus`, the counts of what the bus has in nodes (drawn, plugged and unplugged cards, the plug in hand, the
// plug highlighted, the pulses), `reticle` (the cursor's drawn nodes and look), `stageShapes`, the shapes in use, and `view`, the last view the core made.
// The contract with the scene: its events are in, snap, ack, release and pair; `pair` resets the IDE's
// baselines and a full snapshot is expected; an inactive IDE (the page is the runtime) ignores them and sends nothing.
import { createIdeCore } from './ideCore.js';
import { createCard } from './cards.js';
import { createStage } from './stage.js';
import { createBus } from './bus3d.js';
import { createReticle } from './reticle.js';
import { createTimeline } from './timelineView.js';
import { createBusWindowView } from './busWindowView.js';
import { highlightOf } from './busWindowDraw.js';
import { TIMELINE } from './timeline.js';
import { SLOTS, CARD_DROP, frameMatrix } from './layout.js';
import { rad } from './geom.js';

export function createIde({ model, link, owned }) {
   const core = createIdeCore({ link, now: () => performance.now(), platform: globalThis.navigator?.platform || '' });
   const root = model.add();
   root.ignore = true;                                    // until the scene says this page is the IDE
   const nodes = SLOTS.map(() => root.add());
   nodes.forEach(n => { n.ignore = true; });
   // Every canvas is made and uploaded now, before the first frame; an empty slot is just hidden.
   const cards = nodes.map(node => createCard(node, { owned }));
   const timelineNode = root.add(), busWindowNode = root.add();
   timelineNode.ignore = true;                            // until there is a workspace
   const timeline = createTimeline(timelineNode, { owned }), busWindow = createBusWindowView(busWindowNode, { owned });
   const stage = createStage(root);
   const bus = createBus(root);
   const reticle = createReticle(root);
   let placed = null, lastView = null;
   const clock = () => performance.now() / 1000;
   // The core's inspector, and on top of it what the rails have in nodes (an object that inherits the getters of the inspector).
   const test = Object.create(core.inspect, { bus: { get: () => bus.stats },
      timeline: { get: () => ({ ...timeline.stats, owned: owned.length }) }, busWindow: { get: () => busWindow.stats },
      stageShapes: { get: () => stage.stats }, reticle: { get: () => reticle.stats },
      view: { get: () => lastView } });

   return {
      frame(head, hands) {
         const view = core.frame({ head, hands });
         if (!view) return;
         lastView = view;
         if (view.ws !== placed) {
            placed = view.ws;
            if (placed) { nodes.forEach((n, i) => n.setMatrix(frameMatrix(placed, rad(SLOTS[i]), -CARD_DROP))); timelineNode.setMatrix(frameMatrix(placed, 0, TIMELINE.y)); }
            timelineNode.ignore = !placed;
         }
         const marked = highlightOf(view.bus);
         view.slots.forEach((slot, i) => {
            nodes[i].ignore = !slot || !placed;
            if (slot && placed) cards[i].update(slot.state, marked.has(slot.id));
         });
         stage.update(view.stage, view.draws, view.paused);
         // The timeline strip above the cards (the playhead is a quad over its canvas), and the bus window under the gaze.
         if (placed) timeline.update(view);
         busWindow.update(view.bus, placed, clock());
         bus.update(view.ws, view, clock());
         reticle.update(view.gaze, view.ray);
      },
      setActive(on) {
         core.setActive(on);
         root.ignore = !on;
      },
      // A new workspace from the next head (as Mod+Home); the scene asks it when the page enters XR, with the desk back at its default.
      recentre: desk => core.recentre(desk),
      // For the scene's exit: the nodes and the line-font meshes of every part (the textures are the scene's, in `owned`).
      dispose() {
         cards.forEach(c => c.dispose());
         timeline.dispose(); busWindow.dispose(); stage.dispose(); bus.dispose(); reticle.dispose();
         root.ignore = true; model.remove(root);
      },
      debug: core.debug,
      test,
   };
}
