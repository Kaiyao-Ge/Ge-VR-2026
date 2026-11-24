// HW10 in Node: every script of the page loads in one vm context that has no document (so a figure file touches the DOM only
// inside its mount), and the shared helpers and each figure's logic are checked without a browser.
// Run: source ~/.nvm/nvm.sh && nvm use 18 && node tests/hw10.test.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const DIR = path.join(__dirname, '..', 'hw10', 'figures');

let passed = 0;
const check = async (name, fn) => { await fn(); passed++; console.log('ok -', name); };

// common.js, story.js and every f<N>-*.js that exists (in number order), in one context with no `document`.
// A file that does not exist yet is skipped: the figures arrive one task at a time.
const loadAll = () => {
   const ctx = vm.createContext({ console });
   const figs = fs.existsSync(DIR) ? fs.readdirSync(DIR).filter(f => /^f\d+-.*\.js$/.test(f))
      .sort((a, b) => parseInt(a.slice(1), 10) - parseInt(b.slice(1), 10)) : [];
   for (const f of ['common.js', 'story.js', ...figs]) {
      const file = path.join(DIR, f);
      if (fs.existsSync(file)) vm.runInContext(fs.readFileSync(file, 'utf8'), ctx, { filename: file });
      else if (f === 'common.js') assert.fail('hw10/figures/common.js is missing');
   }
   return ctx.HW10;
};
module.exports = { loadAll };

(async () => {
   await check('common.js loads with no document', () => {
      const H = loadAll();
      assert.equal(typeof H, 'object');
      assert.equal(typeof H.logic, 'object');       // (figure files fill it in, so only its type is fixed here)
      assert.equal(H.story === null || typeof H.story === 'object', true);
      for (const k of ['register', 'mountAll', 'svg', 'setState', 'time', 'reducedMotion']) assert.equal(typeof H[k], 'function', k);
      // common.js alone, in a fresh context: the namespace starts empty
      const ctx = vm.createContext({ console });
      vm.runInContext(fs.readFileSync(path.join(DIR, 'common.js'), 'utf8'), ctx);
      assert.deepEqual({ ...ctx.HW10.logic }, {});
      assert.deepEqual({ ...ctx.HW10.figures }, {});
      assert.equal(ctx.HW10.story, null);
   });

   await check("HW10.time('14:05') is 845 and HW10.time('00:00') is 0", () => {
      const H = loadAll();
      assert.equal(H.time('14:05'), 845);
      assert.equal(H.time('00:00'), 0);
      assert.equal(H.time('23:59'), 1439);
      assert.throws(() => H.time('noon'));
   });

   await check('HW10.reducedMotion() is false with no matchMedia', () => {
      assert.equal(loadAll().reducedMotion(), false);
   });

   await check('register keeps a mount by name and refuses a non-function', () => {
      const H = loadAll();
      const m = () => {};
      H.register('probe', m);
      assert.equal(H.figures.probe, m);
      assert.throws(() => H.register('bad', 42));
   });

   await check('setState writes a data attribute as a string', () => {
      const H = loadAll();
      const fig = { dataset: {} };
      H.setState(fig, 'step', 3);
      H.setState(fig, 'mode', 'link-down');
      assert.deepEqual({ ...fig.dataset }, { step: '3', mode: 'link-down' });
   });

   await check('story: shape', () => {
      const S = loadAll().story;
      assert.ok(S && typeof S === 'object', 'HW10.story is set by story.js');
      const H = loadAll(), t = H.time;
      // members and seats
      assert.equal(S.members.length, 5);
      assert.deepEqual({ ...S.members[0] }, { id: 'you', name: 'Me' });
      const ids = S.members.map(m => m.id);
      assert.equal(new Set(ids).size, 5, 'member ids are unique');
      for (const m of S.members) assert.ok(typeof m.name === 'string' && m.name, 'a member has a name');
      assert.deepEqual(Object.keys(S.seats).sort(), [...ids].sort());
      for (const id of ids) assert.ok(Array.isArray(S.seats[id]) && S.seats[id].length === 2 && S.seats[id].every(Number.isFinite), 'seat of ' + id);
      // the board
      assert.deepEqual([...S.board.regions], ['left', 'right']);
      const V = S.board.versions;
      assert.ok(V.length >= 4);
      V.forEach((v, i) => {
         assert.equal(v.n, i + 1, 'versions are numbered 1, 2, …');
         assert.ok(S.board.regions.includes(v.region), 'region of version ' + v.n);
         assert.ok(Array.isArray(v.lines) && v.lines.length >= 1 && v.lines.every(l => typeof l === 'string' && l), 'lines of version ' + v.n);
         assert.equal(typeof v.erased, 'boolean');
         t(v.t);
         if (i) assert.ok(t(v.t) >= t(V[i - 1].t), 'versions are in time order');
      });
      assert.deepEqual([...new Set(V.map(v => v.region))].sort(), ['left', 'right']);
      assert.ok(V.some(v => v.erased), 'at least one erased version');
      // the dialogue
      const D = S.dialogue;
      assert.ok(D.length >= 12);
      assert.equal(new Set(D.map(d => d.id)).size, D.length, 'dialogue ids are unique');
      D.forEach((d, i) => {
         assert.ok(ids.includes(d.by), 'speaker of ' + d.id);
         assert.ok(typeof d.text === 'string' && d.text);
         assert.equal(typeof d.mentionsYou, 'boolean');
         if (i) assert.ok(t(d.t) >= t(D[i - 1].t), 'dialogue is in time order');
         if (d.mentionsYou) assert.notEqual(d.by, 'you');
      });
      // your attention
      const A = S.attention.you;
      A.forEach((a, i) => {
         assert.ok(t(a.from) < t(a.to), 'an interval has length');
         assert.ok(a.on === 'laptop' || a.on === 'board-left' || a.on === 'board-right' || ids.includes(a.on) && a.on !== 'you', 'on: ' + a.on);
         if (i) assert.ok(t(a.from) >= t(A[i - 1].to), 'intervals are in order and do not overlap');
      });
      assert.ok(t(A[0].from) <= t(D[0].t) && t(A[A.length - 1].to) >= t(D[D.length - 1].t), 'attention covers the first to the last line');
      const on = at => A.find(a => t(a.from) <= at && at < t(a.to));
      assert.ok(D.some(d => d.mentionsYou && on(t(d.t)) && on(t(d.t)).on === 'laptop'), 'your name is said while you look at the laptop');
      // the minutes
      const M = S.minutes;
      assert.ok(M.length >= 6);
      assert.equal(new Set(M.map(m => m.id)).size, M.length);
      assert.ok(M.filter(m => m.kind === 'decision').length >= 2);
      assert.ok(M.filter(m => m.kind === 'action').length >= 2);
      assert.ok(M.filter(m => m.kind === 'open').length >= 1);
      const dids = new Set(D.map(d => d.id));
      for (const m of M) {
         assert.ok(['decision', 'action', 'open'].includes(m.kind), m.id);
         assert.ok(typeof m.text === 'string' && m.text);
         if (m.kind === 'action') assert.ok(ids.includes(m.owner) && typeof m.due === 'string' && m.due, 'an action has an owner and a due: ' + m.id);
         assert.ok(m.sources && Array.isArray(m.sources.dialogue) && Array.isArray(m.sources.board), 'sources of ' + m.id);
         assert.ok(m.sources.dialogue.length + m.sources.board.length >= 1, 'an item has a source: ' + m.id);
         for (const d of m.sources.dialogue) assert.ok(dids.has(d), `${m.id}: dialogue ${d} resolves`);
         for (const n of m.sources.board) assert.ok(V.some(v => v.n === n), `${m.id}: board version ${n} resolves`);
      }
   });

   await check('f1 attention: sharpRadius draws the 2 degrees to scale', () => {
      const A = loadAll().logic.attention;
      assert.ok(A && typeof A.sharpRadius === 'function' && typeof A.marked === 'function', 'HW10.logic.attention is set by f1-attention.js');
      assert.equal(A.sharpRadius(800), 4);             // 2 of 200 degrees across 800 px: 8 px wide, a radius of 4
      assert.equal(A.sharpRadius(800, 100, 2), 8);
      assert.equal(A.sharpRadius(375), 1.875);
   });

   await check('f1 attention: marked keeps what is outside the sharp spot, in input order', () => {
      const A = loadAll().logic.attention;
      const gaze = { x: 100, y: 100 }, r = 4;
      const objs = [{ id: 'far', x: 400, y: 100 }, { id: 'in', x: 100 + r - 1, y: 100 }, { id: 'out', x: 100, y: 100 + r + 1 }, { id: 'on', x: 100, y: 100 }];
      assert.deepEqual([...A.marked(objs, gaze, r)], ['far', 'out']);
      assert.deepEqual([...A.marked(objs, { x: 400, y: 100 }, r)], ['in', 'out', 'on']);
      assert.deepEqual([...A.marked([], gaze, r)], []);
   });

   await check('f1 attention: blurAt is 0 inside 1 degree, then rises smoothly and monotonically to a ceiling', () => {
      const A = loadAll().logic.attention;
      assert.equal(typeof A.blurAt, 'function', 'blurAt exists');
      assert.equal(A.blurAt(0), 0); assert.equal(A.blurAt(0.5), 0); assert.equal(A.blurAt(1), 0);
      assert.ok(A.blurAt(1.5) > 0, 'it starts to rise past 1 degree');
      assert.ok(A.blurAt(5) <= 1, 'about 10 degrees across stays nearly clear: ' + A.blurAt(5));
      assert.ok(A.blurAt(60) >= 5, 'the far field is fully blurred: ' + A.blurAt(60));
      assert.ok(A.blurAt(200) <= A.SIGMA_MAX && A.blurAt(200) > 0.99 * A.SIGMA_MAX, 'it saturates at SIGMA_MAX');
      let prev = 0;
      for (let e = 0; e <= 120; e += 0.05) {
         const s = A.blurAt(e);
         assert.ok(s >= prev - 1e-12, `monotonic at ${e}`);
         assert.ok(s - prev < 0.02, `continuous at ${e}: ${prev} -> ${s}`);   // at most 0.4 per degree
         prev = s;
      }
      assert.ok(A.blurAt(30) > A.blurAt(15) && A.blurAt(15) > A.blurAt(5), 'still rising out at 30 degrees');
      // concave past 1 degree (an exponential approach to a ceiling): each step out adds less than the one before
      assert.ok(A.blurAt(11) - A.blurAt(1) > A.blurAt(21) - A.blurAt(11) && A.blurAt(21) - A.blurAt(11) > A.blurAt(31) - A.blurAt(21));
   });

   await check('f1 attention: LAYERS is the stack of blurred copies: sharp on top, radii growing, each radius where blurAt reaches the layer sigma', () => {
      const A = loadAll().logic.attention, L = A.LAYERS;
      assert.ok(Array.isArray(L) && L.length >= 6 && L.length <= 8, 'about 6 to 8 layers: ' + (L && L.length));
      assert.equal(L[0].sigma, 0, 'the top layer is sharp');
      for (let i = 1; i < L.length; i++) {
         assert.ok(L[i].sigma > L[i - 1].sigma, 'sigma grows down the stack');
         assert.ok(L[i].rDeg > L[i - 1].rDeg, 'radius grows down the stack');
      }
      for (const l of L) assert.ok(Math.abs(A.blurAt(l.rDeg) - l.sigma) < 0.01, `blurAt(${l.rDeg}) is ${A.blurAt(l.rDeg)}, not ${l.sigma}`);
      assert.ok(L[L.length - 1].sigma >= 5, 'the bottom layer is the far field');
      assert.ok(L[1].sigma <= 1 && L[1].sigma > 0, 'a faint step right outside the centre');
   });

   await check('f2 desk: lastSighting picks the latest entry of that object, and null for an unknown one', () => {
      const D = loadAll().logic.desk;
      assert.ok(D && typeof D.lastSighting === 'function' && typeof D.cueSide === 'function', 'HW10.logic.desk is set by f2-desk.js');
      const log = [{ t: 600, object: 'usb', x: 1, y: 1, by: 'camera' }, { t: 900, object: 'usb', x: 2, y: 2, by: 'camera' },
         { t: 700, object: 'usb', x: 3, y: 3, by: 'camera' }, { t: 950, object: 'keys', x: 4, y: 4, by: 'gaze' }];
      assert.equal(D.lastSighting(log, 'usb').x, 2);       // the latest in time, not the last in the list
      assert.equal(D.lastSighting(log, 'keys').by, 'gaze');
      assert.equal(D.lastSighting(log, 'mug'), null);
      assert.equal(D.lastSighting([], 'usb'), null);
   });

   await check('f2 desk: in DATA the USB drive was last seen by the camera and never by gaze; the keys are in the log too', () => {
      const D = loadAll().logic.desk;
      assert.ok(Array.isArray(D.DATA.objects) && Array.isArray(D.DATA.log));
      assert.equal(D.lastSighting(D.DATA.log, 'usb').by, 'camera');
      assert.equal(D.DATA.log.filter(e => e.object === 'usb' && e.by === 'gaze').length, 0, 'you never looked at the USB drive');
      assert.ok(D.DATA.log.some(e => e.by === 'gaze'), 'there is a gaze trail');
      assert.equal(D.lastSighting(D.DATA.log, 'keys').by, 'camera');
      assert.ok(D.DATA.log.filter(e => e.object === 'usb').length >= 2, 'more than one sighting, so "the latest" matters');
      for (const e of D.DATA.log) assert.ok(Number.isFinite(e.t) && Number.isFinite(e.x) && Number.isFinite(e.y) && (e.by === 'camera' || e.by === 'gaze'));
   });

   await check('f2 desk: cueSide says left, right or ahead, taking the difference around 360 degrees', () => {
      const D = loadAll().logic.desk;
      assert.equal(D.cueSide(350, 10), 'right');
      assert.equal(D.cueSide(10, 350), 'left');
      assert.equal(D.cueSide(0, 14), 'ahead');
      assert.equal(D.cueSide(0, -14), 'ahead');
      assert.equal(D.cueSide(0, 15), 'ahead');
      assert.equal(D.cueSide(0, 16), 'right');
      assert.equal(D.cueSide(0, -16), 'left');
      assert.equal(D.cueSide(0, 180), 'right');
      assert.equal(D.cueSide(90, 0), 'left');
      assert.equal(D.cueSide(350, 340), 'ahead');
   });

   await check('f3 street: ladder keeps quiet when you see it or it is far, then climbs 1..5 at 8, 5, 3.5, 2.5 and 1.5 seconds', () => {
      const S = loadAll().logic.street;
      assert.ok(S && typeof S.ladder === 'function' && typeof S.ttc === 'function' && typeof S.inField === 'function', 'HW10.logic.street is set by f3-street.js');
      assert.equal(S.ladder(9, false), 0);
      assert.equal(S.ladder(Infinity, false), 0);
      assert.equal(S.ladder(8, false), 1);
      assert.equal(S.ladder(5.5, false), 1);
      assert.equal(S.ladder(5, false), 2);
      assert.equal(S.ladder(3.5, false), 3);
      assert.equal(S.ladder(2.5, false), 4);
      assert.equal(S.ladder(1.5, false), 5);
      assert.equal(S.ladder(0.2, false), 5);
      assert.equal(S.ladder(1, true), 0);
      assert.equal(S.ladder(0.1, true), 0, 'seen by you: the AI keeps quiet at any time to contact');
      assert.deepEqual([...S.LEVELS], ['none', 'edge glow', 'directional sound', 'text', 'haptic tap', 'forced overlay']);
   });

   await check('f3 street: ttc is distance over closing speed, and Infinity when nothing is closing', () => {
      const S = loadAll().logic.street;
      assert.equal(S.ttc(10, 5), 2);
      assert.equal(S.ttc(10, 0), Infinity);
      assert.equal(S.ttc(10, -3), Infinity);
   });

   await check('f3 street: inField is true inside the half angle and false outside, around 360 degrees, for the human and the cameras', () => {
      const S = loadAll().logic.street;
      assert.equal(S.HUMAN_HALF, 100);
      assert.equal(S.CAMERA_HALF, 150);
      const at = (obs, deg, r = 10) => ({ x: obs.x + r * Math.sin(deg * Math.PI / 180), y: obs.y + r * Math.cos(deg * Math.PI / 180) });
      const me = { x: 0, y: 0, headingDeg: 0 };
      assert.equal(S.inField(me, S.HUMAN_HALF, at(me, 99)), true);
      assert.equal(S.inField(me, S.HUMAN_HALF, at(me, 101)), false);
      assert.equal(S.inField(me, S.HUMAN_HALF, at(me, -99)), true);
      assert.equal(S.inField(me, S.HUMAN_HALF, at(me, -101)), false);
      assert.equal(S.inField(me, S.CAMERA_HALF, at(me, 130)), true);
      assert.equal(S.inField(me, S.CAMERA_HALF, at(me, 151)), false);
      assert.equal(S.inField(me, S.HUMAN_HALF, at(me, 0)), true);
      const turned = { x: 5, y: -3, headingDeg: 350 };      // the heading counts: 350 degrees is 10 degrees left of straight ahead
      assert.equal(S.inField(turned, S.HUMAN_HALF, at(turned, 89)), true);    // 99 degrees right of the heading
      assert.equal(S.inField(turned, S.HUMAN_HALF, at(turned, 91)), false);   // 101 degrees right of it
      assert.equal(S.inField(turned, S.HUMAN_HALF, at(turned, 251)), true);   // 251 - 350 = -99, 99 degrees left of the heading
      assert.equal(S.inField(turned, S.HUMAN_HALF, at(turned, 249)), false);  // 249 - 350 = -101
   });

   await check('f3 street: along the bicycle path the bicycle is outside my view and inside the cameras, and the level never falls as it nears', () => {
      const S = loadAll().logic.street;
      assert.equal(typeof S.bikeAt, 'function');
      assert.equal(typeof S.levelAt, 'function');
      let last = -1;
      for (let pos = 0; pos <= 100; pos++) {
         const b = S.bikeAt(pos);
         assert.equal(S.inField(S.ME, S.HUMAN_HALF, b), false, `pos ${pos}: outside my view`);
         assert.equal(S.inField(S.ME, S.CAMERA_HALF, b), true, `pos ${pos}: inside the cameras' view`);
         const lv = S.levelAt(pos);
         assert.ok(lv >= last, `pos ${pos}: level ${lv} fell below ${last}`);
         last = lv;
      }
      assert.equal(S.levelAt(0), 0);
      assert.equal(S.levelAt(100), 5);
      const seen = new Set(); for (let pos = 0; pos <= 100; pos++) seen.add(S.levelAt(pos));
      assert.deepEqual([...seen].sort(), [0, 1, 2, 3, 4, 5], 'every step of the ladder is reachable');
   });

   await check('f5 table: transcriberOf is the speaker; nameAlert needs mentionsYou and not attending the speaker', () => {
      const H = loadAll(), T = H.logic.table, D = H.story.dialogue;
      assert.ok(T && typeof T.transcriberOf === 'function' && typeof T.nameAlert === 'function', 'HW10.logic.table is set by f5-table.js');
      for (const line of D) assert.equal(T.transcriberOf(line), line.by);
      const d11 = D.find(l => l.id === 'd11');
      assert.equal(T.nameAlert(d11, 'laptop'), true);
      assert.equal(T.nameAlert(d11, 'tom'), false, 'attending the speaker: silent');
      assert.equal(T.nameAlert(D.find(l => l.id === 'd10'), 'laptop'), false, 'no mention of me: silent');
      assert.equal(T.nameAlert(d11, null), true);
      // from the story: at 14:14 I am on the laptop, so d11 alerts and no other line does
      const alerts = D.filter(l => T.nameAlert(l, T.attendingAt(l.t))).map(l => l.id);
      assert.deepEqual([...alerts], ['d11']);
      assert.equal(T.attendingAt('14:14'), 'laptop');
      assert.equal(T.attendingAt('14:06'), 'board-left');
      assert.equal(T.attendingAt('14:19'), 'ben');
   });

   // A small hand-made story for F7: you watch Ann, then your laptop, then the left half of the board.
   const mini = () => ({
      attention: { you: [{ from: '14:00', to: '14:05', on: 'ann' }, { from: '14:05', to: '14:10', on: 'laptop' }, { from: '14:10', to: '14:15', on: 'board-left' }] },
      dialogue: [{ id: 'a', t: '14:01', by: 'ann' }, { id: 'b', t: '14:06', by: 'ann' }, { id: 'c', t: '14:07', by: 'bo' }, { id: 'e', t: '14:02', by: 'you' }, { id: 'f', t: '14:05', by: 'ann' }],
      board: { regions: ['left', 'right'], versions: [{ n: 1, t: '14:11', region: 'left' }, { n: 2, t: '14:12', region: 'right' }] },
      minutes: [
         { id: 'x1', kind: 'decision', text: 'x1', sources: { dialogue: ['a'], board: [] } },
         { id: 'x2', kind: 'decision', text: 'x2', sources: { dialogue: ['b'], board: [] } },
         { id: 'x3', kind: 'decision', text: 'x3', sources: { dialogue: [], board: [1] } },
         { id: 'x4', kind: 'decision', text: 'x4', sources: { dialogue: [], board: [2] } },
         { id: 'x5', kind: 'open', text: 'x5', sources: { dialogue: ['a'], board: [2] } },
         { id: 'x6', kind: 'open', text: 'x6', sources: { dialogue: ['c'], board: [] } },
         { id: 'x7', kind: 'open', text: 'x7', sources: { dialogue: ['e'], board: [] } },
         { id: 'x8', kind: 'open', text: 'x8', sources: { dialogue: ['f'], board: [] } },
      ],
   });

   await check('f7 minutes: attended() is true only when an interval covers the time with the right target (half-open)', () => {
      const M = loadAll().logic.minutes, S = mini();
      assert.ok(M && ['attended', 'missed', 'sourcesOf'].every(k => typeof M[k] === 'function'), 'HW10.logic.minutes is set by f7-minutes.js');
      assert.equal(M.attended(S, 'you', { t: '14:01', on: 'ann' }), true, 'watching the speaker');
      assert.equal(M.attended(S, 'you', { t: '14:06', on: 'ann' }), false, 'on the laptop, not on the speaker');
      assert.equal(M.attended(S, 'you', { t: '14:01', on: 'bo' }), false, 'watching somebody else');
      assert.equal(M.attended(S, 'you', { t: '14:11', on: 'board-left' }), true, 'the board half I look at');
      assert.equal(M.attended(S, 'you', { t: '14:12', on: 'board-right' }), false, 'the board half I never look at');
      assert.equal(M.attended(S, 'you', { t: '14:05', on: 'ann' }), false, 'an interval ends before its "to"');
      assert.equal(M.attended(S, 'you', { t: '14:05', on: 'laptop' }), true, 'and starts at its "from"');
      assert.equal(M.attended(S, 'you', { t: '14:20', on: 'ann' }), false, 'outside every interval');
      assert.equal(M.attended(S, 'nobody', { t: '14:01', on: 'ann' }), false, 'a member with no attention record');
   });

   await check('f7 minutes: an item is missed when any source was not attended (own words, board and dialogue)', () => {
      const M = loadAll().logic.minutes, S = mini();
      assert.deepEqual([...M.missed(S)], ['x2', 'x4', 'x5', 'x6', 'x8']);
      assert.deepEqual([...M.missed(S, 'you')], [...M.missed(S)], 'who defaults to you');
      // x1: said by the member I was watching; x3: board written while I watched that half: not missed
      for (const id of ['x1', 'x3']) assert.ok(!M.missed(S).includes(id), id);
      // x2: said while I was on my laptop; x4: board region I never watched; x5: one source seen, one not
      for (const id of ['x2', 'x4', 'x5']) assert.ok(M.missed(S).includes(id), id);
      assert.ok(!M.missed(S).includes('x7'), 'what I said myself is not missed');
      assert.deepEqual([...M.missed(S, 'zed')], ['x1', 'x2', 'x3', 'x4', 'x5', 'x6', 'x7', 'x8'], 'a member with no record missed everything');
   });

   await check('f7 minutes: sourcesOf resolves ids to the dialogue lines and board versions, in the item\'s order', () => {
      const M = loadAll().logic.minutes, S = mini();
      const got = M.sourcesOf(S, 'x5');
      assert.deepEqual([...got.dialogue.map(d => d.id)], ['a']);
      assert.deepEqual([...got.board.map(v => v.n)], [2]);
      assert.throws(() => M.sourcesOf(S, 'nope'));
      const R = loadAll(), real = R.logic.minutes.sourcesOf(R.story, 'm5');
      assert.deepEqual([...real.dialogue.map(d => d.id)], ['d9', 'd10', 'd14'], 'd14 says the date: Thursday');
      assert.deepEqual([...real.board.map(v => v.n)], [3, 4]);
   });

   await check('f7 minutes: on the real story some but not all items are missed, and they are the ones the prose names', () => {
      const H = loadAll(), M = H.logic.minutes, n = H.story.minutes.length, miss = [...M.missed(H.story)];
      assert.ok(miss.length >= 1 && miss.length <= n - 1, `missed ${miss.length} of ${n}`);
      assert.ok(miss.every(id => H.story.minutes.some(m => m.id === id)), 'ids are minutes ids');
      assert.deepEqual(miss, [...H.story.minutes.map(m => m.id).filter(id => miss.includes(id))], 'in the order of the minutes');
      // Ben's line while I was at my laptop (d10, the lamp puzzle) and Kaifang's d11: the items built on them are missed
      assert.ok(miss.includes('m5'), 'Ben\'s levels and lamp puzzle: d10 was said while I was at my laptop');
      assert.ok(miss.includes('m7'), 'my own lamp grab: d11 was said while I was at my laptop');
      // the right half of the board was never in my view, so each item written from it is missed
      const rightOnly = H.story.minutes.filter(m => m.sources.board.some(b => H.story.board.versions.find(v => v.n === b).region === 'right'));
      assert.ok(rightOnly.length >= 1 && rightOnly.every(m => miss.includes(m.id)), 'items from the right half are missed');
      assert.ok(!miss.includes('m8'), 'the second headset: said while I was watching Ben');
      assert.ok(!miss.includes('m1'), 'the Lighthouse decision I saw and heard');
   });

   // ---- f9 glasses ----
   const plain = x => JSON.parse(JSON.stringify(x));      // a value made in the vm context, as plain data of this realm

   await check('f9 glasses: PARTS are the seven parts in order, each with a name, a principle and what it adds', () => {
      const G = loadAll().logic.glasses;
      assert.ok(G && G.PARTS && G.PARTS.length === 7, 'HW10.logic.glasses.PARTS is set by f9-glasses.js');
      assert.deepEqual(plain(G.PARTS.map(p => p.id)), ['wide-cameras', 'eye-cameras', 'thermal', 'depth', 'mic-array', 'bone-mic', 'speakers']);
      for (const p of G.PARTS) for (const k of ['name', 'label', 'principle', 'adds']) assert.ok(typeof p[k] === 'string' && p[k].trim().length > (k === 'principle' || k === 'adds' ? 40 : 3), `${p.id}.${k}`);
   });

   await check('f9 glasses: the principles are the ones the page names, and no chapter or page of the book is named', () => {
      const G = loadAll().logic.glasses, by = Object.fromEntries(G.PARTS.map(p => [p.id, p.principle.toLowerCase()]));
      assert.ok(/lens/.test(by['wide-cameras']) && /camera|sensor/.test(by['wide-cameras']));
      assert.ok(/infrared/.test(by['eye-cameras']));
      assert.ok(/infrared|heat/.test(by.thermal));
      assert.ok(/echo/.test(by.depth) && /sonar/.test(by.depth));
      assert.ok(/time/.test(by['mic-array']) && /two (microphones|ears)|ears/.test(by['mic-array']));
      assert.ok(/vibrat|bone|skull/.test(by['bone-mic']));
      assert.ok(/sound|air|cone/.test(by.speakers));
      const all = G.PARTS.map(p => [p.name, p.label, p.principle, p.adds].join(' ')).join(' ');
      assert.ok(!/chapter|\bpage\b|way things work/i.test(all), 'the book is not named in a part');
      assert.ok(!/photo/i.test(all), 'Ruling 3');
      assert.ok(/soldering iron|hot cup/.test(G.PARTS[2].adds), 'thermal: the iron and the cup');
      assert.ok(/name/.test(G.PARTS[4].adds), 'the microphone array hears your name');
      assert.ok(/own|wearer/.test(G.PARTS[5].adds), 'the bone microphone knows the voice is the wearer\'s');
   });

   // ---- the final review ----
   await check('common: attendingAt(attention, t) is the interval with from <= t < to (half-open), or null', () => {
      const H = loadAll();
      assert.equal(typeof H.attendingAt, 'function', 'HW10.attendingAt is set by common.js');
      const list = [{ from: '14:00', to: '14:05', on: 'ann' }, { from: '14:05', to: '14:10', on: 'laptop' }];
      assert.equal(H.attendingAt(list, '14:00').on, 'ann', 'starts at its from');
      assert.equal(H.attendingAt(list, '14:04').on, 'ann');
      assert.equal(H.attendingAt(list, '14:05').on, 'laptop', 'ends before its to');
      assert.equal(H.attendingAt(list, '14:10'), null, 'outside every interval');
      assert.equal(H.attendingAt(list, '13:59'), null);
      assert.equal(H.attendingAt(list, H.time('14:06')).on, 'laptop', 'a time in minutes works too');
      assert.equal(H.attendingAt([], '14:01'), null);
      assert.equal(H.attendingAt(undefined, '14:01'), null);
      assert.equal(H.attendingAt(H.story.attention.you, '14:14').on, 'laptop');
   });

   await check('story: every action item\'s due day is said in one of its source sentences', () => {
      const S = loadAll().story, said = { Mon: 'Monday', Tue: 'Tuesday', Wed: 'Wednesday', Thu: 'Thursday', Fri: 'Friday', Sat: 'Saturday', Sun: 'Sunday' };
      for (const m of S.minutes.filter(x => x.kind === 'action')) {
         const day = said[m.due.slice(0, 3)], texts = m.sources.dialogue.map(id => S.dialogue.find(d => d.id === id).text);
         assert.ok(day && texts.some(t => t.includes(day)), `${m.id} is due ${m.due}: one of its sentences says ${day}: ${texts.join(' | ')}`);
      }
      assert.deepEqual([...S.minutes.find(m => m.id === 'm4').sources.dialogue], ['d8', 'd9', 'd14']);
      assert.deepEqual([...S.minutes.find(m => m.id === 'm5').sources.dialogue], ['d9', 'd10', 'd14']);
   });

   await check('story: nobody writes James\'s job on the board before James says it', () => {
      const H = loadAll(), S = H.story;
      const d13 = S.dialogue.find(d => d.id === 'd13'), v4 = S.board.versions.find(v => v.n === 4);
      assert.ok(v4.lines.some(l => /^James:/.test(l)));
      assert.ok(H.time(d13.t) <= H.time(v4.t), `d13 at ${d13.t}, version 4 at ${v4.t}`);
      assert.ok(S.dialogue.indexOf(d13) > S.dialogue.findIndex(d => d.id === 'd12') && S.dialogue.indexOf(d13) < S.dialogue.findIndex(d => d.id === 'd14'));
   });

   await check('nav.js loads with no document, and pick() names the scene that holds the reading line (or -1)', () => {
      const ctx = vm.createContext({ console });
      vm.runInContext(fs.readFileSync(path.join(DIR, 'common.js'), 'utf8'), ctx);
      vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'hw10', 'nav.js'), 'utf8'), ctx, { filename: 'nav.js' });
      const pick = ctx.HW10.nav.pick, rects = [{ top: 100, bottom: 300 }, { top: 300, bottom: 500 }, { top: 700, bottom: 900 }];
      assert.equal(pick(rects, 50), -1, 'before the first scene');
      assert.equal(pick(rects, 100), 0);
      assert.equal(pick(rects, 299), 0);
      assert.equal(pick(rects, 300), 1, 'the end of one is the start of the next (half-open)');
      assert.equal(pick(rects, 600), -1, 'between scenes');
      assert.equal(pick(rects, 899), 2);
      assert.equal(pick(rects, 900), -1, 'after the last scene');
      assert.equal(pick([], 10), -1);
      // alone in a fresh context (no common.js yet) it still loads and makes the namespace
      const alone = vm.createContext({ console });
      vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'hw10', 'nav.js'), 'utf8'), alone);
      assert.equal(typeof alone.HW10.nav.pick, 'function');
   });

   await check('the page text: no HW9 or heat line (the author removed it), no stale comment, and the script tags', () => {
      const html = fs.readFileSync(path.join(__dirname, '..', 'hw10', 'index.html'), 'utf8');
      assert.ok(!/HW9|fps|heat was the limit/.test(html), 'no HW9 test or heat line anywhere on the page');
      assert.ok(/load order: common, story, f1, f2, f3, f5, f7, f9, nav\./.test(html), 'the head comment');
      for (const f of ['common', 'story', 'f1-attention', 'f2-desk', 'f3-street', 'f5-table', 'f7-minutes', 'f9-glasses', 'nav'])
         assert.ok(html.includes(`<script src="${f === 'nav' ? 'nav.js' : `figures/${f}.js`}" defer></script>`), 'script tag for ' + f);
      assert.equal((html.match(/<script /g) || []).length, 9, 'exactly nine script tags');
   });

   // ---- fix round 4: the author's review ----
   const read = (...p) => fs.readFileSync(path.join(__dirname, '..', 'hw10', ...p), 'utf8');
   // The words a reader sees by default: tags, scripts and .sr-only text are gone (the figures add their own at run time).
   const strip = h => h.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<(\w+)[^>]*class="[^"]*\bsr-only\b[^"]*"[^>]*>[\s\S]*?<\/\1>/g, ' ');
   const pageText = h => strip(h).replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');

   await check('the story section comes before scene 1 with the four lines, and is not a scene (no bar link points at it)', () => {
      const html = read('index.html');
      const i = html.indexOf('<section id="story"'), j = html.indexOf('id="scene-1"');
      assert.ok(i > 0 && j > i, 'section#story is before #scene-1');
      assert.ok(html.indexOf('id="glasses"') < i, 'and after the glasses: right before scene 1');
      const sec = html.slice(i, html.indexOf('</section>', i));
      assert.ok(/<h2>The scenario<\/h2>/.test(sec), 'the heading is "The scenario"');
      const ps = [...sec.matchAll(/<p>([^<]*)<\/p>/g)].map(m => m[1]);
      assert.deepEqual(ps, ['One afternoon, I plan our VR final project with four classmates. They are Siva, Ben, James and Kaifang. The project is a game called Lighthouse. We all wear the glasses. I assume light glasses, good eye tracking and an AI that reads a scene.']);   // one paragraph (the author: four short lines on their own read oddly)
      assert.ok(!/href="#story"/.test(html), 'the scene bar does not list it');
   });

   await check('the hero line cites Strasburger and Simons & Chabris, and the page has no folded sections', () => {
      const html = read('index.html');
      assert.ok(html.includes('Only about 2 degrees of your view is sharp (Strasburger et al., 2011). In the gorilla study, half of viewers missed a person in a gorilla suit (Simons &amp; Chabris, 1999).'));
      assert.ok(!/<details|<summary/.test(html), 'no <details> or <summary>');
   });

   await check('the scene lines: the new Idea lines, uniform bold labels, and the first lines of scenes 1 and 4', () => {
      const html = read('index.html');
      const line = id => { const sec = html.split(`id="${id}"`)[1].split('</section>')[0]; return [...sec.matchAll(/<p class="l-(look|ai|idea)">([\s\S]*?)<\/p>/g)].map(m => m[2].replace(/<\/?b>/g, '*')); };
      assert.deepEqual(line('scene-1'), ['*I look at:* the desk. I ask, "Where\'s my USB drive?"', '*The AI saw:* my USB drive at 22:41. I never looked at it.', '*Idea:* what I did not look at is still in memory.']);
      assert.deepEqual(line('scene-2'), ['*I look at:* my phone.', '*The AI sees:* a bicycle coming from behind.',
         '*Idea:* the warning grows step by step. Glow, then sound, then text, then a tap. Only real danger may draw in the middle of my view. It works with the network down.']);
      assert.deepEqual(line('scene-3').map(l => l.split('*')[1]), ['I look at:', 'The AI hears:', 'Idea:']);
      assert.deepEqual(line('scene-4'), ['*I look at:* Siva, my laptop, Kaifang. Never the whole board.', '*The AI reads:* the board and the talk, from the best view. It keeps every version.',
         '*Idea:* the minutes list owners and dates. Each item links to its source. "What you missed" is only mine.']);
      for (const id of ['scene-1', 'scene-2', 'scene-3', 'scene-4']) for (const l of line(id)) assert.ok(/^\*[^*]+:\*/.test(l), `${id}: every line has a bold label: ${l}`);
      assert.ok(!/<p class="l-idea">\s*(<b>Idea:<\/b>)?\s*The AI /.test(html), 'no Idea line starts with "The AI"');
   });

   await check('"heat, not code" is gone everywhere', () => {
      const html = read('index.html');
      assert.ok(!/heat, not code|limit was heat/i.test(html + read('figures', 'f9-glasses.js')), 'no "heat, not code" wording');
   });

   await check('the theme sentence appears once in the visible text (the subtitle); there is no Rules or Closing section (the author removed them)', () => {
      const html = read('index.html'), text = pageText(html);
      assert.equal(text.split('Where you look, you need no help.').length - 1, 1, 'exactly once');
      assert.ok(/<p class="thesis">Where you look, you need no help\. The AI attends to the rest\.<\/p>/.test(html), 'and it is the subtitle');
      assert.ok(!/id="rules"|id="closing"|One idea in four places/.test(html));
   });

   await check('the narrator is "Me" everywhere: story member, board lines, owner and the F5 and F7 wording', () => {
      const H = loadAll(), S = H.story;
      assert.equal(S.members.find(m => m.id === 'you').name, 'Me');
      assert.ok(S.board.versions[3].lines.includes('Me: hand tracking') && !JSON.stringify(S.board).includes('You:'), 'the board line is "Me: hand tracking"');
      assert.equal(S.minutes.find(m => m.owner === 'you').due, 'Fri 27 Nov');
      assert.equal(S.minutes.find(m => m.id === 'm2').text, 'Rounds are short because a headset gets hot.');
      const f5 = read('figures', 'f5-table.js'), f7 = read('figures', 'f7-minutes.js');
      assert.ok(f5.includes("'My device'") && !f5.includes("'Your device'"), 'F5: My device');
      assert.ok(f5.includes("'I speak.'") && !/\$\{nameOf\(by\)\} speaks/.test(f5), 'F5: the readout says "I speak." for the narrator and "<Name> speaks." for the rest');
      assert.ok(f7.includes("'I said it'") && !/you said it|Only you see|Your pocket/.test(f7), 'F7: first person');
   });

   await check('F9: the panel has no labels; F9 carries no "X, not Y" contrast; F3 has no link toggle', () => {
      const f9 = read('figures', 'f9-glasses.js'), f3 = read('figures', 'f3-street.js');
      assert.ok(!/The principle\.|What it adds\./.test(f9), 'no labels');
      assert.ok(loadAll().logic.glasses.PARTS[0].adds.includes('The AI keeps events. It does not keep video.'));
      assert.ok(!/as events, not as video/.test(f9));
      const code = x => x.split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n');      // the words on the page, not the comments
      assert.ok(!/, not (code|as |a |the )|not measurements/.test(code(f9)));
      assert.ok(!/Link down|link up|f3-note|data-toggle|route stopped/.test(f3), 'F3: the link toggle is gone (the author removed it)');
   });

   console.log(`${passed} hw10 checks passed.`);
})().catch(e => { console.error(e); process.exit(1); });
