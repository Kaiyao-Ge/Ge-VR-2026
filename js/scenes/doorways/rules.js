// The rules of Doorways, pure and without graphics: the board and its sizes, how
// rooms turn and connect through their doorways, what the mini can reach, where a
// released room snaps, and the actions of both players. The generator, both clients
// and the tests all use these functions, so they agree on what is legal.
//
// Sides are 0 N (-z), 1 E (+x), 2 S (+z), 3 W (-x). A side s of a room turned
// rot quarter turns faces the world side (s + rot) % 4. The state is a plain
// object, and apply returns a new one instead of changing the old.
import * as cg from '../../render/core/cg.js';

export const U = 1 / 12;                  // one metre of the mini's world, in metres of table
export const CELL = .18, GRID = 3;
export const SYMBOLS = ['moon', 'star', 'sun', 'tree', 'fish', 'mountain'];
export const COLOURS = ['red', 'blue'];
export const CELLS = Array.from({ length: GRID * GRID }, (_, i) => 'c' + i);   // index r * 3 + c, r = 0 is the -z row
export const DEPOT = ['d0', 'd1'];
export const ENTRANCE = 'entrance', ENTRANCE_CELL = 'c3';
export const PENALTY = 20;                // seconds for opening an empty chest
export const SNAP = .12;                  // how near a released room must be to a slot to take it
export const MAX_KEYS = 2;

export const ROOM = { FLOOR: .1 * U, WALL: 2.6 * U, T: .15 * U, DOOR_W: 1 * U, DOOR_H: 2.1 * U };
// Where the key, the switch and the chest stand in a room's frame: three different corners.
export const SPOTS = { key: [-.3 * CELL, -.3 * CELL], switch: [.3 * CELL, -.3 * CELL], chest: [.3 * CELL, .3 * CELL] };

export const facing = (side, rot) => (side + rot) % 4;
const opposite = side => (side + 2) % 4;

// Which world sides of a room turned rot have a doorway; its doors are a mask, N E S W from the lowest bit.
export const openings = (room, rot) => {
   const open = [false, false, false, false];
   for (let s = 0; s < 4; s++) open[facing(s, rot)] = !!(room.doors >> s & 1);
   return open;
};

// The slot across a side of a slot: cells neighbour cells, the entrance hall is beside cell c3 on its west.
export const neighbour = (slot, side) => {
   if (slot === ENTRANCE) return side === 1 ? ENTRANCE_CELL : null;
   const i = CELLS.indexOf(slot);
   if (i < 0) return null;
   const c = i % GRID, r = (i - c) / GRID;
   const [dc, dr] = [[0, -1], [1, 0], [0, 1], [-1, 0]][side];
   const nc = c + dc, nr = r + dr;
   if (nc < 0 || nc >= GRID || nr < 0 || nr >= GRID) return slot === ENTRANCE_CELL && side === 3 ? ENTRANCE : null;
   return CELLS[nr * GRID + nc];
};

// Where a slot is in the table's frame (y = 0 is the table top).
export const slotCentre = slot => {
   if (slot === ENTRANCE) return [-1.5 * CELL - CELL / 4, 0, 0];
   const d = DEPOT.indexOf(slot);
   if (d >= 0) return [.45, 0, d ? .1 : -.1];
   const i = CELLS.indexOf(slot);
   return [(i % GRID - 1) * CELL, 0, (Math.floor(i / GRID) - 1) * CELL];
};

// Turning by -rot quarter turns about y takes a room's north (-z) to the east (+x) after one.
export const slotPose = (slot, rot) => cg.mMultiply(cg.mTranslate(slotCentre(slot)), cg.mRotateY(-rot * Math.PI / 2));

const roomOf = (level, id) => level.rooms.find(r => r.id === id);
const occupant = (state, slot) => Object.keys(state.at).find(id => state.at[id].slot === slot);
const isSlot = slot => CELLS.includes(slot) || DEPOT.includes(slot);

// The world sides of a room (or of the entrance hall, open on its east only) that have a doorway.
const sidesOpen = (level, state, id) =>
   id === ENTRANCE ? [false, true, false, false] : openings(roomOf(level, id), state.at[id].rot);

// Is there a gate still locked in the doorway of room id on this world side?
const gated = (level, state, id, side) => {
   const room = id === ENTRANCE ? null : roomOf(level, id);
   return !!room && !!room.gate && facing(room.gate.side, state.at[id].rot) === side && !state.unlocked.includes(id);
};

// The room (or the entrance) across a world side of the room id, if its facing side is open too.
const across = (level, state, id, side) => {
   const slot = id === ENTRANCE ? ENTRANCE : state.at[id].slot, n = neighbour(slot, side);
   const other = n === ENTRANCE ? ENTRANCE : n && occupant(state, n);
   return other && sidesOpen(level, state, other)[opposite(side)] ? other : null;
};

// The graph of rooms and the entrance: an edge where both facing sides are open and no gate is still locked in either.
export const links = (level, state) => {
   const graph = new Map([[ENTRANCE, new Set()], ...level.rooms.map(r => [r.id, new Set()])]);
   for (const id of graph.keys()) {
      sidesOpen(level, state, id).forEach((open, side) => {
         const other = open && across(level, state, id, side);
         if (other && !gated(level, state, id, side) && !gated(level, state, other, opposite(side))) graph.get(id).add(other);
      });
   }
   return graph;
};

// The rooms the mini can walk to from where it is, its own included.
export const reachable = (level, state) => {
   const graph = links(level, state), seen = new Set([state.mini]), todo = [state.mini];
   while (todo.length)
      for (const next of graph.get(todo.pop()) || [])
         if (!seen.has(next)) { seen.add(next); todo.push(next); }
   return seen;
};

// Can the giant lift this room: not the entrance, and not one whose stake is still in its roof?
export const movable = (level, state, id) => {
   const room = id === ENTRANCE ? null : roomOf(level, id);
   return !!room && (!room.anchor || state.pressed.includes(room.anchor));
};

// Where a room released at p (in the table frame) turned to yaw goes: the nearest free slot within SNAP, its own
// counting as free, and the nearest quarter turn. Null where no slot is near.
export const snap = (level, state, id, p, yaw) => {
   let best = null, bestD = SNAP;
   for (const slot of [...CELLS, ...DEPOT]) {
      const holder = occupant(state, slot);
      if (holder && holder !== id) continue;
      const c = slotCentre(slot), d = Math.hypot(p[0] - c[0], p[2] - c[2]);
      if (d <= bestD) { best = slot; bestD = d; }
   }
   return best && { slot: best, rot: (Math.round(-yaw / (Math.PI / 2)) % 4 + 4) % 4 };
};

export const startState = level => ({
   at: JSON.parse(JSON.stringify(level.start)), mini: ENTRANCE, keys: [], taken: [], unlocked: [], pressed: [],
   opened: [], penalty: 0, won: false,
});

// Each action checks who acts, then its own rules; it returns the new state or an error and never touches the old one.
const actions = {
   place(level, state, a) {
      if (!roomOf(level, a.place)) return 'no such room';
      if (!movable(level, state, a.place)) return 'that room cannot be lifted';
      if (!isSlot(a.slot)) return 'no such slot';
      if (!Number.isInteger(a.rot) || a.rot < 0 || a.rot > 3) return 'bad turn';
      const holder = occupant(state, a.slot);
      if (holder && holder !== a.place) return 'that slot is taken';
      state.at[a.place] = { slot: a.slot, rot: a.rot };   // the mini is tracked by room, so it goes along
   },
   go(level, state, a) {
      if (!reachable(level, state).has(a.go)) return 'that room is not reachable';
      state.mini = a.go;
   },
   take(level, state, a) {
      const room = roomOf(level, a.take);
      if (!room || !room.key) return 'no key there';
      if (state.mini !== a.take) return 'the mini is not in that room';
      if (state.taken.includes(a.take)) return 'the key is taken';
      if (state.keys.length >= MAX_KEYS) return 'the hands are full';
      state.keys.push(room.key); state.taken.push(a.take);
   },
   unlock(level, state, a) {
      const room = roomOf(level, a.unlock);
      if (!room || !room.gate) return 'no gate there';
      if (state.unlocked.includes(a.unlock)) return 'the gate is open';
      const side = facing(room.gate.side, state.at[a.unlock].rot);
      if (state.mini !== a.unlock && state.mini !== across(level, state, a.unlock, side)) return 'the mini is not at that gate';
      const i = state.keys.indexOf(room.gate.colour);
      if (i < 0) return 'no key of that colour';
      state.keys.splice(i, 1); state.unlocked.push(a.unlock);
   },
   press(level, state, a) {
      const room = roomOf(level, a.press);
      if (!room || !room.switch) return 'no switch there';
      if (state.mini !== a.press) return 'the mini is not in that room';
      if (!state.pressed.includes(room.switch)) state.pressed.push(room.switch);
   },
   open(level, state, a) {
      const room = roomOf(level, a.open);
      if (!room || !room.chest) return 'no chest there';
      if (state.mini !== a.open) return 'the mini is not in that room';
      if (state.opened.includes(a.open)) return 'the chest is open';
      state.opened.push(a.open);
      if (a.open === level.goal) state.won = true; else state.penalty += PENALTY;
   },
};

// The verb of an action is its one key other than by; place belongs to the giant, the rest to the mini.
export const apply = (level, state, action) => {
   const verb = Object.keys(actions).find(v => v in action);
   if (!verb) return { error: 'unknown action' };
   if (action.by !== (verb === 'place' ? 'giant' : 'mini')) return { error: `the ${verb} action is not for the ${action.by}` };
   // After the win the final time is frozen: another chest must not add its 20 s, nor anything else change.
   if (state.won && verb !== 'place') return { error: 'the round is over' };
   const next = JSON.parse(JSON.stringify(state)), error = actions[verb](level, next, action);
   return error ? { error } : { state: next };
};
