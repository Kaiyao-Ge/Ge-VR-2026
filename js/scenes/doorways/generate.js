// The level generator of Doorways, pure and seeded: both players' clients run
// generate(seed) and get the same level, and the plan that solves it.
//
// A level is built around a solved path of cells from the entrance to the goal
// room. Gates, anchors and a turntable are laid on that path, each key or switch
// in a room the mini reaches before it needs it. The rooms are then scattered over
// the board and the depot, and the plan is found by playing the intended solution
// through rules.apply, so a plan that exists is a plan the rules accept.
import * as R from './rules.js';

const { CELLS, DEPOT, ENTRANCE_CELL, SYMBOLS, COLOURS, MAX_KEYS } = R;
const DEFAULTS = { pathMin: 3, pathMax: 6, gates: 2, anchors: 1, turntable: .5, emptyChests: 2 };
const TRIES = 50, P_GATE = .6, P_ANCHOR = .6, P_EXTRA_DOOR = .2;
const opp = side => (side + 2) % 4;

// mulberry32: a small, good seeded generator, so that nothing here ever calls Math.random.
export const rng = seed => {
   let a = seed >>> 0;
   return () => {
      a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
   };
};
const int = (rand, n) => Math.floor(rand() * n);
const pick = (rand, list) => list[int(rand, list.length)];
const range = (from, to) => Array.from({ length: to - from }, (_, i) => from + i);
const shuffle = (rand, list) => {
   const out = list.slice();
   for (let i = out.length - 1; i > 0; i--) { const j = int(rand, i + 1); [out[i], out[j]] = [out[j], out[i]]; }
   return out;
};
const ascending = (a, b) => a - b;

// A simple random path of n cells that starts in the cell beside the entrance; walks that get stuck are redone.
const walk = (rand, n) => {
   for (;;) {
      const path = [ENTRANCE_CELL];
      while (path.length < n) {
         const free = [0, 1, 2, 3].map(s => R.neighbour(path[path.length - 1], s)).filter(c => CELLS.includes(c) && !path.includes(c));
         if (!free.length) break;
         path.push(pick(rand, free));
      }
      if (path.length === n) return path;
   }
};

// The doors of a room as a mask in its own frame, given the world sides that must be open when it is turned rot.
const ownMask = (world, rot) => [0, 1, 2, 3].reduce((m, s) => m | (world >> (s + rot) % 4 & 1) << s, 0);
// The mask with each missing side added at random, so rooms have doors that the path does not need.
const withExtras = (rand, mask) => [0, 1, 2, 3].reduce((m, s) => rand() < P_EXTRA_DOOR ? m | 1 << s : m, mask);

// The layout the players start from: 7 rooms in cells, the rest in the depot, at random turns. An anchored room
// is kept out of the cells needed before its switch is pressed and never starts in its solved pose, so the plan
// has to place it.
const scatter = (rand, ids, d, anchored, solved) => {
   const slots = shuffle(rand, [...shuffle(rand, CELLS).slice(0, 7), ...shuffle(rand, DEPOT).slice(0, d)]);
   const start = {};
   for (const { id, early } of anchored) {
      start[id] = { slot: slots.splice(slots.findIndex(s => !early.has(s)), 1)[0], rot: int(rand, 4) };
      if (start[id].slot === solved[id].slot && start[id].rot === solved[id].rot) start[id].rot = (start[id].rot + 1) % 4;
   }
   for (const id of shuffle(rand, ids.filter(id => !start[id]))) start[id] = { slot: slots.pop(), rot: int(rand, 4) };
   return start;
};

// Steps 1-3: the path, and the gates, anchors and turntable on it, each key or switch placed in a room at or before
// a given path index. A key or switch goes in a path room or in a spur: a side room on a free cell next to a path
// room, which that room gets a doorway to.
const design = (rand, o) => {
   const n = o.pathMin + int(rand, o.pathMax - o.pathMin + 1), path = walk(rand, n);
   const dirTo = i => [0, 1, 2, 3].find(s => R.neighbour(path[i], s) === path[i + 1]);
   const into = i => i ? opp(dirTo(i - 1)) : 3;
   const turn = rand() < o.turntable ? int(rand, n - 1) : -1;
   const gates = Array.from({ length: Math.min(o.gates, MAX_KEYS, n - 1) }, () => rand() < P_GATE ? { colour: pick(rand, COLOURS) } : null).filter(Boolean);
   const anchors = Array.from({ length: Math.min(o.anchors, n - 1) }, () => rand() < P_ANCHOR ? { colour: pick(rand, COLOURS) } : null).filter(Boolean);
   const edges = shuffle(rand, range(1, n)).slice(0, gates.length).sort(ascending);
   const posts = shuffle(rand, range(1, n).filter(i => i !== turn)).slice(0, anchors.length).sort(ascending);
   gates.forEach((g, i) => {
      g.e = edges[i];
      g.owner = g.e - 1 !== turn && (g.e === turn || rand() < .5) ? g.e - 1 : g.e;   // the turntable never carries a gate
   });
   anchors.forEach((a, i) => { a.at = posts[i]; });

   const held = path.map(() => ({})), spurs = [], taken = new Set(path);
   const spurSide = k => k === turn ? undefined : shuffle(rand, [0, 1, 2, 3]).find(s => {
      const c = R.neighbour(path[k], s);
      return CELLS.includes(c) && !taken.has(c);
   });
   const hold = (kind, colour, maxK) => {
      const ks = shuffle(rand, range(0, maxK + 1)), order = rand() < .5 ? [true, false] : [false, true];
      for (const useSpur of order) for (const k of ks) {
         const side = useSpur ? spurSide(k) : undefined;
         if (useSpur && side !== undefined) {
            const cell = R.neighbour(path[k], side);
            taken.add(cell); spurs.push({ k, side, cell, kind, colour });
            return k;
         }
         if (!useSpur && !held[k][kind]) { held[k][kind] = colour; return k; }
      }
      return -1;
   };
   for (const g of gates) if (hold('key', g.colour, g.e - 1) < 0) return null;
   for (const a of anchors) if ((a.host = hold('switch', a.colour, a.at - 1)) < 0) return null;
   return { n, path, dirTo, into, turn, gates, anchors, held, spurs };
};

// Steps 2, 4 and 5: the rooms with their doors, symbols and chests, where each stands when solved, and the start layout.
const furnish = (rand, d) => {
   const { n, path, dirTo, into, turn, gates, anchors, held, spurs } = d;
   const solved = {}, entry = {}, rooms = [];
   const add = (slot, rot, mask, props = {}) => {
      const id = 'r' + rooms.length;
      rooms.push({ id, doors: mask, symbol: null, key: null, switch: null, chest: false, gate: null, anchor: null, ...props });
      if (slot) solved[id] = { slot, rot };
      return id;
   };
   for (let i = 0; i < n; i++) {
      const world = withExtras(rand, 1 << into(i) | (i < n - 1 ? 1 << dirTo(i) : 0) | spurs.filter(s => s.k === i).reduce((m, s) => m | 1 << s.side, 0));
      const props = { key: held[i].key || null, switch: held[i].switch || null };
      if (i !== turn) { const rot = int(rand, 4); add(path[i], rot, ownMask(world, rot), props); continue; }
      // The turntable has one doorway: it faces the room before when the mini walks in and the next one when solved.
      const side = int(rand, 4), id = add(path[i], (dirTo(i) - side + 4) % 4, 1 << side, props);
      entry[id] = (into(i) - side + 4) % 4;
   }
   for (const s of spurs) {
      const rot = int(rand, 4);
      s.id = add(s.cell, rot, ownMask(withExtras(rand, 1 << opp(s.side)), rot), { [s.kind]: s.colour });
   }
   const total = Math.max(rooms.length, 8 + int(rand, 2));   // 7 in cells and 1-2 in the depot
   while (rooms.length < total) add(null, 0, 1 + int(rand, 15));

   for (const g of gates) {
      const id = 'r' + g.owner, world = g.owner === g.e ? into(g.e) : dirTo(g.owner);
      rooms[g.owner].gate = { side: (world - solved[id].rot + 4) % 4, colour: g.colour };
   }
   const goal = rooms[n - 1], goalSymbol = pick(rand, SYMBOLS);
   for (const r of rooms) r.symbol = r === goal ? goalSymbol : pick(rand, SYMBOLS.filter(s => s !== goalSymbol));
   goal.chest = true;
   for (const r of shuffle(rand, rooms.filter(r => r !== goal)).slice(0, d.empty)) r.chest = true;

   const anchored = anchors.map(a => {
      rooms[a.at].anchor = a.colour;
      // Before the switch is pressed the plan uses the cells of the path up to it and of the spurs on that stretch.
      const early = new Set([...path.slice(0, a.host + 1), ...spurs.filter(s => s.k <= a.host).map(s => s.cell)]);
      return { id: 'r' + a.at, early };
   });
   const start = scatter(rand, rooms.map(r => r.id), total - 7, anchored, solved);
   return { rooms, solved, entry, start, goal: goal.id, goalSymbol };
};

// Step 6: play the intended solution through the rules. Every room the next move needs is put in place first: a room in
// the way goes to a free slot that no room is meant for, then the room is placed, and the mini walks in and takes or
// presses what is there. Anything the rules refuse throws, and the seed is given up.
const solve = (level, d, f) => {
   let state = R.startState(level);
   const plan = [], goalIndex = d.n - 1;
   const act = action => {
      const r = R.apply(level, state, action);
      if (r.error) throw new Error(r.error);
      state = r.state; plan.push(action);
   };
   const targets = new Set([...d.path, ...d.spurs.map(s => s.cell)]);
   const spare = () => {
      const free = [...CELLS, ...DEPOT].filter(s => !Object.values(state.at).some(p => p.slot === s));
      return free.find(s => !targets.has(s)) || free[0];
   };
   const put = (id, slot, rot) => {
      const cur = state.at[id], holder = Object.keys(state.at).find(k => state.at[k].slot === slot);
      if (cur.slot === slot && cur.rot === rot) return;
      if (holder && holder !== id) act({ by: 'giant', place: holder, slot: spare(), rot: state.at[holder].rot });
      act({ by: 'giant', place: id, slot, rot });
   };
   const collect = id => {
      const room = level.rooms.find(r => r.id === id);
      if (room.key) act({ by: 'mini', take: id });
      if (room.switch) act({ by: 'mini', press: id });
   };
   for (let i = 0; i < d.n; i++) {
      const id = 'r' + i, before = 'r' + (i - 1);
      put(id, d.path[i], i === d.turn ? f.entry[id] : f.solved[id].rot);
      if (i > 0 && i - 1 === d.turn) put(before, d.path[i - 1], f.solved[before].rot);   // turn the turntable with the mini inside
      const gate = d.gates.find(g => g.e === i);
      if (gate) act({ by: 'mini', unlock: 'r' + gate.owner });
      act({ by: 'mini', go: id });
      collect(id);
      for (const s of d.spurs.filter(s => s.k === i)) {
         put(s.id, s.cell, f.solved[s.id].rot);
         act({ by: 'mini', go: s.id });
         collect(s.id);
         act({ by: 'mini', go: id });
      }
   }
   act({ by: 'mini', open: 'r' + goalIndex });
   return plan;
};

const attempt = (seed, o) => {
   const rand = rng(seed), d = design(rand, o);
   if (!d) return null;
   d.empty = o.emptyChests;
   const f = furnish(rand, d), level = { seed, rooms: f.rooms, goal: f.goal, goalSymbol: f.goalSymbol, start: f.start };
   try { return { level, plan: solve(level, d, f) }; } catch (e) { return null; }
};

// Replays a plan from the start: the goal must not be reachable at once, every step must be legal, the last one wins.
export const validate = (level, plan) => {
   let state = R.startState(level);
   if (R.reachable(level, state).has(level.goal)) return { ok: false, error: 'the goal is reachable at the start' };
   for (const [i, action] of plan.entries()) {
      const r = R.apply(level, state, action);
      if (r.error) return { ok: false, error: `step ${i}: ${r.error}` };
      state = r.state;
   }
   return state.won ? { ok: true, error: null } : { ok: false, error: 'the plan does not open the goal chest' };
};

// A seed whose level fails to build or to validate is replaced by the next one; the seed used is returned.
export const generate = (seed, options = {}) => {
   const o = { ...DEFAULTS, ...options };
   for (let s = seed; s < seed + TRIES; s++) {
      const made = attempt(s, o);
      if (made && validate(made.level, made.plan).ok) return { ...made, seed: s };
   }
   throw new Error(`no level found from seed ${seed}`);
};
