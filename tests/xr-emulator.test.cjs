// Optional browser regression: npm install --prefix /tmp/xr-check playwright iwer
// Run with NODE_PATH=/tmp/xr-check/node_modules after installing Playwright Chromium.
// The app server must already be running; XR_TEST_URL defaults to localhost:2026.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

(async () => {
   const browser = await chromium.launch({ headless: true,
      args: ['--no-sandbox', '--enable-unsafe-swiftshader'] });
   try {
      // The classroom framework requests immersive-ar, including in IWER.
      for (const mode of ['immersive-ar']) {
         const page = await browser.newPage();
         const errors = [];
         page.on('pageerror', error => errors.push(error.message));
         const bundle = path.join(path.dirname(require.resolve('iwer')), '../build/iwer.js');
         await page.addInitScript({ content: fs.readFileSync(bundle, 'utf8') + `
            window.device = new IWER.XRDevice({ ...IWER.metaQuest3,
               supportedSessionModes: ['inline', '${mode}'] });
            device.installRuntime({ forceInstall: true });
            window.xrRequests = []; window.xrSessions = []; window.xrFrames = 0;
            const request = navigator.xr.requestSession.bind(navigator.xr);
            navigator.xr.requestSession = async (mode, options) => {
               xrRequests.push(mode);
               const session = await request(mode, options);
               xrSessions.push(session);
               const raf = session.requestAnimationFrame.bind(session);
               session.requestAnimationFrame = fn => raf((t, f) => { xrFrames++; fn(t, f); });
               return session;
            };` });
         await page.goto(process.env.XR_TEST_URL || 'http://localhost:2026/');
         await page.getByText('spellcode', { exact: true }).waitFor();
         await page.evaluate(async () => {
            const { Game } = await import('/js/scenes/spellcode/game.js');
            const takeEvents = Game.prototype.takeEvents;
            window.gameTicks = 0;
            Game.prototype.takeEvents = function(...args) {
               window.testGame = this; gameTicks++; return takeEvents.apply(this, args);
            };
         });
         // A normal click must work: the emulator must not cover the scene menu.
         await page.getByText('spellcode', { exact: true }).click();
         await page.waitForFunction(() => window.gameTicks > 3);
         assert.deepEqual(await page.evaluate(() => xrRequests), ['inline']);
         assert.equal(await page.evaluate(() => window.isXR()), false);
         await page.keyboard.press('3');
         await page.keyboard.press('1');
         await page.keyboard.press('Enter');
         await page.waitForFunction(() => testGame.phase === 'playing');
         await page.getByText('ENTER AR', { exact: true }).click();
         await page.waitForFunction(() => window.isXR() && xrSessions.at(-1).renderState.baseLayer);
         assert.deepEqual(await page.evaluate(() => xrRequests), ['inline', mode]);
         // Switching display mode intentionally pauses Spellcode. Aim at the
         // HUD's RESUME RUN button and press the simulated trigger to resume.
         await page.evaluate(() => {
            device.controllers.right.position.set(-1.02, 2.30, -.5);
            device.controllers.right.quaternion.set(0, 0, 0, 1);
         });
         await page.waitForTimeout(500);
         await page.evaluate(() => device.controllers.right.updateButtonValue('trigger', 1));
         await page.waitForTimeout(500);
         await page.evaluate(() => {
            device.controllers.right.updateButtonValue('trigger', 0);
            device.controllers.right.position.set(.25, 1.5, -.5);
         });
         await page.waitForTimeout(500);
         await page.evaluate(() => device.controllers.right.updateButtonValue('trigger', 1));
         await page.waitForFunction(() => testGame.shots > 0);
         await page.evaluate(() => device.controllers.right.updateButtonValue('trigger', 0));
         await page.evaluate(() => xrSessions.at(-1).end());
         await page.waitForFunction(() => !window.isXR());
         const ticks = await page.evaluate(() => gameTicks);
         await page.waitForFunction(ticks => gameTicks > ticks + 3, ticks);
         await page.getByText('ENTER AR', { exact: true }).click();
         await page.waitForFunction(() => window.isXR() && xrSessions.length === 4 && xrSessions.at(-1).renderState.baseLayer);
         assert.deepEqual(await page.evaluate(() => xrRequests), ['inline', mode, 'inline', mode]);
         // Existing classroom startup errors, unrelated to XR rendering.
         assert.deepEqual(errors.filter(message =>
            !['Empty gltf model', 'Requested device not found'].includes(message)), []);
         console.log(`ok - ${mode}: preview, explicit entry, controller shooting, exit, re-entry`);
         await page.close();
      }
   } finally {
      await browser.close();
   }
})().catch(error => { console.error(error); process.exitCode = 1; });
