// The mini walking among the rooms of Doorways. Its body is the miniature's
// (physics.move: walls and lintels stop it, low things are climbed), but the
// table between and around the rooms is water, so its feet must also stay over
// the floor of a room or of the entrance hall. This module is pure: boxes and
// footprints in, positions and names out, all in the table's frame.
import * as cg from '../../render/core/cg.js';
import { move } from '../miniature/physics.js';
import { CELL, CELLS, DEPOT, ENTRANCE, slotCentre } from './rules.js';

const EPS = 1e-9;   // so that a point on a shared edge is on both footprints despite rounding

// Is (x, z) over the footprint, edges included?
const over = ({ min, max }, x, z) =>
   x >= min[0] - EPS && x <= max[0] + EPS && z >= min[2] - EPS && z <= max[2] + EPS;

// Walk the feet by (dx, dz), as physics.move does, but never off the floors.
// The full step comes first. If it ends in the water, each axis alone is tried
// from where the feet started, so the mini slides along the edge of a floor as
// it slides along a wall; if neither stays on a floor, the mini stays put.
// Returns { feet, blocked }, blocked whenever the full step was not taken.
export const walk = (boxes, floors, feet, dx, dz) => {
   const dry = p => floors.some(f => over(f, p[0], p[2]));
   const full = move(boxes, feet, dx, dz);
   if (dry(full.feet)) return full;
   for (const [ax, az] of [[dx, 0], [0, dz]]) {
      if (!ax && !az) continue;
      const step = move(boxes, feet, ax, az);
      if (dry(step.feet)) return { feet: step.feet, blocked: true };
   }
   return { feet, blocked: true };
};

// The square a cell covers on the table; the entrance hall is a half cell wide and a cell deep.
const footprint = slot => {
   const [x, , z] = slotCentre(slot), hx = slot === ENTRANCE ? CELL / 4 : CELL / 2;
   return { min: [x - hx, 0, z - CELL / 2], max: [x + hx, 0, z + CELL / 2] };
};

// Which room, or the entrance, is under the point p (in the table frame)? A
// room is where its slot is. A room in the depot is an island: the mini can be
// in it (carried there by the giant) though it links to nothing. The footprints of
// cells share edges, and on one the entrance wins over every cell, and the lower
// cell index wins over a higher one, so the answer never depends on rounding or on
// the order of the rooms; the depot's two pads are apart from each other and from
// the board. `at` is state.at: room id -> { slot, rot }.
const SLOTS = [...CELLS, ...DEPOT];
export const roomAt = (at, p) => {
   if (over(footprint(ENTRANCE), p[0], p[2])) return ENTRANCE;
   const held = Object.keys(at).filter(id => SLOTS.includes(at[id].slot));
   held.sort((a, b) => SLOTS.indexOf(at[a].slot) - SLOTS.indexOf(at[b].slot));
   return held.find(id => over(footprint(at[id].slot), p[0], p[2])) || null;
};

// Take boxes from a room's frame to the table's by the room's pose. A quarter
// turn keeps a box axis-aligned, so the box of its eight corners is exact.
export const toTable = (boxes, pose) => boxes.map(({ min, max }) => {
   const corners = [0, 1, 2, 3, 4, 5, 6, 7].map(i =>
      cg.mTransform(pose, [i & 1 ? max[0] : min[0], i & 2 ? max[1] : min[1], i & 4 ? max[2] : min[2]]));
   return { min: [0, 1, 2].map(a => Math.min(...corners.map(c => c[a]))),
            max: [0, 1, 2].map(a => Math.max(...corners.map(c => c[a]))) };
});
