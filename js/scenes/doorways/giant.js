// The giant's part of Doorways: lifting rooms, carrying them and setting them down.
// It works on `game` ({ level, state, held, ... }, all in the table's frame, see
// doorways.js) and owns two things in it: `state.at`, where the settled rooms are, and
// `held`, { id, m, ... }, the room in the giant's hand and its pose m (a matrix) while it
// is there. A held room is still at its old slot in state.at until it is set down.
//
// A hand lifts a room that is movable (see rules.movable) when it is within reach of the
// room's box (3 cm) or its ray meets the box within 3 m. The room then follows the hand
// (follow with a matrix) or the mouse (follow with a ray: the room's centre goes to
// where the ray meets a horizontal plane, a little above the table). turn() turns it a
// quarter about its centre. release() sets it down: rules.snap finds the cell, apply
// takes the move, and a room with no cell near, or one the rules refuse, goes back.
import * as cg from '../../render/core/cg.js';
import { yawOf } from '../miniature/mapping.js';
import { mapRay, rayBox } from '../miniature/rays.js';
import { U, CELL, ROOM, slotPose, movable, snap, apply } from './rules.js';

export const REACH = .03, RAY_REACH = 3, LIFT = .03;   // metres: grab margin, ray length, how high a room is held above the table
const H = CELL / 2;
// A room's box in its own frame: its floor to the top of its roof (the roof is .2 U thick).
const BOX = { min: [-H, 0, -H], max: [H, ROOM.WALL + .2 * U, H] };

// Where a room is now, in the table frame: in the hand, or at its slot.
export const roomPose = (game, id) => {
   if (game.held?.id === id) return game.held.m;
   const { slot, rot } = game.state.at[id];
   return slotPose(slot, rot);
};

// The movable room that a hand (a point p, or null, and a ray, in the table frame) takes: the nearest whose
// box the point is in or near, else the first that the ray meets within RAY_REACH. An id or null.
export const pick = (game, p, ray) => {
   let best = null, bestScore = Infinity;
   for (const room of game.level.rooms) {
      if (!movable(game.level, game.state, room.id)) continue;
      const inv = cg.mInverse(roomPose(game, room.id)), q = p && cg.mTransform(inv, p), hit = rayBox(mapRay(inv, ray), BOX);
      // A room in reach (scored by how far its middle is) beats any room along the ray (scored 10 and the length).
      const score = q && q.every((v, a) => v > BOX.min[a] - REACH && v < BOX.max[a] + REACH) ? cg.norm(q)
         : hit !== null && hit <= RAY_REACH ? 10 + hit : Infinity;
      if (score < bestScore) { best = room.id; bestScore = score; }
   }
   return best;
};

// The point where a ray meets the horizontal plane at this height, or null (parallel, or behind).
const onPlane = ({ o, d }, height) => {
   const t = Math.abs(d[1]) < 1e-6 ? -1 : (height - o[1]) / d[1];
   return t > 0 ? [o[0] + t * d[0], height, o[2] + t * d[2]] : null;
};

// Lift room id. hand: { hand: 'left' | 'right', m } (its matrix in the table frame) or
// { hand: 'mouse', ray }, the ray the cursor makes.
export const grab = (game, id, hand) => {
   const m = roomPose(game, id);
   game.held = { id, m, hand: hand.hand };
   if (hand.hand !== 'mouse') { game.held.offset = cg.mMultiply(cg.mInverse(hand.m), m); return; }
   // The room keeps its place under the cursor: remember where its centre is from where the ray meets the plane.
   const hit = rayBox(mapRay(cg.mInverse(m), hand.ray), BOX) ?? 0, q = cg.add(hand.ray.o, cg.scale(hand.ray.d, hit));
   const height = q[1] + LIFT, under = onPlane(hand.ray, height) || q;
   game.held.plane = { height, dx: m[12] - under[0], dz: m[14] - under[2] };
   follow(game, hand);
};

// The room goes with the hand: a matrix, or the mouse's ray.
export const follow = (game, hand) => {
   const held = game.held;
   if (hand.m) { held.m = cg.mMultiply(hand.m, held.offset); return; }
   const p = onPlane(hand.ray, held.plane.height);
   if (!p) return;
   held.m = [...held.m];
   held.m[12] = p[0] + held.plane.dx; held.m[13] = LIFT; held.m[14] = p[2] + held.plane.dz;
};

// A quarter turn about the room's own centre and vertical: dir 1 clockwise seen from above, -1 the other way.
export const turn = (game, dir) => {
   if (game.held) game.held.m = cg.mMultiply(game.held.m, cg.mRotateY(-dir * Math.PI / 2));
};

// Set the held room down. Returns { id, moved, error }: moved if it is in a new slot or turned, error the reason,
// if there is one, that it went back.
export const release = game => {
   const { id, m } = game.held, { level, state } = game;
   game.held = null;
   const to = snap(level, state, id, m.slice(12, 15), yawOf(m));
   if (!to) return { id, moved: false, error: 'no free cell there' };
   const result = apply(level, state, { by: 'giant', place: id, slot: to.slot, rot: to.rot }), was = state.at[id];
   if (result.error) return { id, moved: false, error: result.error };
   state.at = result.state.at;   // the giant's part only: the rest of the state is the mini's
   return { id, moved: was.slot !== to.slot || was.rot !== to.rot };
};
