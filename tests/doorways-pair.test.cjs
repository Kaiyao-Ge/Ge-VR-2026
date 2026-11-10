// Doorways, two players, without a browser: the bodies of the partner (bodies.js) and the glue between the
// scene and the session (pair.js): snapshot validation, the avatar's map, rounds, and which part each side applies.
// Run: node tests/doorways-pair.test.cjs
const assert = require('node:assert/strict');
const load = require('./esm.cjs');

let passed = 0;
const check = async (name, fn) => { await fn(); passed++; console.log('ok -', name); };
const near = (a, b, e = 1e-6) => assert.ok(Math.abs(a - b) < e, `${a} vs ${b}`);
const nearV = (a, b, e = 1e-6) => a.forEach((v, i) => near(v, b[i], e));

(async () => {
   const cg = await load('js/render/core/cg.js');
   const R = await load('js/scenes/doorways/rules.js');
   const G = await load('js/scenes/doorways/generate.js');
   const Bd = await load('js/scenes/doorways/bodies.js');
   const P = await load('js/scenes/doorways/pair.js');
   const Mp = await load('js/scenes/miniature/mapping.js');

   const I = cg.mIdentity();
   const at = (x, y, z, yaw = 0) => cg.mMultiply(cg.mTranslate(x, y, z), cg.mRotateY(yaw));
   const table = at(1, .74, -2, .6);   // a table frame in some client's model frame
   const body = (head, left, right) => ({ head, left, right });
   const cs = (id, b) => ({ head: i => i === id ? b?.head ?? null : null, hand: (i, h) => i === id ? b?.[h] ?? null : null });

   await check('peerBody of an XR peer takes clientState into the table frame, with the inverse of its table matrix', () => {
      const peer = { id: 3, xr: true, table };
      const head = at(1.5, 1.7, -1.8, .2), left = at(1.3, 1.2, -1.9), right = at(1.7, 1.2, -1.9);
      const b = Bd.peerBody(peer, null, cs(3, { head, left, right }));
      nearV(b.head, cg.mMultiply(cg.mInverse(table), head));
      nearV(b.left, cg.mMultiply(cg.mInverse(table), left));
      nearV(b.right, cg.mMultiply(cg.mInverse(table), right));
      // The head is above the table by what it is above it in the peer's frame.
      near(b.head[13], 1.7 - .74);
   });

   await check('peerBody of a desktop peer is the snapshot body as it is; bad or missing bodies are null', () => {
      const peer = { id: 2, xr: false, table };
      const head = at(.1, .9, .2);
      const b = Bd.peerBody(peer, body(head, null, at(0, .2, 0)), cs(2, { head: at(5, 5, 5) }));
      assert.deepEqual(b.head, head);
      assert.equal(b.left, null);
      assert.deepEqual(b.right, at(0, .2, 0), 'hands are kept');
      assert.equal(Bd.peerBody(peer, null, cs(2)), null, 'no snapshot body yet');
      assert.equal(Bd.peerBody(peer, { head: head.slice(1) }, cs(2)), null, 'a head of 15 numbers');
      assert.equal(Bd.peerBody(peer, { head: head.map(() => null) }, cs(2)), null);
      assert.equal(Bd.peerBody(peer, { head, left: [1, 2, 3] }, cs(2)), null, 'a bad hand spoils the body');
      assert.equal(Bd.peerBody(null, body(head), cs(2)), null, 'no peer');
   });

   await check('peerBody of an XR peer is null without a head in clientState, a usable table, or with non-finite numbers', () => {
      assert.equal(Bd.peerBody({ id: 3, xr: true, table }, null, cs(3)), null, 'clientState has no head');
      assert.equal(Bd.peerBody({ id: 3, xr: true, table: null }, null, cs(3, { head: at(0, 1, 0) })), null, 'no table matrix');
      assert.equal(Bd.peerBody({ id: 3, xr: true, table: table.map(() => 0) }, null, cs(3, { head: at(0, 1, 0) })), null, 'a singular table matrix');
      const bad = at(0, 1, 0); bad[12] = NaN;
      assert.equal(Bd.peerBody({ id: 3, xr: true, table }, null, cs(3, { head: bad })), null, 'a NaN head');
      const b = Bd.peerBody({ id: 3, xr: true, table }, null, cs(3, { head: at(0, 1, 0), left: bad }));
      assert.equal(b.left, null, 'one hand that is not usable is just not drawn');
      assert.equal(Bd.peerBody({ id: 3, xr: true, table }, null, { head: () => { throw new Error('x'); }, hand: () => null }), null, 'no throwing at a frame');
   });

   await check('modelBody is the partner as its own client frames it: clientState for an XR peer, the snapshot for a desktop one', () => {
      const head = at(2, 1.6, 3);
      assert.deepEqual(Bd.modelBody({ id: 3, xr: true, table }, body(at(9, 9, 9)), cs(3, { head })).head, head);
      assert.deepEqual(Bd.modelBody({ id: 3, xr: false, table }, body(head), cs(3, { head: at(9, 9, 9) })).head, head);
   });

   await check('the giant seen from the mini: its table-frame body goes into my model frame, its feet on its floor', () => {
      const F = at(-.5, .7, .3, -.4), peer = { id: 1, xr: true, table };
      const head = at(1.5, 1.7, -1.8);
      const fig = Bd.giantFigure(F, peer, null, cs(1, { head }));
      nearV(fig.poses.head, cg.mMultiply(F, cg.mMultiply(cg.mInverse(table), head)));
      // The feet: under the head, on the floor of the giant's own world (y = 0 there), carried over by the same tables.
      const under = cg.mTransform(F, cg.mTransform(cg.mInverse(table), [head[12], 0, head[14]]));
      nearV(fig.feet, under);
      assert.equal(fig.poses.left, null);
      assert.equal(Bd.giantFigure(F, peer, null, cs(1)), null);
      // A desktop giant: the snapshot body is in the table frame already; the floor is under its table matrix.
      const d = Bd.giantFigure(F, { id: 1, xr: false, table }, body(at(.1, .9, .2)), cs(1));
      nearV(d.poses.head, cg.mMultiply(F, at(.1, .9, .2)));
      near(d.feet[1], cg.mTransform(F, cg.mTransform(cg.mInverse(table), [0, 0, 0]))[1]);
   });

   await check('mapOf and the mini figure: the giant draws the avatar where the mini draws it, and follows a room that moved', () => {
      const Fm = at(.2, .74, -.9, .3), Fg = at(-1, .7, .5, -1);                 // the two clients' table frames
      const m = new Mp.Mapping();
      const head = at(.4, 1.6, -.3, .5);
      m.setBody(head).setStand(cg.mTransform(Fm, [.05, .006, -.03]), .7);
      const settled = R.slotPose('c4', 1);
      const map = P.mapOf(settled, Fm, m.toMini);
      const peer = { id: 0, xr: true, table: Fm };
      // On the giant's side, with the room where the mini's client has it: Fg * inv(Fm) * (the avatar in the mini's frame).
      const fig = Bd.miniFigure(Fg, settled, map, peer, null, cs(0, { head }));
      nearV(fig.poses.head, cg.mMultiply(Fg, cg.mMultiply(cg.mInverse(Fm), m.mini(head))));
      nearV(fig.feet, cg.mTransform(Fg, cg.mTransform(cg.mInverse(Fm), m.feet(head))));
      // The room is held and turned: the avatar goes with it, as a rigid part of it.
      const held = cg.mMultiply(at(.1, .05, .02), cg.mRotateY(.8));
      const moved = Bd.miniFigure(Fg, held, map, peer, null, cs(0, { head }));
      const inRoom = cg.mMultiply(cg.mInverse(cg.mMultiply(Fg, held)), moved.poses.head), was = cg.mMultiply(cg.mInverse(cg.mMultiply(Fg, settled)), fig.poses.head);
      nearV(inRoom, was);
      // A desktop mini sends its camera in its model frame, which goes through the same map.
      const desk = Bd.miniFigure(Fg, settled, map, { id: 0, xr: false, table: Fm }, body(head), cs(0));
      nearV(desk.poses.head, fig.poses.head);
   });

   // ---- Snapshots.
   const { level } = G.generate(7);
   const rooms = level.rooms.map(r => r.id);
   const game = () => ({ level, state: R.startState(level), held: null });
   const matrix = at(.1, .03, .2);

   await check('a giant snapshot is read only if every field is what it must be', () => {
      const g = game();
      const ok = P.giantPart(g, null);
      assert.deepEqual(ok, { at: g.state.at, held: null });
      assert.deepEqual(P.readGiant({ ...ok }, level), { at: g.state.at, held: null, body: null });
      const held = { id: rooms[0], m: matrix };
      assert.deepEqual(P.readGiant({ ...ok, held }, level).held, held);
      const bad = (extra, what) => assert.equal(P.readGiant({ ...ok, ...extra }, level), null, what);
      bad({ held: { id: 'nope', m: matrix } }, 'an unknown room held');
      bad({ held: { id: rooms[0], m: matrix.slice(1) } }, 'a matrix of 15');
      bad({ held: { id: rooms[0], m: matrix.map((v, i) => i === 3 ? 'x' : v) } }, 'a matrix with a string');
      bad({ held: 5 }, 'held of the wrong type');
      bad({ at: { ...ok.at, [rooms[0]]: { slot: 'c99', rot: 0 } } }, 'an unknown slot');
      bad({ at: { ...ok.at, [rooms[0]]: { slot: ok.at[rooms[1]].slot, rot: 0 } } }, 'two rooms in one slot');
      bad({ at: { ...ok.at, [rooms[0]]: { slot: ok.at[rooms[0]].slot, rot: 4 } } }, 'rot out of range');
      bad({ at: { ...ok.at, [rooms[0]]: { slot: ok.at[rooms[0]].slot, rot: 1.5 } } }, 'rot not whole');
      bad({ at: { ...ok.at, ghost: { slot: 'd1', rot: 0 } } }, 'a room that is not in the level');
      const { [rooms[0]]: _, ...fewer } = ok.at;
      bad({ at: fewer }, 'a room missing');
      bad({ at: { ...ok.at, [rooms[0]]: { slot: R.ENTRANCE, rot: 0 } } }, 'the entrance is not for a room');
      bad({ at: null }, 'no at');
      bad({ body: { head: matrix.slice(2) } }, 'a bad body');
      assert.deepEqual(P.readGiant({ ...ok, body: { head: matrix } }, level).body, { head: matrix, left: null, right: null });
      assert.equal(P.readGiant(null, level), null);
      assert.equal(P.readGiant('x', level), null);
   });

   await check('a mini snapshot is read only if every field is what it must be, and its state is the mini part alone', () => {
      const g = game();
      g.state.keys = ['red']; g.state.pressed = ['blue']; g.state.penalty = 20;
      const ok = P.miniPart(g, { ref: rooms[0], map: matrix, time: 12.5, body: null });
      assert.deepEqual(Object.keys(ok.state).sort(), ['keys', 'mini', 'opened', 'penalty', 'pressed', 'taken', 'unlocked', 'won']);
      assert.equal('at' in ok.state, false, 'the giant part is not sent');
      const read = P.readMini(ok, level);
      assert.deepEqual(read.state, ok.state);
      assert.deepEqual([read.ref, read.time], [rooms[0], 12.5]);
      const bad = (extra, what) => assert.equal(P.readMini({ ...ok, ...extra }, level), null, what);
      bad({ ref: 'nope' }, 'an unknown ref');
      assert.equal(P.readMini({ ...ok, ref: 'table' }, level).ref, 'table');
      assert.equal(P.readMini({ ...ok, ref: R.ENTRANCE }, level).ref, R.ENTRANCE);
      bad({ map: matrix.slice(0, 15) }, 'a map of 15');
      bad({ time: -1 }, 'negative time');
      bad({ time: 'x' }, 'time of the wrong type');
      bad({ state: { ...ok.state, mini: 'nope' } }, 'the mini in no room');
      bad({ state: { ...ok.state, keys: ['green'] } }, 'a key of no colour');
      bad({ state: { ...ok.state, keys: ['red', 'red', 'blue'] } }, 'too many keys');
      bad({ state: { ...ok.state, pressed: 'red' } }, 'pressed of the wrong type');
      bad({ state: { ...ok.state, opened: ['nope'] } }, 'an unknown opened room');
      bad({ state: { ...ok.state, taken: [1] } }, 'a number as a room');
      bad({ state: { ...ok.state, penalty: -20 } }, 'a negative penalty');
      bad({ state: { ...ok.state, won: 1 } }, 'won not a boolean');
      bad({ state: { ...ok.state, won: undefined } }, 'a field missing');
      bad({ state: null }, 'no state');
      assert.equal(P.readMini({ ...ok, state: { ...ok.state, mini: R.ENTRANCE } }, level).state.mini, R.ENTRANCE);
   });

   // ---- Link over a fake relay.
   const relay = (ids = [0, 1]) => {
      const w = { t: 1000, ids, inbox: {}, links: {}, ids_: ids };
      ids.forEach(id => {
         w.inbox[id] = [];
         w.links[id] = new P.Link({ id: () => id, clients: () => w.ids, now: () => w.t,
            send: m => ids.forEach(o => o !== id && w.inbox[o].push([id, m])),
            sync: cb => { const q = w.inbox[id]; w.inbox[id] = []; q.forEach(([sender, m]) => cb({ 0: m }, sender)); } });
      });
      return w;
   };
   const world = {};   // per link: the game it plays
   // What the scene does after a round may have started: begin it, from the session's seed, if it is new.
   const regen = id => {
      const g = world[id], seed = g && w_of(id).rounds(g.level.seed, 1234);
      if (seed !== null && seed !== undefined) { Object.assign(g, { level: G.generate(seed).level }); g.state = R.startState(g.level); g.held = null; g.rounds = (g.rounds || 0) + 1; }
   };
   let w_cur = null;
   const w_of = id => w_cur.links[id];
   const play = (w, wants = { 0: 'giant', 1: 'giant' }, ms = 50) => {
      w_cur = w;
      w.t += ms;
      // Everything that was sent arrives before any client acts, as it does on the real queue, where nobody sees the other's frame.
      for (const id of w.ids) w.links[id].pump();
      for (const id of w.ids) {
         const l = w.links[id], g = world[id];
         if (l.session.live) world[id].paired = l.session.role;
         regen(id);
         if (g.paired === 'mini') l.takeGiant(g, (was, now) => g.moved.push([was, now]));
         if (g.paired === 'giant') l.takeMini(g);
         l.send({ want: wants[id], table: null, xr: false,
            giant: () => P.giantPart(g, null),
            mini: () => P.miniPart(g, { ref: g.state.mini, map: matrix, time: g.time || 0, body: null }) });
      }
   };
   const fresh = seed => ({ level: G.generate(seed).level, state: null, held: null, moved: [], paired: null, time: 0 });
   const start = (seeds, ids = [0, 1]) => {
      const w = relay(ids);
      ids.forEach((id, i) => { world[id] = fresh(seeds[i]); world[id].state = R.startState(world[id].level); });
      return w;
   };
   const run = (w, n, wants) => { for (let i = 0; i < n; i++) play(w, wants); };

   await check('two links starting alone with their own seeds meet: the lower id is the giant and its level is the round', () => {
      const w = start([7, 11]);
      run(w, 3);   // not yet meeting? (the first hello is sent at the first tick, received at the second)
      run(w, 30);
      assert.equal(w.links[0].session.round, 1);
      assert.equal(w.links[1].session.round, 1);
      assert.deepEqual([world[0].paired, world[1].paired], ['giant', 'mini']);
      assert.equal(world[1].level.seed, world[0].level.seed, 'the same level');
      assert.equal(world[0].level.seed, G.generate(7).level.seed, 'the giant\'s own');
      assert.equal(world[0].rounds, 1);
      assert.equal(world[1].rounds, 1, 'and the mini generated it once');
      run(w, 40);
      assert.equal(world[0].rounds, 1, 'no further rounds on their own');
      assert.equal(world[1].rounds, 1);
   });

   await check('a client that asked to be the mini (V before the partner came) is the mini, whatever its id', () => {
      const w = start([7, 11]);
      run(w, 40, { 0: 'mini', 1: 'giant' });
      assert.deepEqual([world[0].paired, world[1].paired], ['mini', 'giant']);
      assert.equal(world[0].level.seed, world[1].level.seed);
      assert.equal(world[0].level.seed, G.generate(11).level.seed, 'the giant is id 1: its seed');
   });

   await check('the giant sends at and held; the mini applies them, interpolates the held room and carries itself when the room is set', () => {
      const w = start([7, 11]);
      run(w, 40);
      const gg = world[0], mg = world[1], id = gg.level.rooms.find(r => R.movable(gg.level, gg.state, r.id)).id;
      const was = R.slotPose(gg.state.at[id].slot, gg.state.at[id].rot);
      mg.state.mini = id;
      const free = R.CELLS.find(c => !Object.values(gg.state.at).some(a => a.slot === c));
      gg.held = { id, m: at(.3, .05, .1) };
      run(w, 4);
      assert.equal(mg.held.id, id, 'the mini sees the held room');
      assert.equal(mg.held.hand, 'peer');
      assert.equal(mg.moved.length, 0, 'nothing is carried while it is in the hand');
      gg.held = { id, m: at(.5, .05, .1) };
      run(w, 1);
      const early = mg.held.m[12];
      run(w, 6);
      assert.ok(mg.held.m[12] > early, 'the held pose moves on, 100 ms behind');
      near(mg.held.m[12], .5, 1e-6);
      // Set down in a new slot, turned.
      gg.held = null; gg.state.at = { ...gg.state.at, [id]: { slot: free, rot: 1 } };
      run(w, 3);
      assert.equal(mg.held, null, 'the mini sees it let go');
      assert.deepEqual(mg.state.at[id], { slot: free, rot: 1 });
      assert.equal(mg.moved.length, 1, 'the mini is carried once');
      nearV(mg.moved[0][0], was);
      nearV(mg.moved[0][1], R.slotPose(free, 1));
      run(w, 10);
      assert.equal(mg.moved.length, 1, 'and not again by later snapshots');
      // A room the mini is not in moving carries nothing.
      const other = gg.level.rooms.find(r => r.id !== id && R.movable(gg.level, gg.state, r.id)).id, spot = R.DEPOT[0];
      gg.state.at = { ...gg.state.at, [other]: { slot: spot, rot: 0 } };
      run(w, 3);
      assert.deepEqual(mg.state.at[other], { slot: spot, rot: 0 });
      assert.equal(mg.moved.length, 1);
   });

   await check('the mini sends its part; the giant applies it and nothing else, and keeps the mini\'s ref and map for the avatar', () => {
      const w = start([7, 11]);
      run(w, 40);
      const gg = world[0], mg = world[1];
      const keep = JSON.stringify(gg.state.at);
      mg.state.keys = ['red']; mg.state.pressed = ['red']; mg.state.penalty = 20; mg.state.mini = mg.level.rooms[2].id; mg.time = 31;
      mg.state.at = { ...mg.state.at, [mg.level.rooms[0].id]: { slot: 'd1', rot: 3 } };   // the mini's own copy of at is not its to send
      run(w, 3);
      assert.deepEqual([gg.state.keys, gg.state.pressed, gg.state.penalty, gg.state.mini], [['red'], ['red'], 20, mg.level.rooms[2].id]);
      assert.equal(JSON.stringify(gg.state.at), keep, 'the giant\'s at is its own');
      assert.deepEqual(w.links[0].view, { ref: mg.level.rooms[2].id, map: matrix, time: 31 });
      mg.state.won = true;
      run(w, 3);
      assert.equal(gg.state.won, true);
   });

   await check('malformed snapshots are ignored whole, and the next good one is applied', () => {
      const w = start([7, 11]);
      run(w, 40);
      const gg = world[0], mg = world[1];
      const real = P.miniPart;
      const sent = w.links[1].session.latest;
      mg.state.keys = ['red'];
      run(w, 3);
      assert.deepEqual(gg.state.keys, ['red']);
      // The mini now sends rubbish: a key of no colour, in an otherwise fine snapshot.
      mg.state.keys = ['purple'];
      run(w, 3);
      assert.deepEqual(gg.state.keys, ['red'], 'the bad one was ignored');
      mg.state.keys = ['blue'];
      run(w, 3);
      assert.deepEqual(gg.state.keys, ['blue'], 'a later good one is applied');
      void real; void sent;
   });

   await check('while the partner is silent nothing is applied and nothing is taken over; when it comes back, it goes on', () => {
      const w = start([7, 11]);
      run(w, 40);
      const gg = world[0], mg = world[1];
      mg.state.keys = ['red'];
      run(w, 3);
      assert.deepEqual(gg.state.keys, ['red']);
      // The mini's newest snapshot arrives, and then it goes quiet for 4 s before the giant looks: the giant is
      // waiting, keeps its paired role and the last state, and applies nothing.
      const l = w.links[0];
      mg.state.keys = ['blue'];
      w.t += 50; w.links[1].send({ want: 'giant', table: null, xr: false, giant: () => ({}), mini: () => P.miniPart(mg, { ref: mg.state.mini, map: matrix, time: 0, body: null }) });
      l.pump();
      w.t += 4000;
      assert.equal(l.session.waiting, true);
      assert.equal(gg.paired, 'giant');
      l.takeMini(gg);
      assert.deepEqual(gg.state.keys, ['red'], 'nothing is applied while waiting');
      // It comes back (the same session): the giant applies again.
      run(w, 5);
      assert.equal(l.session.waiting, false);
      assert.deepEqual(gg.state.keys, ['blue']);
   });

   await check('after a win, a new round with the same giant, or a swap, regenerates both and resets the state', () => {
      const w = start([7, 11]);
      run(w, 40);
      const gg = world[0], mg = world[1], old = gg.level.seed;
      mg.state.won = true; mg.state.penalty = 40;
      run(w, 3);
      assert.equal(gg.state.won, true);
      w.links[1].start(555, false);   // the mini presses N: the giant stays the giant
      run(w, 6);
      assert.equal(gg.level.seed, G.generate(555).level.seed);
      assert.equal(mg.level.seed, gg.level.seed);
      assert.notEqual(gg.level.seed, old);
      assert.deepEqual([gg.state.won, mg.state.won, gg.state.penalty], [false, false, 0], 'both start again');
      assert.deepEqual([gg.paired, mg.paired], ['giant', 'mini']);
      w.links[0].start(900, true);   // the giant presses M: the roles are exchanged
      run(w, 6);
      assert.equal(gg.level.seed, G.generate(900).level.seed);
      assert.equal(mg.level.seed, gg.level.seed);
      assert.deepEqual([gg.paired, mg.paired], ['mini', 'giant']);
      w.links[0].start(1500, true);   // and back
      run(w, 6);
      assert.deepEqual([gg.paired, mg.paired], ['giant', 'mini']);
   });

   await check('two rounds started at once settle on one: both scenes get the same level and complementary roles', () => {
      for (const swap of [false, true]) {
         const w = start([7, 11]);
         run(w, 40);
         const seeds = [G.generate(1111).level.seed, G.generate(2222).level.seed];
         // Both press N (or both M) in the same tick, before either has heard of the other's round.
         w.links[0].start(1111, swap);
         w.links[1].start(2222, swap);
         regen(0); regen(1);   // as the scene does at once, each with its own seed
         assert.equal(w.links[0].session.round, w.links[1].session.round, 'the same round number: a collision');
         run(w, 8);
         assert.equal(w.links[0].session.round, w.links[1].session.round);
         assert.equal(w.links[0].session.seed, w.links[1].session.seed, 'the session settled on one seed');
         assert.equal(world[0].level.seed, world[1].level.seed, 'and so did the scenes (swap ' + swap + ')');
         assert.ok(seeds.includes(world[0].level.seed));
         assert.notEqual(world[0].paired, world[1].paired, 'complementary roles');
         assert.deepEqual([world[0].state.won, world[1].state.won], [false, false]);
         run(w, 40);
         assert.equal(world[0].level.seed, world[1].level.seed, 'and it stays so');
      }
   });

   await check('a round whose giant is neither client is restarted by the lower id, with a new seed, once', () => {
      const w = start([7, 11]);
      run(w, 40);
      const rounds = [world[0].rounds, world[1].rounds];
      // Another client, 9, was the giant of the round: it left. The higher client gets the round from a third client's word.
      const roundsBy = { 0: 0, 1: 0 };
      [0, 1].forEach(id => { const raw = w.links[id].session.sendRaw; w.links[id].session.sendRaw = m => { if (m.type === 'round') roundsBy[id]++; raw(m); }; });
      w.links[0].session.round = 5; w.links[0].round = 5; w.links[0].key = '5|77|9'; w.links[0].session.giant = 9; w.links[0].session.seed = 77;
      w.links[1].session.round = 5; w.links[1].round = 5; w.links[1].key = '5|77|9'; w.links[1].session.giant = 9; w.links[1].session.seed = 77;
      run(w, 12);
      assert.equal(w.links[0].session.giant, 0, 'the lower id is the giant now');
      assert.equal(w.links[1].session.giant, 0);
      assert.equal(w.links[0].session.round, w.links[1].session.round);
      assert.ok(w.links[0].session.round > 5);
      assert.equal(world[0].level.seed, world[1].level.seed);
      assert.deepEqual(roundsBy, { 0: 1, 1: 0 }, 'only the lower id started a round, once');
      assert.equal(world[0].rounds, rounds[0] + 1, 'one new round on the giant');
      assert.equal(world[1].rounds, rounds[1] + 1, 'and on the mini');
      assert.deepEqual([world[0].paired, world[1].paired], ['giant', 'mini']);
   });

   await check('a reloaded page rejoins the same round and the same role', () => {
      const w = start([7, 11]);
      run(w, 40);
      const seed = world[0].level.seed, round = w.links[0].session.round;
      // Page 1 is reloaded: a new link and a new scene with its own random seed.
      w.inbox[1] = [];
      w.links[1] = new P.Link({ id: () => 1, clients: () => w.ids, now: () => w.t,
         send: m => w.inbox[0].push([1, m]),
         sync: cb => { const q = w.inbox[1]; w.inbox[1] = []; q.forEach(([sender, m]) => cb({ 0: m }, sender)); } });
      world[1] = fresh(31); world[1].state = R.startState(world[1].level);
      // The first frames: no hello of the other yet, so nothing happens.
      run(w, 40);
      assert.equal(w.links[1].session.round, round, 'the same round');
      assert.equal(world[1].level.seed, seed, 'the same level');
      assert.equal(world[1].paired, 'mini');
      assert.equal(w.links[0].session.round, round, 'the giant did not start another');
      assert.equal(world[0].rounds, 1);
   });

   console.log(`${passed} doorways pair checks passed.`);
})().catch(e => { console.error(e); process.exit(1); });
