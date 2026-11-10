// Playwright test: Doorways on one page, solo, served by the app server (start it first;
// XR_TEST_URL defaults to http://localhost:2026/). The scene starts as the giant with a level
// from a seed; a room is held and released over a free cell (the state follows) or goes back
// where it was; a mouse drag on a room moves it while the view stays and a drag on empty space
// turns the view; V flies to the mini's view (the world 12 times bigger); W walks the mini over
// the floors without moving the camera; F at a switch presses it and frees the anchored room; a
// teleport to a room it cannot reach is refused; the mini in a room the giant holds and turns is
// still inside it after the snap; an empty chest costs 20 s, the goal chest wins and N starts a
// new round; no page errors. DOORWAYS_SHOTS=dir saves screenshots of the views there.
// Then two players, two pages of the browser on a routed relay (see twoPlayers below).
// Run with NODE_PATH pointing to an installation containing playwright.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
// Two players: two pages of one browser, on a relay that works like the classroom's (the page's WebSocket is
// routed: a welcome with the page's clientID, the list of clients, and every message to the other pages), so that no
// real server state is shared. Page 0 (client 0) and page 1 (client 1) each start alone with a seed of their own.
const twoPlayers = async (browser, url) => {
   const errors = [], pages = [], peers = new Map();
   const socketURL = `${url.protocol === 'https:' ? 'wss:' : 'ws:'}//${url.host}/`;
   const known = /Empty gltf|Requested device not found|404/;
   const seeds = [7, 500];
   const announce = () => { for (const peer of peers.values()) peer.send(JSON.stringify({ global: 'clients', value: [...peers.keys()] })); };
   const open = async id => {
      const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
      pages[id] = page;
      page.on('pageerror', e => { if (!known.test(e.message)) errors.push(`page ${id}: ${e.message}`); });
      page.on('console', m => { if (m.type() === 'error' && !known.test(m.text())) errors.push(`page ${id}: ${m.text()}`); });
      await page.routeWebSocket(socketURL, socket => {
         peers.set(id, socket);
         socket.send(JSON.stringify({ type: 'welcome', clientID: id }));
         announce();
         socket.onMessage(data => { for (const [other, peer] of peers) if (other !== id) peer.send(data); });
         socket.onClose(() => { if (peers.get(id) === socket) { peers.delete(id); announce(); } });
      });
      await enter(page, id);
   };
   const enter = async (page, id) => {
      const u = new URL(url.href);
      u.searchParams.set('doorwaysSeed', String(seeds[id]));
      await page.goto(u.href);
      await page.getByText('doorways', { exact: true }).click();
      await page.evaluate(() => document.querySelector('details')?.removeAttribute('open'));
      await page.waitForFunction(() => window.doorwaysDebug?.frames > 2, null, { timeout: 60000 });
      await page.evaluate(async () => {
         const R = await import('/js/scenes/doorways/rules.js'), cg = await import('/js/render/core/cg.js'), G = await import('/js/scenes/doorways/generate.js');
         window.T = {
            R, cg, G,
            free: () => R.CELLS.filter(c => !Object.values(doorwaysDebug.state.at).some(a => a.slot === c)),
            movable: skip => doorwaysDebug.level.rooms.find(r => r.id !== skip && R.movable(doorwaysDebug.level, doorwaysDebug.state, r.id)).id,
            // Where a point (a matrix's origin) is in a room's frame, as the room is now (held or settled).
            inRoom: (id, m) => cg.mTransform(cg.mInverse(cg.mMultiply(doorwaysDebug.frame, doorwaysDebug.roomPose(id))), m.slice(12, 15)),
         };
      });
   };
   const run = (i, f, a) => pages[i].evaluate(f, a);
   // Network effects need a frame or two at each end, and the headless browser draws slowly: wait for them, never sleep a fixed time.
   // A wait that runs out is a failure, with what was waited for.
   const until = async (i, f, a, tries = 200) => {
      for (let n = 0; n < tries; n++) { const v = await run(i, f, a); if (v) return v; await pages[i].waitForTimeout(100); }
      throw new Error(`page ${i} never became: ${f}`);
   };
   const later = async i => { const f = await run(i, () => doorwaysDebug.frames); await until(i, f => doorwaysDebug.frames > f + 2, f); };
   const near = (a, b, e, what) => a.forEach((v, k) => assert.ok(Math.abs(v - b[k]) < e, what + ' ' + JSON.stringify([a, b])));
   const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
   const level = i => run(i, () => ({ seed: doorwaysDebug.level.seed, round: doorwaysDebug.net.round }));
   try {
      await open(0);
      const alone = await run(0, () => doorwaysDebug.level.seed);
      await open(1);
      const own = await run(1, () => T.G.generate(500).level.seed);
      assert.notEqual(alone, own, 'the two pages start with levels of their own');

      // They meet: the lower client is the giant, with the same level (the giant's); the other flies to the mini's view.
      await until(1, () => doorwaysDebug.net.round >= 1 && doorwaysDebug.net.live);
      await until(0, () => doorwaysDebug.net.round >= 1 && doorwaysDebug.net.live);
      assert.deepEqual(await run(0, () => [doorwaysDebug.net.paired, doorwaysDebug.role]), ['giant', 'giant']);
      assert.deepEqual(await run(1, () => [doorwaysDebug.net.paired, doorwaysDebug.role]), ['mini', 'mini']);
      assert.equal(await run(1, () => doorwaysDebug.level.seed), alone, 'the mini plays the giant\'s level');
      assert.equal(await run(0, () => doorwaysDebug.level.seed), alone, 'and the giant kept it');
      assert.equal((await level(0)).round, (await level(1)).round, 'one round');
      await until(1, () => doorwaysDebug.t === 1);
      assert.ok(Math.abs(await run(1, () => doorwaysDebug.scale) - 12) < 1e-6, 'the mini sees the world 12 times bigger');
      assert.equal(await run(0, () => doorwaysDebug.t), 0);
      assert.equal(await run(0, () => doorwaysDebug.panel.role), 'giant');
      assert.equal(await run(1, () => doorwaysDebug.panel.role), 'mini');
      assert.equal(await run(0, () => doorwaysDebug.panel.waiting), false);
      assert.ok(await run(0, () => doorwaysDebug.panel.goalSymbol), 'the giant has the task card');
      assert.equal(await run(1, () => doorwaysDebug.panel.goalSymbol), null, 'the mini never sees the goal symbol');
      // Each sees the other's body: the mini the giant, the giant the mini's avatar.
      await until(1, () => doorwaysDebug.partner);
      await until(0, () => doorwaysDebug.partner);
      // A page that is a partner cannot switch roles by itself.
      await pages[0].keyboard.press('KeyV'); await later(0);
      assert.equal(await run(0, () => doorwaysDebug.role), 'giant', 'V does nothing with a partner');
      assert.equal(await run(0, () => doorwaysDebug.t), 0);

      // A room released on the giant's page is in the new slot on the mini's.
      const id = await run(0, () => T.movable()), cell = await run(0, () => T.free()[0]);
      await run(0, ([id, cell]) => doorwaysDebug.hold(id, T.cg.mMultiply(T.cg.mTranslate(T.R.slotCentre(cell)[0] + .01, .03, T.R.slotCentre(cell)[2]), T.cg.mRotateY(-Math.PI / 2 + .2))), [id, cell]);
      await until(1, id => doorwaysDebug.held?.id === id, id);
      assert.equal(await run(1, () => doorwaysDebug.held.id), id, 'the mini sees which room is held');
      await run(0, () => doorwaysDebug.release());
      await until(1, ([id, cell]) => doorwaysDebug.state.at[id].slot === cell && !doorwaysDebug.held, [id, cell]);
      assert.deepEqual(await run(1, id => doorwaysDebug.state.at[id], id), { slot: cell, rot: 1 }, 'the mini sees the new slot and turn');
      assert.deepEqual(await run(0, id => doorwaysDebug.state.at[id], id), { slot: cell, rot: 1 });
      // A mini cannot move a room: its page has no hands for that.
      assert.equal(await run(1, id => doorwaysDebug.hold(id, T.cg.mTranslate(0, .03, 0)), id), false);

      // The switch pressed on the mini's page frees the anchored room on the giant's.
      const sw = await run(0, () => doorwaysDebug.level.rooms.find(r => r.switch));
      const stake = await run(0, c => doorwaysDebug.level.rooms.find(r => r.anchor === c).id, sw.switch);
      assert.equal(await run(0, id => T.R.movable(doorwaysDebug.level, doorwaysDebug.state, id), stake), false);
      await run(1, ([id]) => doorwaysDebug.put(id, [.3 * .18, -.3 * .18]), [sw.id]);
      await later(1);
      assert.equal(await run(1, () => doorwaysDebug.act('press')), true);
      await until(0, c => doorwaysDebug.state.pressed.includes(c), sw.switch);
      assert.equal(await run(0, id => T.R.movable(doorwaysDebug.level, doorwaysDebug.state, id), stake), true, 'on the giant\'s page the stake is gone');
      await run(0, id => doorwaysDebug.hold(id, T.cg.mTranslate(0, .03, 0)), stake);
      assert.equal(await run(0, () => doorwaysDebug.held?.id), stake, 'and the giant can lift that room');
      await run(0, () => doorwaysDebug.release());
      await until(0, () => !doorwaysDebug.held);

      // The mini in a room the giant holds: drawn inside it on the giant's page whatever its matrix does; carried with it on its own.
      const R1 = await run(0, () => T.movable(doorwaysDebug.state.mini)), spot = await run(0, () => T.free()[0]);
      await run(1, id => doorwaysDebug.put(id, [.04, -.03]), R1);
      await until(0, id => doorwaysDebug.state.mini === id && doorwaysDebug.partner, R1);
      await later(0);
      const settled = await run(0, id => ({ at: doorwaysDebug.state.at[id], inside: T.inRoom(id, doorwaysDebug.partner) }), R1);
      const inside = ([x, y, z]) => Math.abs(x) < .09 && Math.abs(z) < .09 && y > -.01 && y < .3;
      assert.ok(inside(settled.inside), 'the mini\'s avatar is in its room on the giant\'s page ' + settled.inside);
      const was = await run(1, () => ({ local: [...doorwaysDebug.mini.local] }));
      const m1 = ([cell, rot]) => run(0, ([id, cell, rot]) => doorwaysDebug.hold(id, T.cg.mMultiply(T.cg.mTranslate(T.R.slotCentre(cell)[0] + .02, .05, T.R.slotCentre(cell)[2]), T.cg.mRotateY(-rot * Math.PI / 2 + .1))), [R1, cell, rot]);
      await m1([spot, settled.at.rot + 1]);
      await later(0);
      const lifted = await run(0, id => T.inRoom(id, doorwaysDebug.partner), R1);
      near(lifted, settled.inside, 2e-3, 'in the held room the avatar is where it was in the room');
      const high = await run(0, id => doorwaysDebug.roomPose(id)[13], R1);
      assert.ok(high > .04, 'the room is lifted');
      // Moved and turned again while held: still in the same place of the room.
      await run(0, id => doorwaysDebug.hold(id, T.cg.mMultiply(T.cg.mTranslate(-.1, .08, .15), T.cg.mRotateY(1.1))), R1);
      await later(0);
      near(await run(0, id => T.inRoom(id, doorwaysDebug.partner), R1), settled.inside, 2e-3, 'moved: still in the room');
      // On the mini's page: it sees the room held (100 ms behind), is in it, and the avatar is carried with it.
      await until(1, id => doorwaysDebug.held?.id === id && doorwaysDebug.tilt.some((v, i) => Math.abs(v - [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1][i]) > 1e-3), R1);
      assert.equal(await run(1, () => doorwaysDebug.state.mini), R1, 'the mini is in the held room');
      await m1([spot, settled.at.rot + 1]);   // over the free cell again
      await later(0);
      await run(0, () => doorwaysDebug.release());
      const to = await run(0, id => doorwaysDebug.state.at[id], R1);
      assert.deepEqual(to, { slot: spot, rot: (settled.at.rot + 1) % 4 }, 'set down in the new cell, turned');
      await until(1, ([id, to]) => !doorwaysDebug.held && doorwaysDebug.state.at[id].slot === to.slot && doorwaysDebug.state.at[id].rot === to.rot, [R1, to]);
      await later(1); await later(0);
      assert.equal(await run(1, () => doorwaysDebug.state.mini), R1, 'still in the room after the release');
      near(await run(1, () => [...doorwaysDebug.mini.local]), was.local, 1e-6, 'the same place in the room');
      const feet = await run(1, () => [...doorwaysDebug.feet]), expect = await run(1, ([id, local]) => { const a = doorwaysDebug.state.at[id]; return T.cg.mTransform(T.R.slotPose(a.slot, a.rot), local); }, [R1, was.local]);
      near(feet, expect, 1e-6, 'its feet are where that place is in the room as it is set down');
      assert.deepEqual(await run(1, () => doorwaysDebug.tilt), identity, 'set down: no tilt');
      assert.equal(await run(1, () => doorwaysDebug.onFloor()), true);
      near(await run(0, id => T.inRoom(id, doorwaysDebug.partner), R1), settled.inside, 2e-3, 'and in the giant\'s eyes it is still in the room, in the room\'s new place');

      // An empty chest costs 20 s on both; the goal chest wins, and shows on both, the task card on the giant's alone.
      const empty = await run(0, () => doorwaysDebug.level.rooms.find(r => r.chest && r.id !== doorwaysDebug.level.goal).id);
      await run(1, id => doorwaysDebug.put(id, [0, 0]), empty);
      await later(1);
      assert.equal(await run(1, () => doorwaysDebug.act('open')), true);
      await until(0, () => doorwaysDebug.state.penalty === 20);
      assert.equal(await run(0, () => doorwaysDebug.state.penalty), 20, 'the giant sees the penalty');
      await run(1, () => doorwaysDebug.put(doorwaysDebug.level.goal, [0, 0]));
      await later(1);
      assert.equal(await run(1, () => doorwaysDebug.act('open')), true);
      await until(0, () => doorwaysDebug.state.won);
      for (const i of [0, 1]) {
         await until(i, () => /treasure/i.test(doorwaysDebug.panel.message));
         assert.equal(await run(i, () => doorwaysDebug.state.won), true, 'won on page ' + i);
         assert.match(await run(i, () => doorwaysDebug.panel.message), /treasure/i);
      }
      assert.equal(await run(1, () => doorwaysDebug.panel.goalSymbol), null);
      const clock = await run(0, () => doorwaysDebug.time);
      assert.ok(clock > 0, 'the giant\'s clock is the mini\'s: ' + clock);

      // M after the win swaps the roles, with a new seed; both start again.
      const before = await level(0);
      await pages[0].keyboard.press('KeyM');
      await until(0, r => doorwaysDebug.net.round > r && doorwaysDebug.net.paired === 'mini', before.round);
      await until(1, r => doorwaysDebug.net.round > r && doorwaysDebug.net.paired === 'giant', before.round);
      const after = [await level(0), await level(1)];
      assert.equal(after[0].seed, after[1].seed, 'one level');
      assert.notEqual(after[0].seed, before.seed, 'a new seed');
      assert.equal(after[0].round, after[1].round);
      for (const i of [0, 1]) {
         await until(i, () => !doorwaysDebug.state.won && doorwaysDebug.state.mini === 'entrance');
         assert.deepEqual(await run(i, () => [doorwaysDebug.state.won, doorwaysDebug.state.penalty, doorwaysDebug.state.mini]), [false, 0, 'entrance'], 'a new round on page ' + i);
      }
      await until(0, () => doorwaysDebug.t === 1);
      await until(1, () => doorwaysDebug.t === 0);
      assert.deepEqual(await run(0, () => [doorwaysDebug.role, doorwaysDebug.panel.role]), ['mini', 'mini'], 'page 0 is the mini now');
      assert.deepEqual(await run(1, () => [doorwaysDebug.role, doorwaysDebug.panel.role]), ['giant', 'giant']);
      for (const i of [0, 1]) assert.doesNotMatch(await run(i, () => doorwaysDebug.panel.message), /treasure/i, 'the win does not stick into the next round, page ' + i);
      assert.ok(await run(1, () => doorwaysDebug.panel.goalSymbol), 'the new giant has the task card');
      assert.equal(await run(0, () => doorwaysDebug.panel.goalSymbol), null);
      // The new mini walks (it owns itself): its press of W moves its feet, and the new giant's page shows the avatar move.
      await until(1, () => doorwaysDebug.partner);
      const seen = await run(1, () => [...doorwaysDebug.partner.slice(12, 15)]);
      await pages[0].keyboard.down('KeyW');
      await until(0, () => Math.hypot(...doorwaysDebug.feet.map((v, i) => v - [-.315, 0, 0][i])) > .02);
      await pages[0].keyboard.up('KeyW');
      await until(1, s => Math.hypot(...doorwaysDebug.partner.slice(12, 15).map((v, i) => v - s[i])) > .004, seen);

      // A page reloaded in the middle of the round rejoins that round, with the same role and level.
      const mid = [await level(0), await level(1)];
      await pages[1].reload();
      await enter(pages[1], 1);
      await until(1, r => doorwaysDebug.net.round === r && doorwaysDebug.net.live, mid[1].round);
      assert.equal(await run(1, () => doorwaysDebug.level.seed), mid[0].seed, 'the reloaded page has the same level');
      assert.equal(await run(1, () => doorwaysDebug.net.paired), 'giant', 'and the same role');
      await until(0, () => doorwaysDebug.net.live && !doorwaysDebug.net.waiting);
      assert.equal((await level(0)).round, mid[0].round, 'nobody started another round');
      await until(1, () => doorwaysDebug.t === 0 && doorwaysDebug.partner);

      // The partner goes: the mini's page waits for it, keeps its role, view and state, and still cannot switch roles.
      const kept = await run(0, () => ({ at: JSON.stringify(doorwaysDebug.state.at), mini: doorwaysDebug.state.mini, seed: doorwaysDebug.level.seed }));
      await pages[1].close();
      await until(0, () => doorwaysDebug.panel.waiting, undefined, 100);
      assert.equal(await run(0, () => doorwaysDebug.panel.waiting), true, 'waiting for your partner');
      assert.deepEqual(await run(0, () => [doorwaysDebug.net.paired, doorwaysDebug.role, doorwaysDebug.t]), ['mini', 'mini', 1]);
      await pages[0].keyboard.press('KeyV'); await later(0);
      assert.equal(await run(0, () => doorwaysDebug.role), 'mini', 'V still does nothing');
      assert.deepEqual(await run(0, () => ({ at: JSON.stringify(doorwaysDebug.state.at), mini: doorwaysDebug.state.mini, seed: doorwaysDebug.level.seed })), kept, 'the state is kept');

      assert.deepEqual(errors, []);
   } finally {
      for (const page of pages) await page.close().catch(() => {});
   }
   console.log('doorways two-player test passed');
};
(async () => {
   const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
   try {
      const errors = [];
      const url = new URL(process.env.XR_TEST_URL || 'http://localhost:2026/');
      url.searchParams.set('doorwaysSeed', '7');
      const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
      const known = /Empty gltf|Requested device not found|404/;
      page.on('pageerror', e => { if (!known.test(e.message)) errors.push(e.message); });
      page.on('console', m => { if (m.type() === 'error' && !known.test(m.text())) errors.push(m.text()); });
      const wait = ms => page.waitForTimeout(ms), run = (f, a) => page.evaluate(f, a);
      const shot = name => process.env.DOORWAYS_SHOTS && page.screenshot({ path: `${process.env.DOORWAYS_SHOTS}/${name}.png` });
      const settle = async t => { for (let i = 0; i < 100 && (await run(() => doorwaysDebug.t)) !== t; i++) await wait(100); };
      // The headless browser draws slowly (a frame can take a few hundred ms): wait for what an event does at the next frame.
      const until = async (f, a) => { for (let i = 0; i < 80; i++) { const v = await run(f, a); if (v) return v; await wait(100); } return run(f, a); };
      const view = () => run(() => Array.from(clay.views[0].viewMatrix));
      await page.goto(url.href);
      await page.getByText('doorways', { exact: true }).click();
      await page.evaluate(() => document.querySelector('details')?.removeAttribute('open'));
      await wait(3000);

      // The scene starts as the giant, in its own view, with the level of the seed.
      assert.deepEqual(await run(() => [doorwaysDebug.role, doorwaysDebug.t]), ['giant', 0]);
      const info = await run(() => ({ seed: doorwaysDebug.level.seed, rooms: doorwaysDebug.level.rooms.length, goal: doorwaysDebug.level.goal, won: doorwaysDebug.state.won, mini: doorwaysDebug.state.mini }));
      console.log('level', JSON.stringify(info));
      assert.ok(info.seed >= 7 && info.rooms === 8 && !info.won && info.mini === 'entrance', 'a level, solved by nobody yet');
      assert.equal(await run(() => doorwaysDebug.panel.goalSymbol), await run(() => doorwaysDebug.level.goalSymbol), 'the task card names the goal symbol');
      await shot('giant');

      // Page-side helpers: a free cell, a movable room, where a table point is on the screen.
      await run(async () => {
         const R = await import('/js/scenes/doorways/rules.js'), cg = await import('/js/render/core/cg.js');
         window.T = {
            R, cg,
            free: () => R.CELLS.filter(c => !Object.values(doorwaysDebug.state.at).some(a => a.slot === c)),
            movable: skip => doorwaysDebug.level.rooms.find(r => r.id !== skip && R.movable(doorwaysDebug.level, doorwaysDebug.state, r.id)).id,
            screen: p => {
               const v = clay.views[0], m = cg.mMultiply(cg.mMultiply(v.projectionMatrix, v.viewMatrix), cg.mMultiply(cg.mInverse(clay.inverseRootMatrix), doorwaysDebug.frame));
               const q = cg.mTransform(m, p), r = clay.gl.canvas.getBoundingClientRect();
               return [r.left + (q[0] + 1) / 2 * r.width, r.top + (1 - q[1]) / 2 * r.height];
            },
            roof: id => { const c = R.slotCentre(doorwaysDebug.state.at[id].slot); return [c[0], R.ROOM.WALL + .2 / 12, c[2]]; },
         };
      });

      // hold + release over a free cell moves the room there; over nothing it goes back.
      const id = await run(() => T.movable()), was = await run(id => doorwaysDebug.state.at[id], id);
      const cell = await run(() => T.free()[0]);
      await run(([id, cell]) => doorwaysDebug.hold(id, T.cg.mMultiply(T.cg.mTranslate(T.R.slotCentre(cell)[0] + .01, .03, T.R.slotCentre(cell)[2] - .01), T.cg.mRotateY(-Math.PI / 2 + .2))), [id, cell]);
      assert.equal(await run(() => doorwaysDebug.held.id), id);
      await shot('held');
      await run(() => doorwaysDebug.release());
      const now = await run(id => doorwaysDebug.state.at[id], id);
      console.log('moved', id, JSON.stringify(was), '->', JSON.stringify(now));
      assert.deepEqual(now, { slot: cell, rot: 1 }, 'the room snapped to the free cell, turned a quarter');
      assert.equal(await run(() => doorwaysDebug.held), null);
      await run(id => doorwaysDebug.hold(id, T.cg.mTranslate(.3, .03, .3)), id);
      await run(() => doorwaysDebug.release());
      assert.deepEqual(await run(id => doorwaysDebug.state.at[id], id), now, 'nowhere near a slot: back where it was');

      // A room that cannot be lifted (its stake is still there) is not held.
      const anchored = await run(() => doorwaysDebug.level.rooms.find(r => r.anchor)?.id);
      assert.ok(anchored, 'the level has an anchored room');
      await run(id => doorwaysDebug.hold(id, T.cg.mTranslate(0, .03, 0)), anchored);
      assert.equal(await run(() => doorwaysDebug.held), null, 'an anchored room stays');

      // A drag with the mouse on a room moves it, the view stays; a drag on empty space turns the view.
      const mover = await run(() => T.movable()), free = await run(() => T.free()[0]);
      const from = await run(id => T.screen(T.roof(id)), mover);
      const to = await run(([cell]) => { const c = T.R.slotCentre(cell); return T.screen([c[0], T.R.ROOM.WALL + .2 / 12 + .03, c[2]]); }, [free]);
      const view0 = await view();
      // The viewer's canvas listeners set window.mouseZ on a press; headless, the viewer's own turning is off (its
      // update is commented out in immersive-pre.js), so what shows that an event reached it is mouseZ, not the matrix.
      await run(() => { window.mouseZ = 0; });
      await page.mouse.move(from[0], from[1]);
      await page.mouse.down();
      await until(() => doorwaysDebug.held);
      assert.equal(await run(() => doorwaysDebug.held?.id), mover, 'the mouse took the room under it');
      for (let i = 1; i <= 8; i++) { await page.mouse.move(from[0] + (to[0] - from[0]) * i / 8, from[1] + (to[1] - from[1]) * i / 8); await wait(60); }
      // The headless browser draws slowly: wait until the held room has caught up with the cursor.
      for (let i = 0; i < 60 && !(await run(cell => { const m = doorwaysDebug.held?.m, c = T.R.slotCentre(cell); return m && Math.hypot(m[12] - c[0], m[14] - c[2]) < .09; }, free)); i++) await wait(100);
      console.log('drag', JSON.stringify(from), JSON.stringify(to), free, await run(() => doorwaysDebug.held && Array.from(doorwaysDebug.held.m.slice(12, 15))));
      await shot('drag');
      await page.mouse.up();
      await until(() => !doorwaysDebug.held);
      assert.equal(await run(id => doorwaysDebug.state.at[id].slot, mover), free, 'the dragged room is in the cell it was let go over');
      assert.deepEqual(await view(), view0, 'the view did not turn');
      assert.equal(await run(() => window.mouseZ), 0, 'the press on a room never reached the viewer');
      await page.mouse.move(700, 120); await page.mouse.down();
      assert.equal(await run(() => window.mouseZ), 1, 'a press on empty space reaches the viewer, which turns the view');
      for (let i = 1; i <= 6; i++) { await page.mouse.move(700 + i * 12, 120 + i * 6); await wait(60); }
      assert.equal(await run(() => window.mouseX), 700 + 6 * 12, 'and so does the drag');
      assert.equal(await run(() => doorwaysDebug.held), null, 'nothing is held');
      await page.mouse.up(); await wait(200);

      // Q and E turn a room held with the mouse a quarter at a time.
      const turner = await run(() => T.movable()), turnAt = await run(id => T.screen(T.roof(id)), turner), rot0 = await run(id => doorwaysDebug.state.at[id].rot, turner);
      await page.mouse.move(turnAt[0], turnAt[1]); await page.mouse.down();
      await until(() => doorwaysDebug.held);
      const m0 = await run(() => doorwaysDebug.held.m.join());
      await page.keyboard.press('KeyE');
      await until(m => doorwaysDebug.held.m.join() !== m, m0);
      await page.mouse.up();
      await until(() => !doorwaysDebug.held);
      assert.equal(await run(id => doorwaysDebug.state.at[id].rot, turner), (rot0 + 1) % 4, 'E turned the held room a quarter');

      // V flies to the mini's view: the world is 12 times bigger; the mini starts in the entrance.
      await page.keyboard.press('KeyV');
      await wait(600);
      const mid = await run(() => doorwaysDebug.t);
      assert.ok(mid > 0 && mid < 1, 'mid-flight t ' + mid);
      await shot('mid');
      await settle(1);
      assert.deepEqual(await run(() => [doorwaysDebug.role, doorwaysDebug.t]), ['mini', 1]);
      assert.ok(Math.abs(await run(() => doorwaysDebug.scale) - 12) < 1e-6, 'the world is 12 times bigger');
      assert.equal(await run(() => doorwaysDebug.panel.role), 'mini');
      await shot('mini');

      // W walks the mini, over the floors, and not the camera (the framework's W would move it).
      await run(() => { window.docKeys = 0; document.addEventListener('keydown', e => { if (e.code === 'KeyW') window.docKeys++; }); });
      const eyeBefore = await run(() => Array.from(clay.views[0].viewMatrix)), start = await run(() => [...doorwaysDebug.feet]);
      await page.keyboard.down('KeyW');
      const dry = [];
      for (let i = 0; i < 12; i++) { await wait(150); dry.push(await run(() => doorwaysDebug.onFloor())); }
      await page.keyboard.up('KeyW');
      const end = await run(() => [...doorwaysDebug.feet]);
      console.log('walked', JSON.stringify(start), JSON.stringify(end));
      assert.ok(end[0] - start[0] > .01, 'the mini walked east');
      assert.ok(dry.every(Boolean), 'always over a floor');
      assert.deepEqual(await run(() => Array.from(clay.views[0].viewMatrix)), eyeBefore, 'the camera did not move');
      assert.equal(await run(() => window.docKeys), 0, 'W never reached the viewer');
      await shot('walked');

      // F at a switch presses it, and the stake of its colour goes: the anchored room can be lifted.
      const sw = await run(() => doorwaysDebug.level.rooms.find(r => r.switch));
      const stake = await run(c => doorwaysDebug.level.rooms.find(r => r.anchor === c).id, sw.switch);
      assert.equal(await run(id => T.R.movable(doorwaysDebug.level, doorwaysDebug.state, id), stake), false);
      await run(([id]) => doorwaysDebug.put(id, [.3 * .18, -.3 * .18]), [sw.id]);
      assert.equal(await run(() => doorwaysDebug.state.mini), sw.id);
      await wait(300);
      await page.keyboard.press('KeyF');
      await until(c => doorwaysDebug.state.pressed.includes(c), sw.switch);
      assert.ok(await run(c => doorwaysDebug.state.pressed.includes(c), sw.switch), 'the switch is pressed');
      assert.equal(await run(id => T.R.movable(doorwaysDebug.level, doorwaysDebug.state, id), stake), true, 'the stake is gone');
      await shot('pressed');

      // A teleport to a room it cannot reach is refused; one to a room it can reach goes.
      const reach = await run(() => [...T.R.reachable(doorwaysDebug.level, doorwaysDebug.state)]);
      const far = await run(() => doorwaysDebug.level.rooms.find(r => !T.R.reachable(doorwaysDebug.level, doorwaysDebug.state).has(r.id)).id);
      const at0 = await run(() => [...doorwaysDebug.feet]);
      assert.equal(await run(id => doorwaysDebug.go(id), far), false, 'not reachable: refused');
      assert.deepEqual(await run(() => [...doorwaysDebug.feet]), at0, 'the mini did not move');
      const here = await run(() => doorwaysDebug.state.mini), other = reach.find(r => r !== here);
      if (other) {
         assert.equal(await run(id => doorwaysDebug.go(id), other), true, 'reachable: goes');
         assert.equal(await run(() => doorwaysDebug.state.mini), other);
      }

      // The mini in a room the giant holds and turns is still in it after the snap. Every check waits for frames to have run
      // since the event (doorwaysDebug.frames), for the mini's place is only recomputed at a frame.
      const frames = () => run(() => doorwaysDebug.frames);
      const later = async () => { const f = await frames(); await until(f => doorwaysDebug.frames > f + 1, f); };
      const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
      // Where the mini should be: the room's settled pose (table frame) applied to its place in the room.
      const expected = (id, local) => run(([id, local]) => { const a = doorwaysDebug.state.at[id]; return T.cg.mTransform(T.R.slotPose(a.slot, a.rot), local); }, [id, local]);
      const same = (a, b, what) => a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) < 1e-6, what + ' ' + JSON.stringify([a, b])));
      await page.keyboard.press('KeyV'); await settle(0);
      const R1 = await run(() => T.movable(doorwaysDebug.state.mini)), spot = await run(() => T.free()[0]);
      await run(id => doorwaysDebug.put(id, [.04, -.03]), R1);
      await later();
      const before = await run(id => ({ at: doorwaysDebug.state.at[id], local: [...doorwaysDebug.mini.local] }), R1);
      assert.equal(await run(() => doorwaysDebug.state.mini), R1);
      await run(([id, cell, rot]) => doorwaysDebug.hold(id, T.cg.mMultiply(T.cg.mTranslate(T.R.slotCentre(cell)[0] + .02, .05, T.R.slotCentre(cell)[2]), T.cg.mRotateY(-rot * Math.PI / 2 + .1))), [R1, spot, before.at.rot + 1]);
      await later();
      assert.equal(await run(() => doorwaysDebug.state.mini), R1);
      assert.ok(await run(id => doorwaysDebug.tilt.some((v, i) => Math.abs(v - [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1][i]) > 1e-3), R1), 'the avatar is carried with the held room');
      await shot('riding');
      await run(() => doorwaysDebug.release());
      await later();
      const after = await run(id => ({ at: doorwaysDebug.state.at[id], mini: doorwaysDebug.state.mini, local: [...doorwaysDebug.mini.local], feet: [...doorwaysDebug.feet] }), R1);
      console.log('rode', JSON.stringify(before), JSON.stringify(after));
      assert.deepEqual(after.at, { slot: spot, rot: (before.at.rot + 1) % 4 });
      assert.equal(after.mini, R1, 'the mini is still in the room');
      same(after.local, before.local, 'the same place in the room');
      same(after.feet, await expected(R1, before.local), 'the feet are where that place is in the room as it is set down');
      assert.deepEqual(await run(() => doorwaysDebug.tilt), identity, 'set down: no tilt');
      assert.equal(await run(() => doorwaysDebug.onFloor()), true);

      // Let go nowhere near a slot: the room goes back, and the mini is still in it at the same place.
      await run(id => doorwaysDebug.hold(id, T.cg.mMultiply(T.cg.mTranslate(.3, .03, .3), T.cg.mRotateY(.7))), R1);
      await later();
      assert.ok(await run(() => doorwaysDebug.tilt.some((v, i) => Math.abs(v - [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1][i]) > 1e-3)), 'carried far from any slot');
      await run(() => doorwaysDebug.release());
      await later();
      const back = await run(id => ({ at: doorwaysDebug.state.at[id], mini: doorwaysDebug.state.mini, local: [...doorwaysDebug.mini.local], feet: [...doorwaysDebug.feet] }), R1);
      assert.deepEqual(back.at, after.at, 'no slot there: back where it was');
      assert.equal(back.mini, R1);
      same(back.local, before.local, 'the same place in the room after it went back');
      same(back.feet, await expected(R1, before.local), 'and the feet with it');
      assert.equal(await run(() => doorwaysDebug.onFloor()), true);

      // Carried into the depot, the mini is on an island: it can walk about the room (its feet change) and stays in it.
      const pad = await run(() => T.R.DEPOT.find(d => !Object.values(doorwaysDebug.state.at).some(a => a.slot === d)));
      assert.ok(pad, 'a depot slot is free');
      await run(([id, d]) => doorwaysDebug.hold(id, T.cg.mTranslate(T.R.slotCentre(d)[0], .03, T.R.slotCentre(d)[2])), [R1, pad]);
      await run(() => doorwaysDebug.release());
      await later();
      assert.equal(await run(id => doorwaysDebug.state.at[id].slot, R1), pad, 'the room is in the depot');
      assert.equal(await run(() => doorwaysDebug.state.mini), R1, 'the mini went with it');
      assert.equal(await run(() => doorwaysDebug.onFloor()), true, 'and it is over a floor there');
      await run(id => doorwaysDebug.put(id, [0, 0]), R1);
      await page.keyboard.press('KeyV'); await settle(1);
      const island = await run(() => [...doorwaysDebug.feet]);
      await page.keyboard.down('KeyW');
      await until(i => Math.hypot(doorwaysDebug.feet[0] - i[0], doorwaysDebug.feet[2] - i[2]) > .01, island);
      await later();
      await page.keyboard.up('KeyW');
      const walked = await run(() => ({ feet: [...doorwaysDebug.feet], mini: doorwaysDebug.state.mini, floor: doorwaysDebug.onFloor() }));
      console.log('on the island', JSON.stringify(island), JSON.stringify(walked));
      assert.ok(Math.hypot(walked.feet[0] - island[0], walked.feet[2] - island[2]) > .005, 'the mini walked in the depot room');
      assert.equal(walked.mini, R1, 'and is still in it');
      assert.ok(walked.floor, 'over its floor');
      const padAt = await run(d => T.R.slotCentre(d), pad);
      assert.ok(Math.abs(walked.feet[0] - padAt[0]) < .09 && Math.abs(walked.feet[2] - padAt[2]) < .09, 'inside the pad');
      assert.equal(await run(id => doorwaysDebug.go(id), R1), true, 'a teleport within the room is allowed');
      await page.keyboard.press('KeyV'); await settle(0);

      // An empty chest costs 20 s; the goal chest wins; N starts a new round.
      await page.keyboard.press('KeyV'); await settle(1);
      const empty = await run(() => doorwaysDebug.level.rooms.find(r => r.chest && r.id !== doorwaysDebug.level.goal).id);
      await run(id => doorwaysDebug.put(id, [0, 0]), empty);
      assert.equal(await run(() => doorwaysDebug.act('open')), true);
      assert.equal(await run(() => doorwaysDebug.state.penalty), 20, 'an empty chest costs 20 s');
      assert.equal(await run(() => doorwaysDebug.state.won), false);
      await run(() => doorwaysDebug.put(doorwaysDebug.level.goal, [0, 0]));
      assert.equal(await run(() => doorwaysDebug.act('open')), true);
      assert.equal(await run(() => doorwaysDebug.state.won), true, 'the goal chest wins');
      await until(() => /treasure/i.test(doorwaysDebug.panel.message));
      assert.match(await run(() => doorwaysDebug.panel.message), /treasure/i);
      // The wrist panel's picture is redrawn every 7th frame, and a frame takes long here: let it catch up before the shot.
      const drawn = await run(() => doorwaysDebug.frames);
      await until(f => doorwaysDebug.frames > f + 16, drawn);
      await shot('won');
      // The round is over: another chest adds no 20 s, and the clock stays where it stopped.
      const another = await run(() => doorwaysDebug.level.rooms.find(r => r.chest && r.id !== doorwaysDebug.level.goal && !doorwaysDebug.state.opened.includes(r.id))?.id);
      assert.ok(another, 'a chest that is still shut');
      const frozen = await run(() => doorwaysDebug.time);
      await run(id => doorwaysDebug.put(id, [0, 0]), another);
      assert.equal(await run(() => doorwaysDebug.act('open')), false, 'no chest opens after the win');
      assert.deepEqual(await run(() => [doorwaysDebug.state.penalty, doorwaysDebug.state.won, doorwaysDebug.state.opened.length]), [20, true, 2]);
      assert.equal(await run(() => doorwaysDebug.time), frozen, 'the final time is frozen');
      const seed0 = await run(() => doorwaysDebug.level.seed);
      await page.keyboard.press('KeyN');
      await until(() => !doorwaysDebug.state.won);
      assert.deepEqual(await run(() => [doorwaysDebug.state.won, doorwaysDebug.state.penalty, doorwaysDebug.state.mini]), [false, 0, 'entrance'], 'a new round');
      assert.notEqual(await run(() => doorwaysDebug.level.seed), seed0);
      await wait(500);
      assert.doesNotMatch(await run(() => doorwaysDebug.panel.message), /treasure|lost/i, 'the win does not stick into the next round');
      await shot('new-round');

      // Leaving the scene gives back its texture channels and GL textures; coming back takes only what its level needs.
      const held = await run(() => ({ mine: doorwaysDebug.textures, count: window.txtrChannel.length }));
      assert.ok(held.mine.length >= 2, 'the panel and at least one symbol have a channel: ' + held.mine);
      await page.getByText('simple', { exact: true }).click();
      await until(() => !window.doorwaysDebug);
      const left = await run(ch => ({ channels: ch.filter(c => window.txtrChannel.includes(c)), canvases: ch.filter(c => window._canvas_txtr[c]), count: window.txtrChannel.length }), held.mine);
      assert.deepEqual([left.channels, left.canvases], [[], []], 'the channels are free again');
      assert.ok(left.count <= held.count - held.mine.length, `${left.count} channels left of ${held.count}`);
      await page.getByText('doorways', { exact: true }).click();
      await until(() => window.doorwaysDebug?.frames > 2);
      assert.equal(await run(() => window.txtrChannel.length), left.count + (await run(() => doorwaysDebug.textures.length)), 'only its own channels are taken again, none left over from before');


      assert.deepEqual(errors, []);
      console.log('doorways browser test (one page) passed');
      await page.close();
      await twoPlayers(browser, url);
      console.log('doorways browser test passed');
   } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exit(1); });
