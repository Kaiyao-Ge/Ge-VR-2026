// HW10 in a real browser (headless Chromium) on file://: the page's structure, themes, narrow screens, a figure that throws, and
// `figureChecks(page, id)`, the generic checks every figure passes (later tasks call it and add their own interaction checks).
// Nothing is served: the page is opened by path, as a double-click would.
// Run: P=~/.cache/doorways-pw; LD_LIBRARY_PATH=$(find $P/libs -type d | tr '\n' ':') NODE_PATH=$P/pw/node_modules \
//        timeout 300 node tests/hw10-browser.test.cjs
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const PAGE = pathToFileURL(path.join(__dirname, '..', 'hw10', 'index.html')).href;
// The page's sections in order (#scene-5 is an empty alias anchor inside #scene-4, kept so an old link still lands there).
const SECTIONS = ['top', 'glasses', 'story', 'scene-1', 'scene-2', 'scene-3', 'scene-4', 'scene-5', 'notes'];   // the author removed Rules and Closing
// The six figures, in the page's order: [id, data-fig, id of the section that holds it]
const FIGURES = [['f1', 'attention', 'top'], ['f9', 'glasses', 'glasses'], ['f2', 'desk', 'scene-1'], ['f3', 'street', 'scene-2'], ['f5', 'table', 'scene-3'],
   ['f7', 'minutes', 'scene-4']];
// The author's copy (hw10-plan-v2/rev3-spec.md and fix4-spec.md), checked word for word.
const COPY = {
   title: "AI attends where you don't",
   subtitle: 'Where you look, you need no help. The AI attends to the rest.',
   underFigure: 'Only about 2 degrees of your view is sharp (Strasburger et al., 2011). In the gorilla study, half of viewers missed a person in a gorilla suit (Simons & Chabris, 1999).',
   story: ['The scenario', 'One afternoon, I plan our VR final project with four classmates. They are Siva, Ben, James and Kaifang. The project is a game called Lighthouse. We all wear the glasses. I assume light glasses, good eye tracking and an AI that reads a scene.'],
   glasses: ['The glasses are only senses and a display.', 'A pocket device runs small models. The cloud runs the large model.',
      'Ideas from The Way Things Work: lenses, echo ranging, infrared.'],
   scenes: {
      'scene-1': ['1 Desk', 'I look at: the desk. I ask, "Where\'s my USB drive?"', 'The AI saw: my USB drive at 22:41. I never looked at it.', 'Idea: what I did not look at is still in memory.'],
      'scene-2': ['2 Street', 'I look at: my phone.', 'The AI sees: a bicycle coming from behind.',
         'Idea: the warning grows step by step. Glow, then sound, then text, then a tap. Only real danger may draw in the middle of my view. It works with the network down.'],
      'scene-3': ['3 Table', 'I look at: my laptop.', 'The AI hears: Kaifang asks, "Hand tracking is your part, right?"',
         'Idea: a cue shows the sentence at the edge. If I look at Kaifang, the AI stays silent.'],
      'scene-4': ['4 Record', 'I look at: Siva, my laptop, Kaifang. Never the whole board.', 'The AI reads: the board and the talk, from the best view. It keeps every version.',
         'Idea: the minutes list owners and dates. Each item links to its source. "What you missed" is only mine.'],
   },
   rules: ['Join the group only if I say yes.', 'Share events, not video or sound.', 'Strangers are "a person". Never identified.', 'Group attention is shown as a whole, never per person.'],
   closing: 'That evening, I open "What you missed". It shows six items I partly missed.',
};
const IDEA = 'Where you look, you need no help.';

let passed = 0;
const check = async (name, fn) => { await fn(); passed++; console.log('ok -', name); };

// The generic checks of one figure (by id, such as 'f3'): an svg in its stage, no data-error, one focusable control, no literal
// colour in its markup, and at a 375 px viewport every SVG text has a real font size of at least 10 px: its computed font-size
// (in user units) times the scale of the drawing (rendered width over viewBox width, or the text's own screen scale where the
// browser gives one), so text inside <defs> and <use> counts too. The viewport is put back afterwards.
const figureChecks = async (page, id) => {
   const sel = '#' + id;
   const got = await page.evaluate(sel => {
      const fig = document.querySelector(sel);
      if (!fig) return { missing: true };
      const stage = fig.querySelector('.fig-stage');
      const OK = /^(none|currentColor|url\(#[^)]+\))$/;
      const bad = [];
      for (const el of fig.querySelectorAll('*')) {
         for (const a of ['fill', 'stroke', 'stop-color', 'flood-color', 'color']) {
            const v = el.getAttribute(a);
            if (v !== null && !OK.test(v.trim())) bad.push(`${el.tagName} ${a}="${v}"`);
         }
         const st = el.getAttribute('style');
         if (st) for (const decl of st.split(';')) {
            const [p, ...rest] = decl.split(':'), v = rest.join(':').trim();
            if (/^(fill|stroke|color|stop-color|flood-color|background|background-color)$/.test(p.trim()) && !OK.test(v)) bad.push(`${el.tagName} style ${p.trim()}: ${v}`);
            else if (/#[0-9a-f]{3,8}\b|\b(rgb|hsl)a?\(/i.test(v)) bad.push(`${el.tagName} style ${p.trim()}: ${v}`);
         }
      }
      return { svg: !!(stage && stage.querySelector('svg')), error: fig.dataset.error ?? null,
         focusable: fig.querySelectorAll('button, input, [tabindex="0"]').length, bad };
   }, sel);
   assert.ok(!got.missing, `${id}: no such figure`);
   assert.ok(got.svg, `${id}: no svg in .fig-stage`);
   assert.equal(got.error, null, `${id}: data-error is set`);
   assert.ok(got.focusable >= 1, `${id}: no focusable control`);
   assert.deepEqual(got.bad, [], `${id}: literal colour in its markup`);
   const before = page.viewportSize();
   await page.setViewportSize({ width: 375, height: 800 });
   try {
      const small = await page.evaluate(sel => {
         const out = [];
         for (const t of document.querySelectorAll(sel + ' svg text')) {
            if (!t.textContent.trim()) continue;
            const svg = t.ownerSVGElement, vb = svg.viewBox.baseVal, r = svg.getBoundingClientRect();
            let scale = vb && vb.width && vb.height ? Math.min(r.width / vb.width, r.height / vb.height) : 1;
            const m = t.getScreenCTM && t.getScreenCTM();
            if (m && m.a > 0) scale = Math.hypot(m.a, m.b);      // includes a scale on a group, where the browser can tell
            const px = parseFloat(getComputedStyle(t).fontSize) * scale;
            if (!(px >= 10)) out.push(`${t.textContent.trim().slice(0, 30)}: ${px.toFixed(1)} px`);
         }
         return out;
      }, sel);
      assert.deepEqual(small, [], `${id}: SVG text under 10 px at 375 px wide`);
   } finally { await page.setViewportSize(before); }
};

// The layout checks of one figure that uses the two-column convention. At 1280 x 847: the figure is at most 760 px tall; every
// SVG text has a real font size of 20 to 24 px (same measure as figureChecks); `.fig-draw` and `.fig-side` exist, `.fig-side` is to
// the right of `.fig-draw` and the tops are within 24 px; every visible button is at least 44 px tall. At 375 px: `.fig-side` is
// under `.fig-draw` with a gap of at most 24 px. The viewport is put back afterwards. (R2: the old window was 15 to 17.5 px and
// 40 px; the real figures are measured by `sizeChecks` below.)
const layoutChecks = async (page, id) => {
   const sel = '#' + id;
   const measure = sel => page.evaluate(sel => {
      const fig = document.querySelector(sel);
      if (!fig) return { missing: true };
      const draw = fig.querySelector('.fig-stage > .fig-draw'), side = fig.querySelector('.fig-stage > .fig-side');
      const box = el => { const r = el.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom }; };
      const text = [];
      for (const t of fig.querySelectorAll('svg text')) {
         if (!t.textContent.trim()) continue;
         const svg = t.ownerSVGElement, vb = svg.viewBox.baseVal, r = svg.getBoundingClientRect();
         let scale = vb && vb.width && vb.height ? Math.min(r.width / vb.width, r.height / vb.height) : 1;
         const m = t.getScreenCTM && t.getScreenCTM();
         if (m && m.a > 0) scale = Math.hypot(m.a, m.b);
         text.push([t.textContent.trim().slice(0, 30), parseFloat(getComputedStyle(t).fontSize) * scale]);
      }
      const buttons = [...fig.querySelectorAll('button')].filter(b => { const r = b.getBoundingClientRect(); return r.width > 0 && r.height > 0; })
         .map(b => [b.textContent.trim().slice(0, 20), b.getBoundingClientRect().height]);
      return { height: fig.getBoundingClientRect().height, draw: draw && box(draw), side: side && box(side), text, buttons };
   }, sel);
   const before = page.viewportSize();
   try {
      await page.setViewportSize({ width: 1280, height: 847 });
      const w = await measure(sel);
      assert.ok(!w.missing, `${id}: no such figure`);
      assert.ok(w.draw && w.side, `${id}: needs .fig-stage > .fig-draw and .fig-stage > .fig-side`);
      assert.ok(w.height <= 760, `${id}: ${w.height.toFixed(0)} px tall at 1280 x 847 (at most 760)`);
      assert.ok(w.side.l >= w.draw.r - 1, `${id}: .fig-side is not to the right of .fig-draw at 1280`);
      assert.ok(Math.abs(w.side.t - w.draw.t) <= 24, `${id}: tops differ by ${Math.abs(w.side.t - w.draw.t).toFixed(0)} px at 1280 (at most 24)`);
      const off = w.text.filter(([, px]) => !(px >= 20 && px <= 24));
      assert.deepEqual(off, [], `${id}: SVG text outside 20 to 24 px at 1280: ` + off.map(([t, px]) => `${t} ${px.toFixed(1)}`).join('; '));
      const short = w.buttons.filter(([, h]) => h < 44);
      assert.deepEqual(short, [], `${id}: a button under 44 px tall: ` + short.map(([t, h]) => `${t} ${h.toFixed(0)}`).join('; '));
      await page.setViewportSize({ width: 375, height: 800 });
      const n = await measure(sel);
      assert.ok(n.side.t >= n.draw.b - 1 && n.side.t - n.draw.b <= 24, `${id}: at 375 px .fig-side must sit under .fig-draw, gap at most 24 px (gap ${(n.side.t - n.draw.b).toFixed(0)})`);
   } finally { await page.setViewportSize(before); }
};

// The size checks of one real figure (R2). At 1280 x 847: the figure is at most `maxH` px tall (760 by default); every SVG text has a real font size of 20 to 24 px (same measure as figureChecks); every piece of
// HTML text in the figure, its caption included, is at least 16 px; every visible button is at least 44 px tall.
// Returns the measures, so a report can quote them. The viewport is put back afterwards.
const sizeChecks = async (page, id, maxH = 760) => {
   const before = page.viewportSize();
   try {
      await page.setViewportSize({ width: 1280, height: 847 });
      const w = await page.evaluate(sel => {
         const fig = document.querySelector(sel);
         if (!fig) return { missing: true };
         const svgText = [];
         for (const t of fig.querySelectorAll('svg text')) {
            if (!t.textContent.trim()) continue;
            const svg = t.ownerSVGElement, vb = svg.viewBox.baseVal, r = svg.getBoundingClientRect();
            let scale = vb && vb.width && vb.height ? Math.min(r.width / vb.width, r.height / vb.height) : 1;
            const m = t.getScreenCTM && t.getScreenCTM();
            if (m && m.a > 0) scale = Math.hypot(m.a, m.b);
            svgText.push([t.textContent.trim().slice(0, 30), parseFloat(getComputedStyle(t).fontSize) * scale]);
         }
         const shown = el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
         const html = [];
         for (const el of fig.querySelectorAll('*')) {
            if (el.closest('svg') || !shown(el)) continue;
            const own = [...el.childNodes].filter(n => n.nodeType === 3 && n.textContent.trim()).map(n => n.textContent.trim()).join(' ');
            if (own) html.push([el.tagName.toLowerCase() + ': ' + own.slice(0, 24), parseFloat(getComputedStyle(el).fontSize)]);
         }
         const buttons = [...fig.querySelectorAll('button')].filter(shown).map(b => [b.textContent.trim().slice(0, 20), b.getBoundingClientRect().height]);
         const px = a => a.length ? [Math.min(...a.map(x => x[1])), Math.max(...a.map(x => x[1]))] : null;
         return { height: fig.getBoundingClientRect().height, svgText, html, buttons, svgRange: px(svgText), htmlMin: px(html) && px(html)[0] };
      }, '#' + id);
      assert.ok(!w.missing, `${id}: no such figure`);
      assert.ok(w.height <= maxH, `${id}: ${w.height.toFixed(0)} px tall at 1280 x 847 (at most ${maxH})`);
      assert.ok(w.svgText.length > 0, `${id}: has SVG text`);
      const off = w.svgText.filter(([, px]) => !(px >= 20 && px <= 24));
      assert.deepEqual(off, [], `${id}: SVG text outside 20 to 24 px at 1280: ` + off.map(([t, px]) => `${t} ${px.toFixed(1)}`).join('; '));
      const small = w.html.filter(([, px]) => px < 16);
      assert.deepEqual(small, [], `${id}: HTML text under 16 px: ` + small.map(([t, px]) => `${t} ${px.toFixed(1)}`).join('; '));
      const short = w.buttons.filter(([, h]) => h < 44);
      assert.deepEqual(short, [], `${id}: a button under 44 px tall: ` + short.map(([t, h]) => `${t} ${h.toFixed(0)}`).join('; '));
      return w;
   } finally { await page.setViewportSize(before); }
};

module.exports = { figureChecks, layoutChecks, sizeChecks };

if (require.main === module) (async () => {
   const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
   try {
      const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      const page = await context.newPage();
      const consoleErrors = [], pageErrors = [], requests = [];
      page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
      page.on('pageerror', e => pageErrors.push(String(e)));
      page.on('request', r => requests.push(r.url()));
      await page.goto(PAGE, { waitUntil: 'load' });

      await check('the page opens from file:// with no console error, no page error, and only file:// requests', async () => {
         assert.deepEqual(consoleErrors, []);
         assert.deepEqual(pageErrors, []);
         assert.ok(requests.length >= 3, 'the page, its stylesheet and its scripts were requested: ' + requests.join(' '));
         assert.deepEqual(requests.filter(u => !u.startsWith('file://')), []);
      });

      const words = t => (t.match(/\S+/g) || []).length;
      const jump = y => page.evaluate(y => window.scrollTo({ top: y, behavior: 'instant' }), y);
      const current = () => page.evaluate(() => [...document.querySelectorAll('nav#scenebar a')].map(a => a.getAttribute('aria-current')));
      const inView = async (what, fn) => {
         const before = page.viewportSize();
         await page.setViewportSize({ width: 1280, height: 847 });
         try { await fn(); } finally { await page.setViewportSize(before); await jump(0); }
      };

      await check('sections are present in the fixed order: top, story, glasses, scene-1..4 (with the empty alias scene-5 inside scene-4), rules, closing, notes', async () => {
         const got = await page.evaluate(ids => ids.map(id => document.getElementById(id)).map((el, i, all) =>
            !el ? null : (i === 0 || !all[i - 1] ? 0 : (all[i - 1].compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING ? 1 : -1))), SECTIONS);
         assert.ok(got.every(x => x !== null), 'a section is missing: ' + JSON.stringify(got));
         assert.ok(got.slice(1).every(x => x === 1), 'sections out of order: ' + JSON.stringify(got));
         assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('main > section')].map(e => e.id)),
            ['top', 'glasses', 'story', 'scene-1', 'scene-2', 'scene-3', 'scene-4', 'notes']);
         const alias = await page.evaluate(() => { const a = document.getElementById('scene-5'); return { text: a.textContent.trim(), kids: a.children.length, inside: a.closest('section').id }; });
         assert.deepEqual(alias, { text: '', kids: 0, inside: 'scene-4' }, 'scene-5 is an empty anchor at the Record scene');
         assert.equal(await page.evaluate(() => document.querySelector('#top h1').textContent), COPY.title);
         assert.equal(await page.evaluate(() => document.querySelectorAll('#complement, #device, #boundaries, #joining, .scene-label').length), 0, 'the old sections are gone');
         assert.equal(await page.evaluate(() => document.querySelectorAll('details, summary, .more, .more-body').length), 0, 'no folded "More" sections');
      });

      await check('six figures, each with a stage and a non-empty figcaption, in their places', async () => {
         const got = await page.evaluate(() => [...document.querySelectorAll('figure.fig')].map(f =>
            [f.id, f.dataset.fig, f.parentElement.closest('[id]').id, !!f.querySelector(':scope > .fig-stage'), f.querySelector(':scope > figcaption')?.textContent.trim().length > 0]));
         assert.deepEqual(got, FIGURES.map(([id, name, sec]) => [id, name, sec, true, true]));
      });

      await check('the copy is the author\'s, word for word: hero, glasses, the four scenes, rules and closing', async () => {
         const got = await page.evaluate(() => {
            const t = el => el.textContent.replace(/\s+/g, ' ').trim();
            const lines = id => [...document.querySelectorAll(`#${id} > .lines > h2, #${id} > .lines > p`)].map(t);
            return { title: t(document.querySelector('#top h1')), subtitle: t(document.querySelector('#top .thesis')), under: t(document.querySelector('#top .under-fig')),
               glasses: lines('glasses').slice(1), scenes: Object.fromEntries(['scene-1', 'scene-2', 'scene-3', 'scene-4'].map(id => [id, lines(id)])),
               story: [...document.querySelectorAll('#story > h2, #story > p')].map(t), storyBeforeScene1: !!(document.getElementById('story').compareDocumentPosition(document.getElementById('scene-1')) & Node.DOCUMENT_POSITION_FOLLOWING),
               rules: document.querySelectorAll('#rules').length, closing: document.querySelectorAll('#closing').length,
               heroOrder: [...document.querySelectorAll('#top > *')].map(e => e.tagName + (e.id ? '#' + e.id : '')) };
         });
         assert.equal(got.title, COPY.title);
         assert.equal(got.subtitle, COPY.subtitle);
         assert.equal(got.under, COPY.underFigure);
         assert.deepEqual(got.heroOrder, ['H1', 'P', 'FIGURE#f1', 'P'], 'the hero: title, subtitle, F1, the one line');
         assert.deepEqual(got.story, COPY.story, 'the story: one afternoon, four lines');
         assert.ok(got.storyBeforeScene1, '#story is before #scene-1');
         assert.deepEqual(got.glasses, COPY.glasses);
         assert.deepEqual(got.scenes, COPY.scenes);
         assert.equal(got.rules, 0, 'no Rules section (the author removed it)'); assert.equal(got.closing, 0, 'no Closing section (the author removed it)');
      });

      await check('the idea sentence "Where you look, you need no help." appears exactly once: the subtitle, in the visible text and in the whole page', async () => {
         const count = (t, s) => t.split(s).length - 1;
         const got = await page.evaluate(() => ({ visible: document.body.innerText, all: document.body.textContent,
            hero: document.querySelector('#top .thesis').textContent }));
         assert.equal(count(got.visible, IDEA), 1, 'visible text');
         assert.equal(count(got.all, IDEA), 1, 'all text, figures included');
         assert.equal(count(got.hero, IDEA), 1);
         assert.equal(count(got.all, 'The AI attends to the rest'), 1, 'the second sentence of the idea is said once');
         assert.ok(!/heat, not code|limit was heat/i.test(got.all), 'no "heat, not code" anywhere, figures included');
      });

      await check('words: the body text is 350-450, and the page as shown by default is 800-1,200', async () => {
         const got = await page.evaluate(() => {
            // body text: the prose the author writes outside the figures' drawings and controls, and the notes:
            // the headings, paragraphs and list items, and the figure captions.
            let body = 0;
            const w = t => (t.match(/\S+/g) || []).length;
            for (const el of document.querySelectorAll('main p, main li, main h1, main h2, main h3, figure.fig figcaption'))
               if (!el.closest('.fig-stage') && !el.closest('#notes')) body += w(el.textContent);
            return { body, page: w(document.body.innerText) };
         });
         assert.ok(got.body >= 350 && got.body <= 450, 'body words ' + got.body);
         assert.ok(got.page >= 800 && got.page <= 1200, 'default-visible page words ' + got.page);
      });

      await check('every figcaption is one sentence, and no prose says "In the figure" or opens with an instruction', async () => {
         const got = await page.evaluate(() => [...document.querySelectorAll('figure.fig figcaption')].map(c => [c.closest('figure').id, c.textContent.replace(/\s+/g, ' ').trim()]));
         assert.equal(got.length, 6);
         for (const [id, t] of got) {
            assert.equal((t.match(/[.!?](\s|$)/g) || []).length, 1, `${id}: not one sentence: ${t}`);
            assert.ok(/[.!?]$/.test(t) && !/in the figure/i.test(t), `${id}: ${t}`);
         }
         const prose = await page.evaluate(() => [...document.querySelectorAll('main p, main li')]
            .filter(e => !e.closest('.fig-stage') && !e.closest('figcaption') && !e.closest('#notes')).map(e => e.textContent.replace(/\s+/g, ' ').trim()));
         assert.deepEqual(prose.filter(t => /in the figure/i.test(t) || /^(Drag|Click|Slide|Ask|Play|Hover|Press)\b/.test(t)), []);
         assert.ok(!/in the figure/i.test(await page.evaluate(() => document.body.textContent)), 'nowhere on the page');
      });

      await check('the bar has four links to #scene-1…#scene-4 ("1 Desk" … "4 Record"), and clicking the third scrolls #scene-3 into view', async () => {
         const got = await page.evaluate(() => [...document.querySelectorAll('nav#scenebar a')].map(a => [a.getAttribute('href'), a.textContent.trim()]));
         assert.deepEqual(got, [['#scene-1', '1 Desk'], ['#scene-2', '2 Street'], ['#scene-3', '3 Table'], ['#scene-4', '4 Record']]);
         await jump(0);
         const top = () => page.evaluate(() => document.getElementById('scene-3').getBoundingClientRect().top);
         assert.ok(await top() > 800, 'scene 3 starts below the first screen');
         await page.click('nav#scenebar a:nth-of-type(3)');
         await page.waitForFunction(() => { const t = document.getElementById('scene-3').getBoundingClientRect().top; return t >= 0 && t < innerHeight / 2; }, null, { timeout: 5000 });
         await page.evaluate(() => { location.hash = '#scene-5'; });          // an old link: it lands on the Record scene
         await page.waitForFunction(() => { const t = document.getElementById('scene-5').getBoundingClientRect().top; return t >= 0 && t < innerHeight / 2; }, null, { timeout: 5000 });
         await jump(0);
      });

      // ---- type scale, the sticky bar, the scene layout, the hero ---------------------------------------------------------------
      await check('type scale at 1280: body 20 px, h1 40-46, h2 30, scene titles 26, captions and buttons at least 16, buttons at least 44 tall, every heading above body', () => inView('', async () => {
         const got = await page.evaluate(() => {
            const px = el => parseFloat(getComputedStyle(el).fontSize);
            const body = [...document.querySelectorAll('main p, main li')].filter(e => !e.closest('.fig-stage') && !e.closest('figcaption'));
            const vis = el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
            return { body: [...new Set(body.map(px))], notes: [...new Set([...document.querySelectorAll('#notes li')].map(px))], h1: px(document.querySelector('main h1')),
               h2: [...new Set([...document.querySelectorAll('main h2:not(.scene-title)')].map(px))], title: [...new Set([...document.querySelectorAll('main h2.scene-title')].map(px))],
               caps: [...new Set([...document.querySelectorAll('figure.fig figcaption')].map(px))],
               buttons: [...document.querySelectorAll('.fig button')].filter(vis).map(b => [b.textContent.trim().slice(0, 18), px(b), b.getBoundingClientRect().height]),
               nbuttons: document.querySelectorAll('.fig button').length, bar: [...document.querySelectorAll('#scenebar a')].map(px) };
         });
         assert.deepEqual(got.body, [20], 'body text (p and li outside the figures)');
         assert.deepEqual(got.notes, [20]);
         assert.ok(got.h1 >= 40 && got.h1 <= 46, 'h1 is ' + got.h1);
         assert.deepEqual(got.h2, [30]);
         assert.deepEqual(got.title, [26]);
         assert.ok(got.caps.every(c => c >= 16), 'captions ' + got.caps);
         assert.ok(Math.min(got.h1, ...got.h2, ...got.title) > 20, 'every heading is larger than the body text');
         assert.ok(got.nbuttons >= 18, 'buttons were measured (F3 has no link button now): ' + got.nbuttons);
         const small = got.buttons.filter(([, f, h]) => f < 16 || h < 44);
         assert.deepEqual(small, [], 'a button under 16 px or under 44 px tall: ' + small.map(([t, f, h]) => `${t} ${f}px ${h.toFixed(0)}tall`));
         assert.ok(got.bar.every(f => f >= 16), 'the bar links are at least 16 px: ' + got.bar);
      }));

      await check('the bar is sticky at the top, has no current link before scene 1, and marks scene 3 and then scene 4 when each is read', () => inView('', async () => {
         assert.deepEqual(await current(), [null, null, null, null], 'nothing is current at the top of the page');
         const pos = async () => page.evaluate(() => { const r = document.getElementById('scenebar').getBoundingClientRect(); return [getComputedStyle(document.getElementById('scenebar')).position, r.top, r.height]; });
         assert.equal((await pos())[0], 'sticky');
         await jump(await page.evaluate(() => document.getElementById('scene-3').getBoundingClientRect().top + scrollY - 90));
         await page.waitForFunction(() => document.querySelectorAll('nav#scenebar a[aria-current]').length === 1, null, { timeout: 5000 });
         assert.deepEqual(await current(), [null, null, 'true', null]);
         assert.deepEqual((await pos()).slice(1, 2), [0], 'the bar is still at the top');
         await jump(await page.evaluate(() => document.getElementById('scene-4').getBoundingClientRect().top + scrollY - 90));
         await page.waitForFunction(() => document.querySelector('nav#scenebar a:nth-of-type(4)').hasAttribute('aria-current'), null, { timeout: 5000 });
         assert.deepEqual(await current(), [null, null, null, 'true']);
         // the Notes come right after scene 4 now (Rules and Closing are gone) and the page cannot scroll them to the top, so at the
         // bottom of the page either scene 4 stays marked or nothing is: never another scene
         await jump(await page.evaluate(() => document.documentElement.scrollHeight));
         await page.waitForTimeout(400);
         const atEnd = await current();
         assert.ok(JSON.stringify(atEnd) === JSON.stringify([null, null, null, 'true']) || atEnd.every(c => c === null), 'at the bottom: ' + JSON.stringify(atEnd));
         await jump(0);
         await page.waitForFunction(() => !document.querySelector('nav#scenebar a[aria-current]'), null, { timeout: 5000 });
      }));

      await check('the bar is one line at 375 px, its links are at least 36 px tall, and a jumped-to scene title is not under it', async () => {
         const before = page.viewportSize();
         await page.setViewportSize({ width: 375, height: 800 });
         try {
            const bar = await page.evaluate(() => {
               const nav = document.getElementById('scenebar'), r = nav.getBoundingClientRect(), as = [...nav.querySelectorAll('a')].map(a => a.getBoundingClientRect());
               return { top: r.top, h: r.height, w: r.width, tops: as.map(a => Math.round(a.top)), heights: as.map(a => a.height), right: Math.max(...as.map(a => a.right)),
                  labels: [...nav.querySelectorAll('a')].map(a => a.textContent.trim()), over: nav.scrollWidth - nav.clientWidth };
            });
            assert.deepEqual(bar.labels, ['1 Desk', '2 Street', '3 Table', '4 Record']);
            assert.equal(new Set(bar.tops).size, 1, 'one line: ' + bar.tops);
            assert.ok(bar.heights.every(h => h >= 36), 'links at least 36 px tall: ' + bar.heights);
            assert.ok(bar.right <= 375 && bar.over <= 0 && bar.h <= 60, JSON.stringify(bar));
            for (let i = 1; i <= 4; i++) {
               await jump(0);
               await page.click(`nav#scenebar a:nth-of-type(${i})`);
               const id = 'scene-' + i;
               await page.waitForFunction(id => { const t = document.getElementById(id).getBoundingClientRect().top; return t >= 0 && t < innerHeight / 2; }, id, { timeout: 5000 });
               await page.waitForTimeout(700);      // the smooth scroll settles
               const m = await page.evaluate(id => { const h = document.querySelector(`#${id} h2.scene-title`).getBoundingClientRect(), n = document.getElementById('scenebar').getBoundingClientRect();
                  return { title: h.top, bar: n.bottom }; }, id);
               assert.ok(m.title >= m.bar, `${id}: the title (${m.title}) is below the bar (${m.bar})`);
            }
         } finally { await page.setViewportSize(before); await jump(0); }
      });

      await check('each scene (and the glasses): three lines in a column of about 300 px on the left of the figure at 1280, the figure under the lines at 375', async () => {
         const measure = () => page.evaluate(() => Object.fromEntries(['glasses', 'scene-1', 'scene-2', 'scene-3', 'scene-4'].map(id => {
            const s = document.getElementById(id), l = s.querySelector(':scope > .lines').getBoundingClientRect(), f = s.querySelector(':scope > figure.fig').getBoundingClientRect();
            return [id, { lw: l.width, lr: l.right, lt: l.top, lb: l.bottom, fl: f.left, ft: f.top, fw: f.width }];
         })));
         await inView('', async () => {
            for (const [id, m] of Object.entries(await measure())) {
               assert.ok(Math.abs(m.lw - 300) <= 20, `${id}: the text column is ${m.lw.toFixed(0)} px wide`);
               assert.ok(m.fl >= m.lr, `${id}: the figure is to the right of the text`);
               assert.ok(Math.abs(m.ft - m.lt) <= 4, `${id}: the tops line up`);
               assert.ok(m.fw >= 700, `${id}: the figure is ${m.fw.toFixed(0)} px wide`);
            }
         });
         const before = page.viewportSize();
         await page.setViewportSize({ width: 375, height: 800 });
         try {
            for (const [id, m] of Object.entries(await measure())) assert.ok(m.ft >= m.lb - 1 && m.fw <= 375 && m.fl >= 0, `${id}: at 375 px the figure sits under the text`);
         } finally { await page.setViewportSize(before); }
      });

      await check('the hero: F1 is the first figure, right after the title and the one idea, and its top is inside the first screen at 1280 x 847', () => inView('', async () => {
         const got = await page.evaluate(() => {
            const figs = [...document.querySelectorAll('figure.fig')].map(f => f.id), th = document.querySelector('#top .thesis'), f1 = document.getElementById('f1');
            return { first: figs[0], next: th.nextElementSibling && th.nextElementSibling.id, parent: f1.parentElement.id, thesisBottom: th.getBoundingClientRect().bottom,
               top: f1.getBoundingClientRect().top, svgTop: f1.querySelector('svg').getBoundingClientRect().top, svgH: f1.querySelector('svg').getBoundingClientRect().height,
               after: f1.nextElementSibling && f1.nextElementSibling.className, vh: innerHeight };
         });
         assert.equal(got.first, 'f1'); assert.equal(got.next, 'f1'); assert.equal(got.parent, 'top'); assert.equal(got.after, 'under-fig');
         assert.equal(got.vh, 847);
         assert.ok(got.thesisBottom < got.top, 'the subtitle ends above F1');
         assert.ok(got.top < 300, 'F1 top is ' + got.top);
         assert.ok(Math.min(got.svgTop + got.svgH, got.vh) - got.svgTop >= 400, 'at least 400 px of F1\'s drawing is in the first screen: ' + JSON.stringify(got));
         // R2: the whole drawing and both switch buttons are in the first screen, and so is the figure's caption
         const fit = await page.evaluate(() => { const r = e => e.getBoundingClientRect();
            return { svgBottom: r(document.querySelector('#f1 svg')).bottom, buttons: [...document.querySelectorAll('#f1 button')].map(b => r(b).bottom),
               caption: r(document.querySelector('#f1 figcaption')).bottom, vh: innerHeight }; });
         assert.ok(fit.svgBottom <= fit.vh && fit.buttons.length === 2 && fit.buttons.every(b => b <= fit.vh) && fit.caption <= fit.vh, 'F1\'s drawing, both buttons and caption are inside the first screen: ' + JSON.stringify(fit));
      }));

      await check('layoutChecks accepts a sound figure and rejects a tall one, a stacked one, small and large text, a short button, and a side that does not sit under the drawing', async () => {
         const build = (html, css = '') => page.evaluate(([html, css]) => {
            document.getElementById('probe')?.remove(); document.getElementById('probe-css')?.remove();
            const st = document.createElement('style'); st.id = 'probe-css'; st.textContent = css; document.head.appendChild(st);
            const f = document.createElement('figure');
            f.id = 'probe'; f.className = 'fig'; f.dataset.fig = 'probe';
            f.innerHTML = '<div class="fig-stage">' + html + '</div><figcaption>x</figcaption>';
            document.body.appendChild(f);
         }, [html, css]);
         const draw = (txt = 'font-size="22"', extra = '') => `<div class="fig-draw"><svg viewBox="0 0 480 200"><text x="5" y="50" ${txt} fill="currentColor">ok</text></svg>${extra}</div>`;
         const side = '<div class="fig-side"><button>go</button></div>';
         await build(draw() + side);
         await layoutChecks(page, 'probe');
         const faults = [
            ['too tall', [draw('font-size="22"', '<div style="height:900px"></div>') + side], /px tall/],
            ['stacked: no wrappers', ['<svg viewBox="0 0 480 200"><text x="5" y="50" font-size="22" fill="currentColor">ok</text></svg><div><button>go</button></div>'], /fig-draw/],
            ['stacked: side under the drawing at 1280', [draw() + side, '#probe .fig-stage { display: block !important; }'], /not to the right|tops differ/],
            ['text too small', [draw('font-size="14"') + side], /20 to 24/],
            ['text too large', [draw('font-size="30"') + side], /20 to 24/],
            ['a short button', [draw() + side.replace('<button>', '<button style="min-height:0;height:24px;padding:0">')], /under 44/],
            ['side not under the drawing at 375 px', [draw() + side, '@media (max-width: 40rem) { #probe .fig-side { margin-top: 80px; } }'], /under .fig-draw/],
         ];
         for (const [what, [html, css], re] of faults) {
            await build(html, css);
            await assert.rejects(() => layoutChecks(page, 'probe'), re, what);
         }
         await page.evaluate(() => { document.getElementById('probe').remove(); document.getElementById('probe-css').remove(); });
         assert.deepEqual(page.viewportSize(), { width: 1280, height: 800 });
      });

      await check('sizes at 1280 x 847: each figure (F1, F2, F3, F5, F7, F9) is at most 760 px tall with its controls and its controls are on screen with it; every figure\'s SVG text is 20-24 px; HTML text in figures is at least 16 px; buttons at least 44 px', async () => {
         for (const [id] of FIGURES) {
            const w = await sizeChecks(page, id, 760);
            assert.ok(w.svgRange[0] >= 20 && w.svgRange[1] <= 24, id + ' ' + w.svgRange);
            await inView('', async () => {
               // the figure's top just under the sticky bar: its whole box, so every control and the caption, is inside the 847 px screen
               await page.evaluate(id => { const e = document.getElementById(id); window.scrollTo({ top: e.getBoundingClientRect().top + scrollY - 60, behavior: 'instant' }); }, id);
               const box = await page.evaluate(id => { const f = document.getElementById(id), r = f.getBoundingClientRect();
                  return { top: r.top, bottom: r.bottom, buttons: [...f.querySelectorAll('button')].map(b => b.getBoundingClientRect().bottom), vh: innerHeight }; }, id);
               assert.ok(box.top >= 0 && box.bottom <= box.vh && box.buttons.every(b => b <= box.vh), `${id} does not fit one screen: ` + JSON.stringify(box));
            });
         }
         // sizeChecks does find faults: a tall box, small SVG text, small HTML text, a short button
         await page.evaluate(() => {
            const f = document.createElement('figure'); f.id = 'probe'; f.className = 'fig'; f.dataset.fig = 'probe';
            f.innerHTML = '<div class="fig-stage"><svg viewBox="0 0 480 200" style="width:480px"><text x="5" y="50" font-size="22" fill="currentColor">ok</text></svg><button>go</button><p style="font-size:14px">small</p></div><figcaption>x</figcaption>';
            document.body.appendChild(f);
         });
         try {
            await assert.rejects(() => sizeChecks(page, 'probe'), /HTML text under 16/);
            await page.evaluate(() => { document.querySelector('#probe p').style.fontSize = '16px'; });
            await sizeChecks(page, 'probe');
            await page.evaluate(() => { document.querySelector('#probe text').setAttribute('font-size', '14'); });
            await assert.rejects(() => sizeChecks(page, 'probe'), /20 to 24/);
            await page.evaluate(() => { document.querySelector('#probe text').setAttribute('font-size', '22'); document.querySelector('#probe button').style.cssText = 'min-height:0;height:30px'; });
            await assert.rejects(() => sizeChecks(page, 'probe'), /under 44/);
            await page.evaluate(() => { document.querySelector('#probe button').style.cssText = ''; document.querySelector('#probe .fig-stage').insertAdjacentHTML('beforeend', '<div style="height:900px"></div>'); });
            await assert.rejects(() => sizeChecks(page, 'probe'), /px tall/);
         } finally { await page.evaluate(() => document.getElementById('probe').remove()); }
      });

      await check('dark mode: the bar\'s current link and a selected button differ from the background (and light mode too)', async () => {
         await page.evaluate(() => {
            const f = document.createElement('figure'); f.id = 'probe'; f.className = 'fig';
            f.innerHTML = '<div class="fig-stage"><div class="fig-draw"></div><div class="fig-side"><button aria-pressed="true">on</button><button aria-pressed="false">off</button></div></div>';
            document.body.appendChild(f);
         });
         await jump(await page.evaluate(() => document.getElementById('scene-2').getBoundingClientRect().top + scrollY - 90));
         await page.waitForFunction(() => document.querySelector('nav#scenebar a[aria-current]'), null, { timeout: 5000 });
         try {
            for (const scheme of ['light', 'dark']) {
               await page.emulateMedia({ colorScheme: scheme });
               const c = await page.evaluate(() => {
                  const cs = (el, p) => getComputedStyle(el)[p], body = cs(document.body, 'backgroundColor');
                  const a = document.querySelector('nav#scenebar a[aria-current]'), other = document.querySelector('nav#scenebar a:not([aria-current])');
                  const on = document.querySelector('#probe [aria-pressed="true"]'), off = document.querySelector('#probe [aria-pressed="false"]');
                  return { body, bar: cs(document.getElementById('scenebar'), 'backgroundColor'), a: cs(a, 'backgroundColor'), aText: cs(a, 'color'), aBorder: cs(a, 'borderTopColor'), other: cs(other, 'backgroundColor'),
                     on: cs(on, 'backgroundColor'), onText: cs(on, 'color'), onBorder: cs(on, 'borderTopColor'), onBorderW: cs(on, 'borderTopWidth'), off: cs(off, 'backgroundColor'), offBorder: cs(off, 'borderTopColor'), onH: on.getBoundingClientRect().height };
               });
               assert.notEqual(c.a, c.body, scheme + ': the current link differs from the page background');
               assert.notEqual(c.a, c.bar, scheme + ': the current link differs from the bar');
               assert.notEqual(c.a, c.other, scheme + ': the current link differs from the other links');
               assert.notEqual(c.aText, c.a, scheme + ': the current link text is readable');
               assert.notEqual(c.on, c.body, scheme + ': the selected button differs from the background');
               assert.notEqual(c.on, c.off, scheme + ': the selected button differs from an unselected one');
               assert.notEqual(c.onText, c.on, scheme + ': the selected button text is readable');
               assert.notEqual(c.offBorder, c.body, scheme + ': a button border differs from the background');
               assert.equal(c.onBorderW, '2px'); assert.ok(c.onH >= 40, 'button height ' + c.onH);
            }
         } finally { await page.emulateMedia({ colorScheme: 'light' }); await page.evaluate(() => document.getElementById('probe').remove()); await jump(0); }
      });

      await check('dark mode changes the body background', async () => {
         const bg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
         await page.emulateMedia({ colorScheme: 'light' });
         const light = await bg();
         await page.emulateMedia({ colorScheme: 'dark' });
         const dark = await bg();
         await page.emulateMedia({ colorScheme: 'light' });
         assert.notEqual(light, dark);
      });

      await check('a class on SVG text beats the figure default, in light and dark', async () => {
         const probe = () => page.evaluate(() => {
            const f = document.createElement('figure');
            f.className = 'fig'; f.innerHTML = '<div class="fig-stage"></div>';
            document.body.appendChild(f);
            const svg = HW10.svg('svg', { viewBox: '0 0 100 20' }, f.firstChild);
            const out = {};
            for (const c of ['ink', 'muted', 'accent', 'warn', 'danger']) {
               const t = HW10.svg('text', { class: 'fill-' + c, x: 1, y: 10 }, svg);
               const want = document.createElement('div'); want.style.color = `var(--${c})`; document.body.appendChild(want);
               out[c] = [getComputedStyle(t).fill, getComputedStyle(want).color]; want.remove();
            }
            const plain = HW10.svg('text', { x: 1, y: 10 }, svg), attr = HW10.svg('text', { x: 1, y: 10, fill: 'none' }, svg);
            out.plain = [getComputedStyle(plain).fill, getComputedStyle(document.body).color];
            out.attr = [getComputedStyle(attr).fill, 'none'];
            f.remove();
            return out;
         });
         for (const scheme of ['light', 'dark']) {
            await page.emulateMedia({ colorScheme: scheme });
            const got = await probe();
            for (const [k, [fill, want]] of Object.entries(got)) assert.equal(fill, want, `${scheme}: text with class fill-${k}`);
            if (scheme === 'light') assert.notEqual(got.accent[0], got.ink[0], 'accent and ink differ');
         }
         await page.emulateMedia({ colorScheme: 'light' });
      });

      await check('no horizontal scroll at 375 px', async () => {
         await page.setViewportSize({ width: 375, height: 800 });
         assert.ok(await page.evaluate(() => document.scrollingElement.scrollWidth) <= 375);
         await page.setViewportSize({ width: 1280, height: 800 });
      });

      await check('a figure whose mount throws gets data-error and its neighbour still mounts', async () => {
         const got = await page.evaluate(() => {
            const root = document.createElement('div');
            root.innerHTML = '<figure class="fig" data-fig="boom"><div class="fig-stage"></div><figcaption>kept</figcaption></figure>' +
               '<figure class="fig" data-fig="ok"><div class="fig-stage"></div><figcaption>fine</figcaption></figure>';
            HW10.register('boom', () => { throw new Error('boom!'); });
            HW10.register('ok', stage => { HW10.svg('svg', { viewBox: '0 0 10 10' }, stage); });
            HW10.mountAll(root);
            const [a, b] = root.querySelectorAll('figure');
            return [a.dataset.error, a.querySelector('figcaption').textContent, !!b.querySelector('.fig-stage svg'), b.dataset.error ?? null];
         });
         assert.deepEqual(got, ['boom!', 'kept', true, null]);
         assert.deepEqual(pageErrors, []);
      });

      await check('figureChecks accepts a sound figure and names each fault', async () => {
         const build = html => page.evaluate(html => {
            document.getElementById('probe')?.remove();
            const f = document.createElement('figure');
            f.id = 'probe'; f.className = 'fig'; f.dataset.fig = 'probe';
            f.innerHTML = '<div class="fig-stage">' + html + '</div><figcaption>x</figcaption>';
            document.body.appendChild(f);
         }, html);
         const good = '<svg viewBox="0 0 300 100" width="300" height="100"><text x="5" y="50" font-size="16" fill="currentColor">ok</text></svg><button>go</button>';
         await build(good);
         await figureChecks(page, 'probe');
         const faults = [
            ['no svg', '<button>go</button>', /no svg/],
            ['no control', good.replace('<button>go</button>', ''), /focusable/],
            ['colour', good.replace('currentColor', '#ff0000'), /literal colour/],
            ['style colour', good.replace('<text ', '<text style="stroke:red" '), /literal colour/],
            ['small text', good.replace('font-size="16"', 'font-size="5"'), /under 10 px/],
            ['a wide text with a font size of 9 units (a bbox proxy let such a line through)', good.replace('font-size="16"', 'font-size="9"').replace('>ok<', '>a long enough line of text to be wide<'), /under 10 px/],
            ['small text inside defs', good.replace('<text ', '<defs><text x="5" y="50" font-size="6">hidden</text></defs><text '), /under 10 px/],
            ['small text by css', good.replace('<text ', '<text style="font-size:6px" '), /under 10 px/],
         ];
         for (const [what, html, re] of faults) {
            await build(html);
            await assert.rejects(() => figureChecks(page, 'probe'), re, what);
         }
         await page.evaluate(() => document.getElementById('probe').remove());
         assert.deepEqual(page.viewportSize(), { width: 1280, height: 800 });
      });

      await check('f1: the generic figure checks, and the first state already shows the point', async () => {
         await figureChecks(page, 'f1');
         assert.equal(await page.evaluate(() => document.getElementById('f1').dataset.state), 'eye');
         assert.equal(await page.evaluate(() => document.querySelectorAll('#f1 .found').length), 0, 'nothing is marked in the eye view');
         // the sharp spot is drawn to scale: 2 of 200 degrees across the viewBox width, as a radius
         const got = await page.evaluate(() => {
            const svg = document.querySelector('#f1 svg'), w = svg.viewBox.baseVal.width;
            return { w, r: +document.querySelector('#f1 .f1-spot').getAttribute('r') };
         });
         assert.equal(got.r, got.w * 2 / 200 / 2);
      });

      await check('f1: two buttons, "My eye" and "What the glasses see", above or beside the drawing; aria-pressed marks the selected one; data-state is eye or glasses; .found only in the glasses view', async () => {
         const btns = page.locator('#f1 button');
         assert.equal(await btns.count(), 2);
         assert.deepEqual(await btns.allTextContents(), ['My eye', 'What the glasses see']);
         const pressed = () => page.evaluate(() => [...document.querySelectorAll('#f1 button')].map(b => b.getAttribute('aria-pressed')));
         const state = () => page.evaluate(() => document.getElementById('f1').dataset.state);
         assert.deepEqual(await pressed(), ['true', 'false']);
         assert.equal(await state(), 'eye');
         await btns.nth(1).click();
         assert.equal(await state(), 'glasses');
         assert.deepEqual(await pressed(), ['false', 'true']);
         assert.ok(await page.evaluate(() => document.querySelectorAll('#f1 .found').length) >= 1);
         await btns.nth(1).click();                                              // pressing the selected one changes nothing
         assert.equal(await state(), 'glasses');
         await btns.nth(0).click();
         assert.equal(await state(), 'eye');
         assert.deepEqual(await pressed(), ['true', 'false']);
         assert.equal(await page.evaluate(() => document.querySelectorAll('#f1 .found').length), 0);
         // above or beside the drawing, at 1280 and at 375 px
         const before = page.viewportSize();
         try {
            for (const [w, h] of [[1280, 847], [375, 800]]) {
               await page.setViewportSize({ width: w, height: h });
               const g = await page.evaluate(() => { const svg = document.querySelector('#f1 svg').getBoundingClientRect();
                  return { svg: [svg.left, svg.top, svg.right, svg.bottom], btns: [...document.querySelectorAll('#f1 button')].map(b => { const r = b.getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom]; }) }; });
               for (const b of g.btns) assert.ok(b[3] <= g.svg[1] + 1 || b[0] >= g.svg[2] - 1, `${w} px: a button is not above or beside the drawing: ${JSON.stringify(g)}`);
            }
         } finally { await page.setViewportSize(before); }
      });

      // F1's labels: no label touches another label, a line of the drawing (the desk, its legs, the floor, the window, the door, the
      // bag, the scale), or a dashed outline of the glasses view. The geometry is read from the SVG itself: the text boxes by getBBox,
      // the paths by points taken every 2 units along them, the boxes and circles by their own boxes.
      const f1LabelFaults = () => page.evaluate(() => {
         const svg = document.querySelector('#f1 svg'), pad = 3, faults = [];
         const labels = [...svg.querySelectorAll('text.f1-label')].map(t => { const b = t.getBBox();
            return { name: t.textContent, x0: b.x - pad, y0: b.y - pad, x1: b.x + b.width + pad, y1: b.y + b.height + pad }; });
         const inside = (x, y, l) => x >= l.x0 && x <= l.x1 && y >= l.y0 && y <= l.y1;
         for (let i = 0; i < labels.length; i++) for (let j = i + 1; j < labels.length; j++) {
            const a = labels[i], b = labels[j];
            if (a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1) faults.push(`"${a.name}" and "${b.name}" overlap`);
         }
         for (const el of svg.querySelectorAll('.f1-line')) {
            if (el.tagName === 'rect' || el.tagName === 'circle') {
               const b = el.getBBox();
               for (const l of labels) if (l.x0 < b.x + b.width && b.x < l.x1 && l.y0 < b.y + b.height && b.y < l.y1) faults.push(`"${l.name}" touches a ${el.tagName} of the drawing`);
            } else {
               const n = el.getTotalLength();
               for (let d = 0; d <= n; d += 2) { const p = el.getPointAtLength(d);
                  for (const l of labels) if (inside(p.x, p.y, l)) faults.push(`"${l.name}" is on a line of the drawing`); }
            }
         }
         for (const c of svg.querySelectorAll('.f1-mark')) {
            const cx = +c.getAttribute('cx'), cy = +c.getAttribute('cy'), r = +c.getAttribute('r') + 2;
            for (const l of labels) {
               const nx = Math.min(Math.max(cx, l.x0), l.x1), ny = Math.min(Math.max(cy, l.y0), l.y1);
               const far = Math.max(...[[l.x0, l.y0], [l.x1, l.y0], [l.x0, l.y1], [l.x1, l.y1]].map(([x, y]) => Math.hypot(x - cx, y - cy)));
               if (Math.hypot(nx - cx, ny - cy) <= r && far >= r - 4) faults.push(`"${l.name}" is crossed by the outline at ${cx},${cy}`);
            }
         }
         return { n: labels.length, faults: [...new Set(faults)] };
      });
      await check('f1: the ten labels (nine things and the scale) touch no other label, no line of the drawing, and no outline of the glasses view', async () => {
         const got = await f1LabelFaults();
         assert.equal(got.n, 10);
         assert.deepEqual(got.faults, []);
         // the check does find faults: put the "mug" label on the desk line, and the "bag" label on the bag's outline
         const moved = await page.evaluate(() => { const ts = [...document.querySelectorAll('#f1 text.f1-label')];
            const mug = ts.find(t => t.textContent === 'mug'), bag = ts.find(t => t.textContent === 'bag'), keep = [mug, bag].map(t => [t.getAttribute('x'), t.getAttribute('y'), t.getAttribute('text-anchor')]);
            mug.setAttribute('x', 400); mug.setAttribute('y', 300); bag.setAttribute('x', 330); bag.setAttribute('y', 355); bag.setAttribute('text-anchor', 'middle');
            window.__f1keep = [[mug, keep[0]], [bag, keep[1]]]; return true; });
         assert.ok(moved);
         const bad = await f1LabelFaults();
         await page.evaluate(() => { for (const [t, [x, y, a]] of window.__f1keep) { t.setAttribute('x', x); t.setAttribute('y', y); t.setAttribute('text-anchor', a); } });
         assert.ok(bad.faults.some(f => /mug/.test(f) && /line|rect|touches/.test(f)), 'the mug label on the desk: ' + bad.faults);
         assert.ok(bad.faults.some(f => /bag/.test(f)), 'the bag label on the bag: ' + bad.faults);
         assert.deepEqual((await f1LabelFaults()).faults, [], 'put back');
      });

      await check('f1: ArrowRight on the focused gaze handle moves it right, ArrowLeft back, and it stays inside the picture', async () => {
         const x = () => page.evaluate(() => +document.querySelector('#f1 .gaze').dataset.gazeX);
         await page.locator('#f1 .gaze').focus();
         const x0 = await x();
         await page.keyboard.press('ArrowRight');
         const x1 = await x();
         assert.ok(x1 > x0, `ArrowRight: ${x0} -> ${x1}`);
         assert.equal(await page.evaluate(() => +document.getElementById('f1').dataset.gazeX), x1, 'the figure holds the same position');
         await page.keyboard.press('ArrowLeft');
         assert.equal(await x(), x0);
         for (let i = 0; i < 200; i++) await page.keyboard.press('ArrowRight');
         assert.ok(await x() <= await page.evaluate(() => document.querySelector('#f1 svg').viewBox.baseVal.width));
         await page.keyboard.press('Home');   // back to the start
      });

      await check('f1: dragging the gaze handle moves it, and the sharp spot goes with it', async () => {
         await page.locator('#f1').scrollIntoViewIfNeeded();
         const pos = () => page.evaluate(() => { const g = document.querySelector('#f1 .gaze'); return [+g.dataset.gazeX, +g.dataset.gazeY]; });
         const before = await pos();
         const box = await page.locator('#f1 .gaze').boundingBox();
         const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
         await page.mouse.move(cx, cy);
         await page.mouse.down();
         await page.mouse.move(cx - 120, cy - 40, { steps: 6 });
         await page.mouse.up();
         const after = await pos();
         assert.ok(after[0] < before[0] - 20 && after[1] < before[1] - 5, `${before} -> ${after}`);
         const spot = await page.evaluate(() => { const c = document.querySelector('#f1 .f1-spot'); return [+c.getAttribute('cx'), +c.getAttribute('cy')]; });
         assert.deepEqual(spot, after);
      });

      // F1's blur: stacked blurred copies of the room, each masked by a radial gradient centred on the gaze, and one pale overlay.
      const f1Stack = () => page.evaluate(() => {
         const svg = document.querySelector('#f1 svg'), id = v => (/url\(#([^)]+)\)/.exec(v || '') || [])[1];
         const layers = [...svg.querySelectorAll('.f1-layer')].map(l => {
            const m = l.getAttribute('mask') && svg.querySelector('#' + id(l.getAttribute('mask')));
            const rect = m && m.querySelector('rect'), g = rect && svg.querySelector('#' + id(rect.getAttribute('fill')));
            return { sigma: +l.dataset.sigma, masked: !!m, grad: g && g.tagName === 'radialGradient' ? { cx: +g.getAttribute('cx'), cy: +g.getAttribute('cy'), units: g.getAttribute('gradientUnits') } : null,
               display: getComputedStyle(l).display };
         });
         const pale = svg.querySelector('.f1-pale'), pg = pale && svg.querySelector('#' + id(pale.getAttribute('fill')));
         const ring = sel => { const c = svg.querySelector(sel); return c && { r: +c.getAttribute('r'), cx: +c.getAttribute('cx'), cy: +c.getAttribute('cy'), dash: getComputedStyle(c).strokeDasharray }; };
         const gz = document.querySelector('#f1 .gaze');
         return { layers, gaze: [+gz.dataset.gazeX, +gz.dataset.gazeY], pale: pale && { display: getComputedStyle(pale).display, grad: pg && { cx: +pg.getAttribute('cx'), cy: +pg.getAttribute('cy'), units: pg.getAttribute('gradientUnits') } },
            layersDisplay: getComputedStyle(svg.querySelector('.f1-layers')).display, spot: ring('.f1-spot'), clear: ring('.f1-clear'),
            stops: [...svg.querySelectorAll('.f1-stop')].map(s => getComputedStyle(s).stopColor) };
      });
      await check('f1: the eye view stacks at least 5 blurred layers, their gradients are centred on the gaze, and a pale overlay does the same', async () => {
         await page.locator('#f1 button').nth(0).click();
         const got = await f1Stack();
         assert.ok(got.layers.filter(l => l.sigma > 0).length >= 5, 'blur layers: ' + got.layers.length);
         assert.equal(got.layers[got.layers.length - 1].sigma, 0, 'a sharp layer on top');
         const sig = got.layers.map(l => l.sigma);
         assert.deepEqual(sig, [...sig].sort((a, b) => b - a), 'the most blurred at the bottom (first in the document), the sharpest on top');
         for (const l of got.layers.slice(1)) {
            assert.ok(l.masked && l.grad, 'each layer but the bottom one is masked by a radial gradient: ' + JSON.stringify(l));
            assert.equal(l.grad.units, 'userSpaceOnUse');
            assert.deepEqual([l.grad.cx, l.grad.cy], got.gaze, 'gradient centre is the gaze');
            assert.notEqual(l.display, 'none');
         }
         assert.ok(!got.layers[0].masked, 'the bottom layer covers everything');
         assert.ok(got.pale && got.pale.grad && got.pale.display !== 'none', 'a pale overlay');
         assert.equal(got.pale.grad.units, 'userSpaceOnUse');
         assert.deepEqual([got.pale.grad.cx, got.pale.grad.cy], got.gaze);
         assert.ok(got.stops.length >= 5 && got.stops.every(c => c && c !== 'rgba(0, 0, 0, 0)' && c !== 'rgb(0, 0, 0)'), 'gradient stops take their colour from a CSS class: ' + got.stops);
      });

      await check('f1: after ArrowRight the gradient centres move with the gaze', async () => {
         await page.locator('#f1 .gaze').focus();
         const a = await f1Stack();
         await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowDown');
         const b = await f1Stack();
         assert.equal(b.gaze[0], a.gaze[0] + 16); assert.equal(b.gaze[1], a.gaze[1] + 8);
         for (const l of b.layers.filter(l => l.masked)) assert.deepEqual([l.grad.cx, l.grad.cy], b.gaze);
         assert.deepEqual([b.pale.grad.cx, b.pale.grad.cy], b.gaze);
         assert.deepEqual([b.spot.cx, b.spot.cy, b.clear.cx, b.clear.cy], [...b.gaze, ...b.gaze]);
         await page.keyboard.press('Home');
         const c = await f1Stack();
         assert.deepEqual(c.gaze, [400, 245], 'Home puts the gaze back on the laptop');
         for (const l of c.layers.filter(l => l.masked)) assert.deepEqual([l.grad.cx, l.grad.cy], c.gaze);
      });

      await check('f1: a thin ring at 2 degrees (radius 4) and a faint dashed ring at 10 degrees across (radius 20) mark the sharpest centre and the clear area', async () => {
         const got = await f1Stack();
         assert.equal(got.spot.r, 4);
         assert.equal(got.clear.r, 20);
         assert.ok(got.clear.dash && got.clear.dash !== 'none', 'the clear ring is dashed: ' + got.clear.dash);
         assert.ok(!got.spot.dash || got.spot.dash === 'none', 'the 2 degree ring is solid');
         // no annotation text on the drawing (the author: labels like "sharpest 2°, then a smooth blur" read as code comments)
         const text = await page.evaluate(() => ({ callout: document.querySelector('#f1 .f1-callout'), note: document.querySelector('#f1 .f1-note').textContent }));
         assert.equal(text.callout, null, 'no callout on the drawing');
         assert.equal(text.note, '', 'no narration beside the eye view');
      });

      await check('f1: in "What the glasses see" the layers and the overlay are hidden, and .found marks only objects the 10 degree circle does not touch', async () => {
         await page.locator('#f1 .gaze').focus();
         await page.keyboard.press('Home');
         // gaze to (312, 245): the mug (292, 275, radius 18) is 36 away, inside the clear circle plus its own reach (20 + 18), but farther than 2 degrees would reach (4 + 18)
         await page.keyboard.press('Shift+ArrowLeft'); await page.keyboard.press('Shift+ArrowLeft'); await page.keyboard.press('ArrowLeft');
         await page.locator('#f1 button').nth(1).click();
         const got = await page.evaluate(() => {
            const svg = document.querySelector('#f1 svg'), gz = document.querySelector('#f1 .gaze'), g = [+gz.dataset.gazeX, +gz.dataset.gazeY];
            const marks = [...svg.querySelectorAll('.f1-mark')].map(c => ({ found: c.classList.contains('found'), d: Math.hypot(+c.getAttribute('cx') - g[0], +c.getAttribute('cy') - g[1]), rad: +c.getAttribute('r') - 6 }));
            return { g, marks, layers: getComputedStyle(svg.querySelector('.f1-layers')).display, pale: getComputedStyle(svg.querySelector('.f1-pale')).display,
               clear: +svg.querySelector('.f1-clear').getAttribute('r') };
         });
         assert.deepEqual(got.g, [312, 245]);
         assert.equal(got.layers, 'none'); assert.equal(got.pale, 'none');
         assert.equal(got.clear, 20);
         assert.ok(got.marks.some(m => m.found) && got.marks.some(m => !m.found));
         for (const m of got.marks) assert.equal(m.found, m.d > got.clear + m.rad, 'found only when outside the 10 degree circle: ' + JSON.stringify(m));
         const mug = got.marks.find(m => m.rad === 18);
         assert.equal(mug.found, false, 'the mug right beside the gaze is not marked');
         await page.locator('#f1 button').nth(0).click();
         await page.locator('#f1 .gaze').focus(); await page.keyboard.press('Home');
      });

      await check('f1: every text is at least 26 units in an 800 unit drawing (10 px at 375 px), including the room in <defs>', async () => {
         const got = await page.evaluate(() => { const svg = document.querySelector('#f1 svg');
            return { vb: svg.viewBox.baseVal.width, sizes: [...svg.querySelectorAll('text')].map(t => parseFloat(getComputedStyle(t).fontSize)), inDefs: svg.querySelectorAll('defs text').length }; });
         assert.equal(got.vb, 800);
         assert.ok(got.inDefs >= 9, 'the object labels are in <defs>: ' + got.inDefs);
         assert.ok(Math.min(...got.sizes) >= 26, 'smallest text is ' + Math.min(...got.sizes) + ' units');
      });

      await check('the figure stage keeps its minimum height only while it is empty', async () => {
         const got = await page.evaluate(() => { const filled = document.querySelector('#f1 .fig-stage');
            const empty = document.createElement('div'); empty.className = 'fig-stage'; document.body.appendChild(empty);
            const r = [getComputedStyle(filled).minHeight, getComputedStyle(empty).minHeight]; empty.remove(); return r; });
         assert.equal(got[0], '0px', 'a stage with a figure has no minimum height');
         assert.notEqual(got[1], '0px', 'an empty stage still holds its place');
      });

      await check('f1: legible at 375 px and in dark mode (the figure still draws)', async () => {
         await page.emulateMedia({ colorScheme: 'dark' });
         await figureChecks(page, 'f1');
         await page.emulateMedia({ colorScheme: 'light' });
      });

      await check('f2: the generic figure checks, and the first state already shows the point', async () => {
         await figureChecks(page, 'f2');
         assert.equal(await page.evaluate(() => document.getElementById('f2').dataset.state), 'idle');
         assert.equal(await page.locator('#f2 [data-ask="usb"]').count(), 1);
         assert.equal(await page.locator('#f2 [data-ask="keys"]').count(), 1);
         assert.ok(await page.evaluate(() => document.querySelectorAll('#f2 .f2-trail').length) >= 1, 'the gaze trail is drawn in the first state');
      });

      await check('f2: asking for the USB drive shows the cue, then the highlight, within 3 s', async () => {
         await page.locator('#f2').scrollIntoViewIfNeeded();
         const state = () => page.evaluate(() => document.getElementById('f2').dataset.state);
         await page.click('#f2 [data-ask="usb"]');
         assert.equal(await state(), 'cue-usb');
         assert.equal(await page.evaluate(() => document.getElementById('f2').dataset.cue), 'left');
         await page.waitForFunction(() => document.getElementById('f2').dataset.state === 'found-usb', null, { timeout: 3000 });
         assert.equal(await page.locator('#f2 [data-ask="usb"]').getAttribute('aria-pressed'), 'true');
      });

      await check('f2: with reduced motion, asking goes to found at once', async () => {
         await page.emulateMedia({ reducedMotion: 'reduce' });
         try {
            await page.click('#f2 [data-ask="keys"]');
            assert.equal(await page.evaluate(() => document.getElementById('f2').dataset.state), 'found-keys');
            await page.click('#f2 [data-ask="usb"]');
            assert.equal(await page.evaluate(() => document.getElementById('f2').dataset.state), 'found-usb');
         } finally { await page.emulateMedia({ reducedMotion: 'no-preference' }); }
      });

      await check('f2: asking for the keys during the USB cue ends in found-keys; Enter on the focused keys button works', async () => {
         const state = () => page.evaluate(() => document.getElementById('f2').dataset.state);
         await page.click('#f2 [data-ask="usb"]');
         assert.equal(await state(), 'cue-usb');
         await page.click('#f2 [data-ask="keys"]');
         assert.equal(await state(), 'cue-keys');
         assert.equal(await page.evaluate(() => document.getElementById('f2').dataset.cue), 'right');
         await page.waitForFunction(() => document.getElementById('f2').dataset.state === 'found-keys', null, { timeout: 3000 });
         await new Promise(r => setTimeout(r, 1600));      // the cancelled USB cue must not fire late
         assert.equal(await state(), 'found-keys');
         await page.locator('#f2 [data-ask="usb"]').focus();
         await page.keyboard.press('Enter');
         await page.waitForFunction(() => document.getElementById('f2').dataset.state === 'found-usb', null, { timeout: 3000 });
         await page.locator('#f2 [data-ask="keys"]').focus();
         await page.keyboard.press('Enter');
         await page.waitForFunction(() => document.getElementById('f2').dataset.state === 'found-keys', null, { timeout: 3000 });
      });

      await check('f2: a second ask before the first cue ends cancels the first one (no late found-usb)', async () => {
         const state = () => page.evaluate(() => document.getElementById('f2').dataset.state);
         await page.click('#f2 [data-ask="usb"]');                         // its cue would end 1.3 s after this click
         await page.waitForTimeout(900);
         assert.equal(await state(), 'cue-usb');
         await page.click('#f2 [data-ask="keys"]');
         await page.waitForTimeout(600);                                   // 1.5 s after the first click: the first timer is past due
         assert.equal(await state(), 'cue-keys', 'the first ask\'s timer was cancelled');
         await page.waitForFunction(() => document.getElementById('f2').dataset.state === 'found-keys', null, { timeout: 3000 });
      });

      await check('f2: legible at 375 px and in dark mode (the figure still draws)', async () => {
         await page.emulateMedia({ colorScheme: 'dark' });
         await figureChecks(page, 'f2');
         await page.emulateMedia({ colorScheme: 'light' });
      });

      await check('f3: the generic figure checks, and the first state already shows the point', async () => {
         await figureChecks(page, 'f3');
         const got = await page.evaluate(() => { const f = document.getElementById('f3'); return [f.dataset.link, +f.dataset.level, f.querySelector('.level-name').textContent]; });
         assert.equal(got[0], undefined, 'no link state: the author removed the link toggle');
         assert.ok(got[1] >= 1, 'the first state already shows a lit step of the ladder: ' + got[1]);
         assert.equal(got[2], await page.evaluate(l => HW10.logic.street.LEVELS[l], got[1]));
         assert.equal(await page.locator('#f3 input.bike-pos').count(), 1);
         assert.equal(await page.locator('#f3 [data-toggle="link"]').count(), 0, 'no link button');
         assert.equal(await page.evaluate(() => document.querySelectorAll('#f3 [data-bike]').length), 1, 'the bicycle is drawn');
      });

      await check('f3: slider at 0 is level 0; at 100 it is level 5 and the name reads "forced overlay"', async () => {
         await page.locator('#f3').scrollIntoViewIfNeeded();
         const set = v => page.evaluate(v => { const i = document.querySelector('#f3 input.bike-pos'); i.value = v; i.dispatchEvent(new Event('input', { bubbles: true })); }, v);
         const level = () => page.evaluate(() => +document.getElementById('f3').dataset.level);
         const name = () => page.evaluate(() => document.querySelector('#f3 .level-name').textContent.trim());
         await set(0);
         assert.equal(await level(), 0);
         assert.equal(await name(), 'none');
         await set(100);
         assert.equal(await level(), 5);
         assert.equal(await name(), 'forced overlay');
         const x = async v => { await set(v); return page.evaluate(() => { const b = document.querySelector('#f3 [data-bike]'); return b.getAttribute('transform'); }); };
         assert.notEqual(await x(0), await x(100), 'the bicycle moves along its path');
      });

      await check('f3: ArrowRight on the focused slider raises the level from a position below 100, and the level never falls', async () => {
         const level = () => page.evaluate(() => +document.getElementById('f3').dataset.level);
         await page.evaluate(() => { const i = document.querySelector('#f3 input.bike-pos'); i.value = 0; i.dispatchEvent(new Event('input', { bubbles: true })); });
         await page.locator('#f3 input.bike-pos').focus();
         const l0 = await level();
         let last = l0, raised = false;
         for (let i = 0; i < 100; i++) {
            await page.keyboard.press('ArrowRight');
            const l = await level();
            assert.ok(l >= last, 'the level fell');
            if (l > last) raised = true;
            last = l;
         }
         assert.ok(raised && last > l0, `${l0} -> ${last}`);
         assert.equal(await page.evaluate(() => document.querySelector('#f3 input.bike-pos').value), '100');
      });

      await check('f3: dragging the bicycle moves the slider; legible at 375 px and in dark mode', async () => {
         await page.evaluate(() => { const i = document.querySelector('#f3 input.bike-pos'); i.value = 0; i.dispatchEvent(new Event('input', { bubbles: true })); });
         await page.locator('#f3').scrollIntoViewIfNeeded();
         const box = await page.locator('#f3 [data-bike]').boundingBox();
         const svg = await page.locator('#f3 svg').first().boundingBox();
         const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
         await page.mouse.move(cx, cy);
         await page.mouse.down();
         await page.mouse.move(cx - svg.width * 0.3, cy - svg.height * 0.3, { steps: 8 });
         await page.mouse.up();
         assert.ok(+await page.evaluate(() => document.querySelector('#f3 input.bike-pos').value) > 30, 'the drag moved the bicycle along its path');
         await page.emulateMedia({ colorScheme: 'dark' });
         await figureChecks(page, 'f3');
         await page.emulateMedia({ colorScheme: 'light' });
      });

      await check('f5: the generic figure checks; the first state is Ben\'s line (the clip\'s start, the AI quiet), and one Next brings the alert: the cue on the right, with the sentence as text', async () => {
         await figureChecks(page, 'f5');
         const start = await page.evaluate(() => { const f = document.getElementById('f5'); return [f.dataset.line, f.dataset.speaker, f.dataset.state, f.dataset.cue, f.querySelector('.f5-pill').classList.contains('on')]; });
         assert.deepEqual(start, ['d10', 'ben', 'listen', 'none', false], 'the author chose to open on Ben\'s line, for a live demo');
         await page.locator('#f5 [data-step="1"]').click();
         const got = await page.evaluate(() => { const f = document.getElementById('f5'); return [f.dataset.line, f.dataset.speaker, f.dataset.state, f.dataset.cue,
            f.querySelectorAll('[data-play]').length, f.querySelectorAll('[data-step="-1"]').length, f.querySelectorAll('[data-step="1"]').length,
            f.querySelector('.f5-pill').classList.contains('on'), f.querySelector('.f5-pill').textContent]; });
         assert.deepEqual(got.slice(0, 4), ['d11', 'tom', 'alert', 'right']);
         assert.deepEqual(got.slice(4, 7), [1, 1, 1]);
         assert.equal(got[7], true);
         assert.ok(got[8].includes('Hand tracking is your part, right?'), got[8]);
         // spec 2.3: the AI never draws inside the 2 degrees I look at. The centre of my view says what I look at; the cue's text sits
         // at the edge, on Kaifang's side, and does not run into the centre.
         const geo = await page.evaluate(() => { const f = document.getElementById('f5'), svg = f.querySelector('svg'), vbw = svg.viewBox.baseVal.width;
            const box = el => { const b = el.getBBox(); return { l: b.x, r: b.x + b.width }; };
            const texts = [...f.querySelectorAll('.f5-pill text')].filter(t => t.textContent.trim());
            const pill = f.querySelector('.f5-pill'), rect = pill.querySelector('rect');
            return { vbw, pill: box(rect), pillTexts: texts.map(box), pillLines: texts.length, looking: box(f.querySelector('.f5-looking')),
               lookingText: f.querySelector('.f5-looking').textContent.replace(/\s+/g, ' ').trim(), pillW: rect.getBBox().width }; });
         assert.equal(geo.lookingText, 'looking at my laptop', 'the centre keeps showing what I look at');
         assert.ok(geo.pill.l > geo.vbw / 2, `the cue's pill starts right of the centre of my view: ${geo.pill.l} vs ${geo.vbw / 2}`);
         assert.ok(geo.pill.l >= geo.looking.r, `the cue does not touch the centre text: pill from ${geo.pill.l}, text to ${geo.looking.r}`);
         assert.ok(geo.pill.r >= geo.vbw - 40, 'the cue sits at the right edge of my view: ' + geo.pill.r);
         assert.ok(geo.pillLines >= 2 && geo.pillLines <= 3, 'the speaker on one line, the sentence in two at most: ' + geo.pillLines);
         for (const t of geo.pillTexts) assert.ok(t.l >= geo.pill.l && t.r <= geo.pill.r, 'the sentence stays inside its pill');
      });

      await check('f5: stepping reaches the alert on "your part"; the speaker changes; the alert is only where the logic says', async () => {
         await page.locator('#f5').scrollIntoViewIfNeeded();
         const st = () => page.evaluate(() => { const f = document.getElementById('f5'); return [f.dataset.line, f.dataset.speaker, f.dataset.state]; });
         // go to the first line, then step through every line
         for (let i = 0; i < 20; i++) await page.click('#f5 [data-step="-1"]', { timeout: 500 }).catch(() => {});
         const first = await st();
         assert.equal(first[0], 'd1');
         assert.equal(first[2], 'listen');
         const speakers = new Set([first[1]]), alerts = [];
         for (let i = 0; i < 15; i++) {
            await page.click('#f5 [data-step="1"]');
            const [line, speaker, state] = await st();
            speakers.add(speaker);
            const want = await page.evaluate(id => { const l = HW10.story.dialogue.find(x => x.id === id), T = HW10.logic.table;
               return [l.by, T.nameAlert(l, T.attendingAt(l.t))]; }, line);
            assert.equal(speaker, want[0], line + ': the speaker');
            assert.equal(state === 'alert', want[1], line + ': the state');
            if (state === 'alert') alerts.push(line);
         }
         assert.deepEqual(alerts, ['d11']);
         assert.ok(speakers.size >= 4, 'the shown speaker changes: ' + [...speakers]);
         assert.equal(await page.locator('#f5 [data-step="1"]').isDisabled(), true, 'the last line has no next');
         // at the alert, the cue shows the last sentence as text, on the speaker side
         for (let i = 0; i < 5; i++) await page.click('#f5 [data-step="-1"]');
         assert.equal((await st())[0], 'd11');
         assert.equal(await page.evaluate(() => document.getElementById('f5').dataset.state), 'alert');
         assert.equal(await page.evaluate(() => document.getElementById('f5').dataset.cue), 'right');
         assert.ok((await page.locator('#f5 svg').first().textContent()).includes('Hand tracking is your part, right?'));
      });

      await check('f5: Play reaches the alert within 10 s, and with reduced motion at once', async () => {
         await page.click('#f5 [data-step="-1"]');            // d10: not an alert
         assert.equal(await page.evaluate(() => document.getElementById('f5').dataset.state), 'listen');
         await page.click('#f5 [data-play]');
         await page.waitForFunction(() => document.getElementById('f5').dataset.state === 'alert', null, { timeout: 10000 });
         assert.equal(await page.evaluate(() => document.getElementById('f5').dataset.line), 'd11');
         await page.waitForFunction(() => document.getElementById('f5').dataset.line === 'd12' && document.querySelector('#f5 [data-play]').getAttribute('aria-pressed') === 'false', null, { timeout: 10000 });
         assert.equal(await page.evaluate(() => document.getElementById('f5').dataset.state), 'listen');
         await page.emulateMedia({ reducedMotion: 'reduce' });
         try {
            await page.click('#f5 [data-step="-1"]'); await page.click('#f5 [data-step="-1"]'); await page.click('#f5 [data-step="-1"]');
            assert.equal(await page.evaluate(() => document.getElementById('f5').dataset.state), 'listen');
            await page.click('#f5 [data-play]');
            assert.equal(await page.evaluate(() => document.getElementById('f5').dataset.state), 'alert');
         } finally { await page.emulateMedia({ reducedMotion: 'no-preference' }); }
      });

      await check('f5: a step during Play stops it; legible at 375 px and in dark mode', async () => {
         await page.click('#f5 [data-step="-1"]'); await page.click('#f5 [data-step="-1"]');
         await page.click('#f5 [data-play]');
         await page.click('#f5 [data-step="-1"]');
         const line = await page.evaluate(() => document.getElementById('f5').dataset.line);
         await new Promise(r => setTimeout(r, 1900));
         assert.equal(await page.evaluate(() => document.getElementById('f5').dataset.line), line, 'no late tick after a manual step');
         await page.emulateMedia({ colorScheme: 'dark' });
         await figureChecks(page, 'f5');
         await page.emulateMedia({ colorScheme: 'light' });
      });

      const f7 = () => page.evaluate(() => { const f = document.getElementById('f7'); return { selected: f.dataset.selected, view: f.dataset.view }; });
      const f7visible = () => page.evaluate(() => [...document.querySelectorAll('#f7 [data-item]')].filter(b => b.offsetParent !== null).map(b => b.dataset.item));
      const f7sources = () => page.evaluate(() => document.querySelector('#f7 .sources').textContent.replace(/\s+/g, ' '));
      const f7reset = async () => { await page.click('#f7 [data-view="everyone"]'); };

      await check('f7: the generic figure checks; the first state shows the minutes, one item opened onto its sources', async () => {
         await figureChecks(page, 'f7');
         const got = await f7();
         assert.equal(got.view, 'everyone');
         const items = await page.evaluate(() => [...document.querySelectorAll('#f7 [data-item]')].map(b => b.dataset.item));
         assert.deepEqual(items, await page.evaluate(() => HW10.story.minutes.map(m => m.id)), 'every minutes item is a button, in order');
         assert.ok(items.includes(got.selected), 'an item is already selected: ' + got.selected);
         const src = await page.evaluate(id => { const S = HW10.story; return HW10.logic.minutes.sourcesOf(S, id).dialogue[0].text; }, got.selected);
         assert.ok((await f7sources()).includes(src), 'its first sentence is shown');
         assert.deepEqual(await f7visible(), items, 'everyone: all items shown');
         assert.equal(await page.locator('#f7 [data-view]').count(), 2);
         const text = await page.locator('#f7').textContent();
         for (const w of ['Decisions', 'Open questions']) assert.ok(text.includes(w), 'the minutes show "' + w + '"');
         assert.ok(/Actions?/.test(text) && /Thu 3 Dec/.test(text) && /Ben/.test(text), 'actions show owner and due');
         assert.ok(!/photo|image|picture/i.test(text), 'Ruling 3: text, never photo or image');
      });

      await check('f7: clicking an item selects it and shows its first sentence and its board version', async () => {
         await page.locator('#f7').scrollIntoViewIfNeeded();
         for (const id of ['m1', 'm4', 'm8', 'm9']) {
            await page.click(`#f7 [data-item="${id}"]`);
            assert.equal((await f7()).selected, id);
            assert.equal(await page.getAttribute(`#f7 [data-item="${id}"]`, 'aria-pressed'), 'true');
            const first = await page.evaluate(i => { const S = HW10.story, src = HW10.logic.minutes.sourcesOf(S, i); return { d: src.dialogue.map(x => x.text), b: src.board.map(v => v.lines[0]) }; }, id);
            await page.waitForFunction(() => document.getElementById('f7').dataset.reveal === 'done', null, { timeout: 5000 });
            const txt = await f7sources();
            assert.ok(txt.includes(first.d[0]), id + ': the first sentence is shown');
            for (const t of [...first.d, ...first.b]) assert.ok(txt.includes(t), id + ': shows ' + t);
         }
         assert.equal(await page.getAttribute('#f7 [data-item="m1"]', 'aria-pressed'), 'false');
      });

      await check('f7: the "missed" view shows exactly missed(), titled "What you missed", and "everyone" brings the rest back', async () => {
         const want = await page.evaluate(() => [...HW10.logic.minutes.missed(HW10.story)]);
         await page.click('#f7 [data-view="missed"]');
         assert.equal((await f7()).view, 'missed');
         assert.deepEqual(await f7visible(), want);
         assert.ok(want.length >= 1 && want.length < 9);
         assert.ok((await page.locator('#f7').textContent()).includes('What you missed'));
         assert.ok(want.includes((await f7()).selected), 'the selected item is one of the missed items');
         assert.equal(await page.getAttribute('#f7 [data-view="missed"]', 'aria-pressed'), 'true');
         // the sources say which of them I missed
         await page.click(`#f7 [data-item="${want[0]}"]`);
         await page.waitForFunction(() => document.getElementById('f7').dataset.reveal === 'done', null, { timeout: 5000 });
         assert.ok(/missed/i.test(await f7sources()), 'a source is marked missed');
         await page.click('#f7 [data-view="everyone"]');
         assert.equal((await f7()).view, 'everyone');
         assert.equal((await f7visible()).length, 9);
         assert.ok(!/missed/i.test(await f7sources()), 'the shared record carries no personal marks');
      });

      await check('f7: a click on a second item during the first one\'s reveal ends with the second selected and its sources shown', async () => {
         await page.click('#f7 [data-item="m5"]');
         await page.click('#f7 [data-item="m6"]');
         await page.click('#f7 [data-item="m3"]');
         assert.equal((await f7()).selected, 'm3');
         await page.waitForTimeout(2500);
         assert.equal((await f7()).selected, 'm3');
         const txt = await f7sources();
         const want = await page.evaluate(() => { const s = HW10.logic.minutes.sourcesOf(HW10.story, 'm3'); return s.dialogue.map(d => d.text); });
         for (const t of want) assert.ok(txt.includes(t), 'm3 sources: ' + t);
         for (const t of await page.evaluate(() => HW10.logic.minutes.sourcesOf(HW10.story, 'm6').dialogue.map(d => d.text))) assert.ok(!txt.includes(t), 'no sentence of m6 is left: ' + t);
         assert.equal(await page.evaluate(() => document.getElementById('f7').dataset.reveal), 'done');
      });

      await check('f7: with reduced motion the sources are all there at once; legible at 375 px, in dark mode, font size >= 10 px', async () => {
         await page.emulateMedia({ reducedMotion: 'reduce' });
         try {
            await page.click('#f7 [data-item="m5"]');
            assert.equal(await page.evaluate(() => document.getElementById('f7').dataset.reveal), 'done');
            const shown = await page.evaluate(() => [...document.querySelectorAll('#f7 .sources .f7-block')].map(e => getComputedStyle(e).opacity));
            assert.ok(shown.length >= 2 && shown.every(o => o === '1'), 'every block is visible: ' + shown);
         } finally { await page.emulateMedia({ reducedMotion: 'no-preference' }); }
         await page.click('#f7 [data-view="missed"]');
         await page.emulateMedia({ colorScheme: 'dark' });
         await figureChecks(page, 'f7');
         await page.emulateMedia({ colorScheme: 'light' });
         await figureChecks(page, 'f7');
         await f7reset();
         const fs = await page.evaluate(() => { const vb = document.querySelector('#f7 svg').viewBox.baseVal.width;
            return Math.min(...[...document.querySelectorAll('#f7 svg text')].map(t => +t.getAttribute('font-size'))) * 317 / vb; });
         assert.ok(fs >= 10, 'font size at 375 px is ' + fs);
      });

      await check('f7: at 1280 the evidence card is to the right of the list with its top level with the list\'s top, also after a click and in the missed view; at 375 px it is under the list', async () => {
         const geo = () => page.evaluate(() => { const r = e => e.getBoundingClientRect(), list = r(document.querySelector('#f7 .f7-doc')), card = r(document.querySelector('#f7 svg.f7-svg'));
            return { list: [list.left, list.top, list.right, list.bottom], card: [card.left, card.top, card.right, card.bottom] }; });
         await inView('', async () => {
            const steps = [async () => {}, async () => { await page.click('#f7 [data-item="m1"]'); }, async () => { await page.click('#f7 [data-item="m9"]'); },
               async () => { await page.click('#f7 [data-view="missed"]'); }, async () => { await page.click('#f7 [data-view="everyone"]'); }];
            for (const [i, step] of steps.entries()) {
               await step();
               const g = await geo();
               assert.ok(g.card[0] >= g.list[2] - 1, `step ${i}: the card is not to the right of the list: ${JSON.stringify(g)}`);
               assert.ok(Math.abs(g.card[1] - g.list[1]) <= 4, `step ${i}: tops differ by ${Math.abs(g.card[1] - g.list[1])}: ${JSON.stringify(g)}`);
            }
         });
         const before = page.viewportSize();
         await page.setViewportSize({ width: 375, height: 800 });
         try {
            const g = await geo();
            assert.ok(g.card[1] >= g.list[3] - 1 && g.card[2] <= 375, 'at 375 px the card is under the list: ' + JSON.stringify(g));
         } finally { await page.setViewportSize(before); }
      });

      await check('f7: every item in both views fits its card: no text leaves the frame', async () => {
         const ids = await page.evaluate(() => HW10.story.minutes.map(m => m.id));
         for (const view of ['everyone', 'missed']) {
            await page.click(`#f7 [data-view="${view}"]`);
            const shown = await page.evaluate(() => [...document.querySelectorAll('#f7 [data-item]')].filter(b => b.offsetParent !== null).map(b => b.dataset.item));
            assert.ok(shown.length >= 1 && shown.every(id => ids.includes(id)));
            for (const id of shown) {
               await page.click(`#f7 [data-item="${id}"]`);
               await page.waitForFunction(() => document.getElementById('f7').dataset.reveal === 'done', null, { timeout: 5000 });
               const out = await page.evaluate(() => { const svg = document.querySelector('#f7 svg.f7-svg'), vb = svg.viewBox.baseVal;
                  return [...svg.querySelectorAll('.sources text')].map(t => { const b = t.getBBox(), c = t.parentNode.transform.baseVal.consolidate(), dy = c ? c.matrix.f : 0;
                     return [t.textContent.trim().slice(0, 24), b.x, b.x + b.width, b.y + b.height + dy]; }).filter(([, x0, x1, y1]) => x0 < 4 || x1 > vb.width - 4 || y1 > vb.height - 2); });
               assert.deepEqual(out, [], `${view} ${id}: text outside the card`);
            }
         }
         await f7reset();
      });

      // ---- f9, the glasses taken apart ----
      const f9 = () => page.evaluate(() => document.getElementById('f9').dataset.selected);
      const f9panel = () => page.evaluate(() => document.querySelector('#f9 .f9-panel').textContent.replace(/\s+/g, ' '));

      await check('f9: the generic figure checks; seven focusable parts, and the first state already shows one part\'s principle', async () => {
         await figureChecks(page, 'f9');
         const ids = await page.evaluate(() => [...document.querySelectorAll('#f9 svg [data-part]')].map(g => [g.dataset.part, g.getAttribute('tabindex'), g.tagName.toLowerCase()]));
         assert.deepEqual(ids, ['wide-cameras', 'eye-cameras', 'thermal', 'depth', 'mic-array', 'bone-mic', 'speakers'].map(id => [id, '0', 'g']));
         const sel = await f9();
         assert.ok(sel, 'a part is already selected');
         const part = await page.evaluate(id => HW10.logic.glasses.PARTS.find(p => p.id === id), sel);
         const txt = await f9panel();
         assert.ok(txt.includes(part.principle) && txt.includes(part.adds), 'its principle and what it adds are shown');
         assert.ok(!/photo/i.test(await page.locator('#f9').textContent()), 'Ruling 3');
      });

      await check('f9: focusing a part and pressing Enter selects it and shows its principle and what it adds, for each part', async () => {
         await page.locator('#f9').scrollIntoViewIfNeeded();
         const parts = await page.evaluate(() => HW10.logic.glasses.PARTS.map(p => ({ ...p })));
         for (const p of parts.slice().reverse()) {
            await page.focus(`#f9 [data-part="${p.id}"]`);
            await page.keyboard.press('Enter');
            assert.equal(await f9(), p.id);
            assert.equal(await page.getAttribute(`#f9 [data-part="${p.id}"]`, 'aria-pressed'), 'true');
            const txt = await f9panel();
            assert.ok(txt.includes(p.name) && txt.includes(p.principle) && txt.includes(p.adds), p.id + ': the panel says it');
         }
         assert.equal(await page.locator('#f9 [data-part][aria-pressed="true"]').count(), 1, 'one part at a time');
         await page.focus('#f9 [data-part="depth"]');
         await page.keyboard.press('Space');
         assert.equal(await f9(), 'depth', 'Space selects too');
      });

      await check('f9: hovering and clicking a part select it too', async () => {
         await page.hover('#f9 [data-part="thermal"]');
         assert.equal(await f9(), 'thermal');
         await page.hover('#f9 [data-part="mic-array"]');
         assert.equal(await f9(), 'mic-array');
         await page.click('#f9 [data-part="speakers"]');
         assert.equal(await f9(), 'speakers');
         const txt = await f9panel();
         assert.ok(txt.includes(await page.evaluate(() => HW10.logic.glasses.PARTS.find(p => p.id === 'speakers').principle)));
      });

      await check('f9: the drawing has a label for every part and no two labels overlap; font size >= 10 px at 375 px, dark mode', async () => {
         const boxes = await page.evaluate(() => [...document.querySelectorAll('#f9 svg text')].map(t => { const r = t.getBoundingClientRect(); return [t.textContent, r.left, r.top, r.right, r.bottom]; }));
         assert.ok(boxes.length >= 7 && (await page.locator('#f9 svg [data-part] text').count()) >= 7, 'every part is labelled: ' + boxes.length);
         for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
            const [, l1, t1, r1, b1] = boxes[i], [, l2, t2, r2, b2] = boxes[j];
            assert.ok(r1 <= l2 || r2 <= l1 || b1 <= t2 || b2 <= t1, `labels overlap: ${boxes[i][0]} and ${boxes[j][0]}`);
         }
         await page.emulateMedia({ colorScheme: 'dark' });
         await figureChecks(page, 'f9');
         await page.emulateMedia({ colorScheme: 'light' });
         await figureChecks(page, 'f9');
         const fs = await page.evaluate(() => { const vb = document.querySelector('#f9 svg').viewBox.baseVal.width;
            return Math.min(...[...document.querySelectorAll('#f9 svg text')].map(t => +t.getAttribute('font-size'))) * 317 / vb; });
         assert.ok(fs >= 10, 'font size at 375 px is ' + fs);
         const before = page.viewportSize();
         await page.setViewportSize({ width: 375, height: 800 });
         try {
            const over = await page.evaluate(() => [document.documentElement.scrollWidth - innerWidth, document.getElementById('f9').scrollWidth - document.getElementById('f9').clientWidth]);
            assert.ok(over[0] <= 1 && over[1] <= 1, 'no sideways scroll at 375 px: ' + over);
         } finally { await page.setViewportSize(before); }
      });

      await check('#notes lists the sources', async () => {
         const text = await page.evaluate(() => document.getElementById('notes').textContent);
         for (const s of ['Simons', 'Chabris', '1999', 'Strasburger', '2011', 'The Way Things Work', '1967', 'archive.org/details/waythingswork0000vari_j3y5'])
            assert.ok(text.includes(s), '#notes lacks ' + s);
      });

      // ---- fix round 4: the author's review (fix4-spec.md) -----------------------------------------------------------------
      await check('the hero at 1280 x 847: the buttons are a row above the drawing, the figure is as wide as its drawing, the hero line is to the right of F1 and centred on it, and the whole hero is in the first screen', () => inView('', async () => {
         await jump(0);
         const got = await page.evaluate(() => { const r = e => e.getBoundingClientRect(), f1 = document.getElementById('f1'), svg = f1.querySelector('svg'), line = document.querySelector('#top .under-fig');
            return { fig: r(f1), svg: r(svg), line: r(line), buttons: [...f1.querySelectorAll('button')].map(b => r(b)), cap: r(f1.querySelector('figcaption')),
               thesis: r(document.querySelector('#top .thesis')), vh: innerHeight, order: [...document.querySelectorAll('#top > *')].map(e => e.tagName + (e.id ? '#' + e.id : '')) }; });
         assert.deepEqual(got.order, ['H1', 'P', 'FIGURE#f1', 'P'], 'the DOM order is kept: h1, subtitle, F1, the line');
         assert.equal(got.buttons.length, 2);
         for (const b of got.buttons) assert.ok(b.bottom <= got.svg.top + 1, `a button is above the drawing: bottom ${b.bottom}, drawing top ${got.svg.top}`);
         assert.ok(Math.abs(got.buttons[0].top - got.buttons[1].top) <= 2 && got.buttons[1].left >= got.buttons[0].right - 1, 'the two buttons are in one row');
         assert.ok(got.fig.width - got.svg.width <= 40, `the figure box is as wide as its drawing: box ${got.fig.width.toFixed(0)}, drawing ${got.svg.width.toFixed(0)}`);
         assert.ok(got.line.left >= got.fig.right + 16, `the hero line is to the right of F1: line left ${got.line.left}, figure right ${got.fig.right}`);
         const mid = r => (r.top + r.bottom) / 2;
         assert.ok(Math.abs(mid(got.line) - mid(got.fig)) <= 30, `the hero line is vertically centred on F1: ${mid(got.line).toFixed(0)} vs ${mid(got.fig).toFixed(0)}`);
         assert.ok(got.line.right <= 1280 && got.line.width >= 250, 'the hero line has room: ' + got.line.width);
         assert.ok(got.cap.bottom <= got.vh && got.fig.bottom <= got.vh && got.line.bottom <= got.vh, 'title, subtitle, buttons, drawing, caption and the line are in the first screen: ' + JSON.stringify([got.fig.bottom, got.vh]));
         const text = await page.evaluate(() => [...document.querySelectorAll('#f1 svg text')].map(t => { const m = t.getScreenCTM(); return parseFloat(getComputedStyle(t).fontSize) * Math.hypot(m.a, m.b); }));
         assert.ok(text.length >= 9 && text.every(px => px >= 20 && px <= 24), 'F1 SVG text is 20 to 24 px at 1280: ' + text.map(x => x.toFixed(1)));
      }));

      await check('the hero at 375 px: everything stacks, the buttons are above the drawing, the hero line is below F1, and F1 text is at least 10 px', async () => {
         const before = page.viewportSize();
         await page.setViewportSize({ width: 375, height: 800 });
         try {
            await jump(0);
            const got = await page.evaluate(() => { const r = e => e.getBoundingClientRect(), f1 = document.getElementById('f1');
               return { fig: r(f1), svg: r(f1.querySelector('svg')), line: r(document.querySelector('#top .under-fig')), buttons: [...f1.querySelectorAll('button')].map(b => r(b)),
                  over: document.documentElement.scrollWidth - innerWidth, thesis: r(document.querySelector('#top .thesis')) }; });
            assert.ok(got.line.top >= got.fig.bottom - 1, `the hero line is below F1 at 375 px: ${got.line.top} vs ${got.fig.bottom}`);
            for (const b of got.buttons) assert.ok(b.bottom <= got.svg.top + 1, 'a button is above the drawing at 375 px');
            assert.ok(got.fig.top >= got.thesis.bottom - 1 && got.over <= 1, 'stacked, no sideways scroll');
            await figureChecks(page, 'f1');
         } finally { await page.setViewportSize(before); await jump(0); }
      });

      await check('#story: "The scenario" and its four lines come right before scene 1, are not a scene, and the bar marks nothing while it is read', () => inView('', async () => {
         const got = await page.evaluate(() => { const s = document.getElementById('story'), nxt = s.nextElementSibling, prev = s.previousElementSibling;
            return { h: s.querySelector('h2').textContent, ps: [...s.querySelectorAll(':scope > p')].map(p => p.textContent), prev: prev.id, next: nxt.id, nextNext: nxt.nextElementSibling.id,
               links: [...document.querySelectorAll('nav#scenebar a')].map(a => a.getAttribute('href')), scene: s.classList.contains('scene') }; });
         assert.equal(got.h, 'The scenario');
         assert.deepEqual(got.ps, COPY.story.slice(1));
         assert.equal(got.prev, 'glasses'); assert.equal(got.next, 'scene-1'); assert.equal(got.nextNext, 'scene-2');
         assert.ok(!got.links.includes('#story') && !got.scene, 'it is not a scene');
         await jump(await page.evaluate(() => document.getElementById('story').getBoundingClientRect().top + scrollY - 80));
         await page.waitForTimeout(300);
         assert.deepEqual(await current(), [null, null, null, null], 'the bar marks nothing while the story is read');
         await jump(0);
      }));

      await check('every scene line has a bar of the same colour, and the colour means nothing (one value across the glasses and the four scenes)', async () => {
         const got = await page.evaluate(() => [...document.querySelectorAll('.lines p')].map(p => getComputedStyle(p).borderLeftColor + ' ' + getComputedStyle(p).borderLeftWidth));
         assert.equal(got.length, 15, 'lines measured (3 glasses lines + 4 scenes x 3): ' + got.length);
         assert.equal(new Set(got).size, 1, 'one bar colour: ' + [...new Set(got)]);
         assert.ok(!/0px/.test(got[0]), 'the bar shows');
      });

      await check('Street: the Forza Horizon 5 photo sits under F3 in the figure column, loads from a local file, has alt text and a one-sentence credit caption; Notes lists the game', async () => {
         await page.locator('#street-photo').scrollIntoViewIfNeeded();
         const got = await page.evaluate(() => { const f = document.getElementById('street-photo'), img = f.querySelector('img'), f3 = document.getElementById('f3');
            const r = img.getBoundingClientRect(), r3 = f3.getBoundingClientRect();
            return { parent: f.parentElement.id, after: f.previousElementSibling.id, src: img.getAttribute('src'), loaded: img.complete && img.naturalWidth > 0, alt: img.alt,
               cap: f.querySelector('figcaption').textContent.trim(), left: Math.round(r.left), left3: Math.round(r3.left), top: r.top, bottom3: r3.bottom,
               notes: document.getElementById('notes').textContent, fig: f.classList.contains('fig') || f.hasAttribute('data-fig') }; });
         assert.equal(got.parent, 'scene-2'); assert.equal(got.after, 'f3');
         assert.equal(got.src, 'img/forza-navigation.jpg');
         assert.ok(got.loaded, 'the image loads');
         assert.ok(got.alt.length > 20, 'alt text');
         assert.match(got.cap, /Forza Horizon 5/); assert.equal((got.cap.match(/[.!?](\s|$)/g) || []).length, 1, 'one sentence: ' + got.cap);
         assert.equal(got.left, got.left3, 'in the figure column, aligned with F3'); assert.ok(got.top >= got.bottom3, 'under F3');
         assert.match(got.notes, /Forza Horizon 5/);
         assert.equal(got.fig, false, 'a photo, not an interactive figure');
      });

      await check('F5: the narrator\'s device is "My device", the readout says "I speak." for the narrator and never "Me speaks" or "You speaks", and the seat label is "Me"', async () => {
         await page.locator('#f5').scrollIntoViewIfNeeded();
         const read = () => page.evaluate(() => { const f = document.getElementById('f5'); return { line: f.dataset.line, readout: f.querySelector('.f5-readout').textContent, text: f.querySelector('svg').textContent.replace(/\s+/g, ' '),
            seats: [...f.querySelectorAll('svg text')].map(t => t.textContent.trim()).filter(t => /^(Me|You|Siva|Ben|James|Kaifang)$/.test(t)) }; });
         const to = async id => { for (let i = 0; i < 20 && (await read()).line !== id; i++) await page.click(`#f5 [data-step="${+(await read()).line.slice(1) < +id.slice(1) ? 1 : -1}"]`); };
         const start = await read();
         assert.ok(start.seats.includes('Me') && !start.seats.includes('You'), 'seats: ' + start.seats);
         await to('d4');
         const mine = await read();
         assert.equal(mine.line, 'd4');
         assert.ok(/I speak\./.test(mine.readout), mine.readout);
         assert.ok(!/\b(Me|You|I) speaks\b/.test(mine.readout), mine.readout);
         assert.ok(mine.text.includes('My device'), 'the line is written by "My device": ' + mine.text);
         await to('d11');
         const tom = await read();
         assert.ok(/Kaifang speaks\./.test(tom.readout) && !/I speak/.test(tom.readout), tom.readout);
         assert.ok(tom.text.includes("Kaifang's device"));
         assert.equal((await read()).line, 'd11');
      });

      await check('F7: the headings are "Decisions", "Action items", "Open questions" (text-transform none), the owner is "Me, Fri 27 Nov", the board line is "Me: hand tracking", and the missed view has exactly six items', async () => {
         await page.locator('#f7').scrollIntoViewIfNeeded();
         const heads = await page.evaluate(() => [...document.querySelectorAll('#f7 .f7-head')].map(h => [h.textContent, getComputedStyle(h).textTransform]));
         assert.deepEqual(heads, [['Decisions', 'none'], ['Action items', 'none'], ['Open questions', 'none']]);
         const rendered = await page.evaluate(() => [...document.querySelectorAll('#f7 .f7-head')].map(h => h.innerText));
         assert.deepEqual(rendered, ['Decisions', 'Action items', 'Open questions'], 'rendered as written, not in capitals');
         const meta = await page.evaluate(() => [...document.querySelectorAll('#f7 .f7-meta')].map(m => m.textContent));
         assert.ok(meta.includes('Me, Fri 27 Nov') && !meta.some(m => /^You/.test(m)), meta.join(' | '));
         await page.click('#f7 [data-item="m7"]');
         await page.waitForFunction(() => document.getElementById('f7').dataset.reveal === 'done', null, { timeout: 5000 });
         assert.ok((await page.evaluate(() => document.querySelector('#f7 svg').textContent)).includes('Me: hand tracking'), 'the board line is "Me: hand tracking"');
         await page.click('#f7 [data-view="missed"]');
         const six = await page.evaluate(() => [...document.querySelectorAll('#f7 .f7-item')].filter(b => !b.closest('li').hidden && b.getBoundingClientRect().height > 0).length);
         assert.equal(six, 6, 'the missed view has six items (the closing says so)');
         const readout = await page.evaluate(() => document.querySelector('#f7 .f7-readout').textContent);
         assert.ok(/Only I see this/.test(readout) && !/\bYou\b|\bYour\b/.test(readout), readout);
         await page.click('#f7 [data-view="everyone"]');
         await page.click('#f7 [data-item="m5"]');
      });

      await check('F9: the panel has the part, the principle and what it adds with no labels, and "The AI keeps events. It does not keep video."', async () => {
         await page.focus('#f9 [data-part="wide-cameras"]');
         await page.keyboard.press('Enter');
         const panel = await page.evaluate(() => { const p = document.querySelector('#f9 .f9-panel'); return { text: p.textContent, ps: p.querySelectorAll('p').length, strong: p.querySelectorAll('strong').length }; });
         assert.ok(!/The principle\.|What it adds\./.test(panel.text), panel.text);
         assert.equal(panel.ps, 3); assert.equal(panel.strong, 0, 'no label elements');
         assert.ok(panel.text.includes('The AI keeps events. It does not keep video.') && !/not as video/.test(panel.text), panel.text);
      });

      await check('scene 4 names the same things F7 shows: "I look at: Siva, my laptop, Kaifang" matches the tags', async () => {
         await page.click('#f7 [data-view="missed"]');
         const tags = await page.evaluate(() => { const tx = [...document.querySelectorAll('#f7 .f7-item')].filter(b => !b.closest('li').hidden).map(b => b.dataset.item);
            const all = [];
            for (const id of tx) { document.querySelector(`#f7 [data-item="${id}"]`).click(); all.push(document.querySelector('#f7 svg').textContent); }
            return all.join(' '); });
         for (const w of ['watching Siva', 'at laptop', 'watching Kaifang']) assert.ok(tags.includes(w), 'F7 has the tag "' + w + '"');
         await page.click('#f7 [data-view="everyone"]');
         await page.click('#f7 [data-item="m5"]');
      });

      await check('screens: no sideways scroll and no console or page error at 375 px', async () => {
         const before = page.viewportSize();
         await page.setViewportSize({ width: 375, height: 800 });
         try {
            const over = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
            assert.ok(over <= 1, 'sideways scroll at 375 px: ' + over);
         } finally { await page.setViewportSize(before); await jump(0); }
         assert.deepEqual(consoleErrors, []); assert.deepEqual(pageErrors, []);
      });

      await context.close();
   } finally {
      await browser.close().catch(() => {});
   }
   console.log(`${passed} hw10 browser checks passed.`);
})().catch(e => { console.error(e); process.exit(1); });
