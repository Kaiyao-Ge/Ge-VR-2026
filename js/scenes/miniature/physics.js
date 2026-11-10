// The avatar's body on the table: it walks over the table and over the
// object's boxes, climbs what is low enough, and is stopped by what is not.
// Everything is in the object's frame, where y = 0 is the table top, and in
// metres of table: the avatar's own sizes divided by 12.
const U = 1 / 12;
export const RADIUS = .25 * U, STEP = .45 * U, HEAD = 1.9 * U;

// Does the avatar's circle (of radius r) at (x, z) reach into the box's footprint?
const touches = ({ min, max }, x, z, r = RADIUS) => {
   const dx = x - Math.max(min[0], Math.min(max[0], x)), dz = z - Math.max(min[2], Math.min(max[2], z));
   return dx * dx + dz * dz < r * r;
};

// The height of the ground under feet at [x, y, z]: the highest box top under
// the circle that is no more than a step above the feet, else the table.
export const ground = (boxes, [x, y, z]) =>
   boxes.reduce((g, b) => b.max[1] <= y + STEP && b.max[1] > g && touches(b, x, z) ? b.max[1] : g, 0);

// Does this box stand in the way at feet [x, y, z]: too high to step on and
// low enough to meet the head?
const blocks = (b, [x, y, z], r) => b.max[1] > y + STEP + 1e-9 && b.min[1] < y + HEAD && touches(b, x, z, r);

// Is something in the way at feet p?
export const blocked = (boxes, p) => boxes.some(b => blocks(b, p));

// How far (x, z) is from the box's footprint: 0 on it or inside it.
const gap = ({ min, max }, x, z) => Math.hypot(x - Math.max(min[0], Math.min(max[0], x)), z - Math.max(min[2], Math.min(max[2], z)));

// Walk the feet by (dx, dz). The feet then drop to the ground, or climb to it.
// If something is in the way the walk slides along the axis that is free. A
// box that already blocks the feet where they start (the object was put down
// on the avatar, or a snap turn swung the feet into a wall) does not block a
// step that is no nearer to it, so the avatar can walk out of it; a step that
// goes nearer is blocked as ever, so it cannot walk on through a wall. A feet
// point inside a box's footprint is as near as it can be: nothing is nearer.
// Returns { feet, blocked }.
export const move = (boxes, feet, dx, dz) => {
   let p = feet;
   const go = (ax, az) => {
      const q = [p[0] + ax, p[1], p[2] + az];
      if (boxes.some(b => blocks(b, q) && !(blocks(b, p) && gap(b, q[0], q[2]) >= gap(b, p[0], p[2]) - 1e-9))) return false;
      p = [q[0], ground(boxes, q), q[2]];
      return true;
   };
   if (!dx && !dz) { go(0, 0); return { feet: p, blocked: false }; }
   const free = go(dx, dz);
   if (!free) { go(dx, 0); go(0, dz); }
   return { feet: p, blocked: !free };
};
