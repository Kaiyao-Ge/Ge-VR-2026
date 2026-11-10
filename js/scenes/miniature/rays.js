// Rays against the object: what a ray grabs, and where it can send the avatar.
// Pure maths; a ray is { o, d } with d a unit vector.
import * as cg from '../../render/core/cg.js';

// The ray in another frame: m takes its coordinates to the new ones.
export const mapRay = (m, { o, d }) => ({ o: cg.mTransform(m, o), d: cg.normalize(cg.mTransform(m, [...d, 0]).slice(0, 3)) });

// How far along the ray it meets the box (0 if it starts inside), or null.
export const rayBox = ({ o, d }, { min, max }) => {
   let near = 0, far = Infinity;
   for (let a = 0; a < 3; a++) {
      if (Math.abs(d[a]) < 1e-12) {
         if (o[a] < min[a] || o[a] > max[a]) return null;
         continue;
      }
      const t0 = (min[a] - o[a]) / d[a], t1 = (max[a] - o[a]) / d[a];
      near = Math.max(near, Math.min(t0, t1));
      far = Math.min(far, Math.max(t0, t1));
      if (near > far) return null;
   }
   return near;
};

// The first walkable top the ray meets from above: the top of one of the boxes,
// or the table (y = 0) where onTable(point) says it is. Returns
// { p, t, onObject } or null.
export const pickTop = ({ o, d }, boxes, onTable) => {
   if (d[1] >= 0) return null;
   let best = null;
   const tops = boxes.map(b => ({ y: b.max[1], within: p => p[0] >= b.min[0] && p[0] <= b.max[0] && p[2] >= b.min[2] && p[2] <= b.max[2], onObject: true }));
   tops.push({ y: 0, within: onTable, onObject: false });
   for (const { y, within, onObject } of tops) {
      const t = (y - o[1]) / d[1];
      if (t <= 0 || (best && t >= best.t)) continue;
      const p = [o[0] + t * d[0], y, o[2] + t * d[2]];
      if (within(p)) best = { p, t, onObject };
   }
   return best;
};
