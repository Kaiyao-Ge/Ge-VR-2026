// The mini's part of Doorways: walking among the rooms, riding a room the giant holds,
// teleporting, and using what is in its hands' reach. It works on `game` ({ level,
// state, held, ... }, all in the table frame, see doorways.js) and owns everything in
// the state except `at`: MINI_PART below. (`at`, and the held room, are the giant's: see giant.js.)
//
// The mini's body is the HW7 avatar's (miniature/physics.js: walls and lintels stop it,
// low things are climbed), but the table around and between the rooms is water, so
// walk.js keeps its feet over a room's floor or the entrance's. Where the mini is, is
// the physics' to say (state.mini follows its feet); a teleport goes only to a room that
// rules.reachable says it can walk to. While the giant holds the room the mini stands in,
// the mini moves in that room's frame, among that room's boxes alone: the room goes where
// the hand takes it, and the mini goes with it (the scene draws that; see doorways.js).
import * as cg from '../../render/core/cg.js';
import { blocked, RADIUS } from '../miniature/physics.js';
import { walk, roomAt, toTable } from './walk.js';
import { choose } from './rooms.js';
import { ROOM, ENTRANCE, neighbour, slotPose, slotCentre, reachable, apply } from './rules.js';

export const WALK = .12, TURN = Math.PI / 6;   // metres of table a second; a snap turn
export const PUSH = .6, CENTRE = .25;          // how far the right stick must be pushed to aim; how near the centre it must come back before it turns again
export const MINI_PART = ['mini', 'keys', 'taken', 'unlocked', 'pressed', 'opened', 'penalty', 'won'];

const VERB = { key: 'take', switch: 'press', chest: 'open', gate: 'unlock' };

// rooms: id -> the room's view (rooms.js); board: the board's (board.js).
export function createMini({ rooms, board }) {
   let memo = { key: null, world: null };

   const settled = ({ state, held }) => {
      if (!held) return state.at;
      const { [held.id]: _, ...rest } = state.at;
      return rest;
   };

   // What the mini's feet meet in the table frame: the boxes and floors of the entrance and of every room settled in a
   // cell or in the depot (a depot room is an island, with no way out). The room in the giant's hand is not among them. Rebuilt when a room, a gate or the hand's room changes.
   const world = game => {
      const { state, held } = game, key = JSON.stringify([state.at, state.unlocked, held?.id]);
      if (memo.key === key) return memo.world;
      const boxes = [...board.entrance.colliders], floors = [{ ...board.entrance.floor, id: ENTRANCE }];
      for (const [id, { slot, rot }] of Object.entries(settled(game))) {
         const pose = slotPose(slot, rot), view = rooms.get(id);
         boxes.push(...toTable(view.colliders(state), pose));
         floors.push({ ...toTable([view.floor], pose)[0], id });
      }
      memo = { key, world: { boxes, floors } };
      return memo.world;
   };

   // The mini rides when the giant holds its room. That room's frame, where its feet are, is the room as it stood when taken.
   const riding = ({ state, held }) => !!held && state.mini === held.id;
   const frame = game => slotPose(game.state.at[game.held.id].slot, game.state.at[game.held.id].rot);

   return {
      MINI_PART,
      // The feet (table frame) after a step of (dx, dz), and whether something stopped it: { feet, blocked, room }, room
      // the one the feet are in. A zero step settles the feet on the ground.
      step(game, feet, dx, dz) {
         if (riding(game)) {
            const F = frame(game), inv = cg.mInverse(F), d = cg.mTransform(inv, [dx, 0, dz, 0]), view = rooms.get(game.held.id);
            const r = walk(view.colliders(game.state), [view.floor], cg.mTransform(inv, feet), d[0], d[2]);
            return { feet: cg.mTransform(F, r.feet), blocked: r.blocked, room: game.state.mini };
         }
         const w = world(game), r = walk(w.boxes, w.floors, feet, dx, dz);
         return { ...r, room: roomAt(settled(game), r.feet) };
      },

      // A room's pose when the mini was last in its frame, for the scene to carry the mini with it.
      frame,

      // Where a ray (table frame) meets the floor of a room the mini can walk to: { id, p } or null. The mini's body must
      // fit there: a radius off the walls, and nothing in the way.
      aim(game, { o, d }) {
         const t = d[1] < 0 ? (ROOM.FLOOR - o[1]) / d[1] : -1;
         if (t <= 0) return null;
         const p = [o[0] + t * d[0], ROOM.FLOOR, o[2] + t * d[2]], w = world(game), ok = reachable(game.level, game.state);
         const floor = w.floors.find(f => ok.has(f.id) && [0, 2].every(a => p[a] > f.min[a] + RADIUS && p[a] < f.max[a] - RADIUS));
         return floor && !blocked(w.boxes, p) ? { id: floor.id, p } : null;
      },

      // The middle of a room's floor, if the mini can walk to that room: { id, p } or null.
      centre(game, id) {
         if (!reachable(game.level, game.state).has(id)) return null;
         const f = world(game).floors.find(floor => floor.id === id);
         return f && { id, p: [(f.min[0] + f.max[0]) / 2, ROOM.FLOOR, (f.min[2] + f.max[2]) / 2] };
      },

      // The mini is now in this room (a teleport): the rules say if it may.
      go(game, id) {
         const result = apply(game.level, game.state, { by: 'mini', go: id });
         if (!result.error) this.commit(game, result.state);
         return result;
      },

      // Take the mini's part of a state the rules made into the game's.
      commit(game, next) { for (const k of MINI_PART) game.state[k] = next[k]; },

      // What the mini can use, in the table frame: its room's things and those of the four rooms round it (a gate may
      // be in the doorway of the next room). [{ what: { what, room }, at, size }]
      things(game) {
         const { state } = game, slot = state.mini === ENTRANCE ? ENTRANCE : state.at[state.mini].slot;
         const near = new Set([state.mini]);
         for (let side = 0; side < 4; side++) {
            const s = neighbour(slot, side), id = Object.keys(state.at).find(r => state.at[r].slot === s);
            if (id) near.add(id);
         }
         return [...near].filter(id => id !== ENTRANCE && !(game.held?.id === id)).flatMap(id => {
            const pose = slotPose(state.at[id].slot, state.at[id].rot);
            return rooms.get(id).things(state).map(t => ({ what: { what: t.what, room: id }, at: cg.mTransform(pose, t.at), size: t.size }));
         });
      },

      // The thing the hand ({ p, ray } in the table frame) chooses: { what, room } or null.
      touch(game, hand) { return choose(hand, this.things(game)); },

      // Use it: grip takes a key, trigger does the rest. null where the button does nothing to it; else the rules' result.
      use(game, button, thing) {
         if (!thing || (button === 'grip') !== (thing.what === 'key')) return null;
         const result = apply(game.level, game.state, { by: 'mini', [VERB[thing.what]]: thing.room });
         if (!result.error) this.commit(game, result.state);
         return result;
      },

      // The thing of this kind ('key', 'switch', 'chest' or 'gate') in reach of the mini's room, for tests and hooks.
      find(game, what) { return this.things(game).map(t => t.what).find(t => t.what === what) || null; },

      centreOf: slotCentre,
   };
}
