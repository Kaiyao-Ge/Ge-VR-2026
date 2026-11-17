// Rails checks without a browser: the state machine of the IDE (js/scenes/rails/ideCore.js) driven through a fake link and a
// fake clock: typing, focus, commit and acks, `pair`, snapshots and notices, held keys and blur, the command line, the pointer
// and the wheel; the bus view of a snapshot (vars, uses, unplugged, the bindings of a card), `use`/`plug`/`unplug`, the timeline's
// pause, scrub and play against a real Runtime (one bus), `rm`/`rename`/`undo` of cards with their uses, and the full-slot notice.
// Run: node tests/rails-ide.test.cjs
const assert = require('node:assert/strict');
const load = require('./esm.cjs');

let passed = 0;
// Every command and device value the IDE sends through a fake link must be one that the wire (wire.js) would carry: the
// fake link records those that it would not, and the check that sent them fails.
const invalid = [];
const check = async (name, fn) => {
   invalid.length = 0;
   await fn();
   assert.deepEqual(invalid, [], `sent what wire.valid refuses: ${JSON.stringify(invalid)}`);
   passed++; console.log('ok -', name);
};

(async () => {
   const C = await load('js/scenes/rails/ideCore.js');
   const L = await load('js/scenes/rails/layout.js');
   const Rt = await load('js/scenes/rails/runtime.js');
   const Pl = await load('js/scenes/rails/replay.js');
   const W = await load('js/scenes/rails/wire.js');
   const envelope = { from: 1, epoch: 'e', seq: 0, t: 0 };
   const wired = (type, fields) => { const ok = W.valid({ ...fields, type, ...envelope }); if (!ok) invalid.push({ type, ...fields }); return ok; };

   // A fake link: the events the IDE listens to, and a record of what it sends.
   const setup = (opts = {}) => {
      let ms = 1000;
      const handlers = {}, sent = { cmds: [], devs: [] };
      const link = {
         peer: { caps: { mac: !!opts.mac } },
         on(type, fn) { (handlers[type] ||= []).push(fn); return link; },
         sendCmd(c) { sent.cmds.push(c); wired('cmd', { cmd: c }); if (opts.onCmd) opts.onCmd(c); return opts.refuse ? false : true; },
         sendDev(id, port, value) { sent.devs.push({ id, port, value }); wired('dev', { id, port, value }); return true; },
      };
      const core = C.createIdeCore({ link, now: () => ms, platform: opts.platform || '' });
      const emit = (type, ...args) => { for (const fn of handlers[type] || []) fn(...args); };
      const env = {
         core, link, sent, emit,
         advance: dt => { ms += dt; },
         now: () => ms,
         key: (key, mods = {}, rep = false) => {
            emit('in', { ev: { k: 'key', d: 'down', key, code: 'K' + key, mods: { c: false, a: false, s: false, m: false, ...mods }, rep } });
            emit('in', { ev: { k: 'key', d: 'up', key, code: 'K' + key, mods: { c: false, a: false, s: false, m: false, ...mods }, rep: false } });
         },
         type: text => { for (const ch of text) env.key(ch); },
         snap: s => emit('snap', { snap: s }),
         ack: (cmd, ok, reason) => emit('ack', { cmd, ok, ...(reason ? { reason } : {}) }),
         btn: d => emit('in', { ev: { k: 'btn', d } }),
         blur: () => { emit('in', { ev: { k: 'blur' } }); emit('release', 'blur'); },
         head: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 1.6, 0, 1],
         frame: (extra = {}) => core.frame({ head: env.head, hands: [], ...extra }),
         text: id => core.inspect.text(id),
      };
      return env;
   };
   // An IDE that is active, paired, and has two cards from a full snapshot (the v2 shape: variables by name, `vars`, `uses`, `unplugged`).
   const VARS = { time: { kind: 'state', type: 'time', seq: 1, pubs: [['dev:clock', 'time']], subs: [['alpha', 'time']] }, out: { kind: 'state', type: 'any', seq: 1, pubs: [['alpha', 'out']], subs: [] },
      good: { kind: 'state', type: 'any', seq: 1, pubs: [], subs: [] }, ev: { kind: 'event', type: 'num', seq: 0, pubs: [], subs: [] } };
   const ALPHA_PORTS = [{ name: 'time', dir: 'in', kind: 'state', type: 'time', rail: 'time' }, { name: 'out', dir: 'out', kind: 'state', type: 'any', rail: 'out' }];
   const ready = (opts = {}) => {
      const e = setup(opts);
      e.core.setActive(true);
      e.emit('pair', {});
      e.snap({ rev: 1, t: 0, paused: false, playhead: null, window: [0, 10], geometry: { cards: { alpha: { slot: 2 }, beta: { slot: 3 } } },
         vars: ['ev', 'good', 'out', 'time'], uses: {}, unplugged: [], rails: VARS,
         modules: { alpha: { ver: 1, status: 'ok', error: null, editError: null, ports: ALPHA_PORTS, draw: [], logs: [], calls: 5, source: 'const a = 1;' },
                    beta: { ver: 1, status: 'ok', error: null, editError: null, ports: [], draw: [], logs: [], calls: 5, source: 'const b = 2;' } },
         notices: [] });
      e.frame();
      return e;
   };
   const unit = v => { const l = Math.hypot(...v); return v.map(x => x / l); };

   const focus = (e, slot) => { e.core.inspect.setFocus(slot); e.frame(); };
   const view = e => e.frame();
   const stateOf = (e, slot) => view(e).slots[slot].state;
   const cmdLine = (e, line) => { e.key('Escape'); e.type(line); e.key('Enter'); };

   await check('an inactive IDE ignores the link and sends nothing; setActive(false) lets go of everything', () => {
      const e = setup();
      e.emit('pair', {});
      e.snap({ rev: 1, geometry: { cards: { alpha: { slot: 2 } } }, modules: { alpha: { ver: 1, status: 'ok', ports: [], source: 'x' } } });
      e.key('a');
      assert.equal(e.core.inspect.card('alpha'), null, 'no card from a snapshot while inactive');
      assert.equal(e.core.inspect.paired, false);
      assert.equal(e.core.frame({ head: e.head }), null);
      assert.deepEqual([e.sent.cmds.length, e.sent.devs.length], [0, 0]);
      const r = ready();
      r.emit('in', { ev: { k: 'btn', d: 'down' } }); r.emit('in', { ev: { k: 'key', d: 'down', key: 'Shift', code: 'ShiftLeft', mods: { c: false, a: false, s: true, m: false }, rep: false } });
      assert.equal(r.core.inspect.held.buttons.length + r.core.inspect.held.keys.length, 2);
      r.core.setActive(false);
      assert.deepEqual(r.core.inspect.held, { buttons: [], keys: [] });
      assert.equal(r.core.inspect.paired, false);
      assert.ok(r.core.inspect.card('alpha'), 'the buffers are kept');
      r.key('z'); r.emit('snap', { snap: { rev: 9, geometry: { cards: {} } } });
      assert.ok(r.core.inspect.card('alpha'), 'and an inactive IDE does not apply a snapshot');
   });

   await check('cards come from the geometry; their source from the first snapshot that has it', () => {
      const e = setup();
      e.core.setActive(true); e.emit('pair', {});
      e.snap({ rev: 1, geometry: { cards: { alpha: { slot: 2 }, beta: { slot: 0 } } }, modules: { alpha: { ver: 1, status: 'ok', error: null, editError: null, ports: [], source: 'one' } } });
      assert.equal(e.text('alpha'), 'one');
      assert.ok(e.core.inspect.card('beta'), 'beta is in the geometry: it exists');
      assert.equal(e.core.inspect.card('beta').loaded, false, 'but has no source yet (deferred)');
      const v = view(e);
      assert.deepEqual(v.slots.map(s => s && s.id), ['beta', null, 'alpha', null, null]);
      e.snap({ rev: 2, geometry: { cards: { alpha: { slot: 2 }, beta: { slot: 0 } } }, modules: { beta: { ver: 3, status: 'ok', error: null, editError: null, ports: [], source: 'two' } } });
      assert.equal(e.text('beta'), 'two'); assert.equal(e.core.inspect.card('beta').ver, 3);
      assert.equal(e.text('alpha'), 'one', 'the other is unchanged');
      // A removal arrives as a geometry without it.
      focus(e, 2);
      e.snap({ rev: 3, geometry: { cards: { beta: { slot: 0 } } } });
      assert.equal(e.core.inspect.card('alpha'), null);
      assert.equal(e.core.debug.focus, null, 'its focus is released');
   });

   await check('`constructor` is a reserved name: no card is made for it, and a variable of that name in a snapshot is an own key, not an inherited one', () => {
      const e = setup();
      e.core.setActive(true); e.emit('pair', {});
      const full = (cards, vars, rev) => ({ rev, geometry: { cards }, vars,
         rails: Object.fromEntries(vars.map(id => [id, { kind: 'state', type: 'any', seq: 1, pubs: [], subs: [] }])),
         modules: Object.fromEntries(Object.keys(cards).map(id => [id, { ver: 1, status: 'ok', error: null, editError: null, ports: [], source: 'x' }])) });
      e.snap(full({ constructor: { slot: 1 }, alpha: { slot: 2 } }, ['constructor', 'time'], 1));
      const v = e.frame();
      assert.equal(e.core.inspect.card('constructor'), null, 'the name is refused, so there is no card');
      assert.deepEqual(v.slots.map(s => s && s.id), [null, null, 'alpha', null, null]);
      assert.equal(Object.hasOwn(e.core.inspect.rails, 'constructor'), true);
      // a snapshot that no longer lists it takes the variable away (an inherited `constructor` must not keep it)
      e.snap(full({ alpha: { slot: 2 } }, ['time'], 2));
      assert.equal(Object.hasOwn(e.core.inspect.rails, 'constructor'), false, 'the variable is gone');
      // a name that is not there is not found through the prototype either
      e.snap(full({ alpha: { slot: 2 } }, ['time'], 3));
      assert.ok(!Object.hasOwn(e.frame().rails, 'constructor'));
      // a `__proto__` key in a snapshot is a name like any other: it does not change what the map inherits
      e.snap({ rev: 4, vars: ['time', '__proto__'], rails: { ['__proto__']: JSON.parse('{"kind":"state","type":"any","seq":1,"pubs":[],"subs":[],"polluted":true}') } });
      const merged = e.core.inspect.rails;
      assert.equal(Object.getPrototypeOf(merged), null); assert.equal(Object.hasOwn(merged, '__proto__'), true); assert.equal(merged.polluted, undefined); assert.equal({}.polluted, undefined);
   });

   await check('typing: the focused buffer gets the keys, the others and the unfocused case do nothing', () => {
      const e = ready();
      e.type('xyz');
      assert.equal(e.text('alpha'), 'const a = 1;', 'no focus: keys go nowhere');
      assert.ok(e.core.inspect.toasts.some(t => /no card is focused/.test(t)));
      focus(e, 2);
      const line = '// ' + Array.from({ length: 197 }, (_, i) => String.fromCharCode(33 + (i * 7) % 90)).join('');
      assert.equal(line.length, 200);
      e.core.inspect.card('alpha').buffer.apply({ op: 'set', text: '' });
      e.type(line);
      assert.equal(e.text('alpha'), line, '200 characters');
      assert.equal(e.text('beta'), 'const b = 2;', 'the other card is unchanged');
      assert.equal(e.core.inspect.card('alpha').buffer.dirty, true);
      e.key('Backspace'); assert.equal(e.text('alpha').length, 199);
      e.key('z', { c: true }); assert.equal(e.text('alpha').length, 200, 'Ctrl+Z undoes (the Backspace)');
      e.key('Enter'); assert.equal(e.text('alpha').split('\n').length, 2);
      e.emit('in', { ev: { k: 'paste', text: 'ab\ncd' } });
      assert.ok(e.text('alpha').endsWith('ab\ncd'));
      assert.ok(Math.abs(e.core.inspect.lastTextKeyT() - e.now() / 1000) < 1e-9, 'a text key sets the typing lock');
   });

   await check('Mod+Enter commits the buffer; nothing is sent before `pair`; mac comes from the laptop', () => {
      const e = setup();
      e.core.setActive(true);
      e.snap({ rev: 1, geometry: { cards: { alpha: { slot: 2 } } }, modules: { alpha: { ver: 1, status: 'ok', ports: [], source: 'src' } } });
      e.frame(); focus(e, 2);
      e.type('!'); e.key('Enter', { c: true });
      assert.equal(e.sent.cmds.length, 0, 'not paired yet: no cmd');
      assert.ok(e.core.inspect.toasts.some(t => /not paired/.test(t)));
      e.emit('pair', {});
      e.key('Enter', { c: true });
      assert.equal(e.sent.cmds.length, 1);
      assert.deepEqual(e.sent.cmds[0], { id: 1, op: 'commit', module: 'alpha', source: '!src' });
      e.key('Enter', { c: true }, true);
      assert.equal(e.sent.cmds.length, 1, 'a held Mod+Enter (repeat) runs once');
      // A Mac laptop: Cmd+Enter commits, Ctrl+Enter does nothing, whatever the headset's own platform is.
      const m = ready({ mac: true, platform: 'Linux x86_64' });
      focus(m, 2);
      m.key('Enter', { c: true }); assert.equal(m.sent.cmds.length, 0, 'Ctrl+Enter does nothing on a Mac');
      m.key('Enter', { m: true }); assert.equal(m.sent.cmds.length, 1, 'Cmd+Enter commits');
      m.type('q'); assert.ok(m.text('alpha').includes('q'));
      const w = ready({ mac: false, platform: 'MacIntel' });
      focus(w, 2);
      w.key('Enter', { m: true }); assert.equal(w.sent.cmds.length, 0, 'the laptop\'s platform, not the headset\'s');
      w.key('Enter', { c: true }); assert.equal(w.sent.cmds.length, 1);
      const u = ready(); u.core.inspect.setFocus(2); u.frame();
      assert.equal(u.core.inspect.paired, true);
   });

   await check('acks: ok makes the buffer clean, a refusal keeps it dirty and says why, no answer after 5 s', () => {
      const e = ready();
      focus(e, 2);
      e.type('1'); e.key('Enter', { c: true });
      assert.equal(stateOf(e, 2).pending, true, 'running…');
      assert.equal(e.core.inspect.card('alpha').buffer.dirty, true);
      e.ack(1, true);
      assert.equal(e.core.inspect.card('alpha').buffer.dirty, false);
      assert.equal(stateOf(e, 2).pending, false);
      // The text changed after the send: the ack does not make it clean.
      e.key('x'); e.key('Enter', { c: true }); e.key('y'); e.ack(2, true);
      assert.equal(e.core.inspect.card('alpha').buffer.dirty, true);
      // A refusal.
      e.key('Enter', { c: true }); e.ack(3, false, 'SyntaxError: Unexpected token');
      assert.equal(e.core.inspect.card('alpha').buffer.dirty, true);
      assert.match(stateOf(e, 2).notice, /commit refused: SyntaxError: Unexpected token/);
      // After a Worker restart the outcome is unknown: the reason shows and the buffer stays dirty.
      e.key('Enter', { c: true }); e.ack(4, false, 'worker restarted: no beat for 520 ms');
      assert.match(stateOf(e, 2).notice, /worker restarted/);
      assert.equal(e.core.inspect.card('alpha').buffer.dirty, true);
      // An ack for a command we do not know is ignored.
      e.ack(999, false, 'x');
      // No answer.
      e.key('Enter', { c: true });
      assert.equal(e.core.inspect.pending.length, 1);
      e.advance(5100); e.frame();
      assert.equal(e.core.inspect.pending.length, 0);
      assert.match(stateOf(e, 2).notice, /commit: no answer/);
   });

   await check('`pair` marks waiting commands failed and never resends them, resets baselines, and is idempotent', () => {
      const e = ready();
      focus(e, 2);
      e.type('1'); e.key('Enter', { c: true });
      assert.equal(e.sent.cmds.length, 1);
      e.emit('pair', {});
      assert.equal(e.core.inspect.pending.length, 0);
      assert.match(stateOf(e, 2).notice, /link reset — run again/);
      assert.equal(e.sent.cmds.length, 1, 'not resent');
      assert.equal(e.core.inspect.expectFull, true);
      assert.equal(e.core.inspect.rev, -1);
      e.emit('pair', {}); e.emit('pair', {});
      assert.equal(e.sent.cmds.length, 1);
      assert.equal(e.core.inspect.pending.length, 0);
      assert.equal(e.core.inspect.card('alpha').buffer.dirty, true, 'the text is kept, still dirty');
      assert.equal(e.core.inspect.paired, true);
      // A new runtime counts from the start: a rev lower than before is taken now, and a lower one later is not.
      e.snap({ rev: 2, geometry: { cards: { alpha: { slot: 2 } } } });
      assert.equal(e.core.inspect.rev, 2); assert.equal(e.core.inspect.expectFull, false);
      e.snap({ rev: 1, geometry: { cards: { alpha: { slot: 2 }, beta: { slot: 3 } } } });
      assert.equal(e.core.inspect.card('beta'), null, 'an older rev is dropped');
      assert.equal(e.core.inspect.stats.oldSnaps, 1);
   });

   await check('a snap with an equal rev is applied, and one without a rev too', () => {
      const e = ready();
      e.snap({ rev: 1, t: 5, paused: true, playhead: 3, window: [0, 9], density: [1, 2], geometry: { cards: { alpha: { slot: 2 }, beta: { slot: 3 } } }, modules: { alpha: { ver: 1, status: 'ok', calls: 99, ports: [] } } });
      assert.equal(e.core.inspect.card('alpha').calls, 99);
      assert.deepEqual([e.core.inspect.clock.paused, e.core.inspect.clock.playhead, e.core.inspect.clock.window], [true, 3, [0, 9]]);
      e.snap({ modules: { alpha: { ver: 1, status: 'quarantined', error: { phase: 'handler', message: 'boom', line: 3, col: 1 } } } });
      assert.equal(e.core.inspect.card('alpha').status, 'quarantined');
      assert.equal(e.core.inspect.rev, 1);
   });

   await check('notices are shown 5 s under the focused card, once each by id, and a new runtime shows its own', () => {
      const e = ready();
      focus(e, 2);
      e.snap({ rev: 2, notices: [{ id: 7, n: 1, text: 'worker restarted: hung' }] });
      assert.equal(stateOf(e, 2).notice, 'worker restarted: hung');
      assert.equal(stateOf(e, 3).notice, null, 'only the focused card carries it');
      e.advance(4900); assert.equal(stateOf(e, 2).notice, 'worker restarted: hung');
      e.advance(200); assert.equal(stateOf(e, 2).notice, null, 'gone after 5 s');
      e.snap({ rev: 3, notices: [{ id: 7, n: 1, text: 'worker restarted: hung' }] });
      assert.equal(stateOf(e, 2).notice, null, 'the same id is not shown again');
      e.snap({ rev: 4, notices: [{ id: 7, n: 1, text: 'worker restarted: hung' }, { id: 8, n: 1, text: 'a second one' }] });
      assert.equal(stateOf(e, 2).notice, 'a second one');
      // Ids go on across a restart of the Worker (a command id is never reused): 9 is new. After `pair` the runtime may be a new one that numbers afresh.
      e.emit('pair', {});
      e.advance(6000); e.frame();
      e.snap({ rev: 1, t: 100, notices: [{ id: 1, n: 1200, text: 'old news' }, { id: 2, n: 5900, text: 'worker restarted: no beat for 520 ms' }] });
      assert.equal(stateOf(e, 2).notice, 'worker restarted: no beat for 520 ms', 'in the first snapshot after a pair a recent notice (the restart) is shown');
      assert.equal(e.core.inspect.toasts.some(t => t === 'old news'), false, 'the 80 s old one was marked seen, not shown');
      e.advance(6000); e.frame();
      assert.equal(stateOf(e, 2).notice, null);
      e.snap({ rev: 2, t: 101, notices: [{ id: 1, n: 1200, text: 'old news' }, { id: 3, n: 6000, text: 'fresh runtime' }] });
      assert.equal(stateOf(e, 2).notice, 'fresh runtime', 'the 20 s old one was marked seen, not shown, and is not shown now');
      assert.equal(e.core.inspect.paired, true);
   });

   await check('a new ver replaces a clean buffer, keeps a dirty one and says the run changed under you; our own commit comes back clean', () => {
      const e = ready();
      focus(e, 2);
      const mod = (ver, source) => ({ rev: 10 + ver, modules: { alpha: { ver, status: 'ok', error: null, editError: null, ports: [], source } } });
      e.snap(mod(2, 'replaced'));
      assert.equal(e.text('alpha'), 'replaced'); assert.equal(e.core.inspect.card('alpha').buffer.dirty, false);
      e.type('!!'); assert.equal(e.text('alpha'), '!!replaced');
      e.snap(mod(3, 'from elsewhere'));
      assert.equal(e.text('alpha'), '!!replaced', 'the dirty buffer is kept');
      assert.equal(stateOf(e, 2).notice, 'run changed under you');
      assert.equal(e.core.inspect.card('alpha').ver, 3);
      // Our own commit: the snapshot carries the text of the buffer; it is made clean and the cursor stays.
      e.key('Enter', { c: true }); e.ack(1, true);
      assert.equal(e.core.inspect.card('alpha').buffer.dirty, false);
      e.snap(mod(4, '!!replaced'));
      assert.equal(e.text('alpha'), '!!replaced'); assert.equal(e.core.inspect.card('alpha').buffer.col, 2);
      assert.equal(stateOf(e, 2).notice, null);
      // The snapshot may come before the ack: the same result.
      e.key('x'); e.key('Enter', { c: true });
      e.snap(mod(5, e.text('alpha')));
      assert.equal(e.core.inspect.card('alpha').buffer.dirty, false);
      e.ack(2, true);
      assert.equal(e.core.inspect.card('alpha').buffer.dirty, false);
      // A compile error from the runtime shows on the card and the buffer stays.
      e.type('('); e.snap({ rev: 30, modules: { alpha: { ver: 5, status: 'ok', error: null, editError: { phase: 'compile', message: 'bad', line: 1, col: 2 }, ports: [] } } });
      assert.equal(e.core.debug.cards.find(c => c[0] === 'alpha')[1], 'error');
      assert.ok(e.text('alpha').includes('('));
   });

   await check('blur and release: held keys and buttons are let go, a key up without a down is fine', () => {
      const e = ready();
      focus(e, 2);
      e.emit('in', { ev: { k: 'key', d: 'up', key: 'q', code: 'Kq', mods: { c: false, a: false, s: false, m: false }, rep: false } });
      assert.deepEqual(e.core.inspect.held, { buttons: [], keys: [] });
      e.emit('in', { ev: { k: 'key', d: 'down', key: 'Control', code: 'ControlLeft', mods: { c: true, a: false, s: false, m: false }, rep: false } });
      e.emit('in', { ev: { k: 'btn', d: 'down' } });
      assert.deepEqual(e.core.inspect.held, { buttons: ['left'], keys: ['ControlLeft'] });
      e.blur();
      assert.deepEqual(e.core.inspect.held, { buttons: [], keys: [] });
      assert.equal(stateOf(e, 2).echo, 'keyboard lost focus');
      e.key('a');
      assert.deepEqual(stateOf(e, 2).echo, ['a'], 'the next key clears it');
      // A held button goes up with a release of a silent peer too.
      e.emit('in', { ev: { k: 'btn', d: 'down' } }); e.emit('release', 'silent');
      assert.equal(e.core.inspect.paired, false, 'silence also unpairs');
      assert.deepEqual(e.core.inspect.held, { buttons: [], keys: [] });
   });

   await check('a press goes to the pointer device (nothing else takes it), and its release too; a blur lets it go', () => {
      const e = ready();
      e.core.inspect.aim({ o: [0, 1.6, 0], d: [0, 0, -1] });
      e.btn('down'); e.frame();
      assert.deepEqual(e.sent.devs.filter(d => d.id === 'pointer'), [{ id: 'pointer', port: 'down', value: true }]);
      e.btn('up'); e.frame();
      assert.deepEqual(e.sent.devs.filter(d => d.id === 'pointer').at(-1), { id: 'pointer', port: 'down', value: false });
      e.btn('down'); e.frame(); e.blur();
      assert.deepEqual(e.sent.devs.filter(d => d.id === 'pointer').at(-1), { id: 'pointer', port: 'down', value: false }, 'a blur puts the pointer up');
      assert.equal(e.sent.devs.filter(d => d.id === 'pointer').length, 4);
   });

   await check('gaze: a card is focused after the dwell, the typing lock holds it, an empty gaze keeps it', () => {
      const e = ready();
      const at = slot => { const a = L.SLOTS[slot] * Math.PI / 180; e.head = [Math.cos(a), 0, Math.sin(a), 0, 0, 1, 0, 0, -Math.sin(a), 0, Math.cos(a), 0, 0, 1.6, 0, 1]; };
      // (The workspace was frozen by the first frame: turn the head towards slot 3 = +25 degrees.)
      at(3); e.advance(1000); e.frame(); assert.equal(e.core.inspect.hover, 3, 'the head\'s ray is smoothed over about 60 ms, so a second later it is there');
      assert.equal(e.core.debug.focus, null);
      e.advance(300); e.frame(); assert.equal(e.core.debug.focus, null, 'not yet');
      assert.ok(stateOf(e, 3).charging.p > 0.5, 'the ring fills');
      e.advance(100); e.frame(); assert.equal(e.core.debug.focus, 'beta');
      assert.equal(stateOf(e, 3).focused, true);
      e.type('t');
      at(2); e.advance(10); e.frame(); e.advance(500); e.frame(); e.advance(400); e.frame();
      assert.equal(e.core.debug.focus, 'beta', 'within a second of a key the focus cannot move');
      e.advance(1000); e.frame(); e.advance(400); e.frame();
      assert.equal(e.core.debug.focus, 'alpha');
      e.head = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 1.6, 0, 1];
      e.head[9] = 0; e.head[8] = 0;
      const down = [1, 0, 0, 0, 0, 0.5, -0.866, 0, 0, 0.866, 0.5, 0, 0, 1.6, 0, 1];      // head pitched 60 degrees down
      e.head = down; e.advance(2000); e.frame(); e.advance(2000); e.frame();
      assert.equal(e.core.debug.focus, 'alpha', 'looking at the keyboard keeps focus');
   });

   await check('the command line: Esc opens it on the focused card, Enter runs it, Esc on an empty line releases focus', () => {
      const e = ready();
      focus(e, 2);
      e.key('Escape');
      assert.equal(e.core.inspect.command, '');
      assert.equal(stateOf(e, 2).command, '', 'it shows on the focused card');
      e.type('use time pointer_pos'); assert.equal(e.core.inspect.command, 'use time pointer_pos');
      assert.equal(e.text('alpha'), 'const a = 1;', 'the text did not go to the card');
      e.key('Enter');
      assert.deepEqual(e.sent.cmds.at(-1), { id: 1, op: 'use', module: 'alpha', port: 'time', variable: 'pointer_pos' });
      assert.equal(e.core.inspect.command, null);
      e.key('Escape'); e.type('Fly'); e.key('Enter');
      assert.equal(e.core.inspect.command, 'Fly', 'an error keeps the line open');
      assert.match(stateOf(e, 2).notice, /unknown command 'Fly'/);
      e.key('Escape'); assert.equal(e.core.inspect.command, null); assert.equal(e.core.debug.focus, 'alpha', 'Esc on a line with text only closes it');
      e.key('Escape'); e.key('Escape');
      assert.equal(e.core.debug.focus, null, 'Esc on an empty line releases focus');
      focus(e, 2);
      e.key('Escape'); e.type('card gamma'); e.key('Enter');
      assert.deepEqual(e.sent.cmds.at(-1), { id: 2, op: 'addModule', module: 'gamma' });
      e.ack(2, true);
      e.snap({ rev: 20, geometry: { cards: { alpha: { slot: 2 }, beta: { slot: 3 }, gamma: { slot: 4 } } }, modules: { gamma: { ver: 1, status: 'ok', ports: [], source: 'g' } } });
      assert.equal(e.core.debug.focus, 'gamma', 'a new card takes focus');
   });

   await check('commands: rm needs two, rename, reset, revert, undo, pause, live, play', () => {
      const e = ready();
      focus(e, 2);
      const cmd = line => { e.key('Escape'); e.type(line); e.key('Enter'); };
      cmd('rm'); assert.equal(e.sent.cmds.length, 0); assert.match(stateOf(e, 2).notice, /rm again to confirm: card alpha/);
      cmd('rm'); assert.deepEqual(e.sent.cmds.at(-1), { id: 1, op: 'rmModule', module: 'alpha' });
      cmd('rm'); e.advance(3500); e.frame(); cmd('rm'); assert.equal(e.sent.cmds.length, 1, 'the confirmation lapses after 3 s');
      e.ack(1, true);
      e.snap({ rev: 40, geometry: { cards: { alpha: { slot: 2 }, beta: { slot: 3 } } } });   // (alpha is still there)
      cmd('rename alpha2'); assert.deepEqual(e.sent.cmds.at(-1), { id: 2, op: 'renameModule', module: 'alpha', to: 'alpha2' });
      cmd('reset'); assert.deepEqual(e.sent.cmds.at(-1), { id: 3, op: 'reset', module: 'alpha' });
      cmd('revert'); assert.deepEqual(e.sent.cmds.at(-1), { id: 4, op: 'revert', module: 'alpha' });
      cmd('pause'); assert.equal(e.sent.cmds.at(-1).op, 'pause');
      e.snap({ rev: 42, paused: true, playhead: 9, window: [0, 9] });
      cmd('live'); assert.equal(e.sent.cmds.at(-1).op, 'resume');
      e.snap({ rev: 43, paused: true });
      cmd('play'); assert.equal(e.sent.cmds.at(-1).op, 'play');
      // The deleted card comes back with `undo`, once.
      cmd('undo'); assert.deepEqual(e.sent.cmds.at(-1).op, 'addModule', 'the card removed above comes back');
      const nUndo = e.sent.cmds.length; cmd('undo'); assert.equal(e.sent.cmds.length, nUndo + 1, 'until the card is back the deletion is remembered: an undo can be tried again');
   });

   await check('undo restores the last deleted card with its text', () => {
      const e = ready();
      focus(e, 3);
      const cmd = line => { e.key('Escape'); e.type(line); e.key('Enter'); };
      cmd('rm'); cmd('rm');
      assert.equal(e.sent.cmds.at(-1).op, 'rmModule');
      e.ack(1, true);
      e.snap({ rev: 50, geometry: { cards: { alpha: { slot: 2 } } } });
      focus(e, 2);
      cmd('undo');
      assert.deepEqual(e.sent.cmds.at(-1), { id: 2, op: 'addModule', module: 'beta', source: 'const b = 2;' });
   });

   await check('Mod+P pauses and resumes, Mod+. plays and stops', () => {
      const e = ready();
      focus(e, 2);
      e.key('p', { c: true }); assert.deepEqual(e.sent.cmds.at(-1), { id: 1, op: 'pause' });
      e.snap({ rev: 9, paused: true, playhead: 5, window: [0, 5] });
      e.key('.', { c: true }); assert.equal(e.sent.cmds.at(-1).op, 'play');
      e.snap({ rev: 10, paused: true, playing: true, playhead: 5.1, window: [0, 5] });         // (what the runtime says: it is playing)
      e.key('.', { c: true }); assert.equal(e.sent.cmds.at(-1).op, 'stop');
      e.key('p', { c: true }); assert.equal(e.sent.cmds.at(-1).op, 'resume');
   });

   await check('`playing` is the runtime\'s: play shows only when a snapshot says so, and the end of the window or a seek ends it', () => {
      const e = ready();
      e.key('p', { c: true }); e.snap({ rev: 9, paused: true, playing: false, playhead: 5, window: [0, 5] });
      e.key('.', { c: true }); assert.equal(e.sent.cmds.at(-1).op, 'play');
      assert.equal(e.frame().playing, false, 'asked, not yet playing');
      e.snap({ rev: 10, paused: true, playing: true, playhead: 2, window: [0, 5] }); assert.equal(e.frame().playing, true);
      e.snap({ rev: 10, paused: true, playing: false, playhead: 5, window: [0, 5] }); assert.equal(e.frame().playing, false, 'play ran to the window\'s end');
      e.key('.', { c: true }); assert.equal(e.sent.cmds.at(-1).op, 'play', 'so the next press plays again');
      e.snap({ rev: 11, paused: true, playing: true, playhead: 1, window: [0, 5] });
      e.advance(200); e.emit('in', { ev: { k: 'wheel', dx: -100, dy: 0 } }); e.frame();      // a scrub: the runtime's seek stops the play
      assert.equal(e.sent.cmds.at(-1).op, 'seek');
      e.snap({ rev: 12, paused: true, playing: false, playhead: 0.8, window: [0, 5] }); assert.equal(e.frame().playing, false);
      e.snap({ rev: 13, paused: false, playing: false, playhead: null, window: [0, 5] }); assert.equal(e.frame().playing, false);
   });

   await check('recentre: the workspace is made again from the next head (and a hand-set desk forgotten when asked), as when the page enters XR', () => {
      const e = setup();
      e.core.setActive(true);
      const at = y => e.head.map((v, i) => (i === 13 ? y : v));
      e.head = at(0);                                                    // the inline view before Enter VR: the head is at the floor
      e.frame();
      const first = e.core.inspect.ws;
      assert.equal(first.eyeY, 0); assert.ok(Math.abs(e.core.inspect.stage[13] - -0.45) < 1e-9, 'the desk is below the floor');
      e.head = at(1.6); e.frame();
      assert.equal(e.core.inspect.ws, first, 'the workspace stays frozen on its own');
      e.core.recentre(true); e.frame();
      assert.equal(e.core.inspect.ws.eyeY, 1.6, 'a new one from the next head');
      assert.ok(Math.abs(e.core.inspect.stage[13] - 1.15) < 1e-9, 'and the desk from its eye height');
      const left = y => [{ hand: 'left', m: at(y), buttons: Object.assign([], { 4: { pressed: true } }) }];
      e.frame({ hands: left(0.9) }); assert.ok(Math.abs(e.core.inspect.stage[13] - 0.9) < 1e-9, 'X sets the desk');
      e.frame({ hands: [] });
      e.head = at(1.2); e.core.recentre(); e.frame();
      assert.equal(e.core.inspect.ws.eyeY, 1.2); assert.ok(Math.abs(e.core.inspect.stage[13] - 0.9) < 1e-9, 'Mod+Home keeps the desk that was set');
      e.core.recentre(true); e.frame();
      assert.ok(Math.abs(e.core.inspect.stage[13] - 0.75) < 1e-9, 'entering XR does not');
      e.key('Home', { c: true }); e.head = at(1.7); e.frame();
      assert.equal(e.core.inspect.ws.eyeY, 1.7, 'Mod+Home is the same request');
   });

   await check('the laptop going away: the cards and their edits stay, the card says it is waiting for the laptop, and a new pairing with a full snapshot goes on from there', () => {
      const e = ready();
      focus(e, 2); e.type('XYZ');
      assert.equal(e.text('alpha'), 'XYZconst a = 1;'); assert.equal(e.core.inspect.card('alpha').buffer.dirty, true);
      assert.equal(stateOf(e, 2).notice, null);
      e.emit('release', 'silent'); e.frame();
      assert.equal(e.core.inspect.paired, false);
      assert.equal(e.core.inspect.card('alpha').slot, 2); assert.ok(e.core.inspect.card('beta'));
      assert.equal(e.text('alpha'), 'XYZconst a = 1;', 'the edits are kept');
      assert.equal(stateOf(e, 2).notice, 'waiting for the laptop');
      e.type('Q'); assert.equal(e.text('alpha'), 'XYZQconst a = 1;', 'typing still works on the buffer');
      assert.equal(e.sent.cmds.length, 0);
      e.key('Enter', { c: true }); assert.equal(e.sent.cmds.length, 0, 'nothing is sent unpaired'); assert.ok(e.core.inspect.toasts.some(t => /not paired yet/.test(t)));
      e.emit('pair', {});
      assert.equal(e.core.inspect.expectFull, true);
      e.snap({ rev: 1, t: 5, paused: false, playhead: null, window: [0, 10], geometry: { cards: { alpha: { slot: 2 }, beta: { slot: 3 } } },
         rails: {}, modules: { alpha: { ver: 1, status: 'ok', ports: [], draw: [], logs: [], calls: 9, source: 'const a = 1;' }, beta: { ver: 1, status: 'ok', ports: [], draw: [], logs: [], calls: 9, source: 'const b = 2;' } } });
      assert.equal(e.text('alpha'), 'XYZQconst a = 1;', 'the full snapshot leaves the dirty buffer as it was'); assert.equal(e.core.inspect.card('alpha').buffer.dirty, true);
      e.advance(6000); assert.equal(stateOf(e, 2).notice, null); assert.equal(e.core.inspect.paired, true);
   });

   await check('the gaze device: gaze.on on a change, gaze.hit at most 60 times a second, nothing before `pair`', () => {
      const e = setup();
      e.core.setActive(true);
      e.snap({ rev: 1, geometry: { cards: {} } });
      e.frame();
      const ws = e.core.inspect.ws, stage = e.core.inspect.stage;
      assert.ok(stage, 'the stage is placed with the workspace');
      assert.ok(Math.abs(stage[13] - 1.15) < 1e-9, 'the default desk is 0.45 m below the eye');
      assert.ok(Math.abs(stage[12] - 0.45) < 1e-9 && Math.abs(stage[14] - -0.10) < 1e-9, 'centre 0.45 m right and 0.10 m ahead');
      const onMat = { o: [0, 1.6, 0], d: unit([0.45, 1.15 - 1.6, -0.10]) };
      e.core.inspect.aim(onMat); e.frame();
      assert.equal(e.sent.devs.length, 0, 'before `pair` nothing is sent');
      e.emit('pair', {});
      e.frame();
      assert.deepEqual(e.sent.devs.map(d => [d.id, d.port]), [['gaze', 'on'], ['gaze', 'hit']]);
      assert.equal(e.sent.devs[0].value, true);
      assert.ok(e.sent.devs[1].value.every(x => Math.abs(x) < 1e-3), 'the gaze is at the mat\'s centre');
      // Moves of the gaze in frames 5 ms apart: at most one hit per 1/60 s.
      let n = e.sent.devs.length;
      for (let i = 0; i < 40; i++) { e.advance(5); e.core.inspect.aim({ o: [0, 1.6, 0], d: unit([0.45 + 0.001 * i, -0.45, -0.1]) }); e.frame(); }
      const hits = e.sent.devs.slice(n).filter(d => d.port === 'hit');
      assert.ok(hits.length >= 10 && hits.length <= 13, `${hits.length} hits in 200 ms`);
      // Off the mat: gaze.on false, no hit.
      n = e.sent.devs.length;
      e.core.inspect.aim({ o: [0, 1.6, 0], d: [0, 0, -1] }); e.advance(20); e.frame();
      assert.deepEqual(e.sent.devs.slice(n), [{ id: 'gaze', port: 'on', value: false }]);
      // A new pairing says it all again.
      e.emit('pair', {}); e.advance(20); e.frame();
      assert.ok(e.sent.devs.filter(d => d.port === 'on').length >= 3);
   });

   await check('X on the left controller sets the desk height; Mod+Home makes the workspace again', () => {
      const e = ready();
      const ws0 = e.core.inspect.ws, v0 = e.core.inspect.stage;
      const left = pressed => ({ hand: 'left', m: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0.2, 0.9, -0.3, 1], buttons: [{}, {}, {}, {}, { pressed }] });
      e.frame({ hands: [left(true)] });
      assert.ok(Math.abs(e.core.inspect.stage[13] - 0.9) < 1e-9);
      e.frame({ hands: [left(true)] }); e.frame({ hands: [{ ...left(false), m: left(false).m.map((x, i) => (i === 13 ? 0.5 : x)) }] });
      assert.ok(Math.abs(e.core.inspect.stage[13] - 0.9) < 1e-9, 'only the press counts, not the hold or the release');
      assert.equal(e.core.inspect.ws, ws0);
      e.head = [0, 0, -1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0.3, 1.5, 0, 1];       // turned 90 degrees to the left? (yaw changes either way)
      e.frame(); assert.equal(e.core.inspect.ws, ws0, 'frozen: the head moving changes nothing');
      focus(e, 2); e.key('Home', { c: true }); e.frame();
      assert.notEqual(e.core.inspect.ws, ws0);
      assert.equal(e.core.inspect.ws.eyeY, 1.5);
      assert.ok(Math.abs(e.core.inspect.stage[13] - 0.9) < 1e-9, 'the desk height stays');
   });

   await check('the wheel scrolls the focused card; a sideways wheel scrubs only while paused, 100 units a second', () => {
      const e = ready();
      focus(e, 2);
      const text = Array.from({ length: 40 }, (_, i) => 'line ' + i).join('\n');
      e.core.inspect.card('alpha').buffer.apply({ op: 'set', text });
      e.emit('in', { ev: { k: 'wheel', dx: 0, dy: 100 } }); e.frame();
      assert.equal(e.core.inspect.card('alpha').buffer.scroll, 3, '100 px is 3 lines');
      e.emit('in', { ev: { k: 'wheel', dx: 0, dy: -33 } }); e.frame();
      assert.equal(e.core.inspect.card('alpha').buffer.scroll, 3, 'less than a line does nothing yet');
      e.emit('in', { ev: { k: 'wheel', dx: 0, dy: -5 } }); e.frame();
      assert.equal(e.core.inspect.card('alpha').buffer.scroll, 2, 'a trackpad\'s small steps add up');
      for (let i = 0; i < 4; i++) e.emit('in', { ev: { k: 'wheel', dx: 0, dy: 5 } });
      e.frame(); assert.equal(e.core.inspect.card('alpha').buffer.scroll, 2, 'less than a line');
      e.emit('in', { ev: { k: 'wheel', dx: 0, dy: 20 } }); e.frame();
      assert.equal(e.core.inspect.card('alpha').buffer.scroll, 3);
      assert.equal(e.core.inspect.card('beta').buffer.scroll, 0);
      // Sideways while live: nothing.
      e.emit('in', { ev: { k: 'wheel', dx: 300, dy: 0 } }); e.frame();
      assert.equal(e.sent.cmds.length, 0);
      e.snap({ rev: 2, paused: true, playhead: 8, window: [0, 10] });
      e.emit('in', { ev: { k: 'wheel', dx: -150, dy: 0 } }); e.frame();
      assert.deepEqual(e.sent.cmds.at(-1), { id: 1, op: 'seek', t: 6.5 });
      assert.equal(view(e).playhead, 6.5);
      e.emit('in', { ev: { k: 'wheel', dx: -50, dy: 0 } }); e.frame();
      assert.equal(e.sent.cmds.length, 1, 'seeks are at most 20 a second');
      e.advance(60); e.frame();
      assert.deepEqual(e.sent.cmds.at(-1), { id: 2, op: 'seek', t: 6 });
      e.emit('in', { ev: { k: 'wheel', dx: -5000, dy: 0 } }); e.advance(60); e.frame();
      assert.equal(e.sent.cmds.at(-1).t, 0, 'clamped to the window');
      e.ack(1, false, 'nope'); assert.equal(e.core.inspect.toasts.some(t => /seek/.test(t)), false, 'a seek refusal is quiet');
   });

   const LONG = 'x'.repeat(100);
   const wheelEv = (e, dx, dy, zoom) => e.emit('in', { ev: zoom === undefined ? { k: 'wheel', dx, dy } : { k: 'wheel', dx, dy, zoom } });
   const bufOf = (e, id = 'alpha') => e.core.inspect.card(id).buffer;

   await check('a card starts at zoom 1 (32 columns, 12 rows, scrollX 0) and says so in its state; so does the command-line card', () => {
      const e = ready();
      const s = stateOf(e, 2);
      assert.deepEqual([s.zoom, s.cols, s.rows, s.scrollX], [1, 32, 12, 0]);
      assert.equal(view(e).busOpen, false);
      const n = setup(); n.core.setActive(true); n.emit('pair', {}); n.key('Escape');
      const c = n.frame().slots[2].state; assert.deepEqual([c.zoom, c.cols, c.rows, c.scrollX], [1, 32, 12, 0]);
   });

   await check('Ctrl+wheel (zoom +-1) zooms the focused card only, between 26 and 40 columns, and the buffer follows', () => {
      const e = ready();
      focus(e, 2);
      wheelEv(e, 0, 0, 1); e.frame();
      assert.deepEqual([stateOf(e, 2).zoom, stateOf(e, 2).cols, stateOf(e, 2).rows], [0, 26, 10]);
      assert.deepEqual([bufOf(e).cols, bufOf(e).rows], [26, 10]);
      assert.deepEqual([stateOf(e, 3).zoom, stateOf(e, 3).cols], [1, 32], 'the other card is as it was');
      wheelEv(e, 0, 0, 1); e.frame(); assert.equal(stateOf(e, 2).zoom, 0, 'the closest stops');
      wheelEv(e, 0, 0, -1); wheelEv(e, 0, 0, -1); e.frame(); assert.deepEqual([stateOf(e, 2).zoom, stateOf(e, 2).cols, stateOf(e, 2).rows], [2, 40, 15]);
      wheelEv(e, 0, 0, -1); e.frame(); assert.equal(stateOf(e, 2).zoom, 2, 'the farthest stops');
      wheelEv(e, 0, 0, 1); wheelEv(e, 0, 0, -1); e.frame(); assert.equal(stateOf(e, 2).zoom, 2, 'steps in one frame add up');
      assert.equal(e.sent.cmds.length, 0, 'zoom is local to the headset');
      focus(e, 3); wheelEv(e, 0, 0, 1); e.frame();
      assert.deepEqual([stateOf(e, 3).zoom, stateOf(e, 2).zoom], [0, 2], 'the focused card zooms');
      e.core.inspect.setFocus(0); wheelEv(e, 0, 0, 1); e.frame();     // nothing focused at slot 0: no card
      assert.deepEqual([stateOf(e, 3).zoom, stateOf(e, 2).zoom], [0, 2]);
      wheelEv(e, 0, 0, 5); e.frame(); wheelEv(e, 0, 0, 0); e.frame();   // junk steps change nothing but may not throw
   });

   await check('Mod+= / Mod++ zoom in, Mod+- out, Mod+0 back to 32 columns; no focused card: a hint', () => {
      const e = ready();
      e.key('=', { c: true }); assert.equal(e.frame().slots[2].state.zoom, 1, 'no focus: nothing zooms');
      assert.ok(e.core.inspect.toasts.some(t => /no card is focused/.test(t)), JSON.stringify(e.core.inspect.toasts));
      focus(e, 2);
      e.key('=', { c: true }); assert.equal(stateOf(e, 2).zoom, 0);
      e.key('0', { c: true }); assert.deepEqual([stateOf(e, 2).zoom, stateOf(e, 2).cols], [1, 32]);
      e.key('-', { c: true }); assert.deepEqual([stateOf(e, 2).zoom, stateOf(e, 2).cols, stateOf(e, 2).rows], [2, 40, 15]);
      e.key('-', { c: true }); assert.equal(stateOf(e, 2).zoom, 2);
      e.key('+', { c: true, s: true }); assert.equal(stateOf(e, 2).zoom, 1);
      e.key('+', { c: true, s: true }); e.key('+', { c: true, s: true }); assert.equal(stateOf(e, 2).zoom, 0);
      e.key('=', { c: true }, true); assert.equal(stateOf(e, 2).zoom, 0, 'repeat ignored');
      assert.equal(e.text('alpha'), 'const a = 1;', 'nothing typed');
      const m = ready({ mac: true }); focus(m, 2);
      m.key('=', { m: true }); assert.equal(stateOf(m, 2).zoom, 0);
   });

   await check('zoom keeps the cursor in view: rows change with the zoom', () => {
      const e = ready(); focus(e, 2);
      bufOf(e).apply({ op: 'set', text: Array.from({ length: 40 }, (_, i) => 'line ' + i).join('\n') });
      for (let i = 0; i < 11; i++) e.key('ArrowDown');
      assert.deepEqual([stateOf(e, 2).buffer.row, stateOf(e, 2).buffer.scroll], [11, 0]);
      e.key('=', { c: true });
      assert.deepEqual([stateOf(e, 2).rows, stateOf(e, 2).buffer.scroll], [10, 2], 'ten rows: the cursor row 11 is the last');
      for (let i = 0; i < 5; i++) e.key('ArrowDown');
      const b = stateOf(e, 2).buffer; assert.ok(b.row >= b.scroll && b.row < b.scroll + 10, `row ${b.row} scroll ${b.scroll}`);
      e.key('0', { c: true }); e.key('-', { c: true });
      const c = stateOf(e, 2).buffer; assert.ok(c.row >= c.scroll && c.row < c.scroll + 15);
      e.key('PageDown'); assert.equal(stateOf(e, 2).buffer.row, 16 + 15, 'PageDown moves by the card\'s rows');
      wheelEv(e, 0, 100000, undefined); e.frame(); assert.equal(stateOf(e, 2).buffer.scroll, 25, 'the wheel stops at lines - rows');
   });

   await check('scrollX in the card state keeps the cursor two columns inside the edges, with tabs as two columns', () => {
      const e = ready(); focus(e, 2);
      bufOf(e).apply({ op: 'set', text: LONG });
      for (let i = 0; i < 29; i++) e.key('ArrowRight');
      assert.equal(stateOf(e, 2).scrollX, 0);
      e.key('ArrowRight'); assert.equal(stateOf(e, 2).scrollX, 1);
      e.key('End'); assert.equal(stateOf(e, 2).scrollX, 71);
      e.key('=', { c: true }); assert.deepEqual([stateOf(e, 2).cols, stateOf(e, 2).scrollX], [26, 100 - 23], 'zoom in: the end needs more');
      e.key('0', { c: true }); assert.deepEqual([stateOf(e, 2).cols, stateOf(e, 2).scrollX], [32, 100 - 29]);
      e.key('-', { c: true }); assert.deepEqual([stateOf(e, 2).cols, stateOf(e, 2).scrollX], [40, 100 - 37], 'zoomed out: no blank space after the line');
      e.key('Home'); assert.equal(stateOf(e, 2).scrollX, 0);
      bufOf(e).apply({ op: 'set', text: '' }); e.key('0', { c: true });
      e.emit('in', { ev: { k: 'paste', text: '\t'.repeat(20) + 'z' } });      // pasted tabs stay tabs in the buffer
      assert.equal(stateOf(e, 2).buffer.col, 21);
      assert.equal(stateOf(e, 2).scrollX, 41 - 29, 'tabs are two columns: the cursor is at column 41 on the card');
   });

   await check('a sideways wheel scrolls the focused card while live (6 columns per 100 units); paused it scrubs instead', () => {
      const e = ready(); focus(e, 2);
      bufOf(e).apply({ op: 'set', text: LONG });
      wheelEv(e, 100, 0); e.frame(); assert.equal(stateOf(e, 2).scrollX, 6);
      wheelEv(e, 10, 0); e.frame(); assert.equal(stateOf(e, 2).scrollX, 6, 'small steps add up');
      wheelEv(e, 10, 0); e.frame(); assert.equal(stateOf(e, 2).scrollX, 7);
      wheelEv(e, -1000, 0); e.frame(); assert.equal(stateOf(e, 2).scrollX, 0, 'not below 0');
      wheelEv(e, 100000, 0); e.frame(); assert.equal(stateOf(e, 2).scrollX, 100 - 32 + 2, 'to the end of the line and two columns');
      assert.equal(stateOf(e, 2).buffer.col, 0, 'the cursor did not move');
      e.key('ArrowRight'); assert.equal(stateOf(e, 2).scrollX, 0, 'the next cursor move shows the cursor again');
      assert.equal(stateOf(e, 3).scrollX, 0);
      assert.equal(e.sent.cmds.length, 0);
      e.snap({ rev: 2, paused: true, playhead: 8, window: [0, 10] });
      wheelEv(e, 300, 0); e.frame();
      assert.equal(stateOf(e, 2).scrollX, 0, 'paused: no sideways scroll'); assert.deepEqual(e.sent.cmds.at(-1), { id: 1, op: 'seek', t: 10 });
      e.snap({ rev: 3, paused: false, playhead: null, window: [0, 10] });
      wheelEv(e, 100, 0); e.frame(); assert.equal(stateOf(e, 2).scrollX, 6, 'live again');
      // nothing focused: nothing scrolls
      e.core.inspect.setFocus(0); e.frame(); wheelEv(e, 100, 0); e.frame(); assert.equal(stateOf(e, 2).scrollX, 6, 'the card that lost the focus keeps its view');
   });

   await check('a focus change does not move a card\'s view: only its own cursor, an edit or a zoom do (vertical and sideways)', () => {
      const e = ready(); focus(e, 2);
      bufOf(e).apply({ op: 'set', text: Array.from({ length: 40 }, (_, i) => i === 0 ? LONG : 'line ' + i).join('\n') });
      wheelEv(e, 300, 100); e.frame();
      const at = () => [stateOf(e, 2).scrollX, stateOf(e, 2).buffer.scroll];
      assert.deepEqual(at(), [18, 3]);
      focus(e, 3); assert.deepEqual(at(), [18, 3], 'the gaze moved to another card');
      e.frame(); focus(e, 2); assert.deepEqual(at(), [18, 3], 'and back');
      wheelEv(e, 0, 0); e.key('ArrowRight'); assert.deepEqual(at(), [0, 0], 'its own cursor moving shows the cursor');
      wheelEv(e, 300, 100); e.frame(); e.key('=', { c: true }); assert.equal(stateOf(e, 2).scrollX, 0, 'a zoom shows the cursor');
   });

   await check('Mod+[ / Mod+] step the paused playhead by 0.5 s (Shift 0.1 s) with a seek; live they do nothing', () => {
      const e = ready();
      e.key(']', { c: true }); e.key('[', { c: true }); e.advance(100); e.frame();
      assert.equal(e.sent.cmds.length, 0, 'live: ignored');
      e.key('p', { c: true }); e.snap({ rev: 2, paused: true, playhead: 5, window: [0, 10] }); e.sent.cmds.length = 0;
      e.key(']', { c: true }); e.frame(); assert.deepEqual(e.sent.cmds.at(-1), { id: e.sent.cmds.at(-1).id, op: 'seek', t: 5.5 });
      assert.equal(view(e).playhead, 5.5, 'the view shows it at once');
      e.advance(100); e.key('[', { c: true }); e.key('[', { c: true }); e.frame();
      assert.equal(e.sent.cmds.at(-1).t, 4.5, 'two steps back in a frame');
      e.advance(100); e.key('}', { c: true, s: true }); e.frame(); assert.ok(Math.abs(e.sent.cmds.at(-1).t - 4.6) < 1e-9, 'Shift: 0.1 s');
      e.advance(100); e.key('{', { c: true, s: true }); e.key('{', { c: true, s: true }); e.frame(); assert.ok(Math.abs(e.sent.cmds.at(-1).t - 4.4) < 1e-9);
      e.advance(100); for (let i = 0; i < 30; i++) e.key(']', { c: true }, true); e.frame(); assert.equal(e.sent.cmds.at(-1).t, 10, 'clamped to the window');
      e.advance(100); for (let i = 0; i < 30; i++) e.key('[', { c: true }); e.frame(); assert.equal(e.sent.cmds.at(-1).t, 0);
      e.advance(100); e.snap({ rev: 3, paused: true, playhead: 0, window: [0, 10] }); e.frame();
      assert.equal(view(e).playhead, 0);
      const m = ready({ mac: true }); m.key('p', { m: true }); m.snap({ rev: 2, paused: true, playhead: 3, window: [0, 10] });
      m.key(']', { m: true }); m.frame(); assert.equal(m.sent.cmds.at(-1).t, 3.5);
      assert.equal(m.text('alpha'), 'const a = 1;');
   });

   await check('step keys and the wheel share one playhead; seeks stay at most 20 a second', () => {
      const e = ready(); e.key('p', { c: true }); e.snap({ rev: 2, paused: true, playhead: 5, window: [0, 10] });
      e.advance(200); e.key(']', { c: true }); e.frame(); const n = e.sent.cmds.length;
      wheelEv(e, -100, 0); e.frame(); assert.equal(e.sent.cmds.length, n, 'within 50 ms: held');
      e.advance(60); e.frame(); assert.equal(e.sent.cmds.at(-1).t, 4.5, '5 + 0.5 - 1');
      e.key(']', { c: true }); e.key(']', { c: true }); e.advance(60); e.frame(); assert.equal(e.sent.cmds.at(-1).t, 5.5);
   });

   await check('Mod+B toggles the bus window flag in the view (the window itself is tested below)', () => {
      const e = ready();
      assert.equal(view(e).busOpen, false);
      e.key('b', { c: true }); assert.equal(view(e).busOpen, true);
      e.key('b', { c: true }, true); assert.equal(view(e).busOpen, true, 'repeat ignored');
      e.key('b', { c: true }); assert.equal(view(e).busOpen, false);
      assert.equal(e.text('alpha'), 'const a = 1;', 'no b typed');
   });

   await check('draw lists are moved between the last two snapshots; an unchanged list is the same array', () => {
      const a = [{ shape: 'sphere', p: [0, 0, 0], s: 0.01, color: '#fff' }], b = [{ shape: 'sphere', p: [1, 2, 3], s: 0.03, color: '#fff' }];
      const mid = C.lerpDraw(a, b, 0.5);
      assert.deepEqual(mid[0].p, [0.5, 1, 1.5]); assert.ok(Math.abs(mid[0].s - 0.02) < 1e-12);
      assert.equal(C.lerpDraw(a, b, 1), b); assert.equal(C.lerpDraw(a, b, 0), a);
      assert.equal(C.lerpDraw(a, [...b, ...b], 0.5).length, 2, 'a different count is the newer list');
      assert.equal(C.lerpDraw(a, [{ shape: 'box', p: [1, 1, 1] }], 0.5)[0].shape, 'box');
      const e = ready();
      const draw = p => ({ shape: 'sphere', p, s: 0.01, color: '#fff' });
      e.snap({ rev: 2, t: 1, modules: { alpha: { ver: 1, status: 'ok', ports: [], draw: [draw([0, 0, 0])] } } });
      e.advance(33);
      e.snap({ rev: 3, t: 1 + 1 / 30, modules: { alpha: { ver: 1, status: 'ok', ports: [], draw: [draw([1, 0, 0])] } } });
      e.advance(16); const half = view(e).draws.alpha[0].p[0];
      assert.ok(half > 0.3 && half < 0.7, `half way: ${half}`);
      e.advance(100);
      const v1 = view(e).draws.alpha, v2 = view(e).draws.alpha;
      assert.equal(v1, v2, 'once there, the same array every frame (the stage re-reads nothing)');
      assert.deepEqual(v1[0].p, [1, 0, 0]);
      e.emit('pair', {}); e.snap({ rev: 1, modules: { alpha: { ver: 1, status: 'ok', ports: [], draw: [draw([5, 0, 0])] } } });
      assert.deepEqual(view(e).draws.alpha[0].p, [5, 0, 0], 'across a new pairing nothing is blended with the old runtime');
   });

   await check('a draw is blended only with one that is next to it in simulated time and in arrival; after a seek, a pause or a jump it shows at once', () => {
      const draw = x => [{ shape: 'sphere', p: [x, 0, 0], s: 0.01, color: '#fff' }];
      const mod = x => ({ alpha: { ver: 1, status: 'ok', ports: [], draw: draw(x) } });
      const px = e => view(e).draws.alpha[0].p[0];
      // paused for 3 s with no draw, then a seek back 2 s with a new draw: the new picture at once, not a blend towards the old one
      {
         const e = ready();
         e.snap({ rev: 2, t: 10, paused: true, playhead: 10, modules: mod(0) });
         e.advance(3000); e.snap({ rev: 3, t: 10, paused: true, playhead: 10 });
         e.advance(5); e.snap({ rev: 4, t: 10, paused: true, playhead: 8, modules: mod(1) });
         const d = view(e).draws.alpha; assert.deepEqual(d[0].p, [1, 0, 0]);
         e.advance(16); assert.equal(px(e), 1, 'no glide after the seek');
      }
      // a seek forward by 1 s: no blend
      {
         const e = ready();
         e.snap({ rev: 2, t: 10, paused: true, playhead: 5, modules: mod(0) });
         e.advance(20); e.snap({ rev: 3, t: 10, paused: true, playhead: 6, modules: mod(1) });
         e.advance(10); assert.equal(px(e), 1);
      }
      // playing the past after a long pause: the first play draw comes 3 s after the seek draw (no blend), the second 33 ms later (blended)
      {
         const e = ready();
         e.snap({ rev: 2, t: 10, paused: true, playhead: 5, modules: mod(0) });
         e.advance(3000); e.snap({ rev: 3, t: 10, paused: true, playhead: 5 + 1 / 30, modules: mod(1) });
         e.advance(10); assert.equal(px(e), 1, 'the first one is shown at once');
         e.advance(33); e.snap({ rev: 4, t: 10, paused: true, playhead: 5 + 2 / 30, modules: mod(2) });
         e.advance(16); const h = px(e); assert.ok(h > 1.3 && h < 1.7, `blended half way: ${h}`);
      }
      // resume to now: the clock jumps, no blend
      {
         const e = ready();
         e.snap({ rev: 2, t: 10, paused: true, playhead: 5, modules: mod(0) });
         e.advance(20); e.snap({ rev: 3, t: 20, paused: false, playhead: null, modules: mod(1) });
         e.advance(10); assert.equal(px(e), 1);
      }
   });

   await check('debug is names and counts, never text; focus, cards and rails feed the log line', () => {
      const e = ready();
      focus(e, 2);
      e.type('SECRETTEXT');
      e.snap({ rev: 2, rails: { good: { kind: 'state', type: 'any', seq: 10, pubs: [['alpha', 'out']], subs: [['beta', 'x'], ['dev:gaze', 'y']] } } });
      assert.equal(e.core.debug.focus, 'alpha');
      assert.deepEqual(e.core.debug.cards, [['alpha', 'edited', true], ['beta', 'running', false]]);
      const rails = e.core.debug.rails;
      assert.deepEqual(rails.find(r => r[0] === 'good').slice(0, 4), ['good', 'state', 1, 2]);
      assert.equal(rails.find(r => r[0] === 'good')[4], null, 'no rate at the first look');
      e.advance(2000); e.snap({ rev: 3, rails: { good: { kind: 'state', type: 'any', seq: 30, pubs: [], subs: [] } } });
      assert.equal(e.core.debug.rails.find(r => r[0] === 'good')[4], 10, '20 messages in 2 s');
      const text = JSON.stringify(e.core.debug);
      assert.ok(!/SECRETTEXT|const a/.test(text), 'no source or typed text in debug');
      assert.equal(e.core.debug.rails, e.core.debug.rails, 'read twice, the same rows');
      // The log line takes exactly these fields.
      assert.deepEqual(Object.keys(e.core.debug).sort(), ['cards', 'focus', 'rails']);
   });

   await check('a dirty card that the runtime removed keeps its edits: a notice, and `undo` brings it back with the edited text, its uses and its unplugged state (use per key, then plug off)', () => {
      const e = ready();
      focus(e, 2);
      e.snap({ rev: 2, uses: { 'alpha.time': 'good', 'beta.x': 'out' }, unplugged: ['alpha'], modules: { alpha: { ver: 1, status: 'ok', ports: ALPHA_PORTS.map(p => ({ ...p, rail: null })) } } });
      e.type('EDIT');
      // The card goes, and the same snapshot's uses no longer have its keys (the card's entries are remembered from before).
      e.snap({ rev: 5, geometry: { cards: { beta: { slot: 3 } } }, uses: { 'beta.x': 'out' }, unplugged: [] });
      assert.equal(e.core.inspect.card('alpha'), null);
      assert.match(e.core.inspect.toasts.at(-1), /alpha: removed by the runtime — your edits are kept, undo restores/);
      // A clean card removed by the runtime says nothing.
      const n = e.core.inspect.toasts.length;
      e.snap({ rev: 6, geometry: { cards: {} }, uses: {} });
      assert.equal(e.core.inspect.toasts.length, n);
      focus(e, 3); e.snap({ rev: 7, geometry: { cards: { beta: { slot: 3 } } } });
      e.key('Escape'); e.type('undo'); e.key('Enter');
      assert.deepEqual(e.sent.cmds.at(-1), { id: 1, op: 'addModule', module: 'alpha', source: 'const a = 1;' }, 'the running source comes back first');
      e.ack(1, true);
      assert.equal(e.sent.cmds.length, 1, 'the uses wait for the card');
      e.snap({ rev: 8, geometry: { cards: { alpha: { slot: 2 }, beta: { slot: 3 } } },
         modules: { alpha: { ver: 1, status: 'ok', error: null, editError: null, source: 'const a = 1;', ports: ALPHA_PORTS.map(p => ({ ...p, rail: null })) } } });
      assert.equal(e.text('alpha'), 'EDITconst a = 1;', 'the edited text is back');
      assert.equal(e.core.inspect.card('alpha').buffer.dirty, true, 'as a dirty buffer');
      assert.deepEqual(e.sent.cmds.slice(1), [{ id: 2, op: 'use', module: 'alpha', port: 'time', variable: 'good' }, { id: 3, op: 'plug', module: 'alpha', on: false }], 'its use, then the plug');
      assert.equal(e.core.inspect.card('alpha').running, 'const a = 1;');
      cmdLine(e, 'undo'); assert.match(e.core.inspect.toasts.at(-1), /nothing to undo/, 'restored: nothing left to undo');
   });

   await check('run changed under you: not for a source we already know, not for our own commit coming back late, and deleting back is clean', () => {
      const e = ready();
      focus(e, 2);
      const mod = (ver, source) => ({ modules: { alpha: { ver, status: 'ok', error: null, editError: null, ports: [], source } } });
      // (A) a full snapshot after a re-pair sends every source again, equal to the running one.
      e.type('x');
      e.emit('pair', {});
      e.snap({ rev: 1, ...mod(1, 'const a = 1;') });
      assert.equal(stateOf(e, 2).notice, null, 'a source equal to the running one is nothing new');
      assert.equal(e.core.inspect.card('alpha').changedUnder, false);
      assert.equal(e.text('alpha'), 'xconst a = 1;');
      // (B) Mod+Enter, more typing before the snapshot, then our own new ver arrives (before and after the ack).
      e.key('Enter', { c: true }); const sent = e.text('alpha'); e.type('yy');
      e.snap({ rev: 2, ...mod(2, sent) });
      assert.equal(stateOf(e, 2).notice, null, 'our own commit coming back is not someone else\'s');
      assert.equal(e.core.inspect.card('alpha').buffer.dirty, true, 'the extra typing is still dirty');
      e.ack(2, true);
      assert.equal(e.core.inspect.card('alpha').buffer.dirty, true);
      e.snap({ rev: 3, ...mod(2, sent) });
      assert.equal(stateOf(e, 2).notice, null);
      // The ack first, more typing, then the snapshot.
      e.key('Enter', { c: true }); const sent2 = e.text('alpha'); e.ack(3, true); e.type('z');
      e.snap({ rev: 4, ...mod(3, sent2) });
      assert.equal(stateOf(e, 2).notice, null);
      // Deleting back to the running text is clean again.
      assert.equal(e.core.inspect.card('alpha').buffer.dirty, true);
      e.key('Backspace');
      assert.equal(e.core.inspect.card('alpha').buffer.dirty, false, 'text equals what runs');
      // Someone else's run over a dirty buffer is still told.
      e.type('q'); e.snap({ rev: 5, ...mod(4, 'elsewhere') });
      assert.equal(stateOf(e, 2).notice, 'run changed under you');
      assert.equal(e.text('alpha').includes('q'), true, 'the edits are kept');
   });

   await check('a silent peer is sent nothing when the keys are let go; a blur still puts the pointer up', () => {
      const e = ready();
      e.core.inspect.aim({ o: [0, 1.6, 0], d: [0, 0, -1] });
      e.btn('down'); e.frame();
      const n = e.sent.devs.length;
      e.emit('release', 'silent');
      assert.equal(e.sent.devs.length, n, 'no dev to a silent peer');
      assert.equal(e.core.inspect.paired, false);
      const f = ready();
      f.core.inspect.aim({ o: [0, 1.6, 0], d: [0, 0, -1] });
      f.btn('down'); f.frame(); f.blur();
      assert.deepEqual(f.sent.devs.at(-1), { id: 'pointer', port: 'down', value: false });
   });

   // The cards of a snapshot: geometry (slots) and, for those given, a module entry with its source.
   const cardSnap = (rev, ids, sources = {}) => ({ rev, geometry: { cards: Object.fromEntries(ids.map((id, i) => [id, { slot: i + 2 }])) },
      modules: Object.fromEntries(Object.entries(sources).map(([id, source]) => [id, { ver: 1, status: 'ok', error: null, editError: null, ports: [], source }])) });

   await check('each removal of a dirty card by the runtime says so and is remembered, also the second time; an own `rm` is silent', () => {
      const e = setup();
      e.core.setActive(true); e.emit('pair', {});
      e.snap(cardSnap(1, ['alpha'], { alpha: 'one' })); e.frame();
      focus(e, 2); e.type('A');
      e.snap(cardSnap(2, []));
      assert.match(e.core.inspect.toasts.at(-1), /alpha: removed by the runtime/);
      // The card comes back (re-added), is edited again, and is removed once more: again a notice, and undo restores the SECOND text.
      e.snap(cardSnap(3, ['alpha'], { alpha: 'one' })); focus(e, 2); e.type('B');
      const n = e.core.inspect.toasts.length;
      e.snap(cardSnap(4, []));
      assert.equal(e.core.inspect.toasts.length, n + 1); assert.match(e.core.inspect.toasts.at(-1), /alpha: removed by the runtime/);
      e.snap(cardSnap(5, ['beta'], { beta: 'b' })); focus(e, 2);
      cmdLine(e, 'undo'); e.ack(1, true);
      e.snap(cardSnap(6, ['beta', 'alpha'], { alpha: 'one' }));
      assert.equal(e.text('alpha'), 'Bone', 'the second edit, not the first');
      // Our own rm (and then the geometry that shows it): silent.
      focus(e, 3); cmdLine(e, 'rm'); cmdLine(e, 'rm');
      assert.equal(e.sent.cmds.at(-1).op, 'rmModule');
      const m = e.core.inspect.toasts.length;
      e.ack(e.sent.cmds.at(-1).id, true);
      e.snap(cardSnap(7, ['beta']));
      assert.equal(e.core.inspect.toasts.some((t, i) => i >= m && /removed by the runtime/.test(t)), false, 'no notice for our own removal');
      // A refused rm is not "own": a later runtime removal of that card says so.
      e.snap(cardSnap(8, ['beta', 'alpha'], { alpha: 'one' })); focus(e, 3); e.type('C');
      cmdLine(e, 'rm'); cmdLine(e, 'rm'); e.ack(e.sent.cmds.at(-1).id, false, 'nope');
      e.snap(cardSnap(9, ['beta']));
      assert.match(e.core.inspect.toasts.at(-1), /alpha: removed by the runtime/);
   });

   await check('undo: a refused addModule clears the restore with the reason and can be tried again; a late card is restored if clean, never over edits', () => {
      const e = setup();
      e.core.setActive(true); e.emit('pair', {});
      e.snap(cardSnap(1, ['alpha', 'beta'], { alpha: 'one', beta: 'two' })); e.frame();
      focus(e, 2); e.type('A');
      e.snap(cardSnap(2, ['beta'], {}));
      focus(e, 3);
      cmdLine(e, 'undo'); const first = e.sent.cmds.at(-1);
      assert.deepEqual([first.op, first.module, first.source], ['addModule', 'alpha', 'one']);
      e.ack(first.id, false, 'paused: Mod+Shift+Enter continues from here, Mod+P returns to now');
      assert.match(e.core.inspect.toasts.at(-1), /undo failed: paused/);
      cmdLine(e, 'undo'); assert.equal(e.sent.cmds.at(-1).module, 'alpha', 'the deletion is still remembered: retry');
      e.ack(e.sent.cmds.at(-1).id, true);
      e.advance(60000); e.frame();                                                 // no expiry: it arrives much later
      e.snap(cardSnap(3, ['beta', 'alpha'], { alpha: 'one' }));
      assert.equal(e.text('alpha'), 'Aone'); assert.equal(e.core.inspect.card('alpha').buffer.dirty, true);
      cmdLine(e, 'undo'); assert.match(e.core.inspect.toasts.at(-1), /nothing to undo/, 'restored: nothing left to undo');
      // A refused undo leaves nothing waiting: a card of that name that appears later is not given the old text.
      const h = setup();
      h.core.setActive(true); h.emit('pair', {});
      h.snap(cardSnap(1, ['alpha', 'beta'], { alpha: 'one', beta: 'two' })); h.frame();
      focus(h, 2); h.type('A'); h.snap(cardSnap(2, ['beta'], {}));
      focus(h, 3); cmdLine(h, 'undo'); h.ack(h.sent.cmds.at(-1).id, false, 'refused');
      h.snap(cardSnap(3, ['beta', 'alpha'], { alpha: 'one' }));
      assert.equal(h.text('alpha'), 'one', 'not restored after a refused undo');
      // Over edits: the card is back from elsewhere and typed in before the restore's module entry arrives.
      const f = setup();
      f.core.setActive(true); f.emit('pair', {});
      f.snap(cardSnap(1, ['alpha', 'beta'], { alpha: 'one', beta: 'two' })); f.frame();
      focus(f, 2); f.type('A'); f.snap(cardSnap(2, ['beta'], {}));
      focus(f, 3); cmdLine(f, 'undo'); f.ack(f.sent.cmds.at(-1).id, true);
      f.snap(cardSnap(3, ['beta', 'alpha'], {}));                                   // geometry first: the card exists, no source yet
      f.snap(cardSnap(4, ['beta', 'alpha'], { alpha: 'one' }));                     // (loaded now; restore applies here, clean)
      assert.equal(f.text('alpha'), 'Aone');
      const g = setup();
      g.core.setActive(true); g.emit('pair', {});
      g.snap(cardSnap(1, ['alpha', 'beta'], { alpha: 'one', beta: 'two' })); g.frame();
      focus(g, 2); g.type('A'); g.snap(cardSnap(2, ['beta'], {}));
      focus(g, 3); cmdLine(g, 'undo'); g.ack(g.sent.cmds.at(-1).id, true);
      // The card comes back, but loaded by a snapshot that is not the restore's own, and the user types before the entry arrives.
      g.snap(cardSnap(3, ['beta', 'alpha'], {}));
      focus(g, 3); g.core.inspect.card('alpha').loaded = true; g.core.inspect.card('alpha').running = 'one'; g.core.inspect.card('alpha').buffer.apply({ op: 'set', text: 'one' });
      g.type('Q');
      g.snap(cardSnap(4, ['beta', 'alpha'], { alpha: 'one' }));
      assert.equal(g.text('alpha'), 'Qone', 'the live buffer is kept');
      assert.match(g.core.inspect.toasts.at(-1), /alpha: not restored — it has edits/);
   });

   await check('rename of a dirty card by this IDE: the edited buffer moves to the new name, no removal notice', () => {
      const e = setup();
      e.core.setActive(true); e.emit('pair', {});
      e.snap(cardSnap(1, ['alpha'], { alpha: 'one' })); e.frame();
      focus(e, 2); e.type('E');
      cmdLine(e, 'rename gamma');
      assert.deepEqual(e.sent.cmds.at(-1), { id: 1, op: 'renameModule', module: 'alpha', to: 'gamma' });
      e.ack(1, true);
      const n = e.core.inspect.toasts.length;
      e.snap(cardSnap(2, ['gamma'], { gamma: 'one' }));
      assert.equal(e.core.inspect.card('alpha'), null);
      assert.equal(e.text('gamma'), 'Eone'); assert.equal(e.core.inspect.card('gamma').buffer.dirty, true);
      assert.equal(e.core.inspect.toasts.length, n, 'no notice');
   });

   await check('rename in flight: what is typed into the old card before the removal arrives moves too', () => {
      const e = setup();
      e.core.setActive(true); e.emit('pair', {});
      e.snap(cardSnap(1, ['alpha'], { alpha: 'one' })); e.frame();
      focus(e, 2); e.type('E');
      cmdLine(e, 'rename gamma'); e.ack(1, true);
      e.type('y');                                                       // the old card is still there and focused
      e.snap(cardSnap(2, ['gamma'], { gamma: 'one' }));
      assert.equal(e.text('gamma'), 'Eyone'); assert.equal(e.core.inspect.card('gamma').buffer.dirty, true);
      // A rename of a clean card, then typing: the typing moves too.
      const f = setup();
      f.core.setActive(true); f.emit('pair', {});
      f.snap(cardSnap(1, ['alpha'], { alpha: 'one' })); f.frame();
      focus(f, 2); cmdLine(f, 'rename gamma'); f.ack(1, true); f.type('y');
      f.snap(cardSnap(2, ['gamma'], { gamma: 'one' }));
      assert.equal(f.text('gamma'), 'yone');
   });

   await check('a card with edits typed before its first source keeps them, and is marked', () => {
      const e = setup();
      e.core.setActive(true); e.emit('pair', {});
      e.snap(cardSnap(1, ['alpha'], {})); e.frame();
      const c = e.core.inspect.card('alpha');
      assert.equal(c.loaded, false);
      c.buffer.apply({ op: 'insert', text: 'typed' });                     // (the keys refuse an unloaded card; a paste or restore could not)
      e.snap(cardSnap(2, ['alpha'], { alpha: 'one' }));
      assert.equal(e.text('alpha'), 'typed', 'kept');
      assert.equal(c.running, 'one'); assert.equal(c.loaded, true); assert.equal(c.buffer.dirty, true);
      focus(e, 2); assert.equal(stateOf(e, 2).notice, 'run changed under you');
   });

   await check('a rename or rm with no answer is no longer own: a later runtime removal says so', () => {
      const e = setup();
      e.core.setActive(true); e.emit('pair', {});
      e.snap(cardSnap(1, ['alpha'], { alpha: 'one' })); e.frame();
      focus(e, 2); e.type('E'); cmdLine(e, 'rm'); cmdLine(e, 'rm');
      e.advance(5100); e.frame();
      e.snap(cardSnap(2, []));
      assert.match(e.core.inspect.toasts.at(-1), /alpha: removed by the runtime/);
   });

   await check('invariant (random sequences): a dirty card never vanishes without a notice, and an undo never overwrites a dirty buffer', () => {
      for (let seed = 1; seed <= 40; seed++) {
         const e = setup();
         e.core.setActive(true); e.emit('pair', {});
         let rev = 1, r = seed * 7919;
         const rnd = n => { r = (r * 1103515245 + 12345) & 0x7fffffff; return r % n; };
         const names = ['a', 'b', 'c'], here = new Set(), src = {};
         const publish = () => {
            const ids = names.filter(n => here.has(n));
            e.snap(cardSnap(rev++, ids, Object.fromEntries(ids.filter(n => !e.core.inspect.card(n)?.loaded).map(n => [n, src[n] = 'src ' + n]))));
         };
         publish();
         for (let step = 0; step < 120; step++) {
            const before = Object.fromEntries(names.map(n => { const c = e.core.inspect.card(n); return [n, c && { dirty: c.buffer.dirty, text: c.buffer.text, loaded: c.loaded }]; }));
            const op = rnd(8);
            let removed = null;
            if (op === 0) { const n = names[rnd(3)]; here.add(n); publish(); }
            else if (op === 1) { const n = names[rnd(3)]; if (here.delete(n)) { removed = n; publish(); } }
            else if (op === 2) { const n = names[rnd(3)], c = e.core.inspect.card(n); if (c && c.loaded) { e.core.inspect.setFocus(c.slot); e.frame(); e.type('x'); } }
            else if (op === 3) { cmdLine(e, 'undo'); }
            else if (op === 4) { const p = e.core.inspect.pending; if (p.length) e.ack(p[rnd(p.length)].id, !!rnd(2), 'r'); }
            else if (op === 5) { publish(); }
            else if (op === 6) { e.advance(rnd(7000)); e.frame(); }
            else { e.emit('pair', {}); publish(); }
            for (const n of names) {
               const was = before[n], now = e.core.inspect.card(n);
               if (!was || !was.loaded || !was.dirty) continue;
               if (!now) {
                  if (removed === n) assert.ok(e.core.inspect.toasts.some(t => t.startsWith(`${n}: removed by the runtime`)), `seed ${seed} step ${step}: ${n} vanished without a notice`);
               } else if (op === 3 || op === 4 || op === 5 || op === 0 || op === 7) {
                  assert.ok(now.buffer.dirty && now.buffer.text === was.text, `seed ${seed} step ${step}: dirty ${n} was overwritten (${JSON.stringify(was.text)} -> ${JSON.stringify(now.buffer.text)})`);
               }
            }
         }
      }
   });

   await check('no cards at all: the command line still has a card to show on, and `card x` works', () => {
      const e = setup();
      e.core.setActive(true); e.emit('pair', {});
      e.snap({ rev: 1, geometry: { cards: {} } });
      e.frame();
      e.key('Escape');
      const v = view(e);
      assert.equal(v.slots[2].state.command, ''); assert.equal(v.slots[2].id, null);
      e.type('card first'); e.key('Enter');
      assert.deepEqual(e.sent.cmds.at(-1), { id: 1, op: 'addModule', module: 'first' });
   });

   await check('a command that the link refuses is not left pending', () => {
      const e = ready({ refuse: true });
      focus(e, 2);
      e.type('1'); e.key('Enter', { c: true });
      assert.equal(e.core.inspect.pending.length, 0);
      assert.match(stateOf(e, 2).notice, /could not send commit/);
   });

   // ---- the bus as the IDE sees it: vars, uses, unplugged, the bindings of a card ----

   await check('the v2 snapshot: `vars` drops what is not in it, a name in `vars` with no entry yet is deferred, `uses` and `unplugged` come with the head; the v1 fields are gone from the view', () => {
      const e = ready(), v = e.frame();
      assert.deepEqual(Object.keys(v.rails).sort(), ['ev', 'good', 'out', 'time']);
      assert.deepEqual([v.vars, v.uses, v.unplugged], [['ev', 'good', 'out', 'time'], {}, []]);
      for (const gone of ['laneOf', 'devices', 'grab', 'lens']) assert.equal(gone in v, false, `${gone} is not in the view`);
      e.snap({ rev: 2, vars: ['out', 'time'] });
      assert.deepEqual(Object.keys(e.frame().rails).sort(), ['out', 'time'], 'a variable that is not in `vars` is dropped');
      e.snap({ rev: 3, rails: { late: { kind: 'state', type: 'any', seq: 1, pubs: [], subs: [] } } });
      assert.equal('late' in e.frame().rails, false, 'a rail the head does not list is not taken');
      e.snap({ rev: 4, vars: ['late', 'out', 'time'] });
      assert.deepEqual([e.frame().vars, 'late' in e.frame().rails], [['late', 'out', 'time'], false], 'in `vars`, not delivered yet: deferred, not missing');
      e.snap({ rev: 5, rails: { late: { kind: 'state', type: 'any', seq: 1, pubs: [], subs: [] } } });
      assert.equal(e.frame().rails.late.seq, 1);
      e.snap({ rev: 6, uses: { 'beta.x': 'out' }, unplugged: ['beta'] });
      assert.deepEqual([e.frame().uses, e.frame().unplugged], [{ 'beta.x': 'out' }, ['beta']]);
      e.snap({ rev: 7, t: 1 });
      assert.deepEqual([e.frame().uses, e.frame().unplugged], [{ 'beta.x': 'out' }, ['beta']], 'a snapshot without them leaves them');
      e.snap({ rev: 8, uses: 'junk', unplugged: 5, vars: 'junk' });
      assert.deepEqual([e.frame().vars, e.frame().uses, e.frame().unplugged], [['late', 'out', 'time'], { 'beta.x': 'out' }, ['beta']], 'garbage changes nothing');
      e.emit('pair', {}); e.snap({ rev: 1, uses: {}, unplugged: [], vars: ['time'] });
      assert.deepEqual([e.frame().uses, e.frame().unplugged, Object.keys(e.frame().rails)], [{}, [], ['time']], 'a new pairing starts from its own snapshot');
   });

   await check('bindings of a card: default or used variable, bound, and why not (waiting, still arriving, incompatible, unplugged)', () => {
      const e = ready(); focus(e, 3);
      const port = (name, dir, kind, type, rail = null) => ({ name, dir, kind, type, rail });
      e.snap({ rev: 2, vars: ['ev', 'good', 'later', 'out', 'time'], uses: { 'beta.y': 'out', 'beta.z': 'good', 'beta.d': 'later' },
         modules: { beta: { ports: [port('x', 'in', 'state', 'any'), port('y', 'in', 'event', 'num'), port('z', 'in', 'state', 'any', 'good'), port('d', 'in', 'state', 'any'), port('w', 'out', 'state', 'num', 'w')] } } });
      const b = stateOf(e, 3).bindings;
      assert.deepEqual(b.map(x => [x.port, x.dir, x.variable, x.isDefault, x.bound]),
         [['x', 'in', 'x', true, false], ['y', 'in', 'out', false, false], ['z', 'in', 'good', false, true], ['d', 'in', 'later', false, false], ['w', 'out', 'w', true, true]]);
      assert.match(b[0].reason, /^waiting: no variable 'x' yet/);
      assert.match(b[1].reason, /^incompatible: out is state any, y is event num/);
      assert.equal(b[2].reason, null);
      assert.match(b[3].reason, /^waiting: later is still arriving/, 'in `vars`, no entry yet');
      assert.equal(b[4].reason, null);
      assert.deepEqual(Object.keys(b[0]).sort(), ['bound', 'dir', 'isDefault', 'port', 'reason', 'variable']);
      assert.equal(stateOf(e, 3).unplugged, false); assert.equal(stateOf(e, 3).bindings, stateOf(e, 3).bindings, 'worked out again only when something changed');
      // a variable of the same name that shows up but does not fit: still unbound, and says why
      e.snap({ rev: 3, vars: ['ev', 'good', 'later', 'out', 'time', 'x'], rails: { x: { kind: 'event', type: 'num', seq: 0, pubs: [['alpha', 'zz']], subs: [] } } });
      assert.match(stateOf(e, 3).bindings[0].reason, /^incompatible: x is event num, x is state any/);
      assert.equal(stateOf(e, 3).bindings[0].isDefault, true);
      // an unplugged card has no docks at all
      e.snap({ rev: 4, unplugged: ['beta'], modules: { beta: { ports: [port('z', 'in', 'state', 'any'), port('w', 'out', 'state', 'num')] } } });
      const u = stateOf(e, 3);
      assert.equal(u.unplugged, true);
      assert.deepEqual(u.bindings.map(x => [x.port, x.bound, x.reason]), [['z', false, 'unplugged'], ['w', false, 'unplugged']]);
      assert.equal(stateOf(e, 2).unplugged, false, 'the other card is plugged');
      assert.deepEqual(stateOf(e, 2).bindings.map(x => [x.port, x.variable, x.bound]), [['time', 'time', true], ['out', 'out', true]]);
   });

   await check('heads with unchanged content keep `vars`, `uses`, `unplugged` and each card\'s `bindings` as the same objects; a change makes new ones', () => {
      const e = ready(); focus(e, 2);
      e.snap({ rev: 2, uses: { 'alpha.time': 'good' } });
      const head = (rev, extra = {}) => e.snap({ rev, t: rev, vars: ['ev', 'good', 'out', 'time'], uses: { 'alpha.time': 'good' }, unplugged: [], rails: VARS, modules: { alpha: { ports: ALPHA_PORTS.map(p => ({ ...p })) } }, ...extra });
      const grab = () => { const v = e.frame(); return { v, vars: v.vars, uses: v.uses, unplugged: v.unplugged, bindings: stateOf(e, 2).bindings, other: stateOf(e, 3).bindings }; };
      head(3); const a = grab();
      head(4); head(5, { rails: { out: { ...VARS.out, seq: 99 } } });
      const b = grab();
      assert.equal(b.vars, a.vars); assert.equal(b.uses, a.uses); assert.equal(b.unplugged, a.unplugged);
      assert.equal(b.bindings, a.bindings, 'a snapshot that changed nothing in the card\'s bindings'); assert.equal(b.other, a.other);
      e.snap({ rev: 6, uses: { 'alpha.time': 'ev' }, modules: { alpha: { ports: ALPHA_PORTS.map(p => (p.name === 'time' ? { ...p, rail: null } : p)) } } });
      const c = grab();
      assert.notEqual(c.uses, a.uses); assert.deepEqual(c.uses, { 'alpha.time': 'ev' });
      assert.notEqual(c.bindings, a.bindings); assert.equal(c.bindings[0].variable, 'ev'); assert.equal(c.bindings[0].bound, false);
      assert.equal(c.vars, a.vars, 'the variables did not change');
      e.snap({ rev: 7, unplugged: ['alpha'] });
      assert.notEqual(grab().unplugged, c.unplugged);
      e.snap({ rev: 8, vars: ['ev', 'out', 'time'] });
      assert.notEqual(grab().vars, c.vars);
   });

   await check('use, plug, unplug from the command line: sent for the focused card, a refusal says why, a bad line stays open', () => {
      const e = ready(); focus(e, 2);
      cmdLine(e, 'use time pointer_pos');
      assert.deepEqual(e.sent.cmds.at(-1), { id: 1, op: 'use', module: 'alpha', port: 'time', variable: 'pointer_pos' });
      assert.deepEqual(e.core.inspect.pending.map(p => [p.op, p.module]), [['use', 'alpha']]);
      cmdLine(e, 'use time'); assert.deepEqual(e.sent.cmds.at(-1), { id: 2, op: 'use', module: 'alpha', port: 'time', variable: null }, 'no variable: back to the default');
      cmdLine(e, 'unplug'); assert.deepEqual(e.sent.cmds.at(-1), { id: 3, op: 'plug', module: 'alpha', on: false });
      cmdLine(e, 'plug'); assert.deepEqual(e.sent.cmds.at(-1), { id: 4, op: 'plug', module: 'alpha', on: true });
      const n = e.core.inspect.toasts.length;
      e.ack(1, true); e.ack(2, true); e.ack(3, true); e.ack(4, true);
      assert.equal(e.core.inspect.toasts.length, n, 'an ok ack says nothing while live');
      assert.equal(e.core.inspect.pending.length, 0);
      cmdLine(e, 'use time nope'); e.ack(5, false, "no variable 'nope'");
      assert.match(stateOf(e, 2).notice, /^use refused: no variable 'nope'$/);
      cmdLine(e, 'unplug'); e.ack(6, false, 'no module'); assert.match(stateOf(e, 2).notice, /^plug refused: no module$/);
      const sent = e.sent.cmds.length;
      for (const bad of ['use', 'use Time x', 'use time Pos', 'use a b c', 'plug now', 'unplug it', 'rail x', 'kind event', 'undock']) {
         e.key('Escape'); e.type(bad); e.key('Enter');
         assert.equal(e.core.inspect.command, bad, `${bad}: the line stays open`);
         assert.match(stateOf(e, 2).notice, /usage: |bad name|unknown command/, bad);
         e.key('Escape');
      }
      assert.equal(e.sent.cmds.length, sent, 'nothing sent for a bad line (the rail commands are gone)');
      // no card focused: no command
      e.key('Escape'); e.key('Escape');
      assert.equal(e.core.debug.focus, null);
      e.key('Escape'); e.type('use time good'); e.key('Enter');
      assert.equal(e.sent.cmds.length, sent); assert.ok(e.core.inspect.toasts.some(t => /no card is focused/.test(t)));
   });

   await check('use and plug acked while paused only apply on the resume: "applies when you resume" until the head shows them', () => {
      const e = ready(); focus(e, 2);
      e.snap({ rev: 2, paused: true, playhead: 5, window: [0, 5] });
      cmdLine(e, 'use time good'); e.ack(1, true);
      assert.match(e.core.inspect.toasts.at(-1), /use time good: applies when you resume/);
      assert.deepEqual(stateOf(e, 2).queued, [{ what: 'use time good', note: 'applies when you resume' }]);
      cmdLine(e, 'unplug'); e.ack(2, true);
      assert.deepEqual(stateOf(e, 2).queued.map(q => q.what), ['use time good', 'plug off']);
      assert.deepEqual(stateOf(e, 3).queued, [], 'only for its own card');
      e.advance(30000); e.frame();
      assert.equal(stateOf(e, 2).queued.length, 2, 'paused: still waiting however long');
      e.snap({ rev: 3, paused: false, playhead: null });
      e.advance(500); assert.equal(stateOf(e, 2).queued.length, 2, 'resumed, the head does not show them yet (a grace of a few seconds)');
      e.snap({ rev: 4, uses: { 'alpha.time': 'good' } });
      assert.deepEqual(stateOf(e, 2).queued.map(q => q.what), ['plug off'], 'the use is in the head: done');
      e.snap({ rev: 5, unplugged: ['alpha'] });
      assert.deepEqual(stateOf(e, 2).queued, []);
      // resumed and never shown (the card went, the entry was dropped): the wait lapses after the grace
      const h = ready(); focus(h, 2);
      h.snap({ rev: 2, paused: true, playhead: 5, window: [0, 5] });
      cmdLine(h, 'unplug'); h.ack(1, true); h.snap({ rev: 3, paused: false, playhead: null });
      h.advance(1500); assert.equal(stateOf(h, 2).queued.length, 1); h.advance(2000); assert.equal(stateOf(h, 2).queued.length, 0);
      // a refused one is not queued, and a live one is not shown as waiting
      const f = ready(); focus(f, 2);
      f.snap({ rev: 2, paused: true, playhead: 5, window: [0, 5] });
      cmdLine(f, 'plug'); f.ack(1, false, 'nope'); assert.deepEqual(stateOf(f, 2).queued, []);
      f.snap({ rev: 3, paused: false, playhead: null });
      cmdLine(f, 'unplug'); f.ack(2, true); assert.deepEqual(stateOf(f, 2).queued, []);
      // a reset of a use is done when the entry is gone; a pairing forgets what was waiting
      const g = ready(); focus(g, 2);
      g.snap({ rev: 2, paused: true, playhead: 5, window: [0, 5], uses: { 'alpha.time': 'good' } });
      cmdLine(g, 'use time'); g.ack(1, true); assert.equal(stateOf(g, 2).queued[0].what, 'use time');
      g.snap({ rev: 3, uses: {} }); assert.deepEqual(stateOf(g, 2).queued, []);
      cmdLine(g, 'use time out'); g.ack(2, true); assert.equal(stateOf(g, 2).queued.length, 1);
      g.emit('pair', {}); assert.deepEqual(stateOf(g, 2).queued, []);
   });

   await check('undo after an own rm: the card comes back with its uses and unplugged state, the removal is silent, the dirty text returns', () => {
      const e = ready(); focus(e, 3);
      e.snap({ rev: 2, uses: { 'beta.x': 'out', 'beta.y': 'good', 'alpha.time': 'good' }, unplugged: ['beta'],
         modules: { beta: { ports: [{ name: 'x', dir: 'in', kind: 'state', type: 'any', rail: null }] } } });
      e.type('Q');
      cmdLine(e, 'rm'); cmdLine(e, 'rm'); assert.equal(e.sent.cmds.at(-1).op, 'rmModule'); e.ack(1, true);
      e.snap({ rev: 3, geometry: { cards: { alpha: { slot: 2 } } }, uses: { 'alpha.time': 'good' }, unplugged: [] });
      assert.ok(!e.core.inspect.toasts.some(t => /removed by the runtime/.test(t)), 'our own rm is silent');
      focus(e, 2); cmdLine(e, 'undo');
      assert.deepEqual(e.sent.cmds.at(-1), { id: 2, op: 'addModule', module: 'beta', source: 'const b = 2;' }); e.ack(2, true);
      e.snap({ rev: 4, geometry: { cards: { alpha: { slot: 2 }, beta: { slot: 3 } } }, modules: { beta: { ver: 1, status: 'ok', error: null, editError: null, source: 'const b = 2;', ports: [] } } });
      assert.deepEqual(e.sent.cmds.slice(2), [{ id: 3, op: 'use', module: 'beta', port: 'x', variable: 'out' }, { id: 4, op: 'use', module: 'beta', port: 'y', variable: 'good' }, { id: 5, op: 'plug', module: 'beta', on: false }],
         'a use per key (the other card\'s is not touched), then plug off');
      assert.equal(e.text('beta'), 'Qconst b = 2;'); assert.equal(e.core.inspect.card('beta').buffer.dirty, true);
      // a card with no uses and plugged sends nothing more than its addModule
      const f = ready(); focus(f, 3); cmdLine(f, 'rm'); cmdLine(f, 'rm'); f.ack(1, true);
      f.snap({ rev: 3, geometry: { cards: { alpha: { slot: 2 } } } });
      focus(f, 2); cmdLine(f, 'undo'); f.ack(2, true);
      f.snap({ rev: 4, geometry: { cards: { alpha: { slot: 2 }, beta: { slot: 3 } } }, modules: { beta: { ver: 1, status: 'ok', error: null, editError: null, source: 'const b = 2;', ports: [] } } });
      assert.equal(f.sent.cmds.length, 2);
   });

   await check('rename of a card by this IDE: the buffer moves, and so do its uses (the runtime moves the keys, the IDE shows them)', () => {
      const e = ready(); focus(e, 3);
      e.snap({ rev: 2, uses: { 'beta.x': 'out' }, unplugged: ['beta'] });
      e.type('R'); cmdLine(e, 'rename gamma'); e.ack(1, true);
      e.snap({ rev: 3, geometry: { cards: { alpha: { slot: 2 }, gamma: { slot: 3 } } }, uses: { 'gamma.x': 'out' }, unplugged: ['gamma'],
         modules: { gamma: { ver: 1, status: 'ok', error: null, editError: null, source: 'const b = 2;', ports: [] } } });
      assert.equal(e.text('gamma'), 'Rconst b = 2;');
      assert.deepEqual([e.frame().uses, e.frame().unplugged], [{ 'gamma.x': 'out' }, ['gamma']]);
      assert.equal(e.sent.cmds.length, 1, 'nothing is re-sent: the runtime did it');
      assert.equal(stateOf(e, 3).unplugged, true);
   });

   await check('1000 random events and frames leave a valid state and never throw', () => {
      const e = ready();
      let seed = 7; const rnd = n => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
      const keys = ['a', 'b', ' ', 'Enter', 'Backspace', 'Escape', 'ArrowUp', 'ArrowDown', 'Tab', 'Home', 'x'];
      for (let i = 0; i < 1000; i++) {
         const r = rnd(10);
         if (r < 5) e.key(keys[rnd(keys.length)], rnd(4) === 0 ? { c: true } : {});
         else if (r === 5) e.btn(rnd(2) ? 'down' : 'up');
         else if (r === 6) e.emit('in', { ev: { k: 'wheel', dx: rnd(200) - 100, dy: rnd(200) - 100 } });
         else if (r === 7) e.ack(rnd(20), !!rnd(2), 'r');
         else if (r === 8) e.core.inspect.setFocus(rnd(5));
         else e.emit(rnd(2) ? 'pair' : 'release', 'silent');
         e.advance(rnd(300));
         const v = e.frame();
         assert.ok(v.slots.length === 5);
      }
      for (const c of ['alpha', 'beta']) {
         const b = e.core.inspect.card(c).buffer;
         assert.ok(b.row >= 0 && b.row < b.lines.length && b.col <= b.lines[b.row].length);
      }
   });


   // ---- the timeline keys against a real runtime, `use` and `plug`, and full slots ----------------------------------------------------

   // A fake link wired to a real Runtime: what the IDE sends is handled by it, and its snapshots come back.
   const SENDER = "const time = input('time', 'state', 'time'); const out = output('out', 'state', 'num');\nconst S = state({ n: 0 });\ntime.on(() => { S.n++; out.set(S.n); });\n";
   const withRuntime = () => {
      const rt = new Rt.Runtime({ seed: 1 });
      const run = (op, fields) => { const r = rt.handle({ id: 900, op, ...fields }); assert.equal(r.ok, true, `${op}: ${r.reason}`); };
      run('addModule', { module: 'send', source: SENDER });
      for (let i = 0; i < 300; i++) rt.step();
      let e, inSnap = false, owed = [];
      // (The real link answers later: a command that the IDE sends while it applies a snapshot is answered after it.)
      const pump = () => {
         inSnap = true; try { e.snap(rt.snapshot()); } finally { inSnap = false; }
         const later = owed; owed = []; later.forEach(f => f());
      };
      e = setup({ onCmd: c => {
         const ack = rt.handle(c), answer = () => { e.ack(c.id, ack.ok, ack.reason); pump(); };
         if (inSnap) owed.push(answer); else answer();
      } });
      e.core.setActive(true); e.emit('pair', {}); rt.full(); pump(); e.frame();
      return { e, rt, pump, run, steps: n => { for (let i = 0; i < n; i++) rt.step(); pump(); e.frame(); } };
   };

   await check('Mod+P pauses the runtime, the wheel scrubs and the rails show what railsAt says at the playhead, Mod+P resumes, Mod+. plays', () => {
      const { e, rt, pump, steps } = withRuntime();
      const live = e.core.inspect.rails.out.value;
      assert.equal(live, 300);
      e.key('p', { c: true }); e.frame();
      assert.equal(rt.bus.paused, true, 'the runtime is paused');
      assert.equal(e.core.inspect.clock.paused, true);
      const t0 = e.core.inspect.clock.playhead;
      assert.equal(t0, rt.playhead); assert.ok(t0 > 4.9 && t0 <= 5.01, 'at the end of the tape: ' + t0);
      assert.equal(e.frame().paused, true);
      // A swipe of -200 units (2 s) back: the playhead moves, the runtime seeks, and the values are the tape's.
      e.emit('in', { ev: { k: 'wheel', dx: -200, dy: 0 } }); e.advance(100); e.frame(); pump(); e.frame();
      assert.equal(e.sent.cmds.at(-1).op, 'seek');
      const p = rt.playhead, v = e.frame();
      assert.ok(Math.abs(p - (t0 - 2)) < 1e-6, `2 s back: ${p} vs ${t0}`); assert.equal(v.playhead, p);
      const at = Pl.railsAt(rt.recorder, p);
      assert.equal(e.core.inspect.rails.out.value, at.out.value, 'the IDE shows the value railsAt gives there');
      assert.equal(e.core.inspect.rails.out.value, live - 120, 'the sender had counted 120 fewer (2 s)');
      assert.equal(e.core.inspect.rails.time.seq, at.time.seq);
      e.emit('in', { ev: { k: 'wheel', dx: -100000, dy: 0 } }); e.advance(100); e.frame(); pump(); e.frame();
      assert.equal(rt.playhead, rt.recorder.range().t0, 'clamped to the window start');
      // (At the very start of the tape the sender's rail is not on it yet; the runtime shows its live value there, which is the runtime's affair.)
      // Mod+. plays from the playhead (the runtime moves it one step per step), and again stops.
      e.key('.', { c: true }); e.frame();
      assert.equal(rt.playing, true);
      steps(30); assert.ok(rt.playhead > rt.recorder.range().t0 + 0.4, 'the playhead moved on');
      assert.equal(e.core.inspect.rails.out.value, Pl.railsAt(rt.recorder, rt.playhead).out.value, 'and the values with it');
      e.key('.', { c: true }); e.frame(); assert.equal(rt.playing, false);
      // Mod+P resumes: live again, the values are the bus's, the playhead is gone.
      e.key('p', { c: true }); e.frame();
      assert.equal(rt.bus.paused, false); assert.equal(rt.playhead, null);
      steps(10);
      assert.equal(e.core.inspect.clock.paused, false); assert.equal(e.frame().playhead, null);
      assert.equal(e.core.inspect.rails.out.value, rt.bus.rails.get('out').value);
      // A swipe while live is ignored (no seek).
      const n = e.sent.cmds.length; e.emit('in', { ev: { k: 'wheel', dx: -300, dy: 0 } }); e.advance(100); e.frame();
      assert.equal(e.sent.cmds.length, n, 'no scrub while live');
   });

   // A receiver with three inputs: `out` is the sender's variable, `pos` and `lost` have no variable of their own.
   const RECV = "const out = input('out', 'state', 'num'); const pos = input('pos', 'state', 'vec3'); const lost = input('lost', 'state', 'any');\n";

   await check('against a real runtime: bindings, `use` (refusals from the runtime), `unplug`/`plug`, a use queued while paused, `rename`, `rm` and `undo` keep the uses', () => {
      const { e, rt, run, steps } = withRuntime();
      run('addModule', { module: 'recv', source: RECV }); steps(2);
      let slot = rt.geometry.cards.recv.slot; focus(e, slot);
      const state = () => e.frame().slots[slot].state;
      const row = (port, b = state().bindings) => b.find(x => x.port === port);
      assert.deepEqual([row('out').variable, row('out').isDefault, row('out').bound, row('out').reason], ['out', true, true, null], 'the same name binds by itself');
      assert.deepEqual([row('pos').variable, row('pos').bound], ['pos', false]); assert.match(row('pos').reason, /^waiting: no variable 'pos' yet/);
      assert.equal(state().unplugged, false);
      // `use` binds another variable; the head shows it a step later
      cmdLine(e, 'use pos pointer_pos'); assert.deepEqual(e.sent.cmds.at(-1), { id: e.sent.cmds.at(-1).id, op: 'use', module: 'recv', port: 'pos', variable: 'pointer_pos' });
      assert.equal(e.core.inspect.pending.length, 0, 'acked'); steps(2);
      assert.deepEqual([row('pos').variable, row('pos').isDefault, row('pos').bound, row('pos').reason], ['pointer_pos', false, true, null]);
      assert.equal(e.frame().uses['recv.pos'], 'pointer_pos');
      // refusals say why
      cmdLine(e, 'use lost nope'); assert.match(state().notice, /^use refused: no variable 'nope'/);
      cmdLine(e, 'use pos out'); assert.match(state().notice, /^use refused: type mismatch/);
      cmdLine(e, 'use out time'); assert.match(state().notice, /^use refused: /, 'a kind or type that does not fit');
      // unplug: no docks at all; plug: back
      cmdLine(e, 'unplug'); steps(2);
      assert.equal(state().unplugged, true); assert.deepEqual(state().bindings.map(x => x.bound), [false, false, false]);
      assert.equal(row('out').reason, 'unplugged'); assert.deepEqual(e.frame().unplugged, ['recv']);
      cmdLine(e, 'plug'); steps(2);
      assert.equal(state().unplugged, false); assert.equal(row('out').bound, true); assert.equal(row('pos').variable, 'pointer_pos', 'the use survived the unplug');
      // while paused the use is queued: acked, shown after the resume
      e.key('p', { c: true }); e.frame();
      cmdLine(e, 'use pos gaze_hit');
      assert.match(e.core.inspect.toasts.at(-1), /use pos gaze_hit: applies when you resume/);
      assert.deepEqual(state().queued.map(q => q.what), ['use pos gaze_hit']);
      assert.equal(e.frame().uses['recv.pos'], 'pointer_pos', 'not applied yet');
      e.key('p', { c: true }); e.frame(); steps(3);
      assert.equal(row('pos').variable, 'gaze_hit'); assert.deepEqual(state().queued, []);
      // rename: the runtime moves the keys; the IDE shows them
      cmdLine(e, 'rename recv2'); steps(3);
      slot = rt.geometry.cards.recv2.slot; focus(e, slot);
      assert.deepEqual(Object.keys(e.frame().uses), ['recv2.pos']); assert.equal(row('pos').variable, 'gaze_hit');
      // rm twice drops them; undo brings the card back and the IDE sends `use` again (and `plug off` for an unplugged card)
      cmdLine(e, 'unplug'); steps(2);
      cmdLine(e, 'rm'); cmdLine(e, 'rm'); steps(3);
      assert.equal(e.core.inspect.card('recv2'), null); assert.deepEqual([e.frame().uses, e.frame().unplugged], [{}, []]);
      focus(e, e.core.inspect.card('send').slot); cmdLine(e, 'undo'); steps(4);
      slot = rt.geometry.cards.recv2.slot; focus(e, slot);
      assert.deepEqual([e.frame().uses, e.frame().unplugged], [{ 'recv2.pos': 'gaze_hit' }, ['recv2']], 'uses and the plug state are back');
      cmdLine(e, 'plug'); steps(2);
      assert.deepEqual([row('pos').variable, row('pos').bound], ['gaze_hit', true]);
   });

   // A ready IDE with all five card slots taken.
   const full = () => {
      const e = ready();
      e.snap({ rev: 5, geometry: { cards: { alpha: { slot: 2 }, beta: { slot: 3 }, c1: { slot: 0 }, c2: { slot: 1 }, c3: { slot: 4 } } },
         modules: { c1: { ver: 1, status: 'ok', ports: [], source: '1' }, c2: { ver: 1, status: 'ok', ports: [], source: '2' }, c3: { ver: 1, status: 'ok', ports: [], source: '3' } } });
      e.frame();
      return e;
   };

   await check('full slots: a sixth `card` gives a notice and sends nothing; the commands on their way count; `undo` too', () => {
      const e = full(); focus(e, 2);
      const sent = () => e.sent.cmds.length;
      cmdLine(e, 'card six');
      assert.equal(sent(), 0, 'no command'); assert.match(stateOf(e, 2).notice, /all 5 card slots are taken/);
      // With slots free (the sixth is counted with the commands on their way too).
      const f = ready(); focus(f, 2);
      cmdLine(f, 'card gamma'); cmdLine(f, 'card delta'); cmdLine(f, 'card eps'); cmdLine(f, 'card zeta');
      assert.equal(f.sent.cmds.filter(c => c.op === 'addModule').length, 3, 'two cards and three on their way make five');
      assert.match(stateOf(f, 2).notice, /card slots/);
      // `undo` of a removed card needs a slot as well.
      const g = full(); focus(g, 2);
      cmdLine(g, 'rm'); cmdLine(g, 'rm'); g.ack(1, true);
      g.snap({ rev: 6, geometry: { cards: { beta: { slot: 3 }, c1: { slot: 0 }, c2: { slot: 1 }, c3: { slot: 4 } } } });
      g.snap({ rev: 7, geometry: { cards: { beta: { slot: 3 }, c1: { slot: 0 }, c2: { slot: 1 }, c3: { slot: 4 }, c4: { slot: 2 } } }, modules: { c4: { ver: 1, status: 'ok', ports: [], source: '4' } } });
      focus(g, 3); const n = g.sent.cmds.length; cmdLine(g, 'undo');
      assert.equal(g.sent.cmds.length, n, 'no slot for it'); assert.match(stateOf(g, 3).notice, /card slots/);
   });

   // ---- paused: the scene is the past; Mod+Shift+Enter continues from here ----
   const PAUSED = (await load('js/scenes/rails/lifecycle.js')).PAUSED;        // (the runtime's word for a refused commit: the key says the same)
   assert.equal(PAUSED, 'paused: Mod+Shift+Enter continues from here, Mod+P returns to now');
   const pausedReady = (playhead = 5) => { const e = ready(); e.snap({ rev: 2, paused: true, playhead, window: [0, 10] }); e.frame(); return e; };

   await check('Mod+Shift+Enter paused sends exactly resumeHere; live sends nothing and says so', () => {
      const e = pausedReady(); focus(e, 2);
      e.key('Enter', { c: true, s: true });
      assert.deepEqual(e.sent.cmds, [{ id: 1, op: 'resumeHere' }]);
      e.ack(1, true);
      const l = ready(); focus(l, 2);
      l.key('Enter', { c: true, s: true });
      assert.equal(l.sent.cmds.length, 0, 'live: nothing to continue');
      assert.match(l.core.inspect.toasts.at(-1), /live already/);
      // It needs no focused card (the world, not a card, is continued), and not while the command line is open.
      const n = pausedReady(); n.key('Enter', { c: true, s: true }); assert.deepEqual(n.sent.cmds, [{ id: 1, op: 'resumeHere' }]);
      const c = pausedReady(); focus(c, 2); c.key('Escape'); c.key('Enter', { c: true, s: true }); assert.equal(c.sent.cmds.length, 0, 'the command line is open');
   });

   await check('Mod+Enter paused sends nothing, says the paused text, and the edit stays in the buffer; live it commits', () => {
      const e = pausedReady(); focus(e, 2); e.type('Z');
      e.key('Enter', { c: true });
      assert.equal(e.sent.cmds.length, 0);
      assert.equal(e.core.inspect.toasts.at(-1), PAUSED);
      assert.equal(e.text('alpha'), 'Zconst a = 1;'); assert.equal(e.core.inspect.card('alpha').buffer.dirty, true);
      e.snap({ rev: 3, paused: false, playhead: null }); e.frame();
      e.key('Enter', { c: true });
      assert.deepEqual(e.sent.cmds.map(c => c.op), ['commit']);
   });

   await check('the command line: `here` continues from here while paused and says "live already" live, next to pause, live and play', () => {
      const e = pausedReady(); focus(e, 2);
      cmdLine(e, 'here'); assert.deepEqual(e.sent.cmds.at(-1), { id: 1, op: 'resumeHere' });
      const l = ready(); focus(l, 2); cmdLine(l, 'here');
      assert.equal(l.sent.cmds.length, 0); assert.match(l.core.inspect.toasts.at(-1), /live already/);
      cmdLine(l, 'here now'); assert.match(l.core.inspect.toasts.at(-1), /usage: here/);
   });

   await check('after resumeHere the IDE goes live from the snapshot and shows the runtime\'s notice; a refusal is shown with its reason', () => {
      const e = pausedReady(); focus(e, 2);
      e.key('Enter', { c: true, s: true }); e.ack(1, true);
      e.snap({ rev: 3, t: 5, paused: false, playhead: null, playing: false, window: [5, 5], notices: [{ id: 7, n: 300, text: 'continued from 5.0 s: what was recorded after it is gone' }] });
      const v = e.frame();
      assert.equal(v.paused, false); assert.equal(v.playhead, null); assert.deepEqual(v.window, [5, 5]);
      assert.match(e.core.inspect.toasts.at(-1), /^continued from 5\.0 s/);
      assert.equal(e.text('alpha'), 'const a = 1;', 'the buffer is the running source');
      // a card whose running source differs in the snapshot: the buffer follows it (as for any change under a clean buffer)
      e.snap({ rev: 4, modules: { alpha: { ver: 2, status: 'ok', error: null, editError: null, ports: ALPHA_PORTS, draw: [], logs: [], calls: 6, source: 'const a = 9;' } } });
      assert.equal(e.text('alpha'), 'const a = 9;'); assert.equal(e.core.inspect.card('alpha').buffer.dirty, false);
      const r = pausedReady(); r.key('Enter', { c: true, s: true }); r.ack(1, false, 'the past cannot be rebuilt: x');
      assert.match(r.core.inspect.toasts.at(-1), /resumeHere refused: the past cannot be rebuilt: x/);
   });

   await check('the IDE has no ghost: no `ghost` or `adopt` in the IDE files, and the view, the card and the inspector have none', async () => {
      const fs = require('node:fs'), path = require('node:path');
      const root = path.join(__dirname, '..', 'js', 'scenes');
      const files = [path.join(root, 'rails.js')];
      for (const f of fs.readdirSync(path.join(root, 'rails'))) if (f.endsWith('.js')) files.push(path.join(root, 'rails', f));
      const hits = files.filter(f => /ghost|adopt/i.test(fs.readFileSync(f, 'utf8'))).map(f => path.basename(f));
      assert.deepEqual(hits, [], 'ghost/adopt is gone from the Rails code');
      const e = pausedReady();
      assert.ok(!('ghost' in e.frame()) && !('ghost' in e.core.inspect));
      assert.ok(e.sent.cmds.every(c => c.op !== 'ghost' && c.op !== 'adopt'));
   });

   // ---- the bus window and the plug gesture ------------------------------------------------------------------------------------------------

   const R = (kind, type, value, seq, pubs = [], subs = [], extra = {}) => ({ kind, type, value, seq, pubs, subs, stale: false, contested: false, tail: [], ...extra });
   const BUS_RAILS = () => ({
      time: R('state', 'time', { t: 1, dt: 0.016, n: 60 }, 60, [['dev:clock', 'time']], [['alpha', 'time']]),
      gaze_hit: R('state', 'vec3', [0.1, 0, 0.234], 5, [['dev:gaze', 'hit']]), gaze_on: R('state', 'bool', true, 5, [['dev:gaze', 'on']]),
      pointer_pos: R('state', 'vec3', [0, 0, 0], 0, [['dev:pointer', 'pos']]), pointer_down: R('state', 'bool', false, 0, [['dev:pointer', 'down']]),
      out: R('state', 'any', 5.5, 100, [['alpha', 'out']], [['beta', 'x']]), good: R('state', 'any', 'hi', 3), ev: R('event', 'num', undefined, 7, [], [], { tail: [{ seq: 7, t: 1, v: 42, by: 'x' }] }),
      zed: R('state', 'vec3', [1, 2, 3], 1, [], [], { stale: true, contested: true }),
   });
   const BUS_PORTS = [{ name: 'time', dir: 'in', kind: 'state', type: 'time', rail: 'time' }, { name: 'pos', dir: 'in', kind: 'state', type: 'vec3', rail: null },
      { name: 'lost', dir: 'in', kind: 'state', type: 'any', rail: 'good' }, { name: 'out', dir: 'out', kind: 'state', type: 'any', rail: 'out' }];
   const BUS_VARS = ['ev', 'gaze_hit', 'gaze_on', 'good', 'out', 'pointer_down', 'pointer_pos', 'time', 'zed'];
   // An IDE with alpha (slot 2, three inputs, one using `good`) and beta (slot 3), the whole bus, the gaze straight ahead, and alpha focused.
   const busReady = (opts = {}) => {
      const e = ready(opts);
      e.snap({ rev: 2, t: 1, geometry: { cards: { alpha: { slot: 2 }, beta: { slot: 3 } } }, vars: BUS_VARS, uses: { 'alpha.lost': 'good' }, unplugged: opts.unplugged || [], rails: BUS_RAILS(),
         modules: { alpha: { ver: 1, status: 'ok', error: null, editError: null, ports: BUS_PORTS, draw: [], logs: [], calls: 5, source: 'const a = 1;' } } });
      focus(e, 2);
      return e;
   };
   const RAD = Math.PI / 180;
   // The gaze at a yaw (degrees) and a height above the eye (metres, on the cards' cylinder).
   const gaze = (e, yaw, h) => { const a = yaw * RAD; e.core.inspect.aim({ o: [0, 1.6, 0], d: unit([Math.sin(a) * 1.25, h, -Math.cos(a) * 1.25]) }); };
   const BUSH = -0.40, PLUGH = -0.30;                       // heights of the bus and of the plug of a card
   // The gaze at a pixel of the open bus window.
   const onWin = (e, px, py) => {
      const ws = e.core.inspect.ws, m = L.busWindowFrame(ws, e.frame().bus.frameYaw), x = (px / 1024 - 0.5) * 0.9, y = (0.5 - py / 640) * 0.56;
      const q = [m[12] + m[0] * x + m[4] * y, m[13] + m[1] * x + m[5] * y, m[14] + m[2] * x + m[6] * y];
      e.core.inspect.aim({ o: [...ws.origin], d: unit(q.map((v, i) => v - ws.origin[i])) }); e.frame();
   };
   const inRow = i => 92 + 36 * i + 18, varRow = i => 264 + 36 * i + 18;
   const modB = e => { e.key('b', { c: true }); e.frame(); };
   const bus = e => e.frame().bus;
   const useCmds = e => e.sent.cmds.filter(c => c.op === 'use');
   const click = e => { e.btn('down'); e.btn('up'); e.frame(); };
   const pointerDevs = e => e.sent.devs.filter(d => d.id === 'pointer');

   await check('the bus window: Mod+B opens it centred at the gaze yaw and closes it; a closed window is a constant empty view; text keys are not typed into the card', () => {
      const e = busReady();
      const closed = bus(e);
      assert.deepEqual([closed.open, closed.rows, closed.inputs, closed.footer, closed.header], [false, [], [], null, null]); assert.equal(bus(e), closed, 'the same constant');
      gaze(e, 20, BUSH); e.frame();
      modB(e); let v = e.frame();
      assert.equal(v.bus.open, true); assert.equal(v.busOpen, true);
      assert.ok(Math.abs(v.bus.frameYaw - 20 * RAD) < 1e-9, 'centred at the gaze: ' + v.bus.frameYaw);
      assert.equal(e.frame().bus.frameYaw, v.bus.frameYaw, 'and it stays where it opened');
      gaze(e, -30, BUSH); e.frame(); assert.ok(Math.abs(bus(e).frameYaw - 20 * RAD) < 1e-9, 'the gaze moving off does not drag it');
      e.key('a'); assert.equal(e.text('alpha'), 'const a = 1;', 'the letter went to the filter, not the card');
      assert.equal(bus(e).filter, 'a');
      e.key('b', { c: true }, true); assert.equal(bus(e).open, true, 'a repeat is ignored');
      modB(e); assert.equal(bus(e).open, false); assert.equal(e.frame().busOpen, false);
      modB(e); assert.equal(bus(e).filter, '', 'a new opening starts clean'); assert.ok(Math.abs(bus(e).frameYaw + 30 * RAD) < 1e-9, 'at the new gaze');
   });

   await check('the bus window shows the header, the focused card\'s inputs, and the variables alphabetical with the built-ins last', () => {
      const e = busReady();
      modB(e); const b = bus(e);
      assert.deepEqual(b.header, { title: 'BUS · 9 variables', at: null }); assert.deepEqual(b.card, { name: 'alpha', unplugged: false });
      assert.deepEqual(b.inputs.map(i => [i.port, i.variable, i.isDefault, i.bound, i.pending]), [['time', 'time', true, true, false], ['pos', 'pos', true, false, false], ['lost', 'good', false, true, false]]);
      assert.match(b.inputs[1].reason, /^waiting/);
      assert.deepEqual(b.rows.map(r => r.id), ['ev', 'good', 'out', 'zed', 'gaze_hit', 'gaze_on', 'pointer_down', 'pointer_pos', 'time'], 'user variables A-Z, then the built-ins A-Z');
      const row = id => b.rows.find(r => r.id === id);
      assert.deepEqual([row('out').kind, row('out').type, row('out').value, row('out').pubs, row('out').takers, row('out').stale, row('out').contested, row('out').builtin], ['state', 'any', '5.5', ['alpha'], ['beta'], false, false, false]);
      assert.deepEqual([row('zed').value, row('zed').stale, row('zed').contested], ['[1, 2, 3]', true, true]);
      assert.equal(row('ev').value, '42', 'an event shows its last message'); assert.equal(row('good').value, '"hi"');
      assert.deepEqual([row('time').value, row('time').pubs, row('time').takers, row('time').builtin], ['t 1', ['clock'], ['alpha'], true], 'a device is its name');
      assert.equal(row('gaze_hit').value, '[0.1, 0, 0.23]'); assert.equal(row('gaze_on').value, 'true');
      assert.deepEqual(b.selected, { section: 'inputs', port: 'pos', variable: 'ev' }, 'the first input that waits, not time'); assert.equal(b.section, 'inputs'); assert.equal(b.scroll, 0); assert.equal(b.hover.section, 'vars', 'the gaze is on the table (it opened there)'); gaze(e, -60, 0); assert.equal(bus(e).hover, null);
      // no card focused: only the variables
      e.core.inspect.setFocus(0); const f = e.frame(); assert.equal(f.bus.card, null); assert.deepEqual(f.bus.inputs, []); assert.equal(f.bus.section, 'vars');
      // an unplugged card says so
      const u = busReady({ unplugged: ['alpha'] }); modB(u); assert.deepEqual(bus(u).card, { name: 'alpha', unplugged: true });
      // while paused the header says where
      e.snap({ rev: 9, paused: true, playhead: 6.8, window: [0, 10] }); e.frame(); assert.deepEqual(bus(e).header, { title: 'BUS · 9 variables', at: 'at −3.2 s' });
   });

   await check('the filter: typed letters narrow the variables (name contains, any case), Backspace shortens it, the header count stays', () => {
      const e = busReady(); modB(e);
      e.type('PO'); let b = bus(e);
      assert.equal(b.filter, 'po'); assert.equal(b.section, 'vars', 'typing goes to the variables'); assert.deepEqual(b.rows.map(r => r.id), ['pointer_down', 'pointer_pos']);
      assert.equal(b.header.title, 'BUS · 9 variables');
      e.key('Backspace'); b = bus(e); assert.equal(b.filter, 'p'); assert.deepEqual(b.rows.map(r => r.id), ['pointer_down', 'pointer_pos']);
      e.key('Backspace'); assert.equal(bus(e).rows.length, 9, 'no filter: everything'); e.type('p');
      e.key(' '); e.key('-'); assert.equal(bus(e).filter, 'p', 'only name characters');
      e.type('q'); assert.deepEqual(bus(e).rows, [], 'nothing matches'); assert.deepEqual(bus(e).selected, { section: 'vars', port: 'pos', variable: null });
      assert.equal(e.text('alpha'), 'const a = 1;');
      e.type('x'.repeat(40)); assert.equal(bus(e).filter.length, 32, 'at most 32 characters');
   });

   await check('the bus window selects, before anything is chosen, the first input with a problem, else the first that is not `time`; a chosen input stays', async () => {
      const BW = await load('js/scenes/rails/busWindow.js');
      const sv = { rails: {}, vars: [], railsRev: 1, paused: false, playhead: null, window: null, rates: null };
      const b = (port, reason = null) => ({ port, dir: 'in', variable: port, isDefault: true, bound: !reason, reason });
      const selected = bindings => { const w = BW.createBusWindow(); w.openAt(0); return { w, port: w.view(sv, { name: 'c', unplugged: false, bindings, pending: [] }, 0).selected.port }; };
      assert.equal(selected([b('time'), b('a'), b('b', 'waiting: no variable \'b\' yet')]).port, 'b', 'a waiting input');
      assert.equal(selected([b('time'), b('a', 'waiting: no variable \'a\' yet'), b('b', 'incompatible: x is event num, b is state num')]).port, 'b', 'incompatible before waiting');
      assert.equal(selected([b('time'), b('a'), b('b')]).port, 'a', 'nothing wrong: not time');
      assert.equal(selected([b('time', 'unplugged'), b('a', 'unplugged')]).port, 'a', 'unplugged is not a problem');
      assert.equal(selected([b('time')]).port, 'time', 'only time');
      assert.equal(selected([]).port, null, 'no inputs');
      const { w } = selected([b('time'), b('a'), b('b', 'waiting: no variable \'b\' yet')]);
      w.key({ op: 'move', dir: 'up' });
      const now = [b('time'), b('a', 'waiting: no variable \'a\' yet'), b('b', 'waiting: no variable \'b\' yet')];
      assert.equal(w.view(sv, { name: 'c', unplugged: false, bindings: now, pending: [] }, 1).selected.port, 'a', 'what the person moved to stays, whatever else is waiting');
      w.key({ op: 'move', dir: 'up' });
      assert.equal(w.view(sv, { name: 'c', unplugged: false, bindings: now.map(x => ({ ...x })), pending: [] }, 2).selected.port, 'time', 'and the person may choose time');
   });

   await check('a variable the runtime sends with value null (paused before it was published) replaces the value the head had: the row is blank', () => {
      const e = busReady(); modB(e);
      assert.equal(bus(e).rows.find(r => r.id === 'out').value, '5.5');
      e.snap({ rev: 30, t: 2, paused: true, playhead: 0.5, window: [0, 5], rails: { out: { kind: 'state', type: 'any', value: null, tail: [], seq: 1 } } });
      assert.equal(bus(e).rows.find(r => r.id === 'out').value, '');
   });

   await check('keys: Tab switches the section, up/down choose, Enter assigns the selected variable to the selected input; the own name is sent as null', () => {
      const e = busReady(); modB(e);
      e.key('ArrowDown'); assert.deepEqual(bus(e).selected, { section: 'inputs', port: 'lost', variable: 'ev' }, 'down in the inputs');
      e.key('ArrowDown'); assert.equal(bus(e).selected.port, 'lost', 'clamped at the last'); e.key('ArrowUp'); assert.equal(bus(e).selected.port, 'pos');
      e.key('Tab'); assert.equal(bus(e).section, 'vars');
      e.key('ArrowDown'); e.key('ArrowDown'); e.key('ArrowDown'); assert.equal(bus(e).selected.variable, 'zed'); assert.equal(bus(e).selected.port, 'pos', 'the input stays selected');
      e.key('Enter');
      assert.deepEqual(useCmds(e), [{ id: useCmds(e)[0].id, op: 'use', module: 'alpha', port: 'pos', variable: 'zed' }]);
      assert.equal(bus(e).inputs[1].pending, true, 'on its way');
      e.ack(useCmds(e)[0].id, true); assert.equal(bus(e).inputs[1].pending, false); assert.equal(bus(e).footer, null, 'an ok says nothing');
      e.key('Tab'); assert.equal(bus(e).section, 'inputs'); e.key('ArrowUp'); assert.equal(bus(e).selected.port, 'time');
      e.key('Enter'); assert.equal(bus(e).section, 'vars', 'Enter on the inputs goes on to the variables'); assert.equal(useCmds(e).length, 1);
      e.type('time'); e.frame(); e.key('Enter'); assert.deepEqual(useCmds(e).at(-1), { id: useCmds(e).at(-1).id, op: 'use', module: 'alpha', port: 'time', variable: null }, 'the input\'s own name is the default: null');
      // PageDown / PageUp move 9 rows in the variables, and the table scrolls to keep the selection in view
      const f = busReady(); modB(f); f.key('Tab'); f.key('PageDown'); assert.equal(bus(f).selected.variable, 'time', 'the 9th row'); f.key('PageUp'); assert.equal(bus(f).selected.variable, 'ev');
   });

   await check('Backspace or Delete on an input puts it back on its own name; on one that is already there it only says so', () => {
      const e = busReady(); modB(e);
      e.key('ArrowDown'); e.key('ArrowDown'); assert.equal(bus(e).selected.port, 'lost');
      e.key('Backspace'); assert.deepEqual(useCmds(e).at(-1), { id: useCmds(e).at(-1).id, op: 'use', module: 'alpha', port: 'lost', variable: null });
      e.key('Delete'); assert.equal(useCmds(e).length, 2, 'Delete as well');
      e.key('ArrowUp'); e.key('Backspace'); assert.equal(useCmds(e).length, 2, 'pos is on its own name already');
      assert.deepEqual(bus(e).footer, { text: 'pos already takes its own name', kind: 'info' });
      // with a filter Backspace is the filter's; in the variables it resets nothing
      e.type('o'); e.key('Backspace'); assert.equal(bus(e).filter, ''); assert.equal(useCmds(e).length, 2);
      e.key('Backspace'); assert.equal(useCmds(e).length, 2, 'the variables section: nothing to reset');
   });

   await check('gaze: the row under it is the hover; a press on an input row selects it, on a variable row assigns it; Enter does the same; none of it is pointer.down', () => {
      const e = busReady(); modB(e); const sentBefore = e.sent.devs.length;
      onWin(e, 400, inRow(1)); assert.deepEqual(bus(e).hover, { section: 'inputs', port: 'pos', variable: null });
      onWin(e, 400, inRow(3)); assert.equal(bus(e).hover, null, 'a row there is no input on');
      onWin(e, 400, 30); assert.equal(bus(e).hover, null, 'the header'); onWin(e, 400, varRow(1)); assert.deepEqual(bus(e).hover, { section: 'vars', port: null, variable: 'good' });
      onWin(e, 400, inRow(1)); click(e); assert.deepEqual(bus(e).selected, { section: 'inputs', port: 'pos', variable: 'ev' }); assert.equal(useCmds(e).length, 0, 'a press on an input only selects it');
      onWin(e, 700, varRow(3)); assert.equal(bus(e).hover.variable, 'zed'); click(e);
      assert.deepEqual(useCmds(e), [{ id: useCmds(e)[0].id, op: 'use', module: 'alpha', port: 'pos', variable: 'zed' }]); assert.equal(bus(e).selected.variable, 'zed');
      // Enter with the gaze on a row
      onWin(e, 400, inRow(2)); e.key('Enter'); assert.equal(bus(e).selected.port, 'lost'); onWin(e, 400, varRow(4)); e.key('Enter');
      assert.deepEqual(useCmds(e).at(-1), { id: useCmds(e).at(-1).id, op: 'use', module: 'alpha', port: 'lost', variable: 'gaze_hit' });
      // Backspace with the gaze on an input resets that one (whatever is selected)
      onWin(e, 400, inRow(2)); e.key('Backspace'); assert.equal(useCmds(e).at(-1).variable, null); assert.equal(useCmds(e).at(-1).port, 'lost');
      // a press on the blank part of the window, or the header, is the window's too
      onWin(e, 400, 30); click(e); onWin(e, 400, 620); click(e);
      assert.equal(e.sent.devs.length, sentBefore, 'no pointer.down ever');
      assert.deepEqual(pointerDevs(e), []);
      assert.equal(e.core.inspect.held.buttons.length, 0);
   });

   await check('a press outside the window is pointer.down as before, and the window stays open; the wheel and the focus are the window\'s only over it', () => {
      const e = busReady(); gaze(e, 40, BUSH); e.frame(); modB(e); assert.ok(Math.abs(bus(e).frameYaw - 40 * RAD) < 1e-9);
      gaze(e, -20, 0); e.frame();                                                  // over the cards, far from the window
      e.btn('down'); e.frame(); assert.deepEqual(pointerDevs(e), [{ id: 'pointer', port: 'down', value: true }]);
      e.btn('up'); e.frame(); assert.equal(pointerDevs(e).at(-1).value, false); assert.equal(bus(e).open, true, 'an outside press does not close it');
      // the wheel: over the window it moves the selection and not the card; elsewhere it scrolls the card as before
      const f = busReady(); f.core.inspect.card('alpha').buffer.apply({ op: 'set', text: Array.from({ length: 40 }, (_, i) => 'line' + i).join('\n') });
      gaze(f, 0, 0); f.frame(); modB(f); onWin(f, 400, varRow(0));
      f.emit('in', { ev: { k: 'wheel', dx: 0, dy: 100 } }); f.frame();
      assert.equal(bus(f).selected.variable, 'zed', 'three lines down the table the gaze is on'); assert.equal(f.core.inspect.card('alpha').buffer.scroll, 0, 'the card did not scroll');
      onWin(f, 400, inRow(0)); f.emit('in', { ev: { k: 'wheel', dx: 0, dy: 100 } }); f.frame(); assert.equal(bus(f).selected.port, 'lost', 'on the inputs it moves the input (clamped)');
      gaze(f, -50, 0); f.frame(); f.emit('in', { ev: { k: 'wheel', dx: 0, dy: 100 } }); f.frame(); assert.equal(f.core.inspect.card('alpha').buffer.scroll, 3, 'off the window the card scrolls');
   });

   await check('a gaze on the window does not move the focus to the card behind it; off the window it does', () => {
      const e = busReady(); gaze(e, 25, 0); e.frame(); modB(e);
      assert.equal(e.core.debug.focus, 'alpha'); e.advance(100); e.frame();
      onWin(e, 512, 320); for (let i = 0; i < 8; i++) { e.advance(100); e.frame(); }
      assert.equal(e.core.debug.focus, 'alpha', 'beta is behind the window: no dwell');
      assert.equal(e.frame().hover, null);
      modB(e); gaze(e, 25, 0); for (let i = 0; i < 8; i++) { e.advance(100); e.frame(); }
      assert.equal(e.core.debug.focus, 'beta', 'with the window closed the dwell moves it');
   });

   await check('Esc: the filter first, then the variables section, then the window closes; the next Esc opens the command line', () => {
      const e = busReady(); modB(e);
      e.type('po'); assert.equal(bus(e).section, 'vars');
      e.key('Escape'); assert.deepEqual([bus(e).open, bus(e).filter, bus(e).section], [true, '', 'vars'], 'the filter goes');
      e.key('Escape'); assert.deepEqual([bus(e).open, bus(e).section], [true, 'inputs'], 'then the section');
      assert.equal(e.core.inspect.command, null);
      e.key('Escape'); assert.equal(bus(e).open, false, 'then the window'); assert.equal(e.core.inspect.command, null, 'and the command line did not open');
      e.key('Escape'); assert.equal(e.core.inspect.command, '', 'now it does');
      // a card with no inputs: the variables are all there is, so Esc closes
      e.key('Escape'); e.core.inspect.setFocus(3); e.frame(); modB(e); assert.equal(bus(e).section, 'vars'); e.key('Escape'); assert.equal(bus(e).open, false);
      // with the command line open its keys stay its own, and the window does not take them
      e.key('Escape'); modB(e); e.type('use'); assert.equal(e.core.inspect.command, 'use'); assert.equal(bus(e).filter, ''); e.key('Escape'); assert.equal(e.core.inspect.command, null); assert.equal(bus(e).open, true);
   });

   await check('the footer: a refusal shows for 5 s (not on the card), an ok while paused says it applies on the resume, and the pending flag is on the input meanwhile', () => {
      const e = busReady(); modB(e);
      e.key('Tab'); e.type('out'); e.frame(); e.key('Enter');
      const id = useCmds(e).at(-1).id; assert.equal(bus(e).inputs[1].pending, true); assert.equal(bus(e).footer, null);
      e.ack(id, false, 'type mismatch: the port is vec3, the variable is any... no');
      let b = bus(e); assert.deepEqual(b.footer, { text: 'use refused: type mismatch: the port is vec3, the variable is any... no', kind: 'error' }); assert.equal(b.inputs[1].pending, false);
      assert.equal(e.frame().slots[2].state.notice, null, 'the card is not told as well');
      e.advance(4900); e.frame(); assert.ok(bus(e).footer, 'still there at 4.9 s'); e.advance(200); e.frame(); assert.equal(bus(e).footer, null, 'gone at 5.1 s');
      // while paused: acked, applies on the resume
      e.snap({ rev: 9, paused: true, playhead: 5, window: [0, 10] }); e.frame();
      e.key('Enter'); const id2 = useCmds(e).at(-1).id; e.ack(id2, true);
      assert.deepEqual(bus(e).footer, { text: 'use pos out: applies when you resume', kind: 'info' });
      assert.equal(e.frame().slots[2].state.queued[0].note, 'applies when you resume');
      assert.equal(e.core.inspect.toasts.some(t => /applies when you resume/.test(t)), false, 'said in the window, not as a toast');
      // no answer
      e.advance(6000); e.frame(); assert.equal(bus(e).inputs[1].pending, false);
      // a refusal after the window was closed goes to the card as before
      modB(e); e.key('Escape'); e.type('use pos zed'); e.key('Enter'); e.ack(useCmds(e).at(-1).id, false, 'nope'); assert.match(e.frame().slots[2].state.notice, /^use refused: nope/);
   });

   await check('"Enter" with nothing to assign to says what is missing in the footer; with no card focused there is nothing to assign to', () => {
      const e = busReady(); e.core.inspect.setFocus(3); e.frame(); modB(e); e.key('ArrowDown'); e.key('Enter');
      assert.equal(useCmds(e).length, 0); assert.deepEqual(bus(e).footer, { text: 'look at a card with inputs first', kind: 'error' });
   });

   await check('rates: messages per second over the last second of live time, blank while paused; rows keep their identity while they say the same', () => {
      const e = busReady(); modB(e);
      e.advance(1000); e.frame();                                                   // (the first sample only sets the marks)
      const snapOut = (rev, seq, extra = {}) => e.snap({ rev, t: 2, rails: { out: { seq }, ...extra } });
      snapOut(10, 130); e.advance(1000); let b = bus(e);
      assert.equal(b.rows.find(r => r.id === 'out').rate, 30, '(130 - 100) in a second'); assert.equal(b.rows.find(r => r.id === 'gaze_on').rate, 0);
      snapOut(11, 190); e.advance(500); assert.equal(bus(e).rows.find(r => r.id === 'out').rate, 30, 'worked out once a second'); e.advance(500); assert.equal(bus(e).rows.find(r => r.id === 'out').rate, 60);
      // identity: nothing changed -> the same view; a head that changes only one value keeps the other rows
      const same = bus(e); assert.equal(bus(e), same); e.snap({ rev: 12, t: 2 }); assert.equal(bus(e), same, 'a head with nothing new');
      e.snap({ rev: 13, t: 2, rails: { good: { value: 'bye' } } }); const next = bus(e);
      assert.notEqual(next, same); assert.notEqual(next.rows, same.rows); assert.equal(next.inputs, same.inputs);
      next.rows.forEach((r, i) => assert.equal(r === same.rows[i], r.id !== 'good', r.id + ' is the same object unless it changed'));
      gaze(e, -60, 0); e.frame(); const off = bus(e); gaze(e, -55, 0.1); e.frame(); assert.equal(bus(e), off, 'the gaze moving over nothing is no change');
      // paused: blank, whatever the numbers were
      e.snap({ rev: 14, paused: true, playhead: 5, window: [0, 10] }); const p = bus(e); assert.ok(p.rows.every(r => r.rate === null));
      e.snap({ rev: 15, paused: false, playhead: null }); e.advance(1000); e.frame(); assert.ok(bus(e).rows.every(r => r.rate === null), 'the marks start again after a pause');
      e.advance(1000); e.frame(); assert.equal(bus(e).rows.find(r => r.id === 'out').rate, 0);
   });

   await check('the gaze on the bus for 0.4 s opens the window at that yaw; not while a button is held or a plug is in hand; not again after it was closed until the gaze has left', () => {
      const e = busReady(); gaze(e, 40, BUSH); e.frame();   // (not under a plug: the plug has the priority within 5 to 7 degrees of it)
      e.advance(300); e.frame(); assert.equal(bus(e).open, false, '0.3 s');
      e.advance(99); e.frame(); assert.equal(bus(e).open, false, '0.399 s'); e.advance(1); e.frame(); assert.equal(bus(e).open, true, '0.4 s');
      assert.ok(Math.abs(bus(e).frameYaw - 40 * RAD) < 1e-9); e.advance(2000); gaze(e, -40, 0); e.frame(); assert.equal(bus(e).open, true, 'it stays until closed');
      e.key('Escape'); e.key('Escape'); assert.equal(bus(e).open, false);
      // the gaze comes back: 0.4 s again
      gaze(e, 10, BUSH); e.frame(); e.advance(500); e.frame(); assert.equal(bus(e).open, true, 'after it left and came back');
      modB(e); assert.equal(bus(e).open, false); e.advance(2000); e.frame(); assert.equal(bus(e).open, false, 'closed with the gaze still there: it stays closed');
      gaze(e, 10, 0); e.frame(); gaze(e, 12, BUSH); e.frame(); e.advance(400); e.frame(); assert.equal(bus(e).open, true, 'the gaze left and came back');
      // not while a button is held
      const f = busReady(); gaze(f, 0, 0); f.frame(); f.btn('down'); f.frame(); gaze(f, 12, BUSH); f.frame(); f.advance(1000); f.frame(); assert.equal(bus(f).open, false, 'held');
      f.btn('up'); f.frame(); f.advance(1000); f.frame(); assert.equal(bus(f).open, false, 'let go on the band: it has to leave first');
      gaze(f, 12, 0); f.frame(); gaze(f, 12, BUSH); f.frame(); f.advance(450); f.frame(); assert.equal(bus(f).open, true);
      // not with a plug in hand, nor straight after letting it go on the bus
      const g = busReady(); gaze(g, 0, PLUGH); g.frame(); g.btn('down'); g.frame(); assert.deepEqual(g.frame().plugGrab, { card: 'alpha', over: null });
      gaze(g, 0, BUSH); g.frame(); g.advance(1000); g.frame(); assert.equal(bus(g).open, false, 'plug in hand');
      g.btn('up'); g.frame(); g.advance(1000); g.frame(); assert.equal(bus(g).open, false, 'let go on the bus: no window');
      // a pointer far off the band never opens it (and the bus band is only inside its yaw range)
      const h = busReady(); gaze(h, 70, BUSH); h.frame(); h.advance(1000); h.frame(); assert.equal(bus(h).open, false, 'past 62 degrees');
   });

   await check('the plug: look at it, hold, look along the bus and release there to plug in, anywhere else to unplug; only a change is sent; none of it is pointer.down', () => {
      const e = busReady();
      assert.equal(e.frame().plugGrab, null);
      gaze(e, 0, PLUGH); e.frame(); e.btn('down'); let v = e.frame();
      assert.deepEqual(v.plugGrab, { card: 'alpha', over: null }); assert.deepEqual(pointerDevs(e), [], 'the press on a plug is not pointer.down');
      assert.equal(e.frame().plugGrab, v.plugGrab, 'the same object while it says the same');
      gaze(e, 15, BUSH); v = e.frame(); assert.deepEqual(v.plugGrab, { card: 'alpha', over: 'bus' });
      gaze(e, 15, -0.7); v = e.frame(); assert.deepEqual(v.plugGrab, { card: 'alpha', over: null }, 'off the bus again');
      e.btn('up'); v = e.frame(); assert.equal(v.plugGrab, null); assert.deepEqual(e.sent.cmds.at(-1), { id: e.sent.cmds.at(-1).id, op: 'plug', module: 'alpha', on: false }, 'released elsewhere: unplug');
      assert.deepEqual(pointerDevs(e), [], 'and the release is not the pointer\'s either');
      // an unplugged card released on the bus is plugged in; a plugged one released on the bus is left alone
      const f = busReady({ unplugged: ['alpha'] }); const n = f.sent.cmds.length;
      gaze(f, 0, PLUGH); f.frame(); f.btn('down'); f.frame(); gaze(f, -10, BUSH); f.frame(); f.btn('up'); f.frame();
      assert.deepEqual(f.sent.cmds.slice(n), [{ id: f.sent.cmds.at(-1).id, op: 'plug', module: 'alpha', on: true }]);
      const g = busReady(); const m = g.sent.cmds.length;
      gaze(g, 0, PLUGH); g.frame(); g.btn('down'); g.frame(); gaze(g, 0, BUSH); g.frame(); g.btn('up'); g.frame(); assert.equal(g.sent.cmds.length, m, 'plugged, released on the bus: nothing');
      const h = busReady({ unplugged: ['alpha'] }); const k = h.sent.cmds.length;
      gaze(h, 0, PLUGH); h.frame(); h.btn('down'); h.frame(); gaze(h, 0, 0.3); h.frame(); h.btn('up'); h.frame(); assert.equal(h.sent.cmds.length, k, 'unplugged, released elsewhere: nothing');
      // the other card's plug
      const o = busReady(); gaze(o, 25, PLUGH); o.frame(); o.btn('down'); o.frame(); assert.equal(o.frame().plugGrab.card, 'beta');
      // a press that is not on a plug goes to the pointer as before
      const p = busReady(); gaze(p, 0, 0); p.frame(); p.btn('down'); p.frame(); assert.deepEqual(pointerDevs(p), [{ id: 'pointer', port: 'down', value: true }]); assert.equal(p.frame().plugGrab, null);
      // press and release in one frame on the plug: it unplugs
      const q = busReady(); gaze(q, 0, PLUGH); q.frame(); q.btn('down'); q.btn('up'); q.frame(); assert.equal(q.sent.cmds.at(-1).op, 'plug');
   });

   await check('the plug: a blur or a silent peer cancels the grab (nothing is sent when the button comes up later); a card that goes away ends it', () => {
      const e = busReady(); const n = e.sent.cmds.length;
      gaze(e, 0, PLUGH); e.frame(); e.btn('down'); e.frame(); assert.ok(e.frame().plugGrab);
      e.blur(); assert.equal(e.frame().plugGrab, null); e.btn('up'); e.frame(); assert.equal(e.sent.cmds.length, n, 'nothing was sent');
      gaze(e, 0, PLUGH); e.frame(); e.btn('down'); e.frame(); assert.ok(e.frame().plugGrab); e.emit('release', 'silent'); assert.equal(e.frame().plugGrab, null);
      const f = busReady(); f.emit('pair', {}); gaze(f, 0, PLUGH); f.frame(); f.btn('down'); f.frame(); assert.ok(f.frame().plugGrab);
      f.snap({ rev: 20, geometry: { cards: { beta: { slot: 3 } } } }); assert.equal(f.frame().plugGrab, null, 'the card is gone');
      f.btn('up'); f.frame(); assert.equal(f.sent.cmds.filter(c => c.op === 'plug').length, 0);
   });

   await check('review fixes: a keyboard-chosen row holds only while the gaze stays on it; a glance at the bus within a second of typing opens nothing (Mod+B still does)', () => {
      const e = busReady(); modB(e); e.key('Tab');
      onWin(e, 400, varRow(3)); assert.equal(bus(e).hover.variable, 'zed');
      e.key('ArrowDown'); assert.equal(bus(e).selected.variable, 'good');
      e.key('Enter'); assert.equal(useCmds(e).at(-1).variable, 'good', 'the gaze is still on the row it was on: the keys\' choice wins');
      onWin(e, 400, 30); onWin(e, 400, varRow(3));                       // look away and back
      e.key('Enter'); assert.equal(useCmds(e).at(-1).variable, 'zed', 'back on a row after looking away: the gazed row');
      onWin(e, 400, varRow(5)); e.key('ArrowUp'); onWin(e, 400, varRow(4)); e.key('Enter'); assert.equal(useCmds(e).at(-1).variable, 'gaze_hit', 'another row: the gazed row');
      // typing, then a glance at the bus
      const f = busReady(); gaze(f, 0, 0); f.frame(); f.key('a'); assert.equal(f.text('alpha'), 'aconst a = 1;');
      gaze(f, 12, BUSH); f.frame(); for (let i = 0; i < 9; i++) { f.advance(100); f.frame(); } assert.equal(bus(f).open, false, '0.9 s after the key: locked');
      for (let i = 0; i < 4; i++) { f.advance(100); f.frame(); } assert.equal(bus(f).open, false, 'the 0.4 s of gaze count from the end of the lock (0.3 s so far)');
      f.advance(100); f.frame(); assert.equal(bus(f).open, true, '0.4 s after the lock');
      const g = busReady(); g.key('a'); modB(g); assert.equal(bus(g).open, true, 'Mod+B is not held back');
   });

   await check('review fixes: moreInputs counts the inputs not shown; the header counts the variables that have a row; a window use\'s no answer, link reset and "not paired" go to the footer', () => {
      const e = busReady(); modB(e); assert.equal(bus(e).moreInputs, 0); assert.equal(bus(e).header.title, 'BUS \u00b7 9 variables');
      const ports = [...BUS_PORTS, ...['p1', 'p2', 'p3'].map(name => ({ name, dir: 'in', kind: 'state', type: 'any', rail: null }))];
      e.snap({ rev: 3, vars: [...BUS_VARS, 'late'], modules: { alpha: { ver: 1, ports } } }); let b = bus(e);
      assert.equal(b.inputs.length, 4); assert.equal(b.moreInputs, 2); assert.equal(b.header.title, 'BUS \u00b7 9 variables', 'one that is still on its way has no row and is not counted');
      assert.equal(bus(e).moreInputs, 2);
      e.key('Tab'); e.type('zed'); e.key('Enter'); assert.equal(useCmds(e).length, 1);
      e.advance(5100); e.frame(); assert.deepEqual(bus(e).footer, { text: 'use: no answer', kind: 'error' }); assert.equal(e.frame().slots[2].state.notice, null);
      e.key('Enter'); e.emit('pair', {}); assert.deepEqual(bus(e).footer, { text: 'link reset \u2014 run again', kind: 'error' });
      e.emit('release', 'silent'); e.key('Enter'); assert.deepEqual(bus(e).footer, { text: 'waiting for the runtime: not paired yet', kind: 'error' });
   });

   await check('against a real runtime: the window assigns by keys and by gaze, the runtime\'s refusal shows in the footer, and the input binds', () => {
      const { e, rt, run, steps } = withRuntime();
      run('addModule', { module: 'recv', source: RECV }); steps(2);
      const slot = rt.geometry.cards.recv.slot; focus(e, slot);
      modB(e); let b = bus(e);
      assert.deepEqual(b.inputs.map(i => i.port), ['out', 'pos', 'lost']); assert.ok(b.rows.some(r => r.id === 'pointer_pos' && r.builtin)); assert.deepEqual(b.rows.slice(-5).map(r => r.id), ['gaze_hit', 'gaze_on', 'pointer_down', 'pointer_pos', 'time']);
      assert.equal(b.rows.find(r => r.id === 'out').pubs[0], 'send');
      // keys: pos <- pointer_pos
      e.key('Tab'); e.type('pointer_pos'); e.key('Enter'); steps(2); b = bus(e);
      assert.deepEqual(b.inputs.find(i => i.port === 'pos').variable, 'pointer_pos'); assert.equal(b.inputs.find(i => i.port === 'pos').bound, true); assert.equal(b.footer, null);
      // a refusal from the runtime
      e.key('Backspace'); e.key('Backspace'); e.key('Backspace'); e.key('Backspace'); e.key('Backspace'); e.key('Backspace'); e.key('Backspace'); e.key('Backspace'); e.key('Backspace'); e.key('Backspace'); e.key('Backspace');
      e.type('out'); e.key('Enter'); steps(1);
      assert.match(bus(e).footer.text, /^use refused: type mismatch/); assert.equal(bus(e).footer.kind, 'error');
      // gaze: lost <- gaze_on by looking and pressing
      e.key('Escape'); e.key('Escape'); onWin(e, 400, inRow(2)); click(e);
      assert.equal(bus(e).selected.port, 'lost');
      const idx = bus(e).rows.findIndex(r => r.id === 'gaze_on'); assert.ok(idx >= 0 && idx < 9);
      onWin(e, 400, varRow(idx)); click(e); steps(2);
      assert.equal(bus(e).inputs.find(i => i.port === 'lost').variable, 'gaze_on'); assert.equal(rt.bus.uses['recv.lost'], 'gaze_on');
      // backspace on the input with the gaze on it
      onWin(e, 400, inRow(2)); e.key('Backspace'); steps(2); assert.equal(bus(e).inputs.find(i => i.port === 'lost').isDefault, true);
      assert.deepEqual(pointerDevs(e), [], 'no click reached the pointer device');
      // the plug through the real runtime
      e.key('Escape'); e.key('Escape'); e.key('Escape');
      gaze(e, L.SLOTS[slot], PLUGH); e.frame(); e.btn('down'); e.frame(); gaze(e, L.SLOTS[slot], 0.3); e.frame(); e.btn('up'); e.frame(); steps(2);
      assert.deepEqual(e.frame().unplugged, ['recv']); assert.equal(e.frame().slots[slot].state.unplugged, true);
      gaze(e, L.SLOTS[slot], PLUGH); e.frame(); e.btn('down'); e.frame(); gaze(e, L.SLOTS[slot], BUSH); e.frame(); e.btn('up'); e.frame(); steps(2);
      assert.deepEqual(e.frame().unplugged, []);
   });

   await check('against a real runtime: rm and rename while paused are refused with the reason, the card stays as it was, and after the resume they go through', () => {
      const { e, rt, pump } = withRuntime();
      const slot = rt.geometry.cards.send.slot; focus(e, slot);
      e.key('p', { c: true }); e.frame(); pump(); assert.equal(rt.bus.paused, true);
      cmdLine(e, 'rename other'); e.frame(); pump();
      assert.match(stateOf(e, slot).notice, /^renameModule refused: paused: /, stateOf(e, slot).notice);
      assert.ok(rt.bus.modules.has('send') && !rt.bus.modules.has('other'));
      assert.equal(e.core.inspect.card('send').id, 'send'); assert.equal(e.frame().slots[slot].id, 'send', 'the card is still there under its name');
      cmdLine(e, 'rm'); cmdLine(e, 'rm'); e.frame(); pump();
      assert.match(stateOf(e, slot).notice, /^rmModule refused: paused: /, stateOf(e, slot).notice);
      assert.ok(rt.bus.modules.has('send')); assert.equal(e.frame().slots[slot].id, 'send');
      e.key('p', { c: true }); e.frame(); pump();
      cmdLine(e, 'rename other'); e.frame(); pump(); for (let i = 0; i < 3; i++) rt.step(); pump(); e.frame();
      assert.ok(rt.bus.modules.has('other') && !rt.bus.modules.has('send'), 'live again: it goes through');
   });

   // ---- the gaze cursor: the smoothed ray, what it hits, the plug's hysteresis and grace ----------------------------------------------------

   const Gz = await load('js/scenes/rails/gaze.js');
   const deg = r => r / RAD, angle = (a, b) => Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2])));
   // A gaze at a yaw (degrees) and a pitch (degrees) of the ray itself, from the eye.
   const gazeDeg = (e, yaw, pitch) => { const a = yaw * RAD, p = pitch * RAD; e.core.inspect.aim({ o: [0, 1.6, 0], d: [Math.sin(a) * Math.cos(p), Math.sin(p), -Math.cos(a) * Math.cos(p)] }); };
   // A head matrix looking at yaw / pitch (degrees) from the eye.
   const headAt = (yaw, pitch) => {
      const a = yaw * RAD, p = pitch * RAD, f = [Math.sin(a) * Math.cos(p), Math.sin(p), -Math.cos(a) * Math.cos(p)];
      const r = [Math.cos(a), 0, Math.sin(a)], z = f.map(v => -v);
      const up = [z[1] * r[2] - z[2] * r[1], z[2] * r[0] - z[0] * r[2], z[0] * r[1] - z[1] * r[0]];
      return [r[0], r[1], r[2], 0, up[0], up[1], up[2], 0, -f[0], -f[1], -f[2], 0, 0, 1.6, 0, 1];
   };
   const PITCH_PLUG = deg(Math.atan2(-0.30, L.RADIUS));      // the pitch of a plug's centre, -13.5 degrees
   const onRay = (g, ray) => [0, 1, 2].every(i => Math.abs(ray.o[i] + ray.d[i] * g.dist - g.point[i]) < 1e-9);

   await check('smoothRay: alpha = 1 - exp(-dt / 0.06), so a step reaches 63 % after 60 ms whatever the frame rate; the first sample is taken as it is; NaN is passed on and does not poison it', () => {
      assert.equal(Gz.SMOOTH_TAU, 0.06);
      const from = { o: [0, 1.6, 0], d: [0, 0, -1] }, to = { o: [0, 1.6, 0], d: [Math.sin(10 * RAD), 0, -Math.cos(10 * RAD)] };
      for (const steps of [3, 6, 12, 1]) {
         const sm = Gz.createRaySmoother(); sm.step(from, 0);
         let r; for (let i = 1; i <= steps; i++) r = sm.step(to, 0.06 * i / steps);
         const f = angle(r.d, from.d) / angle(to.d, from.d);
         assert.ok(Math.abs(f - (1 - Math.exp(-1))) < 0.004, `${steps} steps of ${60 / steps} ms: ${f}`);
      }
      const sm = Gz.createRaySmoother(), first = sm.step(to, 5);
      assert.deepEqual(first.d.map(x => +x.toFixed(9)), to.d.map(x => +x.toFixed(9)), 'the first sample is the ray itself');
      assert.ok(Math.abs(Math.hypot(...sm.step(from, 5.01).d) - 1) < 1e-12, 'always a unit direction');
      const bad = { o: [NaN, 0, 0], d: [0, 0, -1] };
      assert.equal(sm.step(bad, 5.02), bad, 'tracking loss goes through as it is (it hits nothing)');
      const after = sm.step(from, 5.03); assert.ok(after.d.every(Number.isFinite), 'and the state is not poisoned');
      const jump = Gz.createRaySmoother(); jump.step(from, 0); const far = jump.step(to, 30);
      assert.ok(far.d.every((x, i) => Math.abs(x - to.d[i]) < 1e-12), 'after a long pause (a stopped page) the ray is simply where the head is');
      const still = Gz.createRaySmoother(); still.step(from, 1); const same = still.step(to, 1);
      assert.ok(same.d.every((x, i) => Math.abs(x - from.d[i]) < 1e-12), 'a frame with no time passed does not move it');
   });

   await check('the core smooths the head\'s ray at 72 and at 90 frames a second alike; the view\'s ray, the cursor and every hit test use the smoothed one', () => {
      const run = fps => {
         const e = ready(); e.head = headAt(0, 0); e.frame();
         const before = e.frame().ray.d.slice();
         e.head = headAt(10, 0);
         const n = Math.round(fps * 0.05556); let v; for (let i = 0; i < n; i++) { e.advance(1000 / fps); v = e.frame(); }
         return angle(v.ray.d, before) / (10 * RAD);
      };
      const f72 = run(72), f90 = run(90), want = 1 - Math.exp(-0.05556 / 0.06);
      assert.ok(Math.abs(f72 - want) < 0.01 && Math.abs(f90 - want) < 0.01, `72 fps ${f72}, 90 fps ${f90}, expected ${want}`);
      assert.ok(Math.abs(f72 - f90) < 0.003, 'the same at both');
      // The hit tests see the smoothed ray: the head goes onto a plug at once, the gaze gets there a little later.
      const e = busReady(); e.core.inspect.aim(null); e.head = headAt(0, 0); e.frame(); e.advance(16); e.frame();
      assert.equal(e.frame().gaze.kind, 'card');
      e.head = headAt(0, PITCH_PLUG); e.advance(16); let v = e.frame();
      assert.notEqual(v.gaze.kind, 'plug', 'one frame later the smoothed ray is still far from the plug');
      assert.ok(onRay(v.gaze, v.ray), 'and the cursor is on the smoothed ray');
      assert.equal(v.gaze.plug, null);
      for (let i = 0; i < 8; i++) { e.advance(16); v = e.frame(); }
      assert.equal(v.gaze.kind, 'plug', '130 ms later it is on the plug'); assert.equal(v.gaze.plug, 2);
      assert.ok(onRay(v.gaze, v.ray));
   });

   await check('view.gaze: the point is where the ray meets the open bus window, a card, a plug, the bus band or the desk mat, and on the 1.25 m cylinder when nothing is hit', () => {
      const e = busReady(), ws = e.core.inspect.ws, R = L.RADIUS;
      const horiz = p => Math.hypot(p[0] - ws.origin[0], p[2] - ws.origin[2]);
      // a card (slot 3, not the focused one): the point is on the cylinder at the card's centre
      gazeDeg(e, 25, Math.atan2(-0.02, R) / RAD); let g = e.frame().gaze;
      assert.equal(g.kind, 'card'); assert.ok(Math.abs(horiz(g.point) - R) < 1e-9, 'a card centre: on the cylinder, 1.25 m out'); assert.ok(onRay(g, e.frame().ray));
      assert.ok(Math.abs(g.point[1] - (ws.eyeY - 0.02)) < 1e-9, 'at the card\'s height'); assert.equal(g.plug, null); assert.equal(g.holding, false);
      // the card the gaze is straight on
      gazeDeg(e, 0, 0); g = e.frame().gaze; assert.equal(g.kind, 'card'); assert.ok(Math.abs(g.dist - R) < 1e-9);
      // a plug
      gazeDeg(e, 0, PITCH_PLUG); g = e.frame().gaze; assert.equal(g.kind, 'plug'); assert.equal(g.plug, 2); assert.ok(Math.abs(horiz(g.point) - R) < 1e-9 && onRay(g, e.frame().ray));
      const pw = L.plugWorld(ws, 2); assert.ok(Math.hypot(g.point[0] - pw[0], g.point[1] - pw[1], g.point[2] - pw[2]) < 0.01, 'at the plug');
      // the bus band, between two plugs
      gazeDeg(e, 12, Math.atan2(L.BUS.y, R) / RAD); g = e.frame().gaze; assert.equal(g.kind, 'bus'); assert.equal(g.plug, null);
      assert.ok(Math.abs(g.point[1] - (ws.eyeY + L.BUS.y)) < 1e-6 && Math.abs(horiz(g.point) - R) < 1e-9, 'on the band');
      // the desk mat (centre 0.45 right, 0.10 ahead, 0.45 below the eye)
      const mat = e.core.inspect.stage, c = [mat[12], mat[13], mat[14]], d = c.map((v, i) => v - ws.origin[i]);
      e.core.inspect.aim({ o: [...ws.origin], d: unit(d) }); g = e.frame().gaze;
      assert.equal(g.kind, 'desk'); assert.ok(Math.abs(g.dist - Math.hypot(...d)) < 1e-9 && Math.abs(g.point[1] - mat[13]) < 1e-9 && g.dist < R, 'on the mat, nearer than the cylinder');
      // nothing: off to the side, behind, and straight up (the cylinder has no hit there)
      gazeDeg(e, -80, 0); g = e.frame().gaze; assert.equal(g.kind, null); assert.ok(Math.abs(horiz(g.point) - R) < 1e-9 && onRay(g, e.frame().ray), 'on the cylinder');
      gazeDeg(e, 0, 40); g = e.frame().gaze; assert.equal(g.kind, null); assert.ok(Math.abs(horiz(g.point) - R) < 1e-9, 'above the cards: the cylinder');
      e.core.inspect.aim({ o: [...ws.origin], d: [0, 1, 0] }); g = e.frame().gaze; assert.equal(g.kind, null); assert.ok(g.point.every(Number.isFinite) && Math.abs(g.dist - R) < 1e-9, 'straight up: 1.25 m along it');
      // the open bus window is nearer than the cards: the pixel's point is on the panel
      modB(e); onWin(e, 512, 320); g = e.frame().gaze;
      const wm = L.busWindowFrame(ws, e.frame().bus.frameYaw);
      assert.equal(g.kind, 'window'); assert.ok(Math.abs(g.dist - 1.0) < 0.02, 'about 1.0 m');
      assert.ok(Math.abs((g.point[0] - wm[12]) * wm[8] + (g.point[1] - wm[13]) * wm[9] + (g.point[2] - wm[14]) * wm[10]) < 1e-9, 'in the plane of the panel');
      assert.ok(onRay(g, e.frame().ray)); assert.equal(g.progress, 0);
      // the window is only a hit where it is: the ray past its edge goes on to a card
      gazeDeg(e, 60, 0); g = e.frame().gaze; assert.notEqual(g.kind, 'window');
   });

   await check('the plug target has a hysteresis: in at 5 degrees, still in at 6.5, out beyond 7, in again at 5; it wins over the card and the bus under it', () => {
      const e = busReady(), at = off => { gazeDeg(e, 0, PITCH_PLUG + off); return e.frame().gaze; };
      assert.equal(at(5.5).plug, null, 'outside 5 degrees: not yet'); assert.equal(at(5.5).kind, 'card', 'it is on the card');
      assert.equal(at(4.9).plug, 2); assert.equal(at(4.9).kind, 'plug', 'in at 5 degrees (and the plug wins over the card)');
      assert.equal(at(6.5).plug, 2, 'still in at 6.5'); assert.equal(at(6.5).kind, 'plug');
      assert.equal(at(7.5).plug, null, 'out at 7.5'); assert.equal(at(7.5).kind, 'card');
      assert.equal(at(6.5).plug, null, 'and 6.5 is not enough to get back in');
      assert.equal(at(5.1).plug, null); assert.equal(at(4.9).plug, 2, 'back in at 5');
      // below the plug: the bus under it is inside the plug's zone, and the plug has the priority there
      assert.equal(at(-4.2).plug, 2); assert.equal(at(-4.2).kind, 'plug', 'the bus band right under a plug is the plug');
      const f = busReady(); gazeDeg(f, 0, PITCH_PLUG - 4.2); f.frame(); f.advance(1000); f.frame(); assert.equal(f.frame().bus.open, false, 'and looking there does not open the bus window');
      // each plug has its own state (beta's plug is at yaw 25)
      gazeDeg(e, 25, PITCH_PLUG); let g = e.frame().gaze; assert.equal(g.plug, 3);
      gazeDeg(e, 25 + 6.5, PITCH_PLUG); assert.equal(e.frame().gaze.plug, 3, 'still in beta\'s'); gazeDeg(e, 25 + 7.5, PITCH_PLUG); assert.equal(e.frame().gaze.plug, null);
      gazeDeg(e, 25 - 5.5, PITCH_PLUG); assert.equal(e.frame().gaze.plug, null, 'an empty slot has no plug to target'); gazeDeg(e, -25, PITCH_PLUG); assert.equal(e.frame().gaze.plug, null);
   });

   await check('a press counts as taking a plug when the plug was targeted within the last 0.2 s', () => {
      const run = ms => {
         const e = busReady(); gazeDeg(e, 0, PITCH_PLUG); e.frame();
         gazeDeg(e, 0, 0); e.advance(ms); e.btn('down'); const v = e.frame();
         return { v, e };
      };
      let r = run(150); assert.deepEqual(r.v.plugGrab, { card: 'alpha', over: null }, 'targeted 0.15 s ago: it is taken'); assert.equal(r.v.gaze.holding, true);
      assert.deepEqual(r.e.sent.devs.filter(d => d.id === 'pointer'), [], 'and it is no pointer.down');
      r = run(300); assert.equal(r.v.plugGrab, null, 'targeted 0.3 s ago: no plug'); assert.deepEqual(r.e.sent.devs.filter(d => d.id === 'pointer' && d.port === 'down'), [{ id: 'pointer', port: 'down', value: true }], 'it is the pointer\'s press');
      r = run(0); assert.ok(r.v.plugGrab, 'at once: it is taken');
      // beta's plug targeted more recently than alpha's: beta's is taken
      const e = busReady(); gazeDeg(e, 0, PITCH_PLUG); e.frame(); e.advance(50); gazeDeg(e, 25, PITCH_PLUG); e.frame(); e.advance(50); gazeDeg(e, 12, 0); e.btn('down');
      assert.equal(e.frame().plugGrab.card, 'beta', 'the latest one');
      // a plug that is targeted when the press comes, with no frame in between, is taken too
      const f = busReady(); gazeDeg(f, 0, PITCH_PLUG); f.frame(); f.btn('down'); assert.ok(f.frame().plugGrab);
      // the grace does not take a plug through the bus window
      const w = busReady(); gazeDeg(w, 0, PITCH_PLUG); w.frame(); modB(w); onWin(w, 512, 320); w.btn('down'); assert.equal(w.frame().plugGrab, null, 'a press on the window is the window\'s');
   });

   await check('gaze.progress: the focus dwell fills over 350 ms on a card, the bus window opener over 0.4 s on the band; holding a plug is solid', () => {
      const e = busReady(); gazeDeg(e, 25, Math.atan2(-0.02, L.RADIUS) / RAD);
      let g = e.frame().gaze; assert.equal(g.kind, 'card'); assert.equal(g.progress, 0, 'just arrived');
      e.advance(175); g = e.frame().gaze; assert.ok(Math.abs(g.progress - 0.5) < 1e-9, 'half way: ' + g.progress);
      e.advance(140); g = e.frame().gaze; assert.ok(Math.abs(g.progress - 0.9) < 1e-9, '315 ms: ' + g.progress);
      e.advance(35); g = e.frame().gaze; assert.equal(g.progress, 0, 'focused: nothing to wait for'); assert.equal(e.frame().focus, 3);
      gazeDeg(e, 25, 0); g = e.frame().gaze; assert.equal(g.progress, 0, 'the focused card');
      // the focused card of the dwell only; a card with the typing lock holding the dwell shows none
      const f = busReady(); gazeDeg(f, 12, Math.atan2(L.BUS.y, L.RADIUS) / RAD); g = f.frame().gaze; assert.equal(g.kind, 'bus'); assert.equal(g.progress, 0);
      f.advance(200); g = f.frame().gaze; assert.ok(Math.abs(g.progress - 0.5) < 1e-9, 'the opener at 0.2 s: ' + g.progress);
      f.advance(100); g = f.frame().gaze; assert.ok(Math.abs(g.progress - 0.75) < 1e-9);
      f.advance(100); g = f.frame().gaze; assert.equal(f.frame().bus.open, true); assert.equal(g.progress, 0, 'open: the opener is done');
      // a plug is not a wait; holding it is solid, over the bus too
      const h = busReady(); gazeDeg(h, 0, PITCH_PLUG); g = h.frame().gaze; assert.deepEqual([g.kind, g.progress, g.holding, g.plug], ['plug', 0, false, 2]);
      h.btn('down'); g = h.frame().gaze; assert.deepEqual([g.holding, g.plug], [true, 2]);
      gazeDeg(h, 20, Math.atan2(L.BUS.y, L.RADIUS) / RAD); g = h.frame().gaze; assert.deepEqual([g.kind, g.holding, g.plug, g.progress], ['bus', true, 2, 0], 'over the bus with the plug in hand: where it would plug in');
      h.btn('up'); g = h.frame().gaze; assert.equal(g.holding, false);
   });

   await check('the view has no gaze before there is a workspace, and gaze.point is always finite numbers', () => {
      const e = setup(); e.core.setActive(true); e.emit('pair', {});
      assert.equal(e.frame({ head: null }).gaze, null);
      e.frame(); const g = e.frame().gaze; assert.ok(g && g.point.length === 3 && g.point.every(Number.isFinite) && Number.isFinite(g.dist));
      e.core.inspect.aim({ o: [NaN, 0, 0], d: [0, 0, -1] }); assert.equal(e.frame().gaze, null, 'tracking lost: no cursor');
   });

   console.log(`${passed} rails ide checks passed.`);
})().catch(err => { console.error(err); process.exit(1); });
