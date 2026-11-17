// Playwright test: Rails in a real browser (headless Chromium), served by the app server (start it first; XR_TEST_URL
// defaults to http://localhost:2026/). Pages are on a routed relay that works like the classroom's (see makeRelay), so no
// real server state is shared, and nothing is written to the repository: /api/saveScene is recorded and answered, the layout
// and the module files are served from a map in this file, /log and /set are recorded or answered locally, and any other
// POST fails the test.
// Phases (Rails v2: one bus, variables by name, `use`, one plug per card, the bus window):
//   A  a lone runtime page and a stray client that says hello (its Link never hears the runtime, so the pairing is not
//      mutual) and then sends keys and commands: they are delivered (the page's Link.receive saw them) and do nothing.
//   B  the IDE joins and they pair; a stray again (all messages delivered, nothing changes); the IDE's commands work; a good
//      commit is saved after about a second, never earlier; a module that hangs (a real infinite loop) gets the real Worker
//      killed and restarted, is quarantined, and its source is never saved; /log lines; the IDE page reloads and pairs again
//      with a new epoch and a full snapshot.
//   B2 the IDE itself, on the same pair: the laptop's real keyboard types into the focused card's buffer, Mod+Enter commits it
//      (saved with the exact text), a syntax error turns one card red while another module keeps running, a typed `while (true) {}`
//      gets the Worker restarted and the module quarantined (and is never saved), the plug of a card is grabbed with the trackpad
//      (unplug on a release off the bus, plug on a release on it), a blur lets go of the held button and cancels a grab, a key that
//      is 3 s old is dropped, and the log line carries names, never text.
//   B2b the bus by name on the same pair: a card that is added late and takes a variable gets its retained value; an input that
//      waits for a variable, `use` binds it, a `use` of a missing variable is refused; a reload that drops an input with a `use`
//      gives the notice and drops the entry.
//   B2c full slots, the timeline strip's repaint rate, pause, scrub and play over the tape (`out` is a variable now).
//   B2g the paused scene is the past: pause, seek back 2 s, the ball the stage draws is at the recorded position of then (not the
//      one at the pause); Mod+Enter paused sends nothing; Mod+Shift+Enter goes live from the playhead with the code of now.
//   B3 a laptop that says it is a Mac (navigator.platform): Cmd+Enter commits, Ctrl+Enter does nothing.
//   V  the demo of the repository itself (its layout and modules, read from the server; nothing is written): the ball follows the
//      oscillator by name with no `uses`; `use target pointer_pos` and the laptop's mouse moves the ball, then `gaze_hit` (the ray
//      on the mat), `center`, and a reset; the oscillator's plug is grabbed, released off the bus (the flowers stop, `target` has no
//      publisher) and put back; the bus window (the gaze on the bus opens it, Mod+B, a gaze press and keys reassign an input, Esc
//      closes in steps, a press on a row is not `pointer_down`); use refusals; Shift+wheel and Mod+[ / Mod+] move the paused
//      playhead (a real Ctrl+[ reaches the page and its default is prevented); Ctrl+wheel and Mod+= / Mod+- / Mod+0 zoom the
//      focused card; a long line scrolls sideways; at most 30 bus nodes drawn, seven canvases.
//   C  one page forced to `both`: Worker, loopback, no railsLink message; the IDE in it types a card and Mod+Enter runs and saves it; the texture channels (exactly the scene's own, all
//      given back), the Worker is gone when the scene is left, and a second visit works.
//   D  unforced roles: a page alone is `both`; a Quest user agent joining a laptop page is the IDE and the laptop the runtime.
// (Every time measured here is performance.now(), not Date.now(): the wall clock of this WSL2 machine steps by seconds, which made
// "saved N ms after" and "restarted N ms after" checks fail with negative or short times.)
// Run with NODE_PATH pointing to an installation containing playwright.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');

const LAYOUT = 'export default {"cards":{},"uses":{},"unplugged":[]};\n';
const MODULES = new Map();            // name -> source: what the test serves as js/scenes/rails/modules/<name>.js
const POSTS = new Set(['/log', '/set', '/api/saveScene']);
const QUEST = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) OculusBrowser/30.0 Chrome/120.0 VR Safari/537.36';
// (good1 publishes the variable `good`, so that the bus has one before anything ticks; hang's good source has no ports.)
const OUT = "const good = output('good', 'state', 'any');\n";
const GOOD = 'const S = state({ n: 0 });\n' + OUT, GOOD2 = 'const S = state({ n: 1 });\n' + OUT, GOOD3 = 'const S = state({ n: 2 });\n' + OUT;
const HANG_OK = 'const S = state({ n: 3 });\n';
const HANG = 'const S = state({ n: 9 });\nfor (;;) {}\n';
// A module that ticks (its calls rise), drawing a ball that moves, with an output (the variable `out`).
const TICK = "const time = input('time', 'state', 'time');\nconst out = output('out', 'state', 'any');\nconst S = state({ n: 0 });\n" +
   "time.on(() => { S.n++; out.set(S.n); draw([{ shape: 'sphere', p: [(S.n % 100) * .001, .02, 0], s: .01, color: '#ffb000' }]); });\n";
const TYPED = '// ' + Array.from({ length: 197 }, (_, i) => String.fromCharCode(33 + (i * 7) % 90)).join('');   // 200 characters, one line
// What a page sees of a bracket key: a spy on the window, in the capture phase before the scene's own, which looks at the event once the
// whole dispatch is over (so `prevented` is what the scene did with it).
const KEYSPY = `window.KD = []; window.addEventListener('keydown', e => { if (e.code === 'BracketLeft' || e.code === 'BracketRight') {
   const r = { key: e.key, ctrl: e.ctrlKey, trusted: e.isTrusted }; KD.push(r); setTimeout(() => { r.prevented = e.defaultPrevented; }, 0); } }, true);`;
const MAC = `Object.defineProperty(navigator, 'platform', { get: () => 'MacIntel' });`;

// A relay like the classroom's: each page's WebSocket is routed to a welcome with the page's clientID, the list of clients,
// and every message to the other pages. `frames[id]` keeps what page `id` sent (text), to look at.
const makeRelay = url => {
   const socketURL = `${url.protocol === 'https:' ? 'wss:' : 'ws:'}//${url.host}/`;
   const peers = new Map(), frames = {};
   const announce = () => { for (const peer of peers.values()) peer.send(JSON.stringify({ global: 'clients', value: [...peers.keys()] })); };
   const join = async (page, id) => {
      frames[id] = [];
      await page.routeWebSocket(socketURL, socket => {
         peers.set(id, socket);
         socket.send(JSON.stringify({ type: 'welcome', clientID: id }));
         announce();
         socket.onMessage(data => {
            if (typeof data === 'string') frames[id].push(data);
            for (const [other, peer] of peers) if (other !== id) peer.send(data);
         });
         socket.onClose(() => { if (peers.get(id) === socket) { peers.delete(id); announce(); } });
      });
   };
   return { join, frames };
};

// One page: errors (a page error is always one; a console error only if it is not the 404 of a missing .json file, which
// the app's own storage load asks for), the routes that keep the repository untouched, and the lines sent to /log.
// (`real` leaves the layout and the module files to the server: the repository's own demo, read and never written.)
const makePage = async (browser, relay, id, name, { real = false, ...options } = {}) => {
   const page = await browser.newPage({ viewport: { width: 640, height: 480 }, ...options });
   page.setDefaultTimeout(20000);
   const rec = { page, id, name, errors: [], logs: [], saves: [] };
   // (The two page errors that the app itself throws with no camera and no model in the headless browser, matched whole.)
   page.on('pageerror', e => { if (!['Empty gltf model', 'Requested device not found'].includes(e.message)) rec.errors.push(`${name}: ${e.message}\n${String(e.stack || '').split('\n').slice(0, 6).join('\n')}`); });
   page.on('console', m => {
      if (m.type() !== 'error') return;
      if (/404/.test(m.text()) && /\.json(\?|$)/.test(m.location().url || '')) return;
      if (/^(Empty gltf model|Failed to acquire camera feed|Requested device not found)/.test(m.text())) return;   // the app's own, with no camera or model here
      rec.errors.push(`${name}: ${m.text()} (${JSON.stringify(m.location())})`);
   });
   page.on('request', r => { if (r.method() === 'POST' && !POSTS.has(new URL(r.url()).pathname)) rec.errors.push(`${name}: unexpected POST ${r.url()}`); });
   await relay.join(page, id);
   await page.route('**/api/saveScene', async route => {
      let body;
      try { body = JSON.parse(route.request().postData() || '{}'); } catch { body = { unreadable: true }; }
      rec.saves.push({ ...body, at: performance.now() });
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
   });
   await page.route('**/set', route => route.fulfill({ status: 200, contentType: 'text/plain', body: '' }));
   if (!real) {
      await page.route('**/js/scenes/rails/data/layout.js*', route => route.fulfill({ status: 200, contentType: 'text/javascript', body: LAYOUT }));
      await page.route('**/js/scenes/rails/modules/*.js*', route => {
         const m = /modules\/([a-z0-9_]+)\.js/.exec(route.request().url());
         if (m && MODULES.has(m[1])) route.fulfill({ status: 200, contentType: 'text/javascript', body: MODULES.get(m[1]) });
         else route.fulfill({ status: 404, body: '' });
      });
   }
   await page.route('**/log', async route => {
      const m = /rails (\{.*\})/.exec(route.request().postData() || '');
      if (m) rec.logs.push(JSON.parse(m[1]));
      await route.fulfill({ status: 200, contentType: 'text/plain', body: '' });
   });
   return rec;
};

const run = (rec, f, a) => rec.page.evaluate(f, a);
// A page error is printed in full (page, message, stack or location) before the assertion fails, so that a flake can be diagnosed.
const noPageErrors = rec => {
   if (rec.errors.length) console.error(`PAGE ERRORS of ${rec.name} at ${new Date().toISOString()}:\n` + JSON.stringify(rec.errors, null, 1));
   assert.deepEqual(rec.errors, [], rec.name + ' had no page errors');
};
// Network effects and the Worker need frames, and the headless browser draws slowly: wait for them, never a fixed time.
// A wait that runs out is a failure, with what was waited for.
const until = async (rec, f, a, tries = 300) => {
   for (let n = 0; n < tries; n++) { const v = await run(rec, f, a); if (v) return v; await rec.page.waitForTimeout(100); }
   throw new Error(`${rec.name} never became: ${f}`);
};
const untilLog = async (rec, test, tries = 150) => {
   for (let n = 0; n < tries; n++) { const l = rec.logs.find(test); if (l) return l; await rec.page.waitForTimeout(100); }
   throw new Error(`${rec.name}: no log line like ${test}: ${JSON.stringify(rec.logs.map(l => [l.ev, l.role, l.mutual]))}`);
};
const untilSave = async (rec, test, tries = 150) => {
   for (let n = 0; n < tries; n++) { const s = rec.saves.find(test); if (s) return s; await rec.page.waitForTimeout(100); }
   throw new Error(`${rec.name}: no save like ${test}: ${JSON.stringify(rec.saves.map(s => s.path))}`);
};
// The value of f once it has been the same three times, 400 ms apart.
const stable = async (rec, f) => {
   let last, same = 0;
   for (let n = 0; n < 100; n++) {
      const v = JSON.stringify(await run(rec, f));
      same = v === last ? same + 1 : 0; last = v;
      if (same >= 3) return JSON.parse(v);
      await rec.page.waitForTimeout(400);
   }
   throw new Error(`${rec.name}: ${f} never settled (${last})`);
};
// n animation frames of the page (the scene runs its frame, and its Link receives what the relay brought, in each).
const frames = (rec, n = 6) => run(rec, n => new Promise(done => { let k = 0; const f = () => ++k >= n ? done() : requestAnimationFrame(f); f(); }), n);

const channels = rec => run(rec, () => new Set(window.txtrChannel).size);
const canvases = rec => run(rec, () => Object.keys(window._canvas_txtr || {}).length);
const open = async (rec, url, role) => {
   const u = new URL(url.href);
   if (role) u.searchParams.set('railsRole', role);
   await rec.page.goto(u.href);
   await until(rec, () => window.clientID !== undefined && window.clients?.length > 0);
};
const scene = async (rec, name) => {
   await rec.page.getByText(name, { exact: true }).click();
   await rec.page.evaluate(() => document.querySelector('details')?.removeAttribute('open'));
};
// Opens the page on the rails scene; its Link's receive is wrapped to keep [sender, type] of everything the page hears.
const enter = async (rec, url, role) => {
   await open(rec, url, role);
   await scene(rec, 'rails');
   await until(rec, () => window.railsDebug?.role);
   await run(rec, () => {
      window.RX = [];
      const link = railsDebug.link, receive = link.receive.bind(link);
      link.receive = (m, sender) => { RX.push([sender, m && m.type]); return receive(m, sender); };
   });
};
const heard = (rec, sender, type) => run(rec, ([s, t]) => RX.filter(x => x[0] === s && x[1] === t).length, [sender, type]);

// What a page shows of the state that a stray message must not change.
const state = rec => run(rec, () => {
   const d = railsDebug, s = d.seen;
   return JSON.stringify({ role: d.role, mutual: d.link.mutual, peer: d.link.peer && { id: d.link.peer.id, epoch: d.link.peer.epoch, role: d.link.peer.role },
      rails: Object.entries(s.rails).sort().map(([id, r]) => [id, r.kind, r.pubs, r.subs]), modules: Object.keys(s.modules).sort(), ide: Object.keys(d.ide.debug).sort(),
      errors: d.errors, rx: d.link.stats.rx, keys: d.terminal.keys, refused: d.terminal.refused, sent: d.terminal.sent });
});

// The stray client: a page of the app that never enters the scene but has a Link of its own (the same code), which only talks:
// it is not fed what it hears, so it never says that it hears a peer (its hellos have `peer: null`).
const strayJoin = async (rec, url) => {
   await open(rec, url);
   await run(rec, async () => {
      const { Link } = await import('/js/scenes/rails/link.js');
      server.init('railsLink', {}, { accumulate: true });
      const link = new Link({ id: () => window.clientID, clients: () => window.clients || [], now: () => performance.now(),
         send: m => server.send('railsLink', m), rank: 1, caps: { mac: false } });
      window.S = { link };
      setInterval(() => { server.sync('railsLink', () => {}); link.tick(); }, 30);
   });
};
const IN = 7, CMD = 2;   // what strayTalk sends: six keys and a paste, two commands
const strayTalk = async rec => {
   const sent = await run(rec, () => {
      const mods = { c: false, a: false, s: false, m: false }, L = S.link, out = [];
      for (const key of ['a', 'b', 'Enter']) { out.push(L.sendIn({ k: 'key', d: 'down', key, code: key, mods, rep: false })); out.push(L.sendIn({ k: 'key', d: 'up', key, code: key, mods, rep: false })); }
      out.push(L.sendIn({ k: 'paste', text: 'use evil evil' }));
      out.push(L.sendCmd({ id: 9001, op: 'use', module: 'evil', port: 'x', variable: 'evil' }));
      out.push(L.sendCmd({ id: 9002, op: 'addModule', module: 'evil', source: 'const S = state({});' }));
      return out;
   });
   assert.equal(sent.length, IN + CMD);
   assert.ok(sent.every(x => x === true), 'the stray\'s messages are well formed (so the pages must ignore them by role): ' + JSON.stringify(sent));
};
const noEvil = async rec => assert.ok(!(await run(rec, () => 'evil' in railsDebug.seen.rails || 'evil' in railsDebug.seen.modules)), `${rec.name}: no evil variable or module`);

(async () => {
   const url = new URL(process.env.XR_TEST_URL || 'http://localhost:2026/');
   const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
   const pages = [];
   const keep = rec => { pages.push(rec); return rec; };
   const close = async list => { for (const rec of list) { await rec.page.close(); pages.splice(pages.indexOf(rec), 1); } };
   try {
      // ---- A: a stray says hello to a runtime that is alone, then keys and commands: the pairing is not mutual ----------
      const relay = makeRelay(url);
      const rt = keep(await makePage(browser, relay, 0, 'runtime'));
      await enter(rt, url, 'runtime');
      assert.deepEqual(await run(rt, () => [railsDebug.role, railsDebug.rank, railsDebug.link.mutual]), ['runtime', 1, false]);
      await until(rt, () => railsDebug.host && railsDebug.host.stats.beats > 3);
      const lone = keep(await makePage(browser, relay, 2, 'stray'));
      await strayJoin(lone, url);
      await until(rt, () => window.clients.length === 2);
      await until(rt, () => RX.some(x => x[0] === 2 && x[1] === 'hello'));
      await until(rt, () => railsDebug.link.peer?.id === 2);   // the runtime took the stranger for its peer: it heard a hello first
      assert.equal(await run(rt, () => railsDebug.link.mutual), false, 'but the stranger does not hear it, so it is not a pairing');
      await strayTalk(lone);
      await until(rt, ([i, c]) => RX.filter(x => x[0] === 2 && x[1] === 'in').length >= i && RX.filter(x => x[0] === 2 && x[1] === 'cmd').length >= c, [IN, CMD]);
      await frames(rt);
      assert.equal(await run(rt, () => railsDebug.link.stats.rx), 0, 'no `in` of a peer that is not mutual is taken');
      assert.deepEqual(await run(rt, () => [railsDebug.terminal.keys, railsDebug.errors]), [0, 0]);
      await noEvil(rt);
      assert.equal(rt.saves.length, 0, 'nothing was saved');
      await close([lone]);

      // ---- B: the IDE joins, they pair ----------------------------------------------------------------------------------
      const ide = keep(await makePage(browser, relay, 1, 'ide'));
      await enter(ide, url, 'ide');
      assert.deepEqual(await run(ide, () => [railsDebug.role, railsDebug.rank]), ['ide', 1]);
      await until(rt, () => railsDebug.link.mutual && railsDebug.link.peer.id === 1);
      await until(ide, () => railsDebug.link.mutual);
      assert.equal(await run(ide, () => railsDebug.link.peer.id), 0, 'the IDE\'s peer is the runtime');
      assert.equal(await run(rt, () => railsDebug.link.peer.role), 'ide');
      await until(rt, () => railsDebug.snap);
      await until(ide, () => Object.keys(railsDebug.seen.rails).length > 0);
      assert.equal(await run(rt, () => railsDebug.host.stats.workerErrors), 0, 'no Worker error');
      assert.equal(await run(rt, () => railsDebug.host.stats.stopped), false);
      assert.equal(await run(ide, () => railsDebug.host), null, 'the IDE page has no runtime host');
      assert.ok(await run(rt, () => /Keep this window visible/.test(document.body.innerText)), 'the laptop shows its HUD');
      assert.ok(await run(ide, () => !/Keep this window visible/.test(document.body.innerText)), 'the IDE page has no laptop HUD');
      assert.equal(rt.page.workers().length, 1, 'one Worker on the runtime page');
      assert.equal(ide.page.workers().length, 0, 'and none on the IDE page');
      // A key on the paired laptop reaches the IDE as an `in`.
      const rx = await run(ide, () => railsDebug.link.stats.rx);
      await rt.page.keyboard.press('KeyA');
      await until(ide, rx => railsDebug.link.stats.rx > rx, rx);
      assert.ok(await run(rt, () => railsDebug.terminal.sent > 0), 'the laptop sent the key');

      // A stray again, with the pair in place: every message reaches both pages' Link and changes nothing.
      const stray = keep(await makePage(browser, relay, 2, 'stray'));
      await strayJoin(stray, url);
      for (const rec of [rt, ide]) await until(rec, () => window.clients.length === 3);
      await until(stray, () => window.clients.length === 3);
      await until(rt, () => RX.some(x => x[0] === 2 && x[1] === 'hello'));
      await until(ide, () => RX.some(x => x[0] === 2 && x[1] === 'hello'));
      const before = [await state(rt), await state(ide)];
      // (What each page had heard of the stranger before: RX is cumulative over the page's life, so wait for the new ones.)
      const heardOf = rec => run(rec, () => ({ in: RX.filter(x => x[0] === 2 && x[1] === 'in').length, cmd: RX.filter(x => x[0] === 2 && x[1] === 'cmd').length }));
      const heard0 = [await heardOf(rt), await heardOf(ide)];
      await strayTalk(stray);
      for (const [n, rec] of [rt, ide].entries()) {
         await until(rec, ([i, c]) => RX.filter(x => x[0] === 2 && x[1] === 'in').length >= i && RX.filter(x => x[0] === 2 && x[1] === 'cmd').length >= c, [heard0[n].in + IN, heard0[n].cmd + CMD]);
         await frames(rec);
      }
      assert.equal(await state(rt), before[0], 'the runtime page is unchanged by the stranger');
      assert.equal(await state(ide), before[1], 'the IDE page is unchanged by the stranger');
      for (const rec of [rt, ide]) await noEvil(rec);
      assert.equal(await run(rt, () => railsDebug.link.peer.id), 1, 'the runtime keeps its IDE');
      assert.equal(await run(ide, () => railsDebug.link.peer.id), 0, 'and the IDE its runtime');
      assert.equal(rt.saves.length + ide.saves.length, 0, 'nothing was saved');
      await close([stray]);

      // The paired IDE's own commands work. A module with an output (a variable), then others: a good commit is saved after about a second (60 beats of
      // the Worker) and not before; a module whose source loops for ever gets the Worker killed and started again.
      await run(ide, () => {
         window.ACKS = []; window.NOTICES = [];
         railsDebug.link.on('ack', m => ACKS.push({ ...m, at: Date.now() }));
         railsDebug.link.on('snap', m => { for (const n of m.snap.notices || []) if (!NOTICES.some(x => x.id === n.id)) NOTICES.push(n); });
      });
      const send = c => run(ide, c => railsDebug.link.sendCmd(c), c);
      const acked = id => until(ide, id => ACKS.find(a => a.cmd === id), id).then(() => run(ide, id => ACKS.find(a => a.cmd === id), id));
      // The layout is saved after a structure change: the card is in it, with the v2 fields and no rails or docks.
      const sent10 = performance.now();
      await send({ id: 5010, op: 'addModule', module: 'good1', source: GOOD });
      const a10 = await acked(5010);
      assert.equal(a10.ok, true, a10.reason);
      await until(rt, () => railsDebug.seen.rails.good);
      await until(ide, () => railsDebug.seen.rails.good);
      const layout = await untilSave(rt, s => s.path === 'js/scenes/rails/data/layout.js' && /good1/.test(s.contents));
      assert.match(layout.contents, /^export default \{/);
      assert.deepEqual(Object.keys(JSON.parse(layout.contents.replace(/^export default /, '').replace(/;\s*$/, ''))).sort(), ['cards', 'unplugged', 'uses']);

      // (The time of each save is measured from the moment the command was SENT: the ack's time is when the IDE page's frame loop read it, which
      // on a loaded software GPU can be a second later than the runtime acted, and a save made before that would show as negative.)
      const s10 = await untilSave(rt, s => s.path === 'js/scenes/rails/modules/good1.js');
      assert.equal(s10.contents, GOOD);
      assert.ok(s10.at - sent10 >= 700, `saved ${s10.at - sent10} ms after the command was sent (its ack was read ${a10.at - sent10} ms after), not a second`);
      const sent11 = performance.now();
      await send({ id: 5011, op: 'commit', module: 'good1', source: GOOD2 });
      const a11 = await acked(5011);
      assert.equal(a11.ok, true, a11.reason);
      const s11 = await untilSave(rt, s => s.path === 'js/scenes/rails/modules/good1.js' && s.contents === GOOD2);
      assert.ok(s11.at - sent11 >= 700, `the commit was saved ${s11.at - sent11} ms after it was sent (its ack was read ${a11.at - sent11} ms after)`);
      assert.equal(rt.saves.filter(s => s.path === 'js/scenes/rails/modules/good1.js' && s.at < sent11 + 700).length, 1, 'the commit was not saved at once');
      await until(ide, () => railsDebug.seen.modules.good1 === 'ok');

      // A real hang.
      await send({ id: 5012, op: 'addModule', module: 'hang', source: HANG_OK });
      assert.equal((await acked(5012)).ok, true);
      await untilSave(rt, s => s.path === 'js/scenes/rails/modules/hang.js' && s.contents === HANG_OK);
      const w0 = await run(rt, () => ({ restarts: railsDebug.host.stats.restarts, beats: railsDebug.host.stats.beats }));
      await send({ id: 5013, op: 'commit', module: 'hang', source: HANG });
      await until(rt, n => railsDebug.host.stats.restarts > n, w0.restarts, 150);
      assert.equal(await run(rt, () => railsDebug.host.stats.restarts), w0.restarts + 1, 'the Worker was restarted once');
      const b1 = await run(rt, () => railsDebug.host.stats.beats);
      await until(rt, n => railsDebug.host.stats.beats > n + 20, b1, 100);
      assert.equal(await run(rt, () => railsDebug.host.stats.stopped), false, 'the beats are back');
      for (let n = 0; n < 50 && rt.page.workers().length !== 1; n++) await rt.page.waitForTimeout(100);
      assert.equal(rt.page.workers().length, 1, 'one Worker again (the other was terminated)');
      // The IDE page is told: a failure for the commit or the restart notice, and the module is quarantined.
      await until(ide, () => ACKS.some(a => a.cmd === 5013 && a.ok === false) || NOTICES.some(n => /hung|restart|quarantin/i.test(n.text)));
      await until(ide, () => railsDebug.seen.modules.hang === 'quarantined');
      assert.equal(await run(ide, () => railsDebug.seen.modules.good1), 'ok', 'the other module runs again');
      assert.ok(await run(rt, () => railsDebug.snap), 'the runtime has a snapshot again');
      await rt.page.waitForTimeout(2500);   // longer than the settling time of a commit: the hanging source would be saved by now
      assert.ok(!rt.saves.some(s => /for \(;;\)/.test(s.contents || '')), 'the hanging source is never saved');
      assert.equal(rt.saves.filter(s => s.path === 'js/scenes/rails/modules/hang.js').at(-1).contents, HANG_OK, 'hang.js is still the good source');
      // The runtime goes on: another module's commit is acked and saved.
      await send({ id: 5014, op: 'commit', module: 'good1', source: GOOD3 });
      assert.equal((await acked(5014)).ok, true);
      await untilSave(rt, s => s.path === 'js/scenes/rails/modules/good1.js' && s.contents === GOOD3);

      // ---- B2: the IDE itself ------------------------------------------------------------------------------------------------
      // The laptop's keyboard (page.keyboard on the runtime page) goes through the terminal and the Link into the IDE page,
      // whose core types it into the focused card. Focus is set by `railsDebug.setFocus(slot)` (the page has no headset: the
      // test holds the gaze on the card); the real gaze dwell is covered in Node.
      assert.equal(await run(ide, () => railsDebug.owned.length), 7, 'the IDE has its five card textures, the timeline\'s and the bus window\'s');
      await until(ide, () => railsDebug.ide.test.ws, null, 100);
      const addCard = async (id, name, source) => {
         assert.equal(await send({ id, op: 'addModule', module: name, source }), true);
         assert.equal((await acked(id)).ok, true);
         await until(ide, n => railsDebug.ide.test.card(n)?.loaded, name);
      };
      const text = id => run(ide, id => railsDebug.ide.test.text(id), id);
      const focusOn = async id => {
         const slot = await run(ide, id => railsDebug.ide.test.card(id).slot, id);
         await run(ide, s => railsDebug.setFocus(s), slot);
         await until(ide, id => railsDebug.ide.debug.focus === id, id);
      };
      const cardRow = id => run(ide, id => railsDebug.ide.debug.cards.find(c => c[0] === id), id);
      const card = id => run(ide, id => { const c = railsDebug.ide.test.card(id); return c && { status: c.status, error: c.error, editError: c.editError, calls: c.calls, ports: c.ports, ver: c.ver }; }, id);
      // Where the gaze is held: a world point (the head's ray goes from the workspace origin through it), or looking at nothing (up).
      const aimWorld = p => run(ide, p => {
         const o = [...railsDebug.ide.test.ws.origin], d = [p[0] - o[0], p[1] - o[1], p[2] - o[2]], l = Math.hypot(...d);
         railsDebug.ide.test.aim({ o, d: d.map(x => x / l) });
      }, p);
      const aimAway = () => run(ide, () => railsDebug.ide.test.aim({ o: [...railsDebug.ide.test.ws.origin], d: [0, 0.6, -0.8] }));
      const where = spec => run(ide, spec => import('/js/scenes/rails/layout.js').then(L => {
         const ws = railsDebug.ide.test.ws;
         return spec.plug != null ? L.plugWorld(ws, spec.plug) : L.cylPoint(ws, 0, L.BUS.y);
      }), spec);
      const aimPlug = async slot => aimWorld(await where({ plug: slot }));
      const aimBus = async () => aimWorld(await where({}));
      const view = f => run(ide, f);

      // 1. 200 typed characters land in that card's buffer and in no other.
      await addCard(5020, 'ticker', TICK);
      await addCard(5021, 'typed', '');
      const others = { good1: await text('good1'), ticker: await text('ticker') };
      await focusOn('typed');
      await rt.page.keyboard.type(TYPED);
      await until(ide, ([id, t]) => railsDebug.ide.test.text(id) === t, ['typed', TYPED]);
      assert.equal(TYPED.length, 200);
      assert.equal(await text('typed'), TYPED, 'the buffer is what was typed');
      assert.equal(await text('good1'), others.good1, 'the other buffers are unchanged'); assert.equal(await text('ticker'), others.ticker);
      assert.deepEqual(await cardRow('typed'), ['typed', 'edited', true]);

      // 2. Mod+Enter (Ctrl on this laptop) commits: the runtime's source is the text, and the save carries path and text.
      const t0 = performance.now();
      await rt.page.keyboard.press('Control+Enter');
      const saved = await untilSave(rt, s => s.path === 'js/scenes/rails/modules/typed.js' && s.contents === TYPED);   // (the empty card was saved when it was added)
      assert.equal(saved.contents, TYPED, 'the save body has the text');
      console.log(`typed 200 characters, committed: saved ${saved.at - t0} ms after Ctrl+Enter`);
      assert.ok(saved.at - t0 >= 700, `saved ${saved.at - t0} ms after the key: not before the Worker has kept beating`);
      await until(ide, ([id, t]) => railsDebug.ide.test.running(id) === t, ['typed', TYPED]);   // the runtime's source, as the snapshot says
      await until(ide, () => railsDebug.ide.debug.cards.find(c => c[0] === 'typed')[2] === false);
      assert.deepEqual(await cardRow('typed'), ['typed', 'running', false]);

      // 3. A syntax error turns that card `error`, while another module's calls keep rising.
      await addCard(5022, 'broken', '');
      await focusOn('broken');
      await rt.page.keyboard.type('}{');
      await rt.page.keyboard.press('Control+Enter');
      await until(ide, () => railsDebug.ide.debug.cards.find(c => c[0] === 'broken')[1] === 'error');
      assert.ok((await card('broken')).editError, 'the compile error is on the card');
      assert.equal((await cardRow('broken'))[2], true, 'its buffer is still dirty');
      const calls = (await card('ticker')).calls;
      await until(ide, n => railsDebug.ide.test.card('ticker').calls > n + 30, calls);
      assert.equal((await card('ticker')).status, 'ok');
      assert.equal((await cardRow('typed'))[1], 'running', 'and the good one is untouched');
      // (The cylinder has five slots: make room.)
      assert.equal(await send({ id: 5024, op: 'rmModule', module: 'broken' }), true);
      assert.equal((await acked(5024)).ok, true);
      await until(ide, () => !railsDebug.ide.test.card('broken'));

      // 4. A committed `while (true) {}`: the Worker is restarted within 3 s, the module is quarantined as hung, the others run again, and
      // that source is never saved.
      await addCard(5023, 'looper', '');
      await untilSave(rt, x => x.path === 'js/scenes/rails/modules/looper.js');   // it has an earlier version, which is what a restart runs for it
      await focusOn('looper');
      await rt.page.keyboard.type('while (true) {}');
      await until(ide, () => railsDebug.ide.test.text('looper') === 'while (true) {}');
      const r0 = await run(rt, () => railsDebug.host.stats.restarts), h0 = performance.now();
      await rt.page.keyboard.press('Control+Enter');
      await until(rt, n => railsDebug.host.stats.restarts > n, r0, 30);
      const took = performance.now() - h0;
      assert.ok(took < 3000, `the Worker restarted ${took} ms after the commit`);
      console.log(`typed while (true) {}: the Worker restarted ${took} ms after the commit`);
      await until(ide, () => railsDebug.ide.test.card('looper').status === 'quarantined');
      assert.match((await card('looper')).error.message, /hung/);
      assert.equal((await cardRow('looper'))[2], true, 'a failure after a restart is an unknown outcome: the buffer stays dirty');
      assert.equal(await run(ide, () => railsDebug.ide.test.pending.length), 0, 'and nothing waits for an ack');
      const c1 = (await card('ticker')).calls;
      await until(ide, n => railsDebug.ide.test.card('ticker').calls > n + 20, c1);   // the others' calls rise again
      assert.equal((await card('ticker')).status, 'ok');
      await rt.page.waitForTimeout(2200);   // longer than the settling time of a commit
      assert.ok(!rt.saves.some(x => /while \(true\)/.test(x.contents || '')), 'no save request carries that source');

      // 5. A trackpad press with the gaze on a card's plug holds it: a release off the bus unplugs the card (its variable `good`, which nobody takes,
      // is swept), a release on the bus plugs it again. Neither press is the pointer's.
      const plugSlot = await run(ide, () => railsDebug.ide.test.card('good1').slot);
      const unplugged = () => view(() => railsDebug.ide.test.view.unplugged.slice());
      assert.deepEqual(await unplugged(), [], 'every card is plugged');
      await aimPlug(plugSlot);
      await rt.page.mouse.move(60, 60); await rt.page.mouse.down();
      await until(ide, () => railsDebug.ide.test.view.plugGrab && railsDebug.ide.test.view.plugGrab.card === 'good1');
      assert.deepEqual(await run(ide, () => railsDebug.ide.test.held.buttons), ['left']);
      assert.equal(await run(rt, () => railsDebug.host.stats.pointer.down), false, 'a press on a plug is not pointer_down');
      await aimAway();
      await frames(ide);
      await rt.page.mouse.up();
      await until(ide, () => railsDebug.ide.test.view.unplugged.includes('good1'));
      assert.deepEqual(await run(ide, () => railsDebug.ide.test.held), { buttons: [], keys: [] });
      await until(ide, () => !railsDebug.ide.test.rails.good);   // (nobody takes it: with no port docked a variable is swept)
      assert.equal((await run(ide, () => railsDebug.ide.test.bus)).unplugged, 1);
      await aimPlug(plugSlot);
      await rt.page.mouse.down();
      await until(ide, () => railsDebug.ide.test.view.plugGrab);
      await aimBus();
      await frames(ide);
      await rt.page.mouse.up();
      await until(ide, () => railsDebug.ide.test.view.unplugged.length === 0 && (railsDebug.ide.test.rails.good.pubs || []).some(p => p[0] === 'good1'));
      assert.equal(await run(rt, () => railsDebug.host.stats.pointer.down), false);

      // 6. A button pressed on a plug, then the laptop window loses focus: `held` is empty, the grab is cancelled, nothing is plugged or
      // unplugged, and the focused card says the keyboard is lost.
      await focusOn('typed');
      await aimPlug(plugSlot);
      await rt.page.mouse.down();
      await until(ide, () => railsDebug.ide.test.view.plugGrab);
      assert.equal((await run(ide, () => railsDebug.ide.test.held.buttons.length)), 1);
      await run(rt, () => window.dispatchEvent(new Event('blur')));
      await until(ide, () => !railsDebug.ide.test.view.plugGrab);
      assert.deepEqual(await run(ide, () => railsDebug.ide.test.held), { buttons: [], keys: [] });
      assert.equal(await run(ide, () => railsDebug.ide.test.kbLost), true, 'the card shows "keyboard lost focus"');
      const rx1 = await run(ide, () => railsDebug.link.stats.rx);
      await rt.page.mouse.up();
      await until(ide, n => railsDebug.link.stats.rx > n, rx1);   // the release has reached the IDE (a grab is not cancelled, nothing is waiting for it)
      await frames(ide, 10);
      assert.deepEqual(await unplugged(), [], 'the card was not unplugged by the cancelled grab');
      assert.ok((await run(ide, () => railsDebug.ide.test.rails.good.pubs)).some(p => p[0] === 'good1'));
      // A press that is not on a plug is the pointer's.
      // (A press takes a plug that was the target within the last 0.2 s, so the gaze has to have been off the plug for a moment.)
      await focusOn('typed');
      await until(ide, () => railsDebug.ide.test.view.gaze.kind !== 'plug'); await ide.page.waitForTimeout(300);
      await rt.page.mouse.down();
      await until(rt, () => railsDebug.host.stats.pointer.down === true);
      await rt.page.mouse.up();
      await until(rt, () => railsDebug.host.stats.pointer.down === false);
      // ...and so is a blur while it is down.
      await rt.page.mouse.down();
      await until(rt, () => railsDebug.host.stats.pointer.down === true);
      await run(rt, () => window.dispatchEvent(new Event('blur')));
      await until(rt, () => railsDebug.host.stats.pointer.down === false);
      await rt.page.mouse.up();

      // 7. A key that is 3 s old after a stall is dropped; the next one is typed.
      await focusOn('typed');
      const stale0 = await run(ide, () => railsDebug.link.stats.stale), before3 = await text('typed');
      await run(rt, () => {
         const L = railsDebug.link, was = L.now;
         L.now = () => was() - 3000;
         L.sendIn({ k: 'key', d: 'down', key: 'Z', code: 'KeyZ', mods: { c: false, a: false, s: false, m: false }, rep: false });
         L.now = was;
      });
      await until(ide, n => railsDebug.link.stats.stale > n, stale0);
      await frames(ide);
      assert.equal(await text('typed'), before3, 'the old key is not typed');
      await rt.page.keyboard.type('ok');
      await until(ide, t => railsDebug.ide.test.text('typed') === t + 'ok', before3);

      // 8. The log line carries names and counts: the focus, the cards with their states, and none of the text.
      await run(ide, () => { railsDebug.report('check'); });
      const mine = await untilLog(ide, l => l.ev === 'check' && l.cards.length >= 5);
      assert.equal(typeof mine.focus, 'string');
      assert.ok(mine.cards.some(c => c[0] === 'typed' && c[2] === true) && mine.cards.some(c => c[0] === 'looper' && c[1] === 'quarantined'), JSON.stringify(mine.cards));
      assert.ok(mine.rails.some(r => r[0] === 'good' && r[1] === 'state'), JSON.stringify(mine.rails));
      const everything = JSON.stringify([ide.logs, rt.logs]);
      assert.ok(!everything.includes(TYPED.slice(3, 40)) && !everything.includes('while (true)') && !everything.includes('const S = state'), 'no typed text or source in any log line');
      for (const rec of [rt, ide]) assert.equal(await run(rec, () => railsDebug.errors), 0, rec.name + ' counted no frame errors in B2');

      // /log: each role says its role, at the start and with the first tick that has a mutual pairing.
      for (const rec of [rt, ide]) {
         const start = await untilLog(rec, l => l.ev === 'start');
         assert.equal(start.role, rec.name);
         const tick = await untilLog(rec, l => l.ev === 'tick' && l.mutual);
         assert.equal(tick.role, rec.name); assert.equal(tick.v, 1);
         assert.equal(typeof tick.fps, 'number');
         assert.deepEqual(Object.keys(tick).sort(), ['cards', 'errors', 'ev', 'focus', 'fps', 'input', 'lastError', 'mutual', 'peer', 'perf', 'rails', 'rank', 'rec', 'role', 'rtt', 'saves', 'v', 'worker']);
         assert.equal(tick.peer.live, true);
         assert.ok(rec.logs.every(l => l.role === rec.name), 'every line of the page says its role: ' + JSON.stringify(rec.logs.map(l => l.role)));
      }
      const tickRt = rt.logs.find(l => l.ev === 'tick' && l.mutual);
      console.log('log line: rails ' + JSON.stringify(tickRt));

      // ---- B2b: the bus by name -------------------------------------------------------------------------------------------------
      // The ticker publishes `out` (a state variable) and good1 publishes `good`. Cards are added and changed with the IDE's own commands
      // (the link) and with the command line of the laptop's keyboard; what the IDE shows is read from its inspector.
      {
         const rpc = (id, c) => send({ id, ...c }).then(ok => { assert.equal(ok, true); return acked(id); }).then(a => { assert.equal(a.ok, true, a.reason); });
         for (const [id, name] of [[5100, 'typed'], [5101, 'looper']]) { await rpc(id, { op: 'rmModule', module: name }); await until(ide, n => !railsDebug.ide.test.card(n), name); }
         // `late` takes `x`, which nobody publishes: it waits. Then `use x out` binds it, and the first delivery says the value was retained.
         const LATE = "const x = input('x', 'state', 'any');\nconst time = input('time', 'state', 'time');\nconst S = state({ r: -1 });\n" +
            "x.on((v, m) => { if (S.r < 0) S.r = m.retained ? 1 : 0; draw([{ shape: 'sphere', p: [S.r * .1, 0, 0], s: .01, color: '#ffffff' }]); });\n";
         const REN = "const time = input('time', 'state', 'time');\nconst a = input('a', 'state', 'any');\nconst b = input('b', 'state', 'any');\n";
         const REN2 = "const time = input('time', 'state', 'time');\nconst a2 = input('a2', 'state', 'any');\nconst b = input('b', 'state', 'any');\n";
         await addCard(5105, 'late', LATE);
         await addCard(5106, 'ren', REN);
         const binding = (id, port) => run(ide, ([id, port]) => railsDebug.ide.test.card(id).bindings.find(b => b.port === port), [id, port]);
         const line = async text => { await rt.page.keyboard.press('Escape'); await rt.page.keyboard.type(text); await rt.page.keyboard.press('Enter'); };
         const toasts = () => run(ide, () => railsDebug.ide.test.toasts);
         await aimAway();

         // 1. An input of a variable that does not exist waits: unbound, with the reason; its time input is bound by name.
         await until(ide, () => railsDebug.ide.test.card('late').bindings.length >= 2);
         const waiting = await binding('late', 'x');
         assert.deepEqual([waiting.variable, waiting.isDefault, waiting.bound], ['x', true, false]);
         assert.match(waiting.reason, /./, 'the reason it waits is given: ' + waiting.reason);
         assert.deepEqual([(await binding('late', 'time')).variable, (await binding('late', 'time')).bound], ['time', true]);
         assert.equal(await run(ide, () => railsDebug.ide.test.card('late').draw.length), 0, 'nothing delivered yet');

         // 2. `use x out` (typed on the laptop, for the focused card): bound at once; the value the ticker has is delivered as retained.
         await focusOn('late');
         await line('use x out');
         await until(ide, () => railsDebug.ide.test.card('late').bindings.find(b => b.port === 'x').variable === 'out');
         const b = await binding('late', 'x');
         assert.deepEqual([b.isDefault, b.bound], [false, true]);
         await until(ide, () => railsDebug.ide.test.card('late').draw.length === 1);
         assert.equal(await run(ide, () => railsDebug.ide.test.card('late').draw[0].p[0]), 0.1, 'the first value was `retained`');
         assert.deepEqual(await run(rt, () => railsDebug.snap.uses), { 'late.x': 'out' }, 'the runtime says what points where');
         await untilSave(rt, s => s.path === 'js/scenes/rails/data/layout.js' && /"late.x": "out"/.test(s.contents));
         await until(ide, () => (railsDebug.ide.test.rails.out.subs || []).some(x => x[0] === 'late' && x[1] === 'x'));

         // 3. A `use` of a variable that does not exist is refused with a reason, and nothing changes.
         const sent0 = await run(ide, () => railsDebug.ide.test.stats.sent);
         await focusOn('late');
         await line('use x nosuch');
         await until(ide, () => railsDebug.ide.test.toasts.some(t => /nosuch/.test(t)));
         assert.equal((await binding('late', 'x')).variable, 'out', 'the input is as it was');
         assert.equal(await run(ide, () => railsDebug.ide.test.stats.sent) > sent0, true, 'the command was sent, and the runtime refused it');

         // 4. A reload that drops an input with a `use`: a notice, the entry goes, the other uses stay, nothing throws.
         await focusOn('ren');
         await line('use a good'); await until(ide, () => railsDebug.ide.test.card('ren').bindings.find(b => b.port === 'a').variable === 'good');
         await line('use b out'); await until(ide, () => railsDebug.ide.test.card('ren').bindings.find(b => b.port === 'b').variable === 'out');
         assert.deepEqual(await run(rt, () => railsDebug.snap.uses), { 'late.x': 'out', 'ren.a': 'good', 'ren.b': 'out' });
         await rpc(5109, { op: 'commit', module: 'ren', source: REN2 });
         await until(ide, () => railsDebug.ide.test.toasts.some(t => /the use of ren\.a \(good\) was dropped/.test(t)));
         await until(ide, () => railsDebug.ide.test.card('ren').bindings.some(b => b.port === 'a2'));
         assert.equal((await binding('ren', 'b')).variable, 'out', 'the other use stays');
         assert.equal((await binding('ren', 'a2')).variable, 'a2');
         assert.deepEqual(await run(rt, () => railsDebug.snap.uses), { 'late.x': 'out', 'ren.b': 'out' });
         for (const rec of [rt, ide]) assert.equal(await run(rec, () => railsDebug.errors), 0, rec.name + ' counted no frame errors in B2b');
         assert.equal(await run(ide, () => railsDebug.owned.length), 7, 'still the seven textures: the bus uses none');
      }

      // ---- B2c: full slots, the timeline strip, pause, scrub and play ------------------------------------------------------------------
      {
         const tl = () => run(ide, () => railsDebug.ide.test.timeline), stats = () => run(ide, () => railsDebug.ide.test.stats.sent);
         const line = async text => { await rt.page.keyboard.press('Escape'); await rt.page.keyboard.type(text); await rt.page.keyboard.press('Enter'); };
         assert.equal((await tl()).owned, 7, 'seven canvases: five cards, the timeline strip, the bus window');
         // The strip is painted again only when it changed, live at most once a second: its count over 6 s of live running.
         const painted0 = (await tl()).painted;
         await rt.page.waitForTimeout(6000);
         const rate = ((await tl()).painted - painted0) / 6;
         console.log(`timeline strip repaints: ${rate.toFixed(1)} a second while live`);
         assert.ok(rate <= 1.5, `the strip was painted ${rate} times a second while live (1 at most)`);

         // 1. Five cards: a sixth gives a notice and sends no command.
         const sent1 = await stats();
         await aimAway();
         await line('card sixth');
         await until(ide, () => railsDebug.ide.test.toasts.some(t => /all 5 card slots are taken/.test(t)));
         await frames(ide, 5);
         assert.equal(await stats(), sent1, 'the command was not sent');

         // 2. Mod+P pauses the runtime; a horizontal swipe moves the playhead and the variable values are the tape's; Mod+P resumes.
         const both = () => run(ide, () => ({ v: railsDebug.ide.test.rails.out.value, p: railsDebug.ide.test.clock.playhead, paused: railsDebug.ide.test.clock.paused }));
         await rt.page.keyboard.press('Control+p');
         await until(ide, () => railsDebug.ide.test.clock.paused === true && typeof railsDebug.ide.test.clock.playhead === 'number');
         await until(rt, () => railsDebug.snap && railsDebug.snap.paused === true);
         const paused = await stable(ide, () => { const t = railsDebug.ide.test; return [t.clock.paused, t.clock.playhead, t.rails.out.value]; });
         const [, t0, v0] = paused;
         assert.ok(Number.isInteger(v0) && v0 > 150, 'the ticker has counted: ' + v0);
         await rt.page.waitForTimeout(500);
         assert.equal((await both()).v, v0, 'paused: the value does not move');
         assert.ok((await tl()).painted >= 1);
         await rt.page.mouse.wheel(-200, 0);
         await until(ide, t => Math.abs(railsDebug.ide.test.clock.playhead - (t - 2)) < 1e-6, t0);
         await until(ide, v => railsDebug.ide.test.rails.out.value === v - 120, v0);
         assert.equal((await both()).v, v0 - 120, 'two seconds back the ticker was 120 steps behind: the value railsAt gives there');
         // A swipe forward and a huge one backward (clamped to the window).
         await rt.page.mouse.wheel(100, 0);
         await until(ide, t => Math.abs(railsDebug.ide.test.clock.playhead - (t - 1)) < 1e-6, t0);
         await until(ide, v => railsDebug.ide.test.rails.out.value === v - 60, v0);
         await rt.page.mouse.wheel(-100000, 0);
         await until(ide, () => railsDebug.ide.test.clock.playhead === railsDebug.ide.test.clock.window[0]);
         // Mod+. plays the tape from there: the playhead moves on and the values with it; again, it stops.
         await rt.page.keyboard.press('Control+.');
         const startP = (await both()).p;
         await until(ide, p => railsDebug.ide.test.clock.playhead > p + 0.3, startP);
         await rt.page.keyboard.press('Control+.');
         const still = await stable(ide, () => railsDebug.ide.test.clock.playhead);
         assert.ok(still > startP + 0.3 && still < t0, 'it stopped on the way');
         // Mod+P resumes: live again, the playhead is gone, the value runs past where it was.
         await rt.page.keyboard.press('Control+p');
         await until(ide, () => railsDebug.ide.test.clock.paused === false && railsDebug.ide.test.clock.playhead === null);
         await until(ide, v => railsDebug.ide.test.rails.out.value > v + 60, v0);
         assert.ok((await tl()).moved >= 4, 'the playhead quad moved');
         await aimAway();
         for (const rec of [rt, ide]) assert.equal(await run(rec, () => railsDebug.errors), 0, rec.name + ' counted no frame errors in B2c');
         assert.equal(await run(ide, () => railsDebug.owned.length), 7, 'still seven textures');
      }

      // ---- B2g: the paused scene is the past; continue from here ------------------------------------------------------------
      // Pause, seek back two seconds: the ball the stage draws (the ticker's list) is at the position of then, the one the recording
      // gives (from `out`, which the ticker counts), not the one at the pause; Mod+Enter while paused sends nothing and says so;
      // Mod+Shift+Enter makes the playhead the present: live again, the ticker goes on from the old count with the code of now.
      {
         const tickSlot = await run(ide, () => railsDebug.ide.test.card('ticker').slot);
         const key = k => rt.page.keyboard.press(k);
         const pauseNow = async () => {
            await key('Control+p');
            await until(ide, () => railsDebug.ide.test.clock.paused === true && typeof railsDebug.ide.test.clock.playhead === 'number');
            await until(rt, () => railsDebug.snap && railsDebug.snap.paused === true);
         };
         const live = async () => { await until(ide, () => railsDebug.ide.test.clock.paused === false && railsDebug.ide.test.clock.playhead === null); };
         // What the stage is given for the ticker (x of the ball), the count `out`, and the playhead.
         const ball = () => run(ide, () => { const v = railsDebug.ide.test.view, l = v && v.draws && v.draws.ticker; return { x: l && l[0] ? l[0].p[0] : null, n: railsDebug.ide.test.rails.out.value,
            head: railsDebug.ide.test.clock.playhead, snap: railsDebug.ide.test.card('ticker').draw[0]?.p[0] ?? null }; });
         const ballAtCount = n => (n % 100) * 0.001;
         // Two seconds of the ticker on the tape first.
         const c0 = (await card('ticker')).calls;
         await until(ide, n => railsDebug.ide.test.card('ticker').calls > n + 150, c0);
         await run(ide, s => railsDebug.setFocus(s), tickSlot);
         await until(ide, () => railsDebug.ide.debug.focus === 'ticker');
         const code = await run(ide, () => railsDebug.ide.test.running('ticker'));

         // 1. Pause: the ball sits where the pause found it.
         await pauseNow();
         const atPause = await until(ide, () => { const v = railsDebug.ide.test.view, l = v && v.draws && v.draws.ticker; return l && l[0] ? { x: l[0].p[0], n: railsDebug.ide.test.rails.out.value, head: railsDebug.ide.test.clock.playhead } : null; });
         assert.ok(Math.abs(atPause.x - ballAtCount(atPause.n)) < 0.0005, `at the pause the ball is where the count says: ${JSON.stringify(atPause)}`);
         assert.equal(await run(ide, () => railsDebug.ide.test.view.paused), true);
         // 2. Seek back two seconds: the ball goes back with the playhead (not just the number): it is where the recording had it.
         await rt.page.mouse.wheel(-200, 0);
         await until(ide, t => Math.abs(railsDebug.ide.test.clock.playhead - (t - 2)) < 1e-6, atPause.head);
         await until(ide, n => railsDebug.ide.test.rails.out.value === n - 120, atPause.n);
         await until(ide, n => { const v = railsDebug.ide.test.view, l = v && v.draws && v.draws.ticker; return !!l && !!l[0] && Math.abs(l[0].p[0] - (((n - 120) % 100) * 0.001)) < 0.0005; }, atPause.n);
         const past = await ball();
         assert.equal(past.n, atPause.n - 120, 'the recording gives the count of then');
         assert.ok(Math.abs(past.x - atPause.x) > 0.01, `the drawn ball moved from ${atPause.x} to ${past.x}: the scene went back`);
         assert.ok(Math.abs(past.x - ballAtCount(past.n)) < 0.0005 && Math.abs(past.snap - past.x) < 0.0005, `the drawn ball is the recorded past: ${JSON.stringify(past)}`);
         assert.equal(await run(ide, () => railsDebug.ide.test.stageShapes.sphere.shown >= 1), true, 'the stage draws the ball');
         // It stays there while paused (the scene does not run on).
         await rt.page.waitForTimeout(600);
         assert.equal((await ball()).x, past.x, 'paused: the past picture holds still');
         // 3. Mod+Enter while paused sends nothing and says what to do; the card is not changed.
         const sentBefore = await run(ide, () => railsDebug.ide.test.stats.sent), vBefore = await run(ide, () => railsDebug.ide.test.card('ticker').ver);
         await key('Control+Enter');
         await until(ide, () => railsDebug.ide.test.toasts.some(t => /^paused: Mod\+Shift\+Enter continues from here, Mod\+P returns to now$/.test(t)));
         assert.equal(await run(ide, () => railsDebug.ide.test.stats.sent), sentBefore, 'Mod+Enter paused sent nothing');
         assert.equal(await run(ide, () => railsDebug.ide.test.card('ticker').ver), vBefore);
         // 4. Mod+Shift+Enter: live again from the playhead, and the ticker goes on from the count of then.
         const savesBefore = rt.saves.length;
         await key('Control+Shift+Enter');
         await live();
         await until(ide, () => NOTICES.some(n => /continued from/.test(n.text)), null, 100);
         const first = await ball();
         assert.ok(first.n >= past.n && first.n < atPause.n, `live again from the old count: ${first.n} (was ${atPause.n} at the pause, ${past.n} at the playhead)`);
         await until(ide, n => railsDebug.ide.test.rails.out.value > n + 30, first.n);
         const win = await run(ide, () => railsDebug.ide.test.clock.window);
         assert.ok(win[1] - win[0] < 12, `the tape starts again at the playhead: ${win}`);
         await until(ide, () => { const v = railsDebug.ide.test.view; return v.paused === false && v.draws.ticker && v.draws.ticker[0]; });
         assert.equal(await run(ide, () => railsDebug.ide.test.running('ticker')), code, 'the code of now is kept');
         assert.deepEqual(await cardRow('ticker'), ['ticker', 'running', false]);
         assert.equal((await card('ticker')).status, 'ok');
         await rt.page.waitForTimeout(1500);
         assert.equal(rt.saves.slice(savesBefore).filter(x => x.path === 'js/scenes/rails/modules/ticker.js' && x.contents !== code).length, 0, 'the code was not changed');
         // 5. At the live end Mod+Shift+Enter says so and sends nothing.
         const sent2 = await run(ide, () => railsDebug.ide.test.stats.sent);
         await key('Control+Shift+Enter');
         await until(ide, () => railsDebug.ide.test.toasts.some(t => /live already/.test(t)));
         assert.equal(await run(ide, () => railsDebug.ide.test.stats.sent), sent2);
         for (const rec of [rt, ide]) assert.equal(await run(rec, () => railsDebug.errors), 0, rec.name + ' counted no frame errors in B2g');
      }

      // The IDE page reloads: a new epoch, mutual again, and a full snapshot (the rails and modules made before).
      const epoch = await run(rt, () => railsDebug.link.peer.epoch);
      await enter(ide, url, 'ide');
      await until(rt, e => railsDebug.link.mutual && railsDebug.link.peer.epoch !== e, epoch);
      await until(ide, () => railsDebug.link.mutual);
      await until(ide, () => railsDebug.seen.rails.good && railsDebug.seen.modules.good1 === 'ok' && railsDebug.seen.modules.hang === 'quarantined');
      assert.equal(await run(rt, () => railsDebug.link.peer.id), 1);
      for (const rec of [rt, ide]) noPageErrors(rec);
      for (const rec of [rt, ide]) assert.equal(await run(rec, () => railsDebug.errors), 0, rec.name + ' counted no frame errors');

      // ---- B3: a laptop that is a Mac: Cmd is Mod. The page's navigator.platform says MacIntel before any script runs. ---------
      await close([rt]);
      const mac = keep(await makePage(browser, relay, 0, 'runtime'));
      await mac.page.addInitScript(MAC);
      await enter(mac, url, 'runtime');
      assert.equal(await run(mac, () => navigator.platform), 'MacIntel');
      await until(mac, () => railsDebug.link.mutual && railsDebug.link.peer.id === 1);
      await until(ide, () => railsDebug.link.mutual && railsDebug.link.peer.caps.mac === true);
      await until(ide, () => railsDebug.ide.test.paired && railsDebug.ide.test.ws);
      await until(mac, () => railsDebug.host && railsDebug.host.stats.beats > 3);   // (commands before the Worker runs get no ack)
      const ids = () => run(ide, () => railsDebug.ide.test.stats.sent);
      await run(ide, () => railsDebug.link.sendCmd({ id: 7001, op: 'addModule', module: 'macmod', source: '' }));
      await until(ide, () => railsDebug.ide.test.card('macmod')?.loaded);
      const slot = await run(ide, () => railsDebug.ide.test.card('macmod').slot);
      await run(ide, s => railsDebug.setFocus(s), slot);
      await until(ide, () => railsDebug.ide.debug.focus === 'macmod');
      await mac.page.keyboard.type('// mac');
      await until(ide, () => railsDebug.ide.test.text('macmod') === '// mac');
      const sent0 = await ids(), keys0 = await run(ide, () => railsDebug.ide.test.stats.keys);
      await mac.page.keyboard.press('Control+Enter');
      await mac.page.keyboard.press('Control+Enter');
      // (Delivered first, or the check below proves nothing: Control and Enter, twice, are four key downs at the IDE.)
      await until(ide, n => railsDebug.ide.test.stats.keys >= n + 4, keys0);
      await frames(ide, 10);
      assert.equal(await ids(), sent0, 'Ctrl+Enter does nothing on a Mac');
      assert.equal((await run(ide, () => railsDebug.ide.debug.cards.find(c => c[0] === 'macmod')))[2], true, 'the buffer is still dirty');
      await mac.page.keyboard.press('Meta+Enter');
      await until(ide, () => railsDebug.ide.test.running('macmod') === '// mac');
      const macSave = await untilSave(mac, s => s.path === 'js/scenes/rails/modules/macmod.js' && s.contents === '// mac');
      assert.equal(macSave.contents, '// mac', 'Cmd+Enter committed');
      assert.equal(await ids(), sent0 + 1, 'and exactly one command was sent: the Cmd+Enter');
      assert.equal((await run(ide, () => railsDebug.ide.debug.cards.find(c => c[0] === 'macmod')))[2], false);
      for (const rec of [mac, ide]) noPageErrors(rec);
      await close([mac, ide]);

      // ---- V: the repository's own demo, by name (its layout and modules are read from the server; nothing is written) ---------------
      // oscillator publishes `target`; ball and flowers take `target` by its name, with no `uses`. The laptop page is the runtime (real mouse,
      // keyboard, wheel); the IDE page gets the gaze from the inspector (`aim`) and shows what it holds in `ide.test`.
      {
         const demo = makeRelay(url);
         const rv = keep(await makePage(browser, demo, 0, 'runtime', { real: true }));
         const iv = keep(await makePage(browser, demo, 1, 'ide', { real: true }));
         await rv.page.addInitScript(KEYSPY);
         await enter(rv, url, 'runtime');
         await enter(iv, url, 'ide');
         await until(rv, () => railsDebug.link.mutual && railsDebug.link.peer.id === 1);
         await until(iv, () => railsDebug.link.mutual);
         await until(rv, () => railsDebug.host && railsDebug.host.stats.beats > 3);
         await until(iv, () => railsDebug.ide.test.paired && railsDebug.ide.test.ws && ['oscillator', 'ball', 'flowers', 'constant'].every(id => railsDebug.ide.test.card(id)?.loaded), null, 300);
         const T = (f, a) => run(iv, f, a);
         const bindingOf = (id, port) => T(([id, port]) => railsDebug.ide.test.card(id).bindings.find(b => b.port === port), [id, port]);
         const ballTakes = variable => until(iv, v => railsDebug.ide.test.card('ball').bindings.find(b => b.port === 'target').variable === v, variable);
         const ballAt = (x, z, tol = 0.012) => until(iv, ([x, z, tol]) => { const p = railsDebug.ide.test.card('ball').draw[0]?.p; return !!p && Math.abs(p[0] - x) < tol && Math.abs(p[2] - z) < tol; }, [x, z, tol], 150);
         const line = async text => { await rv.page.keyboard.press('Escape'); await rv.page.keyboard.type(text); await rv.page.keyboard.press('Enter'); };
         const focusOn = async id => {
            const slot = await T(id => railsDebug.ide.test.card(id).slot, id);
            await T(s => railsDebug.setFocus(s), slot);
            await until(iv, id => railsDebug.ide.debug.focus === id, id);
         };
         const aimWorld = p => T(p => {
            const o = [...railsDebug.ide.test.ws.origin], d = [p[0] - o[0], p[1] - o[1], p[2] - o[2]], l = Math.hypot(...d);
            railsDebug.ide.test.aim({ o, d: d.map(x => x / l) });
         }, p);
         const aimAway = () => T(() => railsDebug.ide.test.aim({ o: [...railsDebug.ide.test.ws.origin], d: [0, 0.6, -0.8] }));
         const aimPlug = slot => T(slot => import('/js/scenes/rails/layout.js').then(L => L.plugWorld(railsDebug.ide.test.ws, slot)), slot).then(aimWorld);
         // (On the bus between two plugs, 12.5 degrees right of the middle: a plug under the gaze comes first, and the plugs of the demo are 25 degrees apart.)
         const aimBus = () => T(() => import('/js/scenes/rails/layout.js').then(L => L.cylPoint(railsDebug.ide.test.ws, 12.5 * Math.PI / 180, L.BUS.y))).then(aimWorld);
         const aimMat = () => T(() => { const m = railsDebug.ide.test.stage; return [m[12] + 0.1 * m[0], m[13] + 0.1 * m[1], m[14] + 0.1 * m[2]]; }).then(aimWorld);
         // A pixel of the bus window's canvas (where the gaze meets the panel).
         const WIN = await T(() => import('/js/scenes/rails/busWindow.js').then(m => m.WIN));
         const aimPixel = (px, py) => T(([px, py]) => import('/js/scenes/rails/layout.js').then(L => {
            const t = railsDebug.ide.test, m = L.busWindowFrame(t.ws, t.view.bus.frameYaw), W = L.BUS_WINDOW;
            const x = (px / W.px[0] - 0.5) * W.w, y = (0.5 - py / W.px[1]) * W.h;
            const p = [m[12] + x * m[0] + y * m[4], m[13] + x * m[1] + y * m[5], m[14] + x * m[2] + y * m[6]];
            const o = [...t.ws.origin], d = [p[0] - o[0], p[1] - o[1], p[2] - o[2]], l = Math.hypot(...d);
            t.aim({ o, d: d.map(v => v / l) });
         }), [px, py]);
         const bw = () => T(() => railsDebug.ide.test.view.bus);
         const press = async () => { await rv.page.mouse.down(); await frames(iv, 3); await rv.page.mouse.up(); };
         let drawnMax = 0;
         const budget = async () => { const b = await T(() => railsDebug.ide.test.bus); drawnMax = Math.max(drawnMax, b.drawn); assert.ok(b.drawn <= 30, 'drawn bus nodes: ' + b.drawn); };

         // 1. By name: the runtime has no `uses`, nobody is unplugged, and the variables are the built-in five and what the cards publish.
         await until(rv, () => railsDebug.snap && railsDebug.snap.vars && railsDebug.snap.vars.includes('target'));
         assert.deepEqual(await run(rv, () => ({ uses: railsDebug.snap.uses, unplugged: railsDebug.snap.unplugged })), { uses: {}, unplugged: [] });
         assert.deepEqual(await run(rv, () => [...railsDebug.snap.vars].sort()), ['center', 'gaze_hit', 'gaze_on', 'planted', 'pointer_down', 'pointer_pos', 'target', 'time']);
         const bt = await bindingOf('ball', 'target');
         assert.deepEqual([bt.variable, bt.isDefault, bt.bound], ['target', true, true]);
         const ft = await bindingOf('flowers', 'target');
         assert.deepEqual([ft.variable, ft.isDefault, ft.bound], ['target', true, true]);
         await until(iv, () => (railsDebug.ide.test.rails.target.pubs || []).length === 1 && (railsDebug.ide.test.rails.target.subs || []).length === 2);
         assert.deepEqual(await T(() => railsDebug.ide.test.rails.target.pubs.map(p => p[0])), ['oscillator']);
         assert.deepEqual(await T(() => railsDebug.ide.test.rails.target.subs.map(p => p[0]).sort()), ['ball', 'flowers']);
         // The ball follows the oscillator: over three seconds it is near the target each time and covers a good range.
         const xs = [];
         for (let n = 0; n < 6; n++) {
            const [p, v] = await until(iv, () => { const c = railsDebug.ide.test.card('ball'), v = railsDebug.ide.test.rails.target.value; return c.draw[0] && v && [c.draw[0].p, v]; });
            assert.ok(Math.hypot(p[0] - v[0], p[2] - v[2]) < 0.09, `the ball ${JSON.stringify(p)} follows the target ${JSON.stringify(v)}`);
            xs.push(p[0]);
            await iv.page.waitForTimeout(500);
         }
         assert.ok(Math.max(...xs) - Math.min(...xs) > 0.06, 'the ball moves with the oscillator: ' + xs.map(x => x.toFixed(3)));
         await until(iv, () => railsDebug.ide.test.rails.planted && railsDebug.ide.test.rails.planted.seq >= 1);
         await budget();

         // 2. `use target pointer_pos`: the ball follows the laptop's mouse (the window is 640 x 480; the mat is 0.4 m across).
         await focusOn('ball');
         await line('use target pointer_pos');
         await ballTakes('pointer_pos');
         assert.deepEqual(await run(rv, () => railsDebug.snap.uses), { 'ball.target': 'pointer_pos' });
         await rv.page.mouse.move(576, 240);                       // x (576/640 - .5) * .4 = .16, z 0
         await ballAt(0.16, 0);
         await rv.page.mouse.move(100, 400);                       // x -.1375, z .1333
         await ballAt(-0.1375, 0.1333);
         assert.equal((await bindingOf('flowers', 'target')).variable, 'target', 'the flowers still take the oscillator');
         // 3. `use target gaze_hit`: the gaze ray on the mat; `center`: the constant's point; a bare `use target`: back to its own name.
         await focusOn('ball');
         await line('use target gaze_hit');
         await ballTakes('gaze_hit');
         await aimMat();
         await ballAt(0.1, 0);
         await until(iv, () => railsDebug.ide.test.rails.gaze_on.value === true);
         await aimAway();
         await until(iv, () => railsDebug.ide.test.rails.gaze_on.value === false);
         await focusOn('ball');
         await line('use target center');
         await ballTakes('center');
         await ballAt(0, 0);
         await line('use target');
         await ballTakes('target');
         assert.equal((await bindingOf('ball', 'target')).isDefault, true);
         assert.deepEqual(await run(rv, () => railsDebug.snap.uses), {}, 'the use is gone');
         await until(iv, () => { const c = railsDebug.ide.test.card('ball'), v = railsDebug.ide.test.rails.target.value; return c.draw[0] && Math.hypot(c.draw[0].p[0] - v[0], c.draw[0].p[2] - v[2]) < 0.09; });
         // 4. Refusals: a variable that is not there, and an event variable for a state input; the input stays where it was.
         await line('use target nosuch');
         await until(iv, () => railsDebug.ide.test.toasts.some(t => /nosuch/.test(t)));
         await line('use target planted');
         await until(iv, () => railsDebug.ide.test.toasts.some(t => /kind mismatch: the port is state, the variable is event/.test(t)));
         console.log('use refusals: ' + JSON.stringify(await T(() => railsDebug.ide.test.toasts.filter(t => /nosuch|mismatch/.test(t)))));
         const kept = await bindingOf('ball', 'target');
         assert.deepEqual([kept.variable, kept.isDefault], ['target', true]);

         // 5. The plug: grab the oscillator's, release off the bus: it is unplugged, `target` has no publisher and the flowers stop.
         const oscSlot = await T(() => railsDebug.ide.test.card('oscillator').slot);
         const planted = () => T(() => railsDebug.ide.test.rails.planted.seq);
         await aimPlug(oscSlot);
         await rv.page.mouse.down();
         await until(iv, () => railsDebug.ide.test.view.plugGrab && railsDebug.ide.test.view.plugGrab.card === 'oscillator');
         assert.equal(await run(rv, () => railsDebug.host.stats.pointer.down), false, 'a press on a plug is not pointer_down');
         await aimAway(); await frames(iv, 3);
         await rv.page.mouse.up();
         await until(iv, () => railsDebug.ide.test.view.unplugged.includes('oscillator') && (railsDebug.ide.test.rails.target.pubs || []).length === 0);
         assert.deepEqual(await run(rv, () => railsDebug.snap.unplugged), ['oscillator']);
         assert.equal(await T(() => railsDebug.ide.test.rails.target.subs.length), 2, 'ball and flowers still take it');
         assert.equal((await bindingOf('ball', 'target')).bound, true, 'the variable is still there, with its last value');
         assert.equal((await T(() => railsDebug.ide.test.bus)).unplugged, 1);
         await iv.page.waitForTimeout(600);
         const frozen = await planted(), ballFrozen = await T(() => railsDebug.ide.test.card('ball').draw[0].p);
         await iv.page.waitForTimeout(2000);
         assert.equal(await planted(), frozen, 'no flower is planted while the target has no publisher');
         const ballLater = await T(() => railsDebug.ide.test.card('ball').draw[0].p);
         assert.ok(Math.hypot(ballLater[0] - ballFrozen[0], ballLater[2] - ballFrozen[2]) < 0.01, 'and the ball rests');
         await untilSave(rv, s => s.path === 'js/scenes/rails/data/layout.js' && /"unplugged": \[\s*"oscillator"\s*\]/.test(s.contents));
         // A press that is not on a plug is the pointer's (the gaze has been off the plug for more than the 0.2 s of grace).
         await aimAway();
         await until(iv, () => railsDebug.ide.test.view.gaze.kind !== 'plug'); await iv.page.waitForTimeout(300);
         await rv.page.mouse.down();
         await until(iv, () => railsDebug.ide.test.rails.pointer_down.value === true);
         assert.equal(await run(rv, () => railsDebug.host.stats.pointer.down), true);
         await rv.page.mouse.up();
         await until(iv, () => railsDebug.ide.test.rails.pointer_down.value === false);
         // Release on the bus: plugged in again, the target moves, the flowers grow again.
         await aimPlug(oscSlot);
         await rv.page.mouse.down();
         await until(iv, () => railsDebug.ide.test.view.plugGrab);
         await aimBus(); await frames(iv, 3);
         await until(iv, () => railsDebug.ide.test.bus.held === 'oscillator');
         await rv.page.mouse.up();
         await until(iv, () => railsDebug.ide.test.view.unplugged.length === 0 && (railsDebug.ide.test.rails.target.pubs || []).length === 1);
         await until(iv, n => railsDebug.ide.test.rails.planted.seq > n, frozen, 150);
         assert.deepEqual(await run(rv, () => railsDebug.snap.unplugged), []);
         await aimAway();
         await budget();

         // 5b. The gaze cursor: a ring (at most three drawn nodes) where the gaze meets what it hits; it moves with the gaze (here the inspector's
         // `aim` stands for the head), and the plug under it is highlighted.
         const ringAt = kind => until(iv, kind => { const t = railsDebug.ide.test, g = t.view.gaze, a = t.reticle.at;
            return !!g && !!a && g.kind === (kind === 'none' ? null : kind) && Math.hypot(a[0] - g.point[0], a[1] - g.point[1], a[2] - g.point[2]) < 0.06; }, kind);
         await aimPlug(oscSlot); await ringAt('plug');
         let cur = await T(() => ({ r: railsDebug.ide.test.reticle, targeted: railsDebug.ide.test.bus.targeted, at: railsDebug.ide.test.reticle.at }));
         assert.ok(cur.r.drawn >= 1 && cur.r.drawn <= 3, 'the cursor is at most 3 drawn nodes: ' + cur.r.drawn);
         assert.equal(cur.targeted, 'oscillator', 'the plug under the gaze is highlighted');
         await aimMat(); await ringAt('desk');
         const onMat = await T(() => railsDebug.ide.test.reticle.at);
         assert.ok(Math.hypot(...onMat.map((v, i) => v - cur.at[i])) > 0.3, 'the ring moved with the gaze: from the plug to the mat');
         assert.equal(await T(() => railsDebug.ide.test.bus.targeted), null, 'and the plug is not highlighted any more');
         await aimAway(); await ringAt('none');
         console.log('gaze cursor: ' + JSON.stringify(cur.r));

         // 6. The bus window. First by gaze: resting on the bus for 0.4 s opens it (at the gaze's yaw); Esc closes it.
         await focusOn('ball');
         assert.equal((await bw()).open, false);
         await aimBus();
         await until(iv, () => railsDebug.ide.test.view.bus.open === true);
         assert.ok(Math.abs((await bw()).frameYaw - 12.5 * Math.PI / 180) < 0.1, 'it opened where the gaze is: ' + (await bw()).frameYaw);
         await aimAway();
         await rv.page.keyboard.press('Escape');
         await until(iv, () => railsDebug.ide.test.view.bus.open === false);
         assert.equal(await T(() => railsDebug.ide.test.command), null, 'that Esc closed the window; it did not open the command line');
         // Then Mod+B: the variables sorted, the built-in ones last, with who publishes and who takes; the card's inputs on top.
         await focusOn('ball');
         await rv.page.keyboard.press('Control+b');
         await until(iv, () => railsDebug.ide.test.view.bus.open === true);
         await until(iv, () => railsDebug.ide.test.busWindow.shown === true && railsDebug.ide.test.busWindow.painted >= 1);
         const w0 = await bw();
         assert.deepEqual(w0.rows.map(r => r.id), ['center', 'planted', 'target', 'gaze_hit', 'gaze_on', 'pointer_down', 'pointer_pos', 'time']);
         assert.equal(w0.header.title, 'BUS · 8 variables');
         assert.equal(w0.card.name, 'ball');
         assert.equal(w0.selected.port, 'target', 'the input a person means (not `time`, which every card has) is the one selected when the window opens');
         assert.deepEqual(w0.inputs.map(i => [i.port, i.variable, i.isDefault]).sort(), [['target', 'target', true], ['time', 'time', true]]);
         const row = id => w0.rows.find(r => r.id === id);
         assert.deepEqual([row('target').kind, row('target').pubs, row('target').takers.slice().sort()], ['state', ['oscillator'], ['ball', 'flowers']]);
         assert.deepEqual([row('planted').kind, row('planted').pubs, row('planted').takers], ['event', ['flowers'], []]);
         assert.equal(row('time').builtin, true);
         await budget();
         // Repainted at most 4 times a second while live.
         const p0 = (await T(() => railsDebug.ide.test.busWindow)).painted;
         await iv.page.waitForTimeout(3000);
         const winRate = ((await T(() => railsDebug.ide.test.busWindow)).painted - p0) / 3;
         console.log(`bus window repaints: ${winRate.toFixed(1)} a second while open and live`);
         assert.ok(winRate <= 4.5, `the bus window was painted ${winRate} times a second`);
         // By gaze: look at the input row `target` and press, then at the variable row `center` and press.
         const inputRow = port => WIN.inputsTop + w0.inputs.findIndex(i => i.port === port) * WIN.rowH + WIN.rowH / 2;
         const varRow = id => WIN.varsTop + w0.rows.findIndex(r => r.id === id) * WIN.rowH + WIN.rowH / 2;
         await aimPixel(512, inputRow('target'));
         await until(iv, () => { const h = railsDebug.ide.test.view.bus.hover; return h && h.section === 'inputs' && h.port === 'target'; });
         await press();
         await until(iv, () => railsDebug.ide.test.view.bus.selected.port === 'target');
         await aimPixel(512, varRow('center'));
         await until(iv, () => { const h = railsDebug.ide.test.view.bus.hover; return h && h.section === 'vars' && h.variable === 'center'; });
         await rv.page.mouse.down();
         await frames(iv, 3);
         assert.equal(await run(rv, () => railsDebug.host.stats.pointer.down), false, 'a press on the window is not pointer_down');
         await rv.page.mouse.up();
         await ballTakes('center');
         assert.equal(await T(() => railsDebug.ide.test.rails.pointer_down.value), false, 'and the pointer never knew');
         await ballAt(0, 0);
         assert.deepEqual(await run(rv, () => railsDebug.snap.uses), { 'ball.target': 'center' });
         // By keys, with the gaze off the window: Backspace on the selected input puts it back; Tab to the variables, a filter, Enter assigns.
         await aimAway();
         await until(iv, () => railsDebug.ide.test.view.bus.hover === null);
         await rv.page.keyboard.press('Backspace');
         await ballTakes('target');
         await rv.page.keyboard.press('Tab');
         await until(iv, () => railsDebug.ide.test.view.bus.section === 'vars');
         await rv.page.keyboard.type('pointer_p');
         await until(iv, () => railsDebug.ide.test.view.bus.filter === 'pointer_p' && railsDebug.ide.test.view.bus.rows.length === 1);
         assert.equal((await bw()).rows[0].id, 'pointer_pos');
         await rv.page.keyboard.press('Enter');
         await ballTakes('pointer_pos');
         assert.deepEqual(await run(rv, () => railsDebug.snap.uses), { 'ball.target': 'pointer_pos' });
         // Esc in steps: the filter, then the variables section, then the window; the next one is the command line's.
         await rv.page.keyboard.press('Escape');
         await until(iv, () => railsDebug.ide.test.view.bus.open && railsDebug.ide.test.view.bus.filter === '' && railsDebug.ide.test.view.bus.section === 'vars');
         await rv.page.keyboard.press('Escape');
         await until(iv, () => railsDebug.ide.test.view.bus.open && railsDebug.ide.test.view.bus.section === 'inputs');
         await rv.page.keyboard.press('Escape');
         await until(iv, () => railsDebug.ide.test.view.bus.open === false);
         assert.equal(await T(() => railsDebug.ide.test.command), null);
         await until(iv, () => railsDebug.ide.test.busWindow.shown === false);
         await rv.page.keyboard.press('Escape');
         await until(iv, () => railsDebug.ide.test.command === '');
         await rv.page.keyboard.press('Escape');
         await until(iv, () => railsDebug.ide.test.command === null);
         await focusOn('ball');
         await line('use target'); await ballTakes('target');
         await budget();

         // 7. Pause. Shift+wheel scrubs (a mouse has no sideways wheel); Mod+[ and Mod+] step the playhead by 0.5 s (Shift: 0.1 s).
         await rv.page.keyboard.press('Control+p');
         await until(iv, () => railsDebug.ide.test.clock.paused === true && typeof railsDebug.ide.test.clock.playhead === 'number');
         await until(rv, () => railsDebug.snap && railsDebug.snap.paused === true);
         const head = () => T(() => railsDebug.ide.test.clock.playhead);
         const t0 = await stable(iv, () => railsDebug.ide.test.clock.playhead);
         const scrollBefore = await T(() => railsDebug.ide.test.card('ball').buffer.scrollX);
         await rv.page.keyboard.down('Shift'); await rv.page.mouse.wheel(0, -200); await rv.page.keyboard.up('Shift');
         await until(iv, t => Math.abs(railsDebug.ide.test.clock.playhead - (t - 2)) < 1e-6, t0);
         assert.equal(await T(() => railsDebug.ide.test.card('ball').buffer.scrollX), scrollBefore, 'a paused sideways wheel scrubs, it does not scroll the card');
         const at2 = await stable(iv, () => JSON.stringify(railsDebug.ide.test.rails.target.value));   // (the text of the value)
         const playheadIs = dt => until(iv, t => Math.abs(railsDebug.ide.test.clock.playhead - t) < 1e-6, t0 - 2 + dt);
         await rv.page.keyboard.press('Control+[');
         await playheadIs(-0.5);
         await until(iv, a => JSON.stringify(railsDebug.ide.test.rails.target.value) !== a, at2);
         await rv.page.keyboard.press('Control+Shift+[');
         await playheadIs(-0.6);
         await rv.page.keyboard.press('Control+]');
         await playheadIs(-0.1);
         await rv.page.keyboard.press('Control+Shift+]');
         await playheadIs(0);
         // Back where it was, the tape gives the same value as before.
         await until(iv, a => JSON.stringify(railsDebug.ide.test.rails.target.value) === a, at2);
         // A long way back stops at the start of the window.
         await rv.page.mouse.wheel(-100000, 0);
         await until(iv, () => railsDebug.ide.test.clock.playhead === railsDebug.ide.test.clock.window[0]);
         // The page saw Ctrl+[ and Ctrl+] as real keys, and what it did with them stopped the browser from acting on them.
         const spied = await run(rv, () => KD.filter(k => k.trusted));
         assert.ok(spied.length >= 4, 'the page got the bracket keys: ' + JSON.stringify(spied));
         assert.ok(spied.every(k => k.ctrl && k.prevented === true), 'and prevented their default: ' + JSON.stringify(spied));
         console.log(`Ctrl+[ / Ctrl+]: ${spied.length} real key events reached the page, all defaultPrevented`);
         await rv.page.keyboard.press('Control+p');
         await until(iv, () => railsDebug.ide.test.clock.paused === false && railsDebug.ide.test.clock.playhead === null);
         // Mod+[ while live does nothing.
         await rv.page.keyboard.press('Control+[');
         await frames(iv, 10);
         assert.equal(await head(), null);

         // 8. Zoom: Ctrl+wheel zooms the focused card (wheel up = in: 26 columns), never the page; Mod+= / Mod+- / Mod+0 do the same by key.
         await focusOn('ball');
         const zoomOf = () => T(() => { const c = railsDebug.ide.test.card('ball'); return [c.zoom, c.buffer.cols, c.buffer.rows]; });
         assert.deepEqual(await zoomOf(), [1, 32, 12]);
         // (A pinch arrives as Ctrl+wheel: its default, the page's zoom, is prevented. That synthetic one is a step in for the card, too.)
         const wheelPrevented = await run(rv, () => { const e = new WheelEvent('wheel', { ctrlKey: true, deltaY: -120, bubbles: true, cancelable: true }); window.dispatchEvent(e); return e.defaultPrevented; });
         assert.equal(wheelPrevented, true, 'a Ctrl+wheel is not the page\'s zoom');
         await until(iv, () => railsDebug.ide.test.card('ball').zoom === 0);
         await rv.page.keyboard.press('Control+0');
         await until(iv, () => railsDebug.ide.test.card('ball').zoom === 1);
         await rv.page.waitForTimeout(300);
         await rv.page.keyboard.down('Control'); await rv.page.mouse.wheel(0, -120); await rv.page.keyboard.up('Control');
         await until(iv, () => railsDebug.ide.test.card('ball').zoom === 0);
         assert.deepEqual(await zoomOf(), [0, 26, 10]);
         await rv.page.waitForTimeout(300);
         await rv.page.keyboard.down('Control'); await rv.page.mouse.wheel(0, 120); await rv.page.keyboard.up('Control');
         await until(iv, () => railsDebug.ide.test.card('ball').zoom === 1);
         await rv.page.keyboard.press('Control+-');
         await until(iv, () => railsDebug.ide.test.card('ball').zoom === 2);
         assert.deepEqual(await zoomOf(), [2, 40, 15]);
         assert.equal(await T(() => railsDebug.ide.test.card('flowers').zoom), 1, 'only the focused card');
         await rv.page.keyboard.press('Control+=');
         await until(iv, () => railsDebug.ide.test.card('ball').zoom === 1);
         await rv.page.keyboard.press('Control+0');
         assert.deepEqual(await zoomOf(), [1, 32, 12]);

         // 9. A long line scrolls sideways: the flowers' code has lines over 32 columns; a sideways swipe moves 6 columns per 100 units
         // while live, and Shift+wheel does the same; the view of the card says where it is (scrollX), and it stops at both ends.
         await focusOn('flowers');
         const longest = await T(() => Math.max(...railsDebug.ide.test.text('flowers').split('\n').map(l => l.length)));
         assert.ok(longest > 60, 'a long line: ' + longest);
         assert.equal(await T(() => railsDebug.ide.test.card('flowers').buffer.scrollX), 0);
         await rv.page.mouse.wheel(300, 0);
         await until(iv, () => railsDebug.ide.test.card('flowers').buffer.scrollX === 18);
         await rv.page.keyboard.down('Shift'); await rv.page.mouse.wheel(0, 100); await rv.page.keyboard.up('Shift');
         await until(iv, () => railsDebug.ide.test.card('flowers').buffer.scrollX === 24);
         await until(iv, () => { const s = railsDebug.ide.test.view.slots.find(x => x && x.id === 'flowers'); return s && s.state.scrollX === 24 && s.state.cols === 32; });
         await rv.page.mouse.wheel(100000, 0);
         const farRight = await stable(iv, () => railsDebug.ide.test.card('flowers').buffer.scrollX);
         assert.ok(farRight >= 24 && farRight <= longest, `it stops near the end of the longest line: ${farRight} of ${longest}`);
         await rv.page.mouse.wheel(-100000, 0);
         await until(iv, () => railsDebug.ide.test.card('flowers').buffer.scrollX === 0);

         // The whole demo: bus nodes drawn, canvases, errors.
         await budget();
         console.log(`bus nodes drawn in the demo (band, plugs, pulses; most seen): ${drawnMax}`);
         assert.equal(await run(iv, () => railsDebug.owned.length), 7, 'five cards, the timeline strip and the bus window');
         for (const rec of [rv, iv]) assert.equal(await run(rec, () => railsDebug.errors), 0, rec.name + ' counted no frame errors in V');
         for (const rec of [rv, iv]) noPageErrors(rec);
         assert.equal(rv.saves.filter(s => /modules\//.test(s.path || '')).length, 0, 'the demo wrote no module (only the layout)');
         await close([rv, iv]);
      }

      // ---- C: one device alone, ?railsRole=both: the IDE and the runtime in one page, no railsLink message at all ---------
      // The scene next to it for the texture count: the channels of a scene that makes none of its own.
      const solo = makeRelay(url);
      const one = keep(await makePage(browser, solo, 0, 'both'));
      await open(one, url);
      await scene(one, 'simple');
      const base = { channels: await stable(one, () => new Set(window.txtrChannel).size), canvases: await stable(one, () => Object.keys(window._canvas_txtr || {}).length) };
      await enter(one, url, 'both');
      assert.deepEqual(await run(one, () => [railsDebug.role, railsDebug.link.forced]), ['both', 'both']);
      await until(one, () => railsDebug.host && railsDebug.host.stats.beats > 3);
      assert.equal(await run(one, () => railsDebug.host.stats.workerErrors), 0);
      await until(one, () => railsDebug.snap);
      assert.equal(one.page.workers().length, 1);
      // A key on this page goes through the loopback (no card is focused, so the IDE only says so).
      const loop = await run(one, () => railsDebug.loop.sent);
      await one.page.keyboard.press('KeyA');
      await until(one, () => railsDebug.terminal.sent > 0);
      assert.equal(await run(one, () => railsDebug.terminal.refused), 0, 'in `both` a key is taken at once');
      await until(one, n => railsDebug.loop.sent > n, loop);
      assert.equal(await run(one, () => railsDebug.loop.errors), 0);
      assert.ok(await run(one, () => document.body.innerText.includes('both parts run here')), 'the HUD says both parts run here');
      assert.equal((await untilLog(one, l => l.ev === 'start')).role, 'both');
      await untilLog(one, l => l.ev === 'tick');
      assert.ok(one.logs.every(l => l.role === 'both'));
      assert.deepEqual(solo.frames[0].filter(f => /railsLink/.test(f)), [], 'nothing about railsLink on the relay');

      // The IDE and the runtime in one page: look at a card, type, Mod+Enter, and the in-page runtime runs it and saves it after about a second.
      await until(one, () => railsDebug.ide.test.ws && railsDebug.ide.test.paired);
      await one.page.keyboard.press('Escape');
      await one.page.keyboard.type('card solo');
      await one.page.keyboard.press('Enter');
      await until(one, () => railsDebug.ide.test.card('solo')?.loaded);
      await run(one, () => railsDebug.setFocus(railsDebug.ide.test.card('solo').slot));
      await until(one, () => railsDebug.ide.debug.focus === 'solo');
      await one.page.keyboard.type('// both ');
      await until(one, () => railsDebug.ide.test.text('solo').startsWith('// both '));
      const typedHere = await run(one, () => railsDebug.ide.test.text('solo')), b0 = performance.now();
      await one.page.keyboard.press('Control+Enter');
      const soloSave = await untilSave(one, s => s.path === 'js/scenes/rails/modules/solo.js' && s.contents === typedHere);
      assert.ok(soloSave.at - b0 >= 700, `saved ${soloSave.at - b0} ms after Ctrl+Enter, not before the Worker has kept beating`);
      await until(one, t => railsDebug.ide.test.running('solo') === t, typedHere);
      assert.equal((await run(one, () => railsDebug.ide.debug.cards.find(c => c[0] === 'solo')))[2], false, 'the buffer is clean: the runtime in this page runs it');
      assert.equal(await run(one, () => railsDebug.errors), 0);

      // Textures: the scene's own channels and canvases are all it adds (at most 7), and all are given back.
      const owned = await run(one, () => railsDebug.owned);
      assert.ok(owned.length <= 7, `${owned.length} textures of its own (7 at most)`);
      assert.equal(owned.length, 7, 'the five cards, the timeline strip and the bus window own a canvas each');
      const visit1 = await stable(one, () => new Set(window.txtrChannel).size);
      assert.equal(await stable(one, () => new Set(window.txtrChannel).size), base.channels + owned.length, 'the channels are the scene\'s own, over what any scene has');
      assert.equal(await stable(one, () => Object.keys(window._canvas_txtr || {}).length), base.canvases + owned.length, 'and the canvases');
      assert.ok((await run(one, () => Object.keys(window.clay.formMesh()).filter(n => /^rails/.test(n)).length)) > 0, 'the rails have meshes while the scene is here');
      // Leaving: the Worker is terminated, the channels are those of the next scene alone.
      await scene(one, 'simple');
      await until(one, () => !window.railsDebug);
      assert.deepEqual(await run(one, () => Object.keys(window.clay.formMesh()).filter(n => /^rails/.test(n))), [], 'no rails* or railsText* mesh is left (createIde.dispose)');
      for (let n = 0; n < 50 && one.page.workers().length; n++) await one.page.waitForTimeout(100);
      assert.equal(one.page.workers().length, 0, 'no Worker left');
      assert.equal(await stable(one, () => new Set(window.txtrChannel).size), base.channels, 'every channel is given back, none more');
      assert.equal(await stable(one, () => Object.keys(window._canvas_txtr || {}).length), base.canvases, 'and every canvas');
      assert.equal(await run(one, () => document.body.innerText.includes('Keep this window visible')), false, 'the HUD is gone');
      // A second visit works as the first.
      await scene(one, 'rails');
      await until(one, () => window.railsDebug?.role === 'both');
      await until(one, () => railsDebug.host && railsDebug.host.stats.beats > 3);
      await until(one, () => railsDebug.snap);
      assert.equal(one.page.workers().length, 1, 'one Worker again');
      assert.equal(await run(one, () => railsDebug.errors), 0);
      assert.equal(await run(one, () => railsDebug.owned.length), 7);
      assert.ok((await run(one, () => railsDebug.owned.length)) <= 7);
      assert.equal(await stable(one, () => new Set(window.txtrChannel).size), visit1, 'leaving and coming back: the same channels as the first visit');
      noPageErrors(one);
      console.log(`channels: ${base.channels} for a scene alone, ${owned.length} of its own; Workers: in 1, left 0, back 1`);
      await close([one]);

      // ---- D: roles that are not forced ---------------------------------------------------------------------------------
      const free = makeRelay(url);
      const laptop = keep(await makePage(browser, free, 0, 'laptop'));
      await enter(laptop, url, null);
      assert.deepEqual(await run(laptop, () => [railsDebug.role, railsDebug.link.forced, railsDebug.rank]), ['both', null, 1], 'alone, a page is both');
      const quest = keep(await makePage(browser, free, 1, 'quest', { userAgent: QUEST }));
      await enter(quest, url, null);
      assert.equal(await run(quest, () => railsDebug.rank), 2, 'a Quest\'s browser has the higher rank');
      await until(laptop, () => railsDebug.role === 'runtime' && railsDebug.link.mutual);
      await until(quest, () => railsDebug.role === 'ide' && railsDebug.link.mutual);
      assert.equal(await run(quest, () => railsDebug.host), null, 'the headset has no runtime host');
      await until(laptop, () => railsDebug.host && railsDebug.host.stats.beats > 3);
      assert.equal(laptop.page.workers().length, 1);
      assert.equal(quest.page.workers().length, 0);
      for (const rec of [laptop, quest]) noPageErrors(rec);
      await close([laptop, quest]);
   } finally {
      for (const rec of pages) await rec.page.close().catch(() => {});
      await browser.close().catch(() => {});
   }
   console.log('rails browser test passed');
})().catch(e => { console.error(e); process.exit(1); });
