// Optional Playwright test: Miniature on the desktop, served by the app server
// (start it first; XR_TEST_URL defaults to http://localhost:2026/): V flies to
// the avatar's view and back, I walks the avatar up to the house, the shut door stops it, an open door
// lets it in, T aims a teleport, the lamp and the roof answer to hands, a synthetic scanned room (no depth here, so
// it is handed to the scene) is drawn in place of the box room and moves the table, and no page errors. MINIATURE_SHOTS=dir saves screenshots of the views there.
// Run with NODE_PATH pointing to an installation containing playwright.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
(async () => {
   const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
   const errors = [];
   const url = new URL(process.env.XR_TEST_URL || 'http://localhost:2026/');
   const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
   const known = /Empty gltf|Requested device not found|404/;
   page.on('pageerror', e => { if (!known.test(e.message)) errors.push(e.message); });
   page.on('console', m => { if (m.type() === 'error' && !known.test(m.text())) errors.push(m.text()); });
   const wait = ms => page.waitForTimeout(ms), run = f => page.evaluate(f);
   const shot = name => process.env.MINIATURE_SHOTS && page.screenshot({ path: `${process.env.MINIATURE_SHOTS}/${name}.png` });
   const settle = async t => { for (let i = 0; i < 80 && (await run(() => window.miniatureDebug.t)) !== t; i++) await wait(100); };
   await page.goto(url.href);
   await page.getByText('miniature', { exact: true }).click();
   await page.evaluate(() => document.querySelector('details')?.removeAttribute('open'));
   await wait(3000);
   assert.deepEqual(await run(() => [miniatureDebug.mode, miniatureDebug.t]), ['player', 0]);
   await shot('player');

   // Fly in: mid-way the world is part grown; then the avatar's view.
   await page.keyboard.press('KeyV');
   await wait(600);
   const mid = await run(() => miniatureDebug.t);
   assert.ok(mid > 0 && mid < 1, 'mid-flight t ' + mid);
   await shot('mid');
   await settle(1);
   assert.deepEqual(await run(() => [miniatureDebug.mode, miniatureDebug.t]), ['avatar', 1]);
   await shot('avatar');

   // The house stands in the middle of the table with its front to the near end, and the avatar starts in line with the door, facing it:
   // the door's middle is 1 m (1/12 m of table) to the left of the house's middle, the porch 1.6 m (13 cm) deep.
   const U = 1 / 12, y0 = await run(() => miniatureDebug.world.table.p[1]), table = await run(() => miniatureDebug.world.onTable([0, 0]));
   const start = await run(() => [...miniatureDebug.stand.p]);
   console.log('start', JSON.stringify(start));
   assert.ok(Math.abs(start[0] - (table[0] - .55)) < 1e-6 && Math.abs(start[2] - (table[2] - U)) < 1e-6 && Math.abs(start[1] - y0) < 1e-9, 'the avatar starts in front of the door');
   // Walking (I) moves the avatar towards the house, straight, along the table. The headless browser runs slowly, so
   // it walks until it has stopped moving, or done (the stand's x is past done), or a time is up.
   const walkFor = async (ms, done = Infinity) => {
      let last = null, same = 0;
      await page.keyboard.down('KeyI');
      for (let t = 0; t < ms && same < 4; t += 250) {
         await wait(250);
         const p = await run(() => [...miniatureDebug.stand.p]);
         if (p[0] > done) break;
         same = last && Math.hypot(p[0] - last[0], p[2] - last[2]) < 1e-6 ? same + 1 : 0;
         last = p;
      }
      await page.keyboard.up('KeyI'); await wait(200);
      return run(() => [...miniatureDebug.stand.p]);
   };
   await page.keyboard.down('KeyI'); await wait(1500); await page.keyboard.up('KeyI');
   const after = await run(() => [...miniatureDebug.stand.p]);
   console.log('walked', JSON.stringify(start), JSON.stringify(after));
   assert.ok(after[0] - start[0] > .005, 'the avatar walked');
   assert.ok(Math.abs(after[1] - y0) < 1e-9 && Math.abs(after[2] - start[2]) < 1e-6, 'straight, on the table');

   // T aims a teleport along the view, a little down: from the avatar's eye it lands in front of the house, at the foot of the steps.
   await page.keyboard.down('KeyT');
   for (let i = 0; i < 50 && !(await run(() => miniatureDebug.target)); i++) await wait(100);
   await wait(300);
   const target = await run(() => miniatureDebug.target);
   console.log('teleport target', JSON.stringify(target));
   assert.ok(target && target.p[0] > table[0] - .4 && target.p[0] < table[0] - 2.4 * U, 'the ray finds the ground in front of the house');
   await shot('aim');
   await page.keyboard.up('KeyT');
   for (let i = 0; i < 100 && (await run(() => miniatureDebug.target)); i++) await wait(100);
   await wait(300);
   const landed = await run(() => [...miniatureDebug.stand.p]);
   assert.ok(Math.hypot(landed[0] - target.p[0], landed[2] - target.p[2]) < 1e-6, 'the avatar landed on the target: ' + JSON.stringify([landed, target.p]));
   assert.equal(await run(() => miniatureDebug.target), null);

   // On the porch (0.4 m up) in front of the shut door, which stops it at the wall (the front wall's face is x = -.2 on the table, one radius off).
   await run(() => { const m = miniatureDebug.mapping; m.setStand(miniatureDebug.world.onTable([-.25, -1 / 12]), m.stand.yaw); });
   const stopped = await walkFor(20000);
   console.log('against the door', JSON.stringify(stopped));
   assert.ok(Math.abs(stopped[0] - (table[0] - 2.4 * U - .25 * U)) < .0006 && Math.abs(stopped[1] - (y0 + .4 * U)) < 1e-6, 'stopped by the shut door, on the porch');
   await shot('door');

   // The avatar's hand on the handle opens it, over 0.6 s; then it walks in through it. A hand out of reach does nothing.
   const touch = (p, extra) => page.evaluate(([p, extra]) => miniatureDebug.object.update({ mode: miniatureDebug.mode, dt: 0, hands: [{ hand: 'right', p: p.map(v => v / 12), ray: { o: [0, 0, 0], d: [0, 0, 1] }, ...extra }] }), [p, extra]);
   await touch([-.65, 1.4, 1], { pressed: true });
   assert.equal(await run(() => miniatureDebug.object.state.doorOpen), false);
   await touch([-.65, 1.4, 2.325], { pressed: true });
   assert.equal(await run(() => miniatureDebug.object.state.doorOpen), true);
   for (let i = 0; i < 80 && (await run(() => miniatureDebug.object.state.door)) < 1; i++) await wait(100);
   assert.equal(await run(() => miniatureDebug.object.state.door), 1);
   await shot('open');
   const door = table[0] - 2.4 * U, inside = await walkFor(30000, door + .0208 + .02);
   console.log('inside', JSON.stringify(inside));
   assert.ok(inside[0] > door + .0208 + .01 && Math.abs(inside[1] - (y0 + .4 * U)) < 1e-6, 'walked in through the open door');
   // The switch by the door lights the lamp.
   await touch([-.2, 1.7, 2.25], { pressed: true });
   assert.equal(await run(() => miniatureDebug.object.state.lamp), true);
   await wait(300);
   await shot('inside');

   // The giant's trigger on the roof lifts it off, and the same puts it back.
   await page.keyboard.press('KeyV'); await settle(0);
   await touch([0, .6, 0], { pressed: true, ray: { o: [0, .45, .4], d: [0, -.2 / Math.hypot(.2, 1), -1 / Math.hypot(.2, 1)] } });
   assert.equal(await run(() => miniatureDebug.object.state.roofOff), true);
   for (let i = 0; i < 80 && (await run(() => miniatureDebug.object.state.roof)) < 1; i++) await wait(100);
   await shot('roof-off');
   await touch([0, .5, -5.7], { pressed: true });
   assert.equal(await run(() => miniatureDebug.object.state.roofOff), false);
   for (let i = 0; i < 80 && (await run(() => miniatureDebug.object.state.roof)) > 0; i++) await wait(100);

   // Fly in and out again.
   await page.keyboard.press('KeyV'); await settle(1);
   // Fly out.
   await page.keyboard.press('KeyV');
   await settle(0);
   assert.deepEqual(await run(() => [miniatureDebug.mode, miniatureDebug.t]), ['player', 0]);
   await shot('back');

   // The scan itself: a Scanner with the real fuse worker, but a depth reader of ours that sees a 6 x 2.6 x 6 m room with a table in it
   // from one spot, looking round. It must scan, ask for the room once and get it, keep its frames in flight within bounds, find the table, and scan again.
   const flow = await page.evaluate(async () => {
      const { Scanner } = await import('/js/scenes/miniature/scanner.js');
      const { pickTable } = await import('/js/scenes/miniature/scanned.js');
      const S = new Scanner(clay.gl), session = {}, eye = [0, 1.6, 0], I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
      const hit = (o, d) => {
         let best = Infinity;
         const box = [[-3, 3], [0, 2.6], [-3, 3]];
         for (let a = 0; a < 3; a++) for (const bound of box[a]) {
            const t = (bound - o[a]) / d[a];
            if (t > 0 && t < best && o.every((v, k) => { const q = v + d[k] * t; return k === a || q >= box[k][0] - 1e-6 && q <= box[k][1] + 1e-6; })) best = t;
         }
         const t = (.74 - o[1]) / d[1], x = o[0] + d[0] * t, z = o[2] + d[2] * t;
         return d[1] < 0 && t > 0 && t < best && x > -.7 && x < .7 && z > -1.3 && z < -.7 ? t : best;
      };
      let n = 0;
      S.reader = { session, queue: [], capture() { this.queue.push(n++); }, dispose() {}, poll() {
         return this.queue.splice(0).map(k => {
            const points = [];
            for (let j = 0; j < 80; j++) for (let i = 0; i < 80; i++) {
               const a = k * .13 + (i / 79 - .5) * 1.5 + (k * .618 % 1) / 79 * 1.5, b = .35 - j / 79 * 1.4 + (k * .7549 % 1) / 79 * 1.4;
               const d = [Math.sin(a) * Math.cos(b), Math.sin(b), -Math.cos(a) * Math.cos(b)], t = hit(eye, d);
               if (t < 6) points.push(eye[0] + d[0] * t, eye[1] + d[1] * t, eye[2] + d[2] * t);
            }
            return { points, origin: [...eye] };
         });
      } };
      const frame = { getViewerPose: () => ({ views: [{}] }) }, out = {};
      let now = 0, inflight = 0;
      S.start(session, eye, now);
      out.started = S.state;
      S.start(session, eye, now + 1);   // already scanning: no new start
      for (let i = 0; i < 600 && S.busy; i++) {
         S.update(frame, {}, eye, I, now += .07);
         inflight = Math.max(inflight, S.inflight);
         await new Promise(r => setTimeout(r, 15));
      }
      for (let i = 0; i < 300 && S.state === 'meshing'; i++) await new Promise(r => setTimeout(r, 50));
      const room = S.take();
      Object.assign(out, { state: S.state, inflight, left: S.inflight, again: S.take(), got: !!room, frames: S.frames });
      if (room) out.table = pickTable(room, eye, [0, -1]);
      S.start(session, eye, now += 1);   // scan again
      out.restarted = S.state;
      S.cancel();
      out.cancelled = S.state;
      S.dispose();
      return out;
   });
   console.log('scan flow', JSON.stringify({ ...flow, table: flow.table && { p: flow.table.p, size: flow.table.size } }));
   assert.equal(flow.started, 'scanning');
   assert.ok(flow.got && flow.state === 'done' && flow.again === null && flow.frames > 100, 'the scan ends with one room');
   assert.ok(flow.inflight <= 40 && flow.left === 0, 'every frame sent was acknowledged');
   assert.ok(flow.table && Math.hypot(flow.table.p[0], flow.table.p[2] + 1) < .15 && Math.abs(flow.table.p[1] - .74) < .05 && Math.abs(flow.table.size[0] - 1.4) < .2, 'the table in it is found');
   assert.deepEqual([flow.restarted, flow.cancelled], ['scanning', 'idle']);

   // A scanned room, made here (the desktop has no depth): a floor, walls and a ceiling in a room frame turned by 0.3 rad, a table
   // 1.4 x 0.6 m about a metre in front of me and a sofa, on a 4 cm lattice; more triangles than the scene draws, wound every which way.
   const scanned = () => page.evaluate(async () => {
      const { STRIDE, toWorld } = await import('/js/scenes/echohunt/room.js');
      const yaw = .3, V = [], I = [], index = new Map();
      const W = p => toWorld({ yaw }, p);
      const quad = (o, u, v, n, nu, nv) => {
         for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
            const p = [[i, j], [i + 1, j], [i + 1, j + 1], [i, j + 1]].map(([a, b]) => o.map((c, k) => c + u[k] * a / nu + v[k] * b / nv));
            // Vertices are shared where the surfaces meet, as in a fused mesh.
            const [a, b, c, d] = p.map(q => { const key = q.map(v => Math.round(v * 1e4)).join();
               if (!index.has(key)) { index.set(key, V.length / STRIDE); V.push(...W(q), ...W(n), ...new Array(STRIDE - 6).fill(0)); }
               return index.get(key); });
            I.push(...((i + j) % 2 ? [a, b, c, a, c, d] : [a, c, b, a, d, c]));
         }
      };
      const room = { min: [-3, 0, -3], max: [3, 2.6, 3] };
      quad([-3, 0, -3], [6, 0, 0], [0, 0, 6], [0, 1, 0], 150, 150);
      quad([-3, 2.6, -3], [6, 0, 0], [0, 0, 6], [0, -1, 0], 30, 30);
      quad([-3, 0, -3], [6, 0, 0], [0, 2.6, 0], [0, 0, 1], 150, 65);
      quad([-3, 0, 3], [6, 0, 0], [0, 2.6, 0], [0, 0, -1], 150, 65);
      quad([-3, 0, -3], [0, 0, 6], [0, 2.6, 0], [1, 0, 0], 150, 65);
      quad([3, 0, -3], [0, 0, 6], [0, 2.6, 0], [-1, 0, 0], 150, 65);
      const block = (a, b) => {
         const d = b.map((v, k) => v - a[k]), z = [0, 0, 0];
         const side = (axis, at, n) => { const u = [0, 1, 2].filter(k => k !== axis); const o = [...a]; o[axis] = at;
            quad(o, z.map((_, k) => k === u[0] ? d[k] : 0), z.map((_, k) => k === u[1] ? d[k] : 0), n, 4, 4); };
         [0, 1, 2].forEach(axis => { side(axis, a[axis], z.map((_, k) => k === axis ? -1 : 0)); side(axis, b[axis], z.map((_, k) => k === axis ? 1 : 0)); });
      };
      block([-.2, .70, -1.3], [1.2, .74, -.7]);
      for (const [x, z] of [[-.16, -1.28], [1.12, -1.28], [-.16, -.76], [1.12, -.76]]) block([x, 0, z], [x + .04, .70, z + .04]);
      block([1.5, 0, 1.5], [2.7, .45, 2.4]);
      room.boxes = [{ min: [-.2, .70, -1.3], max: [1.2, .74, -.7], mat: 1, plate: true }, { min: [1.5, 0, 1.5], max: [2.7, .45, 2.4], mat: 2, plate: false }];
      room.yaw = yaw;
      room.mesh = { vertices: new Float32Array(V), indices: new Uint32Array(I) };
      const table = miniatureDebug.takeRoom(room);
      return { table, tris: I.length / 3, expect: W([.5, .74, -1]) };
   });
   const { table: picked, tris, expect } = await scanned();
   console.log('scanned room', tris, 'triangles; table', JSON.stringify(picked));
   assert.ok(tris > 60000, 'more triangles than the scene may draw');
   assert.ok(picked && Math.hypot(picked.p[0] - expect[0], picked.p[2] - expect[2]) < 1e-6 && Math.abs(picked.p[1] - .74) < 1e-6, 'the table in front of me is chosen');
   assert.ok(Math.abs(picked.size[0] - 1.4) < 1e-6 && Math.abs(picked.size[1] - .6) < 1e-6, 'with its size');
   const now = await run(() => ({ p: miniatureDebug.world.table.p, size: miniatureDebug.world.table.size, scan: !!miniatureDebug.world.scan, stand: miniatureDebug.stand.p, pose: miniatureDebug.pose.slice(12, 15) }));
   assert.ok(now.scan && Math.abs(now.size[0] - 1.4) < 1e-6, 'the world has the scanned table and room');
   assert.ok(Math.abs(now.pose[0] - expect[0]) < 1e-6 && Math.abs(now.pose[2] - expect[2]) < 1e-6, 'the house is on it');
   const mesh = await run(() => { const m = miniatureDebug.world.scan; return { n: m.length / 16, ok: Array.from(m).every(Number.isFinite) }; });
   console.log('drawn mesh', JSON.stringify(mesh));
   assert.ok(mesh.ok && mesh.n % 3 === 0 && mesh.n / 3 <= 40000 && mesh.n / 3 > 10000, 'the mesh is triangles within the limit');
   // Clay packs a vertex as the scene does.
   assert.ok(await run(async () => {
      const m = miniatureDebug.world.scan, un = ab => [2 * Math.floor(ab) / 40000 - 1, 2 * (ab % 1) - 1];
      const v = Array.from(m.slice(0, 16)), nor = [3, 4, 5].map(i => un(v[i])[0]), tan = [3, 4, 5].map(i => un(v[i])[1]);
      const w = clay.vertexArray(v.slice(0, 3), nor, tan, [0, 0], clay.unpackRGB ? clay.unpackRGB(v[8]) : [1, 1, 1]);
      return w.every((x, i) => i === 8 && !clay.unpackRGB || Math.abs(x - v[i]) < 1e-3);
   }), 'the vertices are in Clay\'s layout');
   await shot('scan-player');
   await page.keyboard.press('KeyV');
   await wait(700);
   await shot('scan-mid');
   await settle(1);
   await wait(500);
   await shot('scan-avatar');
   // The room is on the GPU once, drawn by its own program: Clay's buffer is not loaded with it again every frame.
   const gpu = await run(async () => {
      const gl = clay.gl, proto = WebGL2RenderingContext.prototype, bufferData = proto.bufferData, big = [];
      proto.bufferData = function (target, data, ...rest) { if (data?.byteLength > 1e6) big.push(data.byteLength); return bufferData.call(this, target, data, ...rest); };
      await new Promise(r => setTimeout(r, 1500));
      proto.bufferData = bufferData;
      const d = miniatureDebug.scanDraw;
      return { uploads: big.length, count: d.count, source: d.source === miniatureDebug.world.scan };
   });
   console.log('scan on the gpu', JSON.stringify(gpu));
   assert.ok(gpu.source && gpu.count === mesh.n && gpu.uploads === 0, 'the scanned room was uploaded once and not again');
   await page.keyboard.down('KeyU'); await wait(1200); await page.keyboard.up('KeyU');
   await wait(300);
   await shot('scan-avatar-turned');
   await page.keyboard.press('KeyV'); await settle(0);
   await wait(300);
   await shot('scan-back');

   assert.deepEqual(errors, []);
   console.log('miniature browser test passed');
   await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
