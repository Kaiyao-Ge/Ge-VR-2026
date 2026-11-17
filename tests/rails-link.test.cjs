// Rails checks without a browser: the wire format (every message shape and its validation), the link that pairs
// the headset with the laptop (roles, strangers, reloads, order, stalls, silence), the store that saves modules and the
// layout through the server, and the line the scene logs. The transport is a fake queue and a fake clock.
// Run: node tests/rails-link.test.cjs
const assert = require('node:assert/strict');
const load = require('./esm.cjs');

let passed = 0;
const check = async (name, fn) => { await fn(); passed++; console.log('ok -', name); };

(async () => {
   const W = await load('js/scenes/rails/wire.js');
   const V = await load('js/scenes/rails/values.js');
   const L = await load('js/scenes/rails/link.js');
   const St = await load('js/scenes/rails/store.js');
   const Rp = await load('js/scenes/rails/report.js');
   const Rt = await load('js/scenes/rails/runtime.js');
   const Sn = await load('js/scenes/rails/snapshotter.js');
   const Pl = await load('js/scenes/rails/replay.js');
   const Tp = await load('js/scenes/rails/templates.js');

   // ---- wire ----------------------------------------------------------------------------------------------------
   const env = (m, seq = 0) => ({ from: 3, epoch: 'e1', seq, t: 1000, ...m });
   const mods = { c: false, a: false, s: false, m: false };
   const keyEv = { k: 'key', d: 'down', key: 'a', code: 'KeyA', mods, rep: false };
   const goodMessages = {
      hello: env({ type: 'hello', role: 'ide', rank: 2, caps: { mac: false } }),
      helloEcho: env({ type: 'hello', role: 'runtime', rank: 1, caps: { mac: true }, echo: { seq: 4, t: 990 } }),
      key: env({ type: 'in', ev: keyEv }),
      paste: env({ type: 'in', ev: { k: 'paste', text: 'hello\nworld' } }),
      wheel: env({ type: 'in', ev: { k: 'wheel', dx: 0, dy: -120.5 } }),
      btn: env({ type: 'in', ev: { k: 'btn', d: 'up' } }),
      blur: env({ type: 'in', ev: { k: 'blur' } }),
      dev: env({ type: 'dev', id: 'gaze', port: 'hit', value: [0, 1, -2] }),
      ack: env({ type: 'ack', cmd: 7, ok: true }),
      ackNo: env({ type: 'ack', cmd: 8, ok: false, reason: 'no such rail' }),
      snap: env({ type: 'snap', snap: { rev: 3, t: 1.5, paused: false, playhead: 1.5, window: [0, 30], density: [0, 1, 2],
                                         rails: { clock: { value: { t: 1, dt: 1 / 60, n: 60 } } }, modules: { ball: { ver: 1 } },
                                         geometry: { cards: { ball: { slot: 2 } } },
                                         notices: ['module a: not built'] } }),
      snapEmpty: env({ type: 'snap', snap: {} }),
   };
   const cmds = {
      commit: { op: 'commit', module: 'ball', source: 'x' }, addModule: { op: 'addModule', module: 'ball' },
      addModuleSrc: { op: 'addModule', module: 'ball', source: 'x' }, rmModule: { op: 'rmModule', module: 'ball' },
      renameModule: { op: 'renameModule', module: 'ball', to: 'sphere' }, reset: { op: 'reset', module: 'ball' },
      revert: { op: 'revert', module: 'ball' }, pause: { op: 'pause' }, resume: { op: 'resume' }, resumeHere: { op: 'resumeHere' },
      seek: { op: 'seek', t: 1.25 }, play: { op: 'play' }, stop: { op: 'stop' },
      geometry: { op: 'geometry', cards: { ball: { slot: 0 } } },
      use: { op: 'use', module: 'ball', port: 'target', variable: 'gaze_hit' }, plug: { op: 'plug', module: 'ball', on: false },
   };
   // The command travels nested as `cmd`, so that a command's own fields cannot clash with the envelope's.
   const cmd = (name, extra = {}) => env({ type: 'cmd', cmd: { id: 1, ...cmds[name], ...extra } });
   const withEv = (ev, extra = {}) => env({ type: 'in', ev: { ...ev, ...extra } });
   const without = (m, key) => { const c = { ...m }; delete c[key]; return c; };

   await check('wire: valid accepts every good message, and every command of the table', () => {
      for (const [name, m] of Object.entries(goodMessages)) assert.equal(W.valid(m), true, name);
      for (const name of Object.keys(cmds)) assert.equal(W.valid(cmd(name)), true, name);
      assert.equal(W.valid(cmd('commit', { source: 'x'.repeat(65536) })), true, 'a 64 KB source is the limit');
      assert.equal(W.valid(cmd('slot', {})), false);   // a name that is not in the table is not a command
      assert.equal(W.valid(cmd('geometry', { cards: {} })), true);
      assert.equal(W.valid(cmd('geometry', { cards: { ball: { slot: 2 } } })), true);
      assert.equal(W.valid(env({ type: 'cmd', cmd: { id: 1, op: 'geometry' } })), false, 'cards are required');
      assert.equal(W.valid(cmd('geometry', { rails: { p: { lane: 2 } } })), false, 'no rails or lanes any more');
      assert.equal(W.valid({ ...goodMessages.snap, snap: { ...goodMessages.snap.snap, playing: true } }), true, 'a snapshot may say playing');
      assert.equal(W.valid({ ...goodMessages.snap, snap: { ...goodMessages.snap.snap, playing: 1 } }), false);
   });

   await check('wire: the envelope is checked, and an unknown type or a missing field is refused', () => {
      const m = goodMessages.hello;
      assert.equal(W.valid({ ...m, type: 'launch' }), false, 'unknown type');
      assert.equal(W.valid(without(m, 'type')), false);
      for (const k of ['epoch', 'from', 'seq', 't']) assert.equal(W.valid(without(m, k)), false, `missing ${k}`);
      assert.equal(W.valid({ ...m, epoch: 5 }), false);
      assert.equal(W.valid({ ...m, from: '3' }), false);
      assert.equal(W.valid({ ...m, from: 1.5 }), false);
      assert.equal(W.valid({ ...m, seq: -1 }), false);
      assert.equal(W.valid({ ...m, seq: 1.5 }), false);
      assert.equal(W.valid({ ...m, t: NaN }), false);
      assert.equal(W.valid({ ...m, t: Infinity }), false);
      assert.equal(W.valid({ ...m, extra: 1 }), false, 'an unknown field');
      assert.equal(W.valid(null), false); assert.equal(W.valid('hello'), false); assert.equal(W.valid([m]), false);
      assert.equal(W.valid({ ...m, type: '__proto__' }), false); assert.equal(W.valid({ ...m, type: 'toString' }), false);
   });

   await check('wire: hello, in, dev and ack fields are checked', () => {
      const h = goodMessages.hello;
      assert.equal(W.valid({ ...h, role: 'root' }), false);
      assert.equal(W.valid({ ...h, rank: 3 }), false);
      assert.equal(W.valid({ ...h, caps: { mac: 'yes' } }), false);
      assert.equal(W.valid({ ...h, caps: undefined }), false);
      assert.equal(W.valid({ ...h, peer: null }), true); assert.equal(W.valid({ ...h, peer: { id: 2, epoch: 'e' } }), true);
      assert.equal(W.valid({ ...h, peer: { id: 2 } }), false); assert.equal(W.valid({ ...h, peer: { id: '2', epoch: 'e' } }), false);
      assert.equal(W.valid({ ...h, peer: { id: 2, epoch: 'e', x: 1 } }), false); assert.equal(W.valid({ ...h, peer: 3 }), false);
      assert.equal(W.valid(JSON.parse('{"type":"hello","from":3,"epoch":"e","seq":0,"t":1,"role":"ide","rank":2,"caps":{"mac":false},"__proto__":{"x":1}}')), false, 'a __proto__ key');
      assert.equal(W.valid({ ...h, echo: { seq: 1 } }), false);
      assert.equal(W.valid({ ...h, echo: { seq: 1, t: NaN } }), false);
      // in
      assert.equal(W.valid(withEv(keyEv, { key: 'x'.repeat(16) })), true);
      assert.equal(W.valid(withEv(keyEv, { key: 'x'.repeat(17) })), false, 'key of 17 chars');
      assert.equal(W.valid(withEv(keyEv, { key: '' })), false);
      assert.equal(W.valid(withEv(keyEv, { d: 'sideways' })), false);
      assert.equal(W.valid(withEv(keyEv, { rep: 1 })), false);
      assert.equal(W.valid(withEv(keyEv, { mods: { c: true } })), false, 'mods needs all four');
      assert.equal(W.valid(withEv(keyEv, { code: 5 })), false);
      assert.equal(W.valid(withEv(keyEv, { x: 1 })), false, 'an unknown field in ev');
      assert.equal(W.valid(withEv({ k: 'paste', text: 'x'.repeat(4096) })), true);
      assert.equal(W.valid(withEv({ k: 'paste', text: 'x'.repeat(4097) })), false, 'paste over 4096');
      assert.equal(W.valid(withEv({ k: 'paste', text: 5 })), false);
      assert.equal(W.valid(withEv({ k: 'wheel', dx: NaN, dy: 0 })), false);
      assert.equal(W.valid(withEv({ k: 'wheel', dx: 0 })), false);
      assert.equal(W.valid(withEv({ k: 'wheel', dx: 0, dy: 0, zoom: 1 })), true, 'zoom is an optional step');
      assert.equal(W.valid(withEv({ k: 'wheel', dx: 0, dy: 0, zoom: -1 })), true);
      for (const zoom of [0, 2, '1', NaN, null]) assert.equal(W.valid(withEv({ k: 'wheel', dx: 0, dy: 0, zoom })), false, 'zoom ' + zoom);
      assert.equal(W.valid(withEv({ k: 'btn', d: 'down' })), true);
      assert.equal(W.valid(withEv({ k: 'btn', d: 'x' })), false);
      assert.equal(W.valid(withEv({ k: 'blur', d: 'down' })), false);
      assert.equal(W.valid(withEv({ k: 'mouse' })), false);
      assert.equal(W.valid(env({ type: 'in' })), false);
      // dev
      const d = goodMessages.dev;
      assert.equal(W.valid({ ...d, value: NaN }), false);
      assert.equal(W.valid({ ...d, value: [0, 1, Infinity] }), false);
      assert.equal(W.valid({ ...d, value: 'x'.repeat(5000) }), false, 'a value over 4096 bytes');
      assert.equal(W.valid({ ...d, value: true }), true);
      assert.equal(W.valid({ ...d, port: '../x' }), false);
      assert.equal(W.valid({ ...d, id: 'Gaze' }), false);
      assert.equal(W.valid(without(d, 'value')), false);
      // ack
      const a = goodMessages.ackNo;
      assert.equal(W.valid({ ...a, cmd: 'seven' }), false);
      assert.equal(W.valid({ ...a, ok: 'no' }), false);
      assert.equal(W.valid({ ...a, reason: 5 }), false);
      assert.equal(W.valid({ ...a, reason: 'x'.repeat(2000) }), false);
   });

   await check('wire: a cmd with an unknown op, a path, a bad name, bad numbers or a big source is refused', () => {
      assert.equal(W.valid(cmd('pause', { op: 'eval', code: '1' })), false, 'op eval');
      assert.equal(W.valid(cmd('pause', { op: 'writeFile' })), false);
      assert.equal(W.valid(cmd('pause', { op: 'toString' })), false);
      assert.equal(W.valid(cmd('commit', { path: 'js/x.js' })), false, 'a path field');
      assert.equal(W.valid(cmd('pause', { path: 'x' })), false);
      assert.equal(W.valid(cmd('addModule', { file: 'x.js' })), false);
      assert.equal(W.valid(cmd('pause', { source: 'x' })), false, 'a field the op does not have');
      assert.equal(W.valid(cmd('commit', { id: undefined })), false);
      assert.equal(W.valid(env({ type: 'cmd', cmd: without({ id: 1, ...cmds.commit }, 'id') })), false);
      assert.equal(W.valid(env({ type: 'cmd', op: 'pause', id: 1 })), false, 'not nested');
      assert.equal(W.valid(env({ type: 'cmd', cmd: { id: 1, ...cmds.pause }, op: 'pause' })), false, 'op beside cmd');
      assert.equal(W.valid(env({ type: 'cmd', cmd: [] })), false);
      assert.equal(W.valid(cmd('commit', { id: 1.5 })), false);
      assert.equal(W.valid(cmd('commit', { id: -1 })), false);
      for (const bad of ['../x', 'Abc', '', '1a', 'a-b', 'a'.repeat(33), 'a/b', 'a.js', '__proto__'])
         assert.equal(W.valid(cmd('rmModule', { module: bad })), false, `name '${bad}'`);
      assert.equal(W.valid(cmd('rmModule', { module: 'a'.repeat(32) })), true);
      assert.equal(W.valid(cmd('renameModule', { to: 'Bad' })), false);
      assert.equal(W.valid(cmd('use', { variable: 'Bad' })), false); assert.equal(W.valid(cmd('use', { variable: null })), true);
      assert.equal(W.valid(cmd('use', { port: 'a b' })), false); assert.equal(W.valid(cmd('plug', { on: 'yes' })), false);
      assert.equal(W.valid(cmd('commit', { source: 'x'.repeat(65537) })), false, 'a source over 65536');
      assert.equal(W.valid(cmd('commit', { source: 5 })), false);
      assert.equal(W.valid(cmd('addModuleSrc', { source: 'x'.repeat(70000) })), false);
      assert.equal(W.valid(cmd('seek', { t: NaN })), false, 'NaN');
      assert.equal(W.valid(cmd('seek', { t: Infinity })), false);
      assert.equal(W.valid(cmd('seek', { t: '1' })), false);
      assert.equal(W.valid(cmd('geometry', { cards: { ball: { slot: 5 } } })), false);
      assert.equal(W.valid(cmd('geometry', { cards: { ball: { slot: 1.5 } } })), false);
      assert.equal(W.valid(cmd('geometry', { cards: { ball: { slot: -1 } } })), false);
      assert.equal(W.valid(cmd('geometry', { cards: { 'Bad Name': { slot: 1 } } })), false);
      assert.equal(W.valid(cmd('geometry', { cards: { ball: { slot: 1, path: 'x' } } })), false);
      assert.equal(W.valid(cmd('geometry', { cards: { ball: 1 } })), false);
      assert.equal(W.valid(cmd('geometry', { cards: JSON.parse('{"__proto__": {"slot": 1}}') })), false);
   });

   await check('wire: a snap has its top-level types checked and a 256 KB limit', () => {
      const snap = o => env({ type: 'snap', snap: o });
      assert.equal(W.valid(snap({ rev: 'x' })), false);
      assert.equal(W.valid(snap({ rev: 1.5 })), false);
      assert.equal(W.valid(snap({ t: NaN })), false);
      assert.equal(W.valid(snap({ paused: 1 })), false);
      assert.equal(W.valid(snap({ window: [0] })), false);
      assert.equal(W.valid(snap({ window: [0, NaN] })), false);
      assert.equal(W.valid(snap({ density: 'x' })), false);
      assert.equal(W.valid(snap({ density: new Array(61).fill(0) })), false, 'density has 60 buckets');
      assert.equal(W.valid(snap({ rails: [] })), false);
      assert.equal(W.valid(snap({ modules: 'x' })), false);
      assert.equal(W.valid(snap({ notices: {} })), false);
      assert.equal(W.valid(snap({ ghost: null })), false, 'the ghost field is gone');
      assert.equal(W.valid(cmd('resumeHere', { module: 'ball' })), false, 'resumeHere has no fields');
      for (const op of ['ghost', 'adopt']) assert.equal(W.valid(env({ type: 'cmd', cmd: { id: 1, op, module: 'ball', source: 'x' } })), false, `${op} is not a command any more`);
      assert.equal(W.valid(snap({ eval: 'x' })), false, 'an unknown top-level key');
      assert.equal(W.valid(env({ type: 'snap' })), false, 'no snap object');
      const big = snap({ modules: { ball: { source: 'x'.repeat(300 * 1024) } } });
      assert.equal(W.valid(big), false, 'a 300 KB snap');
      assert.equal(W.valid(snap({ modules: { ball: { source: 'x'.repeat(200 * 1024) } } })), true, 'a 200 KB snap');
      assert.equal(W.valid(cmd('commit', { source: 'x'.repeat(65536) })), true);
   });

   await check('values: jsonCopy is a deep copy that shares nothing with the original', () => {
      const m = goodMessages.snap, c = V.jsonCopy(m);
      assert.deepEqual(c, m); assert.notEqual(c, m); assert.notEqual(c.snap, m.snap); assert.notEqual(c.snap.window, m.snap.window);
      c.snap.window[0] = 99; assert.equal(m.snap.window[0], 0);
   });

   // ---- link ----------------------------------------------------------------------------------------------------
   // A shared clock and a queue as the class server keeps it: every send is appended, and a pump delivers the queue
   // to everybody else in batches of random size (the real queue is read in whatever pieces a frame finds).
   const makeRng = seed => () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
   const world = (seed = 1) => {
      const w = { t: 100000, queue: [], ids: [], links: {}, rng: makeRng(seed), drop: new Set() };
      w.now = () => w.t;
      w.clients = () => w.ids.slice();
      w.add = (id, opts = {}) => {
         w.ids.push(id);
         const link = new L.Link({ id: () => id, clients: w.clients, now: w.now, rank: 1, forced: null, caps: { mac: false }, ...opts,
                                    send: m => { w.queue.push({ m: JSON.parse(JSON.stringify(m)), sender: id }); } });
         return w.links[id] = link;
      };
      w.pump = () => {
         while (w.queue.length) {
            const n = 1 + Math.floor(w.rng() * 7), batch = w.queue.splice(0, n);
            for (const { m, sender } of batch)
               for (const id of w.ids) if (id !== sender && !w.drop.has(id)) w.links[id].receive(JSON.parse(JSON.stringify(m)), sender);
         }
      };
      w.advance = (ms, step = 100) => { for (let left = ms; left > 0; left -= step) { w.t += Math.min(step, left); for (const id of w.ids) w.links[id].tick(); w.pump(); } };
      return w;
   };
   const recorder = (link, types) => { const log = []; for (const t of types) link.on(t, (...a) => log.push([t, ...a])); return log; };
   const pair = (w, a = 1, b = 2, opts = {}) => {
      const x = w.add(a, opts[a]), y = w.add(b, opts[b]);
      w.advance(1200);
      return [x, y];
   };

   await check('link: a rank other than 1 or 2 is refused', () => {
      const w = world();
      for (const rank of [0, 3, '2', null, NaN]) assert.throws(() => w.add(7, { rank }), /rank/);
   });

   await check('link: rankOf is 2 for XR or a Quest user agent, else 1', () => {
      assert.equal(L.rankOf({ xr: true, ua: 'Mozilla/5.0 X11' }), 2);
      assert.equal(L.rankOf({ xr: false, ua: 'Mozilla/5.0 (X11; Linux x86_64) OculusBrowser/30.0 Quest 3' }), 2);
      assert.equal(L.rankOf({ xr: false, ua: 'Mozilla/5.0 (Linux; Android 12; Quest 2) ...' }), 2);
      assert.equal(L.rankOf({ xr: false, ua: 'Mozilla/5.0 (Macintosh) Chrome/120' }), 1);
      assert.equal(L.rankOf({ xr: false }), 1); assert.equal(L.rankOf({}), 1); assert.equal(L.rankOf(), 1);
   });

   await check('link: alone is both; a desktop and an XR-rank link become runtime and ide, and say so', () => {
      const w = world();
      const desk = w.add(1, { rank: 1 });
      assert.equal(desk.role, 'both'); assert.equal(desk.live, false); assert.equal(desk.peer, null);
      const roles = recorder(desk, ['role']);
      const quest = w.add(2, { rank: 2 });
      const qroles = recorder(quest, ['role']);
      w.advance(1200);
      assert.equal(desk.role, 'runtime'); assert.equal(quest.role, 'ide');
      assert.deepEqual(roles, [['role', 'runtime']]); assert.deepEqual(qroles, [['role', 'ide']], 'one role event each');
      assert.equal(desk.live, true); assert.equal(desk.peer.id, 2); assert.equal(desk.peer.rank, 2);
      assert.equal(quest.peer.id, 1); assert.deepEqual(quest.peer.caps, { mac: false });
   });

   await check('link: the same rank is settled by the id, the lower is the runtime, whichever joined first', () => {
      for (const order of [[5, 9], [9, 5]]) {
         const w = world();
         const links = {}; for (const id of order) links[id] = w.add(id, { rank: 1 });
         w.advance(1200);
         assert.equal(links[5].role, 'runtime'); assert.equal(links[9].role, 'ide');
      }
      const w = world();
      const [a, b] = pair(w, 1, 2, { 1: { rank: 2 }, 2: { rank: 2 } });
      assert.equal(a.role, 'runtime'); assert.equal(b.role, 'ide');
   });

   await check('link: forced wins even alone and with a peer; the other still follows its rank', () => {
      const w = world();
      const a = w.add(1, { rank: 1, forced: 'ide' });
      assert.equal(a.role, 'ide', 'forced ide, alone');
      const w2 = world();
      assert.equal(w2.add(1, { forced: 'runtime' }).role, 'runtime');
      assert.equal(w2.add(2, { forced: 'both' }).role, 'both');
      const w3 = world();
      const x = w3.add(1, { rank: 2, forced: 'runtime' }), y = w3.add(2, { rank: 1 });
      w3.advance(1200);
      assert.equal(x.role, 'runtime', 'forced runtime although rank 2'); assert.equal(y.role, 'runtime');
      const w4 = world();
      const z = w4.add(1, { rank: 1, forced: 'both' }); w4.add(2, { rank: 2 });
      w4.advance(1200);
      assert.equal(z.role, 'both');
   });

   await check('link: hello carries role, rank, caps and an echo of the last peer message', () => {
      const w = world();
      const sent = [];
      const a = w.add(1, { rank: 1, caps: { mac: true } });
      const b = w.add(2, { rank: 2 });
      w.advance(1200);
      w.queue.length = 0;
      w.t += 600; a.tick(); b.tick();
      const hello = w.queue.map(q => q.m).filter(m => m.type === 'hello');
      assert.equal(hello.length, 2);
      const h1 = hello.find(m => m.from === 1);
      assert.equal(h1.role, 'runtime'); assert.equal(h1.rank, 1); assert.deepEqual(h1.caps, { mac: true });
      assert.equal(typeof h1.epoch, 'string'); assert.ok(h1.epoch.length > 0); assert.equal(h1.t, w.t);
      assert.deepEqual(h1.peer, { id: 2, epoch: b.epoch }, 'the peer it has accepted');
      assert.ok(h1.echo && Number.isInteger(h1.echo.seq) && Number.isFinite(h1.echo.t), 'echo of what 2 sent');
      for (const m of w.queue.map(q => q.m)) assert.ok(W.valid(m), `valid ${m.type}`);
      assert.equal(sent.length, 0);
   });

   await check('link: hello goes out at 2 Hz, on a schedule and without a burst after a pause', () => {
      const w = world();
      const a = w.add(1);
      const hellos = () => w.queue.filter(q => q.m.type === 'hello').length;
      a.tick(); assert.equal(hellos(), 1, 'the first tick says hello');
      for (let i = 0; i < 10; i++) { w.t += 16; a.tick(); }
      assert.equal(hellos(), 1, 'not again within 500 ms');
      w.t += 400; a.tick(); assert.equal(hellos(), 2);
      w.t += 60000; a.tick(); a.tick(); assert.equal(hellos(), 3, 'one hello after a minute, not 120');
   });

   await check('link: a third client is ignored: no hello, in, cmd or snap of a stranger reaches the events, role or peer', () => {
      const w = world();
      const [run, ide] = pair(w, 1, 2, { 1: { rank: 1 }, 2: { rank: 2 } });
      const log = recorder(run, ['hello', 'in', 'snap', 'ack', 'dev', 'cmd', 'role', 'pair', 'release']);
      const intruder = w.add(3, { rank: 2 });
      w.advance(200);
      intruder.sendIn({ k: 'key', d: 'down', key: 'x', code: 'KeyX', mods, rep: false });
      intruder.sendCmd({ id: 1, op: 'rmModule', module: 'ball' });
      intruder.sendDev('gaze', 'hit', [0, 0, 0]);
      intruder.sendAck(1, true);
      intruder.sendSnap({ rev: 1 });
      w.advance(600);
      assert.ok(log.every(l => l[0] === 'hello' && l[1].from === 2), 'only the peer\'s own hellos');
      assert.equal(run.peer.id, 2); assert.equal(run.role, 'runtime');
      // Forged messages: the wrong `from`, our own id, an id that is not a client, and a missing epoch.
      const real = { type: 'cmd', from: 2, epoch: ide.epoch, seq: 9999, t: w.t, cmd: { id: 5, op: 'pause' } };
      run.receive({ ...real }, 3);
      run.receive({ ...real, from: 3 }, 3);
      run.receive({ ...real, from: 1 }, 1);
      run.receive({ ...real, from: 8 }, 8);
      run.receive(without(real, 'epoch'), 2);
      run.receive({ ...real, epoch: 'forged' }, 2);
      assert.ok(log.every(l => l[0] === 'hello' && l[1].from === 2));
      log.length = 0;
      run.receive({ ...real }, 2);   // the genuine one: from the peer, its epoch
      assert.equal(log.length, 1); assert.equal(log[0][0], 'cmd'); assert.equal(log[0][1].cmd.op, 'pause');
   });

   await check('link: an invalid message from the peer is dropped without an event', () => {
      const w = world();
      const [run, ide] = pair(w, 1, 2, { 1: { rank: 1 }, 2: { rank: 2 } });
      const log = recorder(run, ['cmd', 'in']);
      const bad = { type: 'cmd', from: 2, epoch: ide.epoch, seq: 500, t: w.t, cmd: { id: 1, op: 'eval', code: '1' } };
      run.receive(bad, 2);
      run.receive({ type: 'in', from: 2, epoch: ide.epoch, seq: 501, t: w.t, ev: { k: 'key', d: 'down', key: 'x'.repeat(17), code: 'a', mods, rep: false } }, 2);
      assert.deepEqual(log, []);
   });

   await check('link: events carry the validated message, and only the paired peer is heard', () => {
      const w = world();
      const [run, ide] = pair(w, 1, 2, { 1: { rank: 1 }, 2: { rank: 2 } });
      const log = recorder(run, ['hello', 'in', 'snap', 'ack', 'dev', 'cmd']);
      ide.sendIn({ k: 'btn', d: 'down' });
      ide.sendDev('pointer', 'down', true);
      ide.sendCmd({ id: 4, op: 'seek', t: 2 });
      ide.sendAck(3, false, 'no');
      ide.sendSnap({ rev: 2, paused: true });
      w.pump();
      assert.deepEqual(log.map(l => l[0]), ['in', 'dev', 'cmd', 'ack', 'snap']);
      assert.deepEqual(log[0][1].ev, { k: 'btn', d: 'down' });
      assert.equal(log[1][1].id, 'pointer'); assert.equal(log[1][1].value, true);
      assert.equal(log[2][1].cmd.id, 4); assert.equal(log[2][1].cmd.op, 'seek');
      assert.equal(log[3][1].cmd, 3); assert.equal(log[3][1].reason, 'no');
      assert.equal(log[4][1].snap.paused, true);
      assert.equal(log[4][2], 2, 'the sender comes second');
   });

   await check('link: the send methods put valid envelopes on the wire, with seq counting up across types', () => {
      const w = world();
      const a = w.add(1, { rank: 2 });
      a.sendIn({ k: 'key', d: 'down', key: 'a', code: 'KeyA', mods, rep: false });
      a.sendSnap({ rev: 1 }); a.sendAck(1, true); a.sendDev('gaze', 'on', true); a.sendCmd({ id: 2, op: 'pause' });
      const out = w.queue.map(q => q.m);
      assert.deepEqual(out.map(m => m.type), ['in', 'snap', 'ack', 'dev', 'cmd']);
      assert.deepEqual(out.map(m => m.seq), [0, 1, 2, 3, 4]);
      for (const m of out) { assert.equal(m.from, 1); assert.equal(m.epoch, a.epoch); assert.equal(m.t, w.t); assert.ok(W.valid(m)); }
      // Our own envelope fields cannot be overwritten by a payload.
      w.queue.length = 0;
      assert.equal(a.sendCmd({ id: 3, op: 'pause', from: 99, epoch: 'x', seq: 77, t: 5, type: 'in' }), false, 'extra fields are refused');
      assert.equal(w.queue.length, 0);
      assert.equal(a.sendCmd({ id: 3, op: 'eval' }), false);
      assert.equal(a.sendIn({ k: 'key', key: 'x'.repeat(40) }), false);
      assert.equal(a.sendCmd({ id: 3, op: 'pause' }), true);
   });

   await check('link: a headset reload (same id, new epoch): both sides fire pair again, and its seq restarting at 0 is heard', () => {
      const w = world();
      const [run, ide] = pair(w, 1, 2, { 1: { rank: 1 }, 2: { rank: 2 } });
      const log = recorder(run, ['pair', 'release', 'role', 'in']);
      assert.equal(log.length, 0);
      // The headset page reloads: the same client id, a fresh Link (new epoch, seq from 0).
      const fresh = new L.Link({ id: () => 2, clients: w.clients, now: w.now, rank: 2, caps: { mac: false },
                                  send: m => w.queue.push({ m: JSON.parse(JSON.stringify(m)), sender: 2 }) });
      w.links[2] = fresh;
      const freshLog = recorder(fresh, ['pair']);
      assert.notEqual(fresh.epoch, ide.epoch);
      fresh.tick(); w.pump();
      assert.equal(run.peer.epoch, fresh.epoch, 'accepted at once'); assert.equal(run.role, 'runtime');
      assert.equal(log.filter(l => l[0] === 'pair').length, 0, 'not mutual until the reloaded side has heard us');
      w.advance(600);
      assert.equal(log.filter(l => l[0] === 'pair').length, 1, 'the laptop: pair fired for the reload');
      assert.equal(log.find(l => l[0] === 'pair')[1].epoch, fresh.epoch);
      assert.equal(freshLog.length, 1, 'the headset: pair fired too'); assert.equal(freshLog[0][1].id, 1);
      assert.equal(fresh.role, 'ide');
      fresh.sendIn({ k: 'btn', d: 'up' }); w.pump();
      assert.equal(log.filter(l => l[0] === 'in').length, 1);
      ide.sendIn({ k: 'btn', d: 'down' }); w.pump();
      assert.equal(log.filter(l => l[0] === 'in').length, 1, 'the old epoch is dead');
   });

   await check('link: a reload (same id, new epoch) whose first hello already names us is a new pairing: pair fires on the other side', () => {
      for (const [reloaded, other] of [[2, 1], [1, 2]]) {
         const w = world();
         const [x, y] = pair(w, 1, 2, { 1: { rank: 1 }, 2: { rank: 2 } });
         const stay = w.links[other], log = recorder(stay, ['pair', 'release']);
         // The page reloads and reads the queue before it says anything: its very first hello names the page that stays.
         const fresh = new L.Link({ id: () => reloaded, clients: w.clients, now: w.now, rank: reloaded === 2 ? 2 : 1, caps: { mac: false },
                                     send: m => w.queue.push({ m: JSON.parse(JSON.stringify(m)), sender: reloaded }) });
         w.links[reloaded] = fresh;
         w.t += 600; stay.tick(); w.pump();
         assert.equal(fresh.live, true, 'the reloaded page has heard the other');
         fresh.tick(); w.pump();
         assert.equal(stay.peer.epoch, fresh.epoch);
         assert.equal(log.filter(l => l[0] === 'pair').length, 1, `the page that stays (${other}) is told of the new pairing`);
         assert.equal(stay.mutual, true);
         w.advance(1500);
         assert.equal(log.filter(l => l[0] === 'pair').length, 1, 'and only once');
      }
   });

   await check('link: a laptop reload under a new id fires pair only once the headset has let the old id go and taken the new one', () => {
      const w = world();
      const [old, head] = pair(w, 1, 2, { 1: { rank: 1 }, 2: { rank: 2 } });
      const headLog = recorder(head, ['pair', 'release']);
      // The laptop's page reloads and gets a new client id, 5; the old one is gone from the relay.
      w.ids = w.ids.filter(i => i !== 1); delete w.links[1];
      const laptop = w.add(5, { rank: 1 });
      const pairs = []; laptop.on('pair', peer => pairs.push({ at: w.t, peer, headsetPeer: head.peer.id }));
      const lapLog = recorder(laptop, ['snap']);
      const silentSince = head.peer.heard;
      w.advance(2000);
      assert.equal(head.peer.id, 1, 'the headset still holds the old id: a stranger is ignored while the peer is live');
      assert.deepEqual(pairs, [], 'so the laptop must not claim a pairing yet (a full snapshot now would be dropped)');
      const headSnaps = recorder(head, ['snap']);
      laptop.sendSnap({ rev: 1 }); w.pump();
      assert.deepEqual(headSnaps, [], 'what it sends meanwhile is dropped by the headset, which is why pair must wait');
      w.advance(2000);
      assert.equal(head.peer.id, 5, 'the old id was released after 3 s and the new one accepted');
      assert.ok(headLog.some(l => l[0] === 'release'));
      assert.equal(pairs.length, 1); assert.equal(pairs[0].headsetPeer, 5, 'pair fired when the headset had accepted us');
      assert.ok(pairs[0].at >= silentSince + 3000);
      assert.equal(headLog.filter(l => l[0] === 'pair').length, 1, 'the headset fires pair too');
      assert.equal(laptop.role, 'runtime'); assert.equal(head.role, 'ide');
      head.sendSnap({ rev: 2 }); w.pump();
      assert.equal(lapLog.length, 1);
      laptop.sendSnap({ rev: 3 }); w.pump();
      assert.equal(headSnaps.length, 1, 'and now the headset hears the laptop');
   });

   await check('link: pair fires once for the first peer, and not again for its hellos', () => {
      const w = world();
      const a = w.add(1, { rank: 1 }), log = recorder(a, ['pair', 'hello']);
      w.add(2, { rank: 2 });
      w.advance(3000);
      assert.equal(log.filter(l => l[0] === 'pair').length, 1);
      assert.ok(log.filter(l => l[0] === 'hello').length >= 4, 'hello events keep coming');
      assert.equal(log.find(l => l[0] === 'pair')[1].id, 2);
   });

   await check('link: 200 in events through random batching arrive once and in order, with the counters right', () => {
      for (const seed of [1, 2, 3, 7]) {
         const w = world(seed);
         const [run, ide] = pair(w, 1, 2, { 1: { rank: 1 }, 2: { rank: 2 } });
         const got = []; run.on('in', m => got.push(m.ev.rep ? -1 : m.ev.key));
         for (let i = 0; i < 200; i++) {
            ide.sendIn({ k: 'key', d: 'down', key: String(i), code: 'Digit1', mods, rep: false });
            if (i % 9 === 0) { w.t += 5; w.pump(); }
            if (i % 31 === 0) ide.sendDev('gaze', 'on', i % 2 === 0);
         }
         w.pump();
         assert.deepEqual(got, Array.from({ length: 200 }, (_, i) => String(i)), `seed ${seed}`);
         assert.equal(run.stats.rx, 200); assert.equal(run.stats.dups, 0); assert.equal(run.stats.gaps, 0);
      }
   });

   await check('link: duplicates and old seq are dropped and counted; a gap is counted', () => {
      const w = world();
      const [run, ide] = pair(w, 1, 2, { 1: { rank: 1 }, 2: { rank: 2 } });
      const got = []; run.on('in', m => got.push(m.seq));
      const rx0 = run.stats.rx, g0 = run.stats.gaps, d0 = run.stats.dups;
      const base = ide.seq;
      const msg = (n, key) => ({ type: 'in', from: 2, epoch: ide.epoch, seq: base + n, t: w.t, ev: { k: 'key', d: 'down', key, code: 'KeyA', mods, rep: false } });
      run.receive(msg(0, 'a'), 2);
      run.receive(msg(0, 'a'), 2);   // a duplicate
      run.receive(msg(3, 'd'), 2);   // two lost between
      run.receive(msg(2, 'c'), 2);   // late: older than the newest, dropped
      run.receive(msg(4, 'e'), 2);
      assert.deepEqual(got, [base, base + 3, base + 4]);
      assert.equal(run.stats.rx - rx0, 3); assert.equal(run.stats.dups - d0, 2); assert.equal(run.stats.gaps - g0, 2);
   });

   await check('link: a 2.5 s stall drops the old in events but not the ones after it', () => {
      const w = world();
      const [run, ide] = pair(w, 1, 2, { 1: { rank: 1 }, 2: { rank: 2 } });
      const got = []; run.on('in', m => got.push(m.ev.key));
      const key = k => ({ k: 'key', d: 'down', key: k, code: 'KeyA', mods, rep: false });
      ide.sendIn(key('a')); w.t += 20; w.pump();                // on time
      ide.sendIn(key('b'));                                      // sent now, delivered after a 2.5 s stall of the link
      w.t += 2500; w.pump();
      ide.sendIn(key('c')); w.t += 30; w.pump();                // fresh again
      assert.deepEqual(got, ['a', 'c'], 'b arrived 2.5 s late and is dropped');
      assert.equal(run.stats.stale, 1);
      // A clock offset between the devices is not a stall: only what exceeds the best case counts.
      const w2 = world(), laptop = w2.add(1, { rank: 1 }); w2.ids.push(2);
      const seen = []; laptop.on('in', m => seen.push(m.ev.key));
      const skewed = (seq, dt, extra) => ({ type: 'in', from: 2, epoch: 'q', seq, t: w2.t - 5000000 + dt, ev: key(extra) });
      laptop.receive({ type: 'hello', from: 2, epoch: 'q', seq: 0, t: w2.t - 5000000, role: 'ide', rank: 2, caps: { mac: false }, peer: { id: 1, epoch: laptop.epoch } }, 2);
      laptop.receive(skewed(1, 10, 'x'), 2);
      assert.deepEqual(seen, ['x'], 'a headset clock 5000 s behind is fine');
      w2.t += 10; laptop.receive(skewed(2, 0, 'y'), 2);
      assert.deepEqual(seen, ['x', 'y']);
      w2.t += 2600; laptop.receive(skewed(3, -2600, 'z'), 2);   // sent at the same moment as y, heard 2.6 s later
      assert.deepEqual(seen, ['x', 'y'], 'but 2.6 s later than its neighbours is a stall');
   });

   await check('link: a late key up, button up or blur is still delivered, and blur still releases; late actions are dropped', () => {
      const w = world();
      const [run, ide] = pair(w, 1, 2, { 1: { rank: 1 }, 2: { rank: 2 } });
      const log = recorder(run, ['in', 'release']);
      const k = (key, d) => ({ k: 'key', d, key, code: 'KeyA', mods, rep: false });
      ide.sendIn(k('a', 'down')); w.t += 20; w.pump();
      assert.deepEqual(log.map(l => l[0]), ['in']);
      ide.sendIn(k('a', 'up')); ide.sendIn({ k: 'btn', d: 'up' }); ide.sendIn(k('b', 'down')); ide.sendIn({ k: 'paste', text: 'x' });
      ide.sendIn({ k: 'wheel', dx: 0, dy: 1 }); ide.sendIn({ k: 'btn', d: 'down' }); ide.sendIn({ k: 'blur' });
      w.t += 2500; w.pump();
      assert.deepEqual(log.map(l => l[0] === 'in' ? `in:${l[1].ev.k}:${l[1].ev.d || ''}` : l[0]), ['in:key:down', 'in:key:up', 'in:btn:up', 'in:blur:', 'release'],
         'up, btn up and blur arrive; down, paste, wheel and btn down do not');
      assert.equal(run.stats.stale, 4);
   });

   await check('link: after the peer clock steps back 5 s, actions are heard again within 30 s, and at once after a silence and re-pair', () => {
      const mk = () => {
         const w = world(), laptop = w.add(1, { rank: 1 }); w.ids.push(2);
         const got = []; laptop.on('in', m => got.push(m.ev.key));
         let seq = 0, lag = 0, n = 0;
         const feed = (hello = false) => {   // what the headset sends now, its clock `lag` ms behind
            const t = w.t - lag, env = { from: 2, epoch: 'q', seq: seq++, t };
            if (hello) laptop.receive({ type: 'hello', ...env, role: 'ide', rank: 2, caps: { mac: false }, peer: { id: 1, epoch: laptop.epoch } }, 2);
            else laptop.receive({ type: 'in', ...env, ev: { k: 'key', d: 'down', key: 'k' + n++, code: 'KeyA', mods, rep: false } }, 2);
         };
         return { w, laptop, got, feed, setLag: v => { lag = v; } };
      };
      const a = mk();
      a.feed(true);
      for (let i = 0; i < 10; i++) { a.w.t += 1000; a.feed(); }
      assert.equal(a.got.length, 10);
      a.setLag(5000);   // the headset slept: its clock now lags by 5 s
      a.w.t += 1000; a.feed();
      assert.equal(a.got.length, 10, 'dropped at first');
      let back = null;
      for (let s = 1; s <= 40 && back === null; s++) { a.w.t += 1000; a.feed(); if (a.got.length > 10) back = s; }
      assert.ok(back !== null && back <= 30, `accepted again after ${back} s`);
      // And a silence: after 3.5 s without anything, the laptop releases; the same epoch returns and starts the offset afresh.
      const b = mk();
      b.feed(true);
      for (let i = 0; i < 5; i++) { b.w.t += 1000; b.feed(); }
      const rel = recorder(b.laptop, ['release']);
      b.setLag(5000); b.w.t += 3500; b.laptop.tick();
      assert.equal(rel.length, 1);
      const before = b.got.length;
      b.feed(true); b.feed();
      assert.equal(b.got.length, before + 1, 'heard at once after the re-pair');
   });

   // The world's relay can lose hellos; `lossy` is the chance, with the world's seeded rng.
   const lossy = (w, p) => { const pump = w.pump; w.pump = () => {
      w.queue = w.queue.filter(q => q.m.type !== 'hello' || w.rng() >= p); pump(); }; };
   const mutualOf = link => link.mutual && link.live;

   await check('link: (a) two laptop tabs paired with each other, then the headset: the headset ends mutual with one, the other tab with none', () => {
      for (const order of [[1, 2, 3], [2, 1, 3], [1, 3, 2]]) {   // client ids of: laptop L, stray tab S, headset H; H's id varies
         const w = world(order[0] * 7);
         const [l, s2] = [w.add(order[0], { rank: 1 }), w.add(order[1], { rank: 1 })];
         w.advance(1500);
         assert.ok(mutualOf(l) && mutualOf(s2), 'the two tabs pair with each other first');
         const h = w.add(order[2], { rank: 2 });
         w.advance(4000);
         const partners = [l, s2].filter(x => mutualOf(x));
         assert.equal(partners.length, 1, 'exactly one tab is mutual with the headset');
         assert.equal(mutualOf(h), true); assert.equal(h.peer.id, partners[0].idOf());
         assert.equal(partners[0].peer.id, h.idOf()); assert.equal(partners[0].role, 'runtime'); assert.equal(h.role, 'ide');
         const other = [l, s2].find(x => x !== partners[0]);
         assert.equal(mutualOf(other), false, 'the other tab has no mutual peer');
         w.advance(7000);   // and it stays so, whatever the other tab does while it retries
         assert.equal(mutualOf(h), true); assert.equal(h.peer.id, partners[0].idOf()); assert.equal(mutualOf(other), false);
      }
   });

   await check('link: (b) a stranger tab that accepted the headset gets no cmd, dev or other traffic, and does not mutual', () => {
      const w = world(3);
      const [lap, head] = pair(w, 1, 2, { 1: { rank: 1 }, 2: { rank: 2 } });
      const stray = w.add(3, { rank: 1 });
      const log = recorder(stray, ['in', 'snap', 'ack', 'dev', 'cmd', 'pair']);
      w.advance(1000);
      assert.equal(stray.mutual, false, 'the headset names the laptop, not the stray');
      head.sendCmd({ id: 9, op: 'rmModule', module: 'ball' }); head.sendDev('pointer', 'down', true);
      head.sendAck(1, true); head.sendSnap({ rev: 1 }); head.sendIn({ k: 'btn', d: 'down' });
      w.pump();
      assert.deepEqual(log, [], 'nothing of the headset reaches the stray, although it accepted its hello');
      // Even a forged message with the right id and epoch is not heard.
      stray.receive({ type: 'cmd', from: 2, epoch: head.epoch, seq: 99999, t: w.t, cmd: { id: 1, op: 'pause' } }, 2);
      assert.deepEqual(log, []);
      // The laptop, which is mutual, hears them.
      const lapLog = recorder(lap, ['cmd']); head.sendCmd({ id: 10, op: 'pause' }); w.pump();
      assert.equal(lapLog.length, 1);
   });

   await check('link: an accepted peer that does not name us for 3 s is released, and then the first hello heard is accepted', () => {
      const w = world(5);
      const stray = w.add(3, { rank: 1 }); w.ids.push(2);
      const log = recorder(stray, ['release', 'pair']);
      const hello = (seq, peer) => ({ type: 'hello', from: 2, epoch: 'h', seq, t: w.t, role: 'ide', rank: 2, caps: { mac: false }, peer });
      stray.receive(hello(0, { id: 1, epoch: 'x' }), 2);
      assert.equal(stray.live, true); assert.equal(stray.mutual, false);
      for (let i = 1; i <= 5; i++) { w.t += 500; stray.receive(hello(i, { id: 1, epoch: 'x' }), 2); stray.tick(); }
      assert.deepEqual(log, [], 'not yet at 2.5 s');
      for (let i = 6; i <= 8; i++) { w.t += 500; stray.receive(hello(i, { id: 1, epoch: 'x' }), 2); stray.tick(); }
      assert.deepEqual(log.map(l => l[0]), ['release']); assert.equal(log[0][1], 'unmatched');
      assert.ok(!stray.peer || stray.peer.id !== 2 || !stray.mutual);
      stray.receive(hello(9, { id: 3, epoch: stray.epoch }), 2);   // now it names us
      assert.equal(stray.mutual, true); assert.deepEqual(log.map(l => l[0]), ['release', 'pair']);
   });

   await check('link: (c) two devices with 20% of the hellos lost for 120 s: one pair each, no release, no role change after the start', () => {
      for (const seed of [1, 2, 3, 4, 5]) {
         const w = world(seed); lossy(w, .2);
         const lap = w.add(1, { rank: 1 }), head = w.add(2, { rank: 2 });
         const logs = [lap, head].map(l => recorder(l, ['pair', 'release']));
         w.advance(120000, 50);
         for (const log of logs) assert.deepEqual(log.map(l => l[0]), ['pair'], `seed ${seed}: ${JSON.stringify(log.map(l => l[0]))}`);
         assert.ok(mutualOf(lap) && mutualOf(head));
      }
   });

   await check('link: (d) two headsets and a laptop: no crash, and the laptop stays mutual with the first headset', () => {
      const w = world(11);
      const lap = w.add(1, { rank: 1 }), h1 = w.add(2, { rank: 2 });
      w.advance(1500);
      assert.ok(mutualOf(lap) && mutualOf(h1));
      const h2 = w.add(3, { rank: 2 });
      const lapLog = recorder(lap, ['pair', 'release']), h1Log = recorder(h1, ['pair', 'release']);
      for (let i = 0; i < 4; i++) {
         w.advance(3000);
         assert.ok(mutualOf(lap) && lap.peer.id === 2, 'the laptop keeps the first headset');
         assert.ok(mutualOf(h1) && h1.peer.id === 1);
         assert.equal(mutualOf(h2), false, 'the second one is not paired (it may retry every 3 s)');
      }
      assert.deepEqual(lapLog, []); assert.deepEqual(h1Log, []);
      const cmds = recorder(lap, ['cmd']); h2.sendCmd({ id: 1, op: 'pause' }); h1.sendCmd({ id: 2, op: 'resume' }); w.pump();
      assert.deepEqual(cmds.map(c => c[1].cmd.op), ['resume'], 'only the first headset commands');
   });

   await check('link: a peer that falls silent for 3 s is released once, and a stranger may then pair', () => {
      const w = world();
      const [run, ide] = pair(w, 1, 2, { 1: { rank: 1 }, 2: { rank: 2 } });
      const log = recorder(run, ['release', 'role', 'pair']);
      w.drop.add(1);   // the runtime no longer hears; and the ide is silent for it
      w.ids = w.ids.filter(i => i !== 2);   // the ide has gone from the relay
      const heard = run.peer.heard;
      for (let t = w.t; t < heard + 2900; t += 100) { w.t = t; run.tick(); }
      w.t = heard + 2900; run.tick();
      assert.deepEqual(log, [], 'not yet at 2.9 s');
      assert.equal(run.live, true);
      w.t = heard + 3100; run.tick();
      assert.deepEqual(log.map(l => l[0]), ['release', 'role'], 'released at 3.1 s');
      assert.equal(log[1][1], 'both'); assert.equal(run.live, false); assert.equal(run.role, 'both');
      for (let i = 0; i < 20; i++) { w.t += 100; run.tick(); }
      assert.equal(log.filter(l => l[0] === 'release').length, 1, 'once');
      // A stranger's hello is accepted now.
      w.drop.delete(1); w.add(3, { rank: 2 });
      w.advance(700);
      assert.equal(run.peer.id, 3); assert.equal(run.role, 'runtime');
      assert.equal(log.filter(l => l[0] === 'pair').length, 1);
   });

   await check('link: a peer that returns after silence is paired again so that the host can resend everything', () => {
      const w = world();
      const [run, ide] = pair(w, 1, 2, { 1: { rank: 1 }, 2: { rank: 2 } });
      const log = recorder(run, ['release', 'pair']);
      w.drop.add(1); w.advance(3500);
      assert.deepEqual(log.map(l => l[0]), ['release']);
      w.drop.delete(1); w.advance(700);
      assert.deepEqual(log.map(l => l[0]), ['release', 'pair']);
      assert.equal(run.live, true); assert.equal(run.role, 'runtime');
   });

   await check('link: an in blur is delivered and then releases, so held keys and a grab are cleared', () => {
      const w = world();
      const [run, ide] = pair(w, 1, 2, { 1: { rank: 1 }, 2: { rank: 2 } });
      const log = recorder(run, ['in', 'release']);
      ide.sendIn({ k: 'blur' }); w.pump();
      assert.deepEqual(log.map(l => l[0]), ['in', 'release']);
      assert.equal(log[0][1].ev.k, 'blur');
      assert.equal(run.live, true, 'the peer is still there, only the input stops');
   });

   await check('link: RTT is read from the hello echo, as p50 over the last 20 and the maximum', () => {
      const w = world();
      const run = w.add(1, { rank: 1 }); w.ids.push(2);   // client 2 is on the relay, and speaks by hand
      assert.equal(run.rtt.p50, null, 'no samples yet'); assert.equal(run.rtt.max, null);
      // Hand-made hellos: a message of ours sent `rtt` ms ago, echoed back.
      const hello = (echoT, seq) => ({ type: 'hello', from: 2, epoch: 'peer', seq, t: w.t, role: 'ide', rank: 2, caps: { mac: false }, peer: { id: 1, epoch: run.epoch },
                                        echo: { seq: 0, t: echoT } });
      let seq = 0;
      for (const rtt of [10, 20, 30, 40, 50]) { w.t += 500; run.receive(hello(w.t - rtt, seq++), 2); }
      assert.equal(run.rtt.p50, 30); assert.equal(run.rtt.max, 50);
      // 20 more at 5 ms push the early ones out of the window of 20, but the max remembers.
      for (let i = 0; i < 20; i++) { w.t += 500; run.receive(hello(w.t - 5, seq++), 2); }
      assert.equal(run.rtt.p50, 5); assert.equal(run.rtt.max, 50);
      // A bad echo (from the future, or negative) is not a sample.
      const n = run.stats.rttN;
      run.receive(hello(w.t + 1000, seq++), 2); run.receive(hello(-1e9, seq++), 2);
      assert.equal(run.stats.rttN, n);
      assert.equal(run.rtt.max, 50);
   });

   await check('link: RTT measured end to end over the fake queue is small and finite', () => {
      const w = world();
      const [run, ide] = pair(w, 1, 2, { 1: { rank: 1 }, 2: { rank: 2 } });
      w.advance(3000, 20);
      assert.ok(Number.isFinite(run.rtt.p50) && run.rtt.p50 >= 0 && run.rtt.p50 <= 700, `p50 ${run.rtt.p50}`);
      assert.ok(run.rtt.max >= run.rtt.p50);
   });

   // ---- store ---------------------------------------------------------------------------------------------------
   // A fake server: POST /api/saveScene stores contents; GET of a file returns it. Each call is a promise the test
   // settles by hand, so that "in flight" can be held open.
   const server = (opts = {}) => {
      const files = {}, calls = [], pending = [];
      const fake = (url, init = {}) => new Promise((resolve, reject) => {
         const call = { url, init, body: init.body ? JSON.parse(init.body) : null, finish: null };
         calls.push(call);
         const finish = (status = 200) => {
            if (opts.reject) return reject(new Error('offline'));
            if (call.body && status === 200) files[call.body.path] = call.body.contents;
            const path = call.body ? null : url.replace(/^\//, '').replace(/\?.*$/, '');
            const has = path !== null && Object.hasOwn(files, path);
            const ok = call.body ? status === 200 : has;
            resolve({ ok, status: call.body ? status : has ? 200 : 404, text: async () => has ? files[path] : '' });
         };
         if (opts.hold) { call.finish = finish; pending.push(call); } else finish(opts.status || 200);
      });
      return { fake, files, calls, pending };
   };
   const tick = () => new Promise(r => setImmediate(r));

   await check('store: names and sizes are checked before anything is sent', async () => {
      const s = server(), store = St.createStore({ fetch: s.fake });
      for (const bad of ['../x', 'Abc', '', 'a'.repeat(33), 'a/b', 'a.js', '1a', '__proto__', 5, null]) {
         const r = await store.saveModule(bad, 'x');
         assert.equal(r.ok, false, `name ${String(bad)}`); assert.equal(typeof r.reason, 'string');
      }
      assert.equal((await store.saveModule('ball', 'x'.repeat(70 * 1024))).ok, false, '70 KB');
      assert.equal((await store.saveModule('ball', 'x'.repeat(65537))).ok, false);
      assert.equal((await store.saveModule('ball', 5)).ok, false, 'source must be a string');
      assert.equal(s.calls.length, 0, 'no request was made');
      assert.equal(await store.loadModule('../x'), null); assert.equal(s.calls.length, 0);
      assert.equal((await store.saveModule('a'.repeat(32), 'x'.repeat(65536))).ok, true, 'the limits themselves are fine');
   });

   await check('store: saveModule POSTs JSON {path, contents} to /api/saveScene, and only that path shape', async () => {
      const s = server(), store = St.createStore({ fetch: s.fake });
      const r = await store.saveModule('ball', 'export default 1;\n');
      assert.equal(r.ok, true);
      assert.equal(s.calls.length, 1);
      const c = s.calls[0];
      assert.equal(c.url, '/api/saveScene'); assert.equal(c.init.method, 'POST');
      assert.match(String(c.init.headers['Content-Type'] || c.init.headers['content-type']), /application\/json/);
      assert.deepEqual(Object.keys(c.body).sort(), ['contents', 'path']);
      assert.equal(c.body.path, 'js/scenes/rails/modules/ball.js'); assert.equal(c.body.contents, 'export default 1;\n');
      assert.deepEqual(store.stats, { ok: 1, fail: 0, last: { path: 'js/scenes/rails/modules/ball.js', ok: true, status: 200 } });
      await store.saveLayout({ cards: {} });
      assert.equal(s.calls[1].body.path, 'js/scenes/rails/data/layout.js');
   });

   await check('store: two quick saves of one module are one at a time and the last content wins', async () => {
      const s = server({ hold: true }), store = St.createStore({ fetch: s.fake });
      const p1 = store.saveModule('ball', 'v1'), p2 = store.saveModule('ball', 'v2'), p3 = store.saveModule('ball', 'v3');
      await tick();
      assert.equal(s.calls.length, 1, 'only one in flight'); assert.equal(s.calls[0].body.contents, 'v1');
      s.pending.shift().finish(); await tick();
      assert.equal(s.calls.length, 2, 'the next starts when the first is done');
      assert.equal(s.calls[1].body.contents, 'v3', 'v2 was replaced by v3');
      s.pending.shift().finish();
      const rs = await Promise.all([p1, p2, p3]);
      assert.ok(rs.every(r => r.ok));
      assert.equal(s.files['js/scenes/rails/modules/ball.js'], 'v3');
      assert.equal(s.calls.length, 2); assert.equal(store.stats.ok, 2);
      // A different path is not held back by this one.
      const q1 = store.saveModule('ball', 'a'), q2 = store.saveModule('flowers', 'b'), q3 = store.saveLayout({ x: 1 });
      await tick();
      assert.equal(s.calls.length, 5, 'three paths, three writes at once');
      while (s.pending.length) s.pending.shift().finish();
      await Promise.all([q1, q2, q3]);
   });

   await check('store: a failed write is retried once; two failures count as one fail and are reported', async () => {
      let n = 0;
      const files = {};
      const flaky = async (url, init) => {
         n++;
         if (n === 1) return { ok: false, status: 500, text: async () => '' };
         files[JSON.parse(init.body).path] = JSON.parse(init.body).contents;
         return { ok: true, status: 200, text: async () => '' };
      };
      const store = St.createStore({ fetch: flaky });
      const r = await store.saveModule('ball', 'x');
      assert.equal(r.ok, true); assert.equal(n, 2, 'one retry'); assert.deepEqual([store.stats.ok, store.stats.fail], [1, 0]);
      const dead = St.createStore({ fetch: async () => { n++; return { ok: false, status: 400, text: async () => '' }; } });
      n = 0;
      const r2 = await dead.saveModule('ball', 'x');
      assert.equal(r2.ok, false); assert.equal(r2.status, 400); assert.equal(n, 1, 'a 4xx is not retried');
      assert.deepEqual(dead.stats, { ok: 0, fail: 1, last: { path: 'js/scenes/rails/modules/ball.js', ok: false, status: 400 } });
      n = 0;
      const down = St.createStore({ fetch: async () => { n++; return { ok: false, status: 503, text: async () => '' }; } });
      assert.equal((await down.saveModule('ball', 'x')).ok, false); assert.equal(n, 2, 'a 5xx is retried once and no more');
      const thrower = St.createStore({ fetch: async () => { throw new Error('offline'); } });
      const r3 = await thrower.saveModule('ball', 'x');
      assert.equal(r3.ok, false); assert.equal(thrower.stats.fail, 1); assert.equal(thrower.stats.last.status, 0);
      // After a failure the path is free again.
      const s = server(), again = St.createStore({ fetch: s.fake });
      assert.equal((await again.saveModule('ball', 'x')).ok, true);
   });

   await check('store: the layout text is `export default <JSON>;` and round-trips through load', async () => {
      const s = server(), store = St.createStore({ fetch: s.fake });
      const layout = { cards: { ball: { slot: 2 }, flowers: { slot: 3 } }, rails: { p: { kind: 'state', type: 'vec3', lane: 1 } },
                       docks: [['ball', 'pos', 'p']], text: 'quote " and ; and   \n', n: [1.5, -0, 1e-7] };
      assert.equal((await store.saveLayout(layout)).ok, true);
      const text = s.files['js/scenes/rails/data/layout.js'];
      assert.equal(text, `export default ${JSON.stringify(layout, null, 1)};\n`);
      assert.ok(text.startsWith('export default {') && text.endsWith('};\n'));
      const back = await store.loadLayout();
      assert.deepEqual(back, JSON.parse(JSON.stringify(layout)));
      const get = s.calls[s.calls.length - 1];
      assert.equal(get.init.cache, 'no-store'); assert.match(get.url, /layout\.js\?/, 'cache-busted');
      assert.ok(!get.init.method || get.init.method === 'GET');
      await store.loadLayout();
      const get2 = s.calls[s.calls.length - 1];
      assert.notEqual(get.url, get2.url, 'a new buster each time');
      assert.equal((await store.saveLayout(() => 1)).ok, false, 'not JSON');
      const cyc = {}; cyc.self = cyc;
      assert.equal((await store.saveLayout(cyc)).ok, false, 'a cycle');
      assert.equal((await store.saveLayout(null)).ok, false); assert.equal((await store.saveLayout([1])).ok, false);
      assert.equal((await store.saveLayout({ big: 'x'.repeat(70 * 1024) })).ok, false, 'size');
   });

   await check('store: loadModule gives the source or null; a missing, failing or bad layout is null with a reason', async () => {
      const s = server(), store = St.createStore({ fetch: s.fake });
      assert.equal(await store.loadModule('ball'), null, 'missing file');
      await store.saveModule('ball', 'return 1;\n');
      assert.equal(await store.loadModule('ball'), 'return 1;\n');
      const get = s.calls[s.calls.length - 1];
      assert.match(get.url, /^\/?js\/scenes\/rails\/modules\/ball\.js\?/); assert.equal(get.init.cache, 'no-store');
      assert.equal(await store.loadLayout(), null, 'no layout yet');
      for (const text of ['export default {oops};\n', 'hello', 'export default [1,2];\n', 'export default null;\n', '']) {
         s.files['js/scenes/rails/data/layout.js'] = text;
         assert.equal(await store.loadLayout(), null, JSON.stringify(text));
         assert.equal(typeof store.problem, 'string', 'the reason is kept');
      }
      s.files['js/scenes/rails/data/layout.js'] = 'export default {"a":1};\n';
      assert.deepEqual(await store.loadLayout(), { a: 1 }); assert.equal(store.problem, null);
      const down = St.createStore({ fetch: async () => { throw new Error('offline'); } });
      assert.equal(await down.loadModule('ball'), null); assert.equal(await down.loadLayout(), null);
   });

   // ---- report --------------------------------------------------------------------------------------------------
   await check('report: reportOf copies exactly the logged fields, clamps strings and drops everything else', () => {
      const secret = 'SECRETKEYTEXT';
      const state = {
         v: 1, ev: 'tick', role: 'ide', rank: 2, peer: { live: true, heardMs: 120, lastKey: secret },
         input: { rx: 10, gaps: 1, dups: 0, lastKey: secret, keys: [secret] }, rtt: { p50: 12, max: 80 }, focus: 'ball',
         cards: [['ball', 'ok', false, secret], ['flowers', 'error', true]], rails: [['p', 'state', 1, 2, 30]],
         rec: { paused: false, span: 30 }, saves: { ok: 3, fail: 0 }, worker: { restarts: 1 }, fps: 71.5, errors: 2,
         lastError: 'x'.repeat(500), keys: secret, typed: secret, text: secret, source: secret, buffers: { ball: secret },
      };
      const r = Rp.reportOf(state);
      assert.deepEqual(Object.keys(r).sort(), ['cards', 'errors', 'ev', 'focus', 'fps', 'input', 'lastError', 'mutual', 'peer', 'perf', 'rails', 'rank', 'rec', 'role', 'rtt', 'saves', 'v', 'worker'].sort());
      const p = Rp.reportOf({ perf: { xr: true, frameMs: 3.2, netMs: 0.4, ideMs: 2.1, worstMs: 18, snaps: 30, heapMB: 41.5, text: secret } }).perf;
      assert.deepEqual(p, { xr: true, frameMs: 3.2, netMs: 0.4, ideMs: 2.1, worstMs: 18, snaps: 30, heapMB: 41.5 }, 'perf: only its numbers');
      assert.deepEqual(Rp.reportOf({ perf: { xr: 'yes', frameMs: 'x', heapMB: NaN } }).perf,
         { xr: false, frameMs: null, netMs: null, ideMs: null, worstMs: null, snaps: null, heapMB: null }, 'perf: junk becomes null');
      assert.equal(r.mutual, false); assert.equal(Rp.reportOf({ mutual: true }).mutual, true); assert.equal(Rp.reportOf({ mutual: 'yes' }).mutual, false);
      assert.equal(r.lastError.length, 200);
      assert.deepEqual(r.peer, { live: true, heardMs: 120 }); assert.deepEqual(r.input, { rx: 10, gaps: 1, dups: 0 });
      assert.deepEqual(r.rtt, { p50: 12, max: 80 }); assert.deepEqual(r.rec, { paused: false, span: 30 });
      assert.deepEqual(r.saves, { ok: 3, fail: 0 }); assert.deepEqual(r.worker, { restarts: 1 });
      assert.deepEqual(r.cards, [['ball', 'ok', false], ['flowers', 'error', true]]);
      assert.deepEqual(r.rails, [['p', 'state', 1, 2, 30]]);
      assert.ok(!JSON.stringify(r).includes(secret), 'no key text anywhere');
      assert.doesNotThrow(() => JSON.stringify(r));
   });

   await check('report: bad or missing input gives null fields, never throws, and long strings and lists are cut', () => {
      const r = Rp.reportOf({});
      assert.equal(r.v, 1); assert.equal(r.role, null); assert.equal(r.fps, null); assert.deepEqual(r.cards, []);
      assert.equal(r.errors, 0); assert.equal(r.lastError, null); assert.equal(r.peer.live, false);
      assert.doesNotThrow(() => Rp.reportOf(null)); assert.doesNotThrow(() => Rp.reportOf('x')); assert.doesNotThrow(() => Rp.reportOf([]));
      const odd = Rp.reportOf({ fps: NaN, rank: Infinity, role: { a: 1 }, focus: { key: 'SECRETKEYTEXT' }, errors: '3', cards: 'x', rails: [5, null, ['p', 'state', NaN]],
                                 peer: { live: 'yes', heardMs: 'x' }, ev: 'e'.repeat(300) });
      assert.equal(odd.fps, null); assert.equal(odd.rank, null); assert.equal(odd.role, null); assert.equal(odd.focus, null);
      assert.equal(odd.errors, 0); assert.deepEqual(odd.cards, []); assert.equal(odd.ev.length, 200);
      assert.deepEqual(odd.rails, [['p', 'state', null, null, null]]);
      assert.equal(odd.peer.live, false); assert.equal(odd.peer.heardMs, null);
      const many = Rp.reportOf({ cards: Array.from({ length: 500 }, (_, i) => ['c' + i, 'ok', false]) });
      assert.ok(many.cards.length <= 32);
      assert.ok(JSON.stringify(many).length < 4000, 'a short line');
   });

   // ---- runtime ---------------------------------------------------------------------------------------------------
   // The runtime wraps the bus, the recorder and the devices. It is driven by commands (the inner object of a `cmd`
   // message), advanced by step(), and read through snapshot(), which must always be a message the wire accepts.
   const NOCLOCK = "const out = output('out', 'state', 'num'); const S = state({ n: 0 }); out.set(1);\n";
   const SENDER = "const time = input('time', 'state', 'time'); const out = output('out', 'state', 'num');\nconst S = state({ n: 0 });\ntime.on(() => { S.n++; out.set(S.n); });\n";
   const LISTENER = "const p = input('p', 'state', 'vec3'); const S = state({ got: null });\np.on(v => { S.got = v; log('got ' + JSON.stringify(v)); });\n";
   let cmdId = 0;
   const run = (rt, op, fields = {}) => rt.handle({ id: ++cmdId, op, ...fields });
   const ok = (rt, op, fields) => { const r = run(rt, op, fields); assert.equal(r.ok, true, `${op}: ${r.reason}`); return r; };
   const steps = (rt, n) => { for (let i = 0; i < n; i++) rt.step(); };
   const asMessage = snap => ({ type: 'snap', from: 1, epoch: 'e', seq: 0, t: 0, snap });
   const fresh = (seed = 1) => new Rt.Runtime({ seed });
   const BUILTIN_VARS = ['time', 'gaze_hit', 'gaze_on', 'pointer_pos', 'pointer_down'];
   // A runtime with a sender module (its output is the variable `out`), 120 steps in.
   const busy = () => {
      const rt = fresh();
      ok(rt, 'addModule', { module: 'send', source: SENDER });
      steps(rt, 120);
      return rt;
   };

   await check('runtime: a fresh runtime has the gaze and pointer devices, the time variable and a recorder', () => {
      const rt = fresh();
      assert.ok(rt.bus && rt.recorder);
      const ports = id => rt.bus.devices.get(id).ports.map(p => [p.name, p.kind, p.type]);
      assert.deepEqual(ports('gaze'), [['hit', 'state', 'vec3'], ['on', 'state', 'bool']]);
      assert.deepEqual(ports('pointer'), [['pos', 'state', 'vec3'], ['down', 'state', 'bool']]);
      assert.ok(rt.bus.rails.has('time'));
      steps(rt, 3);
      assert.equal(rt.recorder.range().frames, 3);
   });

   await check('runtime: addModule without a source uses the skeleton; the ack is {cmd, ok}', () => {
      const rt = fresh();
      const r = rt.handle({ id: 41, op: 'addModule', module: 'ball' });
      assert.deepEqual(r, { cmd: 41, ok: true });
      assert.equal(rt.bus.modules.get('ball').source, Tp.skeleton('ball'));
      assert.equal(rt.snapshot().modules.ball.source, Tp.skeleton('ball'));
      const dup = rt.handle({ id: 42, op: 'addModule', module: 'ball' });
      assert.equal(dup.cmd, 42); assert.equal(dup.ok, false); assert.match(dup.reason, /already exists/);
      const bad = rt.handle({ id: 43, op: 'addModule', module: 'b', source: 'const x = ;' });
      assert.equal(bad.ok, false); assert.ok(bad.reason.length > 0);
   });

   await check('runtime: commit with a syntax error acks the message without a line and keeps the old version', () => {
      const rt = fresh();
      ok(rt, 'addModule', { module: 'a', source: SENDER });
      const r = run(rt, 'commit', { module: 'a', source: 'const x = ;' });
      assert.equal(r.ok, false);
      assert.equal(r.reason, rt.bus.modules.get('a').editError.message);
      assert.ok(!/line/i.test(r.reason), r.reason);
      assert.equal(rt.bus.modules.get('a').source, SENDER); assert.equal(rt.bus.modules.get('a').ver, 1);
      steps(rt, 2);
      assert.equal(rt.bus.modules.get('a').source, SENDER, 'still the old version after a step');
      const good = ok(rt, 'commit', { module: 'a', source: SENDER + '// v2\n' });
      assert.equal(good.reason, undefined);
      steps(rt, 1);
      assert.equal(rt.bus.modules.get('a').ver, 2); assert.equal(rt.bus.modules.get('a').editError, null);
      assert.equal(run(rt, 'commit', { module: 'nope', source: 'x' }).ok, false);
   });

   await check('runtime: renameModule, rmModule, and the unknown op', () => {
      const rt = fresh();
      for (const op of ['addRail', 'rmRail', 'renameRail', 'kind', 'dock', 'undock']) assert.match(run(rt, op, {}).reason, /unknown command/, op);
      ok(rt, 'addModule', { module: 'm', source: SENDER }); ok(rt, 'renameModule', { module: 'm', to: 'n' }); steps(rt, 1);
      assert.ok(rt.bus.modules.has('n') && !rt.bus.modules.has('m'));
      ok(rt, 'rmModule', { module: 'n' }); steps(rt, 1);
      assert.equal(rt.bus.modules.size, 0);
      assert.equal(run(rt, 'rmModule', { module: 'n' }).ok, false);
      const odd = rt.handle({ id: 9, op: 'eval' });
      assert.equal(odd.ok, false); assert.equal(odd.cmd, 9);
      assert.doesNotThrow(() => rt.handle(null)); assert.equal(rt.handle(undefined).ok, false);
   });

   await check('runtime: reset reloads the current source with fresh state, revert goes back one version', () => {
      const rt = busy();
      const before = rt.bus.modules.get('send').state.n;
      assert.ok(before >= 120);
      ok(rt, 'reset', { module: 'send' }); steps(rt, 1);
      assert.ok(rt.bus.modules.get('send').state.n <= 2, 'state started again');
      assert.equal(rt.bus.modules.get('send').source, SENDER);
      assert.equal(rt.bus.modules.get('send').ver, 2);
      ok(rt, 'commit', { module: 'send', source: SENDER + '// two\n' }); steps(rt, 1);
      ok(rt, 'revert', { module: 'send' }); steps(rt, 1);
      assert.equal(rt.bus.modules.get('send').source, SENDER);
      assert.equal(run(rt, 'reset', { module: 'zzz' }).ok, false);
      assert.equal(run(rt, 'revert', { module: 'zzz' }).ok, false);
   });

   await check('runtime: resumeHere needs a pause, and the ghost and adopt commands are unknown', () => {
      const rt = fresh();
      ok(rt, 'addModule', { module: 'a', source: SENDER });
      assert.deepEqual(rt.handle({ id: 5, op: 'resumeHere' }), { cmd: 5, ok: false, reason: 'continue from here needs a pause: pause or seek first' });
      assert.deepEqual(rt.handle({ id: 6, op: 'ghost', module: 'a', source: SENDER }), { cmd: 6, ok: false, reason: "unknown command 'ghost'" });
      assert.deepEqual(rt.handle({ id: 7, op: 'adopt', module: 'a' }), { cmd: 7, ok: false, reason: "unknown command 'adopt'" });
   });

   await check('runtime: pause + seek(t) gives snapshot rails equal to railsAt(t); resume returns to live', () => {
      const rt = busy();
      ok(rt, 'pause');
      steps(rt, 50);
      assert.equal(rt.bus.n, 120, 'a paused runtime does not step');
      ok(rt, 'seek', { t: 0.75 });
      const snap = rt.snapshot(), at = Pl.railsAt(rt.recorder, 0.75);
      assert.equal(snap.paused, true); assert.equal(snap.playhead, 0.75);
      for (const id of ['time', 'out']) {
         assert.deepEqual(snap.rails[id].value, at[id].value, id); assert.equal(snap.rails[id].seq, at[id].seq, id);
         assert.equal(snap.rails[id].stale, at[id].stale, id); assert.equal(snap.rails[id].kind, at[id].kind, id);
      }
      assert.equal(snap.rails.out.value, 45, 'the sender had counted to 45 by t = 0.75 s');
      assert.deepEqual(snap.window, [rt.recorder.range().t0, rt.recorder.range().t1]);
      ok(rt, 'seek', { t: 0.25 });
      assert.equal(rt.snapshot().rails.out.value, 15);
      ok(rt, 'seek', { t: -5 }); assert.equal(rt.snapshot().playhead, rt.recorder.range().t0, 'clamped to the window');
      ok(rt, 'seek', { t: 999 }); assert.equal(rt.snapshot().playhead, rt.recorder.range().t1);
      ok(rt, 'resume');
      const live = rt.snapshot();
      assert.equal(live.paused, false); assert.equal(live.playhead, null);
      steps(rt, 5);
      assert.equal(rt.bus.n, 125);
      assert.equal(rt.snapshot().rails.out.value, 125);
   });

   await check('runtime: paused, a variable that the tape has nothing for at the playhead shows no value (not its live one); at a time it has, its recorded one', () => {
      const LATE = "const time = input('time', 'state', 'time'); const late = output('late', 'state', 'num'); const S = state({ n: 0 });\ntime.on(() => { S.n++; late.set(S.n); });\n";
      const rt = fresh(); steps(rt, 60); ok(rt, 'addModule', { module: 'late', source: LATE });
      steps(rt, 60);
      const live = rt.snapshot(); assert.equal(live.rails.late.value, 60, 'live: the live value');
      ok(rt, 'pause'); ok(rt, 'seek', { t: 0.25 });
      const early = rt.snapshot().rails.late;
      assert.ok(early, 'the change is sent'); assert.equal(early.value, null, 'published later than the playhead: no value (null, so that the head replaces the value it had)'); assert.deepEqual(early.tail, []);
      ok(rt, 'seek', { t: 1.5 }); assert.equal(rt.snapshot().rails.late.value, 30, 'after its first message: the recorded value');
      ok(rt, 'resume'); steps(rt, 2); assert.equal(rt.snapshot().rails.late.value, 62, 'live again');
   });

   await check('runtime: seek while live pauses first; play advances the playhead one step per step() up to the window end, then stops', () => {
      const rt = busy();
      assert.equal(rt.bus.paused, false);
      ok(rt, 'seek', { t: 1 });
      assert.equal(rt.bus.paused, true); assert.equal(rt.snapshot().playhead, 1);
      ok(rt, 'play');
      steps(rt, 3);
      assert.ok(Math.abs(rt.snapshot().playhead - (1 + 3 / 60)) < 1e-9);
      assert.equal(rt.bus.n, 120, 'the paused bus itself stays put');
      steps(rt, 200);
      const end = rt.recorder.range().t1;
      assert.equal(rt.snapshot().playhead, end, 'stopped at the window end');
      ok(rt, 'seek', { t: end - 2 / 60 }); ok(rt, 'play'); steps(rt, 5);
      assert.equal(rt.snapshot().playhead, end);
      ok(rt, 'seek', { t: 1 }); ok(rt, 'play'); steps(rt, 2); ok(rt, 'stop');
      const stopped = rt.snapshot().playhead; steps(rt, 5);
      assert.equal(rt.snapshot().playhead, stopped, 'stop holds the playhead');
      assert.equal(rt.snapshot().paused, true);
   });

   await check('runtime: a device value that comes while paused is set at the resume; a gaze.hit value reaches a module that points at its variable', () => {
      const rt = fresh();
      ok(rt, 'addModule', { module: 'look', source: LISTENER });
      ok(rt, 'use', { module: 'look', port: 'p', variable: 'gaze_hit' });
      steps(rt, 2);
      rt.setDevice('gaze', 'hit', [1, 2, 3]); steps(rt, 2);
      assert.deepEqual(rt.bus.modules.get('look').state.got, [1, 2, 3]);
      assert.deepEqual(rt.snapshot().rails.gaze_hit.value, [1, 2, 3]);
      assert.ok(rt.bus.modules.get('look').logs.some(l => l.includes('[1,2,3]')));
      ok(rt, 'pause');
      rt.setDevice('gaze', 'hit', [9, 9, 9]);
      ok(rt, 'resume'); steps(rt, 3);
      assert.deepEqual(rt.bus.rails.get('gaze_hit').value, [9, 9, 9], 'the value that came during the pause is applied at the resume');
      const bad = rt.setDevice('gaze', 'hit', 'not a vec3');
      assert.equal(bad.ok, false);
      assert.equal(rt.setDevice('nobody', 'hit', [1, 2, 3]).ok, false);
      assert.equal(rt.setDevice('gaze', 'on', true).ok, true);
      assert.equal(rt.setDevice('pointer', 'pos', [0, 0, 1]).ok, true);
   });

   await check('runtime: snapshots carry only changed modules, and the source only on a new ver', () => {
      const rt = fresh();
      ok(rt, 'addModule', { module: 'still', source: NOCLOCK }); ok(rt, 'addModule', { module: 'busy', source: SENDER });
      steps(rt, 3);
      const first = rt.snapshot();
      assert.deepEqual(Object.keys(first.modules).sort(), ['busy', 'still']);
      assert.equal(first.modules.still.source, NOCLOCK); assert.equal(first.modules.busy.ver, 1);
      const second = rt.snapshot();
      assert.deepEqual(second.modules, {}, 'nothing changed');
      ok(rt, 'commit', { module: 'still', source: NOCLOCK + '// v2\n' }); steps(rt, 1);
      const third = rt.snapshot();
      assert.deepEqual(Object.keys(third.modules), ['still']);
      assert.equal(third.modules.still.ver, 2); assert.equal(third.modules.still.source, NOCLOCK + '// v2\n');
      ok(rt, 'plug', { module: 'still', on: false }); steps(rt, 1);
      const fourth = rt.snapshot();
      assert.deepEqual(Object.keys(fourth.modules), ['still'], 'a plug changes the ports of one module');
      assert.equal(fourth.modules.still.ports.find(p => p.name === 'out').rail, null);
      assert.equal(fourth.modules.still.source, undefined, 'the source only comes with a new ver');
      assert.equal(fourth.modules.still.ver, 2);
      assert.deepEqual(Object.keys(fourth.modules.still).sort(), ['calls', 'draw', 'editError', 'error', 'logs', 'ports', 'status', 'ver']);
   });

   await check('runtime: snapshot rails carry only what changed, and every 60th call carries all of them', () => {
      const rt = busy();
      ok(rt, 'addModule', { module: 'idler', source: "const idle = output('idle', 'state', 'num'); idle.set(1);\n" }); steps(rt, 1);
      const first = rt.snapshot();
      assert.deepEqual(Object.keys(first.rails).sort(), [...BUILTIN_VARS, 'idle', 'out'].sort());
      const entry = first.rails.out;
      assert.deepEqual(Object.keys(entry).sort(), ['contested', 'kind', 'pubs', 'seq', 'stale', 'subs', 'tail', 'type', 'value']);
      assert.deepEqual(entry.pubs, [['send', 'out']]); assert.deepEqual(entry.subs, []);
      assert.deepEqual(first.rails.time.pubs, [['dev:clock', 'time']]); assert.ok(first.rails.time.subs.some(s => s[0] === 'send'));
      steps(rt, 1);
      const second = rt.snapshot();
      assert.deepEqual(Object.keys(second.rails).sort(), ['out', 'time'], 'the idle variable did not move');
      assert.equal(second.rails.out.seq, entry.seq + 1);
      ok(rt, 'pause');
      rt.snapshot();                  // call 3: pausing makes every rail come from the tape, so they are all sent once
      let withAll = 0, calls = 4;
      for (; calls <= 130; calls++) {
         const n = Object.keys(rt.snapshot().rails).length;
         if (n === BUILTIN_VARS.length + 2) { withAll++; assert.ok(calls === 60 || calls === 120, `call ${calls}`); }
      }
      assert.equal(withAll, 2, 'calls 60 and 120 carry every rail');
   });

   await check('runtime: full() resets what was sent, so the next snapshot carries everything again', () => {
      const rt = busy();
      rt.snapshot(); rt.snapshot();
      assert.deepEqual(rt.snapshot().modules, {});
      rt.full();
      const s = rt.snapshot();
      assert.deepEqual(Object.keys(s.modules), ['send']); assert.equal(s.modules.send.source, SENDER);
      assert.deepEqual(Object.keys(s.rails).sort(), [...BUILTIN_VARS, 'out'].sort());
      assert.deepEqual(Object.keys(s.geometry.cards), ['send']);
   });

   await check('runtime: snapshot fields: rev, t, paused, playhead, window, density, geometry, notices; draw numbers rounded to 4 decimals', () => {
      const rt = fresh();
      ok(rt, 'addModule', { module: 'd', source: "const t = input('time', 'state', 'time');\nt.on(() => draw([{ shape: 'sphere', p: [1 / 3, 2 / 3, 0.123456789], s: 0.0123456, color: '#fff' }, { shape: 'line', p: [0, 0, 0], to: [1 / 7, 0, 0], s: 1, color: '#000' }]));\n" });
      steps(rt, 70);
      const s = rt.snapshot();
      assert.equal(typeof s.rev, 'number'); assert.equal(s.t, rt.bus.t); assert.equal(s.paused, false); assert.equal(s.playhead, null);
      assert.equal(s.window.length, 2); assert.equal(s.window[1], rt.bus.t); assert.ok(!('ghost' in s));
      assert.equal(s.density.length, 60); assert.ok(s.density.reduce((a, b) => a + b, 0) > 0);
      assert.deepEqual(s.modules.d.draw[0].p, [0.3333, 0.6667, 0.1235]); assert.equal(s.modules.d.draw[0].s, 0.0123);
      assert.deepEqual(s.modules.d.draw[1].to, [0.1429, 0, 0]); assert.equal(s.modules.d.draw[0].color, '#fff'); assert.equal(s.modules.d.draw[0].shape, 'sphere');
      assert.ok(Array.isArray(s.notices));
      const rev = s.rev; ok(rt, 'plug', { module: 'd', on: false }); steps(rt, 1);
      assert.ok(rt.snapshot().rev > rev, 'rev grows with a structure change');
   });

   await check('runtime: snapshots are valid wire messages: full, incremental, quarantined module, paused after a seek', () => {
      const rt = busy();
      ok(rt, 'addModule', { module: 'boom', source: "const time = input('time', 'state', 'time');\ntime.on(() => { throw new Error('bang'); });\n" });
      steps(rt, 5);
      assert.equal(rt.bus.modules.get('boom').status, 'quarantined');
      rt.full();
      const full = rt.snapshot();
      assert.equal(W.valid(asMessage(full)), true, 'full');
      assert.equal(full.modules.boom.status, 'quarantined'); assert.equal(full.modules.boom.error.message, 'bang');
      steps(rt, 1);
      const inc = rt.snapshot();
      assert.equal(W.valid(asMessage(inc)), true, 'incremental'); assert.ok(!('boom' in inc.modules));
      assert.equal(run(rt, 'commit', { module: 'boom', source: 'const x = ;' }).ok, false);
      assert.equal(W.valid(asMessage(rt.snapshot())), true, 'a module with an editError');
      ok(rt, 'pause'); ok(rt, 'seek', { t: 0.5 });
      const paused = rt.snapshot();
      assert.equal(W.valid(asMessage(paused)), true, 'paused after a seek'); assert.equal(paused.playhead, 0.5);
      assert.doesNotThrow(() => JSON.parse(JSON.stringify(paused)));
      assert.equal(W.valid(asMessage(rt.snapshot())), true, 'a second paused snapshot');
   });

   await check('runtime: a snapshot carries at most 128 KB of source; the rest follows in the next ones, all within 3', () => {
      const rt = fresh();
      const head = "const out = output('out', 'state', 'num');\n//";
      for (let i = 0; i < 5; i++) ok(rt, 'addModule', { module: `m${i}`, source: head + 'x'.repeat(60000 - head.length) });
      for (let i = 0; i < 5; i++) assert.equal(rt.bus.modules.get(`m${i}`).source.length, 60000);
      rt.full();
      const seen = new Map(), sizes = [];
      for (let k = 0; k < 3; k++) {
         const s = rt.snapshot(), m = asMessage(s);
         assert.equal(W.valid(m), true, `snapshot ${k + 1} is a valid message`);
         const text = Object.values(s.modules).reduce((a, e) => a + (e.source ? e.source.length : 0), 0);
         assert.ok(text <= 128 * 1024, `snapshot ${k + 1}: ${text} chars of source`);
         assert.ok(JSON.stringify(m).length < 256 * 1024);
         sizes.push(Object.keys(s.modules).length);
         for (const [id, e] of Object.entries(s.modules)) { assert.ok(e.source, `${id} came with its source`); seen.set(id, e.source); }
      }
      assert.equal(seen.size, 5, `all five delivered within 3 snapshots (${sizes})`);
      assert.deepEqual(rt.snapshot().modules, {}, 'then nothing is left to send');
   });

   await check('runtime: a source whose JSON escapes push it past the cap is still delivered (one at a time)', () => {
      const rt = fresh();
      ok(rt, 'addModule', { module: 'q', source: "const out = output('out', 'state', 'num');\n//" + '"'.repeat(64000) + '\n' });
      const s = rt.snapshot();
      assert.ok(s.modules.q && s.modules.q.source.length > 64000);
   });

   await check('runtime: geometry: default slots, the geometry command, conflicts, and renames/removals', () => {
      const rt = fresh();
      ok(rt, 'addModule', { module: 'a', source: NOCLOCK }); ok(rt, 'addModule', { module: 'b', source: NOCLOCK });
      let g = rt.snapshot().geometry;
      assert.deepEqual(Object.keys(g), ['cards']);
      assert.equal(g.cards.a.slot, 0); assert.equal(g.cards.b.slot, 1);
      ok(rt, 'geometry', { cards: { a: { slot: 3 }, b: { slot: 0 } } });
      g = rt.snapshot().geometry;
      assert.deepEqual([g.cards.a.slot, g.cards.b.slot], [3, 0]);
      const clash = run(rt, 'geometry', { cards: { a: { slot: 0 } } });
      assert.equal(clash.ok, false); assert.match(clash.reason, /slot 0/);
      assert.equal(rt.snapshot().geometry.cards.a.slot, 3, 'a refused geometry changes nothing');
      assert.equal(run(rt, 'geometry', { cards: { ghosty: { slot: 2 } } }).ok, true, 'unknown ids are ignored');
      assert.ok(!('ghosty' in rt.snapshot().geometry.cards));
      ok(rt, 'renameModule', { module: 'a', to: 'c' }); steps(rt, 1);
      g = rt.snapshot().geometry;
      assert.equal(g.cards.c.slot, 3); assert.ok(!('a' in g.cards));
      ok(rt, 'rmModule', { module: 'c' }); steps(rt, 1);
      g = rt.snapshot().geometry;
      assert.deepEqual(Object.keys(g.cards), ['b']);
      ok(rt, 'addModule', { module: 'again' });
      assert.equal(rt.snapshot().geometry.cards.again.slot, 1, 'a freed slot is reused');
      for (const id of ['x1', 'x2', 'x3']) ok(rt, 'addModule', { module: id, source: NOCLOCK });
      const sixth = run(rt, 'addModule', { module: 'x4', source: NOCLOCK });
      assert.equal(sixth.ok, false); assert.match(sixth.reason, /5/);
   });

   await check('runtime: structure commands while paused are queued; addModule and commit are refused with the paused reason', () => {
      const rt = busy();
      ok(rt, 'pause');
      const add = run(rt, 'addModule', { module: 'late' });
      assert.equal(add.ok, false); assert.match(add.reason, /paused/);
      const com = run(rt, 'commit', { module: 'send', source: SENDER + '//x\n' });
      assert.equal(com.ok, false); assert.match(com.reason, /paused/);
      ok(rt, 'plug', { module: 'send', on: false }); steps(rt, 3);
      assert.equal(rt.bus.unplugged.size, 0, 'queued, not applied while paused');
      ok(rt, 'resume'); steps(rt, 1);
      assert.deepEqual([...rt.bus.unplugged], ['send']);
   });

   await check('runtime: load + layoutFile round-trip; a card with no source loads the skeleton; a bad source is reported, not thrown', () => {
      const rt = busy();
      ok(rt, 'addModule', { module: 'look', source: LISTENER });
      ok(rt, 'use', { module: 'look', port: 'p', variable: 'gaze_hit' });
      ok(rt, 'geometry', { cards: { send: { slot: 4 } } });
      steps(rt, 2);
      const file = rt.layoutFile();
      assert.deepEqual(file, { cards: { send: { slot: 4 }, look: { slot: 1 } }, uses: { 'look.p': 'gaze_hit' }, unplugged: [] });
      assert.doesNotThrow(() => JSON.stringify(file));
      const again = fresh();
      const res = again.load({ layout: JSON.parse(JSON.stringify(file)), sources: { send: SENDER, look: LISTENER } });
      assert.equal(res.ok, true, JSON.stringify(res));
      assert.deepEqual(again.layoutFile(), file, 'the layout file reads back as it was written');
      steps(again, 3);
      assert.equal(again.bus.rails.get('out').value, 3, 'the loaded wiring runs');
      again.setDevice('gaze', 'hit', [1, 2, 3]); steps(again, 2);
      assert.deepEqual(again.bus.modules.get('look').state.got, [1, 2, 3], 'and the use was kept');
      // missing source: skeleton; broken source: reported
      const part = fresh();
      const res2 = part.load({ layout: { cards: { ball: { slot: 2 }, bad: { slot: 0 } } }, sources: { bad: 'const x = ;' } });
      assert.equal(part.bus.modules.get('ball').source, Tp.skeleton('ball'));
      assert.ok(!part.bus.modules.has('bad')); assert.equal(res2.ok, false); assert.ok(res2.errors.some(e => /bad/.test(e.what)));
      assert.ok(part.notices.some(n => /bad/.test(n.text)), 'the failure is a notice');
      assert.equal(part.snapshot().geometry.cards.ball.slot, 2);
      assert.doesNotThrow(() => fresh().load({}));
      assert.doesNotThrow(() => fresh().load({ layout: 'x', sources: 5 }));
      assert.doesNotThrow(() => fresh().load({ layout: { cards: { x: 1 }, rails: { y: 'z' }, docks: [1, [2, 3]] } }));
      assert.doesNotThrow(() => fresh().load({ layout: { cards: { x: 1 }, uses: 5, unplugged: 'x' } }));
   });

   await check('runtime: load can restore a snapshot of a run in progress (the Worker restart path)', () => {
      const a = busy();
      const snap = a.bus.snapshot(), layout = a.layoutFile();
      const b = fresh();
      const res = b.load({ layout, sources: { send: SENDER }, snapshot: snap });
      assert.equal(res.ok, true, JSON.stringify(res));
      steps(a, 10); steps(b, 10);
      assert.equal(b.bus.rails.get('out').value, a.bus.rails.get('out').value);
      assert.equal(b.snapshot().geometry.cards.send.slot, 0);
   });

   await check('runtime: notices come from the bus and the host can add one', () => {
      const rt = fresh();
      ok(rt, 'addModule', { module: 'a', source: LISTENER }); ok(rt, 'use', { module: 'a', port: 'p', variable: 'gaze_hit' }); steps(rt, 1);
      ok(rt, 'commit', { module: 'a', source: "const time = input('time', 'state', 'time');\n" }); steps(rt, 1);
      assert.ok(rt.notices.length >= 1 && /use of a\.p/.test(rt.notices[0].text));
      assert.equal(rt.snapshot().notices.length, rt.notices.length);
      rt.addNotice('worker restarted');
      assert.equal(rt.snapshot().notices.at(-1).text, 'worker restarted');
      assert.equal(W.valid(asMessage(rt.snapshot())), true);
   });

   // ---- runtime: the size budget, the time input and the small fixes ---------------------------
   // Five modules at the limits and 16 event rails with full tails: a snapshot of all of it is ~1 MB, which the wire drops.
   const SPAM = "const time = input('time', 'state', 'time');\nconst outs = Array.from({ length: 16 }, (_, i) => output('e' + i, 'event', 'str'));\n" +
      "time.on(({ n }) => {\n   const s = 'x'.repeat(3900);\n   for (const o of outs) o.emit(s + n);\n   log('y'.repeat(490));\n" +
      "   draw(Array.from({ length: 128 }, (_, i) => ({ shape: 'sphere', p: [i / 7, n / 3, 1 / 3], s: 0.01, color: '#ffffff' })));\n});\n";
   const worst = () => {
      const rt = fresh(), head = "const out = output('out', 'state', 'num');\n//";
      ok(rt, 'addModule', { module: 'spam', source: SPAM });
      for (let i = 0; i < 4; i++) ok(rt, 'addModule', { module: `big${i}`, source: head + 'x'.repeat(60000 - head.length) });
      steps(rt, 60);
      return rt;
   };
   // What the headset would hold: rails replaced by what arrives, modules merged (the source is kept when absent).
   const apply = (mirror, snap) => {
      Object.assign(mirror.rails, snap.rails);
      for (const [id, e] of Object.entries(snap.modules)) mirror.modules[id] = { ...(mirror.modules[id] || {}), ...e };
   };
   const J = JSON.stringify;
   const matches = (rt, mirror) => {
      for (const [id, r] of rt.bus.rails) {
         const m = mirror.rails[id];
         if (!m || m.seq !== r.seq || J(m.tail) !== J(r.tail.slice(-8)) || J(m.value) !== J(r.value)) return false;
      }
      for (const [id, mod] of rt.bus.modules) {
         const m = mirror.modules[id];
         if (!m || m.ver !== mod.ver || m.source !== mod.source || m.calls !== mod.calls || J(m.logs) !== J(mod.logs.slice(-20)) || m.draw.length !== mod.draw.length) return false;
      }
      return true;
   };

   await check('runtime: the worst case (1 MB of content) is sent within the budget, every snapshot valid, and a mirror converges', () => {
      const rt = worst(), mirror = { rails: {}, modules: {} };
      rt.full();
      let n = 0, biggest = 0;
      for (; n < 16 && !matches(rt, mirror); n++) {
         const snap = rt.snapshot(), m = asMessage(snap), size = JSON.stringify(m).length;
         biggest = Math.max(biggest, size);
         assert.equal(W.valid(m), true, `snapshot ${n + 1} (${size} chars) is a valid message`);
         assert.ok(size <= 200 * 1024, `snapshot ${n + 1}: ${size}`);
         apply(mirror, snap);
      }
      assert.ok(matches(rt, mirror), 'converged'); assert.ok(n <= 12, `within a bounded number of snapshots (${n})`);
      assert.ok(n >= 3, 'it really did not fit in one');
      assert.equal(Object.keys(mirror.modules).length, 5);
      assert.equal(mirror.modules.spam.logs.length, 20, 'a snapshot carries the last 20 log lines'); assert.equal(rt.bus.modules.get('spam').logs.length, 50);
      assert.equal(mirror.rails.e0.tail.length, 8, 'and the last 8 messages of a tail'); assert.ok(rt.bus.rails.get('e0').tail.length > 8);
      // the same content as one snapshot would have been over the wire's limit
      const all = { rails: {}, modules: {} };
      for (const [id, r] of rt.bus.rails) all.rails[id] = { ...r, tail: r.tail.slice() };
      assert.ok(JSON.stringify(all).length > 256 * 1024 || biggest > 150 * 1024);
      const again = rt.snapshot();
      assert.deepEqual([Object.keys(again.rails).length, Object.keys(again.modules).length], [0, 0], 'then nothing is left over');
   });

   await check('runtime: a chatty module and 16 busy rails do not starve a module that changes once', () => {
      const rt = fresh();
      ok(rt, 'addModule', { module: 'spam', source: SPAM });
      ok(rt, 'addModule', { module: 'quiet', source: NOCLOCK });
      steps(rt, 20); rt.full();
      const mirror = { rails: {}, modules: {} }, seenRails = new Set();
      let big = 0, arrived = null;
      for (let k = 1; k <= 24; k++) {
         steps(rt, 1);                                   // the world moves between snapshots: every rail and the spam module change each time
         if (k === 3) ok(rt, 'commit', { module: 'quiet', source: NOCLOCK + '// v2\n' });
         const snap = rt.snapshot(), m = asMessage(snap), size = JSON.stringify(m).length;
         assert.equal(W.valid(m), true, `snapshot ${k}`); assert.ok(size <= 200 * 1024);
         if (size > 150 * 1024) big++;
         apply(mirror, snap);
         for (const id of Object.keys(snap.rails)) seenRails.add(id);
         if (arrived === null && mirror.modules.quiet && mirror.modules.quiet.ver === 2) arrived = k;
      }
      assert.ok(big >= 6, `the budget was under pressure (${big} large snapshots)`);
      assert.ok(arrived !== null && arrived <= 3 + 5, `the quiet module's new version arrived (snapshot ${arrived})`);
      assert.equal(mirror.modules.quiet.source, NOCLOCK + '// v2\n');
      assert.equal(seenRails.size, 16 + BUILTIN_VARS.length + 1, 'every variable was sent');
   });

   await check('runtime: a source that alone is too large is sent without its source, with a notice; the others are unharmed', () => {
      const rt = fresh();
      ok(rt, 'addModule', { module: 'fine', source: SENDER });
      ok(rt, 'addModule', { module: 'ctl', source: "const out = output('out', 'state', 'num');\n//" + '\u0001'.repeat(63000) + '\n' });
      assert.ok(JSON.stringify(rt.bus.modules.get('ctl').source).length > 300000);
      const s = rt.snapshot(), m = asMessage(s);
      assert.equal(W.valid(m), true); assert.ok(JSON.stringify(m).length < 200 * 1024);
      assert.equal(s.modules.ctl.ver, 1); assert.ok(!('source' in s.modules.ctl), 'no source for the module that cannot sync');
      assert.equal(s.modules.fine.source, SENDER);
      assert.equal(s.notices.filter(n => /ctl/.test(n.text) && /too large/.test(n.text)).length, 1);
      const next = rt.snapshot();
      assert.deepEqual(next.modules, {}, 'not resent');
      assert.equal(next.notices.filter(n => /too large/.test(n.text)).length, 1, 'one notice, not one per snapshot');
      ok(rt, 'commit', { module: 'ctl', source: "const out = output('out', 'state', 'num');\n" }); steps(rt, 1);
      const fixed = rt.snapshot();
      assert.equal(fixed.modules.ctl.source, "const out = output('out', 'state', 'num');\n", 'a small source syncs again');
   });

   await check('runtime: a card\'s time input binds by name, unless a use (or an old layout\'s dock) says another variable', () => {
      const rt = fresh();
      const res = rt.load({ layout: { cards: { send: { slot: 0 } } }, sources: { send: SENDER } });
      assert.equal(res.ok, true, JSON.stringify(res));
      steps(rt, 5);
      assert.equal(rt.bus.rails.get('out').value, 5, 'it ticks');
      const off = fresh();   // a use that names another variable is respected: it waits for it
      off.load({ layout: { cards: { send: { slot: 0 } }, uses: { 'send.time': 'later' } }, sources: { send: SENDER } });
      steps(off, 3);
      assert.equal(off.bus.modules.get('send').state.n, 0);
      const old = fresh();   // an old layout that docks time to a rail nobody publishes means the same
      old.load({ layout: { cards: { send: { slot: 0 } }, rails: { c2: { kind: 'state', type: 'time', lane: 0 } }, docks: [['send', 'time', 'c2']] }, sources: { send: SENDER } });
      steps(old, 3);
      assert.equal(old.bus.modules.get('send').state.n, 0);
      assert.deepEqual(old.layoutFile().uses, { 'send.time': 'c2' });
   });

   await check('runtime: small fixes: a variable made again is resent at once, bad seek and geometry get reasons, every 60th call refreshes calls', () => {
      const rt = busy();
      rt.snapshot();
      ok(rt, 'plug', { module: 'send', on: false }); steps(rt, 1);
      assert.ok(!rt.snapshot().vars.includes('out'), 'nobody holds it: it is gone');
      ok(rt, 'plug', { module: 'send', on: true }); steps(rt, 1);
      const s = rt.snapshot();
      assert.ok('out' in s.rails, 'the new `out` is sent though its numbers could equal the old ones');
      assert.equal(run(rt, 'seek', { t: NaN }).reason, 't must be a finite number');
      assert.equal(run(rt, 'seek', { t: Infinity }).ok, false); assert.equal(run(rt, 'seek', { t: 'x' }).ok, false);
      assert.equal(rt.bus.paused, false, 'a refused seek does not pause');
      const nul = run(rt, 'geometry', { cards: { send: null } });
      assert.equal(nul.ok, false); assert.ok(!/TypeError|Cannot read/.test(nul.reason), nul.reason);
      assert.match(nul.reason, /must be an object/);
      assert.equal(run(rt, 'geometry', { cards: 5 }).ok, false);
      const q = fresh();
      ok(q, 'addModule', { module: 'send', source: SENDER }); steps(q, 1);
      q.full(); q.snapshot();
      steps(q, 3);
      let withModule = 0;
      for (let call = 2; call <= 60; call++) { const snap = q.snapshot(); if (snap.modules.send) { withModule++; assert.equal(snap.modules.send.calls, 4); assert.equal(call, 60); } }
      assert.equal(withModule, 1, 'the 60th call carries the module for its calls alone');
   });


   // ---- worker core and runtime host -------------------------------------------------------------------------------
   const Wk = await load('js/scenes/rails/worker.js');
   const Hs = await load('js/scenes/rails/runtimeHost.js');
   const STEP = 1000 / 60;

   // The Worker's core with a fake interval and a fake clock: tick(n) advances the clock n timer periods and fires the timer.
   const core = () => {
      const posted = [], clock = { t: 5000 }, timers = new Map(); let nextTimer = 1, cleared = 0;
      const c = Wk.workerCore({ post: m => posted.push(JSON.parse(JSON.stringify(m))), now: () => clock.t,
         setInterval: (fn, ms) => { timers.set(nextTimer, { fn, ms }); return nextTimer++; },
         clearInterval: id => { cleared++; timers.delete(id); } });
      const api = { c, posted, clock, timers, get cleared() { return cleared; },
         send: m => c.onmessage({ data: m }),
         tick: (n = 1, ms = STEP) => { for (let i = 0; i < n; i++) { clock.t += ms; for (const t of [...timers.values()]) t.fn(); } },
         of: type => posted.filter(m => m.type === type), clear: () => { posted.length = 0; } };
      return api;
   };
   const LAYOUT = { cards: { send: { slot: 0 }, hear: { slot: 1 } }, uses: { 'hear.p': 'out' }, unplugged: [] };
   const HEAR = "const p = input('p', 'state', 'num');\nconst time = input('time', 'state', 'time');\nconst S = state({ got: 0 });\np.on(v => { S.got = v; });\n";
   const INIT = { type: 'init', seed: 1, layout: LAYOUT, sources: { send: SENDER, hear: HEAR }, snapshot: null, hung: [] };

   await check('worker: init builds the runtime; every tick beats, every second tick snaps, once a second a snapshot with the layout', () => {
      const w = core();
      w.tick(3); assert.equal(w.posted.length, 0, 'nothing runs before init');
      w.send(INIT);
      assert.equal(w.timers.size, 1); assert.ok(Math.abs([...w.timers.values()][0].ms - STEP) < 1e-9, 'a 60 Hz timer');
      w.tick(120);
      const beats = w.of('beat');
      assert.equal(beats.length, 120); assert.deepEqual(beats.map(b => b.n), Array.from({ length: 120 }, (_, i) => i + 1));
      assert.ok(beats.every(b => b.paused === false));
      assert.equal(w.of('snap').length, 60); assert.equal(w.of('snapshot').length, 2);
      assert.equal(w.c.runtime.bus.n, 120, 'one step per tick');
      for (const s of w.of('snap')) assert.ok(W.valid(asMessage(s.snap)), 'a snap the wire accepts');
      const shot = w.of('snapshot')[1];
      assert.deepEqual(shot.layout, w.c.runtime.layoutFile()); assert.equal(shot.snap.n, 120);
      assert.ok(shot.snap.modules.send && shot.snap.rails.out);
      assert.deepEqual(w.posted.slice(0, 3).map(m => m.type), ['beat', 'snap', 'beat'], 'tick 1 beats; tick 2 snaps, then beats');
   });

   await check('worker: the beat comes after the snap of its tick, and paused shows in it', () => {
      const w = core(); w.send(INIT); w.tick(1); w.clear(); w.tick(1);
      assert.deepEqual(w.posted.map(m => m.type), ['snap', 'beat']);
      w.send({ type: 'cmd', cmd: { id: 5, op: 'pause' } }); w.clear();
      w.tick(10);
      assert.equal(w.of('beat').length, 10, 'paused or not, it beats');
      assert.ok(w.of('beat').every(b => b.paused === true));
      assert.equal(w.c.runtime.bus.n, 2 + 0, 'no steps while paused');
   });

   await check('worker: cmd gets an ack with the command id; dev reaches the runtime; garbage is ignored', () => {
      const w = core(); w.send(INIT); w.tick(2); w.clear();
      w.send({ type: 'cmd', cmd: { id: 41, op: 'plug', module: 'hear', on: false } });
      w.send({ type: 'cmd', cmd: { id: 42, op: 'plug', module: 'nope', on: false } });
      w.send({ type: 'cmd', cmd: { id: 43, op: 'eval' } });
      const acks = w.of('ack');
      assert.deepEqual(acks[0], { type: 'ack', cmd: 41, ok: true });
      assert.equal(acks[1].cmd, 42); assert.equal(acks[1].ok, false); assert.equal(typeof acks[1].reason, 'string');
      assert.equal(acks[2].ok, false);
      w.send({ type: 'dev', id: 'gaze', port: 'hit', value: [1, 2, 3] });
      w.tick(2);
      assert.deepEqual(w.c.runtime.bus.devices.get('gaze').ports.find(p => p.name === 'hit').value, [1, 2, 3]);
      for (const junk of [null, 5, {}, { data: null }, { data: { type: 7 } }, { data: { type: 'nope' } }]) assert.doesNotThrow(() => w.c.onmessage(junk));
   });

   await check('worker: full makes the next snaps carry everything again', () => {
      const w = core(); w.send(INIT); w.tick(10);
      const seen = () => w.of('snap').some(s => s.snap.modules.send);
      assert.equal(seen(), true, 'the first snap has the modules'); w.clear(); w.tick(6);
      assert.equal(seen(), false, 'later ones carry only changes');
      w.send({ type: 'full' }); w.clear(); w.tick(2);
      assert.equal(seen(), true); assert.ok(w.of('snap')[0].snap.modules.hear.source);
   });

   await check('worker: catches up at most 4 steps after a stall, and a slow beat does not burst', () => {
      const w = core(); w.send(INIT); w.tick(2);
      const n0 = w.c.runtime.bus.n;
      w.tick(1, 1000);   // a whole second late
      assert.equal(w.c.runtime.bus.n - n0, 4);
      w.tick(1, STEP * 2.5);
      assert.equal(w.c.runtime.bus.n - n0, 6, 'then back to what is due');
      w.tick(10, STEP); assert.equal(w.c.runtime.bus.n - n0, 16);
      assert.equal(w.of('beat').length, 14, 'one beat per tick whatever the steps');
   });

   await check('worker: init from a snapshot carries on; a second init replaces the first and clears its timer', () => {
      const a = core(); a.send(INIT); a.tick(90);
      const shot = a.of('snapshot').pop();
      const rails = shot.snap.rails.out.value;
      assert.ok(rails > 0);
      const b = core(); b.send({ ...INIT, snapshot: shot.snap, layout: shot.layout, seed: 1 });
      assert.equal(b.c.runtime.bus.n, shot.snap.n);
      assert.equal(b.c.runtime.bus.rails.get('out').value, rails);
      assert.equal(b.c.runtime.bus.modules.get('send').state.n, shot.snap.modules.send.state.n);
      assert.ok(b.c.runtime.bus.modules.get('hear'));
      b.tick(1); assert.equal(b.c.runtime.bus.n, shot.snap.n + 1);
      b.send(INIT); assert.equal(b.cleared, 1); assert.equal(b.timers.size, 1);
      assert.equal(b.c.runtime.bus.n, 0, 'a fresh run');
      const bad = core(); bad.send({ ...INIT, snapshot: { junk: true } });
      assert.ok(bad.c.runtime.bus.modules.get('send'), 'a bad snapshot falls back to layout and sources');
   });

   await check('worker: a hung module is quarantined with the hung error and runs its last good source; the notice is added', () => {
      const w = core();
      w.send({ ...INIT, hung: ['send'], notice: 'worker restarted: no beat for 520 ms' });
      const m = w.c.runtime.bus.modules.get('send');
      assert.equal(m.status, 'quarantined');
      assert.deepEqual({ phase: m.error.phase, message: m.error.message }, { phase: 'handler', message: 'hung (infinite loop?)' });
      assert.equal(m.source, SENDER, 'the last good source it was given');
      assert.equal(w.c.runtime.bus.modules.get('hear').status, 'ok');
      w.tick(2);
      const notices = w.of('snap')[0].snap.notices.map(n => n.text);
      assert.ok(notices.includes('worker restarted: no beat for 520 ms'), notices.join('|'));
      w.tick(20); assert.equal(m.state.n, 0, 'a quarantined module does not run');
   });

   await check('worker: a hung module with no earlier version is left out with a notice; the others run; also from a snapshot', () => {
      const a = core(); a.send(INIT); a.tick(70);
      const shot = a.of('snapshot').pop();
      for (const init of [{ ...INIT, sources: { hear: HEAR }, hung: ['send'] }, { ...INIT, sources: { hear: HEAR }, hung: ['send'], snapshot: shot.snap, layout: shot.layout }]) {
         const w = core(); w.send(init);
         assert.ok(!w.c.runtime.bus.modules.has('send'), 'left out');
         assert.ok(w.c.runtime.bus.modules.has('hear'));
         assert.ok(!('send' in w.c.runtime.layoutFile().cards));
         assert.ok(!Object.keys(w.c.runtime.layoutFile().uses).some(k => k.startsWith('send.')) && !w.c.runtime.layoutFile().unplugged.includes('send'), 'its wiring is gone too');
         w.tick(2);
         assert.ok(w.of('snap')[0].snap.notices.some(n => /send/.test(n.text) && /no earlier version/.test(n.text)));
         w.tick(5); assert.equal(w.of('beat').length, 7);
      }
   });

   // ---- the replay in the runtime ----
   const PHASE = "const time = input('time', 'state', 'time'); const out = output('out', 'state', 'num');\nconst S = state({ n: 0 });\ntime.on(() => { S.n++; out.set(S.n); draw([{ shape: 'sphere', p: [S.n / 3, 0, 1 / 7], s: .01, color: '#fff' }]); });\n";
   const phased = () => {
      const rt = fresh();
      ok(rt, 'addModule', { module: 'send', source: PHASE });
      steps(rt, 130);
      return rt;
   };
   const paused = () => { const rt = phased(); ok(rt, 'pause'); return rt; };

   await check('runtime replay: paused before the end, the snapshot is valid on the wire, has no ghost field, and its picture is the past\'s (rounded like a live list)', () => {
      const rt = paused();
      let s = rt.snapshot();
      assert.equal(W.valid(asMessage(s)), true); assert.ok(!('ghost' in s));
      assert.deepEqual(s.modules.send.draw[0].p, [43.3333, 0, 0.1429], 'at the end: the live picture');
      ok(rt, 'seek', { t: 1 });
      s = rt.snapshot();
      assert.equal(W.valid(asMessage(s)), true); assert.equal(s.playhead, 1);
      assert.deepEqual(s.modules.send.draw[0].p, [20, 0, 0.1429], 'the picture of 1 s, which the live module is far from');
      assert.equal(s.rails.out.value, 60, 'and the rail of the tape agrees with it');
      assert.equal(rt.bus.modules.get('send').state.n, 130, 'the live world is untouched');
      ok(rt, 'seek', { t: 0.5 }); assert.deepEqual(rt.snapshot().modules.send.draw[0].p, [10, 0, 0.1429]);
      ok(rt, 'resume'); steps(rt, 1); s = rt.snapshot(); assert.deepEqual(s.modules.send.draw[0].p, [43.6667, 0, 0.1429], 'live again');
   });

   await check('runtime replay: the snapshot sends a picture again only when it changed (while playing, and after a seek), and everything after full() or a new pause', () => {
      const rt = paused(); ok(rt, 'seek', { t: 0.5 });
      const a = rt.snapshot(); assert.ok(a.modules.send, 'the new picture goes');
      assert.deepEqual(rt.snapshot().modules, {}, 'nothing moved: nothing sent');
      ok(rt, 'seek', { t: 0.5 }); assert.deepEqual(rt.snapshot().modules, {}, 'the same place');
      ok(rt, 'seek', { t: 0.6 }); assert.deepEqual(rt.snapshot().modules.send.draw[0].p, [12, 0, 0.1429]);
      ok(rt, 'play');
      for (let i = 0; i < 4; i++) { rt.step(); const s = rt.snapshot(); assert.deepEqual(s.modules.send.draw[0].p, [(36 + i + 1) / 3, 0, 0.1429].map(x => Math.round(x * 1e4) / 1e4), 'a picture a step'); }
      ok(rt, 'stop'); assert.deepEqual(rt.snapshot().modules, {});
      rt.full(); assert.ok(rt.snapshot().modules.send);
   });

   await check('runtime replay: a card that was not there at the playhead draws nothing; the snapshot still lists it (geometry is the live one)', () => {
      const rt = phased(); ok(rt, 'addModule', { module: 'late', source: PHASE }); steps(rt, 70); ok(rt, 'pause');
      ok(rt, 'seek', { t: 1 });
      const s = rt.snapshot();
      assert.deepEqual(s.modules.late.draw, [], 'it did not exist yet'); assert.deepEqual(s.modules.send.draw[0].p, [20, 0, 0.1429]);
      assert.deepEqual(Object.keys(s.geometry.cards).sort(), ['late', 'send']);
      ok(rt, 'seek', { t: 2.2 }); assert.equal(rt.snapshot().modules.late.draw[0].p[0] > 0, true, 'and later it does');
   });

   await check('runtime replay: the replay\'s pictures count toward the snapshot budget: 128 big shapes and big values stay under 200 KB with big module sources beside them', () => {
      const BIG = "const time = input('time', 'state', 'time'); const o = output('o', 'state', 'str'); const e = output('e', 'event', 'str');\n" +
         "time.on(() => { const s = 'x'.repeat(2000); o.set(s); e.emit(s); draw(Array.from({ length: 128 }, (_, i) => ({ shape: 'text', p: [i / 1000, 0, 0.123456], s: .01, color: '#ffffff', text: 'y'.repeat(200) }))); });\n";
      const rt = fresh();
      ok(rt, 'addModule', { module: 'big', source: BIG });
      for (let i = 0; i < 4; i++) ok(rt, 'addModule', { module: `pad${i}`, source: `// ${'z'.repeat(30000)}\nconst time = input('time', 'state', 'time');\n` });
      steps(rt, 100); ok(rt, 'pause'); ok(rt, 'seek', { t: 0.5 });
      rt.full();
      const s = rt.snapshot(), size = JSON.stringify(s).length;
      assert.ok(size <= Sn.BUDGET, `the snapshot is ${size} characters of ${Sn.BUDGET}`);
      assert.equal(W.valid(asMessage(s)), true);
      for (let i = 0; i < 8; i++) { const t = rt.snapshot(); assert.ok(JSON.stringify(t).length <= Sn.BUDGET); }
   });

   await check('runtime resumeHere: acked like the others, the next snapshot says the new present (live, no tape, a new rev) and is valid on the wire', () => {
      const rt = paused(); ok(rt, 'seek', { t: 1 });
      const rev = rt.snapshot().rev;
      assert.deepEqual(run(rt, 'resumeHere'), { cmd: cmdId, ok: true });
      const s = rt.snapshot();
      assert.equal(W.valid(asMessage(s)), true);
      assert.equal(s.paused, false); assert.equal(s.playhead, null); assert.equal(s.playing, false); assert.equal(s.t, 1); assert.deepEqual(s.window, [1, 1]); assert.ok(s.rev > rev);
      assert.equal(s.modules.send.source, PHASE, 'the cards are sent again, with their sources'); assert.equal(s.modules.send.ver, 1);
      assert.deepEqual(s.modules.send.draw[0].p, [20, 0, 0.1429]); assert.equal(s.rails.out.value, 60);
      steps(rt, 2); assert.equal(rt.snapshot().rails.out.value, 62);
      assert.equal(rt.snapshot().window[0], 1, 'the tape begins at the playhead that went live');
   });

   // ---- the host: a fake link, store and Worker, a fake clock ---------------------------------------------------------
   const hostWorld = (opts = {}) => {
      const w = { t: 1000, workers: [], saves: [], layouts: [], snaps: [], acks: [], handlers: {}, timers: [] };
      w.link = { mutual: true, on(type, fn) { (w.handlers[type] ||= []).push(fn); return this; },
                 sendSnap: s => { w.snaps.push(s); return true; }, sendAck: (c, o, r) => { w.acks.push([c, o, r]); return true; } };
      w.emit = (type, m) => { for (const fn of w.handlers[type] || []) fn(m, 2); };
      w.files = { 'layout': opts.layout === undefined ? JSON.parse(JSON.stringify(LAYOUT)) : opts.layout, send: SENDER, hear: HEAR, ...(opts.files || {}) };
      w.store = { problem: null, loadLayout: async () => w.files.layout, loadModule: async n => (typeof w.files[n] === 'string' ? w.files[n] : null),
                  saveModule: async (n, s) => { w.saves.push([n, s]); return { ok: true }; }, saveLayout: async l => { w.layouts.push(JSON.parse(JSON.stringify(l))); return { ok: true }; } };
      w.makeWorker = () => {
         const wk = { posted: [], terminated: false, onmessage: null, onerror: null,
                      postMessage(m) { this.posted.push(JSON.parse(JSON.stringify(m))); }, terminate() { this.terminated = true; },
                      say(m) { if (this.onmessage) this.onmessage({ data: JSON.parse(JSON.stringify(m)) }); } };
         w.workers.push(wk); return wk;
      };
      w.host = Hs.createRuntimeHost({ link: w.link, store: w.store, now: () => w.t, makeWorker: w.makeWorker,
         setInterval: (fn, ms) => { const t = { fn, ms, on: true }; w.timers.push(t); return t; }, clearInterval: t => { t.on = false; } });
      w.cur = () => w.workers[w.workers.length - 1];
      w.live = () => w.workers.filter(x => !x.terminated);
      w.tickHost = () => { for (const t of w.timers) if (t.on) t.fn(); };
      // time passes in 100 ms watchdog periods, the Worker beating every 100 ms while `beating` is true
      w.run = (ms, beating = false, paused = false) => { for (let left = ms; left > 0; left -= 100) { w.t += 100; if (beating) w.cur().say({ type: 'beat', n: 0, paused }); w.tickHost(); } };
      w.beat = (n = 1) => { for (let i = 0; i < n; i++) w.cur().say({ type: 'beat', n: i, paused: false }); };
      w.of = (wk, type) => wk.posted.filter(m => m.type === type);
      return w;
   };
   const started = async opts => { const w = hostWorld(opts); await w.host.start(); return w; };
   const cmdOf = (id, op, extra = {}) => ({ cmd: { id, op, ...extra } });
   const COMMIT = (id, module, source) => cmdOf(id, 'commit', { module, source });

   await check('host: start loads the layout and the sources through the store and starts the Worker with init', async () => {
      const w = await started();
      assert.equal(w.workers.length, 1);
      const init = w.workers[0].posted[0];
      assert.equal(init.type, 'init'); assert.deepEqual(init.layout, LAYOUT);
      assert.deepEqual(init.sources, { send: SENDER, hear: HEAR }); assert.equal(init.snapshot, null); assert.deepEqual(init.hung, []);
      assert.equal(typeof init.seed, 'number');
      assert.ok(w.timers.some(t => t.on && t.ms <= 250), 'a watchdog timer');
      const missing = await started({ layout: null, files: { send: null } });
      assert.deepEqual(missing.workers[0].posted[0].layout, {}); assert.equal(missing.workers.length, 1, 'a bad layout starts empty');
      const noFile = await started({ files: { hear: undefined } });
      assert.deepEqual(noFile.workers[0].posted[0].sources, { send: SENDER }, 'a card without a file gets no source (the skeleton)');
   });

   await check('host: cmd and dev go to the Worker, snap and ack come back to the link, pair sends full', async () => {
      const w = await started(), wk = w.workers[0];
      w.emit('cmd', cmdOf(7, 'pause')); w.emit('dev', { id: 'gaze', port: 'on', value: true });
      assert.deepEqual(wk.posted.slice(1), [{ type: 'cmd', cmd: { id: 7, op: 'pause' } }, { type: 'dev', id: 'gaze', port: 'on', value: true }]);
      wk.say({ type: 'snap', snap: { rev: 3, t: 1 } }); assert.deepEqual(w.snaps, [{ rev: 3, t: 1 }]);
      wk.say({ type: 'ack', cmd: 7, ok: false, reason: 'nope' }); wk.say({ type: 'ack', cmd: 8, ok: true });
      assert.deepEqual(w.acks, [[7, false, 'nope'], [8, true, undefined]]);
      wk.posted.length = 0; w.emit('pair', {}); assert.deepEqual(wk.posted, [{ type: 'full' }]);
      w.link.mutual = false; wk.say({ type: 'snap', snap: { rev: 4 } }); assert.equal(w.snaps.length, 1, 'no snaps to a peer that does not hear us');
      for (const junk of [null, 5, 'x', { type: 'x' }, { type: 'snapshot' }, { type: 'snapshot', snap: 1, layout: 2 }]) assert.doesNotThrow(() => wk.onmessage({ data: junk }));
      assert.doesNotThrow(() => { wk.onmessage(null); wk.onmessage({}); });
   });

   await check('host: pointer pos from feedPointer and pointer down from the IDE merge into one value; each owner keeps its own half', async () => {
      const w = await started(), wk = w.workers[0]; wk.posted.length = 0;
      w.host.feedPointer([1, 2, 3]);
      w.emit('dev', { id: 'pointer', port: 'down', value: true });
      assert.deepEqual(w.host.stats.pointer, { pos: [1, 2, 3], down: true });
      assert.deepEqual(wk.posted, [{ type: 'dev', id: 'pointer', port: 'pos', value: [1, 2, 3] }, { type: 'dev', id: 'pointer', port: 'down', value: true }]);
      wk.posted.length = 0;
      w.host.feedPointer([1, 2, 3]); assert.equal(wk.posted.length, 0, 'an unchanged position is not sent again');
      w.emit('dev', { id: 'pointer', port: 'pos', value: [9, 9, 9] }); assert.equal(wk.posted.length, 0, 'the laptop owns pos');
      w.host.feedPointer([4, 5, 6]); assert.deepEqual(w.host.stats.pointer, { pos: [4, 5, 6], down: true });
      for (const bad of [null, [1, 2], [1, 2, NaN], 'x', [1, 2, '3']]) w.host.feedPointer(bad);
      assert.deepEqual(w.host.stats.pointer.pos, [4, 5, 6]); assert.equal(wk.posted.length, 1);
      w.emit('dev', { id: 'gaze', port: 'hit', value: [0, 0, -1] });
      assert.equal(wk.posted[1].id, 'gaze');
      const fresh = await started(); fresh.host.feedPointer([7, 8, 9]);   // a restarted Worker is handed the current pointer
      fresh.emit('dev', { id: 'pointer', port: 'down', value: true });
      fresh.beat(); fresh.run(600); assert.equal(fresh.workers.length, 2);
      const after = fresh.workers[1].posted.filter(m => m.type === 'dev').map(m => [m.port, m.value]);
      assert.deepEqual(after, [['pos', [7, 8, 9]], ['down', true]]);
   });

   await check('host: a release (the headset went silent or blurred) lets go of pointer.down, once', async () => {
      const w = await started(), wk = w.workers[0]; wk.posted.length = 0;
      w.emit('release', 'silent'); assert.equal(wk.posted.length, 0, 'nothing was down');
      w.emit('dev', { id: 'pointer', port: 'down', value: true }); wk.posted.length = 0;
      w.emit('release', 'silent');
      assert.deepEqual(wk.posted, [{ type: 'dev', id: 'pointer', port: 'down', value: false }]); assert.equal(w.host.stats.pointer.down, false);
      w.emit('release', 'blur'); assert.equal(wk.posted.length, 1, 'and once');
   });

   await check('host: a layout that could not be read is not an empty one: no Worker, no snapshot, the problem is reported; no file at all starts empty', async () => {
      const bad = hostWorld();
      bad.store.failed = true; bad.store.problem = 'bad layout: Failed to fetch'; bad.store.loadLayout = async () => null;
      await assert.rejects(bad.host.start(), /runtime not started: bad layout: Failed to fetch/);
      assert.equal(bad.workers.length, 0); assert.equal(bad.host.stats.active, false); assert.equal(bad.host.stats.problem, 'bad layout: Failed to fetch');
      assert.match(bad.host.stats.lastError, /runtime not started/); assert.equal(bad.snaps.length, 0);
      bad.host.setActive(true); assert.equal(bad.workers.length, 0, 'it stays idle');
      let calls = 0;
      const fresh = St.createStore({ fetch: async () => { calls++; throw new TypeError('Failed to fetch'); } });
      assert.equal(await fresh.loadLayout(), null); assert.equal(fresh.failed, true); assert.match(fresh.problem, /Failed to fetch/);
      const err500 = St.createStore({ fetch: async () => ({ ok: false, status: 503 }) });
      assert.equal(await err500.loadLayout(), null); assert.equal(err500.failed, true);
      const none = St.createStore({ fetch: async () => ({ ok: false, status: 404 }) });
      assert.equal(await none.loadLayout(), null); assert.equal(none.failed, false); assert.equal(none.problem, 'no layout file');
      const empty = hostWorld(); empty.store.problem = 'no layout file'; empty.store.failed = false; empty.store.loadLayout = async () => null;
      await empty.host.start(); assert.equal(empty.workers.length, 1, 'a missing file starts the host as before');
   });

   await check('host: no restart before the first beat; a Worker that never beats is given 5 s', async () => {
      const w = await started();
      w.run(4900); assert.equal(w.workers.length, 1); assert.equal(w.host.stats.restarts, 0);
      w.run(200); assert.equal(w.workers.length, 2, 'after the grace a Worker that never came up is replaced');
      assert.equal(w.workers[0].terminated, true); assert.equal(w.host.stats.restarts, 1);
      assert.match(w.host.stats.lastRestart.reason, /first beat/);
   });

   await check('host: 500 ms of silence after a beat restarts the Worker with the last snapshot, the layout and hung', async () => {
      const w = await started(), first = w.workers[0];
      w.run(2000, true);
      assert.equal(w.workers.length, 1, 'beating every 100 ms is healthy');
      const snap = { n: 77, t: 1.2, rails: {}, modules: { send: { ver: 1 } }, docks: [], devices: {} }, layout = { cards: { send: { slot: 0 } }, uses: {}, unplugged: [] };
      first.say({ type: 'snapshot', snap, layout });
      w.emit('cmd', COMMIT(11, 'send', 'S2')); first.say({ type: 'ack', cmd: 11, ok: true });
      w.run(400); assert.equal(w.workers.length, 1, 'not yet');
      w.run(100);
      assert.equal(first.terminated, true); assert.equal(w.workers.length, 2); assert.equal(w.host.stats.restarts, 1);
      const init = w.workers[1].posted[0];
      assert.equal(init.type, 'init'); assert.deepEqual(init.snapshot, snap); assert.deepEqual(init.layout, layout);
      assert.deepEqual(init.hung, ['send'], 'the commit in flight');
      assert.equal(init.sources.send, SENDER, 'its last good source, not the one that was committed');
      assert.match(init.notice, /restart/i); assert.match(init.notice, /send/);
      assert.ok(w.timers.filter(t => t.on).length <= 1, 'one watchdog at a time');
   });

   await check('host: with no commit in flight the most recently committed module is the hung one; with none, nobody', async () => {
      const w = await started();
      w.run(200, true);
      w.emit('cmd', COMMIT(1, 'hear', HEAR + '// v2')); w.cur().say({ type: 'ack', cmd: 1, ok: true });
      w.beat(60);   // 60 beats followed the ack: it is saved and it is the last committed
      w.run(500);
      assert.equal(w.workers.length, 2);
      assert.deepEqual(w.workers[1].posted[0].hung, ['hear']);
      assert.equal(w.workers[1].posted[0].sources.hear, HEAR + '// v2', 'the committed source is now the last good one');
      const n = await started(); n.run(200, true); n.run(500);
      assert.deepEqual(n.workers[1].posted[0].hung, []);
   });

   await check('host: a paused Worker that keeps beating is never restarted', async () => {
      const w = await started();
      w.run(100, true);
      w.emit('cmd', cmdOf(2, 'pause')); w.cur().say({ type: 'ack', cmd: 2, ok: true });
      w.run(30000, true, true);
      assert.equal(w.workers.length, 1); assert.equal(w.host.stats.restarts, 0);
   });

   await check('host: a commit followed by silence is never saved', async () => {
      const w = await started();
      w.run(200, true);
      w.emit('cmd', COMMIT(5, 'send', 'while(true){}')); w.cur().say({ type: 'ack', cmd: 5, ok: true });
      w.run(1500);   // the Worker hangs in its next step: no more beats
      assert.equal(w.workers.length, 2);
      assert.deepEqual(w.saves, [], 'nothing was saved');
      w.emit('cmd', COMMIT(6, 'send', 'x')); w.cur().say({ type: 'beat', n: 1, paused: false });   // new Worker: commit, no ack, one beat
      w.run(1500);
      assert.deepEqual(w.saves, []);
      assert.deepEqual(w.workers[2].posted[0].hung, ['send']);
      assert.equal(w.workers[2].posted[0].sources.send, SENDER);
   });

   await check('host: a commit followed by 60 beats after its ack is saved once; a refused commit and a short run are not', async () => {
      const w = await started();
      w.run(200, true);
      w.emit('cmd', COMMIT(5, 'send', 'v2')); w.beat(3);
      assert.deepEqual(w.saves, [], 'no ack yet, so beats do not count');
      w.cur().say({ type: 'ack', cmd: 5, ok: true });
      w.beat(59); assert.deepEqual(w.saves, [], '59 beats are not enough');
      w.beat(1); assert.deepEqual(w.saves, [['send', 'v2']]);
      w.beat(10); assert.equal(w.saves.length, 1, 'once');
      w.emit('cmd', COMMIT(6, 'hear', 'bad')); w.cur().say({ type: 'ack', cmd: 6, ok: false, reason: 'syntax' }); w.beat(5);
      assert.equal(w.saves.length, 1, 'a commit that did not compile is not saved');
      assert.deepEqual(w.acks.slice(-1)[0], [6, false, 'syntax']);
      w.emit('cmd', COMMIT(7, 'hear', 'one')); w.cur().say({ type: 'ack', cmd: 7, ok: true }); w.beat(1);
      w.emit('cmd', COMMIT(8, 'hear', 'two')); w.cur().say({ type: 'ack', cmd: 8, ok: true }); w.beat(60);
      assert.deepEqual(w.saves.slice(1), [['hear', 'one'], ['hear', 'two']], 'in order');
      w.emit('cmd', cmdOf(9, 'addModule', { module: 'extra', source: 'src' })); w.cur().say({ type: 'ack', cmd: 9, ok: true }); w.beat(60);
      assert.deepEqual(w.saves.slice(-1)[0], ['extra', 'src'], 'a module added with a source is saved like a commit');
      w.emit('cmd', cmdOf(10, 'addModule', { module: 'bare' })); w.cur().say({ type: 'ack', cmd: 10, ok: true }); w.beat(3);
      assert.equal(w.saves.length, 4, 'without a source there is nothing to save');
   });

   await check('host: rename moves the last good source and saves it under the new name; remove forgets it', async () => {
      const w = await started();
      w.run(200, true);
      w.emit('cmd', cmdOf(3, 'renameModule', { module: 'send', to: 'sender' })); w.cur().say({ type: 'ack', cmd: 3, ok: true });
      assert.deepEqual(w.saves, [['sender', SENDER]]);
      w.emit('cmd', cmdOf(4, 'rmModule', { module: 'hear' })); w.cur().say({ type: 'ack', cmd: 4, ok: true });
      w.cur().say({ type: 'snapshot', snap: { n: 1, rails: {}, modules: {}, docks: [] }, layout: { cards: { sender: { slot: 0 }, hear: { slot: 1 } }, uses: {}, unplugged: [] } });
      w.run(600);
      assert.deepEqual(w.workers[1].posted[0].sources, { sender: SENDER });
   });

   await check('host: four hangs in 10 s stop the loop: the fourth restarts once with every module quarantined, a fifth stops', async () => {
      const w = await started();
      for (let i = 0; i < 3; i++) { w.run(200, true); w.run(500); assert.equal(w.workers.length, i + 2, `restart ${i + 1}`); }
      assert.deepEqual(w.workers.map(x => x.posted[0].hung.length), [0, 0, 0, 0], 'nothing was committed, so nobody is blamed');
      w.run(200, true); w.run(500);
      assert.equal(w.workers.length, 5, 'the last restart');
      assert.deepEqual(w.workers[4].posted[0].hung.sort(), ['hear', 'send'], 'every module');
      assert.match(w.workers[4].posted[0].notice, /quarantin/);
      w.run(200, true); w.run(2000);
      assert.equal(w.workers.length, 5, 'no sixth Worker'); assert.equal(w.live().length, 0); assert.equal(w.host.stats.stopped, true);
      assert.equal(w.timers.filter(t => t.on).length, 0, 'the watchdog is off too');
      w.run(5000); assert.equal(w.workers.length, 5);
   });

   await check('host: hangs more than 10 s apart do not add up; after a stop, setActive(true) starts afresh', async () => {
      const w = await started();
      for (let i = 0; i < 8; i++) { w.run(200, true); w.run(500); w.run(10000, true); }
      assert.equal(w.host.stats.restarts, 8); assert.equal(w.workers.length, 9);
      assert.ok(w.workers.every(x => x.posted[0].hung.length === 0), 'never the all-quarantined restart');
      const x = await started();
      for (let i = 0; i < 5; i++) { x.run(200, true); x.run(700); }
      assert.equal(x.host.stats.stopped, true);
      x.host.setActive(false); x.host.setActive(true);
      assert.equal(x.host.stats.stopped, false); assert.equal(x.live().length, 1);
      x.run(200, true); x.run(700); assert.equal(x.workers.length, 7, 'restarts work again');
   });

   await check('host: the restart and its reason reach the IDE in the next snap of the new Worker', async () => {
      const link = world(), [laptop, headset] = pair(link, 1, 2, { 1: { rank: 1 }, 2: { rank: 2 } });
      const real = [];
      const make = () => {   // a Worker whose messages go straight to a real core, and back
         const k = core();
         const wk = { terminated: false, postMessage: m => { if (!wk.terminated) k.send(JSON.parse(JSON.stringify(m))); }, terminate() { wk.terminated = true; }, onmessage: null, k };
         real.push(wk);
         const push = k.posted.push.bind(k.posted); k.posted.push = m => { push(m); if (!wk.terminated && wk.onmessage) wk.onmessage({ data: m }); return k.posted.length; };
         return wk;
      };
      const files = { layout: LAYOUT, send: SENDER, hear: HEAR }; const timers = [];
      const store = { problem: null, loadLayout: async () => files.layout, loadModule: async n => files[n] || null, saveModule: async () => ({ ok: true }), saveLayout: async () => ({ ok: true }) };
      const host = Hs.createRuntimeHost({ link: laptop, store, now: link.now, makeWorker: make, setInterval: (fn) => { const t = { fn, on: true }; timers.push(t); return t; }, clearInterval: t => { t.on = false; } });
      const snaps = []; headset.on('snap', m => snaps.push(m.snap));
      await host.start();
      const drive = (n, beat = true) => { for (let i = 0; i < n; i++) { link.t += STEP; if (beat) real[real.length - 1].k.tick(1); for (const t of timers) if (t.on) t.fn(); laptop.tick(); headset.tick(); link.pump(); } };
      drive(120);
      assert.ok(snaps.length > 30, `snaps flow to the headset: ${snaps.length}`);
      assert.ok(snaps.some(s => s.modules && s.modules.send && s.modules.send.source), 'the first snap carries sources (full on pair)');
      drive(60, false);   // the Worker hangs: no ticks
      assert.equal(real.length, 2);
      snaps.length = 0; drive(10);
      const notices = snaps.flatMap(s => s.notices || []).map(n => n.text);
      assert.ok(notices.some(t => /restart/i.test(t)), notices.join('|'));
   });

   await check('host: layout saves 1 s after a structure change, once, from the newest snapshot; the first snapshot is the baseline', async () => {
      const w = await started();
      w.run(200, true);
      const L1 = { cards: { send: { slot: 0 } }, uses: {}, unplugged: [] }, L2 = { cards: { send: { slot: 0 }, hear: { slot: 1 } }, uses: {}, unplugged: [] }, L3 = { ...L2, uses: { 'hear.p': 'out' } };
      const shot = l => w.cur().say({ type: 'snapshot', snap: { n: 1, rails: {}, modules: {}, docks: [] }, layout: l });
      shot(L1); w.run(3000, true); assert.deepEqual(w.layouts, [], 'the first snapshot is the baseline: nothing to save');
      shot(L1); w.run(2000, true); assert.deepEqual(w.layouts, [], 'unchanged');
      shot(L2); w.run(900, true); assert.equal(w.layouts.length, 0, 'not yet');
      shot(L3); w.run(900, true); assert.equal(w.layouts.length, 0, 'a newer change restarts the wait');
      w.run(200, true); assert.deepEqual(w.layouts, [L3], 'one write, the newest layout');
      w.run(5000, true); shot(L3); w.run(3000, true); assert.equal(w.layouts.length, 1, 'no repeat');
   });

   await check('host: a structure command acked before the first snapshot counts as a change', async () => {
      const w = await started();
      w.run(200, true);
      w.emit('cmd', cmdOf(1, 'plug', { module: 'send', on: false })); w.cur().say({ type: 'ack', cmd: 1, ok: true });
      w.cur().say({ type: 'snapshot', snap: { n: 1, rails: {}, modules: {}, docks: [] }, layout: LAYOUT });
      w.run(1100, true); assert.equal(w.layouts.length, 1);
   });

   await check('host: setActive(false) stops relaying and saving and terminates the Worker; setActive(true) starts another', async () => {
      const w = await started(), first = w.workers[0];
      w.run(200, true);
      w.emit('cmd', COMMIT(1, 'send', 'v2')); first.say({ type: 'ack', cmd: 1, ok: true });
      w.cur().say({ type: 'snapshot', snap: { n: 1, rails: {}, modules: {}, docks: [] }, layout: LAYOUT });
      w.host.setActive(false);
      assert.equal(first.terminated, true); assert.equal(w.timers.filter(t => t.on).length, 0);
      const posted = first.posted.length;
      w.emit('cmd', cmdOf(2, 'pause')); w.emit('dev', { id: 'gaze', port: 'on', value: true }); w.emit('pair', {}); w.host.feedPointer([1, 1, 1]);
      first.say({ type: 'beat', n: 1, paused: false }); first.say({ type: 'beat', n: 2, paused: false }); first.say({ type: 'snap', snap: { rev: 1 } });
      w.run(3000);
      assert.equal(first.posted.length, posted, 'nothing relayed');
      assert.deepEqual(w.saves, [], 'the pending commit is not saved'); assert.deepEqual(w.layouts, []); assert.equal(w.snaps.length, 0);
      assert.equal(w.workers.length, 1, 'no restart while inactive');
      w.host.setActive(true);
      assert.equal(w.workers.length, 2); assert.equal(w.workers[1].posted[0].type, 'init'); assert.equal(w.workers[1].posted[0].snapshot, null);
      w.host.setActive(true); assert.equal(w.workers.length, 2, 'already active');
      w.emit('cmd', cmdOf(3, 'pause')); assert.equal(w.workers[1].posted.slice(-1)[0].cmd.op, 'pause');
      const off = hostWorld(); off.host.setActive(false); await off.host.start();
      assert.equal(off.workers.length, 0, 'inactive before start: it loads but does not run');
      off.host.setActive(true); assert.equal(off.workers.length, 1);
   });

   await check('host: messages of a terminated Worker are ignored; a stalled page is not blamed on the Worker', async () => {
      const w = await started(), first = w.workers[0];
      w.run(200, true); w.run(500);
      assert.equal(first.terminated, true);
      const acks = w.acks.length; first.say({ type: 'ack', cmd: 1, ok: true }); first.say({ type: 'snap', snap: { rev: 1 } });
      assert.equal(w.acks.length, acks); assert.equal(w.snaps.length, 0);
      w.cur().say({ type: 'beat', n: 1, paused: false });
      w.t += 3000; w.tickHost();   // the page itself froze for 3 s: the beats are waiting in its queue
      assert.equal(w.workers.length, 2, 'no restart on a check that came 3 s late');
      w.run(300); assert.equal(w.workers.length, 2); w.run(300); assert.equal(w.workers.length, 3, 'real silence still restarts');
   });

   await check('host: Worker errors are counted; the real Worker core runs under the host: commit, ack, saves and a restore after a hang', async () => {
      const w = await started(); w.workers[0].onerror({ message: 'boom' });
      assert.equal(w.host.stats.workerErrors, 1); assert.equal(w.workers.length, 1);
      const link = world(), [laptop, headset] = pair(link, 1, 2, { 1: { rank: 1 }, 2: { rank: 2 } });
      const cores = [], saves = [], timers = [];
      const make = () => {
         const k = core(), wk = { terminated: false, k, onmessage: null, onerror: null,
            postMessage: m => { if (!wk.terminated) k.send(JSON.parse(JSON.stringify(m))); }, terminate() { wk.terminated = true; } };
         const push = k.posted.push.bind(k.posted); k.posted.push = m => { push(m); if (!wk.terminated && wk.onmessage) wk.onmessage({ data: m }); return 1; };
         cores.push(wk); return wk;
      };
      const files = { layout: LAYOUT, send: SENDER, hear: HEAR };
      const store = { problem: null, loadLayout: async () => files.layout, loadModule: async n => files[n] || null,
                      saveModule: async (n, s) => { saves.push([n, s]); return { ok: true }; }, saveLayout: async () => ({ ok: true }) };
      const host = Hs.createRuntimeHost({ link: laptop, store, now: link.now, makeWorker: make, setInterval: fn => { const t = { fn, on: true }; timers.push(t); return t; }, clearInterval: t => { t.on = false; } });
      const acks = [], snaps = []; headset.on('ack', m => acks.push([m.cmd, m.ok, m.reason])); headset.on('snap', m => snaps.push(m.snap));
      await host.start();
      let hang = false;
      const drive = n => { for (let i = 0; i < n; i++) { link.t += STEP; if (!hang) cores[cores.length - 1].k.tick(1); for (const t of timers) if (t.on) t.fn(); laptop.tick(); headset.tick(); link.pump(); } };
      drive(130);
      headset.sendCmd({ id: 1, op: 'commit', module: 'send', source: SENDER + '// v2' });
      headset.sendCmd({ id: 2, op: 'commit', module: 'hear', source: 'syntax error here (' });
      drive(8);
      assert.deepEqual(acks.map(a => [a[0], a[1]]), [[1, true], [2, false]], JSON.stringify(acks));
      assert.deepEqual(saves, [], 'not yet: a commit needs 60 beats after its ack');
      drive(70);
      assert.deepEqual(saves, [['send', SENDER + '// v2']], 'only the commit that compiled, after 60 beats');   // a snapshot of the running world is taken
      const before = cores[0].k.c.runtime.bus.modules.get('send').state.n;
      assert.ok(before > 100);
      headset.sendCmd({ id: 3, op: 'commit', module: 'send', source: SENDER + '// v3' });
      drive(1); hang = true;   // the Worker takes the commit and then never beats again
      drive(40);
      assert.equal(cores.length, 2, 'restarted'); assert.equal(cores[0].terminated, true);
      const rt = cores[1].k.c.runtime;
      assert.equal(rt.bus.modules.get('send').status, 'quarantined', 'the module of the commit in flight');
      assert.equal(rt.bus.modules.get('send').source, SENDER + '// v2', 'running its last good source');
      assert.ok(rt.bus.modules.get('send').state.n >= before - 70 && rt.bus.modules.get('send').state.n <= before + 5, 'its state came from the snapshot');
      assert.equal(rt.bus.modules.get('hear').status, 'ok');
      assert.ok(rt.bus.n > 100, 'the clock carried on from the snapshot');
      assert.equal(saves.length, 1, 'the hanging commit was never saved');
      hang = false; drive(5);
      assert.equal(host.stats.restarts, 1);
   });


   // ---- failure acks, revert, stop, a Worker that cannot start, a real thread --------------------------------
   await check('host: a restart nacks every command that had no ack, once; the acked ones are left alone', async () => {
      const w = await started();
      w.run(200, true);
      w.emit('cmd', cmdOf(1, 'plug', { module: 'send', on: false })); w.cur().say({ type: 'ack', cmd: 1, ok: true });
      w.emit('cmd', COMMIT(2, 'send', 'while(true){}')); w.emit('cmd', cmdOf(3, 'pause'));
      w.acks.length = 0;
      w.run(600);
      assert.equal(w.workers.length, 2);
      assert.deepEqual(w.acks.map(a => [a[0], a[1]]), [[2, false], [3, false]]);
      assert.match(w.acks[0][2], /^worker restarted: no beat for \d+ ms$/);
      w.run(5000, true); assert.equal(w.acks.length, 2, 'not again');
      assert.match(w.host.stats.lastError, /restart: no beat/, 'lastError carries the restart reason');
   });

   await check('host: after the storm stop the IDE gets a notice in a last snap, every later command is nacked with the reason, pair resends it', async () => {
      const w = await started();
      w.cur().say({ type: 'snap', snap: { rev: 1, t: 2, notices: [{ id: 4, n: 3, text: 'old' }] } });
      w.run(200, true);
      for (let i = 0; i < 4; i++) { w.run(200, true); w.run(700); }
      w.emit('cmd', cmdOf(9, 'pause'));   // in flight when it gives up
      w.run(5000);
      assert.equal(w.host.stats.stopped, true);
      const last = w.snaps[w.snaps.length - 1];
      assert.ok(W.valid(asMessage(last)), 'a snap the wire accepts');
      assert.deepEqual(last.notices.map(n => n.text), ['old', Hs.STOPPED]); assert.equal(last.notices[1].id, 5);
      assert.match(Hs.STOPPED, /runtime stopped after repeated hangs/); assert.match(Hs.STOPPED, /reload the laptop page/);
      assert.deepEqual(w.acks.slice(-1)[0].slice(0, 2), [9, false]); assert.match(w.acks.slice(-1)[0][2], /^worker restarted: /);
      w.acks.length = 0;
      w.emit('cmd', cmdOf(10, 'commit', { module: 'send', source: 'x' })); w.emit('cmd', cmdOf(11, 'pause'));
      assert.deepEqual(w.acks, [[10, false, Hs.STOPPED], [11, false, Hs.STOPPED]]);
      assert.equal(w.workers.length, 5, 'nothing was started');
      w.snaps.length = 0; w.emit('pair', {}); assert.equal(w.snaps.length, 1); assert.deepEqual(w.snaps[0], last);
      assert.deepEqual(w.host.lastSnap(), last);
      w.host.setActive(false); w.acks.length = 0; w.emit('cmd', cmdOf(12, 'pause')); assert.equal(w.acks.length, 0, 'silent when not the runtime');
      w.host.setActive(true); w.acks.length = 0; w.emit('cmd', cmdOf(13, 'pause')); assert.equal(w.acks.length, 0, 'running again');
      assert.equal(w.workers.slice(-1)[0].posted.slice(-1)[0].cmd.id, 13);
   });

   await check('host: lastSnap is the last snap of the Worker (null before any); it is read-only data for the log', async () => {
      const w = await started(); assert.equal(w.host.lastSnap(), null);
      w.cur().say({ type: 'snap', snap: { rev: 1 } }); w.cur().say({ type: 'snap', snap: { rev: 2 } });
      assert.deepEqual(w.host.lastSnap(), { rev: 2 });
      w.link.mutual = false; w.cur().say({ type: 'snap', snap: { rev: 3 } }); assert.deepEqual(w.host.lastSnap(), { rev: 3 });
   });

   await check('host: a makeWorker that throws is counted, noticed to the IDE, nacks commands, and setActive(true) tries again', async () => {
      const w = hostWorld(); let broken = true; const good = w.makeWorker;
      w.host = Hs.createRuntimeHost({ link: w.link, store: w.store, now: () => w.t, setInterval: (fn, ms) => { const t = { fn, ms, on: true }; w.timers.push(t); return t; },
         clearInterval: t => { t.on = false; }, makeWorker: () => { if (broken) throw new Error('no Worker here'); return good(); } });
      await w.host.start();
      assert.equal(w.host.stats.workerErrors, 1); assert.match(w.host.stats.lastError, /no Worker here/);
      assert.equal(w.host.stats.stopped, true); assert.equal(w.workers.length, 0);
      const last = w.snaps[w.snaps.length - 1];
      assert.match(last.notices[0].text, /could not start/); assert.match(last.notices[0].text, /no Worker here/); assert.ok(W.valid(asMessage(last)));
      w.emit('cmd', cmdOf(1, 'pause')); assert.deepEqual(w.acks[0].slice(0, 2), [1, false]); assert.match(w.acks[0][2], /could not start/);
      assert.equal(w.timers.filter(t => t.on).length, 0);
      broken = false; w.host.setActive(false); w.host.setActive(true);
      assert.equal(w.workers.length, 1); assert.equal(w.host.stats.stopped, false);
      w.emit('cmd', cmdOf(2, 'pause')); assert.equal(w.workers[0].posted.slice(-1)[0].cmd.id, 2);
      // a restart whose new Worker cannot start
      broken = false; w.run(200, true);
      const w2 = await started(); w2.run(200, true);
      const make2 = w2.makeWorker; let n = 0;
      const h = Hs.createRuntimeHost({ link: w2.link, store: w2.store, now: () => w2.t, setInterval: (fn, ms) => { const t = { fn, ms, on: true }; w2.timers.push(t); return t; }, clearInterval: t => { t.on = false; },
                                       makeWorker: () => { if (n++ === 1) throw new Error('out of memory'); return make2(); } });
      await h.start(); w2.workers.slice(-1)[0].say({ type: 'beat', n: 1 });
      for (let i = 0; i < 8; i++) { w2.t += 100; w2.tickHost(); }
      assert.equal(h.stats.stopped, true); assert.equal(h.stats.workerErrors, 1); assert.match(h.stats.lastError, /out of memory/);
   });

   await check('worker: a revert that succeeded carries the source it returns to in its ack; others do not', () => {
      const w = core(); w.send(INIT); w.tick(3);
      const V2 = SENDER + '// v2\n';
      w.send({ type: 'cmd', cmd: { id: 1, op: 'commit', module: 'send', source: V2 } }); w.tick(2); w.clear();
      w.send({ type: 'cmd', cmd: { id: 2, op: 'revert', module: 'send' } });
      assert.deepEqual(w.of('ack')[0], { type: 'ack', cmd: 2, ok: true, source: SENDER });
      w.tick(2); assert.equal(w.c.runtime.bus.modules.get('send').source, SENDER);
      w.send({ type: 'cmd', cmd: { id: 3, op: 'revert', module: 'send' } });   // nothing earlier now
      assert.equal(w.of('ack')[1].ok, false); assert.ok(!('source' in w.of('ack')[1]));
      w.send({ type: 'cmd', cmd: { id: 4, op: 'revert', module: 'nope' } }); assert.ok(!('source' in w.of('ack')[2]));
      w.send({ type: 'cmd', cmd: { id: 5, op: 'commit', module: 'send', source: V2 } }); assert.ok(!('source' in w.of('ack')[3]));
   });

   await check('host: a revert is saved and becomes lastGood like a commit, after 60 beats; the source is not passed to the link; a restart before that discards it', async () => {
      const w = await started();
      w.run(200, true);
      w.emit('cmd', cmdOf(1, 'revert', { module: 'send' })); w.cur().say({ type: 'ack', cmd: 1, ok: true, source: 'OLD' });
      assert.deepEqual(w.acks, [[1, true, undefined]], 'only cmd, ok, reason go to the link');
      w.beat(59); assert.deepEqual(w.saves, []);
      w.beat(1); assert.deepEqual(w.saves, [['send', 'OLD']]);
      w.run(200, true); w.run(500);
      assert.equal(w.workers[1].posted[0].sources.send, 'OLD', 'a restart runs the reverted source');
      assert.deepEqual(w.workers[1].posted[0].hung, ['send'], 'and it is the last committed');
      w.beat(1);
      w.emit('cmd', cmdOf(2, 'revert', { module: 'hear' })); w.cur().say({ type: 'ack', cmd: 2, ok: true, source: 'OLDER' });
      w.beat(30); w.run(500);
      assert.equal(w.workers.length, 3); assert.equal(w.saves.length, 1, 'restarted before 60 beats: not saved');
      assert.equal(w.workers[2].posted[0].sources.hear, HEAR, 'lastGood unchanged');
      assert.deepEqual(w.workers[2].posted[0].hung, ['hear']);
      w.beat(1); w.emit('cmd', cmdOf(3, 'revert', { module: 'hear' })); w.cur().say({ type: 'ack', cmd: 3, ok: false, reason: 'no earlier version' }); w.beat(80);
      assert.equal(w.saves.length, 1, 'a refused revert saves nothing');
      w.emit('cmd', cmdOf(4, 'revert', { module: 'hear' })); w.cur().say({ type: 'ack', cmd: 4, ok: true }); w.beat(80);
      assert.equal(w.saves.length, 1, 'an ack without source saves nothing');
   });

   await check('host: a restart is given all of lastGood, not only the modules of a possibly old layout', async () => {
      const w = await started();
      w.run(200, true);
      w.cur().say({ type: 'snapshot', snap: { n: 1, rails: {}, modules: {}, docks: [] }, layout: { cards: { send: { slot: 0 } }, uses: {}, unplugged: [] } });
      w.emit('cmd', cmdOf(1, 'renameModule', { module: 'hear', to: 'listener' })); w.cur().say({ type: 'ack', cmd: 1, ok: true });
      w.run(600);
      assert.deepEqual(w.workers[1].posted[0].sources, { send: SENDER, listener: HEAR });
   });

   await check('restart: notice ids and snap revs go on across a Worker restart and a stop', async () => {
      const rt = new Rt.Runtime({ seed: 1, bases: { notice: 40, rev: 100 } });
      rt.addNotice('first'); assert.equal(rt.notices[0].id, 41); assert.ok(rt.snapshot().rev > 100);
      const plain = new Rt.Runtime(); plain.addNotice('x'); assert.equal(plain.notices[0].id, 1, 'no bases: as before');
      plain.bus.setNoticeBase(0); plain.bus.setNoticeBase(-5); plain.bus.setNoticeBase('7'); plain.addNotice('y'); assert.equal(plain.notices[1].id, 2, 'junk and lower bases are ignored');
      const w = core(); w.send({ ...INIT, notice: 'worker restarted (x)', noticeBase: 30, revBase: 500 }); w.tick(2);
      const snap = w.of('snap')[0].snap;
      assert.ok(snap.rev > 500); assert.ok(snap.notices.every(n => n.id > 30), JSON.stringify(snap.notices));
      assert.equal(snap.notices.find(n => /restarted/.test(n.text)).id > 30, true);
      // the host: bases are the maxima relayed, and the stop notice and its rev are above them
      const h = await started();
      h.cur().say({ type: 'snap', snap: { rev: 500, notices: [{ id: 30, n: 1, text: 'a' }, { id: 12, n: 1, text: 'b' }] } });
      h.cur().say({ type: 'snap', snap: { rev: 450, notices: [] } });
      h.run(200, true); h.run(500);
      const init = h.workers[1].posted[0]; assert.equal(init.noticeBase, 30); assert.equal(init.revBase, 500);
      assert.equal(h.workers[0].posted[0].noticeBase, 0); assert.equal(h.workers[0].posted[0].revBase, 0);
      h.workers[1].say({ type: 'snap', snap: { rev: 520, notices: [{ id: 31, n: 1, text: 'restarted' }] } });
      for (let i = 0; i < 4; i++) { h.run(200, true); h.run(700); }
      assert.equal(h.host.stats.stopped, true);
      const stop = h.snaps[h.snaps.length - 1];
      assert.equal(stop.rev, 521); assert.equal(stop.notices[stop.notices.length - 1].id, 32); assert.equal(stop.notices[stop.notices.length - 1].text, Hs.STOPPED);
      assert.ok(W.valid(asMessage(stop)));
      assert.equal(h.workers[h.workers.length - 1].posted[0].revBase >= 520, true);
   });

   await check('host: the watchdog is 500 ms for every command, a seek or a resume here included (a replay is at most one segment of steps)', async () => {
      for (const [op, extra] of [['seek', { t: 0.5 }], ['resumeHere', {}], ['pause', {}], ['play', {}]]) {
         const w = await started();
         w.run(200, true);
         w.emit('cmd', cmdOf(20, op, extra));       // no ack, no more beats: the Worker is inside it
         w.run(400); assert.equal(w.workers.length, 1, `${op}: 400 ms of silence is not a hang yet`);
         w.run(200); assert.equal(w.workers.length, 2, `${op}: 600 ms is`);
         assert.match(w.workers[1].posted[0].notice, /no beat/); assert.doesNotMatch(w.workers[1].posted[0].notice, /ghost/);
         assert.deepEqual(w.acks.filter(a => a[0] === 20).map(a => [a[1], /no beat/.test(a[2])]), [[false, true]], 'the command is nacked');
         assert.equal(w.host.stats.lastRestart.ghost, undefined);
      }
   });

   await check('host: a slow command that is answered is not met by a watchdog that still counts from before it (any message from the Worker is a sign of life)', async () => {
      for (const ms of [300, 450]) {
         const w = await started();
         w.run(200, true);
         w.emit('cmd', COMMIT(1, 'send', 'v2')); w.cur().say({ type: 'ack', cmd: 1, ok: true }); w.beat(60); w.run(100, true);
         w.emit('cmd', cmdOf(2, 'seek', { t: 0.5 }));
         w.run(ms - (ms % 100)); w.t += ms % 100;
         w.cur().say({ type: 'ack', cmd: 2, ok: true });         // answered; the next beat is a few ms behind it
         w.tickHost();                                            // and the watchdog's timer fires in between
         assert.equal(w.workers.length, 1, `a ${ms} ms seek, answered: no restart`); assert.equal(w.host.stats.restarts, 0);
         w.run(300, true); assert.equal(w.workers.length, 1);
         // a snap is a sign of life as well
         w.emit('cmd', cmdOf(3, 'seek', { t: 1 })); w.run(300); w.cur().say({ type: 'snap', snap: { rev: 1 } }); w.tickHost(); w.run(200);
         assert.equal(w.workers.length, 1, 'a message in the last 500 ms keeps it alive');
         w.run(600); assert.equal(w.workers.length, 2, 'then silence is a hang again');
      }
   });

   await check('worker: seek and resumeHere through the Worker core: the snaps show the past, and what runs after is the program of now (no source goes to the host)', () => {
      const w = core(); w.send({ ...INIT, layout: { cards: { send: { slot: 0 } }, uses: {}, unplugged: [] }, sources: { send: PHASE } });
      w.tick(100);                                                                  // 1.6 s live
      w.send({ type: 'cmd', cmd: { id: 1, op: 'commit', module: 'send', source: PHASE + '// v2\n' } }); w.tick(30);
      w.send({ type: 'cmd', cmd: { id: 2, op: 'pause' } }); w.send({ type: 'cmd', cmd: { id: 3, op: 'seek', t: 0.5 } });
      w.tick(2);
      const past = w.of('snap').pop().snap;
      assert.equal(past.paused, true); assert.deepEqual(past.modules.send.draw[0].p, [10, 0, 0.1429]);
      assert.deepEqual(w.of('ack').map(a => [a.cmd, a.ok, a.source]), [[1, true, undefined], [2, true, undefined], [3, true, undefined]]);
      w.clear(); w.send({ type: 'cmd', cmd: { id: 4, op: 'resumeHere' } });
      assert.deepEqual(w.of('ack'), [{ type: 'ack', cmd: 4, ok: true }], 'nothing for the host to save');
      w.tick(2); const now = w.of('snap').pop().snap; assert.equal(now.paused, false); assert.deepEqual(now.window[0], 0.5);
      assert.equal(w.c.runtime.bus.modules.get('send').source, PHASE + '// v2\n'); assert.equal(w.c.runtime.bus.modules.get('send').ver, 2);
   });

   // A real thread: the real worker core under node:worker_threads, with a module whose handler never returns.
   await check('host: a real Worker thread with a for(;;){} handler: restart within 1 s, quarantined, never saved, the open command nacked, the others beat, a fixed version is saved after 60 beats', async () => {
      const fs = require('node:fs'), path = require('node:path'), { Worker } = require('node:worker_threads');
      const cache = {};
      const urlOf = file => cache[file] || (cache[file] = 'data:text/javascript;base64,' + Buffer.from(fs.readFileSync(file, 'utf8').replace(/from '(\.[^']+)'/g,
         (m, rel) => `from '${urlOf(path.resolve(path.dirname(file), rel))}'`)).toString('base64'));
      const code = `const { parentPort } = require('node:worker_threads');
         import(${JSON.stringify(urlOf(path.join(__dirname, '..', 'js/scenes/rails/worker.js')))}).then(W => {
            const core = W.workerCore({ post: m => parentPort.postMessage(m), setInterval, clearInterval, now: () => performance.now() });
            parentPort.on('message', data => core.onmessage({ data }));
         });`;
      const threads = [];
      const makeWorker = () => {
         const t = new Worker(code, { eval: true }), a = { postMessage: m => t.postMessage(m), terminate: () => t.terminate(), onmessage: null, onerror: null };
         t.on('message', data => { if (a.onmessage) a.onmessage({ data }); }); t.on('error', e => { if (a.onerror) a.onerror(e); });
         threads.push(t); return a;
      };
      const LOOP = "const time = input('time', 'state', 'time');\nconst S = state({ n: 0 });\ntime.on(() => { for (;;) {} });\n";
      const handlers = {}, saves = [], snaps = [], acks = [];
      const link = { mutual: true, on(t, f) { (handlers[t] ||= []).push(f); return this; }, sendSnap: s => { snaps.push(s); return true; }, sendAck: (c, o, r) => { acks.push([c, o, r]); return true; } };
      const store = { problem: null, loadLayout: async () => LAYOUT, loadModule: async n => ({ send: SENDER, hear: HEAR })[n] ?? null,
                      saveModule: async (n, s) => { saves.push([n, s]); return { ok: true }; }, saveLayout: async () => ({ ok: true }) };
      const host = Hs.createRuntimeHost({ link, store, now: () => performance.now(), makeWorker });
      const emit = (t, m) => (handlers[t] || []).forEach(f => f(m));
      const wait = ms => new Promise(r => setTimeout(r, ms));
      const until = async (fn, ms, what) => { const t0 = performance.now(); while (!fn()) { if (performance.now() - t0 > ms) throw new Error(`timeout: ${what}`); await wait(5); } return performance.now() - t0; };
      const status = id => { for (let i = snaps.length - 1; i >= 0; i--) if (snaps[i].modules && snaps[i].modules[id]) return snaps[i].modules[id]; return null; };
      let timer;
      const hard = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('hard timeout of the real-thread test')), 9000); });
      const body = (async () => {
         await host.start();
         await until(() => host.stats.beats > 10 && status('send') && status('hear'), 3000, 'the Worker beats');
         emit('cmd', { cmd: { id: 1, op: 'commit', module: 'send', source: LOOP } });
         await until(() => acks.some(a => a[0] === 1), 1000, 'the commit is acked (its setup returns)');
         await wait(100);   // the next tick has started the loop
         emit('cmd', { cmd: { id: 2, op: 'plug', module: 'hear', on: false } });   // arrives while the handler loops
         const took = await until(() => host.stats.restarts === 1, 2000, 'a restart');
         assert.ok(took < 1500, `restart after ${took | 0} ms`);
         assert.deepEqual(host.stats.lastRestart.hung, ['send']);
         assert.deepEqual(acks.filter(a => a[0] === 2).map(a => [a[1], /^worker restarted: no beat/.test(a[2])]), [[false, true]], 'the open command is nacked');
         const beats = host.stats.beats;
         await until(() => host.stats.beats > beats + 20 && status('send') && status('send').status === 'quarantined', 3000, 'the new Worker beats with send quarantined');
         assert.equal(status('send').error.message, 'hung (infinite loop?)');
         assert.equal(status('send').source, SENDER, 'it runs its last good source');
         assert.equal(status('hear').status, 'ok');
         assert.deepEqual(saves, [], 'the looping source was never saved');
         emit('cmd', { cmd: { id: 3, op: 'commit', module: 'send', source: SENDER + '// fixed\n' } });
         await until(() => acks.some(a => a[0] === 3 && a[1]), 1000, 'the fixed commit is acked');
         await wait(300); assert.deepEqual(saves, [], 'not yet: 60 beats are about a second');
         await until(() => saves.length === 1, 2500, 'the fixed source is saved');
         assert.deepEqual(saves, [['send', SENDER + '// fixed\n']]);
         assert.equal(host.stats.restarts, 1); assert.equal(host.stats.stopped, false);
         // numbering goes on across the restart: what the IDE has seen is never reused
         const k = snaps.findIndex(x => (x.notices || []).some(n => /restarted/.test(n.text)));
         assert.ok(k > 0, 'a snap carries the restart notice');
         const before = snaps.slice(0, k), after = snaps.slice(k);
         const maxId = Math.max(...before.flatMap(x => (x.notices || []).map(n => n.id)), 0), maxRev = Math.max(...before.map(x => x.rev));
         const restartNotice = after[0].notices.find(n => /restarted/.test(n.text));
         assert.ok(restartNotice.id > maxId, `restart notice id ${restartNotice.id} > ${maxId}`);
         assert.ok(after.every(x => x.rev > maxRev), `every snap rev after the restart is above ${maxRev}`);
      })();
      try { await Promise.race([body, hard]); }
      finally { clearTimeout(timer); host.setActive(false); for (const t of threads) t.terminate(); }
   });

   // ---- the laptop terminal, the loopback, the scene shell ----------------------------------------------------
   const Tm = await load('js/scenes/rails/terminal.js');
   const Lb = await load('js/scenes/rails/loopback.js');

   // A window with listeners that honour stopImmediatePropagation, and events that record what was done to them.
   const fakeWin = () => {
      const l = {};
      return { innerWidth: 1000, innerHeight: 500, listeners: l,
         addEventListener(type, fn, opts) { (l[type] ||= []).push({ fn, opts }); },
         removeEventListener(type, fn) { l[type] = (l[type] || []).filter(x => x.fn !== fn); },
         dispatch(type, e) { for (const { fn } of [...(l[type] || [])]) { fn(e); if (e.stopped) break; } return e; },
         count() { return Object.values(l).reduce((n, a) => n + a.length, 0); } };
   };
   const evt = o => ({ prevented: false, stopped: false, preventDefault() { this.prevented = true; }, stopImmediatePropagation() { this.stopped = true; }, ...o });
   const kev = (key, extra = {}) => evt({ key, code: extra.code ?? 'Key' + key.toUpperCase(), ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, repeat: false, target: { tagName: 'BODY' }, ...extra });
   const termWorld = (opts = {}) => {
      const w = { win: fakeWin(), sent: [], points: [], on: true, refuse: false, t: 1000 };      // t: the terminal's clock, in ms
      w.term = Tm.createTerminal({ win: w.win, doc: opts.doc, mac: !!opts.mac, active: () => w.on, now: () => w.t,
         sendIn: ev => { w.sent.push(ev); return !w.refuse; }, onPointer: p => w.points.push(p) });
      w.key = (type, e) => w.win.dispatch(type, e);
      return w;
   };
   const wireOk = ev => W.valid({ type: 'in', from: 1, epoch: 'e', seq: 0, t: 0, ev });

   await check('terminal: a forwarded key is an in/key event that the wire accepts, prevented and stopped; its keyup too', () => {
      const w = termWorld();
      const down = w.key('keydown', kev('a')), up = w.key('keyup', kev('a'));
      assert.deepEqual(w.sent[0], { k: 'key', d: 'down', key: 'a', code: 'KeyA', mods: { c: false, a: false, s: false, m: false }, rep: false });
      assert.equal(w.sent[1].d, 'up');
      assert.ok(down.prevented && down.stopped && up.prevented && up.stopped);
      const e = w.key('keydown', kev('Enter', { code: 'Enter', ctrlKey: true, shiftKey: true, repeat: true }));
      assert.deepEqual(w.sent[2].mods, { c: true, a: false, s: true, m: false }); assert.equal(w.sent[2].rep, true);
      assert.ok(w.sent.every(wireOk) && e.prevented);
      const odd = w.key('keydown', kev('LaunchApplication1', { code: 'LaunchApp1' }));   // 18 characters: the wire would refuse it
      assert.equal(w.sent.length, 3); assert.ok(!odd.prevented && !odd.stopped, 'a key the wire cannot carry is left to the page');
   });

   await check('terminal: keys that the browser or OS keeps are never taken; nor is typing in a form field; Mac: Cmd is Mod', () => {
      const w = termWorld();
      const kept = [kev('w', { ctrlKey: true }), kev('t', { ctrlKey: true }), kev('n', { ctrlKey: true }), kev('q', { ctrlKey: true }),
         kev('r', { ctrlKey: true }), kev('T', { ctrlKey: true, shiftKey: true }), kev('R', { ctrlKey: true, shiftKey: true }),
         kev('F5', { code: 'F5' }), kev('F11', { code: 'F11' }), kev('F12', { code: 'F12' }), kev('Tab', { code: 'Tab', ctrlKey: true }),
         kev('Tab', { code: 'Tab', altKey: true })];
      for (const e of kept) { w.key('keydown', e); w.key('keyup', e); assert.ok(!e.prevented && !e.stopped, e.key); }
      assert.equal(w.sent.length, 0, 'none sent');
      for (const tagName of ['INPUT', 'TEXTAREA']) { const e = w.key('keydown', kev('a', { target: { tagName } })); assert.ok(!e.prevented); }
      const editable = w.key('keydown', kev('a', { target: { tagName: 'DIV', isContentEditable: true } })); assert.ok(!editable.prevented);
      assert.equal(w.sent.length, 0);
      for (const e of [kev('w', { metaKey: true }), kev('t', { metaKey: true }), kev('q', { metaKey: true })]) { w.key('keydown', e); assert.ok(!e.prevented); }
      w.key('keydown', kev('z', { ctrlKey: true })); assert.equal(w.sent.length, 1);
      w.key('keydown', kev('F9', { code: 'F9' })); assert.equal(w.sent.length, 2, 'other F keys go (the IDE ignores them)');
      const m = termWorld({ mac: true });
      for (const e of [kev('w', { metaKey: true }), kev('t', { metaKey: true }), kev('n', { metaKey: true }), kev('q', { metaKey: true }), kev('r', { metaKey: true })]) { m.key('keydown', e); assert.ok(!e.prevented, 'Cmd+' + e.key); }
      assert.equal(m.sent.length, 0);
      const ctrlW = m.key('keydown', kev('w', { ctrlKey: true })); assert.ok(ctrlW.prevented && m.sent.length === 1, 'Ctrl+W is not the browser\'s on a Mac');
      const cmdZ = m.key('keydown', kev('z', { metaKey: true })); assert.ok(cmdZ.prevented && m.sent[1].mods.m);
   });

   await check('terminal: nothing is captured while active() is false, and capture starts again when it is true', () => {
      const w = termWorld(); w.on = false;
      const events = [['keydown', kev('a')], ['keyup', kev('a')], ['paste', evt({ target: {}, clipboardData: { getData: () => 'x' } })],
         ['wheel', evt({ deltaX: 1, deltaY: 5, deltaMode: 0, target: {} })], ['mousemove', evt({ clientX: 10, clientY: 10 })],
         ['mousedown', evt({ button: 0, target: {} })], ['mouseup', evt({ button: 0 })], ['blur', evt({ target: w.win })]];
      for (const [type, e] of events) { w.key(type, e); assert.ok(!e.prevented && !e.stopped, type); }
      w.term.flush(); w.win.keydown(kev('b'));
      assert.deepEqual(w.sent, []); assert.deepEqual(w.points, []);
      w.on = true; w.key('keydown', kev('a')); assert.equal(w.sent.length, 1);
   });

   await check('terminal: Mod+V is sent but not prevented (the paste event must come); a paste is sent whole, cut at 4096, with \\n', () => {
      const w = termWorld();
      const v = w.key('keydown', kev('v', { ctrlKey: true }));
      assert.ok(!v.prevented && v.stopped && w.sent.length === 1);
      const paste = text => w.key('paste', evt({ target: { tagName: 'BODY' }, clipboardData: { getData: t => (t === 'text/plain' ? text : '') } }));
      const p = paste('one\r\ntwo\rthree'); assert.ok(p.prevented);
      assert.deepEqual(w.sent[1], { k: 'paste', text: 'one\ntwo\nthree' });
      paste('x'.repeat(5000)); assert.equal(w.sent[2].text.length, 4096);
      paste('x'.repeat(4095) + '\u{1F600}'); assert.equal(w.sent[3].text.length, 4095, 'no half of a surrogate pair');
      paste(''); assert.equal(w.sent.length, 4, 'an empty clipboard sends nothing');
      assert.ok(w.sent.slice(1).every(wireOk));
      const input = w.key('paste', evt({ target: { tagName: 'INPUT' }, clipboardData: { getData: () => 'secret' } }));
      assert.ok(!input.prevented && w.sent.length === 4, 'a paste into a form field is the page\'s');
   });

   await check('terminal: the wheel is summed and sent once, in order, before the next event; pointer and buttons', () => {
      const w = termWorld();
      const wheel = (dx, dy, deltaMode = 0) => w.key('wheel', evt({ deltaX: dx, deltaY: dy, deltaMode, target: { tagName: 'BODY' } }));
      const e = wheel(1, 10); wheel(2, -4); wheel(0, 1, 1);
      assert.ok(e.prevented, 'the page does not scroll');
      assert.equal(w.win.listeners.wheel[0].opts.passive, false);
      assert.equal(w.sent.length, 0, 'held until the frame');
      w.term.flush(); assert.deepEqual(w.sent, [{ k: 'wheel', dx: 3, dy: 22 }]);   // 10 - 4 + 16
      w.term.flush(); assert.equal(w.sent.length, 1, 'nothing more to send');
      wheel(0, 5); w.key('keydown', kev('a'));
      assert.deepEqual(w.sent.slice(1).map(x => x.k), ['wheel', 'key'], 'a key flushes the wheel first');
      wheel(0, -5); wheel(0, 5); w.term.flush(); assert.equal(w.sent.length, 3, 'a zero sum is not sent');
      assert.ok(w.sent.every(wireOk));
      w.key('mousemove', evt({ clientX: 500, clientY: 125 })); w.key('mousemove', evt({ clientX: -20, clientY: 900 }));
      assert.deepEqual(w.points, [{ x: .5, y: .25 }, { x: 0, y: 1 }]);
      w.key('mousedown', evt({ button: 0, target: { tagName: 'BODY' } })); w.key('mouseup', evt({ button: 0 }));
      w.key('mousedown', evt({ button: 2, target: { tagName: 'BODY' } })); w.key('mouseup', evt({ button: 2 }));
      assert.deepEqual(w.sent.slice(3), [{ k: 'btn', d: 'down' }, { k: 'btn', d: 'up' }], 'the primary button only');
   });

   await check('terminal: Shift+wheel sends its vertical delta as dx (when deltaX is 0); a real deltaX is left alone', () => {
      const w = termWorld();
      const wheel = (dy, o = {}) => w.key('wheel', evt({ deltaX: 0, deltaY: dy, deltaMode: 0, shiftKey: true, target: { tagName: 'BODY' }, ...o }));
      const e = wheel(40); assert.ok(e.prevented);
      wheel(-10); wheel(1, { deltaMode: 1 });
      w.term.flush(); assert.deepEqual(w.sent, [{ k: 'wheel', dx: 46, dy: 0 }], '40 - 10 + 16, all sideways');
      wheel(5, { deltaX: 7 }); w.term.flush();
      assert.deepEqual(w.sent[1], { k: 'wheel', dx: 7, dy: 5 }, 'a browser that already turned it sideways: unchanged');
      w.key('wheel', evt({ deltaX: 0, deltaY: 9, deltaMode: 0, target: { tagName: 'BODY' } })); w.term.flush();
      assert.deepEqual(w.sent[2], { k: 'wheel', dx: 0, dy: 9 }, 'without Shift: vertical');
      assert.ok(w.sent.every(wireOk));
   });

   await check('terminal: Ctrl/Cmd+wheel is a zoom step (wheel up = in), never the page\'s zoom, and sends no scroll', () => {
      for (const mods of [{ ctrlKey: true }, { metaKey: true }]) {
         const w = termWorld();
         const wheel = (dy, o = {}) => w.key('wheel', evt({ deltaX: 0, deltaY: dy, deltaMode: 0, ...mods, target: { tagName: 'BODY' }, ...o }));
         const e = wheel(-100); assert.ok(e.prevented, 'the page does not zoom');
         w.term.flush(); assert.deepEqual(w.sent, [{ k: 'wheel', dx: 0, dy: 0, zoom: 1 }], 'a lone notch: one step at once, up = in');
         w.t += 500; wheel(100); w.term.flush(); assert.deepEqual(w.sent[1], { k: 'wheel', dx: 0, dy: 0, zoom: -1 }, 'down: zoom out');
         // a pinch right after: many small deltas make one step per 40 units, not one per event
         w.t += 500; for (let i = 0; i < 7; i++) wheel(-3); w.term.flush(); assert.equal(w.sent.length, 2, '21 units in one frame: not yet');
         w.t += 16; for (let i = 0; i < 7; i++) wheel(-3); w.term.flush(); assert.deepEqual(w.sent[2], { k: 'wheel', dx: 0, dy: 0, zoom: 1 });
         assert.equal(w.sent.length, 3);
         w.t += 16; wheel(-300); w.term.flush(); assert.equal(w.sent.length, 4, 'one step a frame at most');
         wheel(5); wheel(-5); w.term.flush(); assert.equal(w.sent.length, 4, 'a zero sum is nothing');
         assert.ok(w.sent.every(wireOk));
      }
      const w = termWorld();
      w.key('wheel', evt({ deltaX: 3, deltaY: 50, deltaMode: 0, ctrlKey: true, target: { tagName: 'BODY' } })); w.term.flush();
      assert.deepEqual(w.sent, [{ k: 'wheel', dx: 0, dy: 0, zoom: -1 }], 'Ctrl+wheel never scrolls');
      w.key('wheel', evt({ deltaY: 5, deltaMode: 0, ctrlKey: true, target: { tagName: 'INPUT' } })); w.term.flush();
      assert.equal(w.sent.length, 1, 'a form field keeps its own wheel');
   });

   await check('terminal: sparse or small zoom deltas still zoom: they add up for 200 ms, a lone notch is a step, a longer pause forgets', () => {
      const w = termWorld();
      const wheel = (dy, o = {}) => w.key('wheel', evt({ deltaX: 0, deltaY: dy, deltaMode: 0, ctrlKey: true, target: { tagName: 'BODY' }, ...o }));
      // a slow mouse wheel: 3 units every 100 ms, each in its own frame
      for (let i = 0; i < 30; i++) { wheel(-3); w.term.flush(); w.t += 100; }
      assert.deepEqual(w.sent.map(x => x.zoom), [1, 1], '3 * 14 = 42 -> a step, then again');
      // below a notch and sparse (a pause over 200 ms between): never
      const q = termWorld();
      for (let i = 0; i < 20; i++) { q.key('wheel', evt({ deltaX: 0, deltaY: -3, deltaMode: 0, ctrlKey: true, target: { tagName: 'BODY' } })); q.term.flush(); q.t += 250; }
      assert.equal(q.sent.length, 0, 'forgotten after each pause: no zoom from tiny sparse ticks');
      // a lone notch in pixel mode (4 units) and in line mode (one line = 16) is a step; a 3 is not
      const n = termWorld();
      n.key('wheel', evt({ deltaX: 0, deltaY: -4, deltaMode: 0, ctrlKey: true, target: { tagName: 'BODY' } })); n.term.flush(); assert.equal(n.sent.length, 1);
      n.t += 1000; n.key('wheel', evt({ deltaX: 0, deltaY: 1, deltaMode: 1, ctrlKey: true, target: { tagName: 'BODY' } })); n.term.flush();
      assert.deepEqual(n.sent[1], { k: 'wheel', dx: 0, dy: 0, zoom: -1 }, 'line mode');
      n.t += 1000; n.key('wheel', evt({ deltaX: 0, deltaY: -3, deltaMode: 0, ctrlKey: true, target: { tagName: 'BODY' } })); n.term.flush(); assert.equal(n.sent.length, 2);
      // the notch right after another is not "lone": it adds up (4 + 4 + ... until 40)
      n.t += 1000; for (let i = 0; i < 12; i++) { n.key('wheel', evt({ deltaX: 0, deltaY: -4, deltaMode: 0, ctrlKey: true, target: { tagName: 'BODY' } })); n.term.flush(); n.t += 16; }
      assert.equal(n.sent.length, 2 + 2, 'one step at once, one more at 40 units');
      assert.ok(n.sent.every(wireOk));
   });

   await check('terminal: a scroll and a zoom in one frame go in order, scroll first; a key flushes both', () => {
      const w = termWorld();
      w.key('wheel', evt({ deltaX: 0, deltaY: 30, deltaMode: 0, target: { tagName: 'BODY' } }));
      w.key('wheel', evt({ deltaX: 0, deltaY: -60, deltaMode: 0, ctrlKey: true, target: { tagName: 'BODY' } }));
      w.key('keydown', kev('a'));
      assert.deepEqual(w.sent.map(x => x.k + (x.zoom ? ':z' : '')), ['wheel', 'wheel:z', 'key']);
      assert.deepEqual(w.sent[0], { k: 'wheel', dx: 0, dy: 30 });
      assert.ok(w.sent.every(wireOk));
   });

   await check('terminal: blur of the window sends blur; the blur of an element does not; refused sends are counted', () => {
      const w = termWorld();
      w.key('blur', evt({ target: w.win })); assert.deepEqual(w.sent, [{ k: 'blur' }]); assert.equal(w.term.stats.blurs, 1);
      w.key('blur', evt({ target: { tagName: 'INPUT' } })); assert.equal(w.sent.length, 1);
      assert.ok(wireOk(w.sent[0]));
      w.refuse = true; const refused = w.key('keydown', kev('a')); assert.equal(w.term.stats.refused, 1); assert.equal(w.term.stats.sent, 1);
      assert.ok(!refused.prevented && !refused.stopped, 'a key that was not sent is left to the page'); assert.deepEqual(w.term.keys(), []);
      const pasted = w.key('paste', evt({ target: { tagName: 'BODY' }, clipboardData: { getData: () => 'x' } })); assert.ok(!pasted.prevented, 'nor is a refused paste');
   });

   await check('terminal: window.keydown/keyup take the same path, once per event; dispose removes every listener and the hooks', () => {
      const w = termWorld();
      assert.equal(typeof w.win.keydown, 'function'); assert.equal(typeof w.win.keyup, 'function');
      const same = kev('a'); w.key('keydown', same); w.win.keydown(same);
      assert.equal(w.sent.length, 1, 'an event that came both ways is taken once');
      w.win.keydown(kev('b')); w.win.keyup(kev('b')); assert.deepEqual(w.sent.map(x => x.key + x.d[0]), ['ad', 'bd', 'bu']);
      const w2 = fakeWin(), mine = () => {}; w2.keydown = mine;
      const t2 = Tm.createTerminal({ win: w2, sendIn: () => true });
      assert.notEqual(w2.keydown, mine); assert.ok(w2.count() >= 8);
      t2.dispose();
      assert.equal(w2.count(), 0, 'every listener is removed'); assert.equal(w2.keydown, mine, 'the earlier hook is back'); assert.equal(w2.keyup, undefined);
      w.term.dispose(); w.term.dispose();
      assert.equal(w.win.count(), 0); assert.equal(w.win.keydown, undefined);
      const n = w.sent.length; w.win.dispatch('keydown', kev('z')); assert.equal(w.sent.length, n);
   });

   await check('terminal: the HUD shows link, role, focus, the last 5 keys, the platform keymap and the visibility warning', () => {
      const made = [];
      const doc = { body: { appendChild(el) { el.parentNode = this; made.push(el); }, removeChild(el) { el.parentNode = null; } },
                    createElement: () => ({ style: {}, textContent: '', parentNode: null }) };
      const w = termWorld({ doc });
      assert.equal(made.length, 1);
      for (const k of 'abcdefg') w.key('keydown', kev(k));
      w.key('keydown', kev('Enter', { code: 'Enter', ctrlKey: true })); w.key('keydown', kev('Control', { code: 'ControlLeft', ctrlKey: true }));
      w.key('keydown', kev('a', { repeat: true }));
      const text = w.term.status({ role: 'runtime', link: 'paired, rtt 12 ms', focus: 'ball' });
      assert.equal(made[0].textContent, text); assert.equal(made[0].style.display, 'block');
      assert.match(text, /role: runtime/); assert.match(text, /link: paired, rtt 12 ms/); assert.match(text, /focus: ball/);
      assert.match(text, /keys: d {2}e {2}f {2}g {2}Ctrl\+Enter\n/, 'a modifier alone and a repeat are not listed');
      assert.deepEqual(w.term.keys(), ['d', 'e', 'f', 'g', 'Ctrl+Enter']);
      assert.match(text, /Ctrl\+Enter run/); assert.ok(!/Cmd\+Enter/.test(text));
      assert.match(text, /Ctrl\+Y redo/); assert.match(text, /command line: card rm rename undo reset revert pause live play use plug unplug/);
      assert.match(text, /Keep this window visible/);
      assert.match(w.term.status({}), /focus: on the headset/);
      w.on = false; w.term.status({}); assert.equal(made[0].style.display, 'none', 'hidden while nothing is captured');
      const mac = termWorld({ mac: true }).term.status({});
      assert.match(mac, /Cmd\+Enter run/); assert.ok(!/Ctrl\+Y/.test(mac)); assert.match(mac, /command line: card /); assert.match(mac, /Cmd\+Left \/ Cmd\+Right/); assert.ok(!/Ctrl\+Enter run/.test(mac));
      w.term.dispose(); assert.equal(made[0].parentNode, null, 'the HUD is removed');
      w.term.status({});   // a disposed terminal is quiet
   });

   // ---- the loopback ---------------------------------------------------------------------------------------------------
   await check('loopback: cmd and dev go to the host, snap, ack and in to the IDE; in order, as wire-valid copies', () => {
      let t = 5; const loop = Lb.createLoopback({ now: () => t++, caps: { mac: true } });
      const got = { ide: [], host: [] };
      const released = []; loop.ide.on('release', r => released.push(r));
      for (const type of ['in', 'snap', 'ack']) loop.ide.on(type, m => got.ide.push(m));
      for (const type of ['cmd', 'dev', 'pair']) loop.host.on(type, m => got.host.push(m));
      const snap = { rev: 1, rails: { a: { value: 1 } } };
      assert.equal(loop.host.sendSnap(snap), true); snap.rev = 99;
      assert.equal(loop.host.sendAck(4, false, 'no'), true); assert.equal(loop.host.sendAck(5, true), true);
      assert.equal(loop.host.sendIn({ k: 'blur' }), true);
      assert.equal(loop.ide.sendCmd({ id: 7, op: 'pause' }), true);
      assert.equal(loop.ide.sendDev('pointer', 'down', true), true);
      loop.pair();
      assert.deepEqual(got.ide.map(m => m.type), ['snap', 'ack', 'ack', 'in']);
      assert.equal(got.ide[0].snap.rev, 1, 'a copy: the sender\'s later change is not seen');
      assert.deepEqual([got.ide[1].cmd, got.ide[1].ok, got.ide[1].reason], [4, false, 'no']); assert.ok(!('reason' in got.ide[2]));
      assert.deepEqual(got.ide[3].ev, { k: 'blur' }); assert.deepEqual(released, ['blur'], 'a blur is also a release, as on the real Link');
      loop.host.sendIn({ k: 'btn', d: 'up' }); assert.deepEqual(released, ['blur'], 'only a blur');
      const drop = () => {}; loop.host.on('cmd', drop); loop.host.removeHandler('cmd', drop); loop.host.removeHandler('nothing', drop);
      assert.deepEqual(got.host.map(m => m.type), ['cmd', 'dev', 'pair']);
      assert.deepEqual(got.host[0].cmd, { id: 7, op: 'pause' }); assert.deepEqual([got.host[1].id, got.host[1].port, got.host[1].value], ['pointer', 'down', true]);
      assert.ok(got.ide.every(m => W.valid(m)), 'every message is valid on the wire');
      assert.ok(got.ide[0].seq < got.ide[1].seq && got.ide[1].t >= 5);
      // an invalid message is refused like the Link refuses it; a handler that throws does not reach the sender
      assert.equal(loop.ide.sendCmd({ id: 1, op: 'rm -rf' }), false); assert.equal(loop.host.sendIn({ k: 'key' }), false);
      assert.equal(loop.stats.refused, 2);
      loop.ide.on('snap', () => { throw new Error('boom'); });
      assert.equal(loop.host.sendSnap({ rev: 2 }), true); assert.equal(loop.stats.errors, 1); assert.equal(got.ide.length, 6, 'the other handlers still got it');
      assert.equal(loop.ide.live && loop.ide.mutual, true); assert.equal(loop.ide.peer.caps.mac, true); assert.equal(loop.host.peer.id, 0);
   });

   await check('routedLink: sends and events go through the loopback in role both and through the real Link otherwise; retire silences', () => {
      const real = { rank: 1, caps: { mac: false }, epoch: 'e', stats: { rx: 3 }, rtt: { p50: 4, max: 9 }, off: 0, live: false, mutual: false, heardMs: 1234, peer: null,
                     handlers: {}, out: [], on(type, fn) { (this.handlers[type] ||= []).push(fn); return this; },
                     removeHandler(type, fn) { this.handlers[type] = (this.handlers[type] || []).filter(f => f !== fn); return this; },
                     sendIn(ev) { this.out.push(['in', ev]); return true; }, sendSnap(s) { this.out.push(['snap', s]); return true; },
                     sendAck() { return true; }, sendDev() { return true; }, sendCmd(c) { this.out.push(['cmd', c]); return true; } };
      const loop = Lb.createLoopback({ caps: { mac: false } });
      let role = 'both';
      const ide = Lb.routedLink({ real, loop, role: () => role, side: 'ide' }), host = Lb.routedLink({ real, loop, role: () => role, side: 'host' });
      const heard = [];
      ide.on('snap', m => heard.push(['ide', m.snap.rev])); host.on('cmd', m => heard.push(['host', m.cmd.id]));
      host.sendSnap({ rev: 1 }); ide.sendCmd({ id: 2, op: 'pause' });
      assert.deepEqual(heard, [['ide', 1], ['host', 2]]); assert.deepEqual(real.out, [], 'nothing reached the real link');
      assert.deepEqual([ide.live, ide.mutual, ide.heardMs, ide.role], [true, true, 0, 'both']); assert.equal(ide.peer.caps.mac, false);
      role = 'runtime'; heard.length = 0;
      host.sendSnap({ rev: 3 }); ide.sendCmd({ id: 4, op: 'pause' }); host.sendIn({ k: 'blur' });
      assert.deepEqual(real.out.map(x => x[0]), ['snap', 'cmd', 'in']); assert.deepEqual(heard, [], 'the loopback is silent');
      for (const fn of real.handlers.snap) fn({ snap: { rev: 5 } }, 2); for (const fn of real.handlers.cmd) fn({ cmd: { id: 6 } }, 2);
      assert.deepEqual(heard, [['ide', 5], ['host', 6]], 'real events count outside both');
      assert.deepEqual([ide.live, ide.mutual, ide.heardMs, ide.peer, ide.rank, ide.stats.rx, ide.rtt.p50], [false, false, 1234, null, 1, 3, 4]);
      role = 'both'; heard.length = 0;
      for (const fn of real.handlers.snap) fn({ snap: { rev: 7 } }, 2);
      assert.deepEqual(heard, [], 'real events are ignored in both');
      role = 'runtime'; ide.signal('pair', null); assert.deepEqual(heard, [], 'signal reaches only handlers of its type');
      const pairs = []; ide.on('pair', p => pairs.push(p)); role = 'ide'; ide.signal('pair', 'x'); role = 'both'; ide.signal('pair', 'y');
      assert.deepEqual(pairs, ['x', 'y'], 'signal reaches the part whatever the role');
      assert.equal(real.handlers.snap.length, 1); assert.equal(real.handlers.cmd.length, 1);
      ide.retire(); host.sendSnap({ rev: 8 }); assert.deepEqual(heard, [], 'a retired part hears nothing');
      assert.equal(real.handlers.snap.length, 0, 'the real link no longer holds its handlers'); assert.equal(real.handlers.cmd.length, 1, 'the other part keeps its own');
      ide.signal('pair', 'z'); assert.deepEqual(pairs, ['x', 'y']);
      host.retire(); assert.equal(real.handlers.cmd.length, 0);
   });

   await check('loopback: IDE and a real runtime host (fake Worker): cmd reaches the Worker, snap and ack reach the IDE, pair sends full', async () => {
      const loop = Lb.createLoopback(), role = () => 'both';
      const hostLink = Lb.routedLink({ real: { on() { return this; } }, loop, role, side: 'host' });
      const ideLink = Lb.routedLink({ real: { on() { return this; } }, loop, role, side: 'ide' });
      const posted = []; let wk = null;
      const make = () => (wk = { postMessage: m => posted.push(JSON.parse(JSON.stringify(m))), terminate() {}, onmessage: null });
      const store = { problem: null, loadLayout: async () => ({ cards: {}, uses: {}, unplugged: [] }), loadModule: async () => null, saveModule: async () => ({ ok: true }), saveLayout: async () => ({ ok: true }) };
      const host = Hs.createRuntimeHost({ link: hostLink, store, now: () => 0, makeWorker: make, setInterval: () => 1, clearInterval: () => {} });
      const heard = []; ideLink.on('snap', m => heard.push(m.snap)).on('ack', m => heard.push(['ack', m.cmd, m.ok]));
      await host.start();
      assert.equal(posted[0].type, 'init');
      ideLink.sendCmd({ id: 9, op: 'pause' }); ideLink.sendDev('pointer', 'down', true);
      assert.deepEqual(posted.slice(1).map(m => m.type), ['cmd', 'dev']);
      wk.onmessage({ data: { type: 'snap', snap: { rev: 1, paused: true } } }); wk.onmessage({ data: { type: 'ack', cmd: 9, ok: true } });
      assert.deepEqual(heard, [{ rev: 1, paused: true }, ['ack', 9, true]]);
      loop.pair(); assert.equal(posted[posted.length - 1].type, 'full');
      host.setActive(false);
   });


   // ---- the wiring (use, plug, vars) through wire, worker and host ----
   const fsA = require('node:fs');
   // The saved layout's wiring is whatever the last headset session left (the scene saves it); these checks start from none.
   const DEMO2 = () => ({ ...JSON.parse(fsA.readFileSync('js/scenes/rails/data/layout.js', 'utf8').trim().slice('export default '.length, -1)), uses: {}, unplugged: [] });
   const DEMO_SRC = () => { const s = {}; for (const n of ['oscillator', 'ball', 'flowers', 'constant']) s[n] = fsA.readFileSync(`js/scenes/rails/modules/${n}.js`, 'utf8'); return s; };
   const INIT2 = () => ({ type: 'init', seed: 1, layout: DEMO2(), sources: DEMO_SRC(), snapshot: null, hung: [] });
   const useCmd = (id, module, port, variable) => ({ type: 'cmd', cmd: { id, op: 'use', module, port, variable } });
   const plugCmd = (id, module, on) => ({ type: 'cmd', cmd: { id, op: 'plug', module, on } });

   await check('wire: use and plug are commands with exact fields, and a snapshot may carry vars, uses and unplugged', () => {
      assert.equal(W.valid(cmd('pause', { op: 'use', module: 'ball', port: 'target', variable: 'gaze_hit' })), true);
      assert.equal(W.valid(cmd('pause', { op: 'use', module: 'ball', port: 'target', variable: null })), true, 'null resets');
      assert.equal(W.valid(cmd('pause', { op: 'plug', module: 'ball', on: false })), true);
      for (const bad of [{ op: 'use', module: 'ball', port: 'target' }, { op: 'use', module: 'ball', port: 'target', variable: 5 }, { op: 'use', module: 'ball', port: 'target', variable: 'Bad Name' },
                         { op: 'use', module: 'ball', port: 'a.b', variable: 'x' }, { op: 'use', module: 'ball', port: 'target', variable: 'x', rail: 'y' }, { op: 'use', module: 'ball', variable: 'x' },
                         { op: 'use', module: '../x', port: 'target', variable: 'x' }, { op: 'plug', module: 'ball' }, { op: 'plug', module: 'ball', on: 'no' }, { op: 'plug', module: 'ball', on: 0 },
                         { op: 'plug', module: 'ball', on: true, extra: 1 }, { op: 'plug', on: true }]) {
         assert.equal(W.valid(cmd('pause', bad)), false, JSON.stringify(bad));
      }
      const snap = extra => ({ ...goodMessages.snap, snap: { ...goodMessages.snap.snap, ...extra } });
      assert.equal(W.valid(snap({ vars: ['time', 'target'], uses: { 'ball.target': 'gaze_hit' }, unplugged: ['ball'] })), true);
      assert.equal(W.valid(snap({ vars: [], uses: {}, unplugged: [] })), true);
      assert.equal(W.valid(snap({ vars: Array.from({ length: 64 }, (_, i) => `v${i}`) })), true, '64 variables');
      assert.equal(W.valid(snap({ vars: Array.from({ length: 65 }, (_, i) => `v${i}`) })), false, 'not 65');
      for (const bad of [{ vars: 'time' }, { vars: [1] }, { vars: ['Bad Name'] }, { uses: [] }, { uses: { a: 5 } }, { uses: { a: 'Bad Name' } }, { uses: null }, { unplugged: 'ball' }, { unplugged: [5] }, { unplugged: { ball: true } }]) {
         assert.equal(W.valid(snap(bad)), false, JSON.stringify(bad));
      }
   });

   await check('runtime: every snapshot (use, plug, rm, a full resend) is valid on the wire, and the head says vars, uses, unplugged', () => {
      const rt = new Rt.Runtime({ seed: 1 }); rt.load({ layout: DEMO2(), sources: DEMO_SRC() });
      const snaps = [];
      const take = k => { for (let i = 0; i < k; i++) { rt.step(); if (i % 2) { const s = rt.snapshot(); snaps.push(s); assert.equal(W.valid(asMessage(s)), true, JSON.stringify(s).slice(0, 200)); } } };
      take(20);
      assert.equal(rt.handle({ id: 1, op: 'use', module: 'ball', port: 'target', variable: 'gaze_hit' }).ok, true);
      assert.equal(rt.handle({ id: 2, op: 'plug', module: 'flowers', on: false }).ok, true);
      take(20); rt.full(); take(4);
      assert.equal(rt.handle({ id: 3, op: 'rmModule', module: 'flowers' }).ok, true); take(6);
      const last = snaps[snaps.length - 1];
      assert.deepEqual(last.uses, { 'ball.target': 'gaze_hit' }); assert.deepEqual(last.unplugged, []); assert.ok(last.vars.includes('target') && !last.vars.includes('planted'));
      assert.ok(snaps.some(s => s.unplugged.includes('flowers')), 'the plug was seen');
      assert.deepEqual(Object.keys(last.geometry), ['cards']);
      assert.ok(snaps.every(s => Array.isArray(s.vars) && s.vars.every((v, i, a) => i === 0 || a[i - 1] < v)), 'sorted');
   });

   await check('worker: init builds the runtime from the demo layout; use and plug are acked; snaps carry the wiring', () => {
      const w = core(); w.send(INIT2()); w.tick(4);
      assert.ok(w.of('snap').every(s => W.valid(asMessage(s.snap))));
      assert.deepEqual(w.of('snap')[0].snap.vars, [...w.c.runtime.bus.rails.keys()].sort());
      w.clear();
      w.send(useCmd(11, 'ball', 'target', 'pointer_pos')); w.send(plugCmd(12, 'oscillator', false)); w.send(useCmd(13, 'ball', 'target', 'nope'));
      assert.deepEqual(w.of('ack').map(a => [a.cmd, a.ok]), [[11, true], [12, true], [13, false]]);
      assert.match(w.of('ack')[2].reason, /no variable 'nope'/);
      w.tick(4);
      const last = w.of('snap').pop().snap;
      assert.deepEqual(last.uses, { 'ball.target': 'pointer_pos' }); assert.deepEqual(last.unplugged, ['oscillator']);
   });

   await check('worker: the once-a-second snapshot and layout carry uses and unplugged, and a new Worker started from them keeps both', () => {
      const a = core(); a.send(INIT2()); a.tick(10);
      a.send(useCmd(1, 'ball', 'target', 'gaze_hit')); a.send(useCmd(2, 'flowers', 'target', 'center')); a.send(plugCmd(3, 'oscillator', false));
      a.send({ type: 'dev', id: 'gaze', port: 'hit', value: [.05, 0, -.05] });
      a.tick(120);
      const shot = a.of('snapshot').pop();
      assert.deepEqual(shot.snap.uses, { 'ball.target': 'gaze_hit', 'flowers.target': 'center' }); assert.deepEqual(shot.snap.unplugged, ['oscillator']);
      assert.deepEqual(shot.layout, { cards: DEMO2().cards, uses: { 'ball.target': 'gaze_hit', 'flowers.target': 'center' }, unplugged: ['oscillator'] });
      for (const restart of [{ snapshot: shot.snap, layout: shot.layout }, { snapshot: null, layout: shot.layout }]) {
         const b = core(); b.send({ ...INIT2(), ...restart, seed: 1 });
         const bus = b.c.runtime.bus;
         assert.deepEqual(bus.uses, { 'ball.target': 'gaze_hit', 'flowers.target': 'center' }); assert.deepEqual([...bus.unplugged], ['oscillator']);
         b.tick(3);
         assert.equal(bus.modules.get('ball').ports.find(p => p.name === 'target').rail, 'gaze_hit');
         assert.equal(bus.modules.get('oscillator').ports.find(p => p.name === 'target').rail, null);
         assert.deepEqual(b.c.runtime.layoutFile(), shot.layout);
         assert.deepEqual(b.of('snap').pop().snap.unplugged, ['oscillator']);
      }
      const b = core(); b.send({ ...INIT2(), snapshot: shot.snap, layout: shot.layout });
      assert.equal(b.c.runtime.bus.n, shot.snap.n); b.tick(1); assert.equal(b.c.runtime.bus.n, shot.snap.n + 1);
      assert.deepEqual(b.c.runtime.bus.rails.get('gaze_hit').value, [.05, 0, -.05], 'the device value is part of the snapshot');
   });

   await check('worker: a hung card with no earlier version is left out of uses and unplugged as well (layout and snapshot)', () => {
      const a = core(); a.send(INIT2()); a.tick(10);
      a.send(useCmd(1, 'ball', 'target', 'center')); a.send(useCmd(2, 'flowers', 'target', 'center')); a.send(plugCmd(3, 'ball', false)); a.send(plugCmd(4, 'constant', false)); a.tick(70);
      const shot = a.of('snapshot').pop();
      assert.deepEqual(shot.layout.uses, { 'ball.target': 'center', 'flowers.target': 'center' }); assert.deepEqual(shot.layout.unplugged, ['ball', 'constant']);
      const sources = DEMO_SRC(); delete sources.ball;
      for (const init of [{ ...INIT2(), layout: shot.layout, sources, hung: ['ball'] }, { ...INIT2(), layout: shot.layout, snapshot: shot.snap, sources, hung: ['ball'] }]) {
         const w = core(); w.send(init);
         assert.ok(!w.c.runtime.bus.modules.has('ball'), 'left out');
         assert.deepEqual(w.c.runtime.bus.uses, { 'flowers.target': 'center' }); assert.deepEqual([...w.c.runtime.bus.unplugged], ['constant']);
         assert.deepEqual(w.c.runtime.layoutFile().uses, { 'flowers.target': 'center' }); assert.deepEqual(w.c.runtime.layoutFile().unplugged, ['constant']);
         w.tick(2); assert.ok(w.of('snap')[0].snap.notices.some(n => /ball/.test(n.text) && /no earlier version/.test(n.text)));
      }
   });

   await check('host: use and plug are relayed with their ids and acked back, and count as structure changes: the layout is saved after them', async () => {
      const w = hostWorld({ layout: DEMO2(), files: { oscillator: DEMO_SRC().oscillator, ball: DEMO_SRC().ball, flowers: DEMO_SRC().flowers, constant: DEMO_SRC().constant } });
      await w.host.start(); w.run(200, true);
      const wk = w.cur();
      w.emit('cmd', cmdOf(1, 'use', { module: 'ball', port: 'target', variable: 'gaze_hit' })); w.emit('cmd', cmdOf(2, 'plug', { module: 'oscillator', on: false }));
      assert.deepEqual(wk.posted.slice(-2).map(m => m.cmd), [{ id: 1, op: 'use', module: 'ball', port: 'target', variable: 'gaze_hit' }, { id: 2, op: 'plug', module: 'oscillator', on: false }]);
      wk.say({ type: 'ack', cmd: 1, ok: true }); wk.say({ type: 'ack', cmd: 2, ok: true }); wk.say({ type: 'ack', cmd: 3, ok: false, reason: 'no variable' });
      assert.deepEqual(w.acks, [[1, true, undefined], [2, true, undefined], [3, false, 'no variable']]);
      // the acks came before the Worker's first layout: that layout is not just the baseline, it is a change
      const L = { cards: DEMO2().cards, uses: { 'ball.target': 'gaze_hit' }, unplugged: ['oscillator'] };
      wk.say({ type: 'snapshot', snap: { n: 1, rails: {}, modules: {}, docks: [] }, layout: L });
      w.run(1100, true); assert.deepEqual(w.layouts, [L], 'saved once');
      // later: a new use shows in the next layout, and is saved 1 s after
      const L2 = { ...L, uses: { ...L.uses, 'flowers.target': 'center' } };
      w.emit('cmd', cmdOf(4, 'use', { module: 'flowers', port: 'target', variable: 'center' })); wk.say({ type: 'ack', cmd: 4, ok: true });
      wk.say({ type: 'snapshot', snap: { n: 2, rails: {}, modules: {}, docks: [] }, layout: L2 });
      w.run(900, true); assert.equal(w.layouts.length, 1); w.run(200, true); assert.deepEqual(w.layouts, [L, L2]);
      // a restart is given the newest layout (v2) and the bus snapshot with uses and unplugged
      wk.say({ type: 'snapshot', snap: { n: 90, rails: {}, modules: {}, docks: [], uses: L2.uses, unplugged: L2.unplugged }, layout: L2 });
      w.run(700); assert.equal(w.workers.length, 2);
      const init = w.workers[1].posted[0];
      assert.deepEqual(init.layout, L2); assert.deepEqual(init.snapshot.uses, L2.uses); assert.deepEqual(init.snapshot.unplugged, ['oscillator']);
   });

   // ---- the scene in a fake page ---------------------------------------------------------------------------------------
   await check('scenes.js lists rails right after kbdEvents2; the demo layout loads through the store; railsLink.json is ignored', async () => {
      const fs = require('node:fs');
      const names = (await load('js/scenes/scenes.js')).default().scenes;
      const i = names.findIndex(s => s.name === 'kbdEvents2');
      assert.deepEqual(names[i + 1], { name: 'rails', path: './rails.js', public: true }); assert.equal(names.length, i + 2);
      const text = fs.readFileSync('js/scenes/rails/data/layout.js', 'utf8');
      const store = St.createStore({ fetch: async () => ({ ok: true, text: async () => text }) });
      const demo = await store.loadLayout();           // the demo layout (its behaviour is checked in rails.test.cjs)
      assert.deepEqual(Object.keys(demo.cards), ['oscillator', 'ball', 'flowers', 'constant']);
      assert.ok(demo.uses && typeof demo.uses === 'object' && Array.isArray(demo.unplugged));   // the wiring is what the last session saved
      assert.ok(fs.readFileSync('.gitignore', 'utf8').split('\n').includes('railsLink.json'));
      assert.ok(fs.readdirSync('js/scenes/rails/modules').length > 0);
   });

   // The scene is loaded with the controller state and the IDE replaced: the first so that hands can be set, the second by a
   // spy that records what the scene gives the IDE (its frames, the events of its link) in globalThis.__railsIde.
   const dataUrl = text => 'data:text/javascript;base64,' + Buffer.from(text).toString('base64');
   const ctlUrl = dataUrl('export const controllerMatrix = { left: [], right: [] }; export const buttonState = { left: [], right: [] };');
   const ideUrl = dataUrl(`export const createIde = ({ model, link, owned }) => {
      const log = globalThis.__railsIde = { model, link, owned, frames: [], pairs: 0, releases: [], ins: [], active: [], recentres: [], disposed: 0 };
      link.on('pair', () => log.pairs++).on('release', r => log.releases.push(r)).on('in', m => log.ins.push(m.ev.k));
      return { frame: (...a) => log.frames.push(a), setActive: on => log.active.push(on), recentre: desk => log.recentres.push(desk), dispose: () => log.disposed++, debug: {} };
   };`);
   // The runtime host is the real one, but the scene may be given a fake Worker: the data: URL that the scene is loaded from has
   // no base for `new URL('./worker.js', import.meta.url)`, so a test sets globalThis.__railsMakeWorker.
   globalThis.__railsHost = Hs;
   const hostUrl = dataUrl('export const createRuntimeHost = o => globalThis.__railsHost.createRuntimeHost({ ...o, makeWorker: globalThis.__railsMakeWorker || o.makeWorker });');
   const Scene = await load('js/scenes/rails.js', { '../render/core/controllerInput.js': ctlUrl, './rails/ide.js': ideUrl, './rails/runtimeHost.js': hostUrl });
   const Ctl = await import(ctlUrl);
   const sceneWorld = async ({ search = '', ua = 'Mozilla/5.0 (X11; Linux x86_64)', id = 3 } = {}) => {
      const old = {}, set = (name, value) => { old[name] = Object.getOwnPropertyDescriptor(globalThis, name); Object.defineProperty(globalThis, name, { value, configurable: true, writable: true }); };
      const w = { T: 1000, sent: [], inbox: [], fetched: [], frames: [], forever: {}, els: [] };
      const win = fakeWin();
      Object.assign(win, { clientID: id, clients: [id], isXR: () => false, fetch: async () => ({ ok: false, status: 404 }),
         server: { init() {}, send: (ch, m) => { w.sent.push([ch, m]); }, sync: (ch, cb) => { for (const [from, m] of w.inbox.splice(0)) cb({ 0: m }, from); } } });
      w.win = win;
      set('window', win); set('location', { search }); set('navigator', { platform: 'Linux x86_64', userAgent: ua });
      set('performance', { now: () => w.T });
      set('fetch', (url, opts) => { w.fetched.push([url, opts]); return Promise.resolve({ ok: true }); });
      set('document', { body: { appendChild(el) { el.parentNode = this; w.els.push(el); }, removeChild(el) { el.parentNode = null; } }, createElement: () => ({ style: {}, textContent: '', parentNode: null }) });
      w.model = { animate: fn => w.frames.push(fn) };
      w.frame = (ms = 16) => { w.T += ms; for (const f of w.frames) f(); };
      w.restore = () => { for (const [name, d] of Object.entries(old)) { if (d) Object.defineProperty(globalThis, name, d); else delete globalThis[name]; } };
      w.hello = (from, rank, extra = {}) => w.inbox.push([from, { type: 'hello', from, epoch: 'e' + from, seq: 0, t: w.T, role: 'both', rank, caps: { mac: false }, peer: null, ...extra }]);
      await Scene.init(w.model, {}, w.forever);
      w.ide = globalThis.__railsIde;
      return w;
   };

   await check('scene: forced both runs both parts through the loopback, says nothing to the server, takes keys; deinit gives everything back', async () => {
      const w = await sceneWorld({ search: '?railsRole=both' });
      try {
         const dbg = w.win.railsDebug;
         assert.equal(dbg.role, 'both'); assert.ok(dbg.host, 'the runtime host exists'); assert.equal(typeof w.win.keydown, 'function');
         assert.equal(w.ide.pairs, 1, 'the IDE is told `pair` when the host is built for both'); assert.deepEqual(w.ide.active, [true]);
         assert.equal(w.els.length, 1, 'the HUD');
         w.frame(); w.frame();
         assert.deepEqual(w.sent, [], 'a forced both sends no hello and no message');
         assert.equal(w.els[0].style.display, 'block'); assert.match(w.els[0].textContent, /role: both/); assert.match(w.els[0].textContent, /forced/);
         const before = dbg.loop.sent;
         const e = w.win.dispatch('keydown', kev('a')); assert.ok(e.prevented);
         assert.equal(dbg.loop.sent, before + 1, 'the key went through the loopback'); assert.equal(dbg.terminal.sent, 1);
         assert.deepEqual(w.ide.ins, ['key']);
         w.win.dispatch('blur', evt({ target: w.win })); assert.deepEqual(w.ide.ins, ['key', 'blur']); assert.deepEqual(w.ide.releases, ['blur'], 'the IDE is told to let go');
         assert.equal(dbg.loop.errors, 0);
         w.win.dispatch('mousemove', evt({ clientX: 500, clientY: 250 })); w.frame();
         assert.equal(dbg.errors, 0, dbg.lastError);
         const line = dbg.report('check');
         assert.equal(line.role, 'both'); assert.equal(line.ev, 'check'); assert.equal(line.v, 1);
         const logged = w.fetched.filter(([u]) => u === '/log'); assert.equal(logged.length, 2, 'start and the check');
         assert.match(logged[1][1].body.get('log'), /^rails \{"v":1,"ev":"check","role":"both"/);
         assert.ok(!/"(key|code|text|mods)"/.test(logged[1][1].body.get('log')), 'no key text in the log');
         w.T += 6000; w.frame(); assert.ok(w.fetched.filter(([u]) => u === '/log').length >= 3, 'a tick report every 5 s');
      } finally {
         Scene.deinit();
         assert.equal(w.win.railsDebug, undefined); assert.equal(w.win.count(), 0, 'every listener is removed'); assert.equal(w.win.keydown, undefined);
         assert.equal(w.els[0].parentNode, null, 'the HUD is gone'); assert.equal(w.forever.railsCleanup, undefined);
         const frames = w.fetched.length; w.frame(); assert.equal(w.fetched.length, frames, 'a frame after deinit does nothing');
         w.restore();
      }
   });

   await check('scene: roles follow the Link: alone both, a headset peer makes a laptop the runtime, silence returns to both', async () => {
      const w = await sceneWorld();
      try {
         const dbg = w.win.railsDebug;
         assert.equal(dbg.role, 'both'); const first = dbg.host; assert.ok(first);
         w.frame(); w.frame(); assert.ok(w.sent.some(([ch, m]) => ch === 'railsLink' && m.type === 'hello'), 'presence goes out over the relay (at the next frame\'s sync)');
         assert.equal(w.ide.pairs, 1);
         w.win.clients = [3, 7]; w.hello(7, 2); w.frame(); w.frame();
         assert.equal(dbg.role, 'runtime'); assert.equal(dbg.host, first, 'the same host goes on');
         assert.equal(w.ide.pairs, 2, 'leaving the loopback for the real link is a new upstream for the IDE');
         const early = w.win.dispatch('keydown', kev('a')); assert.equal(dbg.terminal.sent, 0, 'keys wait for a pairing that is mutual'); assert.equal(dbg.terminal.refused, 1);
         assert.ok(!early.prevented && !early.stopped, 'and are left to the page');
         w.hello(7, 2, { seq: 1, peer: { id: 3, epoch: dbg.link.epoch } }); w.frame(); w.frame();
         assert.equal(dbg.link.mutual, true); assert.equal(w.ide.pairs, 3, 'the real link\'s mutual pairing reaches the IDE');
         const n = w.sent.length; w.win.dispatch('keydown', kev('b')); assert.equal(dbg.terminal.sent, 1);
         w.frame(); assert.equal(w.sent.length, n + 1, 'the key goes out at the next sync'); assert.equal(w.sent[w.sent.length - 1][1].type, 'in');
         assert.match(w.els[0].textContent, /role: runtime/); assert.match(w.els[0].textContent, /paired with the headset/);
         w.T += 3500; w.frame(); w.frame();
         assert.equal(dbg.role, 'both', 'a peer silent for 3 s is gone'); assert.equal(w.ide.pairs, 4, 'back to the loopback: told once');
         assert.equal(w.fetched.filter(([u, o]) => u === '/log' && /"ev":"role"/.test(o.body.get('log'))).length, 2, 'each change of role is logged');
      } finally { Scene.deinit(); w.restore(); }
   });

   await check('scene: a headset is the IDE next to a laptop: no runtime, no keys taken; a fresh runtime when it is alone again; ?railsRole=runtime waits', async () => {
      const w = await sceneWorld({ ua: 'Mozilla/5.0 (X11; Linux x86_64) OculusBrowser/30 Quest 3' });
      try {
         const dbg = w.win.railsDebug; assert.equal(dbg.rank, 2);
         const first = dbg.host; assert.ok(first); assert.equal(dbg.link.handlers.cmd.length, 1); assert.equal(w.ide.pairs, 1);
         w.win.clients = [3, 7]; w.hello(7, 1); w.frame(); w.frame();
         assert.equal(dbg.role, 'ide'); assert.equal(dbg.host, null, 'the runtime is stopped');
         assert.equal(w.ide.pairs, 2); assert.equal(dbg.link.handlers.cmd.length, 0, 'the dead host\'s handlers are off the link');
         assert.equal(first.stats.active, false, 'its Worker is gone');
         const e = w.win.dispatch('keydown', kev('a')); assert.ok(!e.prevented, 'a headset takes no keys'); assert.equal(w.els[0].style.display, 'none');
         w.T += 3500; w.frame(); w.frame();
         assert.equal(dbg.role, 'both'); assert.ok(dbg.host && dbg.host !== first, 'a new host, so it reads the files again');
         assert.equal(w.ide.pairs, 3, 'a host rebuilt for both: the IDE is told'); assert.equal(dbg.link.handlers.cmd.length, 1, 'one host listens, not two');
         assert.equal(dbg.link.handlers.dev.length, 1);
      } finally { Scene.deinit(); assert.equal(w.win.railsDebug, undefined); w.restore(); }
      const r = await sceneWorld({ search: '?railsRole=runtime' });
      try {
         const dbg = r.win.railsDebug; r.frame();
         assert.equal(dbg.role, 'runtime'); assert.ok(dbg.host); assert.match(r.els[0].textContent, /waiting for the peer/);
         r.win.dispatch('keydown', kev('a')); assert.equal(dbg.terminal.sent, 0);
         assert.equal(r.sent.filter(([, m]) => m.type === 'in').length, 0, 'nothing typed reaches the relay unpaired');
      } finally { Scene.deinit(); r.restore(); }
      const i = await sceneWorld({ search: '?railsRole=ide' });
      try { assert.equal(i.win.railsDebug.role, 'ide'); assert.equal(i.win.railsDebug.host, null); } finally { Scene.deinit(); i.restore(); }
   });

   const QUEST = 'Mozilla/5.0 (X11; Linux x86_64) OculusBrowser/30 Quest 3';
   await check('scene: a headset that was paired stays the IDE when the laptop falls silent (no local runtime to empty its cards) and pairs again when it returns', async () => {
      const w = await sceneWorld({ ua: QUEST });
      try {
         const dbg = w.win.railsDebug; assert.equal(dbg.rank, 2); assert.equal(dbg.role, 'both', 'alone at first');
         w.win.clients = [3, 7]; w.hello(7, 1); w.frame(); w.frame();
         assert.equal(dbg.role, 'ide'); assert.equal(dbg.host, null);
         w.hello(7, 1, { seq: 1, peer: { id: 3, epoch: dbg.link.epoch } }); w.frame(); w.frame();
         assert.equal(dbg.link.mutual, true); const pairs = w.ide.pairs;
         w.T += 3500; w.frame(); w.frame();
         assert.equal(dbg.link.live, false); assert.equal(dbg.link.role, 'both', 'the Link itself says alone');
         assert.equal(dbg.role, 'ide', 'but the page stays the IDE'); assert.equal(dbg.host, null, 'with no runtime, which would read nothing and empty the cards');
         assert.equal(w.ide.pairs, pairs, 'the IDE is not told of a new upstream'); assert.equal(w.ide.active.at(-1), true);
         assert.equal(w.fetched.filter(([u, o]) => u === '/log' && /"ev":"role"/.test(o.body.get('log'))).length, 1, 'no change of role to log (only the first pairing)');
         assert.equal(dbg.errors, 0, dbg.lastError);
         w.T += 20000; w.frame(); assert.equal(dbg.role, 'ide', 'however long it takes');
         w.hello(7, 1, { seq: 2, peer: { id: 3, epoch: dbg.link.epoch } }); w.frame(); w.frame();
         assert.equal(dbg.role, 'ide'); assert.equal(dbg.link.mutual, true); assert.equal(w.ide.pairs, pairs + 1, 'a new pairing: the IDE expects a full snapshot');
      } finally { Scene.deinit(); w.restore(); }
      const forced = await sceneWorld({ ua: QUEST, search: '?railsRole=ide' });
      try { assert.equal(forced.win.railsDebug.role, 'ide'); } finally { Scene.deinit(); forced.restore(); }
      const laptop = await sceneWorld();
      try {
         const dbg = laptop.win.railsDebug; laptop.win.clients = [3, 7]; laptop.hello(7, 2); laptop.frame(); laptop.frame();
         laptop.hello(7, 2, { seq: 1, peer: { id: 3, epoch: dbg.link.epoch } }); laptop.frame(); laptop.frame(); assert.equal(dbg.role, 'runtime');
         laptop.T += 3500; laptop.frame(); laptop.frame(); assert.equal(dbg.role, 'both', 'a laptop alone again runs both, as before');
      } finally { Scene.deinit(); laptop.restore(); }
   });

   await check('scene: entering XR asks the IDE for a new workspace and desk, once for each entry, from a head over 0.3 m', async () => {
      // A view matrix is the inverse of the head's: a head at height h has the translation -h.
      const at = h => ({ views: [{ viewMatrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, -h, 0, 1] }], inverseRootMatrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] });
      const low = await sceneWorld({ search: '?railsRole=both' });
      try {
         low.win.clay = at(0); low.win.isXR = () => true;
         for (let i = 0; i < 59; i++) low.frame();
         assert.deepEqual(low.ide.recentres, [], 'a head at the floor (the inline view) is not taken');
         low.frame(); assert.deepEqual(low.ide.recentres, [true], 'after 60 frames it is, whatever the head');
      } finally { Scene.deinit(); low.restore(); }
      const w = await sceneWorld({ search: '?railsRole=both' });
      try {
         w.win.clay = at(1.5);
         w.frame(); w.frame(); assert.deepEqual(w.ide.recentres, [], 'inline: nothing');
         w.win.isXR = () => true; w.frame(); assert.deepEqual(w.ide.recentres, [true], 'the frame that is the first in XR');
         w.frame(); w.frame(); assert.deepEqual(w.ide.recentres, [true]);
         w.win.isXR = () => false; w.frame(); assert.deepEqual(w.ide.recentres, [true], 'leaving does not');
         w.win.isXR = () => true; w.frame(); assert.deepEqual(w.ide.recentres, [true, true], 'the next entry does');
         assert.equal(w.win.railsDebug.errors, 0, w.win.railsDebug.lastError);
      } finally { Scene.deinit(); w.restore(); }
      const r = await sceneWorld({ search: '?railsRole=runtime' });
      try { r.win.clay = at(1.5); r.win.isXR = () => true; r.frame(); assert.deepEqual(r.ide.recentres, [true], 'asked whatever the role (the IDE keeps it for when it is active)'); } finally { Scene.deinit(); r.restore(); }
   });

   await check('scene: leaving gives the IDE\'s nodes and meshes back before the textures (ide.dispose), once', async () => {
      const w = await sceneWorld({ search: '?railsRole=both' });
      try {
         assert.equal(w.ide.disposed, 0);
         Scene.deinit(); assert.equal(w.ide.disposed, 1);
         Scene.deinit(); assert.equal(w.ide.disposed, 1, 'and not again');
      } finally { Scene.deinit(); w.restore(); }
   });

   await check('scene: the IDE gets head, hands (tracked controllers only, from controllerInput) each frame, except in role runtime', async () => {
      const I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], moved = I.map((v, i) => (i === 13 ? 1.5 : v));
      const w = await sceneWorld({ search: '?railsRole=both' });
      try {
         w.win.isXR = () => true; w.win.clay = { views: [{ viewMatrix: I }, { viewMatrix: moved }], inverseRootMatrix: I };
         Ctl.controllerMatrix.left = moved; Ctl.controllerMatrix.right = [];
         Ctl.buttonState.left = [{ pressed: true }];
         w.frame();
         const [head, hands] = w.ide.frames[w.ide.frames.length - 1];
         assert.equal(head.length, 16); assert.ok(head.every(Number.isFinite));
         assert.deepEqual(hands.map(h => h.hand), ['left'], 'an untracked controller is not a hand');
         assert.deepEqual(hands[0].m, moved); assert.deepEqual(hands[0].buttons, [{ pressed: true }]);
         Ctl.controllerMatrix.right = moved.map((v, i) => (i === 5 ? NaN : v)); w.frame();
         assert.deepEqual(w.ide.frames[w.ide.frames.length - 1][1].map(h => h.hand), ['left'], 'a matrix with a NaN is not a hand');
         Ctl.controllerMatrix.right = I; w.frame();
         assert.deepEqual(w.ide.frames[w.ide.frames.length - 1][1].map(h => h.hand), ['left', 'right']);
         w.win.isXR = () => false; w.frame();
         assert.deepEqual(w.ide.frames[w.ide.frames.length - 1][1], [], 'no hands on the desktop');
         assert.equal(w.win.railsDebug.errors, 0, w.win.railsDebug.lastError);
      } finally { Scene.deinit(); Ctl.controllerMatrix.left = []; Ctl.controllerMatrix.right = []; Ctl.buttonState.left = []; w.restore(); }
      const r = await sceneWorld({ search: '?railsRole=runtime' });
      try {
         r.win.clay = { views: [{ viewMatrix: I }], inverseRootMatrix: I }; r.frame(); r.frame();
         assert.equal(r.ide.frames.length, 0, 'the IDE is not drawn while the laptop is the runtime'); assert.deepEqual(r.ide.active, [false]);
      } finally { Scene.deinit(); r.restore(); }
   });


   // ---- the outbox: what can wait between two syncs --------------------------------------------------------------------
   // A hidden laptop tab stops the frames (and so the class server's sync, which sends the whole queue as ONE message) while the
   // Worker goes on making snaps. The scene bounds what it queues: at most MAX snaps; past that it drops them all and asks for a
   // full one. A fake Worker stands in for the real one; the scene's runtime role (a headset peer that names us back) relays its snaps.
   const outboxWorld = async () => {
      const workers = [];
      globalThis.__railsMakeWorker = () => { const wk = { posted: [], postMessage(m) { this.posted.push(m); }, terminate() {} }; workers.push(wk); return wk; };
      const w = await sceneWorld();
      const restore = w.restore;
      w.restore = () => { restore(); delete globalThis.__railsMakeWorker; };
      w.workers = workers;
      w.queued = () => w.sent.filter(([, m]) => m.type === 'snap').length;
      // The headset says hello and names us back, so that the link is mutual and the host relays.
      w.pair = () => {
         w.win.clients = [3, 7]; w.hello(7, 2); w.frame(); w.frame();
         w.hello(7, 2, { seq: 1, peer: { id: 3, epoch: w.win.railsDebug.link.epoch } }); w.frame(); w.frame();
      };
      w.snap = rev => workers[workers.length - 1].onmessage({ data: { type: 'snap', snap: { rev } } });
      return w;
   };
   const waitHost = async w => { for (let i = 0; i < 50 && !w.workers.length; i++) await new Promise(r => setTimeout(r, 5)); assert.ok(w.workers.length, 'the host started its Worker'); };

   await check('scene outbox: frames stop for 10 s while the Worker relays 30 snaps a second: the queue stays bounded; on return a full snapshot is asked for', async () => {
      const w = await outboxWorld();
      try {
         await waitHost(w); w.pair();
         const dbg = w.win.railsDebug, worker = w.workers[0];
         assert.ok(dbg.link.mutual, 'paired');
         w.sent.length = 0; worker.posted.length = 0;
         for (let i = 1; i <= 300; i++) { w.snap(i); assert.ok(w.queued() <= 15, `after ${i} snaps ${w.queued()} wait in the server's queue`); }   // 10 s of 30 Hz, and no runFrame
         w.frame();
         const snaps = w.sent.filter(([, m]) => m.type === 'snap');
         assert.ok(snaps.length <= 15, `the flush holds ${snaps.length} snaps, at most 15`);
         assert.ok(w.sent.length <= 15 + 5, `the flush is ${w.sent.length} messages`);
         assert.ok(worker.posted.some(m => m.type === 'full'), 'a full snapshot was asked for');
         worker.posted.length = 0;
         w.sent.length = 0; w.snap(301); w.frame();
         assert.equal(w.sent.filter(([, m]) => m.type === 'snap').length, 1, 'snaps flow again');
         assert.equal(worker.posted.filter(m => m.type === 'full').length, 0, 'and a full one is asked for once only');
         assert.equal(dbg.errors, 0, dbg.lastError);
      } finally { Scene.deinit(); w.restore(); }
   });

   await check('scene outbox: a burst of 15 snaps or fewer is sent whole and asks for nothing', async () => {
      const w = await outboxWorld();
      try {
         await waitHost(w); w.pair();
         const worker = w.workers[0]; w.sent.length = 0; worker.posted.length = 0;
         for (let i = 1; i <= 15; i++) w.snap(i);
         w.frame();
         assert.deepEqual(w.sent.filter(([, m]) => m.type === 'snap').map(([, m]) => m.snap.rev), Array.from({ length: 15 }, (_, i) => i + 1));
         assert.equal(worker.posted.filter(m => m.type === 'full').length, 0);
      } finally { Scene.deinit(); w.restore(); }
   });

   await check('scene outbox: messages that are not snaps (ack, hello) are never dropped, whatever the snaps do', async () => {
      const w = await outboxWorld();
      try {
         await waitHost(w); w.pair();
         const worker = w.workers[0]; w.sent.length = 0;
         const acks = [];
         for (let i = 1; i <= 100; i++) {
            w.snap(i);
            if (i % 10 === 0) { const id = i; acks.push(id); w.win.railsDebug.link.sendAck(id, true); }
         }
         w.frame(600); w.frame();       // (a hello is due: made in the first frame, sent at the next sync)
         const got = w.sent.filter(([, m]) => m.type === 'ack').map(([, m]) => m.cmd);
         assert.deepEqual(got, acks, 'every ack went out, in order');
         assert.ok(w.sent.filter(([, m]) => m.type === 'snap').length <= 15);
         assert.ok(w.sent.some(([, m]) => m.type === 'hello'), 'and the presence');
         assert.ok(worker.posted.some(m => m.type === 'full'));
      } finally { Scene.deinit(); w.restore(); }
   });

   await check('host: resend() asks the Worker for a full snapshot, and does nothing without a Worker', async () => {
      const w = await started();
      w.host.resend(); assert.equal(w.of(w.cur(), 'full').length, 1);
      const idle = hostWorld(); idle.host.resend();                  // never started: no Worker, no error
      const none = hostWorld(); none.host.setActive(false); none.host.resend(); assert.equal(none.workers.length, 0);
   });

   console.log(`${passed} rails link checks passed.`);
})().catch(err => { console.error(err); process.exit(1); });
