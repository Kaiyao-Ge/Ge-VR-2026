// Optional Playwright test; uses an isolated classroom-style WebSocket relay.
// Run with NODE_PATH pointing to an installation containing playwright.
// Start the app server first; XR_TEST_URL defaults to http://localhost:2026/.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');

(async () => {
   const browser = await chromium.launch({ headless: true,
      args: ['--no-sandbox', '--enable-unsafe-swiftshader'] });
   const pages = [], peers = [], errors = [];
   const url = new URL(process.env.XR_TEST_URL || 'http://localhost:2026/');
   url.searchParams.set('spellcodeRoom', 'BROWSER_TEST');
   const socketURL = `${url.protocol === 'https:' ? 'wss:' : 'ws:'}//${url.host}/`;
   try {
      for (let id = 0; id < 2; id++) {
         const page = await browser.newPage(); pages.push(page);
         await page.addInitScript(() => {
            const pending = [], raf = window.requestAnimationFrame.bind(window);
            window.requestAnimationFrame = callback => raf(time => {
               if (window.suspendFrames) pending.push(() => window.requestAnimationFrame(callback));
               else callback(time);
            });
            // Desktop preview also uses the inline XR session's frame callback.
            if (window.XRSession) {
               const xrRAF = XRSession.prototype.requestAnimationFrame;
               XRSession.prototype.requestAnimationFrame = function(callback) {
                  return xrRAF.call(this, (time, frame) => {
                     if (window.suspendFrames) pending.push(() => xrRAF.call(this, callback));
                     else callback(time, frame);
                  });
               };
            }
            window.resumeFrames = () => {
               window.suspendFrames = false;
               for (const resume of pending.splice(0)) resume();
            };
         });
         page.on('pageerror', e => {
            if (!['Empty gltf model', 'Requested device not found'].includes(e.message)) errors.push(e.message);
         });
         page.on('console', m => {
            if (m.type() === 'error' && m.text().includes('Error in animate()')) errors.push(m.text());
         });
         await page.routeWebSocket(socketURL, socket => {
            peers[id] = socket;
            socket.send(JSON.stringify({ type: 'welcome', clientID: id }));
            for (const peer of peers) peer.send(JSON.stringify({ global: 'clients', value: peers.map((_, i) => i) }));
            socket.onMessage(data => { for (const peer of peers) if (peer !== socket) peer.send(data); });
         });
         // Expose local UI only in the intercepted test response, not production.
         await page.route('**/js/scenes/spellcode.js*', async route => {
            const response = await route.fetch();
            await route.fulfill({ response, body: (await response.text()).replace('const ui = {', 'const ui = window.testUI = {') });
         });
         await page.goto(url.href);
         await page.getByText('spellcode', { exact: true }).waitFor();
         await page.evaluate(async () => {
            const { Session } = await import('/js/scenes/spellcode/session.js');
            const tick = Session.prototype.tick;
            Session.prototype.tick = function(...args) {
               window.testSession = this;
               window.testFrames = (window.testFrames || 0) + 1;
               if (window.testFire && this.role === 'shooter' && this.game.enemies.length) {
                  const origin = [0, 1.5, 0];
                  const delta = this.game.enemies[0].position.map((value, i) => value - origin[i]);
                  args[1] = { right: { origin, direction: delta.map(value => value / Math.hypot(...delta)) } };
                  this.game.press('right'); window.testFire = false;
               }
               return tick.apply(this, args);
            };
         });
         await page.getByText('spellcode', { exact: true }).click();
         await page.waitForFunction(() => window.testUI);
         await page.keyboard.press(id === 0 ? '1' : '2');
      }
      await Promise.all(pages.map(page => page.waitForFunction(() => window.testSession && !testSession.waiting)));
      assert.equal(await pages[1].evaluate(() => testUI.editorOpen), true);
      for (const page of pages) {
         await page.evaluate(() => {
            window.sessionBeforeFocus = testSession;
            window.dispatchEvent(new Event('blur'));
            window.dispatchEvent(new Event('focus'));
         });
      }
      // A focus-triggered dynamic import/reset is asynchronous.
      await pages[0].waitForTimeout(1000);
      for (let id = 0; id < pages.length; id++) {
         assert.deepEqual(await pages[id].evaluate(() => ({ mode: testUI.mode,
            role: testUI.role, sameSession: testSession === sessionBeforeFocus })),
            { mode: 'coop', role: id === 0 ? 'shooter' : 'editor', sameSession: true });
         assert.equal(await pages[id].getByText('Reload', { exact: true }).count(), 1);
      }
      await pages[0].keyboard.press('Enter');
      await pages[0].waitForFunction(() => testSession.game.enemies.length > 0, null, { timeout: 60000 });
      const before = await pages[0].evaluate(() => testSession.game.enemies[0].distance);
      await pages[0].waitForFunction(before => testSession.game.enemies[0]?.distance < before - .1,
         before, { timeout: 30000 });
      for (const page of pages) assert.equal(await page.evaluate(() => testSession.waiting || testSession.paused), false);
      // Closing and reopening the coder panel must not pause the gunner either.
      for (const open of [false, true]) {
         await pages[1].keyboard.press('Tab');
         await pages[1].waitForFunction(open => testUI.editorOpen === open, open);
         const time = await pages[0].evaluate(() => testSession.game.time);
         await pages[0].waitForFunction(time => testSession.game.time > time + .1, time);
      }
      await pages[0].evaluate(() => { window.testFire = true; });
      await pages[0].waitForFunction(() => testSession.game.kills === 1);
      await pages[1].evaluate(() => {
         window.dispatchEvent(new Event('blur'));
         window.suspendFrames = true;
      });
      await pages[0].waitForTimeout(500);
      const stopped = await pages[1].evaluate(() => testFrames);
      const time = await pages[0].evaluate(() => testSession.game.time);
      // Longer than the three-second heartbeat timeout; no coder frame runs.
      await pages[0].waitForTimeout(5000);
      assert.equal(await pages[1].evaluate(() => testFrames), stopped);
      assert.equal(await pages[0].evaluate(() => testSession.waiting || testSession.paused), false);
      assert.ok(await pages[0].evaluate(() => testSession.game.time) > time);
      assert.equal(await pages[1].evaluate(() => testSession.waiting), false);
      await pages[1].evaluate(() => { resumeFrames(); window.dispatchEvent(new Event('focus')); });
      await pages[1].waitForFunction(stopped => testFrames > stopped, stopped);
      assert.equal(await pages[1].evaluate(() => testSession === sessionBeforeFocus), true);
      assert.deepEqual(errors, []);
      console.log('ok - focus, panel toggles and five seconds without coder frames preserve pairing and battle progress');
   } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
