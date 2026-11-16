// Doorways checks without a browser: the rules engine (sides, cells, links,
// reachability, movability, snapping and the actions of both players).
// Run: node tests/doorways.test.cjs
const assert = require('node:assert/strict');
const load = require('./esm.cjs');

let passed = 0;
const check = async (name, fn) => { await fn(); passed++; console.log('ok -', name); };
const near = (a, b, e = 1e-6) => assert.ok(Math.abs(a - b) < e, `${a} vs ${b}`);
const nearV = (a, b, e = 1e-6) => a.forEach((v, i) => near(v, b[i], e));

(async () => {
   const R = await load('js/scenes/doorways/rules.js');
   const G = await load('js/scenes/doorways/generate.js');

   const N = 0b0001, E = 0b0010, S = 0b0100, W = 0b1000;
   const room = (id, doors, extra = {}) => ({ id, doors, symbol: 'moon', key: null, switch: null, chest: false,
                                              gate: null, anchor: null, ...extra });
   // A level of three rooms in a row beside the entrance: r0 (c3), r1 (c4), r2 (c5), and a spare r3 in the depot.
   const level = (rooms, start) => ({ seed: 1, rooms, goal: 'r2', goalSymbol: 'moon', start });
   const row = { r0: { slot: 'c3', rot: 0 }, r1: { slot: 'c4', rot: 0 }, r2: { slot: 'c5', rot: 0 }, r3: { slot: 'd0', rot: 0 } };
   const plain = () => level([room('r0', E | W), room('r1', E | W), room('r2', W), room('r3', N)], row);
   const linked = (L, s, a, b) => R.links(L, s).get(a).has(b) && R.links(L, s).get(b).has(a);

   await check('sides turn with the room, and cells neighbour across them', () => {
      assert.equal(R.facing(0, 1), 1);
      assert.deepEqual(R.openings({ doors: 0b0001 }, 1), [false, true, false, false]);   // N door turned once faces E
      assert.deepEqual(R.openings({ doors: E | W }, 0), [false, true, false, true]);
      assert.equal(R.neighbour('c4', 0), 'c1'); assert.equal(R.neighbour('c3', 3), 'entrance'); assert.equal(R.neighbour('c0', 0), null);
      assert.equal(R.neighbour('c4', 1), 'c5'); assert.equal(R.neighbour('c4', 2), 'c7'); assert.equal(R.neighbour('c5', 1), null);
      assert.equal(R.neighbour('d0', 3), null);
      nearV(R.slotCentre('c0'), [-.18, 0, -.18]); nearV(R.slotCentre('entrance'), [-.315, 0, 0]);
      nearV(R.slotCentre('c8'), [.18, 0, .18]); nearV(R.slotCentre('d1'), [.45, 0, .1]);
      assert.deepEqual(R.CELLS, ['c0', 'c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8']);
   });

   await check('a slot pose puts the room at its centre and turns its north towards the east after one turn', () => {
      const m = R.slotPose('c2', 1);
      nearV(m.slice(12, 15), R.slotCentre('c2'));
      nearV([m[8] * -1, m[9] * -1, m[10] * -1], [1, 0, 0]);   // local -z (north) in the table frame
      nearV(R.slotPose('c2', 0).slice(0, 3), [1, 0, 0]);
   });

   await check('the three spots of a room are in three different corners', () => {
      const keys = new Set(['key', 'switch', 'chest'].map(k => R.SPOTS[k].join()));
      assert.equal(keys.size, 3);
      for (const k in R.SPOTS) R.SPOTS[k].forEach(v => near(Math.abs(v), .3 * R.CELL));
   });

   await check('two rooms link only where both facing sides are open, and a locked gate cuts the link until unlocked', () => {
      const L = plain(), s = R.startState(L);
      assert.ok(linked(L, s, 'r0', 'r1')); assert.ok(linked(L, s, 'r1', 'r2'));
      assert.ok(!R.links(L, s).get('r0').has('r2'));
      // r1 turned so that its west door faces north: the link to r0 and r2 is gone.
      const turned = R.startState(L); turned.at.r1.rot = 1;
      assert.ok(!linked(L, turned, 'r0', 'r1')); assert.ok(!linked(L, turned, 'r1', 'r2'));
      // A door on one side only is no link.
      const oneSided = R.startState(L); oneSided.at.r2.rot = 2;
      assert.ok(!linked(L, oneSided, 'r1', 'r2'));
      // A gate in r1's west doorway cuts the link to r0 (not to r2) until r1 is unlocked.
      const G = level([room('r0', E | W), room('r1', E | W, { gate: { side: 3, colour: 'red' } }), room('r2', W)], row);
      const g = R.startState(G);
      assert.ok(!linked(G, g, 'r0', 'r1')); assert.ok(linked(G, g, 'r1', 'r2'));
      g.unlocked.push('r1');
      assert.ok(linked(G, g, 'r0', 'r1'));
      // The gate turns with the room: r1 turned a half turn has it on the east side, facing r2.
      const h = R.startState(G); h.at.r1.rot = 2;
      assert.ok(linked(G, h, 'r0', 'r1')); assert.ok(!linked(G, h, 'r1', 'r2'));
      // A gate in the neighbour's doorway cuts the link as well.
      const G2 = level([room('r0', E | W, { gate: { side: 1, colour: 'red' } }), room('r1', W)], row);
      assert.ok(!linked(G2, R.startState(G2), 'r0', 'r1'));
   });

   await check('the mini reaches only its connected rooms; the entrance opens east only', () => {
      const L = plain(), s = R.startState(L);
      assert.deepEqual([...R.reachable(L, s)].sort(), ['entrance', 'r0', 'r1', 'r2']);
      // r1 moved off to c7: r2 is cut off, and so is r1.
      const t = R.startState(L); t.at.r1.slot = 'c7';
      assert.deepEqual([...R.reachable(L, t)].sort(), ['entrance', 'r0']);
      // The mini in r2 reaches the whole chain back to the entrance.
      const u = R.startState(L); u.mini = 'r2';
      assert.deepEqual([...R.reachable(L, u)].sort(), ['entrance', 'r0', 'r1', 'r2']);
      // A room at c3 with no west door: the entrance has only itself.
      const M = level([room('r0', E)], { r0: { slot: 'c3', rot: 0 } });
      assert.deepEqual([...R.reachable(M, R.startState(M))], ['entrance']);
      // Turned so that its east door faces west it links.
      const m = R.startState(M); m.at.r0.rot = 2;
      assert.deepEqual([...R.reachable(M, m)].sort(), ['entrance', 'r0']);
      // A room in the depot is its own island.
      const v = R.startState(L); v.mini = 'r3';
      assert.deepEqual([...R.reachable(L, v)], ['r3']);
   });

   await check('an anchored room is not movable until its colour is pressed; the entrance never is', () => {
      const L = level([room('r0', E | W, { anchor: 'blue' }), room('r1', W)], row), s = R.startState(L);
      assert.equal(R.movable(L, s, 'r0'), false);
      assert.equal(R.movable(L, s, 'r1'), true);
      s.pressed = ['red']; assert.equal(R.movable(L, s, 'r0'), false);
      s.pressed = ['blue']; assert.equal(R.movable(L, s, 'r0'), true);
      assert.equal(R.movable(L, s, 'entrance'), false);
   });

   await check('snap: the nearest free slot within 12 cm and the nearest quarter turn; none near is null', () => {
      const L = plain(), s = R.startState(L), at = (slot, dx, dz) => R.slotCentre(slot).map((v, i) => v + [dx, 0, dz][i]);
      assert.deepEqual(R.snap(L, s, 'r0', at('c8', .05, .02), -1.4), { slot: 'c8', rot: 1 });
      assert.deepEqual(R.snap(L, s, 'r0', at('d1', 0, 0), 0), { slot: 'd1', rot: 0 });
      assert.deepEqual(R.snap(L, s, 'r0', at('c0', 0, 0), Math.PI / 2 * 3), { slot: 'c0', rot: 1 });      assert.deepEqual(R.snap(L, s, 'r0', at('c0', 0, 0), Math.PI / 2), { slot: 'c0', rot: 3 });
      // Over a cell held by another room (c4 holds r1), the nearest free cell within 12 cm is taken, else none.
      assert.deepEqual(R.snap(L, s, 'r0', at('c4', 0, -.1), 0), { slot: 'c1', rot: 0 });
      assert.equal(R.snap(L, s, 'r0', at('c4', 0, 0), 0), null);
      // The room's own slot counts as free.
      assert.deepEqual(R.snap(L, s, 'r1', at('c4', .01, 0), 0), { slot: 'c4', rot: 0 });
      // Far off the board, and just beyond reach of a free slot.
      assert.equal(R.snap(L, s, 'r0', [2, 0, 2], 0), null);
      assert.equal(R.snap(L, s, 'r0', at('c8', .13, 0), 0), null);
      // Never onto the entrance.
      assert.equal(R.snap(L, s, 'r0', R.slotCentre('entrance'), 0), null);
   });

   await check('actions: place, go, take, unlock, press, open; illegal ones return an error and leave the state', () => {
      const L = level([
         room('r0', E | W, { key: 'red' }),
         room('r1', E | W, { gate: { side: 3, colour: 'red' }, switch: 'blue', chest: true }),
         room('r2', W, { chest: true, anchor: 'blue' }),
         room('r3', N)], row);
      const s0 = R.startState(L), snapshot = JSON.stringify(s0);
      assert.deepEqual(s0, { at: row, mini: 'entrance', keys: [], taken: [], unlocked: [], pressed: [], opened: [], penalty: 0, won: false });
      assert.notEqual(s0.at, row); assert.notEqual(s0.at.r0, row.r0);   // a copy, not the level's own
      const bad = (s, a) => { const before = JSON.stringify(s), r = R.apply(L, s, a); assert.equal(typeof r.error, 'string', JSON.stringify(a)); assert.equal(r.state, undefined); assert.equal(JSON.stringify(s), before); };
      const ok = (s, a) => { const r = R.apply(L, s, a); assert.equal(r.error, undefined, JSON.stringify(a)); assert.notEqual(r.state, s); return r.state; };

      // Walking: not through the locked gate, not to a room that is not connected, not when it is the giant's turn.
      bad(s0, { by: 'mini', go: 'r1' }); bad(s0, { by: 'mini', go: 'r3' }); bad(s0, { by: 'giant', go: 'r0' });
      bad(s0, { by: 'mini', take: 'r0' });   // the key is in r0, the mini is not
      let s = ok(s0, { by: 'mini', go: 'r0' });
      assert.equal(s.mini, 'r0');
      bad(s, { by: 'mini', unlock: 'r0' });   // r0 has no gate
      bad(s, { by: 'mini', unlock: 'r1' });   // no key yet
      s = ok(s, { by: 'mini', take: 'r0' });
      assert.deepEqual([s.keys, s.taken], [['red'], ['r0']]);
      bad(s, { by: 'mini', take: 'r0' });   // taken already
      s = ok(s, { by: 'mini', unlock: 'r1' });   // from across the gate, in r0
      assert.deepEqual([s.keys, s.unlocked], [[], ['r1']]);
      bad(s, { by: 'mini', unlock: 'r1' });   // already open, and no key
      s = ok(s, { by: 'mini', go: 'r1' });
      bad(s, { by: 'mini', open: 'r2' });   // the chest is in another room
      bad(s, { by: 'mini', press: 'r0' });
      // The giant: not an anchored room, not onto a held slot, not with a bad rot, not as the mini.
      bad(s, { by: 'giant', place: 'r2', slot: 'c8', rot: 0 });   // anchored
      bad(s, { by: 'giant', place: 'r3', slot: 'c4', rot: 0 });   // held by r1
      bad(s, { by: 'giant', place: 'r3', slot: 'entrance', rot: 0 });
      bad(s, { by: 'giant', place: 'r3', slot: 'c8', rot: 4 });
      bad(s, { by: 'mini', place: 'r3', slot: 'c8', rot: 0 });
      s = ok(s, { by: 'mini', press: 'r1' });
      assert.deepEqual(s.pressed, ['blue']);
      s = ok(s, { by: 'mini', open: 'r1' });   // the wrong chest
      assert.deepEqual([s.penalty, s.won, s.opened], [R.PENALTY, false, ['r1']]);
      assert.equal(R.PENALTY, 20);
      bad(s, { by: 'mini', open: 'r1' });   // already open
      // The giant moves r2 now that blue is pressed, onto its own slot turned, and the mini keeps its room.
      const moved = ok(s, { by: 'giant', place: 'r2', slot: 'c8', rot: 1 });
      assert.deepEqual(moved.at.r2, { slot: 'c8', rot: 1 });
      assert.deepEqual(s.at.r2, { slot: 'c5', rot: 0 });   // the old state is untouched
      assert.equal(moved.mini, 'r1');
      assert.ok(!R.reachable(L, moved).has('r2'));
      // Moving a room with the mini inside: it stays inside.
      const rides = ok(s, { by: 'giant', place: 'r1', slot: 'c7', rot: 0 });
      assert.equal(rides.mini, 'r1');
      // Placing on its own slot is allowed (a plain turn).
      assert.deepEqual(ok(s, { by: 'giant', place: 'r1', slot: 'c4', rot: 2 }).at.r1, { slot: 'c4', rot: 2 });
      s = ok(s, { by: 'mini', go: 'r2' });
      s = ok(s, { by: 'mini', open: 'r2' });   // the goal chest
      assert.equal(s.won, true); assert.equal(s.penalty, R.PENALTY);
      // After the win nothing of the mini's is accepted, even what would have been legal a moment ago: the final time is frozen.
      const legal = (patch, a) => { const t = JSON.parse(JSON.stringify(s0)); Object.assign(t, patch); ok(t, a); t.won = true; bad(t, a); };
      legal({ mini: 'r0' }, { by: 'mini', take: 'r0' });
      legal({ mini: 'r0', keys: ['red'] }, { by: 'mini', unlock: 'r1' });
      legal({ mini: 'r1' }, { by: 'mini', press: 'r1' });
      legal({ mini: 'r1' }, { by: 'mini', open: 'r1' });   // another chest: no second 20 s
      assert.equal(R.apply(L, { ...JSON.parse(JSON.stringify(s)), mini: 'r1', opened: [] }, { by: 'mini', open: 'r1' }).error, 'the round is over');
      assert.equal(JSON.stringify(s0), snapshot);   // the first state was never touched
   });

   await check('a gate can be unlocked from the room on its other side only through an open doorway', () => {
      const L = level([room('r0', E | W), room('r1', W, { gate: { side: 3, colour: 'blue' } })], row);
      const s = R.startState(L); s.keys = ['blue']; s.mini = 'r0';
      assert.equal(R.apply(L, s, { by: 'mini', unlock: 'r1' }).state.unlocked[0], 'r1');
      // From the entrance, r1 is not across the gate: wrong place.
      const e = R.startState(L); e.keys = ['blue'];
      assert.equal(typeof R.apply(L, e, { by: 'mini', unlock: 'r1' }).error, 'string');
      // With the wrong colour of key.
      const w = R.startState(L); w.keys = ['red']; w.mini = 'r0';
      assert.equal(typeof R.apply(L, w, { by: 'mini', unlock: 'r1' }).error, 'string');
      // The neighbour has no door facing the gate: the mini cannot reach across.
      const n = R.startState(L); n.keys = ['blue']; n.mini = 'r0'; n.at.r0.rot = 1;
      assert.equal(typeof R.apply(L, n, { by: 'mini', unlock: 'r1' }).error, 'string');
      // A gate in the west doorway of the room beside the entrance is unlocked from the entrance.
      const d = R.startState(L); d.keys = ['blue']; d.at.r1 = { slot: 'c3', rot: 0 };
      assert.equal(R.apply(L, d, { by: 'mini', unlock: 'r1' }).state.unlocked[0], 'r1');
      // Inside the gated room itself it works, and a second key is not used up.
      const i = R.startState(L); i.keys = ['red', 'blue']; i.mini = 'r1';
      assert.deepEqual(R.apply(L, i, { by: 'mini', unlock: 'r1' }).state.keys, ['red']);
   });

   await check('the mini carries at most two keys', () => {
      const L = level([room('r0', E | W, { key: 'red' })], row), s = R.startState(L);
      s.mini = 'r0'; s.keys = ['red', 'blue'];
      assert.equal(typeof R.apply(L, s, { by: 'mini', take: 'r0' }).error, 'string');
   });

   await check('the same seed makes the same level', () => assert.deepEqual(G.generate(7), G.generate(7)));

   await check('1000 seeds: each level is valid, its plan wins, and the goal is not reachable at the start', () => {
      const t0 = Date.now();
      for (let s = 1; s <= 1000; s++) {
         const { level, plan } = G.generate(s);
         assert.ok(G.validate(level, plan).ok, 'seed ' + s);
         assert.ok(!R.reachable(level, R.startState(level)).has(level.goal));
         assert.equal(Object.keys(level.start).filter(k => level.start[k].slot.startsWith('c')).length, 7);
         assert.equal(new Set(Object.values(level.start).map(v => v.slot)).size, Object.keys(level.start).length);
         assert.equal(level.rooms.filter(r => r.symbol === level.goalSymbol).length, 1);
         assert.equal(level.rooms.find(r => r.symbol === level.goalSymbol).id, level.goal);
         assert.equal(level.rooms.filter(r => r.chest).length, 3);
         assert.ok(level.rooms.find(r => r.id === level.goal).chest);
         assert.ok(level.rooms.every(r => r.symbol && r.doors > 0 && (!r.gate || r.doors >> r.gate.side & 1)));
         for (const r of level.rooms.filter(r => r.anchor)) assert.ok(level.rooms.some(q => q.switch === r.anchor));
      }
      const ms = Date.now() - t0;
      console.log('   1000 seeds in ' + ms + ' ms');
      assert.ok(ms < 10000, 'too slow: ' + ms + ' ms');
   });

   // Does the plan have the giant turn a room the mini is standing in?
   const turnsWithMini = (level, plan) => {
      let state = R.startState(level), found = false;
      for (const a of plan) {
         if (a.place && state.mini === a.place) found = true;
         state = R.apply(level, state, a).state;
      }
      return found;
   };

   await check('across 200 seeds every mechanism appears: gates, anchors, turntables', () => {
      let gates = 0, anchors = 0, turntables = 0;
      for (let s = 1; s <= 200; s++) {
         const { level, plan } = G.generate(s);
         if (level.rooms.some(r => r.gate)) gates++;
         if (level.rooms.some(r => r.anchor)) anchors++;
         if (turnsWithMini(level, plan)) turntables++;
      }
      console.log(`   of 200 seeds: ${gates} with a gate, ${anchors} with an anchor, ${turntables} with a turntable`);
      assert.ok(gates > 20 && anchors > 20 && turntables > 20);
   });

   await check('options are honoured: no mechanisms, and an exact count of empty chests', () => {
      for (let s = 1; s <= 50; s++) {
         const { level, plan } = G.generate(s, { gates: 0, anchors: 0, turntable: 0, emptyChests: 3, pathMin: 4, pathMax: 4 });
         assert.ok(G.validate(level, plan).ok);
         assert.ok(level.rooms.every(r => !r.gate && !r.anchor && !r.switch && !r.key));
         assert.equal(level.rooms.filter(r => r.chest).length, 4);
         assert.ok(!turnsWithMini(level, plan));
      }
   });

   await check('validate rejects a plan with a step out of order', () => {
      let s = 1;
      while (!G.generate(s).level.rooms.some(r => r.gate)) s++;
      const { level, plan } = G.generate(s);
      assert.ok(G.validate(level, plan).ok);
      const bad = plan.slice(), u = bad.findIndex(a => 'unlock' in a), t = bad.findIndex(a => 'take' in a);
      assert.ok(t >= 0 && t < u);
      bad.splice(t, 0, bad.splice(u, 1)[0]);   // the unlock now comes before the first take
      const r = G.validate(level, bad);
      assert.equal(r.ok, false); assert.equal(typeof r.error, 'string');
      assert.equal(G.validate(level, plan.slice(0, -1)).ok, false);   // without the final open
   });

   // The room, the board and the symbols, with fake nodes that remember how they were placed.
   const P = await load('js/scenes/miniature/physics.js');
   const Rm = await load('js/scenes/doorways/rooms.js');
   const B = await load('js/scenes/doorways/board.js');
   const { U, CELL, ROOM, SPOTS } = R;
   const made = [];
   const fake = form => {
      const n = { form, s: null, c: null };
      const self = () => n;
      Object.assign(n, { add: f => fake(f), identity: () => (n.s = null, n.m = null, n), move: (...a) => (n.m = a, n), turnX: self, turnY: self, turnZ: self, dull: self, opacity: self,
                         view: self, txtr: self, setTxtr: self, scale: (...a) => (n.s = a.length === 1 ? [a[0], a[0], a[0]] : a, n), color: (...c) => (n.c = c.flat(), n) });
      made.push(n);
      return n;
   };
   const shown = () => made.filter(n => n.s && n.s.some(v => v !== 0));
   const mk = (r, opts) => { made.length = 0; return Rm.createRoom(fake('room'), r, opts); };
   const state = (extra = {}) => ({ taken: [], unlocked: [], pressed: [], opened: [], ...extra });
   const H = CELL / 2;
   const feetAt = (x, z) => [x, ROOM.FLOOR, z];
   const furnished = () => room('f', N | E, { key: 'red', switch: 'blue', chest: true, anchor: 'blue' });

   await check('a room: the floor is a slab, doorways are open, the walls beside them and the lintels above stop the mini', () => {
      const v = mk(room('a', N | E)), boxes = v.colliders(state());
      nearV(v.floor.min, [-H, 0, -H]); nearV(v.floor.max, [H, ROOM.FLOOR, H]);
      near(P.ground(boxes, [0, 0, 0]), ROOM.FLOOR);
      assert.ok(!P.blocked(boxes, feetAt(0, 0)));
      assert.ok(!P.blocked(boxes, feetAt(0, -H + ROOM.T / 2)), 'the middle of the north doorway');
      assert.ok(!P.blocked(boxes, feetAt(H - ROOM.T / 2, 0)), 'the middle of the east doorway');
      assert.ok(P.blocked(boxes, feetAt(0, H - ROOM.T / 2)), 'the south wall');
      assert.ok(P.blocked(boxes, feetAt(-H + ROOM.T / 2, 0)), 'the west wall');
      assert.ok(P.blocked(boxes, feetAt(ROOM.DOOR_W / 2 + .3 * U, -H + ROOM.T / 2)), 'the wall beside the doorway');
      assert.ok(!P.blocked(boxes, feetAt(ROOM.DOOR_W / 2 - .3 * U, -H + ROOM.T / 2)), 'the doorway is DOOR_W wide');
      const lintel = boxes.find(b => b.min[1] > ROOM.FLOOR && b.min[0] < 0 && b.max[0] > 0 && b.min[2] < -H + ROOM.T / 2);
      near(lintel.min[1], ROOM.FLOOR + ROOM.DOOR_H); near(lintel.max[1], ROOM.WALL);
      assert.ok(boxes.every(b => b.max[1] <= ROOM.WALL + 1e-9), 'no roof collider');
   });

   await check('a locked gate blocks its doorway until the room is in state.unlocked', () => {
      const r = room('g', N | S, { gate: { side: 0, colour: 'red' } }), v = mk(r), door = feetAt(0, -H + ROOM.T / 2);
      assert.ok(P.blocked(v.colliders(state()), door));
      assert.ok(!P.blocked(v.colliders(state()), feetAt(0, H - ROOM.T / 2)), 'the other doorway is open');
      assert.ok(!P.blocked(v.colliders(state({ unlocked: ['g'] })), door));
      assert.ok(P.blocked(v.colliders(state({ unlocked: ['other'] })), door));
   });

   await check('things: a key, a switch, a chest and a gate until used, at their spots', () => {
      const r = furnished(); r.gate = { side: 1, colour: 'blue' };
      const v = mk(r), at = (s, w) => s.things.find(t => t.what === w);
      const all = v.things(state());
      assert.deepEqual(all.map(t => t.what).sort(), ['chest', 'gate', 'key', 'switch']);
      const [kx, kz] = SPOTS.key, [sx, sz] = SPOTS.switch, [cx, cz] = SPOTS.chest;
      nearV([at({ things: all }, 'key').at[0], at({ things: all }, 'key').at[2]], [kx, kz]);
      nearV([at({ things: all }, 'switch').at[0], at({ things: all }, 'switch').at[2]], [sx, sz]);
      nearV([at({ things: all }, 'chest').at[0], at({ things: all }, 'chest').at[2]], [cx, cz]);
      nearV(at({ things: all }, 'gate').at, [H - ROOM.T / 2, ROOM.FLOOR + ROOM.DOOR_H / 2, 0]);
      near(at({ things: all }, 'gate').size, .5 * U);
      for (const t of all) assert.ok(t.at[1] > ROOM.FLOOR && t.size > 0);
      const names = s => v.things(s).map(t => t.what);
      assert.ok(!names(state({ taken: ['f'] })).includes('key'));
      assert.ok(!names(state({ pressed: ['blue'] })).includes('switch'));
      assert.ok(names(state({ pressed: ['red'] })).includes('switch'), 'a switch of the other colour stays');
      assert.ok(!names(state({ opened: ['f'] })).includes('chest'));
      assert.ok(!names(state({ unlocked: ['f'] })).includes('gate'));
      assert.ok(names(state({ taken: ['x'], opened: ['x'] })).includes('key'), 'other rooms do not count');
      assert.deepEqual(mk(room('e', N)).things(state()), []);
   });

   await check('choose: the nearest thing in reach, else the first the ray meets, else nothing', () => {
      const ch = Rm.choose, reach = .6 * U, point = 2.5 * U;
      const key = { what: 'key', at: [0, .1, 0], size: .02 }, chest = { what: 'chest', at: [.03, .1, 0], size: .02 };
      const dive = (x, z) => ({ o: [x, .1, z], d: [0, 0, -1] });   // a ray running north from (x, z)
      // In reach, the nearer wins, whatever the order, and the ray does not matter.
      assert.equal(ch({ p: [.01, .1, 0], ray: dive(5, 5) }, [chest, key]), 'key');
      assert.equal(ch({ p: [.02, .1, 0], ray: dive(5, 5) }, [key, chest]), 'chest');
      // Out of reach the ray decides: it passes through the chest's box and not the key's.
      const far = [0, .1, reach + .05];
      assert.equal(ch({ p: far, ray: dive(.03, far[2]) }, [key, chest]), 'chest');
      // Through both boxes the nearer to the hand is the first it meets.
      const behind = { what: 'switch', at: [.03, .1, -.1], size: .02 };
      assert.equal(ch({ p: far, ray: dive(.03, far[2]) }, [behind, chest]), 'chest');
      assert.equal(ch({ p: far, ray: dive(.03, far[2]) }, [chest, behind]), 'chest');
      // A box farther along the ray than 2.5 U is not pointed at.
      assert.equal(ch({ p: far, ray: dive(.03, .02 + point - .001) }, [chest]), 'chest');
      assert.equal(ch({ p: far, ray: dive(.03, .02 + point + .01) }, [chest]), null);
      assert.equal(ch({ p: far, ray: dive(.5, far[2]) }, [key, chest]), null);
      assert.equal(ch({ p: [0, 0, 0], ray: dive(0, 1) }, []), null);
   });

   const same = (a, b) => a && b && a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) < 1e-9);
   const coloured = c => shown().filter(n => same(n.c, c));
   const scales = () => made.map(n => JSON.stringify(n.s));

   await check('the room as drawn: the roof, the stake, the key, the switch, the chest and the gold follow the state', () => {
      const r = room('f', N | E, { key: 'red', switch: 'red', chest: true, anchor: 'blue' });
      const v = mk(r, { goal: true }), draw = (s, o) => v.update(s, o), red = Rm.PALETTE.red;
      draw(state());
      assert.ok(coloured(Rm.PALETTE.roof).length === 1);
      assert.ok(coloured(Rm.PALETTE.blue).length > 0, 'the stake');
      assert.equal(coloured(Rm.PALETTE.gold).length, 0, 'no gold in a closed chest');
      const keyNodes = coloured(red).length;
      // The roof is hidden only when roofed is false, and comes back.
      draw(state(), { roofed: false }); assert.equal(coloured(Rm.PALETTE.roof).length, 0);
      draw(state()); assert.equal(coloured(Rm.PALETTE.roof).length, 1);
      // The stake stands until its colour is pressed.
      draw(state({ pressed: ['blue'] })); assert.equal(coloured(Rm.PALETTE.blue).length, 0);
      // The key vanishes once taken; the switch button moves when pressed; the chest lid moves and shows gold when opened.
      draw(state({ taken: ['f'] })); assert.ok(coloured(red).length < keyNodes);
      draw(state()); const before = scales();
      draw(state({ pressed: ['red'] })); assert.notDeepEqual(scales(), before, 'the button goes down');
      draw(state()); draw(state({ opened: ['f'] })); assert.ok(coloured(Rm.PALETTE.gold).length > 0, 'gold in the goal chest');
      const plain = mk(r); plain.update(state({ opened: ['f'] })); assert.equal(coloured(Rm.PALETTE.gold).length, 0, 'an ordinary chest is empty');
   });

   await check('a gate shows its colour inside and grey outside while locked, and swings aside once unlocked', () => {
      const v = mk(room('g', N | E, { gate: { side: 1, colour: 'blue' } }));
      v.update(state());
      assert.equal(coloured(Rm.PALETTE.blue).length, 1);
      assert.equal(coloured(Rm.PALETTE.grey).length, 1);
      const before = scales();
      v.update(state({ unlocked: ['g'] }));
      assert.notDeepEqual(scales(), before);
      assert.equal(coloured(Rm.PALETTE.blue).length, 1, 'still drawn, open');
   });

   await check('an open gate stays clear of the key, the switch and its pedestal, and the chest, on every side', () => {
      const overlap = (a, b) => [0, 1, 2].every(i => a.m[i] - a.s[i] < b.m[i] + b.s[i] - 1e-9 && b.m[i] - b.s[i] < a.m[i] + a.s[i] - 1e-9);
      for (let side = 0; side < 4; side++) {
         const v = mk(room('g', N | E | S | W, { key: 'red', switch: 'red', chest: true, gate: { side, colour: 'blue' } }));
         v.update(state({ unlocked: ['g'] }));
         const placed = shown().filter(n => n.m && n.form !== 'square');
         const leaves = placed.filter(n => same(n.c, Rm.PALETTE.blue) || same(n.c, Rm.PALETTE.grey));
         const room_ = [Rm.PALETTE.wall, Rm.PALETTE.floor, Rm.PALETTE.roof, Rm.PALETTE.blue, Rm.PALETTE.grey];
         const items = placed.filter(n => !room_.some(c => same(n.c, c)));
         assert.equal(leaves.length, 2); assert.ok(items.length === 7);
         for (const l of leaves) {
            for (const i of items) assert.ok(!overlap(l, i), `side ${side}: a leaf meets ${i.form} ${i.c}`);
            // Inside the cell (x and z), not reaching into the next wall.
            assert.ok([0, 2].every(a => Math.abs(l.m[a]) + l.s[a] <= H + 1e-9), `side ${side}: inside the cell`);
         }
         assert.ok(!P.blocked(v.colliders(state({ unlocked: ['g'] })), feetAt(...[[0, -H + ROOM.T / 2], [H - ROOM.T / 2, 0], [0, H - ROOM.T / 2], [-H + ROOM.T / 2, 0]][side])));
      }
   });

   await check('the stake leaves with the roof', () => {
      const v = mk(room('s', N, { anchor: 'blue' })), blue = () => coloured(Rm.PALETTE.blue).length;
      v.update(state()); assert.ok(blue() > 0);
      v.update(state(), { roofed: false }); assert.equal(blue(), 0);
      v.update(state()); assert.ok(blue() > 0);
   });

   await check('the rug: the scene textures it with the room symbol, and without a scene it is a plain square', () => {
      const calls = [];
      mk(room('m', N, { symbol: 'star' }), { rug: (node, symbol) => calls.push([node.form, symbol]) });
      assert.deepEqual(calls, [['square', 'star']]);
      mk(room('m', N));
      assert.equal(made.filter(n => n.form === 'square').length, 1);
   });

   await check('the entrance hall: a half cell of floor, walls on N, S and W, open on E, no roof', () => {
      made.length = 0;
      const b = B.createBoard(fake('board')), e = b.entrance, c = R.slotCentre('entrance');
      nearV(e.floor.min, [c[0] - CELL / 4, 0, -CELL / 2]); nearV(e.floor.max, [c[0] + CELL / 4, ROOM.FLOOR, CELL / 2]);
      const feet = (dx, dz) => [c[0] + dx, ROOM.FLOOR, c[2] + dz], T = ROOM.T;
      near(P.ground(e.colliders, [c[0], 0, 0]), ROOM.FLOOR);
      assert.ok(!P.blocked(e.colliders, feet(0, 0)));
      assert.ok(P.blocked(e.colliders, feet(0, -CELL / 2 + T / 2)), 'north');
      assert.ok(P.blocked(e.colliders, feet(0, CELL / 2 - T / 2)), 'south');
      assert.ok(P.blocked(e.colliders, feet(-CELL / 4 + T / 2, 0)), 'west');
      assert.ok(!P.blocked(e.colliders, feet(CELL / 4 - T / 2, 0)), 'east is open');
      assert.ok(!P.blocked(e.colliders, feet(CELL / 4 + .01, 0)), 'and so is the way out');
      assert.ok(e.colliders.every(b => b.max[1] <= ROOM.WALL + 1e-9), 'no roof');
      assert.equal(typeof b.update, 'function'); b.update();
      assert.ok(made.length > 10);
   });

   await check('the symbols: each of the six draws something, and a texture is made once per symbol', async () => {
      const calls = [];
      const g2 = new Proxy({}, { get: (_, k) => (...a) => (calls.push(k), g2) });
      // A G2 that only remembers it was asked to paint; every drawing call is a chainable no-op.
      const fakeG2 = `export function G2() { const canvas = {}, self = new Proxy({ getCanvas: () => canvas, update: () => self.render() }, { get: (t, k) => k in t ? t[k] : () => self }); return self; }`;
      const Sy = await load('js/scenes/doorways/symbols.js', { '../../util/g2.js': 'data:text/javascript,' + encodeURIComponent(fakeG2) });
      for (const name of R.SYMBOLS) { calls.length = 0; Sy.drawSymbol(g2, name, 0, 0, .5); assert.ok(calls.some(k => k.startsWith('fill') || k === 'line'), name); }
      const node = () => { const n = { setTxtr: (c, flag) => (n.set = [c, flag], n._txtr = 9, n), txtr: u => (n.unit = u, n) }; return n; };
      const cache = new Map(), a = node(), b = node();
      Sy.symbolTexture(a, 'moon', cache);
      assert.equal(a.set[1], true); assert.equal(cache.get('moon'), 9);
      Sy.symbolTexture(b, 'moon', cache);
      assert.equal(b.set, undefined); assert.equal(b.unit, 9);
      const c = node(); Sy.symbolTexture(c, 'sun', cache); assert.ok(c.set);
      // With a list to own them, each new texture is noted (channel, GL texture, canvas) once, to be released on leaving.
      const bound = { TEXTURE0: 100, TEXTURE_BINDING_2D: 7 }, active = [];
      globalThis.window = { clay: { gl: { ...bound, activeTexture: u => active.push(u), getParameter: p => p === 7 ? 'tex-' + active.length : null } } };
      try {
         const owned = [], own = new Map();
         Sy.symbolTexture(node(), 'moon', own, owned); Sy.symbolTexture(node(), 'moon', own, owned); Sy.symbolTexture(node(), 'sun', own, owned);
         assert.equal(owned.length, 2, 'once per symbol');
         assert.deepEqual(owned.map(t => [t.channel, t.texture]), [[9, 'tex-1'], [9, 'tex-2']]);
         assert.deepEqual(active, [109, 109]); assert.ok(owned.every(t => t.canvas));
      } finally { delete globalThis.window; }
   });

   // Walking among the rooms: real room colliders taken to the table frame. r0 (c3, doors E and W) and r1 (c4, doors W
   // and N) are neighbours with facing doors; r1's north doorway faces the empty cell c1; r0's west door faces the entrance.
   const Wk = await load('js/scenes/doorways/walk.js');
   const shelf = { r0: { slot: 'c3', rot: 0 }, r1: { slot: 'c4', rot: 0 }, r3: { slot: 'd0', rot: 0 } };
   const world = () => {
      const boxes = [], floors = [], hall = B.createBoard(fake('board')).entrance;
      for (const [r, doors] of [['r0', E | W], ['r1', W | N]]) {
         const v = mk(room(r, doors)), pose = R.slotPose(shelf[r].slot, shelf[r].rot);
         boxes.push(...Wk.toTable(v.colliders(state()), pose)); floors.push(...Wk.toTable([v.floor], pose));
      }
      return { boxes: [...boxes, ...hall.colliders], floors: [...floors, hall.floor] };
   };
   // Walk from feet in steps of (dx, dz) until n steps are taken; collect whether any was blocked.
   const stroll = (w, feet, dx, dz, n) => {
      let any = false;
      for (let i = 0; i < n; i++) { const r = Wk.walk(w.boxes, w.floors, feet, dx, dz); feet = r.feet; any = any || r.blocked; }
      return { feet, blocked: any };
   };

   await check('toTable: a box turned a quarter swaps its extents about the room centre, and a plain pose only moves it', () => {
      const box = { min: [-.1, 0, -.05], max: [.1, .02, .05] };
      const [t] = Wk.toTable([box], R.slotPose('c0', 1)), c = R.slotCentre('c0');
      nearV(t.min, [c[0] - .05, 0, c[2] - .1]); nearV(t.max, [c[0] + .05, .02, c[2] + .1]);
      const [u] = Wk.toTable([box], R.slotPose('c8', 0)), d = R.slotCentre('c8');
      nearV(u.min, [d[0] - .1, 0, d[2] - .05]); nearV(u.max, [d[0] + .1, .02, d[2] + .05]);
      const [v] = Wk.toTable([{ min: [0, 0, 0], max: [.1, .02, .05] }], R.slotPose('c4', 2));   // a half turn flips it
      nearV(v.min, [-.1, 0, -.05]); nearV(v.max, [0, .02, 0]);
      assert.deepEqual(Wk.toTable([], R.slotPose('c0', 0)), []);
   });

   await check('walk: through the facing doorways from one room into the next, and out to the entrance, never blocked', () => {
      const w = world(), c3 = R.slotCentre('c3'), c4 = R.slotCentre('c4'), e = R.slotCentre('entrance');
      const into = stroll(w, [c3[0], ROOM.FLOOR, 0], .01, 0, 18);   // from the middle of c3 to the middle of c4
      assert.equal(into.blocked, false);
      near(into.feet[0], c4[0], 1e-6); near(into.feet[2], 0);
      assert.equal(Wk.roomAt(shelf, into.feet), 'r1');
      near(into.feet[1], ROOM.FLOOR);
      const out = stroll(w, [c3[0], ROOM.FLOOR, 0], -.01, 0, 14);   // west through r0's west door into the hall
      assert.equal(out.blocked, false);
      assert.equal(Wk.roomAt(shelf, out.feet), 'entrance');
      assert.ok(out.feet[0] < e[0] + CELL / 4);
   });

   await check('walk: out of a doorway that faces an empty cell stops at the floor edge and reports blocked', () => {
      const w = world(), c4 = R.slotCentre('c4'), edge = c4[2] - H;
      const r = stroll(w, [c4[0], ROOM.FLOOR, 0], 0, -.01, 20);
      assert.equal(r.blocked, true);
      assert.ok(r.feet[2] >= edge - 1e-9 && r.feet[2] < edge + .011, `stopped at ${r.feet[2]}`);
      assert.equal(Wk.roomAt(shelf, r.feet), 'r1');
      // Pushed further it stays put, and does not fall into the water.
      const again = Wk.walk(w.boxes, w.floors, r.feet, 0, -.01);
      assert.deepEqual(again, { feet: r.feet, blocked: true });
      // A diagonal out through the doorway leaves the floor in z only: it slides along the edge.
      const corner = [c4[0], ROOM.FLOOR, edge + .004];
      const slide = Wk.walk(w.boxes, w.floors, corner, .01, -.01);
      assert.equal(slide.blocked, true); near(slide.feet[0], corner[0] + .01); near(slide.feet[2], corner[2]);
   });

   await check('walk: into a wall slides along it, and the feet never leave a floor', () => {
      const w = world(), c3 = R.slotCentre('c3'), south = [c3[0], ROOM.FLOOR, H - ROOM.T - .03];
      const r = Wk.walk(w.boxes, w.floors, south, .01, .01);   // the south wall of r0 is ahead
      assert.equal(r.blocked, true);
      near(r.feet[0], south[0] + .01); near(r.feet[2], south[2]);
      // Into the west wall of r1 (beside its west doorway), diagonally: slides north.
      const c4 = R.slotCentre('c4'), west = [c4[0] - H + ROOM.T + .03, ROOM.FLOOR, c4[2] + .05];
      const s = Wk.walk(w.boxes, w.floors, west, -.01, -.01);
      assert.equal(s.blocked, true); near(s.feet[0], west[0]); near(s.feet[2], west[2] - .01);
      // A free step is taken whole and is not blocked.
      const f = Wk.walk(w.boxes, w.floors, [c3[0], ROOM.FLOOR, 0], .01, .005);
      assert.equal(f.blocked, false); near(f.feet[0], c3[0] + .01); near(f.feet[2], .005);
      // Starting off every floor (in the water), no step is taken.
      const wet = Wk.walk(w.boxes, w.floors, [.3, 0, .3], .01, 0);
      assert.deepEqual(wet, { feet: [.3, 0, .3], blocked: true });
   });

   await check('a mini in a depot room can walk about its floor and no further', () => {
      const v = mk(room('r3', E | N)), pose = R.slotPose('d0', 0), c = R.slotCentre('d0');
      const w = { boxes: Wk.toTable(v.colliders(state()), pose), floors: Wk.toTable([v.floor], pose) };
      const start = [c[0], ROOM.FLOOR, c[2]], r = Wk.walk(w.boxes, w.floors, start, .01, .01);
      assert.ok(r.feet[0] > start[0] && r.feet[2] > start[2] && !r.blocked, 'a step inside the room is taken');
      assert.equal(Wk.roomAt(shelf, r.feet), 'r3');
      // West has a wall (the room has doors N and E only): the walk stops at it and stays on the floor.
      const west = stroll(w, start, -.01, 0, 20);
      assert.ok(west.blocked && Wk.roomAt(shelf, west.feet) === 'r3' && west.feet[0] > c[0] - CELL / 2, 'stopped by the wall, still in the room');
      // East has a doorway, but beyond it is the table's edge water: the feet stay over the floor.
      const east = stroll(w, start, .01, 0, 30);
      assert.ok(Wk.roomAt(shelf, east.feet) === 'r3' && east.feet[0] <= c[0] + CELL / 2 + 1e-9, 'the doorway does not lead off the floor');
   });

   await check('roomAt: the room under the point by its slot, the entrance, else null; a shared edge goes to the lower index', () => {
      const at = (x, z) => [x, 0, z], c = R.slotCentre, e = c('entrance');
      assert.equal(Wk.roomAt(shelf, c('c3')), 'r0');
      assert.equal(Wk.roomAt(shelf, c('c4')), 'r1');
      assert.equal(Wk.roomAt(shelf, c('c5')), null, 'an empty cell');
      assert.equal(Wk.roomAt(shelf, c('d0')), 'r3', 'a room in the depot is under its pad');
      assert.equal(Wk.roomAt(shelf, c('d1')), null, 'an empty depot slot');
      assert.equal(Wk.roomAt({ ...shelf, r2: { slot: 'd1', rot: 1 } }, c('d1')), 'r2');
      assert.equal(Wk.roomAt(shelf, [c('d0')[0], 0, c('d1')[2]]), null, 'the pads do not overlap: d1 is not under d0');
      assert.equal(Wk.roomAt(shelf, e), 'entrance');
      assert.equal(Wk.roomAt(shelf, at(5, 5)), null);
      // c3 and c4 share x = -H: the lower slot, c3, wins on the line itself, and c4 just beyond it.
      assert.equal(Wk.roomAt(shelf, at(-H, 0)), 'r0');
      assert.equal(Wk.roomAt(shelf, at(-H + 1e-4, 0)), 'r1');
      assert.equal(Wk.roomAt(shelf, at(-H - 1e-4, 0)), 'r0');
      // The entrance is lower than every cell: on its shared edge with c3 it wins, even with c3 held.
      assert.equal(Wk.roomAt(shelf, at(e[0] + CELL / 4, 0)), 'entrance');
      assert.equal(Wk.roomAt(shelf, at(e[0] + CELL / 4 + 1e-4, 0)), 'r0');
      assert.equal(Wk.roomAt(shelf, at(e[0], CELL / 2 + 1e-4)), null);
      // Rooms turned or moved: it is the slot that counts.
      assert.equal(Wk.roomAt({ ...shelf, r1: { slot: 'c8', rot: 3 } }, c('c8')), 'r1');
      assert.equal(Wk.roomAt({ ...shelf, r1: { slot: 'c8', rot: 3 } }, c('c4')), null);
   });

   // ---- Session protocol (net.js): two or three sessions on a fake queue transport and a controllable clock.
   const Net = await load('js/scenes/doorways/net.js');
   const netWorld = (ids) => {
      const w = { t: 0, ids: [...ids], queue: [], sent: [], sessions: {}, drop: new Set() };
      ids.forEach(id => {
         w.sessions[id] = new Net.Session({ id: () => id, clients: () => w.ids, now: () => w.t,
            send: m => { w.sent.push({ id, m }); w.queue.push({ m, sender: id }); } });   // keeps the reference, as the real queue does
      });
      return w;
   };
   const netWants = {};
   const netTickAll = (w, extra = {}) => Object.keys(w.sessions).forEach(id => {
      if (w.drop.has(+id)) return;
      const o = { want: 'giant', table: null, xr: false, giant: () => ({ at: { r0: { slot: 'c3', rot: 0 } } }),
                  mini: () => ({ keys: [] }), ...(netWants[id] || {}), ...extra };
      w.sessions[id].tick(o);
   });
   const netFlush = (w) => {
      const q = w.queue; w.queue = [];
      q.forEach(({ m, sender }) => Object.keys(w.sessions).forEach(id => {
         if (+id !== sender && !w.drop.has(+id)) w.sessions[id].receive(m, sender);
      }));
   };
   const netStep = (w, ms = 50, o) => { w.t += ms; netTickAll(w, o); netFlush(w); };
   const netRun = (w, ms, o) => { for (let n = 0; n < ms / 50; n++) netStep(w, 50, o); };
   const setNetWants = (o) => Object.keys(netWants).forEach(k => delete netWants[k]) || Object.assign(netWants, o);

   await check('net: alone is solo, sends hellos but no snapshots, and is not waiting', () => {
      const w = netWorld([5]), s = w.sessions[5];
      setNetWants({});
      netRun(w, 1000);
      assert.equal(s.role, 'solo'); assert.equal(s.peer, null); assert.equal(s.waiting, false);
      assert.equal(s.round, 0); assert.equal(s.seed, null);
      assert.ok(w.sent.length > 0 && w.sent.every(x => x.m.type === 'hello' && x.m.role === 'solo'));
   });

   await check('net: two sessions get one giant and one mini; with the same want the higher id yields', () => {
      setNetWants({ 3: { want: 'giant' }, 8: { want: 'mini' } });
      let w = netWorld([3, 8]); netRun(w, 200);
      assert.equal(w.sessions[3].role, 'giant'); assert.equal(w.sessions[8].role, 'mini');
      assert.equal(w.sessions[3].peer.id, 8); assert.equal(w.sessions[3].peer.role, 'mini');
      setNetWants({ 3: { want: 'giant' }, 8: { want: 'giant' } });
      w = netWorld([3, 8]); netRun(w, 200);
      assert.equal(w.sessions[3].role, 'giant'); assert.equal(w.sessions[8].role, 'mini');
      setNetWants({ 3: { want: 'mini' }, 8: { want: 'mini' } });
      w = netWorld([3, 8]); netRun(w, 200);
      assert.equal(w.sessions[3].role, 'mini'); assert.equal(w.sessions[8].role, 'giant');
      setNetWants({ 3: { want: 'mini' }, 8: { want: 'giant' } });
      w = netWorld([3, 8]); netRun(w, 200);
      assert.equal(w.sessions[3].role, 'mini'); assert.equal(w.sessions[8].role, 'giant');
   });

   await check('net: newRound on one gives both the seed and the roles, and overrides the netWants', () => {
      setNetWants({ 3: { want: 'giant' }, 8: { want: 'mini' } });
      const w = netWorld([3, 8]); netRun(w, 200);
      w.sessions[3].newRound(1234, 8);
      assert.equal(w.sessions[3].round, 1); assert.equal(w.sessions[3].seed, 1234);
      assert.equal(w.sessions[3].role, 'mini', 'the sender applies it at once');
      netFlush(w);
      assert.equal(w.sessions[8].round, 1); assert.equal(w.sessions[8].seed, 1234);
      assert.equal(w.sessions[8].role, 'giant'); assert.equal(w.sessions[3].role, 'mini');
      netRun(w, 1000);
      assert.equal(w.sessions[8].role, 'giant', 'hellos do not undo it');
      const m = w.sent.filter(x => x.m.type === 'round').pop().m;
      assert.deepEqual(Object.keys(m).sort(), ['epoch', 'from', 'giant', 'round', 'seed', 'type']);
      assert.equal(m.giant, 8);
      w.sessions[8].newRound(99, 8); netFlush(w);
      assert.equal(w.sessions[3].round, 2); assert.equal(w.sessions[3].seed, 99); assert.equal(w.sessions[3].role, 'mini');
      w.sessions[3].newRound(5, 3); netFlush(w);
      assert.equal(w.sessions[8].round, 3); assert.equal(w.sessions[8].role, 'mini'); assert.equal(w.sessions[3].role, 'giant');
   });

   await check('net: a session joining late adopts the round and seed from the hello', () => {
      setNetWants({});
      const w = netWorld([3, 8]);
      w.drop.add(8);
      netRun(w, 300);
      w.sessions[3].newRound(777, 3); w.queue = [];   // the round message is lost, as to a client not yet there
      w.drop.delete(8);
      netRun(w, 600);
      assert.equal(w.sessions[8].round, 1); assert.equal(w.sessions[8].seed, 777);
      assert.equal(w.sessions[8].role, 'mini'); assert.equal(w.sessions[3].role, 'giant');
   });

   await check('net: a higher round wins; equal rounds go to the higher sender id; a lower round is ignored', () => {
      setNetWants({});
      const w = netWorld([3, 8]); netRun(w, 200);
      w.sessions[3].newRound(11, 3); w.sessions[8].newRound(22, 3);   // both make round 1 at once
      netFlush(w);
      assert.equal(w.sessions[3].round, 1); assert.equal(w.sessions[8].round, 1);
      assert.equal(w.sessions[3].seed, 22); assert.equal(w.sessions[8].seed, 22);
      w.sessions[3].receive({ type: 'round', from: 8, epoch: w.sessions[8].epoch, round: 0, seed: 5, giant: 8 }, 8);
      assert.equal(w.sessions[3].seed, 22);
      w.sessions[3].newRound(33, 8); netFlush(w);
      assert.equal(w.sessions[8].round, 2); assert.equal(w.sessions[8].seed, 33);
      // A new round after the peer's higher one numbers above it, even if the local one was never told.
      w.sessions[3].receive({ type: 'hello', from: 8, epoch: w.sessions[8].epoch, round: 7, seed: 1, giant: 3, want: 'mini',
                              role: 'mini', table: null, xr: false }, 8);
      assert.equal(w.sessions[3].round, 7);
      w.sessions[3].newRound(2, 3); assert.equal(w.sessions[3].round, 8);
   });

   await check('net: ticks every 13.9 ms (72 fps) still send 20 snapshots and 2 hellos a second, not the 18 Hz of a frame-rounded timer', () => {
      setNetWants({ 3: { want: 'giant' }, 8: { want: 'mini' } });
      const w = netWorld([3, 8]);
      for (let n = 0; n < 144; n++) { w.t += 1000 / 72; netTickAll(w); netFlush(w); }   // two seconds of frames
      const count = (id, type) => w.sent.filter(x => x.id === id && x.m.type === type).length;
      assert.ok(Math.abs(count(3, 'giant') - 40) <= 1, `giant ${count(3, 'giant')}`);
      assert.ok(Math.abs(count(8, 'mini') - 40) <= 1, `mini ${count(8, 'mini')}`);
      assert.ok(Math.abs(count(3, 'hello') - 4) <= 1, `hello ${count(3, 'hello')}`);
      // A page that stalls for 2 s sends one snapshot, not a burst to catch up, and then goes on at the same rate.
      const before = count(3, 'giant');
      w.t += 2000; netTickAll(w); netFlush(w);
      assert.equal(count(3, 'giant') - before, 1);
      for (let n = 0; n < 72; n++) { w.t += 1000 / 72; netTickAll(w); netFlush(w); }
      assert.ok(Math.abs(count(3, 'giant') - before - 21) <= 1, `after the stall ${count(3, 'giant') - before}`);
   });

   await check('net: hello and snapshot rates, message shapes, and a deep copy before send', () => {
      setNetWants({ 3: { want: 'giant', table: Array(16).fill(0).map((_, i) => i % 5 ? 0 : 1), xr: true }, 8: { want: 'mini' } });
      const w = netWorld([3, 8]);
      const snap = { at: { r0: { slot: 'c3', rot: 0 } }, held: null };
      netRun(w, 200, { giant: () => snap });
      snap.at.r0.slot = 'MUTATED';
      assert.equal(w.sent.filter(x => x.id === 3 && x.m.type === 'giant').pop().m.at.r0.slot, 'c3', 'the sent message is a copy');
      snap.at.r0.slot = 'c3';
      w.sent.length = 0;
      for (let n = 1; n <= 40; n++) { w.t += 25; netTickAll(w); netFlush(w); }   // one second at 25 ms ticks
      const count = (id, type) => w.sent.filter(x => x.id === id && x.m.type === type).length;
      assert.ok(count(3, 'hello') >= 2 && count(3, 'hello') <= 3, `hello ${count(3, 'hello')}`);
      assert.ok(count(3, 'giant') >= 19 && count(3, 'giant') <= 21, `giant ${count(3, 'giant')}`);
      assert.ok(count(8, 'mini') >= 19 && count(8, 'mini') <= 21);
      assert.equal(count(3, 'mini'), 0); assert.equal(count(8, 'giant'), 0);
      const hello = w.sent.find(x => x.id === 3 && x.m.type === 'hello').m;
      assert.deepEqual(Object.keys(hello).sort(), ['epoch', 'from', 'giant', 'role', 'round', 'seed', 'table', 'type', 'want', 'xr']);
      assert.equal(hello.from, 3); assert.equal(hello.role, 'giant'); assert.equal(hello.xr, true); assert.equal(hello.table.length, 16);
      const g = w.sent.filter(x => x.id === 3 && x.m.type === 'giant').map(x => x.m);
      assert.equal(g[0].from, 3); assert.equal(typeof g[0].epoch, 'string'); assert.ok(g.every((m, i) => i === 0 || m.seq > g[i - 1].seq));
      assert.ok(g[0].at && g[0].at.r0);
      assert.equal(w.sessions[8].latest.giant.at.r0.slot, 'c3');
      assert.equal(w.sessions[3].epoch === w.sessions[8].epoch, false);
   });

   await check('net: latest keeps the newest snapshot of the peer epoch; older seq, other epochs, third clients, malformed are ignored', () => {
      setNetWants({ 3: { want: 'giant' }, 8: { want: 'mini' } });
      const w = netWorld([3, 8, 9]);
      w.drop.add(9);
      netRun(w, 300);
      const a = w.sessions[8], ep = w.sessions[3].epoch;
      assert.equal(a.peer.id, 3);
      assert.ok(a.latest.giant && a.latest.mini === null);
      const top = a.latest.giant.seq;
      a.receive({ type: 'giant', from: 3, epoch: ep, seq: top + 10, round: 0, at: { x: 1 } }, 3);
      assert.equal(a.latest.giant.seq, top + 10);
      a.receive({ type: 'giant', from: 3, epoch: ep, seq: top + 5, round: 0, at: { x: 2 } }, 3);
      assert.equal(a.latest.giant.at.x, 1, 'older seq');
      a.receive({ type: 'giant', from: 3, epoch: 'other', seq: top + 99, round: 0, at: { x: 3 } }, 3);
      assert.equal(a.latest.giant.at.x, 1, 'other epoch');
      w.drop.delete(9);
      a.receive({ type: 'hello', from: 9, epoch: 'e9', round: 50, seed: 1, giant: 9, want: 'giant', role: 'giant', table: null, xr: false }, 9);
      a.receive({ type: 'giant', from: 9, epoch: 'e9', seq: 1e6, round: 0, at: { x: 4 } }, 9);
      a.receive({ type: 'round', from: 9, epoch: 'e9', round: 60, seed: 1, giant: 9 }, 9);
      assert.equal(a.peer.id, 3, 'a live peer is not replaced'); assert.equal(a.latest.giant.at.x, 1); assert.equal(a.round, 0);
      // The mini snapshot of the right role lands in its own slot.
      a.receive({ type: 'mini', from: 3, epoch: ep, seq: 1, round: 0, keys: ['k'] }, 3);
      assert.deepEqual(a.latest.mini.keys, ['k']);
      const before = JSON.stringify([a.latest, a.peer, a.round, a.role]);
      const bad = [{ type: '__proto__', from: 3, epoch: ep, seq: 1e9, round: 0 }, { type: 'constructor', from: 3, epoch: ep, seq: 1e9, round: 0 },
         { type: 'toString', from: 3, epoch: ep, seq: 1e9, round: 0 }, { type: 'giant', from: 3, epoch: ep, seq: 1e9 },
         { type: 'giant', from: 3, epoch: ep, seq: 1e9, round: 5 },
         { type: 'giant', from: 3, epoch: ep, seq: 1e9, round: 'x' },
         null, undefined, 5, 'giant', [], {}, { type: 'nope', from: 3, epoch: ep }, { type: 'giant', from: 3 },
         { type: 'giant', from: 3, epoch: ep, seq: 'x', round: 0 }, { type: 'giant', from: 3, epoch: ep },
         { type: 'giant', from: 3, epoch: 7, seq: 1e9, round: 0 }, { type: 'hello', from: 3, epoch: ep, round: 'x' },
         { type: 'hello', from: 3, epoch: ep, round: 1.5, seed: 1, giant: 3, want: 'mini', role: 'giant', table: null, xr: false },
         { type: 'hello', from: 3, epoch: ep, round: 1, seed: 1, giant: 3, want: 'banana', role: 'giant', table: null, xr: false },
         { type: 'hello', from: 3, epoch: ep, round: 1, seed: 1, giant: 3, want: 'mini', role: 'giant', table: [1, 2], xr: false },
         { type: 'round', from: 3, epoch: ep, round: 'a', seed: 1, giant: 3 }, { type: 'round', from: 3, epoch: ep, round: 99 },
         { type: 'giant', from: 4, epoch: ep, seq: 1e9, round: 0 }];
      bad.forEach(m => { assert.doesNotThrow(() => a.receive(m, 3)); });
      assert.doesNotThrow(() => a.receive(null, 3)); assert.doesNotThrow(() => a.receive({ type: 'giant' }, undefined));
      assert.equal(JSON.stringify([a.latest, a.peer, a.round, a.role]).replace(/"heard":\d+/, ''), before.replace(/"heard":\d+/, ''));
      assert.equal(a.latest.giant.seq, top + 10);
   });

   await check('net: a hello from the peer with a new epoch is a reload: accepted, latest cleared', () => {
      setNetWants({ 3: { want: 'giant' }, 8: { want: 'mini' } });
      const w = netWorld([3, 8]); netRun(w, 300);
      const a = w.sessions[8];
      assert.ok(a.latest.giant);
      a.receive({ type: 'giant', from: 3, epoch: 'fresh', seq: 1, round: 0, at: {} }, 3);
      assert.ok(a.latest.giant.seq > 1 || a.latest.giant.epoch !== 'fresh', 'a snapshot of an unannounced epoch is ignored');
      a.receive({ type: 'hello', from: 3, epoch: 'fresh', round: 0, seed: null, giant: null, want: 'giant', role: 'giant', table: null, xr: false }, 3);
      assert.equal(a.peer.id, 3); assert.equal(a.peer.epoch, 'fresh'); assert.deepEqual(a.latest, { giant: null, mini: null });
      a.receive({ type: 'giant', from: 3, epoch: 'fresh', seq: 1, round: 0, at: { n: 1 } }, 3);
      assert.equal(a.latest.giant.at.n, 1);
      a.receive({ type: 'giant', from: 3, epoch: w.sessions[3].epoch, seq: 1e6, round: 0, at: { n: 2 } }, 3);
      assert.equal(a.latest.giant.at.n, 1, 'the old epoch is now stale');
   });

   await check('net: silence for 3 s sets waiting and solo, keeps latest and round, and a returning peer resumes', () => {
      setNetWants({ 3: { want: 'giant' }, 8: { want: 'mini' } });
      const w = netWorld([3, 8]); netRun(w, 300);
      w.sessions[3].newRound(42, 3); netFlush(w);
      netRun(w, 300);
      const a = w.sessions[8];
      assert.equal(a.waiting, false); assert.equal(a.role, 'mini');
      w.drop.add(3);
      netRun(w, 2900);
      assert.equal(a.waiting, false, 'under 3 s');
      assert.equal(a.role, 'mini');
      netRun(w, 150);
      assert.equal(a.waiting, true); assert.equal(a.role, 'solo');
      assert.equal(a.round, 1); assert.equal(a.seed, 42); assert.ok(a.latest.giant); assert.equal(a.peer.id, 3);
      const seq = a.latest.giant.seq;
      w.drop.delete(3);
      netRun(w, 300);
      assert.equal(a.waiting, false); assert.equal(a.role, 'mini'); assert.ok(a.latest.giant.seq > seq, 'the same epoch resumes');
      // A silent peer is replaced by a newcomer.
      const w2 = netWorld([3, 8, 9]); w2.drop.add(9); netRun(w2, 300);
      w2.drop.add(3); netRun(w2, 3200);
      assert.equal(w2.sessions[8].waiting, true);
      w2.drop.delete(9); netRun(w2, 300);
      assert.equal(w2.sessions[8].peer.id, 9, 'a newcomer replaces the silent peer');
      assert.equal(w2.sessions[8].waiting, false); assert.deepEqual(w2.sessions[8].latest.giant && w2.sessions[8].latest.giant.from === 3, false);
   });

   await check('net: snapshots carry the round; a swap clears latest and old-round or future-round snapshots are ignored', () => {
      setNetWants({ 3: { want: 'giant' }, 8: { want: 'mini' } });
      const w = netWorld([3, 8]); netRun(w, 300);
      const a = w.sessions[8], b = w.sessions[3];
      const g = w.sent.filter(x => x.id === 3 && x.m.type === 'giant').pop().m;
      assert.equal(g.round, 0);
      assert.ok(a.latest.giant && a.latest.giant.round === 0);
      // The payload cannot overwrite the protocol fields.
      const evil = new Net.Session({ id: () => 4, clients: () => [4], now: () => 0, send: m => { evil.out = m; } });
      evil.receive({ type: 'hello', from: 4, epoch: 'x', round: 0, seed: null, giant: null, want: 'mini', role: 'mini', table: null, xr: false }, 4);
      evil.known = { id: 5, want: 'mini', heard: 0, round: 0, epoch: 'y', id: 5 };
      evil.tick({ want: 'giant', giant: () => ({ type: 'x', seq: -1, round: 99, from: 0, epoch: 'z', at: {} }), mini: () => ({}) });
      assert.deepEqual([evil.out.type, evil.out.round, evil.out.from, evil.out.epoch, evil.out.seq > 0], ['giant', 0, 4, evil.epoch, true]);
      // A swap: new round with the other giant.
      const oldEpoch = b.epoch, oldSeq = a.latest.giant.seq;
      b.newRound(500, 8); netFlush(w);
      assert.equal(a.round, 1); assert.deepEqual(a.latest, { giant: null, mini: null }); assert.deepEqual(b.latest, { giant: null, mini: null });
      a.receive({ type: 'giant', from: 3, epoch: oldEpoch, seq: oldSeq + 100, round: 0, at: { old: true } }, 3);
      assert.equal(a.latest.giant, null, 'an old-round snapshot is ignored');
      a.receive({ type: 'giant', from: 3, epoch: oldEpoch, seq: oldSeq + 101, round: 2, at: { future: true } }, 3);
      assert.equal(a.latest.giant, null, 'a snapshot of a round not yet known is dropped');
      netRun(w, 300);
      assert.equal(a.role, 'giant'); assert.equal(b.role, 'mini');
      assert.ok(b.latest.giant && b.latest.giant.round === 1 && b.latest.giant.from === 8, 'current-round snapshots arrive');
      assert.ok(a.latest.mini && a.latest.mini.round === 1);
      // Repeated hellos of the round we already have do not clear latest.
      const had = b.latest.giant; netRun(w, 1200);
      assert.ok(b.latest.giant && b.latest.giant.seq >= had.seq && b.latest.giant.round === 1);
   });

   await check('lerpPose stays a rotation even when a column blends to nothing', () => {
      const s = Math.SQRT1_2, c = x => x.map(v => +v.toFixed(12));
      const id = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
      // 180 degrees about (1,1,0)/sqrt2: R = 2nn^T - I.
      const r = [0, 1, 0, 0, 1, 0, 0, 0, 0, 0, -1, 0, 3, 0, 0, 1];
      const ortho = (m, label) => {
         const col = k => m.slice(k * 4, k * 4 + 3), d = (p, q) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2];
         for (let i = 0; i < 3; i++) { near(d(col(i), col(i)), 1, 1e-9); for (let j = 0; j < i; j++) near(d(col(i), col(j)), 0, 1e-9); }
         const x = col(0), y = col(1), z = col(2);
         near(d(z, [x[1] * y[2] - x[2] * y[1], x[2] * y[0] - x[0] * y[2], x[0] * y[1] - x[1] * y[0]]), 1, 1e-9);
         assert.ok(m.every(Number.isFinite), label);
      };
      [0, .25, .4999, .5, .5001, .75, 1].forEach(f => ortho(Net.lerpPose(id, r, f), `f=${f}`));
      near(Net.lerpPose(id, r, .5)[12], 1.5);
      ortho(Net.lerpPose(r, id, .5), 'reversed');
      // A mirrored start keeps its handedness only if it had one; a proper pair gives det +1 (checked above).
      assert.deepEqual(c(Net.lerpPose(id, id, .5)), c(id));
   });

   await check('lerpPose blends and keeps columns 0-2 orthonormal with the translation', () => {
      const rotY = (a, t) => [Math.cos(a), 0, -Math.sin(a), 0, 0, 1, 0, 0, Math.sin(a), 0, Math.cos(a), 0, ...t, 1];
      const a = rotY(0, [0, 0, 0]), b = rotY(Math.PI / 2, [2, 4, 6]);
      assert.deepEqual(Net.lerpPose(a, b, 0).map(v => +v.toFixed(9)), a.map(v => +v.toFixed(9)));
      nearV(Net.lerpPose(a, b, 1), b, 1e-9);
      const m = Net.lerpPose(a, b, .5);
      nearV(m.slice(12, 15), [1, 2, 3]); near(m[15], 1);
      const col = k => m.slice(k * 4, k * 4 + 3), dot = (p, q) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2];
      for (let i = 0; i < 3; i++) { near(dot(col(i), col(i)), 1, 1e-9); for (let j = 0; j < i; j++) near(dot(col(i), col(j)), 0, 1e-9); }
      near(Math.atan2(m[8], m[0]) / (Math.PI / 4), 1, 1e-6);   // half way round is 45 degrees
   });

   await check('Interp.at is 100 ms behind, between its neighbours, clamped at the ends', () => {
      const at = x => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, 0, 0, 1];
      const ip = new Net.Interp();
      assert.equal(ip.at(1000), null, 'nothing yet');
      ip.push(1000, at(0)); ip.push(1050, at(5)); ip.push(1100, at(10)); ip.push(1150, at(15));
      near(ip.at(1150)[12], 5);    // 1050 is 100 ms behind 1150
      near(ip.at(1175)[12], 7.5);  // 1075
      near(ip.at(1200)[12], 10);
      near(ip.at(1020)[12], 0, 1e-9); // before the oldest: clamped
      near(ip.at(5000)[12], 15);   // past the newest: clamped
      const v = ip.at(1180)[12]; assert.ok(v > 5 && v < 15);
      for (let i = 0; i < 100; i++) ip.push(2000 + i * 50, at(i));
      near(ip.at(2000 + 99 * 50)[12], 97, 1e-6);   // a long netRun of samples keeps working
      ip.push(2000, at(-1)); near(ip.at(2000 + 99 * 50)[12], 97, 1e-6);   // a late, out-of-order sample is dropped
   });

   await check('reportOf: one compact line of the round: rooms with flags, where the mini can go, the state, the textures', async () => {
      const P = await load('js/scenes/doorways/report.js');
      const { level: L } = G.generate(7), state = R.startState(L);
      const extras = { ev: 'round', xr: false, role: 'giant', paired: null, round: 0, visited: ['entrance'], errors: 0, lastError: '',
         channels: R.SYMBOLS.map((symbol, i) => ({ symbol, channel: i + 2, uploaded: true, same: i !== 3 })), txtrChannel: [1, 2, 3, 4, 5, 6, 7] };
      const r = P.reportOf({ level: L, state }, extras);
      assert.equal(r.v, 1); assert.equal(r.ev, 'round'); assert.equal(r.xr, false); assert.equal(r.paired, null);
      assert.equal(r.seed, 7); assert.equal(r.goal, L.goal); assert.equal(r.goalSymbol, L.goalSymbol);
      assert.equal(r.rooms.length, L.rooms.length);
      L.rooms.forEach((room, i) => {
         const [id, symbol, slot, rot, flags] = r.rooms[i];
         assert.deepEqual([id, symbol, slot, rot], [room.id, room.symbol, L.start[room.id].slot, L.start[room.id].rot]);
         assert.equal(flags, (room.key ? 'k' : '') + (room.switch ? 's' : '') + (room.chest ? 'c' : '') + (room.gate ? 'g' : '') + (room.anchor ? 'a' : ''));
      });
      assert.ok(r.rooms.some(x => x[4].includes('c')), 'a chest somewhere');
      assert.equal(r.mini, 'entrance'); assert.deepEqual(r.visited, ['entrance']);
      assert.deepEqual(r.reachable, [...R.reachable(L, state)]);
      assert.deepEqual([r.keys, r.unlocked, r.pressed, r.opened, r.penalty, r.won], [[], [], [], [], 0, false]);
      assert.deepEqual(r.channels.map(c => c.symbol), R.SYMBOLS);
      assert.deepEqual(r.channels[3], { symbol: 'tree', channel: 5, uploaded: true, same: false }, 'a channel taken over shows as same: false'); assert.deepEqual(r.txtrChannel, [1, 2, 3, 4, 5, 6, 7]);
      assert.equal(r.errors, 0); assert.ok(!('lastError' in r), 'no lastError while there is no error');
      assert.ok(!JSON.stringify(r).includes('\n') && JSON.stringify(r).length < 1500, 'one short line');
      // A round number of 0 (no session), a thrown frame, the win, a partner: the same shape.
      const w = P.reportOf({ level: L, state: { ...state, won: true, penalty: 20, mini: L.goal, keys: ['red'] } },
         { ...extras, ev: 'win', xr: true, paired: 'mini', role: 'mini', round: 3, errors: 2, lastError: 'boom at x', visited: ['entrance', L.goal] });
      assert.deepEqual([w.ev, w.xr, w.paired, w.round, w.won, w.penalty, w.mini, w.keys, w.errors, w.lastError], ['win', true, 'mini', 3, true, 20, L.goal, ['red'], 2, 'boom at x']);
      assert.equal(JSON.parse(JSON.stringify(w)).visited[1], L.goal, 'it survives JSON');
      // The copies are not the state's own.
      r.keys.push('x'); r.visited.push('y'); assert.deepEqual([state.keys, extras.visited], [[], ['entrance']]);
   });

   console.log(`${passed} doorways checks passed.`);
})().catch(e => { console.error(e); process.exit(1); });
