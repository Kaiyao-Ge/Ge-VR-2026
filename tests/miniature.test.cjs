// Miniature checks without a browser: the body-to-avatar mapping, the flight
// between the views, walking and turning the avatar, its physics on the object
// (steps, walls, riding), rays (grab and teleport), the table, the cube and the house.
// Run: node tests/miniature.test.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const load = require('./esm.cjs');

let passed = 0;
const check = async (name, fn) => { await fn(); passed++; console.log('ok -', name); };
const near = (a, b, e = 1e-6) => assert.ok(Math.abs(a - b) < e, `${a} vs ${b}`);
const nearV = (a, b, e = 1e-6) => a.forEach((v, i) => near(v, b[i], e));

(async () => {
   const cg = await load('js/render/core/cg.js');
   const M = await load('js/scenes/miniature/mapping.js');
   const W = await load('js/scenes/miniature/world.js');
   const cube = await load('js/scenes/miniature/objects/cube.js');
   const P = await load('js/scenes/miniature/physics.js');
   const R = await load('js/scenes/miniature/rays.js');
   const house = await load('js/scenes/miniature/objects/house.js');
   const objects = await load('js/scenes/miniature/objects/index.js');
   const S = await load('js/scenes/miniature/scanned.js');
   const room = await load('js/scenes/echohunt/room.js');

   // Me: 1.83 m (6 ft) tall at [1, 0, 2], facing +x; the avatar on a 29 in table at [0, .74, -.7], facing -z.
   const head = M.frame([1, 1.83, 2], -Math.PI / 2), table = [0, .7366, -.7];
   const mapping = () => new M.Mapping().setBody(head).setStand(table, 0);

   await check('a 6 ft player is a 6 inch avatar: its head 6 inches above the table, at its spot, facing its way', () => {
      const m = mapping(), h = m.mini(head);
      nearV(h.slice(12, 15), [0, .7366 + .1525, -.7], 1e-9);
      near(cg.norm(h.slice(0, 3)), 1 / 12);
      near(m.facing(head), 0);
      nearV(m.feet(head), table);
   });

   await check('walking a metre walks the avatar 1/12 of a metre, the same way turned onto the table', () => {
      const m = mapping(), moved = cg.mMultiply(cg.mTranslate(1, 0, 0), head);   // a step forward (+x)
      nearV(cg.subtract(m.feet(moved), m.feet(head)), [0, 0, -1 / 12]);              // the avatar's forward is -z
   });

   await check('from the avatar\'s eyes, the world is 12 times bigger and my eye is where its eye is', () => {
      const m = mapping();
      nearV(cg.mTransform(m.toWorld, m.mini(head).slice(12, 15)), head.slice(12, 15), 1e-9);
      // A 10 cm cube on the table is 1.2 m high round the avatar.
      const a = cg.mTransform(m.toWorld, table), b = cg.mTransform(m.toWorld, cg.add(table, [0, .1, 0]));
      near(cg.distance(a, b), 1.2, 1e-9);
      near(a[1], 0, 1e-9);   // the table top is my floor
   });

   await check('the stick walks the avatar where it faces, and a turn keeps its stand point in place', () => {
      const m = mapping();
      m.walk(head, .1, 0);
      nearV(m.feet(head), cg.add(table, [0, 0, -.1]));
      const stand = [...m.stand.p], yaw = m.stand.yaw;
      m.turn(-Math.PI / 2);   // turned right: now facing +x
      nearV(m.stand.p, stand);
      near(m.stand.yaw, yaw - Math.PI / 2);
      const feet = m.feet(head);
      m.walk(head, .1, 0);
      nearV(m.feet(head), cg.add(feet, [.1, 0, 0]));
      m.walk(head, 0, .1);           // to its right: +z
      nearV(m.feet(head), cg.add(feet, [.1, 0, .1]));
   });

   await check('the table: points on it, and points off it brought back onto it', () => {
      const node = () => { const n = { add: () => node(), color: () => n, setMatrix: () => n, identity: () => n, move: () => n, scale: () => n, opacity: () => n, child: () => n }; return n; };
      const w = new W.World(node());
      w.setTable([1, .75, 0], Math.PI / 2);   // its length along -z
      nearV(w.onTable([.5, 0]), [1, .75, -.5]);
      nearV(w.clamp([1, 2, -5]), [1, .75, -W.TABLE.size[0] / 2]);
      nearV(w.clamp([3, 0, 0], .01), [1 + W.TABLE.size[1] / 2 - .01, .75, 0]);
   });

   await check('the cube lights a touched face and changes colour on the trigger, only at the avatar\'s size', () => {
      const made = [];
      const node = () => { const n = { add: () => node(), identity: () => n, move: a => (n.at = a, n), scale: s => (n.s = s, n), color: (...c) => (n.c = c, n) }; made.push(n); return n; };
      const c = cube.create(node()), body = made[1], faces = made.slice(2);
      const touch = (mode, pressed) => c.update({ mode, hands: [{ hand: 'right', p: [.052, .05, 0], trigger: pressed, pressed }] });
      touch('avatar', false);
      const lit = faces.filter(f => Array.isArray(f.s) ? f.s.some(v => v > 0) : f.s > 0);
      assert.equal(lit.length, 1);
      near(lit[0].at[0], .0505);
      const before = JSON.stringify(body.c);
      touch('avatar', true); touch('avatar', false);
      assert.notEqual(JSON.stringify(body.c), before);
      const now = JSON.stringify(body.c);
      touch('player', true); touch('player', false);
      assert.equal(JSON.stringify(body.c), now, 'my own hand is too big to press it');
   });


   await check('the flight starts as my view (the identity) and ends as the avatar\'s (toWorld), turned and moved', () => {
      const m = new M.Mapping().setBody(head).setStand(table, 0.5), eye = head.slice(12, 15), mini = cg.mTransform(m.toMini, eye);
      const theta = m.body.yaw - m.stand.yaw;
      nearV(M.flight(eye, mini, theta, 0), cg.mIdentity(), 1e-9);
      nearV(M.flight(eye, mini, theta, 1), m.toWorld, 1e-9);
      // On the way: the world has grown 12^t, and the point it grows about is carried to my eye.
      const w = M.flight(eye, mini, theta, .5);
      near(cg.norm(w.slice(0, 3)), Math.sqrt(12), 1e-9);
      const k = (1 - Math.pow(1 / 12, .5)) / (1 - 1 / 12), about = cg.add(eye, cg.scale(cg.subtract(mini, eye), k));
      nearV(cg.mTransform(w, about), eye, 1e-9);
   });

   await check('the flight turns the short way round, however far the avatar has turned', () => {
      const eye = head.slice(12, 15), mini = cg.mTransform(mapping().toMini, eye);
      for (const turns of [-3, 2]) {
         const theta = 1 + turns * 2 * Math.PI;
         nearV(M.flight(eye, mini, theta, .5), M.flight(eye, mini, 1, .5), 1e-9);
         nearV(M.flight(eye, mini, theta, 1), M.flight(eye, mini, 1, 1), 1e-9);
      }
      // Twelve snap turns of 30 degrees is a whole turn: the flight does not spin.
      const m = mapping();
      for (let i = 0; i < 12; i++) m.turn(-Math.PI / 6);
      const w = M.flight(eye, mini, m.body.yaw - m.stand.yaw, .5);
      nearV(w, M.flight(eye, mini, m.body.yaw - m.stand.yaw + 2 * Math.PI * 5, .5), 1e-9);
      near(Math.atan2(w[8], w[10]), m.body.yaw / 2, 1e-6);   // half way through a quarter turn, not three quarters
   });

   // The avatar's boxes, in the object's frame (y = 0 is the table): a low step, a wall and a roof.
   const U = 1 / 12;
   const box = (x0, y0, z0, x1, y1, z1) => ({ min: [x0, y0, z0], max: [x1, y1, z1] });
   const step = box(.1, 0, -.1, .2, .2 * U, .1), wall = box(.1, 0, -.1, .12, 3 * U, .1);

   await check('physics: a step of 0.2 m climbs, a wall of 3 m stops, and a roof above the head does not', () => {
      let r = P.move([step], [.0, 0, 0], .08, 0);
      assert.ok(!r.blocked);
      near(r.feet[1], .2 * U);                              // up on the step
      r = P.move([wall], [.0, 0, 0], .08, 0);
      assert.ok(r.blocked);
      near(r.feet[0], .0);
      r = P.move([box(0, 2.5 * U, -.1, .3, 3 * U, .1)], [0, 0, 0], .08, 0);
      assert.ok(!r.blocked, 'a ceiling above the 1.9 m head');
      // Steps of 0.2 m up to a 0.4 m floor, one after another.
      const stairs = [step, box(.2, 0, -.1, .3, .4 * U, .1)];
      r = P.move(stairs, P.move(stairs, [.0, 0, 0], .1, 0).feet, .1, 0);
      near(r.feet[1], .4 * U);
      // A 0.6 m ledge is too much from the table, and too much from the 0.2 m step.
      assert.ok(P.move([box(.1, 0, -.1, .3, .6 * U, .1)], [0, 0, 0], .1, 0).blocked);
   });

   await check('physics: the ground is the highest top under the feet within a step, else the table; leaving falls back', () => {
      const boxes = [step, box(.15, 0, -.1, .3, .3 * U, .1)];
      near(P.ground(boxes, [.17, 0, 0]), .3 * U);                       // both under the feet circle: the higher
      near(P.ground(boxes, [.12, .2 * U, 0]), .2 * U);                  // only the first reaches that far
      near(P.ground([box(0, 0, 0, 1, 1, 1)], [.5, 0, .5]), 0);          // a top 1 m above the feet is not ground
      near(P.ground(boxes, [-.5, .3 * U, 0]), 0);                       // away from them
      // Walking off the step drops the feet to the table at once.
      const off = P.move([step], [.15, .2 * U, 0], -.2, 0);
      near(off.feet[0], -.05);
      near(off.feet[1], 0);
   });

   await check('physics: a blocked walk slides along the axis that is free, and standing still blocks nothing', () => {
      // A wall across x at .1: moving diagonally into it keeps the z part.
      const across = P.move([wall], [.0, 0, 0], .08, .05);
      assert.ok(across.blocked);
      near(across.feet[0], .0);
      near(across.feet[2], .05);
      const along = P.move([box(-1, 0, .1, 1, 3 * U, .12)], [0, 0, 0], .05, .08);   // a wall across z
      near(along.feet[0], .05);
      near(along.feet[2], 0);
      assert.ok(!P.move([wall], [.1, 0, 0], 0, 0).blocked);
   });

   await check('riding: the avatar on the object moves and turns with it', () => {
      const m = new M.Mapping().setBody(head).setStand([0, .7366 + .1, -.7], .3);
      const from = M.frame([0, .7366, -.7], 0), to = M.frame([.4, .7366, -.5], Math.PI / 2);
      const local = cg.mTransform(cg.mInverse(from), m.stand.p);
      m.carry(from, to);
      nearV(cg.mTransform(cg.mInverse(to), m.stand.p), local, 1e-9);   // the same spot on the object
      near(m.stand.yaw, .3 + Math.PI / 2, 1e-9);
      m.carry(to, from);                                               // put back: as it was
      nearV(m.stand.p, [0, .7366 + .1, -.7], 1e-9);
      near(m.stand.yaw, .3, 1e-9);
   });

   await check('rays: a ray grabs the box it meets, within reach, and misses the rest', () => {
      const b = cube.create({ add: () => ({ identity() { return this; }, move() { return this; }, scale() { return this; }, color() { return this; } }) }).bounds;
      near(R.rayBox({ o: [0, .05, 2], d: [0, 0, -1] }, b), 2 - .05);
      assert.equal(R.rayBox({ o: [0, .05, 2], d: [0, 0, 1] }, b), null);                       // pointing away
      assert.equal(R.rayBox({ o: [.2, .05, 2], d: [0, 0, -1] }, b), null);                     // beside it
      near(R.rayBox({ o: [0, .05, 0], d: [0, 1, 0] }, b), 0);                                  // starting inside
      // A ray mapped into the object's frame (turned and moved).
      const r = R.mapRay(cg.mInverse(M.frame([1, 0, 0], Math.PI / 2)), { o: [1, 1, 1], d: [0, 0, -1] });
      nearV(r.o, [-1, 1, 0], 1e-9);
      nearV(r.d, [1, 0, 0], 1e-9);
   });

   await check('teleport: the ray picks the table top, or the top of the object when that is nearer', () => {
      const onTable = p => Math.abs(p[0]) < 1 && Math.abs(p[2]) < .3, boxes = [box(-.05, 0, -.05, .05, .1, .05)];
      const down = d => ({ o: [-.3, .5, 0], d: cg.normalize(d) });
      let hit = R.pickTop(down([1, -1, 0]), [], onTable);
      nearV(hit.p, [.2, 0, 0], 1e-9);
      assert.equal(hit.onObject, false);
      hit = R.pickTop(down([.3, -.4, 0]), boxes, onTable);                // lands on the cube's top first
      nearV(hit.p, [0, .1, 0], 1e-9);
      assert.equal(hit.onObject, true);
      assert.equal(R.pickTop(down([1, -1, 0]), [], p => p[0] < 0), null);   // off the table
      assert.equal(R.pickTop(down([1, .2, 0]), boxes, onTable), null);      // pointing up
      // The target must be somewhere the avatar fits: not inside a wall.
      assert.ok(P.blocked([wall], [.11, 0, 0]));
      assert.ok(!P.blocked([wall], [.5, 0, 0]));
   });

   await check('the cube is one collider, its bounds', () => {
      const c = cube.create({ add: () => ({ identity() { return this; }, move() { return this; }, scale() { return this; }, color() { return this; } }) });
      assert.deepEqual(c.colliders(), [c.bounds]);
      near(c.bounds.max[1], .1);
   });

   await check('the cube pulses the hand that starts touching it, once', () => {
      const pulses = [];
      const node = () => { const n = { add: () => node(), identity: () => n, move: () => n, scale: () => n, color: () => n }; return n; };
      const c = cube.create(node()), at = p => c.update({ mode: 'avatar', haptic: (...a) => pulses.push(a), hands: [{ hand: 'right', p, trigger: false, pressed: false }] });
      at([.3, .05, 0]); assert.equal(pulses.length, 0);
      at([.052, .05, 0]); at([.052, .05, 0]);
      assert.equal(pulses.length, 1);
      assert.equal(pulses[0][0], 'right');
      at([.3, .05, 0]); at([.052, .05, 0]);
      assert.equal(pulses.length, 2);
   });


   await check('physics: feet that start inside a box can walk out of it, and are not stuck', () => {
      // Put down on the avatar: the feet at x = .11 are inside the wall (x .10 to .12).
      assert.ok(P.blocked([wall], [.11, 0, 0]));
      let r = P.move([wall], [.11, 0, 0], .05, 0);
      assert.ok(!r.blocked);
      near(r.feet[0], .16);
      r = P.move([wall], [.11, 0, 0], -.05, 0);
      near(r.feet[0], .06);
      // Outside, the same wall still stops it, even with the feet just touching its edge.
      assert.ok(P.move([wall], [.1 - P.RADIUS, 0, 0], .01, 0).blocked);
      assert.ok(P.move([wall], [.1 - P.RADIUS + 1e-9, 0, 0], .01, 0).blocked);
   });

   // The house, with a fake node that remembers its colour.
   const u = v => v / 12;
   const made = [];
   const fake = () => { const n = { add: () => fake(), identity: () => n, move: () => n, scale: () => n, turnY: () => n, dull: () => n, color: (...c) => (n.c = c.flat(), n), opacity: () => n }; made.push(n); return n; };
   const makeHouse = () => { made.length = 0; return house.create(fake()); };
   const hand = (name, p, extra = {}) => ({ hand: name, p, ray: { o: [0, 1, 1], d: [0, 0, 1] }, trigger: false, pressed: false, grip: false, gripPressed: false, ...extra });
   const at = (h, mode, hands, dt = 0, pulses = []) => h.update({ mode, t: mode === 'avatar' ? 1 : 0, now: 0, dt, hands, haptic: (...a) => pulses.push(a) });
   const handle = [u(-0.65), u(1.4), u(2.325)], lamp = [u(-.2), u(1.7), u(2.25)];
   const walk = (boxes, feet, dx, dz, n) => { for (let i = 0; i < n; i++) feet = P.move(boxes, feet, dx, dz).feet; return feet; };

   await check('the house is the default object, the cube is still there, and the avatar starts clear of it, facing the door', () => {
      assert.ok(objects.OBJECTS.house && objects.OBJECTS.cube);
      const h = makeHouse();
      near(h.bounds.max[1], 4.5 / 12);
      // 50 cm across, and with the porch 53 cm deep: it fits on a table 61 cm deep.
      assert.ok(h.bounds.max[0] - h.bounds.min[0] < .62 && h.bounds.max[2] - h.bounds.min[2] < .6);
      // The scene's start: the house turned a quarter so its front looks to the near end of the table;
      // the avatar there, in line with the door (1 m left of the middle of the front), facing it.
      assert.match(fs.readFileSync('js/scenes/miniature.js', 'utf8'), /const OBJECT = 'house'/);
      const pose = M.frame([0, 0, 0], -Math.PI / 2), local = cg.mTransform(cg.mInverse(pose), [-.55, 0, -1 / 12]);
      nearV(local, [u(-1), 0, .55], 1e-9);
      assert.ok(!P.blocked(h.colliders(), local));
      // The porch is on the table, and so is the roof when it is set down behind the house.
      assert.ok(h.bounds.max[2] < W.TABLE.size[0] / 2 && 2 * u(2.7) + u(.3) + u(2.7) < W.TABLE.size[0] / 2);
   });

   await check('the house: a closed door and the walls stop the avatar, the steps climb, an open door lets it in', () => {
      const h = makeHouse(), boxes = () => h.colliders();
      // From the table up the steps to the porch: 0.2 m, then 0.4 m.
      let feet = walk(boxes(), [u(-1), 0, u(4.5)], 0, -.004, 10);
      near(feet[1], u(.2));
      feet = walk(boxes(), feet, 0, -.004, 20);
      near(feet[1], u(.4));
      // The closed door stops it on the porch, one radius from the wall.
      feet = walk(boxes(), feet, 0, -.004, 60);
      assert.ok(feet[2] > u(2.4) + P.RADIUS - 1e-9 && feet[2] < u(2.4) + P.RADIUS + .004, 'at the door: ' + feet[2]);
      // Open it, with the avatar's hand at the handle, and walk in.
      at(h, 'avatar', [hand('right', handle, { pressed: true })]);
      at(h, 'avatar', [], .6);
      near(h.state.door, 1);
      feet = walk(boxes(), feet, 0, -.004, 80);
      near(feet[1], u(.4));
      assert.ok(feet[2] < u(2.25), 'inside: ' + feet[2]);
      // The opening is 1 m wide: an avatar 0.5 m wide goes through 0.24 m off its middle but not 0.3 m.
      for (const [off, through] of [[.24, true], [-.24, true], [.3, false], [-.3, false]]) {
         const f = walk(boxes(), [u(-1 + off), u(.4), u(2.8)], 0, -.004, 80);
         assert.equal(f[2] < u(2.25), through, 'offset ' + off);
      }
      // Inside, the walls stop it, the window too (it is glass), and the table is too high to climb.
      feet = walk(boxes(), [u(1), u(.4), 0], .004, 0, 80);
      assert.ok(feet[0] > u(2.85) - P.RADIUS - .004 && feet[0] < u(2.85) - P.RADIUS + 1e-9, 'at the wall: ' + feet[0]);
      near(walk(boxes(), [0, u(.4), 0], 0, -.004, 80)[2], u(-2.25) + P.RADIUS, .004);
      near(walk(boxes(), [u(1.5), u(.4), u(.9)], 0, -.004, 80)[2], u(-.2) + P.RADIUS, .004);
      // Outside the front wall beside the door it is stopped too.
      near(walk(boxes(), [u(2), 0, u(3.2)], 0, -.004, 60)[2], u(2.4) + P.RADIUS, .004);
      // Shut again with the avatar standing in the doorway: it is not stuck, it can walk out, and not back in.
      at(h, 'avatar', [hand('right', [u(-1.5), u(1.4), u(2.325 - .85)], { pressed: true })]);
      at(h, 'avatar', [], .6);
      near(h.state.door, 0);
      feet = walk(boxes(), [u(-1), u(.4), u(2.3)], 0, .004, 40);
      assert.ok(feet[2] > u(2.65), 'out of the doorway: ' + feet[2]);
      feet = walk(boxes(), feet, 0, -.004, 40);
      assert.ok(feet[2] > u(2.4) + P.RADIUS - 1e-9, 'and not back in: ' + feet[2]);
   });

   await check('the door: the trigger near the handle opens and closes it, only from the avatar\'s view, swinging over 0.6 s', () => {
      const h = makeHouse(), pulses = [], count = () => h.colliders().length;
      const full = count();
      at(h, 'player', [hand('right', handle, { pressed: true })]);
      assert.equal(h.state.doorOpen, false, 'my hand is too big for it');
      at(h, 'avatar', [hand('right', [u(-.65), u(1.4), u(1)], { pressed: true })]);
      assert.equal(h.state.doorOpen, false, 'out of reach');
      at(h, 'avatar', [hand('right', handle)], 0, pulses);
      at(h, 'avatar', [hand('right', handle)], 0, pulses);
      assert.equal(pulses.length, 1, 'one pulse when the hand arrives');
      assert.equal(pulses[0][0], 'right');
      at(h, 'avatar', [hand('right', handle, { pressed: true })]);
      assert.equal(h.state.doorOpen, true);
      assert.equal(h.state.door, 0);
      at(h, 'avatar', [], .3);
      near(h.state.door, .5);
      assert.equal(count(), full - 1, 'half way open, the door no longer blocks');
      at(h, 'avatar', [], .3);
      near(h.state.door, 1);
      // The handle swings with the door: at 90 degrees it is 0.85 m in from the hinge.
      at(h, 'avatar', [hand('left', [u(-1.5), u(1.4), u(2.325 - .85)], { pressed: true })]);
      assert.equal(h.state.doorOpen, false);
      at(h, 'avatar', [], .6);
      near(h.state.door, 0);
      assert.equal(count(), full);
   });

   await check('the switch turns the lamp on and off, and the inside brightens', () => {
      const h = makeHouse(), bright = () => made.filter(n => n.c && Math.abs(n.c[0] - .92 * 1.4) < 1e-9 && Math.abs(n.c[1] - .88 * 1.4) < 1e-9).length, dark = () => made.filter(n => n.c && n.c[0] < .4 && Math.abs(n.c[0] - .92 * .35) < 1e-9).length;
      assert.equal(h.state.lamp, false);
      assert.equal(bright(), 0);
      assert.ok(dark() > 5);
      at(h, 'player', [hand('right', lamp, { pressed: true })]);
      assert.equal(h.state.lamp, false);
      at(h, 'avatar', [hand('right', [u(2), u(1.7), u(1)], { pressed: true })]);
      assert.equal(h.state.lamp, false, 'out of reach');
      at(h, 'avatar', [hand('right', lamp, { pressed: true })]);
      assert.equal(h.state.lamp, true);
      assert.ok(bright() > 5 && dark() === 0);
      at(h, 'avatar', [hand('right', lamp, { pressed: true })]);
      assert.equal(h.state.lamp, false);
      assert.ok(dark() > 5);
      // It is the nearer of the switch and the handle that answers.
      const mid = [u(-.43), u(1.55), u(2.29)];
      at(h, 'avatar', [hand('right', mid, { pressed: true })]);
      assert.equal(h.state.doorOpen !== h.state.lamp, true);
   });

   await check('the roof: the trigger on it lifts it off, only from my view, and again sets it back; its collider goes with it', () => {
      const h = makeHouse(), count = () => h.colliders().length, full = count();
      const aim = { ray: { o: [0, .45, .4], d: cg.normalize([0, -.2, -1]) } }, away = { ray: { o: [0, 1, 1], d: [0, 0, 1] } };
      at(h, 'avatar', [hand('right', [0, .3, 0], { ...aim, pressed: true })]);
      assert.equal(h.state.roofOff, false, 'the avatar cannot lift it');
      at(h, 'player', [hand('right', [0, .6, 0], { ...away, pressed: true })]);
      assert.equal(h.state.roofOff, false, 'not pointing at it');
      const pulses = [];
      at(h, 'player', [hand('right', [0, .6, 0], aim)], 0, pulses);
      assert.equal(pulses.length, 1);
      at(h, 'player', [hand('right', [0, .6, 0], { ...aim, pressed: true })]);
      assert.equal(h.state.roofOff, true);
      at(h, 'player', [], .1);
      assert.equal(count(), full - 7, 'the roof boxes go as soon as it lifts');
      at(h, 'player', [], 1.2);
      near(h.state.roof, 1);
      // It is beside the house now (behind it, 5.7 m), on the table; the giant's hand at it puts it back.
      at(h, 'player', [hand('left', [0, u(.5), u(-5.7)], { ...away, pressed: true })]);
      assert.equal(h.state.roofOff, false);
      at(h, 'player', [], .6);
      assert.equal(count(), full - 7);
      at(h, 'player', [], .7);
      assert.equal(h.state.roof, 0);
      assert.equal(count(), full);
      // The roof can be stood on: the slope climbs in steps of less than 0.45 m up to the ridge.
      const tops = h.colliders().filter(b => b.min[1] === u(3)).map(b => b.max[1]);
      near(Math.max(...tops), u(4.3125));
      let feet = [0, u(3.2), u(2.6)];
      feet = walk(h.colliders(), feet, 0, -.003, 70);
      near(feet[1], u(4.3125));
   });

   await check('the apple: the avatar\'s grip picks it up, it follows the hand, and on release rests on the nearest top below', () => {
      const h = makeHouse(), top = u(.4 + .75 + .1), where = () => h.state.apple;
      nearV(where(), [u(1.85), top, u(-.6)], 1e-9);
      const p0 = [u(1.85), u(1.35), u(-.6)];
      at(h, 'player', [hand('right', p0, { gripPressed: true, grip: true })]);
      assert.equal(h.state.held, null, 'my hand cannot pick it up');
      at(h, 'avatar', [hand('right', [u(0), u(1.35), u(0)], { gripPressed: true, grip: true })]);
      assert.equal(h.state.held, null, 'out of reach');
      const pulses = [];
      at(h, 'avatar', [hand('left', p0)], 0, pulses);
      assert.equal(pulses.length, 1);
      at(h, 'avatar', [hand('left', p0, { gripPressed: true, grip: true })], 0, pulses);
      assert.equal(h.state.held.hand, 'left');
      assert.equal(pulses.length, 2, 'and a pulse for the grab');
      // It follows the hand, keeping where it was held.
      const carried = [u(1), u(2), u(1)];
      at(h, 'avatar', [hand('left', carried, { grip: true })]);
      nearV(where(), cg.add(carried, cg.subtract([u(1.85), top, u(-.6)], p0)), 1e-9);
      // Let go over the floor of the house: it rests on the floor (0.4 m).
      const over = [u(-1), u(2.5), u(0)];
      at(h, 'avatar', [hand('left', over, { grip: true })]);
      at(h, 'avatar', [hand('left', over)]);
      assert.equal(h.state.held, null);
      near(where()[1], u(.4 + .1));
      // Let go over the table inside: it stays on the table top, not the floor.
      at(h, 'avatar', [hand('left', cg.add(where(), [0, 0, 0]), { gripPressed: true, grip: true })]);
      at(h, 'avatar', [hand('left', [u(1.5), u(2), u(-.5)], { grip: true })]);
      at(h, 'avatar', [hand('left', [u(1.5), u(2), u(-.5)])]);
      near(where()[1], u(.4 + .75 + .1));
      // Let go beside the house: it rests on the table (y = 0).
      at(h, 'avatar', [hand('left', where(), { gripPressed: true, grip: true })]);
      at(h, 'avatar', [hand('left', [u(5), u(1), u(0)], { grip: true })]);
      at(h, 'avatar', []);
      near(where()[1], u(.1));
      // Let go over the back wall, high up: it lands on the roof's lowest band, the highest top under it.
      at(h, 'avatar', [hand('left', where(), { gripPressed: true, grip: true })]);
      at(h, 'avatar', [hand('left', [u(-2), u(3.5), u(-2.325)], { grip: true })]);
      at(h, 'avatar', [hand('left', [u(-2), u(3.5), u(-2.325)])]);
      near(where()[1], u(3.1875 + .1), 1e-9);
   });

   await check('physics: feet a little way into a wall (touching, or swung there by a snap turn) cannot walk on through it', () => {
      const into = [.1 - P.RADIUS + .003, 0, 0];   // 3 mm in
      assert.ok(P.blocked([wall], into));
      assert.ok(P.move([wall], into, .006, 0).blocked, 'deeper is blocked');
      near(P.move([wall], into, .006, 0).feet[0], into[0]);
      near(P.move([wall], into, -.006, 0).feet[0], into[0] - .006);   // away is free
      near(P.move([wall], into, 0, .006).feet[2], .006);              // along it is free
      let f = into;
      for (let i = 0; i < 60; i++) f = P.move([wall], f, .006, 0).feet;
      assert.ok(f[0] < .1, 'still on this side: ' + f[0]);
      // The real case: against the wall, the head a little off the body, snap turn 30 degrees, walk at the wall.
      // The turn is about the stand point the physics tracks, so it never moves it into the wall.
      const body = M.frame([0, 1.6, 0], 0);
      for (const angle of [Math.PI / 6, -Math.PI / 6]) {
         const m = new M.Mapping().setBody(body).setStand(walk([wall], [0, 0, 0], .006, 0, 60), 0), at = [...m.stand.p];
         m.turn(angle);
         nearV(m.stand.p, at);
         assert.ok(!P.blocked([wall], m.stand.p) || P.blocked([wall], at), 'the turn does not put the stand in the wall');
         assert.ok(walk([wall], m.stand.p, .006, 0, 60)[0] < .1, 'not through the wall after turning ' + angle);
      }
   });

   await check('the avatar can point: its ray at the handle opens the door from 2 m, and brings the apple to its hand', () => {
      const h = makeHouse(), from = [u(-.65), u(1.4), u(4.3)], ray = { o: from, d: [0, 0, -1] };
      at(h, 'avatar', [hand('right', from, { ray: { o: from, d: [0, 0, 1] }, pressed: true })]);
      assert.equal(h.state.doorOpen, false, 'pointing away');
      at(h, 'avatar', [hand('right', [u(-.65), u(1.4), u(5.3)], { ray: { o: [u(-.65), u(1.4), u(5.3)], d: [0, 0, -1] }, pressed: true })]);
      assert.equal(h.state.doorOpen, false, 'too far along the ray');
      at(h, 'player', [hand('right', from, { ray, pressed: true })]);
      assert.equal(h.state.doorOpen, false, 'not from my view');
      at(h, 'avatar', [hand('right', from, { ray, pressed: true })]);
      assert.equal(h.state.doorOpen, true);
      // The apple, pointed at from 1.5 m above it, jumps to the hand.
      const over = [u(1.85), u(1.35 + 1.5), u(-.6)];
      at(h, 'avatar', [hand('left', over, { ray: { o: over, d: [0, -1, 0] }, gripPressed: true, grip: true })]);
      assert.equal(h.state.held.hand, 'left');
      nearV(h.state.apple, over, 1e-9);
   });

   await check('the roof lifts clear of the walls before it comes down, and ends on the table behind the house', () => {
      let roof;
      const node = form => { const n = { add: f => node(f), identity: () => n, move: (...a) => (n.at = a, n), scale: (...a) => (n.s = a, n), turnY: () => n, dull: () => n, color: () => n, opacity: () => n }; if (form === 'miniatureGable') roof = n; return n; };
      const h = house.create(node());
      at(h, 'player', [hand('right', [0, .6, 0], { ray: { o: [0, .45, .4], d: cg.normalize([0, -.2, -1]) }, pressed: true })]);
      for (let i = 0; i <= 24; i++) {
         at(h, 'player', [], i ? .05 : 0);
         const base = roof.at[1] - roof.s[1], front = roof.at[2] + roof.s[2], back = roof.at[2] - roof.s[2];
         // Over the walls (3 m high, from z = -2.4 to 2.4) the base is above their tops, else it is clear of them.
         assert.ok(base > u(3) - 1e-9 || front < u(-2.4) || back > u(2.4), 'roof inside the walls at ' + h.state.roof);
      }
      near(h.state.roof, 1);
      near(roof.at[1] - roof.s[1], 0);
      near(roof.at[2], u(-5.7));
   });

   await check('the apple on the roof falls when the roof lifts', () => {
      const h = makeHouse(), perch = [0, u(3.2), u(2.1)];
      h.state.apple = [...perch];
      at(h, 'avatar', []);
      near(h.state.apple[1], u(3.1875 + .1));
      at(h, 'player', [hand('right', [0, .6, 0], { ray: { o: [0, .45, .4], d: cg.normalize([0, -.2, -1]) }, pressed: true })]);
      at(h, 'player', [], .1);
      at(h, 'player', [], .1);
      near(h.state.apple[1], u(.4 + .1), 1e-9);   // on the floor inside
   });

   await check('a table has its own size: the clamp, the bounds and the drawing follow it, and the default is 60 x 24 in', () => {
      const scales = [];
      const node = () => { const n = { add: () => node(), color: () => n, setMatrix: () => n, identity: () => n, move: () => n, scale: (...a) => (scales.push(a), n), opacity: () => n, child: () => n }; return n; };
      const w = new W.World(node());
      nearV(w.table.size, [60 * .0254, 24 * .0254]);
      w.setTable([2, .75, 1], 0, [1, .5]);                   // 1 m long, 50 cm across
      nearV(w.clamp([5, 0, 5]), [2.5, .75, 1.25]);
      nearV(w.clamp([5, 0, 5], .05), [2.45, .75, 1.2]);
      assert.ok(w.contains([2.4, 3, 1.2]) && !w.contains([2.6, 0, 1]) && !w.contains([2, 0, 1.3]));
      w.setTable([2, .75, 1], Math.PI / 2);                  // turned, the same size kept
      nearV(w.table.size, [1, .5]);
      nearV(w.clamp([2, 0, 5]), [2, .75, 1.5]);              // its length now along z
      w.update(1);
      assert.ok(scales.some(a => Math.abs(a[0] - .5) < 1e-9 && Math.abs(a[2] - .25) < 1e-9), 'the top is drawn at its size');
      w.setTable([0, .75, 0], 0, W.TABLE.size);
      nearV(w.table.size, W.TABLE.size);
      w.setScan(new Float32Array(48));
      assert.ok(w.scan);
      w.setScan(new Float32Array(0));
      assert.equal(w.scan, null, 'an empty scan is no scan');
   });

   // A scanned room turned by 0.4 rad: a table 1.4 x 0.6 m with its length along the room's x, in front of me.
   const yaw = .4, wp = (p) => room.toWorld({ yaw }, p);
   const slab = (x0, z0, x1, z1, top = .74, plate = true) => ({ min: [x0, top - .04, z0], max: [x1, top, z1], mat: 1, plate });
   const scanned = boxes => ({ yaw, min: [-4, 0, -4], max: [4, 2.6, 4], boxes });

   await check('the table: the plate nearest in front within 2 m, turned along its longer side with its z axis towards me', () => {
      const me = wp([0, 1.6, 0]), fwd = [Math.sin(yaw), Math.cos(yaw)];   // facing the room's +z
      const rm = scanned([slab(-.7, .8, .7, 1.4), slab(-.5, -1.2, .5, -.6), slab(-.5, 2.6, .5, 3.2), slab(1, 1, 1.5, 1.5, 1.1, false)]);
      let t = S.pickTable(rm, me, fwd);
      nearV(t.p, wp([0, .74, 1.1]));
      nearV(t.size, [1.4, .6]);
      // The frame: x along the length, z towards me.
      const F = M.frame(t.p, t.yaw), x = cg.mTransform(F, [1, 0, 0]), z = cg.mTransform(F, [0, 0, 1]);
      nearV(cg.subtract(x, t.p).map(Math.abs), wp([1, 0, 0]).map(Math.abs));   // along the room's x, either way
      assert.ok(cg.dot(cg.subtract(z, t.p), cg.subtract(me, t.p)) > 0);
      // Facing the other way, the table behind me is the one nearest, as none is in front within reach.
      t = S.pickTable(rm, me, [-fwd[0], -fwd[1]]);
      nearV(t.p, wp([0, .74, -.9]));
      // Nothing within 2 m, nothing picked; a table that is not a plate is no table.
      assert.equal(S.pickTable(rm, wp([0, 1.6, 6]), fwd), null);
      assert.equal(S.pickTable(scanned([slab(-.5, .8, .5, 1.4, .74, false)]), me, fwd), null);
      assert.equal(S.pickTable(scanned([]), me, fwd), null);
   });

   await check('the table: a longer side along the room\'s z turns the frame a quarter, and I may stand at either side', () => {
      const rm = scanned([slab(1, -.4, 1.5, 1.2)]);   // 0.5 x 1.6 m, centre [1.25, .4]
      for (const side of [-1, 1]) {
         const me = wp([1.25 + side * 1.0, 1.6, .4]);
         const t = S.pickTable(rm, me, cg.normalize([wp([1.25, 0, .4])[0] - me[0], wp([1.25, 0, .4])[2] - me[2]]));
         nearV(t.size, [1.6, .5]);
         const F = M.frame(t.p, t.yaw), x = cg.subtract(cg.mTransform(F, [1, 0, 0]), t.p), z = cg.subtract(cg.mTransform(F, [0, 0, 1]), t.p);
         nearV(x.map(Math.abs), wp([0, 0, 1]).map(Math.abs), 1e-9);   // along the room's z
         assert.ok(cg.dot(z, cg.subtract(me, t.p)) > 0, 'z points to me, side ' + side);
         assert.ok(Math.abs(t.yaw) <= Math.PI + 1e-9);
      }
   });

   // The mesh in the echohunt layout (18 floats a vertex, normal at 3), from positions and normals.
   const meshOf = (verts, indices) => {
      const V = new Float32Array(verts.length * 18);
      verts.forEach(([p, n], i) => V.set([...p, ...n], i * 18));
      return { vertices: V, indices: new Uint32Array(indices) };
   };
   const unpackAB = ab => [2 * Math.floor(ab) / 40000 - 1, 2 * (ab % 1) - 1];
   const unpackRGB = c => { c = c * 256 >> 0; return [(c & 255) / 255, (c >> 8 & 255) / 255, (c >> 16 & 255) / 255]; };
   const tri = (m, k) => [0, 1, 2].map(j => Array.from(m.slice((3 * k + j) * 16, (3 * k + j) * 16 + 3)));

   await check('the room mesh: Clay\'s layout, wound to face the normals, coloured by the facing', () => {
      const up = [0, 1, 0], side = [0, 0, 1], quad = (y, n) => [[[0, y, 0], n], [[1, y, 0], n], [[1, y, 1], n], [[0, y, 1], n]];
      // A floor at 0 and a table top at .74 (both facing up), a ceiling facing down, a wall facing +z; the floor is wound the wrong way (clockwise from above), the table top the right way.
      const v = [...quad(0, up), ...quad(.74, up), ...quad(2.6, [0, -1, 0]), ...[[[0, 0, 0], side], [[1, 0, 0], side], [[1, 1, 0], side], [[0, 1, 0], side]]];
      const idx = [0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 8, 9, 10, 8, 10, 11, 12, 13, 14, 12, 14, 15];
      const m = S.roomMesh({ min: [-4, 0, -4], mesh: meshOf(v, idx) });
      assert.equal(m.length, 8 * 3 * 16);
      assert.ok(m instanceof Float32Array);
      for (let k = 0; k < 8; k++) {
         const [a, b, c] = tri(m, k), face = cg.cross(cg.subtract(b, a), cg.subtract(c, a));
         // Counter-clockwise from the side the vertex normal points to.
         const n = [0, 1, 2].map(i => unpackAB(m[(3 * k) * 16 + 3 + i])[0]);
         assert.ok(cg.dot(face, n) > 0, 'triangle ' + k + ' faces its normal');
         near(cg.norm(n), 1, .01);
         assert.deepEqual(Array.from(m.slice(3 * k * 16 + 9, 3 * k * 16 + 15)), [1, 0, 0, 0, 0, 0]);   // weights
         assert.equal(m[3 * k * 16 + 15], 0);
      }
      const colour = k => unpackRGB(m[3 * k * 16 + 8]);
      const same = (a, b) => a.every((x, i) => Math.abs(x - b[i]) < 1 / 128);
      assert.ok(same(colour(0), S.colour(up, 0, 0)) && same(colour(1), S.colour(up, 0, 0)), 'the floor');
      assert.ok(same(colour(2), S.colour(up, .74, 0)) && !same(colour(2), colour(0)), 'a top, higher up');
      assert.ok(same(colour(4), S.colour([0, -1, 0], 2.6, 0)), 'the ceiling');
      assert.ok(same(colour(6), S.colour(side, .5, 0)) && !same(colour(6), colour(0)) && !same(colour(6), colour(2)), 'a wall');
      nearV(unpackAB(m[3]), [0, 0], 1e-3);   // the floor's normal x, and the tangent's
   });

   await check('the room mesh: over the limit it is merged to fit, a grid of cells that covers the same ground', () => {
      const n = 60, verts = [], idx = [];
      for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) verts.push([[i * .04, 0, j * .04], [0, 1, 0]]);
      for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
         const a = j * (n + 1) + i;
         idx.push(a, a + n + 1, a + 1, a + 1, a + n + 1, a + n + 2);
      }
      const rm = { min: [0, 0, 0], mesh: meshOf(verts, idx) };
      assert.equal(S.roomMesh(rm).length / 48, 2 * n * n);   // as it is
      const small = S.roomMesh(rm, 500), tris = small.length / 48;
      assert.ok(tris > 50 && tris <= 500, 'merged to ' + tris);
      let area = 0;
      for (let k = 0; k < tris; k++) { const [a, b, c] = tri(small, k); area += cg.norm(cg.cross(cg.subtract(b, a), cg.subtract(c, a))) / 2; }
      assert.ok(Math.abs(area - 2.4 * 2.4) < .6, 'the same ground: ' + area);
      assert.ok(S.MAX_TRIS <= 60000 && S.roomMesh({ min: [0, 0, 0], mesh: meshOf([], []) }).length === 0);
   });

   await check('the room mesh for drawing: 20 bytes a vertex, position, normal and colour unpacked from Clay\'s packing', () => {
      const v = [[0, 0, 2], [1, 0, 2], [0, 1, 2]], idx = [0, 1, 2];
      const mesh = S.roomMesh({ min: [0, 0, 0], mesh: meshOf(v.map(p => [p, [0, 0, 1]]), idx) }), buf = S.compact(mesh);
      assert.equal(buf.byteLength, 3 * 20);
      const f = new Float32Array(buf), s = new Int8Array(buf), u = new Uint8Array(buf);
      for (let k = 0; k < 3; k++) {
         nearV([...f.slice(5 * k, 5 * k + 3)], mesh.slice(16 * k, 16 * k + 3), 1e-6);
         nearV([...s.slice(20 * k + 12, 20 * k + 15)].map(x => x / 127), [0, 0, 1], 1e-3);   // the normal, as the scan says
         nearV([...u.slice(20 * k + 16, 20 * k + 19)].map(x => x / 256), [.62, .64, .68].map(c => Math.floor(256 * c) / 256), 1e-9);   // a wall's colour
      }
   });

   await check('the room mesh leaves out the scanned table\'s top, which the world draws itself', () => {
      const t = slab(-.2, -1.3, 1.2, -.7), rm = scanned([t]);
      const top = S.tableTop(rm, t), at = p => room.toWorld(rm, p);
      assert.ok(top(at([.5, .74, -1])) && top(at([1.21, .72, -.7])), 'the top, a little off');
      assert.ok(!top(at([.5, .5, -1])) && !top(at([.5, .9, -1])) && !top(at([1.4, .74, -1])), 'not under it, on it or beside it');
      assert.ok(S.pickTable(rm, at([.5, 1.6, 0]), [0, -1]).box === t);
      // A floor quad facing up at .74 inside the table, and one beside it.
      const quad = (x0, x1) => [[[x0, .74, -1], [0, 1, 0]], [[x1, .74, -1], [0, 1, 0]], [[x1, .74, -.9], [0, 1, 0]]].map(([p, n]) => [at(p), n]);
      const mesh = { min: [-4, 0, -4], mesh: meshOf([...quad(0, .2), ...quad(2, 2.2)], [0, 1, 2, 3, 4, 5]) };
      assert.equal(S.roomMesh(mesh).length / 48, 2);
      const kept = S.roomMesh(mesh, S.MAX_TRIS, top);
      assert.equal(kept.length / 48, 1);
      near(room.toRoom(rm, Array.from(kept.slice(0, 3)))[0], 2);
   });

   console.log(passed + ' miniature checks passed.');
})().catch(e => { console.error(e); process.exit(1); });
