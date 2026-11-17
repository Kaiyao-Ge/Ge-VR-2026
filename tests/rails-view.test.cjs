// Rails checks without a browser: what a card draws (on a recording 2D context), when its canvas is painted again, the quads on it,
// the line-font text and the stage's pools (on fake Clay nodes), the timeline strip, the bus and its plugs (busView.js, bus3d.js on fake
// nodes) and the bus window (busWindowDraw.js on a recording context; busWindowView.js: its one canvas and when it is painted again).
// Run: node tests/rails-view.test.cjs
const assert = require('node:assert/strict');
const load = require('./esm.cjs');

let passed = 0;
const check = async (name, fn) => { await fn(); passed++; console.log('ok -', name); };

// A 2D context that records every call with the style in force, and keeps what is assigned.
function fakeCtx() {
   const calls = [], style = {};
   const ctx = new Proxy({}, {
      get: (t, k) => k === 'calls' ? calls : k in style ? style[k] : (...args) => {
         calls.push({ op: k, args, font: style.font, fillStyle: style.fillStyle, strokeStyle: style.strokeStyle, textAlign: style.textAlign, dash: style.dash });
         if (k === 'setLineDash') style.dash = args[0];
         return ctx;
      },
      set: (t, k, v) => { style[k] = v; return true; },
   });
   return ctx;
}

// Fake Clay nodes: a tree that remembers what was done to it.
let ops = 0;
class FNode {
   constructor(form) { this.form = form; this.children = []; this.ignore = undefined; this._opacity = null; this._color = null; this.pos = null; this.scl = null; }
   add(form) { ops++; const c = new FNode(form); this.children.push(c); return c; }
   remove(n) { ops++; const i = this.children.indexOf(n); if (i >= 0) this.children.splice(i, 1); return this; }
   identity() { ops++; this.pos = [0, 0, 0]; this.scl = [1, 1, 1]; return this; }
   move(x, y, z) { ops++; this.pos = [x, y, z]; return this; }
   scale(x, y, z) { ops++; this.scl = [x, y, z]; return this; }
   color(c) { ops++; this._color = c; return this; }
   opacity(o) { ops++; this._opacity = o; return this; }
   dull() { return this; }
   setMatrix(m) { ops++; this.matrix = m; return this; }
   placeLimb(a, b, r) { ops++; this.limb = [a, b, r]; return this; }
   setTxtr() { return this; }
}

(async () => {
   const L = await load('js/scenes/rails/layout.js');
   const D = await load('js/scenes/rails/cardDraw.js');
   const V = await load('js/scenes/rails/cardView.js');
   const G = await load('js/scenes/rails/glyphs.js');
   const S = await load('js/scenes/rails/stage.js');
   const F = await load('js/render/core/linefont.js');
   const { GRID, CARD } = L;

   const draw = (state, opts) => { const ctx = fakeCtx(); D.drawCard(ctx, state, opts); return ctx.calls; };
   // The code characters drawn: { row, col, ch } by their place on the grid.
   const codeChars = calls => calls.filter(c => c.op === 'fillText' && c.font === 'bold 29px monospace' && c.args[0].length === 1)
      .map(c => ({ ch: c.args[0], row: Math.floor((c.args[2] - GRID.header) / GRID.line), col: Math.round((c.args[1] - GRID.padX) / GRID.adv) }));
   const rowText = (chars, row) => { const out = []; for (const c of chars.filter(c => c.row === row)) out[c.col] = c.ch; return Array.from(out, x => x || ' ').join(''); };
   const texts = (calls, from = 0, to = 640) => calls.filter(c => c.op === 'fillText' && c.args[2] >= from && c.args[2] < to);
   const numbered = n => Array.from({ length: n }, (_, i) => 'line' + String(i).padStart(2, '0'));

   // ---- drawCard ----

   await check('the visible lines follow scroll: twelve lines, no more', () => {
      const chars = codeChars(draw({ buffer: { lines: numbered(30), scroll: 5, row: 6, col: 0 } }));
      for (let r = 0; r < 12; r++) assert.equal(rowText(chars, r).trimEnd(), 'line' + String(5 + r).padStart(2, '0'));
      assert.ok(chars.every(c => c.row >= 0 && c.row < 12), 'nothing above or below the window');
      const top = codeChars(draw({ buffer: { lines: numbered(30), scroll: 0 } }));
      assert.equal(rowText(top, 0).trimEnd(), 'line00');
      assert.equal(rowText(codeChars(draw({ buffer: { lines: ['a', 'b'], scroll: 99 } })), 0).trimEnd(), 'a', 'a scroll past the end is pulled back');
      assert.equal(codeChars(draw({ buffer: { lines: ['  x'] } })).map(c => c.col).join(), '2', 'a space is not drawn and keeps its column');
   });

   await check('a tab is two spaces; a text-only buffer works', () => {
      const chars = codeChars(draw({ buffer: { lines: ['\tab', 'a\tb'] } }));
      assert.equal(rowText(chars, 0), '  ab');
      assert.equal(rowText(chars, 1), 'a  b');
      assert.equal(D.visualCol('\tab', 1), 2); assert.equal(D.visualCol('a\tb', 2), 3); assert.equal(D.visualCol('ab', 5), 5);
      assert.equal(rowText(codeChars(draw({ buffer: { text: 'x\ny' } })), 1), 'y');
      assert.equal(rowText(codeChars(draw({ buffer: { lines: ['a\u0001b'] } })), 0), 'a·b', 'a control character is a dot');
   });

   await check('a long line is clipped at 32 columns with a mark in the right gutter, never wrapped', () => {
      const calls = draw({ buffer: { lines: ['x'.repeat(100), 'next'] } });
      const chars = codeChars(calls);
      assert.equal(rowText(chars, 0), 'x'.repeat(32));
      assert.equal(rowText(chars, 1), 'next', 'the next line stays on its row');
      const tri = calls.filter(c => c.op === 'moveTo' && c.fillStyle === D.PALETTE.mark);
      assert.equal(tri.length, 1, 'only the long line has a mark');
      assert.ok(tri[0].args[0] >= GRID.padX + 32 * GRID.adv && tri[0].args[0] + 9 <= CARD.px, 'the mark is in the margin, inside the card');
      for (const c of calls.filter(c => c.op === 'fillText')) assert.ok(c.args[1] >= 0 && c.args[1] < CARD.px, 'every text starts inside the card');
      const exact = draw({ buffer: { lines: ['y'.repeat(32)] } });
      assert.equal(exact.filter(c => c.op === 'moveTo' && c.fillStyle === D.PALETTE.mark).length, 0, 'a line of exactly 32 has no mark');
   });

   await check('the footer error is clipped to its width, on two lines, with no newline', () => {
      const long = 'ReferenceError: ' + 'x'.repeat(5000) + '\n    at module:foo:3:1\n';
      const calls = draw({ status: 'quarantined', error: { phase: 'handler', message: long, line: 4, col: 2 } });
      const foot = texts(calls, 544).filter(c => c.fillStyle === D.PALETTE.error);
      assert.equal(foot.length, 2, 'two lines');
      for (const c of foot) {
         assert.ok(c.args[0].length <= 50, `${c.args[0].length} chars`);
         assert.ok(c.args[3] <= 608 + 1e-9, 'maxWidth');
         assert.ok(!/[\n\r]/.test(c.args[0]));
      }
      assert.ok(foot[0].args[0].startsWith('line 4: ReferenceError: '));
      assert.ok(foot[1].args[0].endsWith('…'), 'the cut is marked');
      const short = texts(draw({ error: { phase: 'handler', message: 'boom', line: 4, col: 1 } }), 544).filter(c => c.fillStyle === D.PALETTE.error);
      assert.deepEqual(short.map(c => c.args[0]), ['line 4: boom']);
      const compile = texts(draw({ editError: { phase: 'compile', message: 'Unexpected token', line: null } }), 544);
      assert.ok(compile.some(c => c.args[0] === 'compile: Unexpected token'));
      // The bindings do not push the message to a strip over the code: a message always has the footer's two upper lines, and one row of bindings stays.
      const bound = draw({ buffer: { lines: numbered(12) }, error: { message: 'a'.repeat(300), line: 1 }, bindings: [1, 2, 3].map(i => ({ port: 'p' + i, dir: 'in', variable: 'p' + i, isDefault: true, bound: true, reason: null })) });
      assert.equal(bound.filter(c => c.op === 'fillText' && c.font === '20px monospace' && c.args[2] >= 544).length, 2, 'the two-line footer message');
      assert.ok(!bound.some(c => c.op === 'fillRect' && c.args[1] === 504 && c.args[3] === 40), 'no strip over the last code row');
      // The message lines stay clear of the lowest binding row.
      const rowTop = Math.min(...bound.filter(c => c.op === 'fillText' && c.font === 'bold 18px monospace').map(c => c.args[2])) - 14;
      for (const c of bound.filter(c => c.op === 'fillText' && c.font === '20px monospace' && c.args[2] >= 544)) assert.ok(c.args[2] + 5 < rowTop, 'above the bindings');
   });

   await check('the echo and the command line are clipped to their width', () => {
      const keys = Array.from({ length: 40 }, (_, i) => 'ctrl+k' + i);
      const echo = texts(draw({ focused: true, echo: keys }), 40, 64).filter(c => c.textAlign === 'right' && c.fillStyle === D.PALETTE.dim);
      assert.equal(echo.length, 1);
      assert.ok(echo[0].args[0].length <= 30 && echo[0].args[3] <= 624 - 58 - 24 * 10.2, 'the echo fits its half of the line');
      assert.ok(echo[0].args[0].startsWith('…') && echo[0].args[0].endsWith('ctrl+k39'), 'the newest keys stay');
      assert.equal(texts(draw({ focused: false, echo: keys }), 40, 64).filter(c => c.textAlign === 'right' && c.fillStyle === D.PALETTE.dim).length, 0, 'only the focused card echoes');
      assert.ok(texts(draw({ focused: true, echo: 'a b c' }), 40, 64).some(c => c.args[0] === 'a b c'), 'a string echo as it is');
      const cmd = 'card ' + 'q'.repeat(2000);
      const line = texts(draw({ focused: true, command: cmd, echo: ['a'] }), 40, 64).filter(c => c.args[0].startsWith('…'));
      assert.equal(line.length, 1);
      assert.ok(line[0].args[0].length <= 59 && line[0].args[0].endsWith('_') && line[0].args[3] <= 608, 'the caret end of the command shows');
      const open = texts(draw({ focused: true, command: '', echo: ['a'] }), 40, 64);
      assert.ok(open.some(c => c.args[0] === '> _'), 'an empty command line');
      assert.ok(!open.some(c => c.args[0] === 'a'), 'the command line replaces the echo');
      const note = texts(draw({ notice: 'unknown command ' + 'z'.repeat(1000) }), 544).filter(c => c.fillStyle === D.PALETTE.mark);
      assert.ok(note.length >= 1 && note.every(c => c.args[0].length <= 50 && c.args[3] <= 608), 'a notice is clipped like the error');
      const name = texts(draw({ name: 'n'.repeat(500) }), 0, 40).filter(c => c.font === 'bold 26px monospace');
      assert.ok(name[0].args[0].length <= 25 && name[0].args[3] <= 400, 'the name is clipped, leaving room for ln');
   });

   await check('the message line: error, then notice, then pending', () => {
      const msg = s => texts(draw(s), 544).filter(c => c.font === '20px monospace').map(c => c.args[0]).join('|');
      assert.equal(msg({ error: { message: 'e', line: 1 }, notice: 'n', pending: true }), 'line 1: e');
      assert.equal(msg({ notice: 'n', pending: true }), 'n');
      assert.equal(msg({ pending: true }), 'running…');
      assert.equal(msg({ pending: 'docking…' }), 'docking…');
      assert.equal(msg({}), '');
   });

   await check('status colours: dot, header, words', () => {
      const dot = s => draw(s).find(c => c.op === 'fill' && c.fillStyle !== undefined && c.args.length === 0).fillStyle;
      const header = s => draw(s).find(c => c.op === 'fillRect' && c.args[3] === GRID.header).fillStyle;
      const words = s => texts(draw(s), 40, 64).find(c => c.args[2] === 54).args[0];
      const P = D.PALETTE;
      assert.equal(D.statusOf({ status: 'ok' }), 'running');
      assert.equal(D.statusOf({ status: 'ok', buffer: { dirty: true } }), 'edited');
      assert.equal(D.statusOf({ status: 'ok', error: { message: 'x' } }), 'error');
      assert.equal(D.statusOf({ editError: { message: 'x' } }), 'error');
      assert.equal(D.statusOf({ status: 'quarantined', error: { message: 'x' } }), 'quarantined');
      assert.equal(D.statusOf({ status: 'ghost', error: { message: 'x' } }), 'error', 'there is no ghost status: the error shows');
      assert.equal(dot({}), P.running); assert.equal(dot({ buffer: { dirty: true } }), P.edited);
      assert.equal(dot({ error: { message: 'x' } }), P.error); assert.ok(!('ghost' in P) && !('ghost' in P.header) && !('ghost' in P.tint));
      assert.equal(dot({ status: 'quarantined' }), P.quarantined);
      assert.equal(header({ error: { message: 'x' } }), P.header.error);
      assert.equal(header({}), P.header.running);
      assert.equal(words({ ver: 3 }), 'running v3');
      assert.equal(words({ ver: 3, buffer: { dirty: true } }), 'edited, v3 runs');
      assert.equal(words({ ver: 3, editError: { message: 'x', line: 2 } }), 'error, kept v3');
      assert.equal(words({ ver: 3, focused: true }), 'running v3 · typing');
      assert.ok(!draw({ buffer: { lines: numbered(18), row: 4, scroll: 0 } }).some(c => c.op === 'fillText' && String(c.args[0]).startsWith('ln')), 'ln r/n is not on the canvas');
      const tinted = draw({ error: { message: 'x' } }).filter(c => c.op === 'fillRect' && c.fillStyle === P.tint.error);
      assert.equal(tinted.length, 1, 'the body is tinted red');
   });

   await check('the arrow in the gutter marks the error line when it is on the card', () => {
      const arrows = (s) => draw(s).filter(c => c.op === 'moveTo' && c.args[0] === 4).map(c => c.args[1]);
      const mid = r => GRID.header + r * GRID.line + GRID.line / 2 - 9;
      assert.deepEqual(arrows({ buffer: { lines: numbered(30), scroll: 5 }, error: { message: 'x', line: 8 } }), [mid(2)]);
      assert.deepEqual(arrows({ buffer: { lines: numbered(30), scroll: 5 }, error: { message: 'x', line: 2 } }), []);
      assert.deepEqual(arrows({ buffer: { lines: numbered(30) }, error: { message: 'x', line: null } }), []);
   });

   await check('drawCard never throws on odd states', () => {
      for (const s of [undefined, null, {}, { buffer: null }, { buffer: { lines: [] } }, { buffer: { lines: [''] }, name: undefined }, { bindings: 'x' }, { bindings: [null] }, { bindings: [{}] }, { queued: 'x' }, { zoom: 'x', scrollX: 'y' }, { error: {} }, { error: { message: undefined, line: 'x' } }, { buffer: { lines: numbered(5), scroll: -4, row: 99 } },
         { echo: 5, focused: true }, { command: 7 }, { name: 12345, ver: 'v' }])
         assert.doesNotThrow(() => draw(s), JSON.stringify(s));
   });

   const segs = ch => G.segmentCount(G.textPaths(ch));
   const fontSegs = s => [...s].reduce((n, ch) => n + (F.linefont[ch.charCodeAt(0) - 32]?.paths ?? []).reduce((m, p) => m + Math.max(0, p.length - 1), 0), 0);

   const withClay = fn => {
      const meshes = {}, defs = [], widths = [], solids = {}, saved = globalThis.clay;
      // (`solids` are the triangle meshes of bus3d, kept out of `meshes`, which is the text's; both live in formMesh()).
      globalThis.clay = { definePathsMesh: (name, w, paths) => { defs.push(name); widths.push(w); meshes[name] = paths; }, formMesh: () => meshes,
         vertexArray: (p, n) => [...p, ...(n || [1, 0, 0])],
         defineMesh: (name, m) => { solids[name] = m; Object.defineProperty(meshes, name, { value: m, enumerable: false, configurable: true }); } };
      try { return fn({ meshes, defs, widths, solids }); } finally { globalThis.clay = saved; }
   };

   // ---- the card's nodes and when it repaints ----

   const makeView = () => {
      const node = new FNode(), face = node.add('square'), ctx = fakeCtx();
      let uploads = 0;
      const view = V.createCardView(node, { ctx, face, onDraw: () => uploads++, now: () => 0 });
      return { node, face, ctx, view, uploads: () => uploads, paints: () => ctx.calls.filter(c => c.op === 'clearRect').length };
   };
   const lines20 = { lines: numbered(20), row: 0, col: 0, scroll: 0 };

   await check('update with an unchanged state does not repaint; a change does, once', () => {
      const t = makeView();
      assert.equal(t.paints(), 1, 'the blank card is painted at creation');
      assert.equal(t.view.draws, 0);
      const state = { name: 'osc', ver: 1, buffer: { ...lines20 }, status: 'ok', ports: [], focused: false };
      t.view.update(state); assert.equal(t.view.draws, 1); assert.equal(t.uploads(), 2, 'the texture is asked for once more');
      for (let i = 0; i < 5; i++) t.view.update({ ...state, buffer: { ...lines20 } });
      assert.equal(t.view.draws, 1, 'the same content, even in new objects');
      t.view.update({ ...state, buffer: { ...lines20, lines: numbered(20).map((l, i) => i === 3 ? 'changed' : l) } });
      assert.equal(t.view.draws, 2, 'a visible line changed');
      t.view.update({ ...state, buffer: { ...lines20, lines: numbered(20).map((l, i) => i === 15 ? 'changed' : l) } });
      assert.equal(t.view.draws, 3, 'back to the old text');
      t.view.update({ ...state, buffer: { ...lines20, lines: numbered(20).map((l, i) => i === 15 ? 'other' : l) } });
      assert.equal(t.view.draws, 3, 'a line below the window is not on the card');
      t.view.update({ ...state, buffer: { ...lines20, scroll: 4 } }); assert.equal(t.view.draws, 4, 'scroll');
      t.view.update({ ...state, buffer: { ...lines20, scroll: 4 }, status: 'quarantined', error: { message: 'x', line: 6 } }); assert.equal(t.view.draws, 5, 'status');
      t.view.update({ ...state, buffer: { ...lines20, scroll: 4 }, status: 'quarantined', error: { message: 'x', line: 6 }, focused: true }); assert.equal(t.view.draws, 6, 'focus (the header says typing)');
      const s2 = { ...state, buffer: { ...lines20, scroll: 4 }, status: 'quarantined', error: { message: 'x', line: 6 }, focused: true };
      const bnd = [{ port: 'a', dir: 'in', variable: 'a', isDefault: true, bound: true, reason: null }];
      t.view.update({ ...s2, bindings: bnd }); assert.equal(t.view.draws, 7, 'bindings');
      t.view.update({ ...s2, bindings: bnd, echo: ['a'] }); assert.equal(t.view.draws, 8, 'echo');
      t.view.update({ ...s2, bindings: bnd, echo: ['a'], command: 'x' }); assert.equal(t.view.draws, 9, 'command');
   });

   await check('cursor, charge and blink are quads: no repaint', () => {
      const t = makeView();
      const base = { name: 'osc', buffer: { ...lines20, row: 2, col: 3 }, focused: true, time: 0 };
      t.view.update(base);
      const n = t.view.draws;
      const cursor = t.node.children[2], bar = t.node.children[1];
      assert.equal(cursor.ignore, false, 'a focused card shows its cursor');
      const c = L.cell(3, 2);
      assert.ok(Math.abs(cursor.pos[0] - (c.x - GRID.adv / 2 / GRID.ppm + 0.00125)) < 1e-12 && Math.abs(cursor.pos[1] - c.y) < 1e-12, 'at the cell\'s left edge');
      t.view.update({ ...base, buffer: { ...lines20, row: 2, col: 9 } });
      assert.ok(Math.abs(cursor.pos[0] - (L.cell(9, 2).x - GRID.adv / 2 / GRID.ppm + 0.00125)) < 1e-12);
      t.view.update({ ...base, time: 0.6 }); assert.equal(cursor.ignore, true, 'blinks off');
      t.view.update({ ...base, time: 1.1 }); assert.equal(cursor.ignore, false, 'and on');
      t.view.update({ ...base, focused: false, time: 0 }); assert.equal(cursor.ignore, true, 'no cursor in an unfocused card');
      assert.equal(t.view.draws, n + 1, 'only the focus change (the header word) painted');
      const idle = { ...base, focused: false };
      t.view.update(idle);
      const m = t.view.draws;
      t.view.update({ ...idle, charging: { p: 0.5 } });
      t.view.update({ ...idle, charging: { p: 1 } });
      t.view.update({ ...idle, hovered: true });
      assert.equal(t.view.draws, m, 'charge ring and hover are not painted');
      const ring = t.node.children.slice(7, 11);
      assert.equal(ring.length, 4);
      t.view.update({ ...idle, charging: { p: 0.5 } });
      assert.deepEqual(ring.map(q => q.ignore), [false, false, true, true], 'half way round: two sides');
      t.view.update({ ...idle, charging: { p: 1 } });
      assert.ok(ring.every(q => q.ignore === false));
      t.view.update({ ...idle, charging: null });
      assert.ok(ring.every(q => q.ignore === true));
      // The cursor of a line with a tab is at the visual column, and past column 32 it stays at the margin.
      t.view.update({ buffer: { lines: ['\tab'], row: 0, col: 2 }, focused: true, time: 0 });
      assert.ok(Math.abs(cursor.pos[0] - (L.cell(3, 0).x - GRID.adv / 2 / GRID.ppm + 0.00125)) < 1e-12, 'after a tab and an a');
      t.view.update({ buffer: { lines: ['x'.repeat(80)], row: 0, col: 70 }, focused: true, time: 0 });
      assert.equal(cursor.ignore, true, 'a cursor past the window is not drawn (the window follows it: scrollX)');
      // The error bar sits on the failing line when it is in the window.
      t.view.update({ buffer: { lines: numbered(30), scroll: 5 }, error: { message: 'x', line: 8 } });
      assert.equal(bar.ignore, false); assert.ok(Math.abs(bar.pos[1] - L.cell(0, 2).y) < 1e-12);
      t.view.update({ buffer: { lines: numbered(30), scroll: 5 }, error: { message: 'x', line: 2 } });
      assert.equal(bar.ignore, true, 'out of the window: no bar');
      t.view.update({ buffer: { lines: numbered(30), scroll: 5 } }); assert.equal(bar.ignore, true);
   });

   await check('brightness and frame follow focus; dispose removes the nodes', () => {
      const t = makeView();
      const frame = t.node.children.slice(3, 7);
      t.view.update({ buffer: lines20 });
      assert.ok(Math.abs(t.face._color[0] - 0.85 / 2) < 1e-9, 'idle 85 %'); assert.ok(frame.every(q => q.ignore === true));
      t.view.update({ buffer: lines20, focused: true });
      assert.ok(Math.abs(t.face._color[0] - 0.5) < 1e-9, 'focused full'); assert.ok(frame.every(q => q.ignore === false));
      assert.ok(Math.abs(frame[0].scl[1] - 0.003) < 1e-12, '6 mm frame');
      t.view.update({ buffer: lines20, hovered: true });
      assert.ok(Math.abs(frame[0].scl[1] - 0.001) < 1e-12, '2 mm frame');
      t.view.dispose();
      assert.equal(t.node.children.length, 0);
   });

   await check('moving the cursor between lines repaints nothing; ln r/n is line-font text that follows it', () => withClay(({ meshes }) => {
      const t = makeView();
      const base = { name: 'osc', buffer: { ...lines20, row: 0, col: 0 }, focused: true, time: 0 };
      t.view.update(base);
      const n = t.view.draws, text = () => Object.values(meshes).map(G.segmentCount);
      assert.equal(text().length, 1, 'one text mesh on the card');
      assert.equal(text()[0], fontSegs('ln 1/20'));
      for (const row of [1, 5, 11, 12, 19, 3]) t.view.update({ ...base, buffer: { ...lines20, row, scroll: Math.max(0, row - 11) } });
      t.view.update({ ...base, buffer: { ...lines20, row: 3, scroll: 0 } });
      assert.equal(t.view.draws, n + 3, 'only the scroll changes (12, 19 and back to 0) painted, never a bare row change');
      for (const row of [0, 2, 4, 6, 8, 10]) t.view.update({ ...base, buffer: { ...lines20, row, scroll: 0 } });
      assert.equal(t.view.draws, n + 3, 'rows within one scroll: no repaint');
      assert.equal(text()[0], fontSegs('ln 11/20'));
      t.view.dispose();
      assert.equal(Object.keys(meshes).length, 0, 'dispose frees the text mesh');
   }));

   await check('an error card keeps a red frame when not focused', () => {
      const t = makeView();
      const frame = t.node.children.slice(3, 7);
      t.view.update({ buffer: lines20, error: { message: 'x', line: 1 }, status: 'ok' });
      assert.ok(frame.every(q => q.ignore === false), 'an error card is framed while idle');
      assert.ok(Math.abs(frame[0].scl[1] - 0.002) < 1e-12, '4 mm');
      assert.deepEqual(frame[0]._color, G.unlit(G.parseColour('#d64545')));
      t.view.update({ buffer: lines20, status: 'quarantined', error: { message: 'x' } });
      assert.ok(frame.every(q => q.ignore === false), 'and a quarantined one');
      t.view.update({ buffer: lines20, error: { message: 'x' }, focused: true });
      assert.ok(Math.abs(frame[0].scl[1] - 0.003) < 1e-12 && frame[0]._color[0] === G.unlit(G.parseColour('#d64545'))[0], 'focused: 6 mm, still red');
      t.view.update({ buffer: lines20 });
      assert.ok(frame.every(q => q.ignore === true), 'a healthy idle card has none');
   });

   await check('a card that publishes or takes the selected variable gets a bright 5 mm outer frame of its own, outside whatever frame it has (focus, hover, error); not a repaint', () => {
      const t = makeView();
      const frame = t.node.children.slice(3, 7), mark = t.node.children.slice(12, 16), s = { buffer: lines20, time: 0 };
      const MARKC = G.unlit(G.parseColour(V.MARK));
      t.view.update(s, false);
      assert.ok(mark.every(q => q.ignore === true) && frame.every(q => q.ignore === true));
      const paints = t.view.draws;
      t.view.update(s, true);
      assert.ok(mark.every(q => q.ignore === false), 'marked: framed');
      assert.ok(Math.abs(mark[0].scl[1] - 0.0025) < 1e-12, '5 mm'); assert.deepEqual(mark[0]._color, MARKC);
      assert.ok(frame.every(q => q.ignore === true), 'a card with no frame of its own: only the mark');
      assert.ok(Math.abs(mark[0].pos[1] - (0.25 + 0.0025)) < 1e-12, 'against the card edge');
      assert.equal(t.view.draws, paints, 'no repaint of the canvas');
      t.view.update({ ...s, hovered: true }, true);
      assert.ok(frame.every(q => q.ignore === false) && Math.abs(frame[0].scl[1] - 0.001) < 1e-12, 'a hovered card keeps its 2 mm cue');
      assert.ok(Math.abs(mark[0].pos[1] - (0.25 + 0.002 + 0.0025)) < 1e-12, 'and the mark is outside it');
      t.view.update({ ...s, focused: true }, true);
      assert.ok(Math.abs(frame[0].scl[1] - 0.003) < 1e-12 && frame[0]._color[0] !== MARKC[0], 'focused: its own 6 mm frame');
      assert.ok(mark.every(q => q.ignore === false) && Math.abs(mark[0].pos[1] - (0.25 + 0.006 + 0.0025)) < 1e-12, 'and the mark outside that');
      t.view.update({ ...s, error: { message: 'x', line: 1 } }, true);
      assert.deepEqual(frame[0]._color, G.unlit(G.parseColour('#d64545')), 'an error card keeps its red frame');
      assert.ok(Math.abs(mark[0].pos[1] - (0.25 + 0.004 + 0.0025)) < 1e-12 && mark[0]._color[0] === MARKC[0]);
      t.view.update(s);
      assert.ok(mark.every(q => q.ignore === true), 'no mark argument: no mark');
      t.view.dispose();
      assert.equal(t.node.children.length, 0);
   });

   // ---- v2 cards: zoom, sideways scroll, bindings, unplugged, bold code ----

   const ZM = L.ZOOMS;
   // The code characters of a card at a zoom: { row, col, ch } from the grid of that zoom (the font is bold).
   const zChars = (calls, z) => calls.filter(c => c.op === 'fillText' && c.font === `bold ${z.font}px monospace` && c.args[0].length === 1)
      .map(c => ({ ch: c.args[0], y: c.args[2], row: Math.round((c.args[2] - z.font - GRID.header) / z.line), col: Math.round((c.args[1] - GRID.padX) / z.adv), x: c.args[1] }));
   const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
   const BOLD_FONT = z => `bold ${z.font}px monospace`;
   // The triangles drawn in the code area's gutters: { x0, x1, cy, side }.
   const gutterMarks = (calls, z) => {
      const right = GRID.padX + z.cols * z.adv, out = [];
      calls.forEach((c, i) => {
         if (c.op !== 'moveTo' || c.fillStyle !== D.PALETTE.mark) return;
         const pts = [c.args, calls[i + 1].args, calls[i + 2].args], xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
         out.push({ x0: Math.min(...xs), x1: Math.max(...xs), cy: (Math.min(...ys) + Math.max(...ys)) / 2, side: Math.max(...xs) <= GRID.padX ? 'left' : Math.min(...xs) >= right ? 'right' : 'inside' });
      });
      return out;
   };

   await check('the code is bold and follows the card\'s zoom: font, advance, line height, columns, rows', () => {
      assert.equal(ZM.length, 3);
      for (const [zoom, z] of ZM.entries()) {
         const calls = draw({ zoom, buffer: { lines: Array.from({ length: 30 }, () => alphabet.repeat(2)), rows: z.rows } });
         const chars = zChars(calls, z);
         assert.ok(chars.length > 0 && chars.every(c => c.row >= 0 && c.row < z.rows), `zoom ${zoom}: rows`);
         assert.equal(Math.max(...chars.map(c => c.row)) + 1, z.rows, `zoom ${zoom}: the rows that fit`);
         assert.equal(Math.max(...chars.map(c => c.col)) + 1, z.cols, `zoom ${zoom}: the columns that fit`);
         for (const c of chars) {
            assert.ok(Math.abs(c.x - (GRID.padX + c.col * z.adv)) < 1e-9, 'on the zoom\'s advance');
            assert.equal(c.y, GRID.header + c.row * z.line + z.font, 'baseline in its line');
            assert.equal(c.ch, alphabet[c.col], 'the characters of the line');
         }
         assert.ok(calls.filter(c => c.op === 'fillText' && /^\d+px monospace$/.test(c.font) && c.args[0].length === 1 && c.args[2] < 544).length === 0, 'no thin code font');
      }
      assert.ok(Math.abs(GRID.padX + 26 * ZM[0].adv + 36.8 - 640) < 1e-9);
      // No zoom is the default one (index 1: today's grid), and a junk zoom is clamped.
      assert.equal(zChars(draw({ buffer: { lines: ['x'.repeat(50)] } }), ZM[1]).length, 32);
      assert.equal(zChars(draw({ zoom: 7, buffer: { lines: ['x'.repeat(50)] } }), ZM[2]).length, 40);
      assert.equal(zChars(draw({ zoom: -3, buffer: { lines: ['x'.repeat(50)] } }), ZM[0]).length, 26);
      // The scroll bar is as long as the card's own window.
      const bar = draw({ zoom: 2, buffer: { lines: numbered(30), rows: 15 } }).find(c => c.op === 'fillRect' && c.args[0] === 636);
      assert.ok(Math.abs(bar.args[3] - 480 * 15 / 30) < 1e-9);
   });

   await check('scrollX: the window starts at that column; marks show hidden text on either side, in the real gutter', () => {
      for (const [zoom, z] of ZM.entries()) {
         const long = alphabet.repeat(2), right = GRID.padX + z.cols * z.adv;
         const calls = draw({ zoom, scrollX: 10, buffer: { lines: [long, 'hi', '', '          indented'], rows: z.rows, scrollX: 10 } });
         const chars = zChars(calls, z), row0 = chars.filter(c => c.row === 0).sort((a, b) => a.col - b.col);
         assert.equal(row0.map(c => c.ch).join(''), long.slice(10, 10 + z.cols), `zoom ${zoom}: first column shown is the 11th`);
         assert.equal(chars.filter(c => c.row === 1).length, 0, '`hi` is all to the left: nothing drawn');
         const marks = gutterMarks(calls, z);
         const at = row => marks.filter(m => Math.abs(m.cy - (GRID.header + row * z.line + z.line / 2)) < 1);
         assert.deepEqual(at(0).map(m => m.side).sort(), ['left', 'right'], 'row 0: hidden on both sides');
         assert.deepEqual(at(1).map(m => m.side), ['left'], 'row 1: its text is hidden on the left only');
         assert.deepEqual(at(2).map(m => m.side), [], 'an empty line has no mark');
         assert.deepEqual(at(3).map(m => m.side), [], 'spaces and `indented` all in view: no mark');
         for (const m of marks) {
            assert.notEqual(m.side, 'inside', 'in a gutter');
            if (m.side === 'left') assert.ok(m.x0 >= 0 && m.x1 <= GRID.padX);
            else assert.ok(m.x0 >= right && m.x1 <= 636, `zoom ${zoom}: the right mark is in the right gutter (${m.x0}..${m.x1}, from ${right})`);
         }
      }
      // No scroll: no left marks; a line longer than the window gets a right mark only; the old `›` is gone.
      const z = ZM[1], calls = draw({ buffer: { lines: ['x'.repeat(100), 'next'] } });
      assert.deepEqual(gutterMarks(calls, z).map(m => m.side), ['right']);
      assert.equal(calls.filter(c => c.args[0] === '›').length, 0);
      assert.deepEqual(gutterMarks(draw({ buffer: { lines: ['y'.repeat(32)] } }), z), [], 'a line of exactly 32: nothing hidden');
      assert.deepEqual(gutterMarks(draw({ scrollX: 3, buffer: { lines: ['abc   ', 'abcdef'] , scrollX: 3 } }), z).map(m => m.side), ['left', 'left'], 'text hidden left');
      assert.deepEqual(gutterMarks(draw({ buffer: { lines: ['z'.repeat(32) + '   '] } }), z), [], 'only spaces hidden on the right: no mark');
      // A tab counts two columns when the window starts.
      assert.equal(zChars(draw({ buffer: { lines: ['\tabcd'], scrollX: 2 } }), z).map(c => c.ch).join(''), 'abcd');
      // The error arrow and the left mark share the gutter without overlapping.
      const both = draw({ scrollX: 5, buffer: { lines: ['x'.repeat(40)], scrollX: 5 }, error: { message: 'e', line: 1 } });
      const arrow = both.filter(c => c.op === 'moveTo' && c.fillStyle === D.PALETTE.error).map(c => c.args[0]);
      assert.equal(arrow.length, 1);
      const left = gutterMarks(both, z).find(m => m.side === 'left');
      const arrowPts = both.filter(c => (c.op === 'moveTo' || c.op === 'lineTo') && c.fillStyle === D.PALETTE.error).map(c => c.args[0]);
      assert.ok(Math.max(...arrowPts) < left.x0, 'the error arrow ends before the mark begins');
   });

   const BIN_FONT = 'bold 18px monospace';
   const binding = (port, dir, variable, o = {}) => ({ port, dir, variable, isDefault: variable === port, bound: true, reason: null, ...o });
   const footer = calls => calls.filter(c => c.op === 'fillText' && c.args[2] >= 544 && c.font === BIN_FONT);
   const P = D.PALETTE;

   await check('the footer shows bindings: inputs on the left, outputs on the right, the used ones highlighted', () => {
      const bindings = [binding('target', 'in', 'target'), binding('pos', 'in', 'gaze_hit', { isDefault: false }), binding('hit', 'out', 'hit')];
      const f = footer(draw({ bindings }));
      assert.deepEqual(f.map(c => c.args[0]), ['pos ← gaze_hit', 'target ← target', '→ hit'], 'the used one first');
      assert.deepEqual(f.map(c => c.fillStyle), [P.use, P.dim, P.dim], 'default dim, a used variable highlighted');
      assert.ok(f[0].args[1] < 320 && f[1].args[1] < 320 && f[2].args[1] > 320, 'inputs left, outputs right');
      assert.ok(f[0].args[2] < f[1].args[2], 'one row below the other');
      assert.ok(f.every(c => c.args[2] >= 544 && c.args[2] <= 640 && c.args[3] <= 320 - 16), 'inside the footer, each in its half');
      assert.equal(f[0].textAlign, 'left');
      // waiting, incompatible, unplugged, not published
      const odd = footer(draw({ bindings: [
         binding('pos', 'in', 'pos', { bound: false, reason: "waiting: no variable 'pos' yet" }),
         binding('x', 'in', 'x', { bound: false, reason: 'incompatible: x is event num, y is state any' }),
         binding('hit', 'out', 'hit', { bound: false, reason: 'not published' }),
      ] }));
      assert.deepEqual(odd.map(c => c.args[0]), ['x ✗ incompatible', 'pos ← (waiting)', '→ hit ✗']);
      assert.deepEqual(odd.map(c => c.fillStyle), [P.error, P.mark, P.error]);
      const w2 = footer(draw({ bindings: [binding('t', 'in', 'gaze_hit', { isDefault: false, bound: false, reason: "waiting: no variable 'gaze_hit' yet" })] }));
      assert.equal(w2[0].args[0], 't ← gaze_hit (waiting)');
      const unp = footer(draw({ unplugged: true, bindings: [binding('t', 'in', 't', { bound: false, reason: 'unplugged' }), binding('o', 'out', 'o', { bound: false, reason: 'unplugged' })] }));
      assert.deepEqual(unp.map(c => c.args[0]), ['t ← t', '→ o'], 'an unplugged card shows its bindings, dim');
      assert.ok(unp.every(c => c.fillStyle === P.dim));
      assert.equal(footer(draw({})).length, 0); assert.equal(footer(draw({ bindings: [] })).length, 0);
      assert.doesNotThrow(() => draw({ bindings: [null, {}, { port: 3 }, 'x'] }));
   });

   await check('bindings: two rows a side, `+N` for more, long names cut to the half; a message takes the upper row', () => {
      const many = n => Array.from({ length: n }, (_, i) => binding('in' + i, 'in', 'in' + i));
      const outs = Array.from({ length: 4 }, (_, i) => binding('o' + i, 'out', 'o' + i));
      const f = footer(draw({ bindings: [...many(5), ...outs] }));
      const left = f.filter(c => c.args[1] < 320), rightSide = f.filter(c => c.args[1] > 320);
      assert.equal(left.length, 2); assert.equal(rightSide.length, 2);
      assert.deepEqual(left.map(c => c.args[0]), ['in0 ← in0', 'in1 ← in1 +3'], 'the third to fifth are hidden: +3');
      assert.deepEqual(rightSide.map(c => c.args[0]), ['→ o0', '→ o1 +2']);
      assert.equal(footer(draw({ bindings: many(2) })).length, 2, 'exactly two: no +N');
      const longName = footer(draw({ bindings: [binding('p', 'in', 'v'.repeat(80), { isDefault: false })] }))[0];
      assert.ok(longName.args[0].length <= 27 && longName.args[0].endsWith('…') && longName.args[3] <= 304 + 1e-9);
      // A one-line message goes above two rows of bindings; a message of two lines leaves one row.
      const one = footer(draw({ notice: 'hello', bindings: [...many(3), outs[0]] }));
      assert.deepEqual(one.map(c => c.args[0]), ['in0 ← in0', 'in1 ← in1 +1', '→ o0'], 'a short message keeps both rows');
      const msg1 = texts(draw({ notice: 'hello', bindings: many(1) }), 544).filter(c => c.font === '20px monospace');
      assert.equal(msg1.length, 1);
      assert.ok(msg1[0].args[2] + 5 < one[0].args[2] - 12, 'message above the first binding');
      assert.ok(one.every(c => c.args[2] <= 640 - 8), 'inside the card');
      const long = 'n'.repeat(80);
      const withMsg = footer(draw({ notice: long, bindings: [...many(3), outs[0]] }));
      assert.deepEqual(withMsg.map(c => c.args[0]), ['in0 ← in0 +2', '→ o0']);
      assert.ok(withMsg.every(c => c.args[2] > 600), 'on the lower row, under the two message lines');
      const lines2 = texts(draw({ notice: long, bindings: many(1) }), 544).filter(c => c.font === '20px monospace');
      assert.equal(lines2.length, 2);
      assert.ok(lines2[1].args[2] + 5 < withMsg[0].args[2] - 12, 'second message line above the binding');
   });

   await check('bindings: problems come first, so `+N` never hides one', () => {
      const bad = binding('x', 'in', 'x', { bound: false, reason: 'incompatible: x is event num, y is state any' });
      const wait = binding('w', 'in', 'w', { bound: false, reason: "waiting: no variable 'w' yet" });
      const used = binding('u', 'in', 'gaze_hit', { isDefault: false });
      const dflt = binding('d', 'in', 'd');
      const f = footer(draw({ bindings: [dflt, used, wait, bad] }));
      assert.deepEqual(f.map(c => c.args[0]), ['x ✗ incompatible', 'w ← (waiting) +2'], 'incompatible, then waiting; the used and default ones are the +2');
      const g = footer(draw({ bindings: [dflt, used, dflt, binding('v', 'in', 'v2', { isDefault: false })] }));
      assert.deepEqual(g.map(c => c.args[0]), ['u ← gaze_hit', 'v ← v2 +2'], 'the used ones before the defaults');
      const o = footer(draw({ bindings: [binding('a', 'out', 'a'), binding('b', 'out', 'b', { bound: false, reason: 'not published' }), binding('c', 'out', 'c')] }));
      assert.deepEqual(o.map(c => c.args[0]), ['→ b ✗', '→ a +1'], 'a problem output first');
   });

   await check('the header says unplugged; queued changes are the footer message ("applies when you resume")', () => {
      const words = s => texts(draw(s), 40, 64).filter(c => c.args[2] === 54).map(c => c.args[0]);
      assert.deepEqual(words({ ver: 2 }), ['running v2']);
      const unp = texts(draw({ ver: 2, unplugged: true }), 40, 64).filter(c => c.args[2] === 54);
      assert.equal(unp[0].args[0], 'unplugged'); assert.equal(unp[0].fillStyle, P.mark);
      assert.ok(unp.some(c => c.args[0].startsWith('running v2')), 'the status stays beside it');
      assert.ok(unp.every(c => c.args[3] > 0));
      const q = [{ what: 'use target pointer_pos', note: 'applies when you resume' }];
      const msg = s => texts(draw(s), 544).filter(c => c.font === '20px monospace').map(c => c.args[0]).join('|');
      assert.equal(msg({ queued: q }), 'use target pointer_pos: applies when you resume');
      assert.equal(msg({ queued: [...q, { what: 'plug off', note: 'applies when you resume' }] }), 'use target pointer_pos: applies when you resume +1');
      assert.equal(msg({ queued: q, notice: 'n' }), 'n', 'a notice comes first');
      assert.equal(msg({ queued: q, error: { message: 'e', line: 1 } }), 'line 1: e');
      assert.equal(msg({ queued: [] }), ''); assert.equal(msg({ queued: [null, {}] }), '');
   });

   await check('the canvas key has zoom, scrollX, bindings, unplugged and queued; the cursor still has none', () => {
      const t = makeView();
      const base = { name: 'osc', ver: 1, buffer: { lines: [alphabet.repeat(2), ...numbered(5)], row: 0, col: 20, scroll: 0, scrollX: 0, rows: 12 }, focused: true, time: 0,
         zoom: 1, scrollX: 0, bindings: [binding('target', 'in', 'target')], unplugged: false, queued: [] };
      t.view.update(base);
      assert.equal(t.view.draws, 1);
      const n = (s, why, k) => { t.view.update(s); assert.equal(t.view.draws, k, why); };
      for (let c = 21; c < 28; c++) n({ ...base, buffer: { ...base.buffer, col: c } }, 'a cursor move inside the window', 1);
      n({ ...base, zoom: 2, buffer: { ...base.buffer, rows: 15 } }, 'zoom', 2);
      n({ ...base, zoom: 2, buffer: { ...base.buffer, rows: 15 } }, 'same again', 2);
      n({ ...base, zoom: 2, scrollX: 7, buffer: { ...base.buffer, rows: 15, scrollX: 7 } }, 'scrollX', 3);
      n({ ...base, zoom: 2, scrollX: 7, buffer: { ...base.buffer, rows: 15, scrollX: 7, col: 30 } }, 'a cursor move with the same scrollX', 3);
      n({ ...base, zoom: 2, scrollX: 7, buffer: { ...base.buffer, rows: 15, scrollX: 7 }, unplugged: true }, 'unplugged', 4);
      const b2 = { ...base, zoom: 2, scrollX: 7, buffer: { ...base.buffer, rows: 15, scrollX: 7 }, unplugged: true };
      n({ ...b2, bindings: [binding('target', 'in', 'gaze_hit', { isDefault: false })] }, 'bindings', 5);
      n({ ...b2, bindings: [binding('target', 'in', 'gaze_hit', { isDefault: false })] }, 'same bindings, new objects', 5);
      const b3 = { ...b2, bindings: [binding('target', 'in', 'gaze_hit', { isDefault: false })], queued: [{ what: 'plug on', note: 'applies when you resume' }] };
      n(b3, 'queued', 6);
      n({ ...b3, hovered: true }, 'hover is a quad', 6);
   });

   await check('the cursor quad, the error bar and ln r/n follow zoom and scrollX', () => withClay(() => {
      const t = makeView(), cursor = t.node.children[2], bar = t.node.children[1], lnNode = t.node.children[11];
      const st = (zoom, scrollX, extra = {}) => ({ name: 'osc', zoom, scrollX, buffer: { lines: [alphabet.repeat(2), ...numbered(20)], row: 3, col: 12, scroll: 0, scrollX, rows: ZM[zoom].rows }, focused: true, time: 0, ...extra });
      const cx = (z, sx, col, row) => { const c = L.cellAt(z, col - sx, row); return c.x - z.adv / 2 / GRID.ppm + 0.00125; };
      for (const zoom of [0, 1, 2]) for (const sx of [0, 5]) {
         const z = ZM[zoom];
         t.view.update(st(zoom, sx));
         assert.equal(cursor.ignore, false);
         assert.ok(Math.abs(cursor.pos[0] - cx(z, sx, 12, 3)) < 1e-12, `zoom ${zoom} scrollX ${sx}: x`);
         assert.ok(Math.abs(cursor.pos[1] - L.cellAt(z, 0, 3).y) < 1e-12, 'y by the zoom\'s line');
         assert.ok(Math.abs(cursor.scl[1] - z.line / GRID.ppm / 2) < 1e-12, 'one line high');
      }
      // The window moved away from the cursor (a wheel scroll): the cursor is not drawn; at the very edge it is.
      t.view.update(st(1, 20)); assert.equal(cursor.ignore, true, 'column 12 is left of a window that starts at 20');
      t.view.update(st(1, 12)); assert.equal(cursor.ignore, false, 'at the first column');
      t.view.update(st(1, 0, { buffer: { lines: ['x'.repeat(80)], row: 0, col: 40, scroll: 0, scrollX: 0, rows: 12 } })); assert.equal(cursor.ignore, true, 'right of the window');
      t.view.update(st(1, 0, { buffer: { lines: ['x'.repeat(80)], row: 0, col: 32, scroll: 0, scrollX: 0, rows: 12 } })); assert.equal(cursor.ignore, false, 'just past the last column');
      // The bar of the error line.
      for (const zoom of [0, 2]) {
         const z = ZM[zoom];
         t.view.update(st(zoom, 3, { error: { message: 'x', line: 4 } }));
         assert.equal(bar.ignore, false);
         assert.ok(Math.abs(bar.pos[1] - L.cellAt(z, 0, 3).y) < 1e-12 && Math.abs(bar.scl[1] - z.line / GRID.ppm / 2) < 1e-12);
         t.view.update(st(zoom, 3, { error: { message: 'x', line: z.rows + 1 } })); assert.equal(bar.ignore, true, 'the first row beyond this zoom\'s window');
         t.view.update(st(zoom, 3, { error: { message: 'x', line: z.rows } })); assert.equal(bar.ignore, false, 'the last row of this zoom');
      }
      // The line label follows the cursor's line count at any zoom, and zoom or scrollX alone do not change it.
      t.view.update(st(0, 0)); assert.equal(lnNode.children.length, 2, 'the text and its plate');
   }));

   await check('brightness: idle 85 %, hovered 92 %, focused full; an unplugged card is dimmed', () => {
      const t = makeView(), b = () => t.face._color[0] * 2;
      t.view.update({ buffer: lines20 }); assert.ok(Math.abs(b() - 0.85) < 1e-9);
      t.view.update({ buffer: lines20, hovered: true }); assert.ok(Math.abs(b() - 0.92) < 1e-9);
      t.view.update({ buffer: lines20, focused: true }); assert.ok(Math.abs(b() - 1) < 1e-9);
      assert.deepEqual([V.BRIGHT.idle, V.BRIGHT.hovered, V.BRIGHT.focused], [0.85, 0.92, 1]);
      t.view.update({ buffer: lines20, unplugged: true }); assert.ok(Math.abs(b() - 0.85 * 0.85) < 1e-9, 'dimmed: ' + b());
      t.view.update({ buffer: lines20, unplugged: true, focused: true }); assert.ok(Math.abs(b() - 1) < 1e-9, 'a focused card is not dimmed: ' + b());
      t.view.update({ buffer: lines20 }); assert.ok(Math.abs(b() - 0.85) < 1e-9, 'plugged again');
   });

   await check('legibility: glyph strokes are 0.18 of the height; every line-font text sits on an opaque dark plate', () => withClay(({ widths }) => {
      const node = new FNode();
      G.drawText(node, 'hello', { x: 1, y: 2, z: 3, size: 0.05 });
      assert.ok(widths.length > 0 && widths.every(w => w === 0.18), 'stroke 0.18: ' + widths);
      assert.equal(node.children.length, 2, 'the text and one plate');
      const [text, plate] = node.children;
      assert.equal(plate.form, 'square'); assert.equal(plate._opacity, 1, 'opaque');
      assert.deepEqual(plate._color, G.unlit(G.parseColour(G.PLATE)), 'dark');
      assert.ok(G.parseColour(G.PLATE).every(v => v < 0.1), 'near black');
      const w = G.textWidth('hello') * 0.05;
      assert.ok(Math.abs(plate.pos[0] - (1 + w / 2)) < 1e-9 && plate.pos[1] === 2 && plate.pos[2] < 3 && plate.pos[2] > 3 - 0.01, 'behind the text, centred on it');
      assert.ok(plate.scl[0] > w / 2 && plate.scl[0] < w / 2 + 0.05 * 0.6, 'a little wider than the text');
      assert.ok(plate.scl[1] > 0.05 * 0.5 + 0.05 * 0.09 && plate.scl[1] < 0.05 * 1.0, 'a little higher than the glyphs');
      for (const [align, x0] of [['center', 1], ['right', 1 - w / 2]]) {
         const n2 = new FNode(); G.drawText(n2, 'hello', { x: 1, size: 0.05, align });
         assert.ok(Math.abs(n2.children[1].pos[0] - x0) < 1e-9, align);
      }
      // One plate for the node, reused: moving, resizing, a new string and hiding touch the same two children.
      G.drawText(node, 'longer text', { x: 0, y: 0, size: 0.1 });
      assert.equal(node.children.length, 2);
      assert.ok(plate.scl[0] > G.textWidth('longer text') * 0.1 / 2, 'the plate grew with the text');
      G.hideText(node); assert.equal(plate.ignore, true); assert.equal(text.ignore, true);
      G.drawText(node, 'longer text', { size: 0.1 }); assert.equal(plate.ignore, false);
      G.drawText(node, '', { size: 0.1 }); assert.equal(plate.ignore, true, 'no text, no plate');
      G.drawText(node, 'x', { size: 0.1 }); assert.equal(plate.ignore, false);
      G.releaseText(node); assert.equal(plate.ignore, true);
      // A steady text does not touch the plate again.
      const n3 = new FNode(); G.drawText(n3, 'steady', { size: 0.02 });
      const before = ops; G.drawText(n3, 'steady', { size: 0.02 });
      assert.ok(ops - before <= 4, 'a repeat call touches the text (as before) and not the plate: ' + (ops - before));
   }));

   await check('ln r/n is 30 % larger and on a plate; it is the card\'s only line-font text', () => withClay(({ meshes }) => {
      assert.ok(Math.abs(D.LN.size - 0.014 * 1.3) < 1e-12);
      const t = makeView(), lnNode = t.node.children[11];
      t.view.update({ name: 'osc', buffer: { ...lines20, row: 0, col: 0 }, focused: true, time: 0 });
      const [text, plate] = lnNode.children;
      assert.ok(Math.abs(text.scl[0] - D.LN.size) < 1e-12 && text.pos[0] === lnNode.children[0].pos[0]);
      const w = G.textWidth('ln 1/20') * D.LN.size;
      assert.ok(plate.scl[0] >= w / 2 && plate.pos[0] < text.pos[0], 'right aligned: the plate is left of the anchor, covering the text');
      assert.ok(Math.abs((plate.pos[0] + plate.scl[0]) - text.pos[0]) < 0.0005 + D.LN.size * 0.5, 'and reaches its right end');
      // It fits in the header's first line (the header is 64 px, the name line above 30).
      assert.ok(Math.abs(plate.pos[1]) < 0.25 && (320 - plate.pos[1] * GRID.ppm - plate.scl[1] * GRID.ppm) >= 0 && (320 - plate.pos[1] * GRID.ppm + plate.scl[1] * GRID.ppm) <= GRID.header - 20, 'above the second line');
   }));

   await check('createCard: setTxtr, own the texture, blank paint, upload, counter 0; a repaint asks for one more upload', async () => {
      const log = [];
      const BINDING = 1, ACTIVE = 2, texture = { id: 'tex' };
      const gl = { TEXTURE0: 100, TEXTURE_2D: 3, TEXTURE_BINDING_2D: BINDING, ACTIVE_TEXTURE: ACTIVE, RGBA: 4, UNSIGNED_BYTE: 5,
         activeTexture: u => log.push('active ' + u), getParameter: p => { log.push(p === BINDING ? 'get binding' : 'get active'); return p === BINDING ? texture : 100; },
         texImage2D: (...a) => log.push('upload ' + (a[a.length - 1] === canvas)) };
      const ctx = new Proxy({}, { get: (t, k) => (...a) => { if (k === 'clearRect') log.push('paint'); return ctx; }, set: () => true });
      const canvas = { context: ctx, _animate: false };
      class TNode extends FNode {
         add(f) { const c = new TNode(f); this.children.push(c); return c; }
         setTxtr(src, doNotAnimate) { log.push('setTxtr ' + (src === canvas) + ' ' + doNotAnimate); this._txtr = 5; globalThis.window._canvas_txtr[5] = { src, counter: 1 }; return this; }
      }
      const stub = 'data:text/javascript,' + encodeURIComponent('export function G2(a, w, h) { const c = globalThis.__makeCanvas(a, w, h); this.getCanvas = () => c; this.getContext = () => c.context; }');
      const saved = { window: globalThis.window, make: globalThis.__makeCanvas };
      globalThis.window = { clay: { gl }, _canvas_txtr: [] };
      globalThis.__makeCanvas = (a, w, h) => { log.push(`canvas ${a} ${w} ${h}`); return canvas; };
      try {
         const C = await load('js/scenes/rails/cards.js', { '../../util/g2.js': stub });
         const owned = [], node = new TNode();
         const card = C.createCard(node, { owned });
         assert.deepEqual(log.filter(l => !l.startsWith('active')), ['canvas true 640 640', 'setTxtr true true', 'get binding', 'paint', 'get active', 'upload true'], 'the order');
         assert.deepEqual(owned.map(o => [o.channel, o.texture, o.canvas]), [[5, texture, canvas]]);
         assert.equal(globalThis.window._canvas_txtr[5].counter, 0, 'the first draw does not upload again');
         assert.equal(card.draws, 0);
         card.update({ name: 'a', buffer: { lines: ['x'] } });
         assert.equal(globalThis.window._canvas_txtr[5].counter, 1, 'a change asks for one upload');
         globalThis.window._canvas_txtr[5].counter = 0;
         card.update({ name: 'a', buffer: { lines: ['x'] }, focused: true, time: 0.2 });
         card.update({ name: 'a', buffer: { lines: ['x'] }, focused: true, time: 0.9 });
         assert.equal(globalThis.window._canvas_txtr[5].counter, 1, 'focus repaints');
         globalThis.window._canvas_txtr[5].counter = 0;
         card.update({ name: 'a', buffer: { lines: ['x'], col: 1 }, focused: true, time: 1.5 });
         assert.equal(globalThis.window._canvas_txtr[5].counter, 0, 'a cursor move does not');
         assert.equal(node.children[0].scl[0], 0.25); assert.equal(node.children[0].form, 'square');
         assert.equal(typeof C.drawCard, 'function');
         card.dispose();
         assert.equal(node.children.length, 0);
      } finally { globalThis.window = saved.window; globalThis.__makeCanvas = saved.make; }
   });

   // ---- glyphs ----

   await check('textPaths: segments of the line font, widths, alignment', () => {
      assert.equal(G.textPaths('').length, 0); assert.equal(segs(' '), 0);
      assert.equal(segs('-'), 1); assert.equal(segs('.'), 4); assert.equal(segs('!'), 5);
      assert.equal(segs('Hi'), fontSegs('Hi'));
      assert.equal(segs('x = 3.5'), fontSegs('x = 3.5'));
      assert.equal(segs('é\u0001~'), fontSegs('~'), 'characters outside 32..126 are blank');
      assert.equal(segs('a'.repeat(300)), 200 * fontSegs('a'), 'at most 200 characters');
      assert.ok(Math.abs(G.textWidth('ab') - 1.36) < 1e-12 && G.textWidth('') === 0);
      const xs = ps => ps.flat().map(p => p[0]);
      const left = G.textPaths('ab'), centre = G.textPaths('ab', 'center'), right = G.textPaths('ab', 'right');
      assert.ok(Math.min(...xs(left)) >= 0 && Math.max(...xs(left)) <= 1.36 + 1e-9);
      assert.ok(Math.abs(Math.min(...xs(centre)) + Math.max(...xs(centre))) < 1e-9, 'centred on x = 0'); assert.ok(Math.max(...xs(right)) <= 1e-9, 'ends at x = 0');
      for (const p of left.flat()) assert.ok(p[1] <= 0.5 && p[1] >= -0.7 && p[2] === 0);
      assert.ok(G.textPaths('||').every(p => new Set(p.map(q => q.join())).size === p.length || p.length > 2), 'no repeated neighbours');
   });

   await check('colours: unlit cancels the lights, parseColour reads #rgb and #rrggbb', () => {
      assert.deepEqual(G.parseColour('#f00'), [1, 0, 0]); assert.deepEqual(G.parseColour('#00ff80').map(v => Math.round(v * 255)), [0, 255, 128]);
      assert.deepEqual(G.parseColour('red'), [1, 1, 1]);
      const u = G.unlit([1, 1, 1]);
      assert.ok(Math.abs(u[0] * 2 - 1) < 1e-12 && Math.abs(u[1] * 2.1 - 1) < 1e-12 && Math.abs(u[2] * 2.2 - 1) < 1e-12 && u.length === 10);
   });

   await check('drawText: one mesh per string, rebuilt only on a new string; release frees it', () => withClay(({ meshes, defs }) => {
      const node = new FNode();
      const child = G.drawText(node, 'hello', { x: 1, y: 2, z: 3, size: 0.05, color: '#ff0000' });
      assert.equal(node.children.length, 2, 'the text and its plate');
      assert.equal(node.children[0], child);
      assert.equal(defs.length, 2, 'an empty mesh, then the text');
      const name = defs[0];
      assert.equal(G.segmentCount(meshes[name]), fontSegs('hello'));
      assert.deepEqual(child.pos, [1, 2, 3]); assert.deepEqual(child.scl, [0.05, 0.05, 0.05]);
      G.drawText(node, 'hello', { x: 4, y: 5, z: 6, size: 0.1 });
      assert.equal(defs.length, 2, 'moving and resizing builds no mesh'); assert.deepEqual(child.pos, [4, 5, 6]);
      G.drawText(node, 'bye');
      assert.equal(defs.length, 3); assert.equal(G.segmentCount(meshes[name]), fontSegs('bye'));
      G.drawText(node, 'bye', { align: 'center' }); assert.equal(defs.length, 4, 'alignment is part of the mesh');
      assert.equal(node.children.length, 2, 'two children, always');
      G.hideText(node); assert.equal(child.ignore, true);
      G.drawText(node, 'bye', { align: 'center' }); assert.equal(child.ignore, false); assert.equal(defs.length, 4);
      G.releaseText(node);
      assert.ok(!(name in meshes), 'the mesh is gone'); assert.equal(child.ignore, true);
      const other = new FNode(); G.drawText(other, 'x'); assert.notEqual(defs[defs.length - 1], name, 'a node has its own mesh name');
   }));

   // ---- stage ----

   const sphere = (x, c = '#ff0000') => ({ shape: 'sphere', p: [x, 0.02, 0], s: 0.02, color: c });
   const identity = Array.from({ length: 16 }, (_, i) => i % 5 === 0 ? 1 : 0);
   const shown = (stage, kind) => stage.stats[kind].shown;

   await check('stage: shapes become pooled nodes; extras are hidden; nothing is allocated twice', () => withClay(({ meshes }) => {
      const model = new FNode(), stage = S.createStage(model);
      const root = model.children[0];
      assert.ok(root.children.length >= 5, 'the mat: fill and four edges');
      const l1 = [sphere(0), sphere(0.1), { shape: 'box', p: [0, 0.01, 0.1], s: 0.01, color: '#0f0' }, { shape: 'box', p: [0, 0, 0], s: [0.01, 0.02, 0.03], color: '#00f' },
         { shape: 'line', p: [0, 0, 0], to: [0.1, 0.1, 0], s: 0.004, color: '#fff' }, { shape: 'text', p: [0, 0.05, 0], s: 0.03, color: '#ff0', text: 'hi' }];
      stage.update(identity, [l1], null);
      assert.deepEqual(stage.stats, { sphere: { pooled: 2, shown: 2 }, box: { pooled: 2, shown: 2 }, line: { pooled: 1, shown: 1 }, text: { pooled: 1, shown: 1 } });
      const kids = root.children[root.children.length - 1].children;
      assert.deepEqual(kids.map(k => k.form), ['sphere', 'sphere', 'cube', 'cube', 'tubeZ', undefined]);
      assert.deepEqual(kids[1].pos, [0.1, 0.02, 0]); assert.deepEqual(kids[1].scl, [0.02, 0.02, 0.02], 'a sphere\'s s is its radius');
      assert.deepEqual(kids[3].scl, [0.01, 0.02, 0.03], 'a box\'s three sizes are half extents');
      assert.deepEqual(kids[4].limb, [[0, 0, 0], [0.1, 0.1, 0], 0.004]);
      assert.ok(kids.every(k => k._opacity === 1));
      assert.deepEqual(kids[0]._color, [1, 0, 0]);
      assert.equal(kids[5].children.length, 1, 'text through the line font (no plate on a module\'s picture)');
      assert.equal(Object.values(meshes).filter(p => G.segmentCount(p) === fontSegs('hi')).length, 1);
      assert.deepEqual(root.matrix, identity);
      // A shorter list hides the rest and allocates nothing.
      const before = ops;
      stage.update(identity, [[sphere(0.3)]], null);
      assert.deepEqual(stage.stats, { sphere: { pooled: 2, shown: 1 }, box: { pooled: 2, shown: 0 }, line: { pooled: 1, shown: 0 }, text: { pooled: 1, shown: 0 } });
      assert.equal(kids[1].ignore, true); assert.equal(kids[0].ignore, false); assert.equal(kids[2].ignore, true); assert.equal(kids[5].ignore, true);
      assert.equal(kids[5].children[0].ignore, true, 'hidden text too');
      assert.equal(model.children[0].children.length, root.children.length);
      assert.ok(ops - before < 20, 'only the one shape was touched');
      // And back: the same nodes are used again.
      stage.update(identity, [l1], null);
      assert.equal(shown(stage, 'sphere'), 2); assert.equal(stage.stats.sphere.pooled, 2); assert.equal(kids[1].ignore, false);
   }));

   await check('stage: text shapes have no plate: they are the module\'s own picture', () => withClay(() => {
      const model = new FNode(), stage = S.createStage(model);
      const txt = { shape: 'text', p: [0, 0.05, 0], s: 0.03, color: '#ff0', text: 'hi' };
      stage.update(identity, [[txt]], false);
      const holders = [];
      const walk = n => { if (n.children[0] && /^railsText/.test(n.children[0].form || '')) holders.push(n); n.children.forEach(walk); };
      walk(model);
      assert.equal(holders.length, 1, 'one text');
      for (const h of holders) { assert.equal(h.children.length, 1, 'the text only'); assert.ok(!h.children.some(c => c.form === 'square')); }
      const n = new FNode(); G.drawText(n, 'x', { plate: false }); G.hideText(n); G.releaseText(n);
      assert.equal(n.children.length, 1);
   }));

   await check('stage: an unchanged list does nothing; a new array is read; the matrix moves everything', () => withClay(() => {
      const model = new FNode(), stage = S.createStage(model), root = model.children[0];
      const list = [sphere(0)];
      stage.update(identity, [list], null);
      let before = ops;
      for (let i = 0; i < 10; i++) stage.update(identity.slice(), [list], null);
      assert.equal(ops, before, 'ten frames, no node call');
      const moved = identity.slice(); moved[12] = 0.45; moved[13] = 0.7;
      stage.update(moved, [list], null);
      assert.deepEqual(root.matrix, moved);
      stage.update(moved, [[sphere(0.2)]], null);
      assert.deepEqual(root.children[root.children.length - 1].children[0].pos, [0.2, 0.02, 0]);
      stage.update(null, [list], null); assert.equal(root.ignore, true, 'no desk yet: nothing');
      stage.update(identity.map(() => NaN), [list], null); assert.equal(root.ignore, true);
      stage.update(identity, [list], null); assert.equal(root.ignore, false);
   }));

   await check('stage: lists in several shapes are accepted; every shape is opaque; there is no ghost layer', () => withClay(() => {
      const model = new FNode(), stage = S.createStage(model);
      const opacities = () => model.children[0].children.flatMap(g => g.children).filter(k => !k.ignore && k._opacity === 1);
      stage.update(identity, { a: [sphere(0)], b: [sphere(0.1)] }, false);
      assert.equal(stage.stats.sphere.shown, 2); assert.equal(opacities().length, 2);
      assert.ok(!('ghostStats' in stage) && !('GHOST_OPACITY' in S));
      assert.deepEqual(S.listsOf(null), []); assert.deepEqual(S.listsOf([]), []); assert.deepEqual(S.listsOf('x'), []); assert.deepEqual(S.listsOf({ a: [1], b: 2 }), [[1]]);
   }));

   await check('stage: at most 128 shapes per module; bad shapes are skipped; a degenerate line is not drawn', () => withClay(() => {
      const model = new FNode(), stage = S.createStage(model);
      const big = Array.from({ length: 300 }, (_, i) => sphere(i / 1000));
      stage.update(identity, [big], null);
      assert.equal(shown(stage, 'sphere'), 128);
      stage.update(identity, [big, big, big, big, big, big, big], false);
      assert.equal(shown(stage, 'sphere'), S.MAX_DRAWN, 'and a total cap');
      assert.ok(stage.stats.sphere.pooled <= S.MAX_DRAWN);
      assert.equal(S.collect([big, big, big, big, big, big, big]).length, S.MAX_DRAWN);
      assert.equal(S.collect([big]).length, 128);
      stage.update(identity, [[null, 3, { shape: 'cone', p: [0, 0, 0], s: 1, color: '#fff' }, { shape: 'sphere', p: [NaN, 0, 0], s: 1, color: '#fff' }, { shape: 'sphere' },
         { shape: 'line', p: [0, 0, 0], to: [0, 0, 0], s: 0.01, color: '#fff' }, { shape: 'line', p: [0, 0, 0], s: 0.01, color: '#fff' }, { shape: 'text', p: [0, 0, 0], s: 1, color: '#fff' },
         { shape: 'sphere', p: [0, 0, 0], color: 'red' }]], null);
      assert.deepEqual(stage.stats.sphere, { pooled: stage.stats.sphere.pooled, shown: 1 }, 'only the sphere with a position (a bad colour is white, a missing size small)');
      assert.equal(shown(stage, 'line') + shown(stage, 'text') + shown(stage, 'box'), 0);
      assert.doesNotThrow(() => stage.update(identity, 'nonsense', true));
   }));

   await check('stage: sizes and positions are clamped', () => withClay(({ meshes }) => {
      const model = new FNode(), stage = S.createStage(model);
      const kids = () => model.children[0].children[model.children[0].children.length - 1].children;
      stage.update(identity, [[
         { shape: 'sphere', p: [50, -9, 3], s: 1000, color: '#fff' }, { shape: 'box', p: [0, 0, 0], s: [9, 0.1, -9], color: '#fff' },
         { shape: 'box', p: [0, 0, 0], s: 99, color: '#fff' }, { shape: 'line', p: [-5, 0, 0], to: [5, 7, 0], s: 3, color: '#fff' },
         { shape: 'text', p: [0, 9, 0], s: 5, color: '#fff', text: 'x' }]], null);
      const k = kids();
      assert.deepEqual(k[0].pos, [2, -2, 2]); assert.deepEqual(k[0].scl, [0.25, 0.25, 0.25]);
      assert.deepEqual(k[1].scl, [0.25, 0.1, 0.25]); assert.deepEqual(k[2].scl, [0.25, 0.25, 0.25]);
      assert.deepEqual(k[3].limb, [[-2, 0, 0], [2, 2, 0], 0.25]);
      assert.deepEqual(k[4].children[0].pos, [0, 2, 0]); assert.deepEqual(k[4].children[0].scl, [0.2, 0.2, 0.2]);
      assert.deepEqual(S.LIMITS, { size: 0.25, text: 0.2, pos: 2 });
      stage.update(identity, [[{ shape: 'line', p: [5, 0, 0], to: [9, 0, 0], s: 0.01, color: '#fff' }]], null);
      assert.equal(stage.stats.line.shown, 0, 'two ends that clamp to the same point are a point');
   }));

   await check('stage: dispose removes the root and frees the text meshes', () => withClay(({ meshes }) => {
      const model = new FNode(), stage = S.createStage(model);
      stage.update(identity, [[{ shape: 'text', p: [0, 0, 0], s: 0.02, color: '#fff', text: 'abc' }]], null);
      assert.equal(Object.keys(meshes).length, 1);
      stage.dispose();
      assert.equal(model.children.length, 0); assert.equal(Object.keys(meshes).length, 0);
   }));

   // ---- helpers of the workspace, the rays and the node counts ----

   const ws = { origin: [0, 1.6, 0], yaw: 0, eyeY: 1.6 };
   const ws2 = { origin: [0.3, 1.5, -0.2], yaw: 0.7, eyeY: 1.5 };
   const unit3 = v => { const l = Math.hypot(...v); return v.map(x => x / l); };
   const toward = (w, p) => ({ o: [...w.origin], d: unit3([p[0] - w.origin[0], p[1] - w.origin[1], p[2] - w.origin[2]]) });
   const deg = r => r * 180 / Math.PI;
   const yawRel = (w, p) => { const a = Math.atan2(p[0] - w.origin[0], -(p[2] - w.origin[2])) - w.yaw; return Math.atan2(Math.sin(a), Math.cos(a)); };

   // ---- node counts ----

   const count = n => 1 + n.children.reduce((a, c) => a + count(c), 0);
   const live = n => (n.ignore ? 0 : 1) + (n.ignore ? 0 : n.children.reduce((a, c) => a + live(c), 0));
   const find = (model, pred) => { const out = []; const walk = n => { if (pred(n)) out.push(n); n.children.forEach(walk); }; walk(model); return out; };

   // ---- the timeline strip ----------------------------------------------------------------------------

   const TL = await load('js/scenes/rails/timeline.js');
   const texts2 = ctx => ctx.calls.filter(c => c.op === 'fillText').map(c => c.args[0]);

   await check('timeline: the playhead\'s place on the strip and back, the ticks, the banner, the bars', () => {
      const w = [10, 40];
      assert.equal(TL.fractionOf(null, w), 1, 'live: at the right end'); assert.equal(TL.fractionOf(40, w), 1); assert.equal(TL.fractionOf(10, w), 0);
      assert.equal(TL.fractionOf(25, w), 0.5); assert.equal(TL.fractionOf(-99, w), 0); assert.equal(TL.fractionOf(99, w), 1);
      assert.equal(TL.fractionOf(5, [3, 3]), 1, 'an empty window');
      assert.equal(TL.timeOf(0.5, w), 25); assert.equal(TL.timeOf(2, w), 40); assert.equal(TL.timeOf(-1, w), 10);
      for (const f of [0, 0.1, 0.5, 0.97, 1]) assert.ok(Math.abs(TL.fractionOf(TL.timeOf(f, w), w) - f) < 1e-12);
      const half = (TL.TIMELINE.w - 2 * TL.TIMELINE.margin) / 2;
      assert.ok(Math.abs(TL.xOfFraction(1) - half) < 1e-12 && Math.abs(TL.xOfFraction(0) + half) < 1e-12 && TL.xOfFraction(0.5) === 0, 'between the margins of a 1.5 m strip');
      for (const f of [0, 0.3, 1]) assert.ok(Math.abs(TL.fractionOfX(TL.xOfFraction(f)) - f) < 1e-12);
      assert.deepEqual(TL.ticks([0, 30]).map(t => t.label), ['now', '-5', '-10', '-15', '-20', '-25', '-30']);
      assert.deepEqual(TL.ticks([0, 30]).map(t => +t.fraction.toFixed(4)), [1, 0.8333, 0.6667, 0.5, 0.3333, 0.1667, 0]);
      assert.deepEqual(TL.ticks([10, 18]).map(t => t.label), ['now', '-5'], 'a short tape: only what it holds'); assert.deepEqual(TL.ticks([5, 5]), []);
      assert.equal(TL.banner({ paused: false }), ''); assert.equal(TL.banner({ paused: true, playhead: 27.6, window: [0, 40] }), 'PAST −12.4 s', 'before the window\'s end the scene is the past');
      assert.equal(TL.banner({ paused: true, playing: true, playhead: 39, window: [0, 40] }), 'PLAYING −1.0 s'); assert.equal(TL.banner({ paused: true, playhead: null, window: [0, 40] }), 'PAUSED');
      assert.equal(TL.banner({ paused: true, playhead: 40, window: [0, 40] }), 'PAUSED 0.0 s', 'at the end: paused at now, not the past'); assert.equal(TL.banner({ paused: true, playhead: 39.95, window: [0, 40] }), 'PAUSED 0.0 s');
      assert.ok(!/REPLAY|ghost/i.test(TL.banner({ paused: true, playhead: 1, window: [0, 2], ghost: {} })), 'there is no ghost label any more');
      assert.equal(TL.pastHint(true, 27.6, [0, 40]), 'Mod+Shift+Enter here · Mod+P now'); assert.equal(TL.pastHint(true, 40, [0, 40]), null); assert.equal(TL.pastHint(false, 5, [0, 40]), null); assert.equal(TL.pastHint(true, null, [0, 40]), null);
      assert.deepEqual(TL.barHeights([0, 5, 10], 3), [0, 0.5, 1]); assert.deepEqual(TL.barHeights([], 4), [0, 0, 0, 0]); assert.deepEqual(TL.barHeights(null, 2), [0, 0]);
      assert.deepEqual(TL.barHeights([NaN, -3, 'x', 2], 4), [0, 0, 0, 1], 'bad numbers are quiet bins');
   });

   await check('timeline: drawTimeline live at half height with the vertical scale doubled, paused with the banner; the bars and ticks', () => {
      const density = Array.from({ length: 60 }, (_, i) => (i % 10 === 0 ? 0 : i));
      const live = fakeCtx(); TL.drawTimeline(live, { window: [0, 30], density, paused: false });
      const t = live.calls.find(c => c.op === 'setTransform');
      assert.deepEqual(t.args, [1, 0, 0, 2, 0, 0], 'live: the strip is half as high as the canvas, drawn stretched');
      const bars = live.calls.filter(c => c.op === 'fillRect' && c.fillStyle === '#3a8fd0');
      assert.equal(bars.length, 54, 'a bar for each bin with messages (6 are empty)');
      assert.ok(bars.every(b => b.args[1] + b.args[3] <= 27 + 1e-9), 'inside the plot rows');
      assert.deepEqual([...texts2(live)].sort(), ['-10', '-15', '-20', '-25', '-30', '-5', 'now'].sort());
      const paused = fakeCtx(); TL.drawTimeline(paused, { window: [0, 30], density, paused: true, playhead: 17.6 });
      assert.deepEqual(paused.calls.find(c => c.op === 'setTransform').args, [1, 0, 0, 1, 0, 0]);
      const banner = paused.calls.find(c => c.op === 'fillText' && /PAST/.test(c.args[0]));
      assert.equal(banner.args[0], 'PAST −12.4 s'); assert.equal(banner.fillStyle, '#ffb000', 'amber');
      const hint = paused.calls.find(c => c.op === 'fillText' && /Mod\+Shift\+Enter/.test(c.args[0]));
      assert.equal(hint.args[0], 'Mod+Shift+Enter here · Mod+P now'); assert.equal(hint.fillStyle, '#ffb000'); assert.ok(hint.args[2] < 40, 'on the banner\'s row');
      assert.equal(live.calls.filter(c => c.op === 'fillText' && /PAUSED|PAST|Mod\+/.test(c.args[0])).length, 0);
      const atEnd = fakeCtx(); TL.drawTimeline(atEnd, { window: [0, 30], density: [], paused: true, playhead: 30 });
      assert.ok(texts2(atEnd).includes('PAUSED 0.0 s')); assert.ok(!texts2(atEnd).some(x => /PAST|Mod\+/.test(x)), 'at now: no past label and no hint');
      for (const bad of [undefined, null, {}, { window: 5, density: 'x' }, { window: [NaN, 1], density: [NaN] }]) assert.doesNotThrow(() => TL.drawTimeline(fakeCtx(), bad || {}), JSON.stringify(bad));
   });

   await check('timeline: the strip is painted again only on a change, live at most once a second, paused 10 times, a change of mode at once, a change that waited later', () => {
      const p = new TL.StripPaint(), d = Array(60).fill(1);
      const s = { window: [0, 30], density: d, paused: false };
      assert.equal(p.changed(s, 0), true, 'the first state is painted');
      assert.equal(p.changed(s, 0.5), false, 'the same state is not');
      assert.equal(p.changed({ ...s, density: d.slice() }, 1), false, 'an equal copy of the density is not');
      // A density that changes every frame (60 fps, live, a window that grows by a hundredth of a second each frame) for 4 s: once a second.
      let n = 0;
      for (let i = 0; i < 240; i++) { const dd = d.slice(); dd[i % 60] = 2 + i; if (p.changed({ ...s, window: [0, 10 + i / 6000], density: dd }, 2 + i / 60)) n++; }
      assert.ok(n >= 3 && n <= 5, `${n} live paints in 4 s`);
      // Paused, the same kind of change (the scrub's tenths) is painted at most 10 times a second.
      const sp = new TL.StripPaint(); let m = 0; sp.changed({ ...s, paused: true, playhead: 0 }, 0);
      for (let i = 0; i < 120; i++) if (sp.changed({ ...s, paused: true, playhead: 1 + i / 10 }, 0.001 + i / 60)) m++;
      assert.ok(m >= 18 && m <= 21, `${m} paused paints in 2 s`);
      // A change that came inside the interval is painted by a later call, not lost.
      const q = new TL.StripPaint(); q.changed(s, 0);
      const e = { ...s, density: Array(60).fill(3) };
      assert.equal(q.changed(e, 0.5), false, 'too soon'); assert.equal(q.changed(e, 1.01), true, 'painted when the second is over'); assert.equal(q.changed(e, 1.3), false);
      // A change of mode is painted at once, however soon after the last paint: the strip's height changes with it.
      const w = new TL.StripPaint(); w.changed(s, 0);
      assert.equal(w.changed({ ...s, paused: true, playhead: 20 }, 0.01), true, 'pause');
      assert.equal(w.changed({ ...s, paused: false }, 0.02), true, 'resume');
      assert.equal(w.changed({ ...s, playing: true }, 0.03), true, 'play');
      assert.equal(w.changed({ ...s, playing: true, window: [0, 12] }, 0.05), true, 'the window\'s length in whole seconds');
      assert.equal(w.changed({ ...s, playing: true, window: [0, 12.2] }, 0.06), false, 'but not its tenths');
      // Pause, scrubbing (a new tenth of a second), and play are changes; the live playhead moves nothing.
      const r = new TL.StripPaint(); r.changed(s, 0);
      assert.equal(r.changed({ ...s, playhead: 12 }, 1), false, 'live: the playhead does not matter');
      assert.equal(r.changed({ ...s, paused: true, playhead: 20 }, 2), true, 'paused');
      assert.equal(r.changed({ ...s, paused: true, playhead: 20.02 }, 3), false, 'a hundredth of a second is not a new label');
      assert.equal(r.changed({ ...s, paused: true, playhead: 19.5 }, 4), true, 'scrubbed to a new tenth');
      assert.equal(r.changed({ ...s, paused: true, playing: true, playhead: 19.5 }, 5), true, 'play');
      assert.equal(r.changed({ ...s, window: [0, 20], paused: true, playing: true, playhead: 19.5 }, 7), true, 'the window grew or shrank: other ticks');
      assert.equal(r.changed({ window: [0, 20], paused: true, playing: true, playhead: 19.5 }, 8), true, 'no density at all');
   });

   await check('timeline: a full tape (a window that saw-tooths between 29 and 30 s) is painted once a second live; a pause is still painted at once', () => {
      const p = new TL.StripPaint();
      let n = 0, w = 29;
      for (let i = 0; i < 3600; i++) {                                  // 60 s at 60 fps; the recorder drops a second whenever the span passes 30 s
         const t = i / 60;
         if (i % 30 === 0) w = 29 + (Math.floor(i / 30) % 2);          // the rounded length flips 29 <-> 30 twice a second
         const density = Array.from({ length: 60 }, (_, k) => (k * 7 + i) % 11);
         if (p.changed({ window: [t - w, t], density, paused: false }, t)) n++;
      }
      assert.ok(n / 60 <= 1.1, `${n} live paints in 60 s`); assert.ok(n >= 55, 'and it still paints every second: ' + n);
      // The same tape, paused: the mode change is painted at once, and a length change while paused too.
      assert.equal(p.changed({ window: [30, 60], density: [1], paused: true, playhead: 45 }, 60.001), true, 'the pause');
      assert.equal(p.changed({ window: [30, 59], density: [1], paused: true, playhead: 45 }, 60.002), true, 'paused: the window length matters');
      assert.equal(p.changed({ window: [30, 59], density: [1], paused: false }, 60.003), true, 'the resume');
   });

   // The canvas side, on a fake G2 and fake nodes: one canvas, painted and uploaded before the first frame.
   const withCanvasScene = async (file, fn) => {
      const log = [], texture = { id: 'tex' }, BINDING = 1, ACTIVE = 2;
      let canvas;
      const gl = { TEXTURE0: 100, TEXTURE_2D: 3, TEXTURE_BINDING_2D: BINDING, ACTIVE_TEXTURE: ACTIVE, RGBA: 4, UNSIGNED_BYTE: 5,
         activeTexture: () => {}, getParameter: p => (p === BINDING ? texture : 100), texImage2D: (...a) => log.push('upload ' + (a[a.length - 1] === canvas)) };
      const ctx = fakeCtx();
      canvas = { context: ctx, _animate: false };
      let unit = 6;
      class TNode extends FNode {
         add(f) { const c = new TNode(f); this.children.push(c); return c; }
         setTxtr(src, dna) { log.push('setTxtr ' + (src === canvas) + ' ' + dna); this._txtr = unit; globalThis.window._canvas_txtr[unit] = { src, counter: 1 }; return this; }
      }
      const stub = 'data:text/javascript,' + encodeURIComponent('export function G2(a, w, h) { const c = globalThis.__makeCanvas(a, w, h); this.getCanvas = () => c; }');
      const saved = { window: globalThis.window, make: globalThis.__makeCanvas };
      globalThis.window = { clay: { gl }, _canvas_txtr: [] };
      globalThis.__makeCanvas = (a, w, h) => { log.push(`canvas ${a} ${w} ${h}`); return canvas; };
      try { const M = await load(file, { '../../util/g2.js': stub }); return await fn({ M, TNode, log, ctx, owned: [], counter: () => globalThis.window._canvas_txtr[unit].counter, texture }); }
      finally { globalThis.window = saved.window; globalThis.__makeCanvas = saved.make; }
   };

   await check('createTimeline: one 2048 x 82 canvas, painted and uploaded at creation; scrubbing moves a quad and repaints nothing; paused is twice as high', () => withCanvasScene('js/scenes/rails/timelineView.js', ({ M, TNode, log, ctx, owned, counter, texture }) => {
      const node = new TNode(), tl = M.createTimeline(node, { owned, now: () => 0 });
      assert.deepEqual(log.filter(l => /^(canvas|setTxtr|upload)/.test(l)), ['canvas true 2048 82', 'setTxtr true true', 'upload true'], 'made, bound, uploaded before any frame');
      assert.deepEqual(owned.map(o => [o.channel, o.texture]), [[6, texture]]); assert.equal(counter(), 0, 'and the first draw does not upload again');
      const [face, bar, head] = node.children;
      assert.deepEqual(face.scl, [0.75, 0.015, 1], 'live: 1.5 m by 0.03 m');
      const s = { window: [0, 30], density: Array(60).fill(1), paused: false, playhead: null };
      tl.update(s, 1); assert.equal(counter(), 1, 'a change asks for one upload'); counter(); const painted = ctx.calls.length;
      const half = (1.5 - 0.024) / 2;
      assert.ok(Math.abs(bar.pos[0] - half) < 1e-9, 'live: the playhead at the right end'); assert.equal(bar.scl[1], 0.015 + 0.004);
      tl.update(s, 2); tl.update(s, 3);
      assert.equal(ctx.calls.length, painted, 'an unchanged state paints nothing');
      const before = ops; tl.update(s, 4); assert.equal(ops, before, 'and does not touch a node');
      globalThis.window._canvas_txtr[6].counter = 0;
      const p = { ...s, paused: true, playhead: 15 };
      tl.update(p, 5);
      assert.deepEqual(face.scl, [0.75, 0.03, 1], 'paused: 0.06 m high'); assert.ok(Math.abs(bar.pos[0]) < 1e-9, 'at the middle of the window');
      assert.equal(globalThis.window._canvas_txtr[6].counter, 1, 'the pause painted the banner');
      globalThis.window._canvas_txtr[6].counter = 0;
      const painted2 = tl.stats.painted;
      for (let i = 0; i < 20; i++) tl.update({ ...p, playhead: 15 + i * 0.001 }, 5 + i);       // the same label: only the quad moves
      assert.equal(tl.stats.painted, painted2); assert.equal(globalThis.window._canvas_txtr[6].counter, 0);
      tl.update({ ...p, playhead: 7.5 }, 40);
      assert.ok(Math.abs(bar.pos[0] + half / 2) < 1e-9, 'a quarter in: left of the middle');
      tl.update({ ...p, playhead: 7.5 }, 41);
      assert.doesNotThrow(() => { tl.update(null, 42); tl.update({}, 43); tl.update({ paused: true, playhead: NaN, window: 'x' }, 44); });
      // The pause and the resume: the picture and the height change in the same call, however soon after the last paint (no stretched strip).
      tl.update({ ...s, paused: false }, 200); globalThis.window._canvas_txtr[6].counter = 0;
      tl.update({ ...s, paused: true, playhead: 20 }, 200.01);
      assert.deepEqual([face.scl[1], globalThis.window._canvas_txtr[6].counter], [0.03, 1], 'paused: taller and repainted together');
      globalThis.window._canvas_txtr[6].counter = 0;
      tl.update({ ...s, paused: false }, 200.02);
      assert.deepEqual([face.scl[1], globalThis.window._canvas_txtr[6].counter], [0.015, 1], 'live again: lower and repainted together');
      tl.dispose(); assert.equal(node.children.length, 0);
   }));

   await check('timeline: the strip sits on an opaque plate larger than itself, and it follows the strip\'s height', () => withCanvasScene('js/scenes/rails/timelineView.js', ({ M, TNode, owned }) => {
      const node = new TNode(), tl = M.createTimeline(node, { owned, now: () => 0 });
      const plate = node.children[3];
      assert.ok(plate && plate.form === 'square' && plate._opacity === 1 && plate.pos[2] < 0, 'a plate behind the strip, opaque');
      tl.update({ window: [0, 30], density: [], paused: false }, 1);
      assert.ok(plate.scl[0] > 0.75 && plate.scl[1] > 0.015 && plate.scl[1] < 0.015 + 0.02, 'live: a little larger than 1.5 x 0.03 m');
      assert.deepEqual(plate._color, G.unlit(G.parseColour(G.PLATE)));
      tl.update({ window: [0, 30], density: [], paused: true, playhead: 10 }, 2);
      assert.ok(plate.scl[1] > 0.03 && plate.scl[1] < 0.03 + 0.02, 'paused: follows the taller strip');
      tl.dispose(); assert.equal(node.children.length, 0);
   }));

   await check('stage: the mat\'s outline and fill turn amber while paused and back to blue live, on the same nodes (the scene is the past)', () => {
      const node = new FNode(), st = S.createStage(node);
      const mat = L.stageFrame(ws, 1.15), flat = node.children[0].children.filter(n => n.form === 'cube').slice(0, 5);
      const colours = () => flat.map(n => JSON.stringify(n._color));
      const nodes = () => find(node, () => true).length;
      assert.equal(flat.length, 5, 'a fill and four edges');
      st.update(mat, {}, false); const blue = colours(); assert.deepEqual([...new Set(blue)], [JSON.stringify(S.OUTLINE)]);
      const n0 = nodes();
      st.update(mat, {}, true);
      assert.deepEqual([...new Set(colours())], [JSON.stringify(S.PAUSED_OUTLINE)], 'amber while paused'); assert.notEqual(S.PAUSED_OUTLINE[0], S.OUTLINE[0]);
      assert.ok(S.PAUSED_OUTLINE[0] > 0.9 && S.PAUSED_OUTLINE[1] > 0.5 && S.PAUSED_OUTLINE[2] < 0.2, 'amber');
      assert.equal(nodes(), n0, 'no new nodes');
      const before = ops; st.update(mat, {}, true); assert.equal(ops, before, 'paused again: nothing is touched');
      st.update(mat, {}, false); assert.deepEqual(colours(), blue, 'back to the live colour');
   });

   // ---- the bus and the plugs: busView.js (pure) and bus3d.js (nodes) ----

   const BV = await load('js/scenes/rails/busView.js');
   const B3 = await load('js/scenes/rails/bus3d.js');
   const rad = d => d * Math.PI / 180;
   const railHueOf = (await load('js/scenes/rails/geom.js')).railHue;
   const yawOfPoint = (w, p) => yawRel(w, p);
   const rayTo = (w, p) => ({ o: [...w.origin], d: unit3([p[0] - w.origin[0], p[1] - w.origin[1], p[2] - w.origin[2]]) });
   // The view the bus needs: slots {slot, id, state: {unplugged}}, the rails (pubs and subs are [card, port]), the grab and the gaze.
   const busSlots = (ids, unplugged = []) => L.SLOTS.map((_, i) => ids[i] ? { slot: i, id: ids[i], state: { unplugged: unplugged.includes(ids[i]) } } : null);
   const busRails = {
      target: { kind: 'state', type: 'vec3', seq: 3, pubs: [['osc', 'out']], subs: [['ball', 'target'], ['spin', 'target']] },
      planted: { kind: 'event', type: 'num', seq: 4, tail: [{ seq: 4, by: 'mod:osc.out', v: 1 }], pubs: [['osc', 'out']], subs: [['ball', 'target']] },
      time: { kind: 'state', type: 'time', seq: 60, pubs: [['dev:clock', 'time']], subs: [['osc', 'time']] },
   };
   const busDemo = ['osc', 'ball', 'spin', 'echo'];                      // slots 0 to 3 (yaw -50, -25, 0, 25)
   const busView = (o = {}) => ({ slots: busSlots(o.ids || busDemo, o.unplugged), rails: o.rails || busRails, plugGrab: o.grab || null, ray: o.ray || null });
   const busFrame = (b, w, t, o) => b.update(w, busView(o), t);

   await check('the bus: one band at the bus height across -62..62 degrees, both faces, thin', () => {
      const tris = BV.busRibbon(ws);
      assert.ok(tris.length > 0 && tris.length % 6 === 0 && tris.every(v => v.length === 6 && v.every(Number.isFinite)), 'triangles of [x y z nx ny nz]');
      const ys = tris.map(v => v[1]);
      assert.ok(Math.abs(Math.max(...ys) - (1.6 + L.BUS.y + BV.BUS_HALF)) < 1e-9 && Math.abs(Math.min(...ys) - (1.6 + L.BUS.y - BV.BUS_HALF)) < 1e-9, 'around BUS.y, a thin band');
      const yaws = tris.map(v => deg(yawOfPoint(ws, v)));
      assert.ok(Math.abs(Math.min(...yaws) + 62) < 1e-6 && Math.abs(Math.max(...yaws) - 62) < 1e-6, 'from BUS.from to BUS.to');
      assert.ok(tris.every(v => Math.abs(Math.hypot(v[0], v[2]) - 1.25) < 1e-9), 'on the cards\' cylinder');
      // Two faces: for each triangle there is another over the same corners with the opposite normal.
      const toUser = tris.filter((v, i) => i % 3 === 0 && (v[3] * -v[0] + v[5] * -v[2]) > 0).length, away = tris.filter((v, i) => i % 3 === 0 && (v[3] * -v[0] + v[5] * -v[2]) < 0).length;
      assert.equal(toUser, away, 'one face to the user and one away');
      assert.equal(BV.busRibbon(ws2).length, tris.length);
      for (const m of [BV.plugTriangles(), BV.discTriangles(0.012), BV.ringTriangles(0.007, 0.013)]) assert.ok(m.length > 0 && m.length % 6 === 0 && m.every(v => v.length === 6 && v.every(Number.isFinite)));
      assert.ok(BV.ringTriangles(0.007, 0.013).every(v => Math.hypot(v[0], v[1]) >= 0.007 - 1e-9), 'a ring has a hole');
   });

   await check('a connector: the plug is at plugCell, the drop line runs to the bus at the card\'s yaw, an unplugged one hangs short with a dot below', () => {
      for (const w of [ws, ws2]) for (let slot = 0; slot < L.SLOTS.length; slot++) {
         const c = BV.connectorOf(w, slot, true), plug = L.plugWorld(w, slot);
         assert.deepEqual(c.plug, plug, 'the plug is where plugWorld says');
         assert.equal(L.plugAt(w, rayTo(w, c.plug), slot), true, 'round trip: the gaze on the drawn plug is on the plug');
         assert.deepEqual(c.line[0], plug);
         assert.ok(Math.abs(c.line[1][1] - (w.eyeY + L.BUS.y)) < 1e-9 && Math.abs(yawOfPoint(w, c.line[1]) - rad(L.SLOTS[slot])) < 1e-9, 'ends on the bus at the card\'s yaw');
         assert.equal(L.onBus(w, rayTo(w, c.line[1])), true, 'a gaze on the connector is a gaze on the bus');
         assert.deepEqual(c.dot, c.line[1]);
         const u = BV.connectorOf(w, slot, false);
         assert.deepEqual(u.line[0], plug);
         assert.ok(Math.abs(u.line[1][1] - (plug[1] - BV.HANG)) < 1e-9 && BV.HANG > 0.01 && BV.HANG < 0.06, 'short');
         assert.equal(L.onBus(w, rayTo(w, u.dot)), false, 'a hanging dot is not on the bus');
         assert.ok(u.dot[1] > w.eyeY + L.BUS.y + BV.BUS_HALF, 'above the bus band');
      }
      assert.equal(BV.connectorOf(ws, 9, true), null);
      // The held plug: its line goes to where the gaze meets the cylinder.
      const ray = { o: [0, 1.6, 0], d: unit3([Math.sin(rad(20)), -0.3, -Math.cos(rad(20))]) };
      const held = BV.heldEnd(ws, ray);
      assert.ok(Math.abs(Math.hypot(held.end[0], held.end[2]) - 1.25) < 1e-9 && Math.abs(deg(yawOfPoint(ws, held.end)) - 20) < 1e-6 && Math.abs(held.end[1] - (1.6 - 0.3 * 1.25)) < 1e-9 && Math.abs(held.height + 0.375) < 1e-9, 'on the cylinder, along the gaze');
      assert.equal(BV.heldEnd(ws, null), null); assert.equal(BV.heldEnd(ws, { o: [NaN, 0, 0], d: [0, 0, -1] }), null);
   });

   await check('pulses: a message from a card goes along the bus to each taker at 1 m/s, in the variable\'s hue, then fades', () => {
      const P = new BV.Pulses(), yawOf = id => ({ osc: rad(-50), ball: rad(-25), spin: 0 })[id] ?? null;
      const look = (rails, t) => { for (const k of Object.keys(rails)) P.observe(k, rails[k], yawOf, t); };
      look(busRails, 0);
      assert.equal(P.alive, 0, 'the first look sees none');
      look({ ...busRails, target: { ...busRails.target, seq: 4 } }, 1);
      assert.equal(P.alive, 2, 'one pulse for each taker (ball, spin)');
      const [a, b] = P.slots.filter(s => s.alive);
      assert.deepEqual([a.from, a.to, b.from, b.to].map(deg).map(Math.round), [-50, -25, -50, 0]);
      assert.equal(a.variable, 'target'); const hsl = h => { const a = 0.75 * 0.38, f = n => { const k = (n + h / 30) % 12; return 0.62 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); }; return [f(0), f(8), f(4)]; };
      assert.deepEqual(BV.hueRgb('target'), hsl(railHueOf('target')), 'the variable\'s hue, as the card\'s bindings have it');
      P.step(1.5);
      assert.ok(Math.abs(a.head - (a.from + 0.5 / 1.25)) < 1e-9 && Math.abs(b.head - (b.from + 0.5 / 1.25)) < 1e-9, 'half a second: 0.5 m along the arc (0.4 rad); the near taker is 25 degrees (0.55 m) away');
      P.step(1.6); assert.equal(P.alive, 2, 'the near one has arrived at 0.55 s and is fading');
      P.step(1 + 1.09 + 0.31); assert.equal(P.alive, 0, 'arrived and faded');
      // A publisher with no connector (unplugged, gone) starts nothing; a taker with none gets nothing; a device starts in the middle of the bus.
      const none = new BV.Pulses(), osc = { ...busRails.target, pubs: [['gone', 'out']] };
      none.observe('v', { ...osc, seq: 1 }, yawOf, 0); none.observe('v', { ...osc, seq: 2 }, yawOf, 1);
      assert.equal(none.alive, 0, 'the publisher has no connector');
      const lone = { ...busRails.target, subs: [['gone', 'in']] };
      none.observe('w', { ...lone, seq: 1 }, yawOf, 0); none.observe('w', { ...lone, seq: 2 }, yawOf, 1);
      assert.equal(none.alive, 0, 'a state variable nobody takes has no pulse');
      const ev = { ...busRails.planted, subs: [['gone', 'in']] };
      none.observe('x', { ...ev, seq: 1 }, yawOf, 0); none.observe('x', { ...ev, seq: 2 }, yawOf, 1);
      assert.equal(none.alive, 1, 'an event nobody takes pulses in place, as a message into nothing');
      assert.equal(none.slots.find(s => s.alive).from, none.slots.find(s => s.alive).to);
      const dev = new BV.Pulses();
      dev.observe('time', { ...busRails.time, seq: 1 }, yawOf, 0); dev.observe('time', { ...busRails.time, seq: 2 }, yawOf, 1);
      assert.equal(dev.alive, 0, 'a device never pulses (the clock would be a storm)');
      dev.observe('e', { ...busRails.planted, seq: 1, pubs: [['dev:gaze', 'hit']] }, yawOf, 0); dev.observe('e', { ...busRails.planted, seq: 2, tail: [{ seq: 2, by: 'dev:gaze.hit' }], pubs: [['dev:gaze', 'hit']] }, yawOf, 1);
      assert.equal(dev.alive, 0, 'not even an event a device sent');
      // The publisher is the one that sent it when the tail says so.
      const by = new BV.Pulses();
      const two = { kind: 'event', type: 'num', seq: 1, tail: [], pubs: [['osc', 'out'], ['ball', 'out']], subs: [['spin', 'in']] };
      by.observe('e', two, yawOf, 0); by.observe('e', { ...two, seq: 2, tail: [{ seq: 2, by: 'mod:ball.out' }] }, yawOf, 1);
      assert.equal(Math.round(deg(by.slots.find(s => s.alive).from)), -25);
   });

   await check('pulses: a state variable pulses at most once per route per 0.3 s; an event always does, merged within 0.1 s', () => {
      const P = new BV.Pulses(), yawOf = id => id === 'osc' ? rad(-50) : id === 'ball' ? rad(25) : null;
      const st = n => ({ kind: 'state', type: 'num', seq: n, pubs: [['osc', 'out']], subs: [['ball', 'in']] });
      P.observe('s', st(1), yawOf, 0);
      for (let i = 1; i <= 60; i++) P.observe('s', st(1 + i), yawOf, i / 60);            // 60 changes in one second
      assert.ok(P.slots.filter(p => p.alive).length <= 4 && P.serial >= 3 && P.serial <= 4, 'a state stream: one pulse per 0.3 s, not one per change: ' + P.serial);
      const E = new BV.Pulses(), ev = n => ({ ...st(n), kind: 'event' });
      E.observe('e', ev(1), yawOf, 0);
      E.observe('e', ev(2), yawOf, 0.05); assert.equal(E.serial, 1, '0.05 s apart: the same pulse');
      E.observe('e', ev(3), yawOf, 0.2); assert.equal(E.serial, 2, 'an event 0.15 s later is never dropped');
      E.observe('e', ev(4), yawOf, 0.21); E.observe('e', ev(5), yawOf, 0.22); assert.equal(E.serial, 2);
   });

   await check('pulses: a stream on one route is one pulse, at most 60 are alive, and nothing is allocated after construction', () => {
      const P = new BV.Pulses(), yawOf = id => id === 'osc' ? rad(-50) : id === 'ball' ? rad(25) : null;
      const r = n => ({ kind: 'event', type: 'num', seq: n, tail: [], pubs: [['osc', 'out']], subs: [['ball', 'in']] });
      P.observe('e', r(1), yawOf, 0);
      for (let i = 2; i < 12; i++) P.observe('e', r(i), yawOf, i * 0.01);
      assert.equal(P.alive, 1, 'event messages less than 0.1 s apart join the pulse');
      assert.ok(P.slots.find(s => s.alive).count > 5, 'and make it brighter');
      P.observe('e', r(20), yawOf, 0.5); assert.equal(P.alive, 2, 'a later one is a pulse of its own');
      const many = new BV.Pulses();
      for (let v = 0; v < 100; v++) many.observe('v' + v, r(1), yawOf, 0);
      for (let v = 0; v < 100; v++) many.observe('v' + v, r(2), yawOf, 0.01 * v);
      assert.equal(many.alive, 60, 'capped at 60: ' + many.alive);
      assert.equal(many.slots.length, 60);
      assert.equal(new BV.Pulses().alive, 0);
      assert.doesNotThrow(() => { for (const x of [null, undefined, 5, { kind: 'event', seq: 'x' }, { kind: 'event', seq: 3, pubs: 7, subs: [null, 3, []] }]) many.observe('junk', x, yawOf, 1); });
   });

   const busNodes = model => find(model, n => !!n.form);
   const bus3 = (model, re) => find(model, n => re.test(n.form || ''));

   await check('bus3d: the bus is one mesh, made once and again only when the workspace changes; nothing without a workspace', () => withClay(({ solids }) => {
      const defs = [], was = globalThis.clay.defineMesh;
      globalThis.clay.defineMesh = (name, m) => { defs.push(name); return was(name, m); };
      const model = new FNode(), b = B3.createBus(model);
      busFrame(b, ws, 0); busFrame(b, ws, 1); busFrame(b, { ...ws }, 1.1);
      const ribbons = bus3(model, /^railsBusRibbon_/);
      assert.equal(ribbons.length, 1, 'one node for the whole bus');
      const name = ribbons[0].form, made = () => defs.filter(n => n === name).length;
      assert.equal(made(), 2, 'made for the first workspace, and again for a new workspace object');
      const m = solids[name]; assert.ok(m.isTriangles === true && m.length > 0);
      const n = made(); busFrame(b, ws2, 40); assert.equal(made(), n + 1, 'a new workspace: one new mesh');
      const k = made(); const same = ws2; for (let i = 0; i < 20; i++) busFrame(b, same, 41 + i);
      assert.equal(made(), k, 'the same workspace: no new mesh');
      b.update(null, busView(), 50); assert.equal(b.stats.drawn, 0, 'no workspace, nothing drawn');
      assert.doesNotThrow(() => { b.update(ws, null, 51); b.update(ws, {}, 52); b.update(ws, { slots: 5, rails: 4 }, NaN); });
   }));

   await check('bus3d: a plug, a drop line and a dot for each card, at plugCell; a card that is gone has none; hung nodes are hidden, not removed', () => withClay(() => {
      const model = new FNode(), b = B3.createBus(model);
      busFrame(b, ws, 0);
      const plugs = bus3(model, /^railsBusPlug_/).filter(n => !n.ignore);
      assert.equal(plugs.length, 4);
      const want = busDemo.map((_, i) => L.frameMatrix(ws, rad(L.SLOTS[i]), 0, 1.25 - BV.PLUG_FRONT));
      const at = plugs.map(n => n.matrix);
      for (let i = 0; i < 4; i++) {
         const p = L.plugWorld(ws, i);
         assert.ok(at.some(m => Math.abs(m[12] - want[i][12]) < 1e-9 && Math.abs(m[14] - want[i][14]) < 0.02 && Math.abs(m[13] - p[1]) < 1e-9), 'plug ' + i + ' hangs at plugCell\'s height, at the card\'s yaw');
      }
      const lines = find(model, n => n.limb && Math.abs(n.limb[2] - BV.DROP_R) < 1e-12 && !n.ignore);
      assert.equal(lines.length, 4);
      for (const l of lines) assert.ok(Math.abs(l.limb[1][1] - (1.6 + L.BUS.y)) < 1e-9, 'plugged: down to the bus');
      assert.equal(bus3(model, /^railsBusDot_/).filter(n => !n.ignore).length, 4, 'a solid dot on the bus for each');
      assert.equal(bus3(model, /^railsBusRing_/).filter(n => !n.ignore).length, 0, 'and no hollow one');
      const total = count(model);
      busFrame(b, ws, 1, { ids: ['osc', null, 'spin', null] });
      assert.equal(bus3(model, /^railsBusPlug_/).filter(n => !n.ignore).length, 2, 'two cards: two plugs');
      assert.equal(count(model), total, 'the others are hidden, not removed');
      busFrame(b, ws, 2, { ids: [null, null, null, null] }); assert.equal(b.stats.drawn, 1, 'no card: only the bus');
      // A card with no id (the command line's stand-in slot) has no plug.
      b.update(ws, { slots: [null, null, { slot: 2, id: null, state: { unplugged: false } }, null, null], rails: {} }, 3); assert.equal(b.stats.drawn, 1);
   }));

   await check('bus3d: an unplugged card has a short hanging line and a hollow red dot; plugging it back restores the solid dot', () => withClay(() => {
      const model = new FNode(), b = B3.createBus(model);
      busFrame(b, ws, 0, { unplugged: ['ball'] });
      const rings = bus3(model, /^railsBusRing_/).filter(n => !n.ignore), dots = bus3(model, /^railsBusDot_/).filter(n => !n.ignore);
      assert.equal(rings.length, 1); assert.equal(dots.length, 3);
      assert.ok(rings[0]._color[0] > rings[0]._color[1] * 2 && rings[0]._color[0] > rings[0]._color[2] * 2, 'red: ' + rings[0]._color);
      const lines = find(model, n => n.limb && Math.abs(n.limb[2] - BV.DROP_R) < 1e-12 && !n.ignore);
      const short = lines.filter(l => Math.abs(l.limb[0][1] - l.limb[1][1] - BV.HANG) < 1e-9);
      assert.equal(short.length, 1, 'one line hangs short');
      assert.ok(Math.abs(rings[0].matrix[13] - short[0].limb[1][1]) < 1e-9, 'the ring is at its end');
      assert.equal(b.stats.plugged, 3); assert.equal(b.stats.unplugged, 1);
      busFrame(b, ws, 1, { unplugged: [] });
      assert.equal(bus3(model, /^railsBusRing_/).filter(n => !n.ignore).length, 0); assert.equal(bus3(model, /^railsBusDot_/).filter(n => !n.ignore).length, 4);
      assert.equal(b.stats.unplugged, 0);
   }));

   await check('bus3d: a held plug\'s line follows the gaze and is highlighted over the bus; the dot is solid over the bus and a red ring elsewhere', () => withClay(() => {
      const model = new FNode(), b = B3.createBus(model);
      const slotOf = 1, plug = L.plugWorld(ws, slotOf);
      const ray = deg => ({ o: [0, 1.6, 0], d: unit3([Math.sin(rad(deg)), (L.BUS.y) / 1.25, -Math.cos(rad(deg))]) });
      const lineOf = () => find(model, n => n.limb && !n.ignore && Math.abs(n.limb[0][0] - plug[0]) < 1e-9 && Math.abs(n.limb[0][2] - plug[2]) < 1e-9)[0];
      busFrame(b, ws, 0, { unplugged: ['ball'] });
      const idle = lineOf(), idleOp = idle._opacity, idleCol = idle._color.slice();
      assert.equal(idle.limb[1][1] < plug[1], true);
      // Held, the gaze on the bus at 10 degrees.
      let o = { unplugged: ['ball'], grab: { card: 'ball', over: 'bus' }, ray: ray(10) };
      busFrame(b, ws, 1, o);
      let l = lineOf();
      assert.ok(Math.abs(yawOfPoint(ws, l.limb[1]) - rad(10)) < 1e-6 && Math.abs(Math.hypot(l.limb[1][0], l.limb[1][2]) - 1.25) < 1e-6, 'the end is where the gaze meets the cylinder');
      assert.ok(l.limb[1][1] < 1.6 && Math.abs(l.limb[1][1] - (1.6 + L.BUS.y)) < 1e-6, 'at the bus height');
      const hot = l._color.slice(), hotR = l.limb[2];
      assert.notDeepEqual(hot, idleCol, 'highlighted over the bus');
      assert.equal(bus3(model, /^railsBusDot_/).some(n => !n.ignore && Math.abs(n.matrix[12] - l.limb[1][0]) < 0.02), true, 'a solid dot at the end');
      // Off the bus: the line goes on following the gaze, no highlight, a ring.
      o = { ...o, grab: { card: 'ball', over: null }, ray: ray(40) };
      busFrame(b, ws, 2, o);
      l = lineOf();
      assert.ok(Math.abs(yawOfPoint(ws, l.limb[1]) - rad(40)) < 1e-6);
      assert.notDeepEqual(l._color, hot, 'not highlighted off the bus'); assert.ok(l.limb[2] <= hotR);
      assert.equal(bus3(model, /^railsBusRing_/).some(n => !n.ignore && Math.abs(n.matrix[12] - l.limb[1][0]) < 0.02), true, 'a red ring at the end: letting go here unplugs');
      assert.equal(b.stats.held, 'ball');
      // The gaze moves: the line follows each frame; a lost gaze hangs it short.
      busFrame(b, ws, 3, { ...o, ray: ray(-30) });
      assert.ok(Math.abs(yawOfPoint(ws, lineOf().limb[1]) + rad(30)) < 1e-6);
      busFrame(b, ws, 4, { ...o, ray: { o: [NaN, 0, 0], d: [0, 0, -1] } });
      assert.ok(Math.abs(lineOf().limb[0][1] - lineOf().limb[1][1] - BV.HANG) < 1e-9, 'no gaze: it hangs short');
      // Released: back to the card's own state.
      busFrame(b, ws, 5, { unplugged: ['ball'] });
      assert.equal(b.stats.held, null); assert.ok(Math.abs(lineOf()._opacity - idleOp) < 1e-12);
      assert.equal(bus3(model, /^railsBusRing_/).filter(n => !n.ignore).length, 1);
   }));

   await check('bus3d: pulses are nodes on the bus, 60 at most, one per route, and only pooled nodes are used', () => withClay(() => {
      const model = new FNode(), b = B3.createBus(model);
      busFrame(b, ws, 0);
      assert.equal(b.stats.pulses.shown, 0); assert.equal(b.stats.pulses.pooled, 0, 'nothing is pooled before the first pulse');
      busFrame(b, ws, 1, { rails: { ...busRails, target: { ...busRails.target, seq: 4 } } });
      assert.equal(b.stats.pulses.shown, 2, 'target goes from osc to ball and to spin');
      const ps = find(model, n => n.limb && Math.abs(n.limb[2] - BV.PULSE_R) < 1e-12 && !n.ignore);
      assert.equal(ps.length, 2);
      for (const p of ps) assert.ok(Math.abs(p.limb[0][1] - (1.6 + L.BUS.y)) < 1e-9 && Math.abs(p.limb[1][1] - (1.6 + L.BUS.y)) < 1e-9, 'along the bus');
      const hue = BV.hueRgb('target');
      assert.ok(ps.every(p => p._color[0] > 0 || p._color[1] > 0), 'coloured ' + hue);
      busFrame(b, ws, 1.5, { rails: { ...busRails, target: { ...busRails.target, seq: 4 } } });
      const moved = find(model, n => n.limb && Math.abs(n.limb[2] - BV.PULSE_R) < 1e-12 && !n.ignore);
      assert.ok(Math.abs(yawOfPoint(ws, moved[1].limb[1]) - (rad(-50) + 0.4)) < 1e-6, 'the far pulse is 0.5 m along after 0.5 s: ' + deg(yawOfPoint(ws, moved[1].limb[1])));
      // A flood of variables: capped.
      const flood = n => { const r = {}; for (let v = 0; v < 100; v++) r['v' + v] = { kind: 'event', type: 'num', seq: n, tail: [], pubs: [['osc', 'out']], subs: [['echo', 'in']] }; return r; };
      busFrame(b, ws, 2, { rails: flood(1) }); busFrame(b, ws, 2.1, { rails: flood(2) });
      assert.ok(b.stats.pulses.shown <= 60 && b.stats.pulses.pooled <= 60, JSON.stringify(b.stats.pulses));
      assert.equal(b.stats.pulses.shown, 60);
      const made = count(model);
      for (let i = 0; i < 200; i++) busFrame(b, ws, 3 + i / 60, { rails: flood(3 + i) });
      assert.equal(count(model), made, 'no node is allocated in 3 s of floods');
      busFrame(b, ws, 20, { rails: flood(202) });
      assert.equal(b.stats.pulses.shown, 0, 'when it has run out they are all hidden');
   }));

   // The demo modules on a real runtime: snapshots at 30 Hz seen at 72 fps, the clock, the gaze and the pointer all running. The bus
   // must stay readable: few pulses, none from a device, a few drawn nodes.
   await check('bus3d on a real runtime: the demo for 6 s with the devices moving keeps at most 12 pulses alive, none from a device, at most 30 nodes drawn', async () => {
      const fs = require('node:fs');
      const Rt = await load('js/scenes/rails/runtime.js');
      const layout = JSON.parse(fs.readFileSync('js/scenes/rails/data/layout.js', 'utf8').trim().slice('export default '.length, -1));
      const sources = {}; for (const n of ['oscillator', 'ball', 'flowers', 'constant']) sources[n] = fs.readFileSync(`js/scenes/rails/modules/${n}.js`, 'utf8');
      const rt = new Rt.Runtime({ seed: 1 }); rt.load({ layout, sources });
      withClay(() => {
      const ids = ['oscillator', 'ball', 'flowers', 'constant'];
      const model = new FNode(), b = B3.createBus(model), rails = {};
      const slots = busSlots(ids), FPS = 72;
      let step = 0, snaps = 0, maxAlive = 0, maxDrawn = 0, deviceStarts = 0, total = 0;
      for (let f = 0; f < 6 * FPS; f++) {
         const t = f / FPS;
         while (step < Math.floor(t * 60)) {
            step++;
            rt.setDevice('gaze', 'hit', [Math.sin(step / 60) * 0.3, 0, -Math.cos(step / 60) * 0.2]); rt.setDevice('pointer', 'pos', [Math.cos(step / 60) * 0.1, 0, 0.05]);
            rt.step();
         }
         while (snaps < Math.floor(t * 30)) { snaps++; const s = rt.snapshot(); if (s.rails) for (const [id, r] of Object.entries(s.rails)) rails[id] = { ...rails[id], ...r }; }
         b.update(ws, { slots, rails, plugGrab: null, ray: null }, t);
         maxAlive = Math.max(maxAlive, b.stats.pulses.shown); maxDrawn = Math.max(maxDrawn, b.stats.drawn);
         total += b.stats.pulses.shown;
      }
      assert.ok(Object.keys(rails).length >= 5 && snaps > 150, 'the runtime ran: ' + Object.keys(rails));
      assert.ok(maxAlive >= 1, 'the cards do publish: some pulses');
      console.log('  real runtime, 6 s at 72 fps: max pulses alive', maxAlive, 'mean', (total / (6 * FPS)).toFixed(1), 'max drawn', maxDrawn);
      assert.ok(maxAlive <= 12, 'pulses alive: ' + maxAlive);
      assert.ok(maxDrawn <= 30, 'nodes drawn: ' + maxDrawn);
      // None of the pulses comes from a device: a variable only a device publishes (time, gaze_*, pointer_*) is never one.
      const devOnly = Object.keys(rails).filter(k => (rails[k].pubs || []).length && rails[k].pubs.every(p => String(p[0]).startsWith('dev:')));
      assert.ok(devOnly.length >= 3, 'device variables are on the bus: ' + devOnly);
      const P = new BV.Pulses(), yawOf = id => ids.includes(id) ? rad(L.SLOTS[ids.indexOf(id)]) : null;
      for (let step2 = 0; step2 < 2; step2++) for (const k of devOnly) P.observe(k, { ...rails[k], seq: (rails[k].seq || 0) + 1 + step2 * 50 }, yawOf, step2);
      assert.equal(P.alive, 0, 'a device publisher starts no pulse');
      });
   });

   await check('bus3d: a pulse is coloured once when it is new and only its opacity changes while it fades; the bus is grey', () => withClay(() => {
      const model = new FNode(), b = B3.createBus(model);
      busFrame(b, ws, 0);
      const ribbon = bus3(model, /^railsBusRibbon_/)[0];
      assert.ok(Math.abs(ribbon._color[0] * 2 - ribbon._color[1] * 2.1) < 0.02 && Math.abs(ribbon._color[0] * 2 - ribbon._color[2] * 2.2) < 0.02, 'neutral grey: ' + ribbon._color);
      const grown = { ...busRails, target: { ...busRails.target, seq: 4 } };
      busFrame(b, ws, 1, { rails: grown });
      const nodes = find(model, n => n.limb && Math.abs(n.limb[2] - BV.PULSE_R) < 1e-12 && !n.ignore);
      assert.equal(nodes.length, 2);
      const calls = { color: 0, opacity: 0 };
      for (const n of nodes) { const c = n.color.bind(n), o = n.opacity.bind(n); n.color = (...a) => { calls.color++; return c(...a); }; n.opacity = (...a) => { calls.opacity++; return o(...a); }; }
      const alphas = new Set();
      for (let i = 1; i <= 40; i++) { busFrame(b, ws, 1 + i / 72, { rails: grown }); alphas.add(nodes[0]._opacity); }
      assert.equal(calls.color, 0, 'no colour call while it moves and fades');
      assert.ok(calls.opacity > 0);
      busFrame(b, ws, 1.7, { rails: grown }); busFrame(b, ws, 1.8, { rails: { ...grown, target: { ...grown.target, seq: 5 } } });
      const later = find(model, n => n.limb && Math.abs(n.limb[2] - BV.PULSE_R) < 1e-12 && !n.ignore);
      assert.equal(later.length, 4, 'two more pulses'); assert.ok(later.every(n => n._color), 'and the new ones are coloured');
   }));

   await check('bus3d: a card that is unplugged neither takes nor sends a pulse; a new workspace places every plug again', () => withClay(() => {
      const model = new FNode(), b = B3.createBus(model);
      const up = { unplugged: ['ball'] }, grown = { ...busRails, target: { ...busRails.target, seq: 4 } };
      busFrame(b, ws, 0, up); busFrame(b, ws, 1, { ...up, rails: grown });
      assert.equal(b.stats.pulses.shown, 1, 'only spin takes it');
      const gone = new B3.createBus(new FNode());
      busFrame(gone, ws, 0, { unplugged: ['osc'] }); busFrame(gone, ws, 1, { unplugged: ['osc'], rails: grown });
      assert.equal(gone.stats.pulses.shown, 0, 'osc is off the bus: nothing is published');
      const before = bus3(model, /^railsBusPlug_/).filter(n => !n.ignore).map(n => n.matrix.slice());
      busFrame(b, ws2, 2, up);
      const after = bus3(model, /^railsBusPlug_/).filter(n => !n.ignore).map(n => n.matrix.slice());
      assert.equal(after.length, 4); assert.notDeepEqual(after, before, 'the plugs moved with the workspace');
      const p = L.plugWorld(ws2, 0);
      assert.ok(after.some(m => Math.abs(m[13] - p[1]) < 1e-9 && Math.abs(m[12] - p[0]) < 0.02), 'at the new plugCell');
   }));

   await check('bus3d: the demo draws at most 30 nodes (bus, plugs, lines, dots, pulses) and a frame in which nothing changed does no node work', () => withClay(() => {
      const model = new FNode(), b = B3.createBus(model);
      const o = { rails: { ...busRails } };
      busFrame(b, ws, 0, o);
      busFrame(b, ws, 1, { rails: { ...busRails, target: { ...busRails.target, seq: 4 }, planted: { ...busRails.planted, seq: 5 } } });
      const nodes = b.stats.drawn;
      console.log('  nodes drawn in the demo (4 cards, 3 pulses):', nodes, JSON.stringify(b.stats.pulses));
      assert.ok(nodes <= 30 && nodes >= 13, 'drawn: ' + nodes);
      busFrame(b, ws, 5, o);                                                // (the pulses are over)
      assert.equal(b.stats.pulses.shown, 0);
      const quiet = busView(), same = new FNode(); same.children = [];
      const before = ops, drawnBefore = b.stats.drawn;
      for (let i = 0; i < 120; i++) b.update(ws, quiet, 6 + i / 60);
      assert.equal(ops - before, 0, 'nothing changed: no node call at all');
      assert.equal(b.stats.drawn, drawnBefore);
      // (A slot's state object is new every frame in the IDE: still nothing to do.)
      const again = () => ({ ...quiet, slots: quiet.slots.map(s => s && { ...s, state: { ...s.state } }) });
      const before2 = ops; for (let i = 0; i < 120; i++) b.update(ws, again(), 20 + i / 60);
      assert.equal(ops - before2, 0, 'equal slots: nothing to do');
      // A card that goes unplugged does work, once.
      const before3 = ops; busFrame(b, ws, 30, { unplugged: ['osc'] }); const once = ops - before3; busFrame(b, ws, 31, { unplugged: ['osc'] });
      assert.ok(once > 0 && ops - before3 === once, 'a change is painted once');
   }));

   await check('bus3d: dispose frees every mesh and takes the root out of the model', () => withClay(({ meshes }) => {
      const model = new FNode(), b = B3.createBus(model);
      busFrame(b, ws, 0); busFrame(b, ws, 1, { rails: { ...busRails, target: { ...busRails.target, seq: 4 } } });
      const names = () => Object.getOwnPropertyNames(meshes).filter(n => /^railsBus/.test(n));
      assert.ok(names().length >= 4, 'ribbon, plug, dot, ring: ' + names());
      b.dispose();
      assert.deepEqual(names(), []); assert.equal(model.children.length, 0);
   }));

   // ---- the bus window: what it draws (busWindowDraw.js, on a recording context) and its canvas (busWindowView.js) ----

   const BW = await load('js/scenes/rails/busWindow.js');
   const BD = await load('js/scenes/rails/busWindowDraw.js');
   const { WIN } = BW;
   const mkRow = (id, o = {}) => ({ id, kind: 'state', type: 'num', value: '1.5', rate: null, pubs: [], takers: [], stale: false, contested: false, builtin: false, ...o });
   const winRows = [
      mkRow('alpha', { value: '0.25', rate: 12.3, pubs: ['osc'], takers: ['ball', 'spin'] }),
      mkRow('beta', { kind: 'event', value: '', rate: 2, pubs: ['osc'], takers: [] }),
      mkRow('gamma', { value: '"hello"', stale: true, type: 'str' }),
      mkRow('delta', { value: '3', contested: true, pubs: ['osc', 'echo'], takers: ['ball'] }),
      mkRow('eps', { value: '1' }),
      mkRow('gaze_hit', { type: 'vec3', value: '[0.1, 0, 0.3]', builtin: true, pubs: ['gaze'], takers: ['ball'] }),
   ];
   const winInputs = [
      { port: 'target', variable: 'target', isDefault: true, bound: true, reason: null, pending: false },
      { port: 'speed', variable: 'knob', isDefault: false, bound: false, reason: 'waiting: no such variable', pending: false },
      { port: 'mode', variable: 'alpha', isDefault: false, bound: false, reason: 'incompatible: num here', pending: false },
      { port: 'go', variable: 'beta', isDefault: false, bound: true, reason: null, pending: true },
   ];
   const winBus = (o = {}) => ({ open: true, frameYaw: 0, card: { name: 'ball', unplugged: false }, header: { title: 'BUS · 6 variables', at: null }, filter: '', section: 'vars',
      inputs: winInputs, moreInputs: 0, rows: winRows, selected: { section: 'vars', port: 'target', variable: 'beta' }, hover: null, footer: null, scroll: 0, ...o });
   const drawWin = bus => { const ctx = fakeCtx(); BD.drawBusWindow(ctx, bus); return ctx.calls; };
   const says = (calls, text) => calls.filter(c => c.op === 'fillText' && c.args[0] === text);
   const sayInside = (calls, re) => calls.filter(c => c.op === 'fillText' && re.test(c.args[0]));
   const rowTop = i => WIN.varsTop + i * WIN.rowH, inTop = i => WIN.inputsTop + i * WIN.rowH;
   const dimOfRow = (calls, i) => onRow(calls, rowTop(i)).find(c => /^(event|state) /.test(c.args[0])).fillStyle;
   const onRow = (calls, top) => calls.filter(c => c.op === 'fillText' && c.args[2] >= top && c.args[2] < top + WIN.rowH);

   await check('the window draws on WIN: an opaque background, 1024 x 640, every font at least 22 px, every text inside the canvas', () => {
      const calls = drawWin(winBus());
      const first = calls.find(c => c.op === 'fillRect');
      assert.deepEqual(first.args, [0, 0, 1024, 640], 'the whole canvas is painted first');
      assert.match(first.fillStyle, /^#[0-9a-f]{6}$/i, 'an opaque colour, not a translucent one');
      assert.deepEqual(WIN.px, [1024, 640]);
      const texts = calls.filter(c => c.op === 'fillText');
      assert.ok(texts.length > 30);
      for (const c of texts) {
         assert.ok(Number(/(\d+)px/.exec(c.font)[1]) >= 22, `${c.args[0]} is in ${c.font}`);
         assert.ok(c.args[1] >= 0 && c.args[1] <= 1024 && c.args[2] > 0 && c.args[2] < 640, `${c.args[0]} is on the canvas`);
      }
      assert.doesNotThrow(() => drawWin({ open: false }));
   });

   await check('the header: BUS and the number of variables, the filter being typed, `at` while paused', () => {
      let calls = drawWin(winBus());
      const title = says(calls, 'BUS · 6 variables')[0];
      assert.ok(title && title.args[2] < WIN.header, 'the title is in the header band');
      assert.ok(!sayInside(calls, /^at /).length, 'live: no `at`');
      assert.ok(calls.some(c => c.op === 'fillText' && c.args[0] === 'type to filter' && c.args[2] < WIN.header), 'an empty filter says what to do');
      calls = drawWin(winBus({ filter: 'al', header: { title: 'BUS · 6 variables', at: 'at −3.2 s' } }));
      assert.ok(sayInside(calls, /^\/al/).some(c => c.args[2] < WIN.header), 'the filter text is in the header');
      const at = says(calls, 'at −3.2 s')[0];
      assert.ok(at && at.args[2] < WIN.header && at.textAlign === 'right', 'paused: `at −3.2 s` at the right');
      assert.equal(says(drawWin(winBus({ header: { title: 'BUS · 1 variable', at: null } })), 'BUS · 1 variable').length, 1);
   });

   await check('the inputs: a row each at WIN.inputsTop, port <- variable, default dim, use bright, waiting amber, incompatible red, pending, plug state, +N more', () => {
      const calls = drawWin(winBus({ moreInputs: 3, selected: { section: 'vars', port: 'go', variable: 'beta' } }));
      const row = i => onRow(calls, inTop(i)).map(c => c.args[0]).join(' ');
      assert.match(row(0), /target.*←.*target.*default/); assert.match(row(1), /speed.*←.*knob.*use/);
      assert.match(row(2), /mode.*←.*alpha/); assert.match(row(3), /go.*←.*beta/);
      assert.ok(onRow(calls, inTop(3)).every(c => c.args[2] < WIN.varsLabel), 'the fourth row ends above the variables label');
      const colour = (i, re) => onRow(calls, inTop(i)).find(c => re.test(c.args[0])).fillStyle;
      assert.notEqual(colour(0, /default/), colour(1, /use/), 'default and use look different');
      assert.equal(colour(1, /use/), BD.PAL.use, 'use is highlighted');
      assert.equal(colour(0, /default/), BD.PAL.dim, 'default is dim');
      assert.match(row(1), /waiting/); assert.equal(colour(1, /waiting/), BD.PAL.mark, 'waiting is amber');
      assert.match(row(2), /incompatible/); assert.equal(colour(2, /incompatible/), BD.PAL.error, 'incompatible is red');
      assert.match(row(3), /…|\.\.\.|pending|sending/, 'a use on its way shows');
      assert.ok(says(calls, '+3 more').length === 1 && says(calls, '+3 more')[0].args[2] < WIN.inputsTop, '`+3 more` on the inputs label');
      assert.ok(onRow(calls, WIN.header).some(c => /ball/.test(c.args[0])) , 'the card whose inputs these are is named on the label');
      assert.ok(!sayInside(calls, /^unplugged$/).length);
      const off = drawWin(winBus({ card: { name: 'ball', unplugged: true } }));
      assert.ok(sayInside(off, /^unplugged$/).some(c => c.args[2] < WIN.inputsTop && c.fillStyle === BD.PAL.error), 'the plug state is on the label');
      const none = drawWin(winBus({ card: null, inputs: [], section: 'vars' }));
      assert.ok(sayInside(none, /look at a card/).length === 1, 'no card: it says so');
   });

   await check('the variables: the rows from `scroll`, at most visibleRows, on the exact rows of WIN', () => {
      const many = Array.from({ length: 20 }, (_, i) => mkRow('v' + String(i).padStart(2, '0')));
      const calls = drawWin(winBus({ rows: many, scroll: 4, selected: { section: 'vars', port: null, variable: 'v05' } }));
      for (let i = 0; i < WIN.visibleRows; i++) {
         const t = onRow(calls, rowTop(i));
         assert.ok(t.some(c => c.args[0] === 'v' + String(4 + i).padStart(2, '0')), 'row ' + i + ' is v' + (4 + i));
         assert.ok(t.every(c => c.args[2] >= rowTop(i) && c.args[2] < rowTop(i) + WIN.rowH));
      }
      assert.equal(says(calls, 'v03').length, 0, 'above the scroll: nothing'); assert.equal(says(calls, 'v13').length, 0, 'below the nine rows: nothing');
      assert.ok(calls.some(c => c.op === 'fillRect' && c.args[0] >= 1000 && c.args[1] >= WIN.varsTop && c.args[1] + c.args[3] <= WIN.footerTop && c.args[3] < WIN.visibleRows * WIN.rowH), 'a scroll bar when there are more rows than fit');
      assert.ok(!drawWin(winBus()).some(c => c.op === 'fillRect' && c.args[0] >= 1000 && c.args[2] <= 8 && c.args[1] >= WIN.varsTop && c.args[3] < WIN.visibleRows * WIN.rowH), 'none when they all fit');
      const empty = drawWin(winBus({ rows: [], filter: 'zz', selected: { section: 'vars', port: null, variable: null } }));
      assert.ok(sayInside(empty, /no variable/).length === 1, 'an empty table says so');
   });

   await check('a variable row: name, kind and type, value, rate, publishers to takers; stale amber, contested `!`, built-in marked', () => {
      const calls = drawWin(winBus());
      const row = i => onRow(calls, rowTop(i)).map(c => c.args[0]).join(' ');
      assert.match(row(0), /alpha.*state.*num.*0\.25.*12\.3\/s.*osc.*→.*ball, spin/);
      assert.match(row(1), /beta.*event.*num/); assert.ok(!/\/s.*\/s/.test(row(1)));
      assert.match(row(1), /2(\.0)?\/s/);
      const gamma = onRow(calls, rowTop(2)); assert.match(row(2), /gamma/); assert.match(row(2), /"hello"/);
      for (const c of gamma.filter(c => /gamma|hello/.test(c.args[0]))) assert.equal(c.fillStyle, BD.PAL.mark, c.args[0] + ' is amber');
      assert.notEqual(onRow(calls, rowTop(0)).find(c => /alpha/.test(c.args[0])).fillStyle, BD.PAL.mark);
      assert.ok(says(calls, '!').some(c => c.args[2] >= rowTop(3) && c.args[2] < rowTop(4)), 'contested has a `!` on its row');
      assert.equal(says(calls, '!').length, 1, 'and only that one');
      assert.match(row(3), /osc, echo.*ball/);
      assert.match(row(4), /eps.*1/); assert.ok(!('ghost' in BD.PAL) && !/≠/.test(row(4)), 'one value on the row: the scene is the past, there is no second value');
      assert.match(row(5), /gaze_hit.*vec3/);
      const nm = i => onRow(calls, rowTop(i)).find(c => /^(alpha|gaze_hit)/.test(c.args[0]));
      assert.notEqual(nm(5).fillStyle, nm(0).fillStyle, 'a built-in name looks different from the others');
      const long = drawWin(winBus({ rows: [mkRow('a_very_long_variable_name_of_32chars', { value: '[1.23, 4.56, 7.89, 10.11, 12.13]', pubs: ['one_module', 'two_module', 'three_module', 'four'], takers: ['aaaaaaaa', 'bbbbbbbb'] })] }));
      for (const c of onRow(long, rowTop(0))) assert.ok(c.args.length >= 4 && c.args[3] > 0 && c.args[1] + c.args[3] <= 1024, `${c.args[0]} has a maxWidth that keeps it on the canvas`);
   });

   await check('the selected row and the hovered row look different, in both sections; the active section is marked', () => {
      const fills = (calls, top) => calls.filter(c => c.op === 'fillRect' && c.args[1] === top && c.args[3] === WIN.rowH);
      const strokes = (calls, top) => calls.filter(c => c.op === 'strokeRect' && c.args[1] <= top + 2 && c.args[1] + c.args[3] >= top + WIN.rowH - 2);
      let calls = drawWin(winBus({ hover: { section: 'vars', port: null, variable: 'gamma' } }));
      assert.ok(fills(calls, rowTop(1)).length >= 1, 'the selected row (beta) is filled');
      assert.equal(fills(calls, rowTop(2)).length, 0, 'the hovered row is not filled the same way');
      assert.ok(strokes(calls, rowTop(2)).length >= 1, 'the hovered row is outlined');
      assert.equal(strokes(calls, rowTop(1)).length, 0);
      assert.equal(fills(calls, rowTop(0)).length + strokes(calls, rowTop(0)).length, 0, 'other rows: neither');
      assert.notEqual(fills(calls, rowTop(1))[0].fillStyle, strokes(calls, rowTop(2))[0].strokeStyle);
      // inputs: the selected one filled, the hovered one outlined
      calls = drawWin(winBus({ section: 'inputs', selected: { section: 'inputs', port: 'speed', variable: 'beta' }, hover: { section: 'inputs', port: 'go', variable: null } }));
      assert.ok(fills(calls, inTop(1)).length >= 1 && strokes(calls, inTop(3)).length >= 1 && !fills(calls, inTop(3)).length);
      // the active section: a mark on its label
      const mark = (calls, top) => calls.some(c => c.op === 'fillRect' && c.args[1] === top && c.args[0] <= 8 && c.args[2] <= 10 && c.args[3] >= 20);
      assert.ok(mark(calls, WIN.header) && !mark(calls, WIN.varsLabel), 'inputs active: the mark is on the inputs label');
      calls = drawWin(winBus());
      assert.ok(mark(calls, WIN.varsLabel) && !mark(calls, WIN.header), 'variables active: the mark is on the variables label');
      // the selected variable's row is quieter while the inputs are active
      const sel = (c, top) => fills(c, top)[0] && fills(c, top)[0].fillStyle;
      assert.notEqual(sel(drawWin(winBus()), rowTop(1)), sel(drawWin(winBus({ section: 'inputs', selected: { section: 'inputs', port: 'target', variable: 'beta' } })), rowTop(1)), 'inactive selection is dimmer');
   });

   await check('the footer: a refusal in red, a note, else the help line; at the bottom, below the table', () => {
      let calls = drawWin(winBus());
      const help = 'Tab ↑↓ Enter · Backspace reset · type to filter · Esc';
      assert.ok(says(calls, help).length === 1 && says(calls, help)[0].args[2] >= WIN.footerTop, 'the help line');
      calls = drawWin(winBus({ footer: { text: 'use refused: type mismatch', kind: 'error' } }));
      const err = says(calls, 'use refused: type mismatch')[0];
      assert.ok(err && err.args[2] >= WIN.footerTop && err.fillStyle === BD.PAL.error, 'a refusal is red, in the footer');
      assert.equal(says(calls, help).length, 0, 'it takes the help line\'s place');
      calls = drawWin(winBus({ footer: { text: 'use x y: applies when you resume', kind: 'info' } }));
      const note = says(calls, 'use x y: applies when you resume')[0];
      assert.ok(note && note.args[2] >= WIN.footerTop && note.fillStyle !== BD.PAL.error, 'a note is not red');
      const long = drawWin(winBus({ footer: { text: 'x'.repeat(190), kind: 'error' } })).find(c => c.op === 'fillText' && c.args[2] >= WIN.footerTop);
      assert.ok(long.args[3] > 0 && long.args[3] <= 1024, 'a long message is cut to the width');
   });

   await check('highlightOf: the publishers and takers of the selected variable (of the selected input when the inputs are active), one Set while the bus is the same', () => {
      const b = winBus({ rows: winRows, selected: { section: 'vars', port: 'target', variable: 'alpha' } });
      const hl = BD.highlightOf(b);
      assert.deepEqual([...hl].sort(), ['ball', 'osc', 'spin']);
      assert.equal(BD.highlightOf(b), hl, 'the same object for the same bus');
      assert.equal(BD.highlightOf({ ...b, hover: { section: 'vars', port: null, variable: 'beta' }, footer: { text: 'x', kind: 'info' } }), hl, 'a new bus object with the same selection and the same row: the same Set');
      assert.equal(BD.highlightOf({ ...b, rows: [...winRows] }), hl, 'also when only the rows array is new');
      assert.notEqual(BD.highlightOf({ ...b, selected: { section: 'vars', port: 'target', variable: 'beta' } }), hl, 'another selection: another Set');
      assert.deepEqual([...BD.highlightOf(b)].sort(), ['ball', 'osc', 'spin']);
      const inp = winBus({ section: 'inputs', selected: { section: 'inputs', port: 'mode', variable: 'beta' } });   // the input `mode` takes `alpha`
      assert.deepEqual([...BD.highlightOf(inp)].sort(), ['ball', 'osc', 'spin']);
      assert.equal(BD.highlightOf(winBus({ section: 'inputs', selected: { section: 'inputs', port: 'ghost', variable: 'beta' } })).size, 0, 'an unknown input: none');
      assert.equal(BD.highlightOf({ open: false }).size, 0); assert.equal(BD.highlightOf(null).size, 0);
      assert.equal(BD.highlightOf(winBus({ selected: null })).size, 0);
   });

   await check('BusPaint: the same object is nothing; a new one is painted at once when it matters, else at most 4 times a second live', () => {
      const p = new BD.BusPaint(), b0 = winBus();
      assert.equal(p.changed({ open: false }, 0), false, 'closed: nothing');
      assert.equal(p.changed(b0, 0), true, 'the first one: at once');
      assert.equal(p.changed(b0, 5), false, 'the same object');
      // a new value (rows of another identity): throttled
      const r2 = [mkRow('alpha', { value: '9' }), ...winRows.slice(1)];
      assert.equal(p.changed(winBus({ rows: r2 }), 0.1), false, 'live data within 0.25 s waits');
      assert.equal(p.changed(winBus({ rows: r2 }), 0.26), true, 'and is painted after it');
      let t = 1, lastB = null;
      const now = b => { t += 0.06; lastB = b; return p.changed(b, t); };   // 60 ms after the last
      assert.equal(now(winBus({ rows: r2, section: 'inputs' })), true, 'a change of section: at once');
      assert.equal(now(winBus({ rows: r2, section: 'inputs', filter: 'a' })), true, 'filter');
      assert.equal(now(winBus({ rows: r2, section: 'inputs', filter: 'a', selected: { section: 'inputs', port: 'speed', variable: 'beta' } })), true, 'selection');
      assert.equal(now(winBus({ rows: r2, section: 'inputs', filter: 'a', selected: { section: 'inputs', port: 'speed', variable: 'beta' }, footer: { text: 'x', kind: 'error' } })), true, 'footer');
      assert.equal(now(winBus({ rows: r2, section: 'inputs', filter: 'a', selected: { section: 'inputs', port: 'speed', variable: 'beta' }, footer: { text: 'x', kind: 'error' }, scroll: 2 })), true, 'scroll');
      const cur = lastB;
      assert.equal(p.changed(cur, t + 0.5), false, 'the very same object painted before is not painted again');
      assert.equal(p.changed({ ...cur, hover: { section: 'vars', port: null, variable: 'alpha' } }, t + 0.51), true, 'a hover moved a quarter second after the last paint');
      assert.equal(p.changed({ ...cur, hover: { section: 'vars', port: null, variable: 'beta' } }, t + 0.55), false, 'hover again soon: waits');
      assert.equal(p.changed({ ...cur, hover: { section: 'vars', port: null, variable: 'beta' } }, t + 0.8), true);
      // paused: faster
      const q = new BD.BusPaint(); q.changed(winBus({ header: { title: 'x', at: 'at −1.0 s' } }), 0);
      assert.equal(q.changed(winBus({ header: { title: 'x', at: 'at −1.1 s' } }), 0.12), true, 'paused: 10 times a second');
      assert.equal(q.changed(winBus({ header: { title: 'x', at: 'at −1.2 s' } }), 0.15), false);
      // closing and opening again paints at once
      assert.equal(p.changed({ open: false }, 100), false); assert.equal(p.changed(winBus(), 100.01), true, 'a reopened window is painted at once');
      p.reset(); assert.equal(p.changed(winBus(), 200), true);
   });

   await check('BusPaint caps: a change of the person\'s making waits 50 ms after the last paint (20 a second at most), a hover-only change 100 ms, other changes 250 ms', () => {
      const p = new BD.BusPaint();
      assert.equal(p.changed(winBus(), 0), true);
      const f1 = winBus({ filter: 'a' });
      assert.equal(p.changed(f1, 0.01), false, 'held back');
      assert.equal(p.changed(f1, 0.049), false);
      assert.equal(p.changed(f1, 0.06), true, 'painted once the 50 ms are over: the change was not lost');
      // a key held down: the selection moves every frame at 72 fps for 2 s
      const q = new BD.BusPaint(); let n = 0;
      for (let i = 0; i < 144; i++) if (q.changed(winBus({ selected: { section: 'vars', port: null, variable: 'v' + i } }), i / 72)) n++;
      assert.ok(n >= 35 && n <= 41, 'about 20 a second, not 72: ' + n);
      // the gaze moving over rows
      const h = new BD.BusPaint(), base = winBus();
      h.changed(base, 0);
      assert.equal(h.changed({ ...base, hover: { section: 'vars', port: null, variable: 'alpha' } }, 0.06), false, 'a hover waits 100 ms');
      assert.equal(h.changed({ ...base, hover: { section: 'vars', port: null, variable: 'alpha' } }, 0.11), true);
      let m = 0; const h2 = new BD.BusPaint(); h2.changed(base, 0);
      for (let i = 1; i <= 144; i++) if (h2.changed({ ...base, hover: { section: 'vars', port: null, variable: 'v' + i } }, i / 72)) m++;
      assert.ok(m >= 18 && m <= 21, 'a hover that changes every frame: 10 a second: ' + m);
      // a hover together with a new value is data: 250 ms
      const d = new BD.BusPaint(); d.changed(base, 0);
      const moved = { ...base, rows: [mkRow('alpha', { value: '8' }), ...winRows.slice(1)], hover: { section: 'vars', port: null, variable: 'alpha' } };
      assert.equal(d.changed(moved, 0.15), false); assert.equal(d.changed(moved, 0.26), true);
   });

   await check('the selected row has a lighter dim colour (readable on the fill); a long footer message takes two lines, cut with …', () => {
      const lum = c => { const v = [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16) / 255).map(x => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4)); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; };
      const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
      assert.ok(ratio(BD.PAL.dimSel, BD.PAL.sel) >= 4.5 && ratio(BD.PAL.dimSel, BD.PAL.selDim) >= 4.5, 'dim text on either selected fill: at least 4.5 : 1');
      assert.ok(ratio(BD.PAL.dim, BD.PAL.back) >= 4.5, 'and on the plain background');
      let calls = drawWin(winBus());
      const dimOf = i => onRow(calls, rowTop(i)).find(c => /^(event|state) /.test(c.args[0])).fillStyle;
      assert.equal(dimOf(1), BD.PAL.dimSel, 'the selected row (beta)'); assert.equal(dimOf(0), BD.PAL.dim, 'another row');
      assert.equal(onRow(calls, rowTop(1)).find(c => /\/s$/.test(c.args[0])).fillStyle, BD.PAL.dimSel, 'its rate too');
      calls = drawWin(winBus({ section: 'inputs', selected: { section: 'inputs', port: 'target', variable: 'beta' } }));
      assert.equal(onRow(calls, inTop(0)).find(c => /default/.test(c.args[0])).fillStyle, BD.PAL.dimSel, 'the selected input row: its dim text');
      assert.equal(dimOfRow(calls, 1), BD.PAL.dimSel, 'the inactive selection too');
      // the footer
      const lines = bus => drawWin(bus).filter(c => c.op === 'fillText' && c.args[2] >= WIN.footerTop);
      assert.equal(lines(winBus({ footer: { text: 'short refusal', kind: 'error' } })).length, 1);
      const msg = 'use refused: ' + 'word '.repeat(30).trim();                 // 13 + 149 characters
      const two = lines(winBus({ footer: { text: msg, kind: 'error' } }));
      assert.equal(two.length, 2, 'two lines');
      assert.ok(two[0].args[2] >= WIN.footerTop && two[1].args[2] > two[0].args[2] && two[1].args[2] < 640 - 8 && two[0].args[2] - 11 >= WIN.footerTop, 'both inside the footer');
      assert.ok(two.every(c => c.fillStyle === BD.PAL.error && Number(/(\d+)px/.exec(c.font)[1]) >= 22 && c.args[3] > 0));
      assert.ok(two[0].args[0].length <= 74 && !two[0].args[0].endsWith(' '), 'cut at a space');
      assert.ok(two[1].args[0].endsWith('…') && two[1].args[0].length <= 74, 'the second line is cut with …');
      const full = lines(winBus({ footer: { text: 'a '.repeat(30).trim(), kind: 'info' } }));
      assert.equal(full.length, 1, 'what fits on one line stays on one');
      assert.equal(lines(winBus({ footer: { text: 'x'.repeat(200), kind: 'error' } })).length, 2);
   });

   await check('createBusWindowView: one 1024 x 640 canvas, painted and uploaded at creation; hidden while closed; placed at its frame; repaints on change only', () => withCanvasScene('js/scenes/rails/busWindowView.js', ({ M, TNode, log, owned, counter, texture }) => {
      const node = new TNode(), view = M.createBusWindowView(node, { owned, now: () => 0 });
      assert.deepEqual(log.filter(l => /^(canvas|setTxtr|upload)/.test(l)), ['canvas true 1024 640', 'setTxtr true true', 'upload true']);
      assert.deepEqual(owned.map(o => [o.channel, o.texture]), [[6, texture]]); assert.equal(counter(), 0);
      const face = node.children[0]; assert.deepEqual(face.scl, [0.45, 0.28, 1]); assert.equal(face.ignore, true, 'hidden');
      const wsA = { origin: [0, 1.6, 0], yaw: 0, eyeY: 1.6 };
      const closed = { open: false, frameYaw: 0, rows: [], inputs: [] };
      const before = ops; view.update(closed, wsA, 0); view.update(closed, wsA, 1); assert.equal(ops, before, 'closed: no work'); assert.equal(counter(), 0);
      assert.equal(face.ignore, true);
      const b1 = winBus({ frameYaw: 0.3 });
      view.update(b1, wsA, 1);
      assert.equal(face.ignore, false, 'shown'); assert.equal(counter(), 1, 'painted at once when it opens'); assert.equal(view.stats.painted, 1);
      const m = L.busWindowFrame(wsA, 0.3); node.matrix.forEach((x, i) => assert.ok(Math.abs(x - m[i]) < 1e-12, 'the frame, element ' + i));
      globalThis.window._canvas_txtr[6].counter = 0;
      const n = ops; view.update(b1, wsA, 1.1); view.update(b1, wsA, 3); assert.equal(ops, n, 'the same bus object: nothing'); assert.equal(counter(), 0);
      const b2 = winBus({ frameYaw: 0.3, rows: [mkRow('alpha', { value: '7' })] });
      view.update(b2, wsA, 1.2); assert.equal(counter(), 0, 'a data change within 0.25 s waits'); assert.equal(view.stats.painted, 1);
      view.update(b2, wsA, 1.3); assert.equal(counter(), 1, 'and is painted after it (the same object, the next frame)'); assert.equal(view.stats.painted, 2);
      globalThis.window._canvas_txtr[6].counter = 0;
      const b3 = winBus({ frameYaw: 0.3, rows: b2.rows, filter: 'q' });
      view.update(b3, wsA, 1.36); assert.equal(counter(), 1, 'a filter is painted at once (20 times a second at the most)');
      globalThis.window._canvas_txtr[6].counter = 0;
      const wsB = { origin: [0, 1.6, 0], yaw: 1, eyeY: 1.6 };
      view.update(b3, wsB, 1.4); assert.equal(counter(), 0, 'a new workspace moves the quad and repaints nothing');
      const mB = L.busWindowFrame(wsB, 0.3); node.matrix.forEach((x, i) => assert.ok(Math.abs(x - mB[i]) < 1e-12));
      view.update(closed, wsB, 2); assert.equal(face.ignore, true, 'closed again: hidden');
      const b4 = winBus({ frameYaw: 0.3, rows: b2.rows, filter: 'q' });
      view.update(b4, wsB, 2.01); assert.equal(face.ignore, false); assert.equal(counter(), 1, 'opened again: painted at once');
      assert.doesNotThrow(() => { view.update(null, wsB, 3); view.update({ open: true }, wsB, 4); view.update(b4, null, 5); view.update(undefined, undefined, 6); });
      view.dispose(); assert.equal(node.children.length, 0);
   }));

   // ---- the gaze cursor ----

   const Rt = await load('js/scenes/rails/reticle.js');
   const norm3 = v => Math.hypot(v[0], v[1], v[2]);
   const gz = (o = {}) => { const ray = o.ray || { o: [0, 1.6, 0], d: unit3([0.1, -0.1, -1]) }, dist = o.dist ?? 1.25;
      return { gaze: { point: ray.o.map((x, i) => x + ray.d[i] * dist), dist, kind: 'card', progress: 0, holding: false, plug: null, ...(o.g || {}) }, ray }; };
   // A node that records which methods were called on it.
   const calls = new Set();
   class SNode extends FNode {
      add(f) { calls.add('add'); const c = new SNode(f); this.children.push(c); return c; }
      setMatrix(m) { calls.add('setMatrix'); return super.setMatrix(m); }
      color(c) { calls.add('color'); return super.color(c); }
      opacity(o) { calls.add('opacity'); return super.opacity(o); }
      move(...a) { calls.add('move'); return super.move(...a); } scale(...a) { calls.add('scale'); return super.scale(...a); } identity() { calls.add('identity'); return super.identity(); }
      remove(n) { calls.add('remove'); return super.remove(n); }
   }
   const drawnOf = n => (n.ignore ? 0 : (n.form ? 1 : 0) + n.children.reduce((a, c) => a + drawnOf(c), 0));

   await check('reticle: three drawn nodes at most, from meshes made once; nothing drawn without a gaze', () => withClay(({ meshes, solids }) => {
      const model = new FNode(), r = Rt.createReticle(model);
      assert.equal(r.stats.drawn, 0, 'nothing before the first gaze');
      const made = Object.keys(solids).length; assert.ok(made >= 3 && made <= 3, 'three small meshes, made when the reticle is: ' + made);
      let { gaze, ray } = gz(); r.update(gaze, ray);
      assert.ok(r.stats.drawn >= 1 && r.stats.drawn <= 3, 'at most 3 drawn nodes: ' + r.stats.drawn); assert.equal(drawnOf(model), r.stats.drawn);
      assert.equal(Object.keys(solids).length, made, 'no mesh made while it is drawn');
      r.update(null, null); assert.equal(r.stats.drawn, 0, 'no gaze, no cursor'); assert.equal(drawnOf(model), 0);
      r.update(gaze, ray); assert.equal(drawnOf(model), r.stats.drawn);
      const forms = find(model, n => !!n.form).map(n => n.form); assert.ok(forms.every(f => /^railsReticle/.test(f)), 'its meshes are named railsReticle*: ' + forms);
      r.dispose(); assert.equal(Object.getOwnPropertyNames(meshes).filter(k => /^railsReticle/.test(k)).length, 0, 'meshes freed'); assert.equal(model.children.length, 0);
   }));

   await check('reticle: it is where the gaze is, faces the eye, and looks 0.6 degrees across at any distance (a plug grows it)', () => withClay(() => {
      const model = new FNode(), r = Rt.createReticle(model), eye = [0, 1.6, 0];
      const nodes = () => find(model, n => !!n.form && !n.ignore);
      const outer = Rt.RETICLE.outline[1];
      for (const [dist, tilt] of [[1.25, [0.1, -0.1, -1]], [0.5, [0.45, -0.45, -0.1]], [3.0, [-0.5, 0.2, -1]], [0.2, [0, -1, -0.3]]]) {
         const { gaze, ray } = gz({ dist, ray: { o: eye, d: unit3(tilt) } });
         r.update(gaze, ray);
         assert.equal(nodes().length, r.stats.drawn);
         for (const n of nodes()) {
            const m = n.matrix, pos = [m[12], m[13], m[14]], off = pos.map((v, i) => v - gaze.point[i]);
            assert.ok(norm3(off) < 0.05 * dist && off.reduce((a, v, i) => a + v * ray.d[i], 0) < 0, `a little nearer the eye than the surface: dist ${dist}`);
            assert.ok(Math.abs(norm3([m[0], m[1], m[2]]) - norm3([m[4], m[5], m[6]])) < 1e-9, 'round, not oval');
            assert.ok(Math.abs(m[8] * -ray.d[0] + m[9] * -ray.d[1] + m[10] * -ray.d[2]) / norm3([m[8], m[9], m[10]]) > 0.999999, 'faces the eye');
            assert.ok(Math.abs(m[0] * m[4] + m[1] * m[5] + m[2] * m[6]) < 1e-9 && Math.abs(m[0] * m[8] + m[1] * m[9] + m[2] * m[10]) < 1e-9, 'a rotation and a scale');
         }
         const big = nodes().reduce((a, n) => (norm3([n.matrix[0], n.matrix[1], n.matrix[2]]) > norm3([a.matrix[0], a.matrix[1], a.matrix[2]]) ? n : a));
         const s = norm3([big.matrix[0], big.matrix[1], big.matrix[2]]), d = norm3([big.matrix[12] - eye[0], big.matrix[13] - eye[1], big.matrix[14] - eye[2]]);
         const across = deg(2 * Math.atan(s * outer / d));
         assert.ok(Math.abs(across - 0.6) < 0.01, `${across} degrees across at ${dist} m`);
      }
      // on a plug: grown
      const { gaze, ray } = gz({ g: { kind: 'plug', plug: 2 } }), flat = gz({ g: { kind: 'bus' } });
      r.update(flat.gaze, flat.ray); const w0 = norm3(nodes()[0].matrix.slice(0, 3));
      r.update(gaze, ray); const w1 = norm3(nodes()[0].matrix.slice(0, 3));
      assert.ok(w1 > w0 * 1.4 && w1 < w0 * 2.2, `the ring grows on a plug: ${w1 / w0}`);
      r.dispose();
   }));

   await check('reticle: progress fills the centre, holding is solid, the colour follows the kind; a frame does only matrix, colour and opacity calls', () => withClay(() => {
      const model = new SNode(), r = Rt.createReticle(model);
      const centre = () => { const ns = find(model, n => !!n.form && !n.ignore); return ns[ns.length - 1]; };
      const size = n => (n ? norm3(n.matrix.slice(0, 3)) : 0);
      let a = gz({ g: { kind: 'card', progress: 0 } }); r.update(a.gaze, a.ray); const s0 = size(centre());
      a = gz({ g: { kind: 'card', progress: 0.5 } }); r.update(a.gaze, a.ray); const s5 = size(centre());
      a = gz({ g: { kind: 'card', progress: 1 } }); r.update(a.gaze, a.ray); const s1 = size(centre());
      assert.ok(s0 < s5 && s5 < s1, `the centre fills: ${s0} < ${s5} < ${s1}`);
      a = gz({ g: { kind: 'bus', holding: true, plug: 2 } }); r.update(a.gaze, a.ray); assert.ok(Math.abs(size(centre()) - s1) / s1 < 0.02, 'holding: as full as the full dwell');
      const colourOf = k => { const x = gz({ g: { kind: k } }); r.update(x.gaze, x.ray); const ns = find(model, n => !!n.form && !n.ignore); return JSON.stringify(ns[1]._color); };
      const cs = ['card', 'plug', 'bus', 'window', null].map(colourOf);
      assert.notEqual(cs[0], cs[1]); assert.notEqual(cs[1], cs[2]); assert.notEqual(cs[0], cs[2]); assert.equal(cs[3], cs[4], 'window and nothing look alike');
      const dark = find(model, n => !!n.form && !n.ignore)[0]._color; assert.ok(dark[0] < 0.3 && dark[1] < 0.3, 'the outline is dark: ' + dark);
      // Frames: the head moves, the state changes now and then; no node is made, moved by a call other than setMatrix, or removed.
      calls.clear();
      const kinds = ['card', 'plug', 'bus', 'window', 'desk', null];
      for (let i = 0; i < 200; i++) { const x = gz({ dist: 0.5 + (i % 7) * 0.2, ray: { o: [0, 1.6, 0], d: unit3([Math.sin(i / 9), -0.2 + Math.cos(i / 5) * 0.1, -1]) }, g: { kind: kinds[Math.floor(i / 11) % 6], progress: (i % 11) / 11, holding: i % 50 > 40 } }); r.update(x.gaze, x.ray); }
      assert.deepEqual([...calls].filter(c => !['setMatrix', 'color', 'opacity'].includes(c)), [], 'only matrix, colour and opacity: ' + [...calls]);
      const x = gz(); r.update(x.gaze, x.ray); calls.clear(); r.update(x.gaze, x.ray);
      assert.ok(!calls.has('color') && !calls.has('opacity'), 'the same state again: no colour call, only the matrices');
      r.update(null, null); r.dispose();
   }));

   await check('bus3d: the plug under the gaze is highlighted (bigger, another colour) and named in the stats; it goes back when the gaze leaves', () => withClay(() => {
      const model = new FNode(), b = B3.createBus(model);
      const plugs = () => bus3(model, /^railsBusPlug_/).filter(n => !n.ignore);
      const size = n => norm3(n.matrix.slice(0, 3));
      const upd = (t, gaze) => b.update(ws, { ...busView(), gaze }, t);
      upd(0, null); const base = plugs().map(n => [size(n), JSON.stringify(n._color)]);
      assert.equal(b.stats.targeted, null); assert.equal(new Set(base.map(x => x[1])).size, 1, 'all alike');
      upd(1, { point: [0, 0, 0], dist: 1, kind: 'plug', progress: 0, holding: false, plug: 1 });
      let p = plugs(); assert.equal(b.stats.targeted, 'ball');
      assert.ok(size(p[1]) > base[1][0] * 1.3, 'bigger'); assert.notEqual(JSON.stringify(p[1]._color), base[1][1], 'another colour');
      for (const i of [0, 2, 3]) { assert.equal(size(p[i]), base[i][0]); assert.equal(JSON.stringify(p[i]._color), base[i][1]); }
      const at = p[1].matrix[12]; assert.ok(Math.abs(at - L.frameMatrix(ws, rad(L.SLOTS[1]), 0, 1.25)[12]) < 0.02, 'still at its place');
      upd(2, { point: [0, 0, 0], dist: 1, kind: 'plug', progress: 0, holding: false, plug: 3 });
      p = plugs(); assert.equal(b.stats.targeted, 'echo'); assert.equal(size(p[1]), base[1][0], 'the first is back'); assert.ok(size(p[3]) > base[3][0] * 1.3);
      upd(3, { point: [0, 0, 0], dist: 1, kind: 'card', progress: 0, holding: false, plug: null });
      p = plugs(); assert.equal(b.stats.targeted, null); assert.deepEqual(p.map(n => [size(n), JSON.stringify(n._color)]), base);
      upd(4, { plug: 9 }); assert.equal(b.stats.targeted, null, 'a slot with no card is nothing to highlight');
      assert.doesNotThrow(() => { upd(5, 7); upd(6, { plug: 'x' }); });
      // A frame that changes nothing touches no node.
      upd(7, { point: [0, 0, 0], dist: 1, kind: 'plug', progress: 0, holding: false, plug: 2 }); const n0 = ops; upd(8, { point: [0, 0, 1], dist: 1, kind: 'plug', progress: 0.3, holding: false, plug: 2 });
      assert.equal(ops, n0, 'the cursor moving does not touch the plugs');
   }));

   await check('createIde: dispose gives back every node and every rails*/railsText* mesh (and the texture list stays the scene\'s)', async () => {
      const gl = { TEXTURE0: 100, TEXTURE_2D: 3, TEXTURE_BINDING_2D: 1, ACTIVE_TEXTURE: 2, RGBA: 4, UNSIGNED_BYTE: 5, activeTexture() {}, getParameter: () => ({}), texImage2D() {} };
      const canvas = () => ({ context: fakeCtx(), _animate: false });
      let unit = 0;
      class TNode extends FNode {
         add(f) { const c = new TNode(f); this.children.push(c); return c; }
         setTxtr(src) { this._txtr = ++unit; globalThis.window._canvas_txtr[unit] = { src, counter: 1 }; return this; }
      }
      const stub = 'data:text/javascript,' + encodeURIComponent('export function G2(a, w, h) { const c = globalThis.__makeCanvas(a, w, h); this.getCanvas = () => c; this.getContext = () => c.context; }');
      const saved = { window: globalThis.window, make: globalThis.__makeCanvas, nav: Object.getOwnPropertyDescriptor(globalThis, 'navigator') };
      globalThis.window = { clay: { gl }, _canvas_txtr: [] };
      globalThis.__makeCanvas = canvas;
      try {
         const I = await load('js/scenes/rails/ide.js', { '../../util/g2.js': stub });
         await withClay(async ({ meshes }) => {
            globalThis.window.clay = { ...globalThis.clay, gl };
            const model = new TNode(), owned = [], handlers = {};
            const link = { peer: null, on(t, fn) { (handlers[t] ||= []).push(fn); return link; }, sendCmd: () => true, sendDev: () => true };
            const ide = I.createIde({ model, link, owned });
            ide.setActive(true);
            const head = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 1.6, 0, 1];
            ide.frame(head, [], []);
            const names = () => Object.getOwnPropertyNames(meshes).filter(n => /^rails/.test(n));
            assert.ok(names().length > 0, 'the bus has meshes while the IDE lives: ' + names().length);
            assert.ok(names().every(n => /^rails(Bus|Reticle)/.test(n)), 'and the old rails renderer is not made: ' + names());
            assert.equal(ide.test.bus.drawn, 1, 'the bus, with no card yet');
            assert.ok(ide.test.reticle.drawn >= 1 && ide.test.reticle.drawn <= 3, 'the gaze cursor: at most 3 drawn nodes: ' + ide.test.reticle.drawn);
            assert.ok(ide.test.view.gaze && ide.test.view.gaze.point.every(Number.isFinite), 'the view carries the gaze the cursor is drawn from');
            assert.equal(owned.length, 7, 'five cards, the strip and the bus window');
            assert.equal(typeof ide.recentre, 'function');
            // The bus window: hidden until it is opened (Mod+B), one canvas of the seven; the cards that touch the selected variable are framed.
            assert.deepEqual(ide.test.busWindow, { painted: 0, shown: false });
            const keyDown = (key, mods = {}) => { for (const d of ['down', 'up']) for (const fn of handlers.in || []) fn({ ev: { k: 'key', d, key, code: 'K' + key, mods: { c: false, a: false, s: false, m: false, ...mods }, rep: false } }); };
            for (const fn of handlers.pair || []) fn({});
            const mod = (id, ports) => ({ ver: 1, status: 'ok', error: null, editError: null, ports, draw: [], logs: [], calls: 5, source: 'x' });
            const rail = (pubs, subs) => ({ kind: 'state', type: 'any', seq: 1, pubs, subs });
            for (const fn of handlers.snap || []) fn({ snap: { rev: 1, t: 0, paused: false, playhead: null, window: [0, 10], geometry: { cards: { alpha: { slot: 2 }, beta: { slot: 3 }, gamma: { slot: 1 } } },
               vars: ['out', 'zed'], uses: {}, unplugged: [], rails: { out: rail([['alpha', 'out']], [['beta', 'in']]), zed: rail([], []) },
               modules: { alpha: mod('alpha', [{ name: 'out', dir: 'out', kind: 'state', type: 'any', rail: 'out' }]), beta: mod('beta', [{ name: 'in', dir: 'in', kind: 'state', type: 'any', rail: 'out' }]), gamma: mod('gamma', []) }, notices: [] } });
            ide.frame(head, [], []);
            assert.equal(ide.test.busWindow.shown, false, 'closed');
            // A marked card has a 5 mm frame of its own outside the others (a card the gaze rests on has a 2 mm one, and the focused one 6 mm).
            const isMarked = slot => model.children[0].children[slot].children.slice(12, 16).every(q => q.ignore === false);
            assert.ok([1, 2, 3].every(i => !isMarked(i)), 'no card is marked while the window is closed');
            keyDown('b', { c: true });
            ide.frame(head, [], []);
            assert.equal(ide.test.busWindow.shown, true, 'Mod+B opens the window'); assert.equal(ide.test.busWindow.painted, 1, 'painted once');
            assert.equal(owned.length, 7, 'and it is not another canvas');
            keyDown('ArrowDown'); ide.frame(head, [], []);                   // the selection goes from `out` to `zed`: nothing touches it
            assert.ok([1, 2, 3].every(i => !isMarked(i)));
            keyDown('ArrowUp'); ide.frame(head, [], []);                      // `out`: alpha publishes it and beta takes it, gamma does not
            assert.ok(isMarked(2) && isMarked(3), 'alpha and beta are framed');
            assert.ok(!isMarked(1), 'gamma is not');
            const painted = ide.test.busWindow.painted;
            for (let i = 0; i < 20; i++) ide.frame(head, [], []);
            assert.equal(ide.test.busWindow.painted, painted, 'frames in which nothing changed paint nothing');
            assert.equal(ide.test.view.bus.open, true, 'the browser test reads the last view: the window is open in it');
            keyDown('b', { c: true }); ide.frame(head, [], []);
            assert.equal(ide.test.busWindow.shown, false, 'Mod+B closes it');
            assert.equal(ide.test.view.bus.open, false);
            assert.ok([1, 2, 3].every(i => !isMarked(i)), 'and the frames go');
            ide.setActive(false); ide.dispose();
            assert.deepEqual(names(), [], 'no rails* or railsText* mesh is left');
            assert.equal(owned.length, 7, 'the textures are the scene\'s to give back');
            assert.equal(model.children.length, 0, 'and its root is out of the model');
         });
      } finally { globalThis.window = saved.window; globalThis.__makeCanvas = saved.make; }
   });

   console.log(`${passed} rails view checks passed.`);
})().catch(err => { console.error(err); process.exit(1); });
