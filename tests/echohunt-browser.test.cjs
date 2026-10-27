// Optional Playwright test: Echo Hunt on the desktop, served by the app server
// (start it first; XR_TEST_URL defaults to http://localhost:2026/): no moths
// before the start; a round brings them, a click and a tap light the room, a shot
// counts, and the sonar has the room's walls.
// Run with NODE_PATH pointing to an installation containing playwright.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
(async () => {
   const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader',
      '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
   const errors = [];
   const url = new URL(process.env.XR_TEST_URL || 'http://localhost:2026/');
   const page = await browser.newPage({ viewport: { width: 420, height: 280 } });
   page.on('pageerror', e => { if (!/Empty gltf|Requested device not found/.test(e.message)) errors.push(e.message); });
   page.on('console', m => { if (m.type() === 'error' && /animate|echohunt/.test(m.text())) errors.push(m.text()); });
   await page.route('**/js/scenes/echohunt.js*', async route => {
      const response = await route.fetch();
      await route.fulfill({ response, body: (await response.text()).replace('const panels = new Panels(',
         'window.testHooks = { game, field, start, tryCatch, click, react, eye: () => eye, panels: () => panels };\n   const panels = new Panels(') });
   });
   await page.goto(url.href);
   await page.getByText('echohunt', { exact: true }).click();
   const wait = ms => page.waitForTimeout(ms), run = f => page.evaluate(f);
   await wait(4000);
   assert.equal(await run(() => testHooks.game.moths.filter(m => m.alive).length), 0, 'no moths before the start');
   await run(() => testHooks.start());
   await wait(1000);
   const round = await run(() => [testHooks.game.running, testHooks.game.moths.filter(m => m.alive).length]);
   console.log('running, moths', JSON.stringify(round));
   assert.deepEqual(round, [true, 10]);
   // A click: one more sound drawn.
   const clicks = await run(() => { testHooks.click(testHooks.eye(), [0, 0, -1]); return testHooks.field.pulses.filter(p => p.kind === 'click').length; });
   assert.equal(clicks, 1);
   // A moth hitting a wall: its tap drawn too.
   const taps = await run(() => { const e = testHooks.eye(); testHooks.react({ k: 'tap', p: [e[0] + 1, e[1], e[2]] }); return testHooks.field.pulses.filter(p => p.kind === 'tap').length; });
   assert.equal(taps, 1);
   await run(() => testHooks.tryCatch(testHooks.game.moths.findIndex(m => m.alive)));
   await wait(500);
   const hits = await run(() => testHooks.game.hits);
   console.log('hits', hits);
   assert.equal(hits, 1);
   const outline = await run(() => testHooks.panels().state.outline?.length);
   assert.equal(outline, 4, 'the sonar has the walls');
   assert.deepEqual(errors, []);
   console.log('echohunt browser test passed');
   await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
