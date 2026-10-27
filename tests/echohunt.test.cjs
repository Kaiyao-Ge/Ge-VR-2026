// Echo Hunt checks without a browser: the room from boxes and from scanned
// meshes, the sound field, and the moths, catches and rounds.
// Run: node tests/echohunt.test.cjs
const assert = require('node:assert/strict');
const load = require('./esm.cjs');

let passed = 0;
const check = async (name, fn) => { await fn(); passed++; console.log('ok -', name); };
const near = (a, b, e = 1e-6) => assert.ok(Math.abs(a - b) < e, `${a} vs ${b}`);

(async () => {
   const R = await load('js/scenes/echohunt/room.js');
   const F = await load('js/scenes/echohunt/field.js');
   const G = await load('js/scenes/echohunt/game.js');

   await check('the virtual room draws 6 faces per box, facing into the room and out of the furniture', () => {
      const room = R.virtualRoom(), { vertices, indices } = R.buildGeometry(room);
      assert.equal(vertices.length / R.STRIDE, (room.boxes.length + 1) * 24);
      assert.equal(indices.length, (room.boxes.length + 1) * 36);
      const v = i => Array.from(vertices.slice(i * R.STRIDE, (i + 1) * R.STRIDE));
      const floor = [...Array(24).keys()].map(v).find(x => x[1] === 0 && x[4] === 1);
      assert.ok(floor, 'the floor faces up');
      assert.equal(floor[10], R.MAT.wood);
   });

   // A 4 x 2.5 x 3 m room turned by 30 degrees, a table in it, and a whole-room mesh.
   const yaw = Math.PI / 6;
   const turn = ([x, y, z]) => R.toWorld({ yaw }, [x, y, z]);
   function boxMesh(label, min, max, inward) {
      const P = [], I = [];
      for (let a = 0; a < 3; a++) for (const s of [-1, 1]) {
         const b = (a + 1) % 3, c = (a + 2) % 3, first = P.length / 3;
         for (const [i, j] of [[0, 0], [1, 0], [1, 1], [0, 1]]) {
            const p = []; p[a] = s > 0 ? max[a] : min[a]; p[b] = i ? max[b] : min[b]; p[c] = j ? max[c] : min[c];
            P.push(...turn(p));
         }
         const out = s > 0 !== !!inward;
         I.push(...(out ? [first, first + 1, first + 2, first, first + 2, first + 3] : [first, first + 2, first + 1, first, first + 3, first + 2]));
      }
      return { label, positions: new Float32Array(P), indices: new Uint32Array(I) };
   }
   const table = boxMesh('table', [-.5, 0, -.4], [.5, .75, .4]);
   const scanned = [boxMesh('global mesh', [-2, 0, -1.5], [2, 2.5, 1.5], true), table];

   await check('a scanned room is turned to its walls, bounded by them, with the table as a box', () => {
      const room = R.roomFromMeshes(scanned);
      const a = ((room.yaw - yaw) % (Math.PI / 2) + Math.PI / 2) % (Math.PI / 2);
      assert.ok(a < 1e-3 || Math.PI / 2 - a < 1e-3, 'yaw matches the walls');
      // Whichever quarter turn it chose, the room spans 4 x 3 m.
      const span = [0, 2].map(i => room.max[i] - room.min[i]).sort();
      near(span[0], 3, 1e-3); near(span[1], 4, 1e-3); near(room.max[1], 2.5, 1e-3);
      assert.equal(room.boxes.length, 1);
      assert.equal(room.boxes[0].mat, R.MAT.wood);
      assert.ok(room.boxes[0].plate);
   });

   await check('scanned triangles take the material of the furniture they lie in, and the table top is a plate', () => {
      const room = R.roomFromMeshes([boxMesh('global mesh', [-2, 0, -1.5], [2, 2.5, 1.5], true),
         { ...boxMesh('couch', [-1.8, 0, -1.4], [-1, .8, -.6]) }]);
      const withTable = R.roomFromMeshes([...scanned.slice(0, 1), table]);
      assert.equal(room.boxes[0].mat, R.MAT.fabric);
      // The global mesh is the only drawn mesh: 12 triangles, floor wood and the rest concrete.
      assert.equal(withTable.scan.mats.length, 12);
      const mats = [...withTable.scan.mats].sort();
      assert.deepEqual(mats, [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1]);
      const geo = R.buildGeometry(withTable);
      assert.equal(geo.indices.length, 36);
      // A table top inside the whole-room mesh: its triangles get the table's face coordinates.
      const both = R.roomFromMeshes([{ ...scanned[0], positions: Float32Array.from([...scanned[0].positions, ...table.positions]),
         indices: Uint32Array.from([...scanned[0].indices, ...table.indices.map(i => i + scanned[0].positions.length / 3)]) }, table]);
      const plates = [...both.scan.plates].filter(p => p >= 0);
      assert.equal(plates.length, 2);
      const g = R.buildGeometry(both), uv = [];
      for (let i = 0; i < g.vertices.length / R.STRIDE; i++) if (g.vertices[i * R.STRIDE + 11] === 1) uv.push(g.vertices[i * R.STRIDE + 6], g.vertices[i * R.STRIDE + 7]);
      assert.ok(uv.length && uv.every(x => x > -1e-4 && x < 1 + 1e-4));
   });

   await check('a quick sweep of hit points finds the turned walls, the floor, a table top and a couch', async () => {
      const S = await load('js/scenes/echohunt/scan.js');
      let seed = 3;
      const rand = () => (seed = seed * 16807 % 2147483647) / 2147483647;
      const sweep = new S.Sweep();
      // Points on a face of a box (room frame): axis a at value v, normal sign s, over [lo, hi] on the other two axes.
      const face = (a, v, s, lo, hi, n) => {
         for (let k = 0; k < n; k++) {
            const p = [0, 1, 2].map(i => lo[i] + (hi[i] - lo[i]) * rand() + (rand() - .5) * .01), nor = [0, 0, 0];
            p[a] = v; nor[a] = s;
            sweep.add(turn(p), turn(nor));
         }
      };
      face(1, 0, 1, [-2, 0, -1.5], [2, 0, 1.5], 6000);                  // floor
      face(0, -2, 1, [0, 0, -1.5], [0, 2.5, 1.5], 3000);               // walls
      face(0, 2, -1, [0, 0, -1.5], [0, 2.5, 1.5], 3000);
      face(2, -1.5, 1, [-2, 0, 0], [2, 2.5, 0], 3000);
      face(1, 2.5, -1, [-2, 0, -1.5], [2, 0, 1.5], 800);               // a little of the ceiling
      face(1, .75, 1, [-.5, 0, -.4], [.5, 0, .4], 1500);               // table top
      face(1, .45, 1, [1, 0, .6], [1.8, 0, 1.4], 1000);                // couch: top and sides
      face(0, 1, -1, [0, 0, .6], [0, .45, 1.4], 400);
      const room = sweep.room();
      const a = ((room.yaw - yaw) % (Math.PI / 2) + Math.PI / 2) % (Math.PI / 2);
      assert.ok(a < .02 || Math.PI / 2 - a < .02, 'yaw matches the walls');
      near(room.min[1], 0, .02); near(room.max[1], 2.5, .02);
      const span = [0, 2].map(i => room.max[i] - room.min[i]).sort();
      near(span[0], 3, .1); near(span[1], 4, .1);
      const table = room.boxes.find(b => b.plate), couch = room.boxes.find(b => b.mat === R.MAT.fabric);
      assert.ok(table && couch, JSON.stringify(room.boxes));
      near(table.max[1], .75, .03); assert.ok(table.min[1] > .65, 'sound passes under the table');
      near(couch.max[1], .45, .03); near(couch.min[1], 0, .02);
      // Pieces as rectangles: together they cover the couch, and nothing else is there.
      assert.ok(room.boxes.every(b => b.plate || b.mat === R.MAT.fabric));
      assert.ok(room.boxes.filter(b => !b.plate).length <= 3, 'a few pieces');
      assert.equal(R.buildGeometry(room).indices.length, (room.boxes.length + 1) * 36);
   });

   await check('depth frames fuse into a mesh whose walls, floor, bed and table are within a few centimetres', async () => {
      const T = await load('js/scenes/echohunt/tsdf.js'), S = await load('js/scenes/echohunt/scan.js');
      let seed = 11;
      const rand = () => (seed = seed * 16807 % 2147483647) / 2147483647;
      // Room frame: walls 4 x 3 m, ceiling 2.5 m, the floor at -0.3 as on the headset; a bed and a table top.
      const F = -.3, solids = [{ min: [-2, -.3, -1.5], max: [-.6, .25, .5] }, { min: [.6, .42, -1.5], max: [1.8, .46, -.9] }];
      const hit = (o, d) => {   // nearest surface along a ray, room frame
         let t = Infinity;
         for (let a = 0; a < 3; a++) for (const v of a === 1 ? [F, F + 2.5] : a === 0 ? [-2, 2] : [-1.5, 1.5]) {
            const s = (v - o[a]) / d[a];
            if (s > 0) t = Math.min(t, s);
         }
         for (const b of solids) {
            let tin = 0, tout = Infinity;
            for (let a = 0; a < 3; a++) { const t1 = (b.min[a] - o[a]) / d[a], t2 = (b.max[a] - o[a]) / d[a]; tin = Math.max(tin, Math.min(t1, t2)); tout = Math.min(tout, Math.max(t1, t2)); }
            if (tin < tout && tin > 0) t = Math.min(t, tin);
         }
         return t;
      };
      const eye = [.2, 1.4, .3], vol = new T.Volume([turn(eye)[0], F - .1, turn(eye)[2]]);
      const t0 = Date.now();
      // 120 frames turning around and looking down, 80 x 80 rays over 90 degrees, 1 cm of noise per 2 m.
      for (let f = 0; f < 120; f++) {
         const yawc = f / 120 * 2 * Math.PI, pitch = -.2 - .6 * (f % 3) / 2, pts = [];
         for (let i = 0; i < 80; i++) for (let j = 0; j < 80; j++) {
            const x = (i / 79 * 2 - 1), y = (j / 79 * 2 - 1);
            let d = [x, y, -1];
            d = [d[0], d[1] * Math.cos(pitch) - d[2] * Math.sin(pitch), d[1] * Math.sin(pitch) + d[2] * Math.cos(pitch)];
            d = [d[0] * Math.cos(yawc) + d[2] * Math.sin(yawc), d[1], -d[0] * Math.sin(yawc) + d[2] * Math.cos(yawc)];
            const l = Math.hypot(...d); d = d.map(v => v / l);
            const t = hit(eye, d) * (1 + (rand() - .5) * .01);
            pts.push(...turn(eye.map((v, k) => v + d[k] * t)));
         }
         vol.integrate(pts, turn(eye));
      }
      const t1 = Date.now(), mesh = vol.mesh(), t2 = Date.now();
      console.log(`   fused 120 frames in ${t1 - t0} ms, meshed in ${t2 - t1} ms: ${mesh.positions.length / 3} vertices, ${mesh.indices.length / 3} triangles`);
      // Every vertex lies on a true surface, within 2 cm.
      let worst = 0; const errs = [];
      for (let v = 0; v < mesh.positions.length; v += 3 * 7) {
         const p = R.toRoom({ yaw }, [mesh.positions[v], mesh.positions[v + 1], mesh.positions[v + 2]]);
         const planes = [Math.abs(p[0] + 2), Math.abs(p[0] - 2), Math.abs(p[2] + 1.5), Math.abs(p[2] - 1.5), Math.abs(p[1] - F), Math.abs(p[1] - F - 2.5)];
         const box = b => Math.max(...[0, 1, 2].map(a => Math.max(b.min[a] - p[a], p[a] - b.max[a])));
         const e = Math.min(...planes, ...solids.map(b => Math.abs(box(b))));
         errs.push(e); worst = Math.max(worst, e);
      }
      errs.sort((a, b) => a - b);
      console.log(`   vertex error: median ${(errs[errs.length >> 1] * 100).toFixed(1)} cm, 95% ${(errs[Math.floor(errs.length * .95)] * 100).toFixed(1)} cm, worst ${(worst * 100).toFixed(1)} cm`);
      assert.ok(errs[Math.floor(errs.length * .95)] < .02, "95% of vertices within 2 cm");
      const room = S.meshRoom(mesh);
      near(room.min[1], F, .03); near(room.max[1], F + 2.5, .03);
      const span = [0, 2].map(i => room.max[i] - room.min[i]).sort();
      near(span[0], 3, .06); near(span[1], 4, .06);
      const bed = room.boxes.find(b => b.mat === R.MAT.fabric), table = room.boxes.find(b => b.plate);
      assert.ok(bed && table, JSON.stringify(room.boxes));
      near(bed.max[1], .25, .04); near(table.max[1], .46, .04);
      // Its grid: the bed's top solid, the air in the room and above the bed free, and sound round the bed.
      const P = await load('js/scenes/echohunt/paths.js'), g = P.gridFromVolume(vol, room), w = p => turn(p);
      assert.ok(P.solidAt(g, w([-1.3, .25, -.5])), 'the bed top');
      assert.ok(!P.solidAt(g, w([.5, 1.2, .5])) && !P.solidAt(g, w([-1.3, .6, -.5])), 'the air');
      const t3 = Date.now(), f = P.pathField(g, w([.5, 1.4, 1]));
      console.log(`   path field over ${g.n.join(' x ')} cells in ${Date.now() - t3} ms`);
      assert.ok(P.excessAt(g, f, w([-1.9, .02 - .3 + .35, 1.2])) < .1, 'beside the bed, in sight');
      const geo = R.buildGeometry(room);
      assert.equal(geo.vertices.length, mesh.positions.length / 3 * R.STRIDE);
      assert.ok(geo.vertices.some((x, i) => i % R.STRIDE === 11 && x === 1), 'the table top is a plate');
   });

   await check('sound goes round a partition: later and weaker behind it, straight in the open, nowhere inside a closed box', async () => {
      const P = await load('js/scenes/echohunt/paths.js');
      // 6 x 3 x 4 m, a partition 2 m high across the middle with a gap at one end, and a closed cupboard.
      const room = { yaw: .3, min: [-3, 0, -2], max: [3, 3, 2], boxes: [{ min: [-.05, 0, -2], max: [.05, 2, 1] }, { min: [2, 0, 1], max: [2.8, 2, 1.8] }] };
      const g = P.gridFromBoxes(room), at = p => R.toWorld(room, p);
      const t0 = Date.now(), f = P.pathField(g, at([-1.5, 1.5, 0])), ms = Date.now() - t0;
      console.log(`   path field over ${g.n.join(' x ')} cells in ${ms} ms`);
      const ex = p => P.excessAt(g, f, at(p));
      assert.ok(ex([-2.5, 1, -1.5]) < .06, 'in the open, straight');
      // Behind the partition, low down: over it or round its end. At least the way over the top is longer.
      // Over the top (2 m, and the grid's cells beyond it), the shortest way: about 0.6 m more than straight.
      const top = [0, 2.12, -.4], src = [-1.5, 1.5, 0], dst = [1.5, .5, -1];
      const over = Math.hypot(...top.map((v, i) => v - src[i])) + Math.hypot(...dst.map((v, i) => v - top[i])) - Math.hypot(...dst.map((v, i) => v - src[i]));
      const behind = ex(dst);
      assert.ok(behind > over * .8 && behind < over + .25, `${behind} vs about ${over}`);
      assert.equal(ex([2.4, 1, 1.4]), Infinity, 'inside the cupboard');
      // What a moth there hears: less, later.
      const fld = new F.Field();
      fld.pulse(0, { pos: at([-1.5, 1.5, 0]), bands: [1, 1, 1], strength: 1, dur: 2 });
      const live = fld.live(.1), hear = (p, t) => fld.intensityAt(at(p), t, live, (a, q) => P.excessAt(g, f, q), .12);
      assert.ok(hear([1.5, .5, -1], 1.2) < hear([-1.5, .5, -1], 1.2) * .6, 'weaker behind');
   });

   await check('a moth never flies into the solid cells of a grid', async () => {
      const P = await load('js/scenes/echohunt/paths.js');
      const room = { yaw: 0, min: [-2, 0, -2], max: [2, 2.5, 2], boxes: [] };
      // A grid with a solid pillar the moths do not know as a box.
      const g = P.gridFromBoxes({ ...room, boxes: [{ min: [-.5, 0, -.5], max: [.5, 2.5, .5] }] });
      let seed = 9;
      const game = new G.Game(room, () => (seed = seed * 16807 % 2147483647) / 2147483647);
      game.solid = p => P.solidAt(g, p);
      game.moths.forEach(m => game.spawn(m, [], 0));
      for (let k = 0; k < 3000; k++) {
         game.step(k / 60, 1 / 60, []);
         for (const m of game.moths) assert.ok(!(Math.abs(m.p[0]) < .45 && Math.abs(m.p[2]) < .45), 'inside the pillar');
      }
   });

   await check('a box between two points blocks the sound; one beside them does not', () => {
      const boxes = [{ min: [-1, 0, -1], max: [1, 1, 1] }];
      assert.ok(R.blocked(boxes, [-2, .5, 0], [2, .5, 0]));
      assert.ok(!R.blocked(boxes, [-2, 1.5, 0], [2, 1.5, 0]));
      assert.ok(!R.blocked(boxes, [-2, .5, 0], [-1.5, .5, 0]));
   });

   await check('a voice is recorded with each material\'s afterglow and reaches a point after distance / speed', () => {
      const f = new F.Field();
      f.record(0, [0, 0, 0, 0]);
      f.track(0, 0, [0, 1.5, 0], [0, 0, -1]);
      f.record(.1, [.8, .8, .8, 1]);
      f.record(.4, [0, 0, 0, 0]);
      const sources = f.live(.4);
      assert.equal(sources.length, 1);
      assert.equal(sources[0].c[3], 0);
      // The voice at 0.1 s reaches 1.5 m ahead (0.3 s at 5 m/s) at 0.4 s, and not yet 3 m ahead.
      const none = () => 0;
      assert.ok(f.intensityAt([0, 1.5, -1.5], .4, sources, none, .12) > .1);
      near(f.intensityAt([0, 1.5, -3], .4, sources, none, .12), 0);
      assert.equal(f.intensityAt([0, 1.5, -1.5], .4, sources, () => Infinity, .12), 0, 'no way round');
      // Metal rings on after the voice stopped; fabric does not.
      const at = (k, t) => f.ring[((0 * 5 + k) * F.SLOTS + Math.floor(t / F.DT) % F.SLOTS) * 4];
      assert.ok(at(R.MAT.metal, .3) > .5 && at(R.MAT.fabric, .3) < .1);
   });

   await check('remote voice slots play back in order on their channel; pulses fade after the history', () => {
      const f = new F.Field();
      f.record(0, [0, 0, 0, 0]);
      f.push(2, [[.5, .5, .5, 0], [.9, .9, .9, 0]]);
      f.record(F.DT, [0, 0, 0, 0]);
      const o = k => ((2 * 5 + 2) * F.SLOTS + k) * 4;
      near(f.ring[o(1)], .5, 1e-6);
      f.record(2 * F.DT, [0, 0, 0, 0]);
      near(f.ring[o(2)], .9, 1e-6);
      f.pulse(0, { pos: [0, 0, 0], bands: [1, 1, 1] });
      assert.equal(f.live(.1).filter(s => s.c[3] < 0).length, 1);
      f.record(F.HISTORY + .1, [0, 0, 0, 0]);
      assert.equal(f.pulses.length, 0);
      // A backlog plays two slots per slot until it is short again, so a remote voice is never far behind.
      f.push(1, Array.from({ length: 40 }, (_, i) => [i / 40, 0, 0, 0]));
      f.record(F.HISTORY + .1 + 10 * F.DT, [0, 0, 0, 0]);
      assert.ok(f.queues[1].length < 25 && f.queues[1].length > 10, `${f.queues[1].length}`);
   });

   await check('only the two taps nearest the listener, and the newest three clicks, are drawn at once', () => {
      const f = new F.Field(), ear = [0, 1.6, 0], tap = (t, x) => f.capped(t, { pos: [x, 1, 0], bands: [1, 1, 1], life: .6 }, 'tap', 2, p => -Math.hypot(p[0] - ear[0], p[1] - ear[1], p[2] - ear[2]));
      assert.ok(tap(0, 3) && tap(0, 2));
      assert.ok(!tap(.1, 4), 'farther than both: not drawn');
      assert.ok(tap(.1, 1), 'nearer: drawn instead of the farthest');
      assert.deepEqual(f.pulses.map(p => p.pos[0]).sort(), [1, 2]);
      assert.ok(tap(.7, 5), 'the others are over');
      f.pulse(.7, { pos: [9, 1, 0], bands: [1, 1, 1] });
      assert.ok(tap(.7, 6) && !tap(.7, 7), 'other sounds do not count');
      // Clicks held down: the newest three.
      const g = new F.Field(), click = t => g.capped(t, { pos: [0, 1, 0], bands: [1, 1, 1], life: 1.2 }, 'click', 3, (p, now) => now);
      for (let k = 0; k < 6; k++) assert.ok(click(k * .3));
      const drawn = g.pulses.filter(p => p.end > 1.5);
      assert.ok(drawn.length === 3 && Math.min(...drawn.map(p => p.t0)) > .8, 'the newest three');
   });

   await check('steady microphone noise lights nothing; a voice above it does', () => {
      let amp = .01;
      const an = { fftSize: 2048, context: { sampleRate: 48000 },
         getFloatTimeDomainData: t => { for (let i = 0; i < t.length; i++) t[i] = amp * Math.sin(i * .3); },
         getFloatFrequencyData: f => f.fill(-30) };
      const state = { time: new Float32Array(2048), freq: new Float32Array(1024), slow: 0 };
      // -43 dB of fan noise is above the fixed -55 dB gate.
      for (let k = 0; k < 200; k++) F.listen(an, state);
      assert.deepEqual(F.listen(an, state).bands.slice(0, 3), [0, 0, 0]);
      amp = .1;   // 20 dB louder
      assert.ok(F.listen(an, state).bands.some(b => b > .1));
   });

   await check('moths stay in the room and out of the furniture, and tap when they bounce', () => {
      let seed = 7;
      const rand = () => (seed = seed * 16807 % 2147483647) / 2147483647;
      const room = R.virtualRoom(), game = new G.Game(room, rand);
      game.start(0, [[0, 1.6, 0]]);
      let taps = 0;
      for (let k = 0; k < 3000; k++) {
         taps += game.step(k / 60, 1 / 60, [[0, 1.6, 0]]).filter(e => e.k === 'tap').length;
         for (const m of game.moths) {
            for (let j = 0; j < 3; j++) assert.ok(m.p[j] >= room.min[j] && m.p[j] <= room.max[j]);
            for (const b of room.boxes) assert.ok(!m.p.every((x, j) => x > b.min[j] && x < b.max[j]), 'inside furniture');
            assert.ok(Math.hypot(m.p[0], m.p[1] - 1.6, m.p[2]) >= G.HEAD + G.RADIUS - 1e-9, 'inside a head');
         }
      }
      assert.ok(taps > 20, `${taps} taps in 50 s`);
   });

   await check('a moth caught in a gap between two boxes starts again elsewhere instead of tapping on', () => {
      // Two boxes over half the room, 2 cm apart.
      const room = { yaw: 0, min: [-2, 0, -2], max: [2, 2.5, 2], boxes: [{ min: [-2, 0, -2], max: [-.01, 2.5, 0] }, { min: [.01, 0, -2], max: [2, 2.5, 0] }] };
      let seed = 5;
      const game = new G.Game(room, () => (seed = seed * 16807 % 2147483647) / 2147483647);
      game.start(0);
      game.moths.forEach(m => { m.p = [0, 1.2, -1]; m.v = [.3, 0, 0]; });
      let taps = 0;
      for (let k = 0; k < 120; k++) taps += game.step(k / 60, 1 / 60, []).filter(e => e.k === 'tap').length;
      assert.ok(taps < 6 * game.moths.length, `${taps} taps in 2 s`);
   });

   await check('moths fly only during a round; a hit counts, the moth comes back, and the round ends with the bell', () => {
      const game = new G.Game(R.virtualRoom());
      assert.ok(game.moths.every(m => !m.alive), 'none before the start');
      game.step(5, .01, []);
      assert.ok(game.moths.every(m => !m.alive), 'nor later, without a round');
      assert.equal(game.catch(0, 5), null);
      assert.equal(game.start(10, [[0, 1.6, 0]]).k, 'start');
      assert.ok(game.moths.every(m => m.alive), 'all at the start');
      assert.equal(game.catch(0, 11).k, 'catch');
      assert.equal(game.catch(0, 11), null, 'already caught');
      game.catch(1, 12);
      assert.equal(game.hits, 2);
      game.step(13.1, .01, []);
      assert.ok(game.moths[0].alive, 'back after 2 s');
      near(game.remaining(20), G.ROUND - 10);
      assert.equal(game.step(10 + G.ROUND, .01, []).filter(e => e.k === 'end').length, 1);
      assert.ok(!game.running && game.moths.every(m => !m.alive), 'gone at the end');
      game.start(100);
      assert.equal(game.hits, 0, 'a new round counts from 0');
   });

   await check('a shot hits the nearest seen moth near the ray, and misses the unseen', () => {
      const ray = { o: [0, 1.5, 0], d: [0, 0, -1] };
      assert.equal(G.aim(ray, [[0, 1.5, -3], [.05, 1.5, -1], null]), 1);
      assert.equal(G.aim(ray, [[.3, 1.5, -1], [0, 1.5, 2]]), null, 'off the ray, behind');
      assert.equal(G.aim(ray, [[.3, 1.5, -8]]), 0, 'far away the ray is wider');
      assert.equal(G.aim(ray, [null]), null);
   });

   console.log(`${passed} echohunt checks passed.`);
})().catch(e => { console.error(e); process.exit(1); });
