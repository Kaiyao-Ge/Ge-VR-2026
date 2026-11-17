// The gaze cursor of Rails in Clay: a small ring drawn where the gaze meets what it hits (the IDE's `view.gaze`, see gaze.js), so that the
// person can see where the head points. It is drawn from the view field only and decides nothing.
//
//  - Size: it always looks RETICLE.deg (0.6 degrees) across, whatever the distance, so its world size follows the distance of the point.
//    It faces the eye and sits a little in front of the surface (2 % of the distance) so that the card, the plug or the panel never cover it.
//  - Looks: a dark outline round a bright ring (readable over a bright or a busy passthrough background) and a bright centre that fills
//    with the wait: the card's 350 ms focus dwell and the bus window's 0.4 s opener are `progress`; with a plug in hand it is full (solid).
//    On a plug the whole cursor grows (the plug itself is highlighted by bus3d.js); the ring's colour says what it is on.
//  - Cost: three drawn nodes, from three small meshes made once; a frame sets three matrices and, only when the state changed, the colours.
//    Nothing is made or removed while it runs.
//
// createReticle(node) -> {update(gaze, ray), stats, dispose()}; `gaze` is the view's { point, dist, kind, progress, holding, plug } (or null to
// hide the cursor) and `ray` the smoothed gaze ray { o, d } the view carries (the cursor faces the eye along it).
import { defineTriangles, freeMesh, drawn } from './bus3d.js';
import { ringTriangles, discTriangles } from './busView.js';
import { unlit } from './glyphs.js';

// The shapes in units of the cursor's radius (the outline's outer edge is 1).
export const RETICLE = { deg: 0.6, outline: [0.5, 1.0], ring: [0.62, 0.88], core: 0.58, coreMin: 0.16, grow: 1.6 };
const FRONT = 0.02, STEP = 0.004;                // how far in front of the surface (a share of the distance), and between the three layers

const DARK = unlit([0.04, 0.04, 0.07]);
const LOOK = {                                   // the ring and the centre, by what the gaze is on
   card: unlit([0.55, 1, 0.6]), plug: unlit([0.3, 0.9, 1]), bus: unlit([1, 0.75, 0.2]), window: unlit([1, 1, 1]), desk: unlit([0.85, 0.75, 1]), none: unlit([1, 1, 1]), held: unlit([1, 0.85, 0.3]),
};
const HALF = Math.tan(RETICLE.deg * Math.PI / 180 / 2);       // the radius of the outline, as a share of the distance

let counter = 0;
export function createReticle(node) {
   const root = node.add();
   root.ignore = true;                           // until there is a gaze
   const id = counter++, names = ['Outline', 'Ring', 'Core'].map(k => `railsReticle${k}_${id}`);
   defineTriangles(names[0], ringTriangles(...RETICLE.outline));
   defineTriangles(names[1], ringTriangles(...RETICLE.ring));
   defineTriangles(names[2], discTriangles(1));
   const outline = root.add(names[0]).dull().color(DARK).opacity(0.9);
   const ring = root.add(names[1]).dull().color(LOOK.none).opacity(1);
   const core = root.add(names[2]).dull().color(LOOK.none).opacity(1);
   const parts = [outline, ring, core];
   const mats = parts.map(() => new Array(16).fill(0));        // one matrix for each, kept and written again every frame
   let look = 'none';

   // The matrix of the i-th layer: a rotation to face the eye (z along -d), scaled by `r` world metres per unit, at `p`.
   function place(i, p, d, dist, r0) {
      const off = dist * (FRONT + STEP * i), at = dist - off, r = at * HALF * r0, m = mats[i];
      let zx = -d[0], zy = -d[1], zz = -d[2];
      let xx = zz, xy = 0, xz = -zx;                                          // up (0, 1, 0) x z
      let l = Math.hypot(xx, xz);
      if (l < 1e-6) { xx = 1; xz = 0; l = 1; }                                // looking straight up or down: any side will do
      xx /= l; xz /= l;
      const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
      m[0] = xx * r; m[1] = 0; m[2] = xz * r; m[3] = 0;
      m[4] = yx * r; m[5] = yy * r; m[6] = yz * r; m[7] = 0;
      m[8] = zx * r; m[9] = zy * r; m[10] = zz * r; m[11] = 0;
      m[12] = p[0] - d[0] * off; m[13] = p[1] - d[1] * off; m[14] = p[2] - d[2] * off; m[15] = 1;
      parts[i].setMatrix(m);
   }

   return {
      update(gaze, ray) {
         const ok = !!gaze && !!ray && Array.isArray(gaze.point) && Number.isFinite(gaze.dist) && gaze.dist > 0 && gaze.point.every(Number.isFinite) && ray.d.every(Number.isFinite);
         if (root.ignore === ok) root.ignore = !ok;
         if (!ok) return;
         const kind = gaze.holding ? 'held' : gaze.kind && LOOK[gaze.kind] ? gaze.kind : 'none';
         if (kind !== look) { look = kind; ring.color(LOOK[kind]); core.color(LOOK[kind]); }
         const grow = gaze.kind === 'plug' ? RETICLE.grow : 1;
         const fill = gaze.holding ? 1 : Math.min(1, Math.max(0, Number.isFinite(gaze.progress) ? gaze.progress : 0));
         place(0, gaze.point, ray.d, gaze.dist, grow);
         place(1, gaze.point, ray.d, gaze.dist, grow);
         place(2, gaze.point, ray.d, gaze.dist, grow * (RETICLE.coreMin + (RETICLE.core - RETICLE.coreMin) * fill));
      },
      get stats() { return { drawn: root.ignore ? 0 : drawn(root), look, at: root.ignore ? null : [mats[1][12], mats[1][13], mats[1][14]] }; },      // (for the tests: where the ring is)
      dispose() {
         for (const n of names) freeMesh(n);
         node.remove(root);
      },
   };
}
