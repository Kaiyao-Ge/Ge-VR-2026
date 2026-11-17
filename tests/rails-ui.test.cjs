// Rails checks without a browser: the text buffer, the keymap, the command line and the spatial layout.
// Run: node tests/rails-ui.test.cjs
const assert = require('node:assert/strict');
const load = require('./esm.cjs');

let passed = 0;
const check = async (name, fn) => { await fn(); passed++; console.log('ok -', name); };

(async () => {
   const T = await load('js/scenes/rails/textBuffer.js');
   const K = await load('js/scenes/rails/keymap.js');
   const C = await load('js/scenes/rails/commands.js');
   const D = await load('js/scenes/rails/cardDraw.js');

   const ins = (b, s, now) => { for (const ch of s) b.apply({ op: 'insert', text: ch }, now); };
   const at = (b, row, col) => assert.deepEqual([b.row, b.col], [row, col]);
   const valid = b => {
      const L = b.lines;
      assert.ok(b.row >= 0 && b.row < L.length, `row ${b.row} of ${L.length}`);
      assert.ok(b.col >= 0 && b.col <= L[b.row].length, `col ${b.col} of ${L[b.row].length}`);
      assert.ok(b.scroll >= 0 && b.scroll <= Math.max(0, L.length - T.VISIBLE), `scroll ${b.scroll}`);
      assert.ok(b.row >= b.scroll && b.row < b.scroll + T.VISIBLE, `row ${b.row} outside scroll ${b.scroll}`);
   };

   // ---- TextBuffer ----

   await check('typing inserts at the cursor and sets dirty; set clears it', () => {
      const b = new T.TextBuffer('ab');
      assert.equal(b.dirty, false);
      b.apply({ op: 'move', dir: 'end' }, 0);
      assert.equal(b.apply({ op: 'insert', text: 'c' }, 0), true);
      ins(b, 'd', 0);
      assert.equal(b.text, 'abcd'); at(b, 0, 4); assert.equal(b.dirty, true);
      b.apply({ op: 'set', text: 'x\ny' }, 0);
      assert.equal(b.text, 'x\ny'); assert.deepEqual(b.lines, ['x', 'y']); at(b, 0, 0);
      assert.equal(b.dirty, false);
      assert.equal(b.apply({ op: 'undo' }, 0), false);              // set resets the history
   });

   await check('an op that is only inherited (constructor, toString) is no op', () => {
      const b = new T.TextBuffer('ab');
      for (const op of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) assert.equal(b.apply({ op }, 0), false, op);
      assert.equal(b.text, 'ab');
   });

   await check('Enter keeps the indent, and splits the line', () => {
      const b = new T.TextBuffer('  foo(bar)');
      b.apply({ op: 'move', dir: 'end' }, 0);
      b.apply({ op: 'newline' }, 0);
      assert.deepEqual(b.lines, ['  foo(bar)', '  ']); at(b, 1, 2);
      b.apply({ op: 'set', text: '    ab' }, 0);
      b.apply({ op: 'move', dir: 'right' }, 0); b.apply({ op: 'move', dir: 'right' }, 0);   // inside the indent
      b.apply({ op: 'newline' }, 0);
      assert.deepEqual(b.lines, ['  ', '  ' + '  ab']); at(b, 1, 2);
      b.apply({ op: 'set', text: 'abcd' }, 0);
      b.apply({ op: 'move', dir: 'right' }, 0); b.apply({ op: 'move', dir: 'right' }, 0);
      b.apply({ op: 'newline' }, 0);
      assert.deepEqual(b.lines, ['ab', 'cd']); at(b, 1, 0);
   });

   await check('Backspace deletes, joins lines, and stops at the start; Delete joins forward', () => {
      const b = new T.TextBuffer('ab\ncd');
      b.apply({ op: 'move', dir: 'down' }, 0);                      // (1, 0)
      assert.equal(b.apply({ op: 'backspace' }, 0), true);
      assert.equal(b.text, 'abcd'); at(b, 0, 2);
      b.apply({ op: 'backspace' }, 0);
      assert.equal(b.text, 'acd'); at(b, 0, 1);
      b.apply({ op: 'move', dir: 'home' }, 0);
      assert.equal(b.apply({ op: 'backspace' }, 0), false); assert.equal(b.text, 'acd');
      b.apply({ op: 'delete' }, 0); assert.equal(b.text, 'cd');
      b.apply({ op: 'set', text: 'ab\ncd' }, 0);
      b.apply({ op: 'move', dir: 'end' }, 0);
      b.apply({ op: 'delete' }, 0); assert.equal(b.text, 'abcd'); at(b, 0, 2);
      b.apply({ op: 'move', dir: 'end' }, 0);
      assert.equal(b.apply({ op: 'delete' }, 0), false);            // end of text
   });

   await check('arrows wrap across lines, clamp at the ends, and keep a goal column', () => {
      const b = new T.TextBuffer('abcdef\nxy\nabcdef');
      assert.equal(b.apply({ op: 'move', dir: 'left' }, 0), false); at(b, 0, 0);
      assert.equal(b.apply({ op: 'move', dir: 'up' }, 0), false); at(b, 0, 0);
      b.apply({ op: 'move', dir: 'end' }, 0); at(b, 0, 6);
      b.apply({ op: 'move', dir: 'right' }, 0); at(b, 1, 0);        // wraps to the next line
      b.apply({ op: 'move', dir: 'left' }, 0); at(b, 0, 6);
      b.apply({ op: 'move', dir: 'down' }, 0); at(b, 1, 2);         // clamped to the short line
      b.apply({ op: 'move', dir: 'down' }, 0); at(b, 2, 6);         // goal column comes back
      assert.equal(b.apply({ op: 'move', dir: 'down' }, 0), false); at(b, 2, 6);
      b.apply({ op: 'move', dir: 'end' }, 0);
      assert.equal(b.apply({ op: 'move', dir: 'right' }, 0), false); at(b, 2, 6);
   });

   await check('Home and End go to the line ends; PageUp/PageDown move by 12 lines and clamp', () => {
      const b = new T.TextBuffer(Array.from({ length: 40 }, (_, i) => 'line' + i).join('\n'));
      b.apply({ op: 'move', dir: 'end' }, 0); at(b, 0, 5);
      b.apply({ op: 'move', dir: 'home' }, 0); at(b, 0, 0);
      b.apply({ op: 'move', dir: 'pagedown' }, 0); at(b, 12, 0); valid(b);
      b.apply({ op: 'move', dir: 'pagedown' }, 0); b.apply({ op: 'move', dir: 'pagedown' }, 0);
      b.apply({ op: 'move', dir: 'pagedown' }, 0); at(b, 39, 0); valid(b);
      b.apply({ op: 'move', dir: 'pageup' }, 0); at(b, 27, 0); valid(b);
      for (let i = 0; i < 5; i++) b.apply({ op: 'move', dir: 'pageup' }, 0);
      at(b, 0, 0); assert.equal(b.scroll, 0);
   });

   await check('Tab inserts two spaces', () => {
      const b = new T.TextBuffer('x');
      b.apply({ op: 'tab' }, 0);
      assert.equal(b.text, '  x'); at(b, 0, 2);
   });

   await check('deleteLineStart removes everything left of the cursor', () => {
      const b = new T.TextBuffer('hello world');
      for (let i = 0; i < 6; i++) b.apply({ op: 'move', dir: 'right' }, 0);
      b.apply({ op: 'deleteLineStart' }, 0);
      assert.equal(b.text, 'world'); at(b, 0, 0);
   });

   await check('scroll op moves the window within bounds; cursor moves bring it into view', () => {
      const b = new T.TextBuffer(Array.from({ length: 30 }, (_, i) => 'l' + i).join('\n'));
      assert.equal(T.VISIBLE, 12);
      assert.equal(b.apply({ op: 'scroll', lines: -3 }, 0), false); assert.equal(b.scroll, 0);
      b.apply({ op: 'scroll', lines: 3 }, 0); assert.equal(b.scroll, 3); at(b, 0, 0);
      b.apply({ op: 'scroll', lines: 100 }, 0); assert.equal(b.scroll, 18);
      b.apply({ op: 'move', dir: 'right' }, 0); valid(b); assert.equal(b.scroll, 0);   // cursor pulls the window back
      for (let i = 0; i < 20; i++) b.apply({ op: 'move', dir: 'down' }, 0);
      valid(b); assert.equal(b.scroll, 9);
   });

   await check('a commit\'s ack (the base op) does not move the view, though the cursor is out of it', () => {
      const text = Array.from({ length: 30 }, (_, i) => 'l' + i).join('\n'), b = new T.TextBuffer(text);
      at(b, 0, 0); b.apply({ op: 'scroll', lines: 10 }, 0); assert.equal(b.scroll, 10);
      b.apply({ op: 'base', text }, 0); assert.equal(b.scroll, 10, 'the person scrolled away: the ack leaves it');
      b.apply({ op: 'move', dir: 'right' }, 0); assert.equal(b.scroll, 0, 'a key that moves the cursor still brings it back');
   });

   await check('undo and redo round-trip; snapshots on idle, newline and insert/delete switches', () => {
      const b = new T.TextBuffer('');
      ins(b, 'abc', 0); ins(b, 'def', 100);                         // one group (within 800 ms)
      ins(b, 'X', 1000);                                            // 900 ms after the last edit: new group
      assert.equal(b.text, 'abcdefX');
      b.apply({ op: 'undo' }, 1000); assert.equal(b.text, 'abcdef');
      b.apply({ op: 'undo' }, 1000); assert.equal(b.text, '');
      assert.equal(b.apply({ op: 'undo' }, 1000), false);
      b.apply({ op: 'redo' }, 1000); assert.equal(b.text, 'abcdef'); at(b, 0, 6);
      b.apply({ op: 'redo' }, 1000); assert.equal(b.text, 'abcdefX');
      assert.equal(b.apply({ op: 'redo' }, 1000), false);
      // newline starts a group; so does switching between inserting and deleting.
      const c = new T.TextBuffer('');
      ins(c, 'ab', 0); c.apply({ op: 'newline' }, 10); ins(c, 'cd', 20);
      c.apply({ op: 'backspace' }, 30); c.apply({ op: 'backspace' }, 40);
      ins(c, 'z', 50);
      assert.equal(c.text, 'ab\nz');
      c.apply({ op: 'undo' }, 60); assert.equal(c.text, 'ab\n');     // the 'z'
      c.apply({ op: 'undo' }, 60); assert.equal(c.text, 'ab\ncd');   // the two backspaces together
      c.apply({ op: 'undo' }, 60); assert.equal(c.text, 'ab');       // newline + cd
      c.apply({ op: 'undo' }, 60); assert.equal(c.text, '');
      for (let i = 0; i < 4; i++) c.apply({ op: 'redo' }, 60);
      assert.equal(c.text, 'ab\nz');
   });

   await check('arrows never snapshot, a new edit clears redo, undo restores the cursor', () => {
      const b = new T.TextBuffer('abc');
      b.apply({ op: 'move', dir: 'end' }, 0);
      ins(b, 'd', 0);
      b.apply({ op: 'move', dir: 'left' }, 10); b.apply({ op: 'move', dir: 'left' }, 5000);
      ins(b, 'e', 5100);                                            // idle gap counts from the last edit, not the arrows
      b.apply({ op: 'undo' }, 5100); assert.equal(b.text, 'abcd'); at(b, 0, 2);
      ins(b, 'Q', 5200);
      assert.equal(b.apply({ op: 'redo' }, 5200), false);
      b.apply({ op: 'undo' }, 5200); b.apply({ op: 'undo' }, 5200);
      assert.equal(b.text, 'abc');
      assert.equal(b.dirty, false);                                 // back to the clean text
   });

   await check('a 4 KB paste goes in whole, as one undo step', () => {
      const b = new T.TextBuffer('ab');
      b.apply({ op: 'move', dir: 'right' }, 0);
      const line = 'x'.repeat(63) + '\n';
      const paste = line.repeat(64);                                // 4096 chars
      assert.equal(paste.length, 4096);
      assert.equal(b.apply({ op: 'insert', text: paste }, 0), true);
      assert.equal(b.text, 'a' + paste + 'b');
      assert.equal(b.lines.length, 65); at(b, 64, 0); valid(b);
      b.apply({ op: 'undo' }, 0); assert.equal(b.text, 'ab');
      b.apply({ op: 'redo' }, 0); assert.equal(b.text.length, 4098);
      // Carriage returns are normalised, and a paste longer than the limit is cut.
      b.apply({ op: 'set', text: '' }, 0);
      b.apply({ op: 'insert', text: 'a\r\nb\rc' }, 0); assert.equal(b.text, 'a\nb\nc');
      b.apply({ op: 'insert', text: 'y'.repeat(9000) }, 0);
      assert.equal(b.text.length, 5 + T.MAX_PASTE);
   });

   await check('1000 random ops keep the cursor and scroll valid', () => {
      let seed = 12345;
      const rnd = n => (seed = (seed * 1664525 + 1013904223) >>> 0) % n;
      const dirs = ['left', 'right', 'up', 'down', 'home', 'end', 'pageup', 'pagedown'];
      const simple = ['newline', 'tab', 'backspace', 'delete', 'deleteLineStart', 'undo', 'redo'];
      const b = new T.TextBuffer('one\n  two\nthree');
      let now = 0;
      for (let i = 0; i < 1000; i++) {
         now += rnd(1000);
         const k = rnd(10);
         const op = k < 3 ? { op: 'insert', text: 'ab \n'[rnd(4)] + (rnd(8) ? '' : 'xyz\nq') }
                  : k < 6 ? { op: 'move', dir: dirs[rnd(dirs.length)] }
                  : k < 7 ? { op: 'scroll', lines: rnd(9) - 4 }
                  : { op: simple[rnd(simple.length)] };
         b.apply(op, now);
         if (op.op !== 'scroll') valid(b);
         else assert.ok(b.scroll >= 0 && b.scroll <= Math.max(0, b.lines.length - 12));
         assert.ok(b.row < b.lines.length);
         assert.ok(!b.text.includes('\r'));
      }
   });

   await check('a non-edit returns false and an unknown op is ignored', () => {
      const b = new T.TextBuffer('a');
      assert.equal(b.apply({ op: 'bogus' }, 0), false);
      assert.equal(b.apply({ op: 'insert', text: '' }, 0), false);
      assert.equal(b.apply({ op: 'insert' }, 0), false);
      assert.equal(b.apply({ op: 'move', dir: 'sideways' }, 0), false);
      assert.equal(b.text, 'a');
   });

   // ---- keymap ----

   const ev = (key, mods = {}, extra = {}) => ({ d: 'down', key, code: '', mods: { c: false, a: false, s: false, m: false, ...mods }, rep: false, ...extra });
   const mac = { mac: true }, win = { mac: false };

   await check('isMac reads the platform string', () => {
      assert.equal(K.isMac('MacIntel'), true); assert.equal(K.isMac('iPad'), true);
      assert.equal(K.isMac('Win32'), false); assert.equal(K.isMac('Linux x86_64'), false);
      assert.equal(K.isMac(undefined), false);
   });

   await check('mapKey, Mac: Cmd+Enter runs, Cmd+Shift+Enter continues from here, Ctrl+Enter does nothing', () => {
      assert.deepEqual(K.mapKey(ev('Enter', { m: true }), mac), { cmd: 'run' });
      assert.deepEqual(K.mapKey(ev('Enter', { m: true, s: true }), mac), { cmd: 'here' });
      assert.equal(K.mapKey(ev('Enter', { c: true }), mac), null);
      assert.deepEqual(K.mapKey(ev('Enter'), mac), { edit: { op: 'newline' } });
   });

   await check('the HUD key list names continue-from-here and the `here` command, and no adopt', async () => {
      const Tm = await load('js/scenes/rails/terminal.js');
      for (const mac of [false, true]) {
         const text = Tm.keymapText(mac), m = mac ? 'Cmd' : 'Ctrl';
         assert.match(text, new RegExp(`${m}\\+Shift\\+Enter continue from here`)); assert.match(text, /unplug here\n?/); assert.ok(!/adopt|ghost/i.test(text));
      }
   });

   await check('mapKey, Windows: Ctrl+Enter runs, Meta+Enter does nothing', () => {
      assert.deepEqual(K.mapKey(ev('Enter', { c: true }), win), { cmd: 'run' });
      assert.deepEqual(K.mapKey(ev('Enter', { c: true, s: true }), win), { cmd: 'here' });
      assert.equal(K.mapKey(ev('Enter', { m: true }), win), null);
   });

   await check('mapKey: undo/redo, pause, play, recentre, escape on both platforms', () => {
      for (const [p, o, other] of [[mac, 'm', 'c'], [win, 'c', 'm']]) {
         const M = { [o]: true };
         assert.deepEqual(K.mapKey(ev('z', M), p), { edit: { op: 'undo' } });
         assert.deepEqual(K.mapKey(ev('Z', { ...M, s: true }), p), { edit: { op: 'redo' } });
         assert.deepEqual(K.mapKey(ev('p', M), p), { cmd: 'pause' });
         assert.deepEqual(K.mapKey(ev('.', M), p), { cmd: 'play' });
         assert.deepEqual(K.mapKey(ev('Home', M), p), { cmd: 'recentre' });
         assert.deepEqual(K.mapKey(ev('Backspace', M), p), { edit: { op: 'deleteLineStart' } });
         assert.equal(K.mapKey(ev('z', { [other]: true }), p), null);
         assert.deepEqual(K.mapKey(ev('Escape'), p), { cmd: 'escape' });
      }
      assert.deepEqual(K.mapKey(ev('y', { c: true }), win), { edit: { op: 'redo' } });
      assert.equal(K.mapKey(ev('y', { m: true }), mac), null);
   });

   await check('mapKey: Mac Cmd+Left/Right are home/end; Ctrl+Left/Right and Cmd+Up are left to the OS', () => {
      assert.deepEqual(K.mapKey(ev('ArrowLeft', { m: true }), mac), { edit: { op: 'move', dir: 'home' } });
      assert.deepEqual(K.mapKey(ev('ArrowRight', { m: true }), mac), { edit: { op: 'move', dir: 'end' } });
      assert.equal(K.mapKey(ev('ArrowLeft', { c: true }), mac), null);
      assert.equal(K.mapKey(ev('ArrowLeft', { c: true }), win), null);
      assert.equal(K.mapKey(ev('ArrowUp', { m: true }), mac), null);
   });

   await check('mapKey never binds Mod+W/T/N/Q/R, F5, F11, F12, Ctrl+Tab', () => {
      for (const p of [mac, win]) {
         const M = p.mac ? { m: true } : { c: true };
         for (const k of ['w', 't', 'n', 'q', 'r', 'W', 'N', 'v', 'a'])
            for (const s of [false, true]) assert.equal(K.mapKey(ev(k, { ...M, s }), p), null, k);
         for (const k of ['F5', 'F11', 'F12', 'F1']) assert.equal(K.mapKey(ev(k), p), null, k);
         assert.equal(K.mapKey(ev('Tab', { c: true }), p), null);
      }
   });

   await check('mapKey: modifier-only and unnamed multi-character keys give null; Shift alone is null', () => {
      for (const k of ['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'Dead', 'Process', 'Unidentified', 'ContextMenu'])
         assert.equal(K.mapKey(ev(k, { s: k === 'Shift' }), mac), null, k);
      assert.equal(K.mapKey(ev('Shift', { s: true }), win), null);
   });

   await check('mapKey: typing, Shift, repeat, Mac Alt characters, AltGr; up events give null', () => {
      assert.deepEqual(K.mapKey(ev('a'), win), { edit: { op: 'insert', text: 'a' } });
      assert.deepEqual(K.mapKey(ev('A', { s: true }), mac), { edit: { op: 'insert', text: 'A' } });
      assert.deepEqual(K.mapKey(ev(' '), mac), { edit: { op: 'insert', text: ' ' } });
      assert.deepEqual(K.mapKey(ev('a', {}, { rep: true }), win), { edit: { op: 'insert', text: 'a' } });   // repeated 'a' types
      assert.deepEqual(K.mapKey(ev('å', { a: true }), mac), { edit: { op: 'insert', text: 'å' } });   // Option+A
      assert.equal(K.mapKey(ev('a', { a: true }), win), null);                                    // bare Alt is the menu bar
      assert.deepEqual(K.mapKey(ev('@', { c: true, a: true }), win), { edit: { op: 'insert', text: '@' } });   // AltGr
      assert.equal(K.mapKey(ev('å', { a: true, m: true }), mac), null);
      assert.equal(K.mapKey({ ...ev('a'), d: 'up' }, win), null);
      assert.equal(K.mapKey({ ...ev('Enter', { c: true }), d: 'up' }, win), null);
   });

   await check('mapKey: named keys, repeat for movement and deletion, none for commands', () => {
      assert.deepEqual(K.mapKey(ev('Tab'), win), { edit: { op: 'tab' } });
      assert.deepEqual(K.mapKey(ev('Backspace', {}, { rep: true }), win), { edit: { op: 'backspace' } });
      assert.deepEqual(K.mapKey(ev('Delete'), win), { edit: { op: 'delete' } });
      assert.deepEqual(K.mapKey(ev('ArrowDown', {}, { rep: true }), mac), { edit: { op: 'move', dir: 'down' } });
      assert.deepEqual(K.mapKey(ev('Home'), win), { edit: { op: 'move', dir: 'home' } });
      assert.deepEqual(K.mapKey(ev('End'), win), { edit: { op: 'move', dir: 'end' } });
      assert.deepEqual(K.mapKey(ev('PageUp'), win), { edit: { op: 'move', dir: 'pageup' } });
      assert.deepEqual(K.mapKey(ev('PageDown'), win), { edit: { op: 'move', dir: 'pagedown' } });
      assert.deepEqual(K.mapKey(ev('ArrowLeft', { s: true }), win), { edit: { op: 'move', dir: 'left' } });
      assert.equal(K.mapKey(ev('Enter', { c: true }, { rep: true }), win), null);               // repeated Mod+Enter
      assert.equal(K.mapKey(ev('Enter', { m: true, s: true }, { rep: true }), mac), null);
      assert.equal(K.mapKey(ev('p', { c: true }, { rep: true }), win), null);
      assert.equal(K.mapKey(ev('Escape', {}, { rep: true }), win), null);
      assert.equal(K.mapKey(ev('Home', { c: true }, { rep: true }), win), null);
      assert.deepEqual(K.mapKey(ev('z', { c: true }, { rep: true }), win), { edit: { op: 'undo' } });   // undo may repeat
   });

   await check('every edit mapKey produces is accepted by the buffer', () => {
      const b = new T.TextBuffer('abc\ndef');
      const keys = [ev('x'), ev('Enter'), ev('Tab'), ev('Backspace'), ev('Delete'), ev('ArrowLeft'), ev('ArrowUp'), ev('Home'),
                    ev('End'), ev('PageDown'), ev('z', { c: true }), ev('z', { c: true, s: true }), ev('Backspace', { c: true })];
      keys.forEach((k, i) => { const m = K.mapKey(k, win); assert.ok(m && m.edit); b.apply(m.edit, i * 1000); valid(b); });
   });

   // ---- commands ----

   await check('parseCommand: card', () => {
      assert.deepEqual(C.parseCommand('card osc'), { op: 'addModule', name: 'osc' });
      assert.deepEqual(C.parseCommand('  card   osc  '), { op: 'addModule', name: 'osc' });
   });

   await check('parseCommand: the target commands', () => {
      assert.deepEqual(C.parseCommand('rm'), { op: 'rm' });
      assert.deepEqual(C.parseCommand('rename osc2'), { op: 'rename', name: 'osc2' });
      for (const w of ['undo', 'reset', 'revert', 'pause', 'live', 'play', 'here'])
         assert.deepEqual(C.parseCommand(w), { op: w });
   });

   await check('parseCommand: use, plug and unplug', () => {
      assert.deepEqual(C.parseCommand('use target pointer_pos'), { op: 'use', port: 'target', variable: 'pointer_pos' });
      assert.deepEqual(C.parseCommand('  use   target   pointer_pos '), { op: 'use', port: 'target', variable: 'pointer_pos' });
      assert.deepEqual(C.parseCommand('use target'), { op: 'use', port: 'target', variable: null }, 'no variable: back to the same name');
      assert.deepEqual(C.parseCommand('plug'), { op: 'plug', on: true });
      assert.deepEqual(C.parseCommand('unplug'), { op: 'plug', on: false });
      assert.match(C.parseCommand('use').error, /usage: use <input> \[variable\]/);
      assert.match(C.parseCommand('use Target x').error, /bad name 'Target'/);
      assert.match(C.parseCommand('use target Pos').error, /bad name 'Pos'/);
      assert.match(C.parseCommand('use a b c').error, /usage: use/);
      assert.match(C.parseCommand('here now').error, /usage: here/);
      assert.match(C.parseCommand('plug now').error, /usage: plug/); assert.match(C.parseCommand('unplug now').error, /usage: unplug/);
   });

   await check('parseCommand: errors carry a message and never throw; the rail commands are gone', () => {
      for (const bad of ['card', 'fly', '', '   ', 'card Osc', 'card 1a', 'card a-b', 'card ' + 'a'.repeat(33),
                         'card a b', 'rail target', 'rail t state num', 'kind event', 'undock',
                         'rename', 'rename A', 'rm now', 'pause now', 'undo it', 'CARD x', 'constructor', '__proto__', 'use constructor', 'use x constructor']) {
         const r = C.parseCommand(bad);
         assert.equal(typeof r.error, 'string', JSON.stringify(bad));
         assert.ok(r.error.length > 0 && !('op' in r), JSON.stringify(bad));
      }
      assert.ok(C.parseCommand('fly').error.includes('fly'));
      assert.equal(typeof C.parseCommand(undefined).error, 'string');
      assert.deepEqual(C.parseCommand('card ' + 'a'.repeat(32)), { op: 'addModule', name: 'a'.repeat(32) });
   });

   // ---- Spatial logic: layout, gaze focus, scrub ----

   const rad = d => d * Math.PI / 180;
   const deg = r => r * 180 / Math.PI;
   // A head matrix (column-major) at p, yawed to the right by yaw and pitched up by pitch (radians).
   const headAt = (p, yaw = 0, pitch = 0) => {
      const [cy, sy, cp, sp] = [Math.cos(yaw), Math.sin(yaw), Math.cos(pitch), Math.sin(pitch)];
      const rot = (x, y, z) => [cy * x - sy * z, y, sy * x + cy * z];          // yaw about +y, positive = to the right
      return [...rot(1, 0, 0), 0, ...rot(0, cp, sp), 0, ...rot(0, -sp, cp), 0, p[0], p[1], p[2], 1];
   };
   // The unit direction of a gaze at (yaw, pitch) relative to a workspace yaw.
   const dirAt = (wsYaw, yaw, pitch) => {
      const a = wsYaw + yaw;
      return [Math.sin(a) * Math.cos(pitch), Math.sin(pitch), -Math.cos(a) * Math.cos(pitch)];
   };
   const rayFrom = (o, a, b) => { const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]; const n = Math.hypot(...d); return { o, d: d.map(v => v / n) }; };
   const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg || ''} ${a} vs ${b}`);

   const L = await load('js/scenes/rails/layout.js');
   const F = await load('js/scenes/rails/gazeFocus.js');
   const TL = await load('js/scenes/rails/timeline.js');

   // Seated at (0.2, 1.3, -0.4), looking straight ahead.
   const HEAD = [0.2, 1.3, -0.4];
   const ws0 = L.workspace(headAt(HEAD));
   const aim = (ws, yawDeg, pitchDeg = 0) => ({ o: ws.origin, d: dirAt(ws.yaw, rad(yawDeg), rad(pitchDeg)) });

   await check('layout constants are the plan numbers', () => {
      assert.equal(L.RADIUS, 1.25);
      assert.deepEqual(L.SLOTS, [-50, -25, 0, 25, 50]);
      assert.deepEqual(L.CARD, { w: 0.5, h: 0.5, px: 640, cols: 32, rows: 12 });
   });

   await check('the distance along the ray: yawPitchOf gives it for the cylinder, busWindowHit for the panel (with the point), deskTrace for the mat (with the point)', () => {
      let h = L.yawPitchOf(ws0, aim(ws0, 0, 0)); near(h.t, L.RADIUS, 1e-9, 'straight ahead: 1.25 m');
      h = L.yawPitchOf(ws0, aim(ws0, 30, 0)); near(h.t, L.RADIUS, 1e-9, 'level: 1.25 m whatever the yaw');
      h = L.yawPitchOf(ws0, aim(ws0, 0, 20)); near(h.t, L.RADIUS / Math.cos(rad(20)), 1e-9, 'pitched: longer');
      const ws = L.workspace(headAt(HEAD, rad(40))), m = L.busWindowFrame(ws, rad(20));
      const at = (x, y) => { const q = [m[12] + m[0] * x + m[4] * y, m[13] + m[1] * x + m[5] * y, m[14] + m[2] * x + m[6] * y]; return { o: ws.origin, d: q.map((v, i) => v - ws.origin[i]) }; };
      const r = at(0.1, -0.05), len = Math.hypot(...r.d); r.d = r.d.map(v => v / len);
      const hit = L.busWindowHit(ws, rad(20), r);
      const q = [m[12] + m[0] * 0.1 + m[4] * -0.05, m[13] + m[1] * 0.1 + m[5] * -0.05, m[14] + m[2] * 0.1 + m[6] * -0.05];
      for (let i = 0; i < 3; i++) near(hit.point[i], q[i], 1e-9, 'the point on the panel ' + i);
      near(hit.t, Math.hypot(...q.map((v, i) => v - ws.origin[i])), 1e-9, 'its distance');
      assert.deepEqual(hit.px, L.busWindowPixel(ws, rad(20), r), 'the pixel is the same one');
      assert.equal(L.busWindowHit(ws, rad(20), at(0.5, 0)), null, 'off the panel'); assert.equal(L.busWindowHit(ws, rad(20), { o: [NaN, 0, 0], d: [0, 0, -1] }), null);
      const stage = L.stageFrame(ws0, 0.85), c = [stage[12], stage[13], stage[14]], dd = c.map((v, i) => v - ws0.origin[i]), dl = Math.hypot(...dd);
      const ray = { o: ws0.origin, d: dd.map(v => v / dl) }, t = L.deskTrace(ray, stage);
      near(t.t, dl, 1e-9, 'the distance to the mat'); for (let i = 0; i < 3; i++) near(t.point[i], c[i], 1e-9, 'the centre of the mat ' + i);
      assert.deepEqual(t.local, L.deskHit(ray, stage), 'the mat coordinates are deskHit\'s');
      assert.equal(L.deskTrace({ o: ws0.origin, d: [0, 0, -1] }, stage), null, 'level: never meets the desk');
      const off = { o: ws0.origin, d: dd.map((v, i) => (i === 0 ? v + 0.5 : v)) }; off.d = off.d.map(v => v / Math.hypot(...off.d));
      assert.equal(L.deskTrace(off, stage), null, 'off the 0.40 m mat');
   });

   await check('workspace: origin, yaw (right is positive), eye height; frozen copy', () => {
      const ws = L.workspace(headAt(HEAD, rad(30)));
      assert.deepEqual(ws.origin, HEAD);
      near(ws.yaw, rad(30), 1e-9, 'yaw');
      assert.equal(ws.eyeY, 1.3);
      near(L.workspace(headAt(HEAD, rad(-70))).yaw, rad(-70), 1e-9, 'left is negative');
      near(L.workspace(headAt(HEAD, rad(30), rad(-50))).yaw, rad(30), 1e-9, 'a pitched head keeps its yaw');
      for (const p of [-90, 90, -89.99, 89.99, -89.95, 89.95, -89.9, 89.9])   // the first six take the near-vertical fallback
         for (const y of [30, -120, 0]) near(L.workspace(headAt(HEAD, rad(y), rad(p))).yaw, rad(y), 1e-6, `pitch ${p} yaw ${y}`);
      const head = headAt(HEAD, 0); const w = L.workspace(head);
      head[12] = 99; head[13] = 99;
      assert.deepEqual(w.origin, HEAD); assert.equal(w.eyeY, 1.3);        // later head motion cannot move it
   });

   await check('yawPitchOf: a straight ray lands on the cylinder at yaw 0; yaw is relative to the workspace', () => {
      let h = L.yawPitchOf(ws0, aim(ws0, 0));
      near(h.yaw, 0, 1e-9); near(h.pitch, 0, 1e-9); near(h.height, 0, 1e-9);
      const ws = L.workspace(headAt(HEAD, rad(40)));
      h = L.yawPitchOf(ws, { o: ws.origin, d: dirAt(rad(40), rad(25), rad(10)) });
      near(h.yaw, rad(25), 1e-9, 'relative yaw'); near(h.pitch, rad(10), 1e-9, 'pitch');
      near(h.height, L.RADIUS * Math.tan(rad(10)), 1e-9, 'height above the eye');
      h = L.yawPitchOf(ws0, { o: [ws0.origin[0] + 0.1, ws0.origin[1], ws0.origin[2]], d: [0, 0, -1] });
      near(L.RADIUS * Math.sin(h.yaw), 0.1, 1e-9, 'an off-centre origin still hits the cylinder');
      assert.equal(L.yawPitchOf(ws0, { o: [ws0.origin[0], ws0.origin[1] + 1, ws0.origin[2]], d: [0, 1, 0] }), null, 'parallel to the axis');
      assert.equal(L.yawPitchOf(ws0, { o: [ws0.origin[0] + 5, ws0.origin[1], ws0.origin[2]], d: [1, 0, 0] }), null, 'outside, pointing away');
      h = L.yawPitchOf(ws0, aim(ws0, 170));
      near(Math.abs(h.yaw), rad(170), 1e-9, 'behind the head still resolves');
   });

   await check('hitCard: a straight ray hits slot 2; the gap and empty slots hit nothing', () => {
      const all = [0, 1, 2, 3, 4];
      assert.equal(L.hitCard(ws0, aim(ws0, 0), all, null), 2);
      for (let s = 0; s < 5; s++) assert.equal(L.hitCard(ws0, aim(ws0, L.SLOTS[s]), all, null), s);
      const r = L.cardRect(2);
      near(r.yaw1 - r.yaw0, 2 * Math.atan(0.25 / L.RADIUS), 1e-9, 'width');
      near((r.yaw0 + r.yaw1) / 2, 0, 1e-9);
      assert.equal(L.hitCard(ws0, aim(ws0, 12.5), all, null), null, 'in the gap between slots 2 and 3');
      assert.equal(L.hitCard(ws0, aim(ws0, 0, 30), all, null), null, 'above the cards');
      assert.equal(L.hitCard(ws0, aim(ws0, 0, -30), all, null), null, 'below the cards');
      assert.equal(L.hitCard(ws0, aim(ws0, 25), [2], null), null, 'slot 3 not occupied');
      assert.equal(L.hitCard(ws0, aim(ws0, 25), [3], null), 3);
      const ws = L.workspace(headAt(HEAD, rad(-60)));
      assert.equal(L.hitCard(ws, { o: ws.origin, d: dirAt(rad(-60), rad(-25), 0) }, all, null), 1, 'follows the workspace yaw');
   });

   await check('hitCard: 3 degrees outside the focused card still hits it, not an unfocused one', () => {
      const all = [0, 1, 2, 3, 4];
      const edge = deg(L.cardRect(2).yaw1);                                   // about 11.3
      assert.equal(L.hitCard(ws0, aim(ws0, edge + 3), all, 2), 2);
      assert.equal(L.hitCard(ws0, aim(ws0, edge + 3), all, null), 3, 'nothing focused: slot 3 owns that gaze');
      assert.equal(L.hitCard(ws0, aim(ws0, edge + 3), all, 3), 3, 'slot 3 focused');
      assert.equal(L.hitCard(ws0, aim(ws0, edge + 3.5), all, 2), 2, 'inside the 4 degree margin');
      assert.equal(L.hitCard(ws0, aim(ws0, edge + 4.5), all, 2), 3, 'beyond the margin');
      assert.equal(L.hitCard(ws0, aim(ws0, 0, deg(L.cardRect(2).pitch1) + 3), all, 2), 2, 'above the focused card too');
      assert.equal(L.hitCard(ws0, aim(ws0, 0, deg(L.cardRect(2).pitch1) + 3), all, null), null);
   });

   await check('cell: text cell centres on the 640 px canvas', () => {
      const a = L.cell(0, 0), b = L.cell(1, 0), c = L.cell(0, 1), z = L.cell(31, 11);
      near(b.x - a.x, 17.4 / 1280, 1e-9, 'advance'); near(a.y - c.y, 40 / 1280, 1e-9, 'line pitch');
      assert.ok(a.x < 0 && a.x > -0.25 && a.y > 0 && a.y < 0.25, 'top left, inside the card');
      assert.ok(z.x > 0 && z.x < 0.25, 'right half');
      assert.ok(z.y > -0.175 && z.y < -0.07, 'the last line sits above the footer strip');
      near(a.y, (320 - (64 + 20)) / 1280, 1e-9, 'below the 64 px header');
   });

   await check('stageFrame: the mat is 0.45 m right and 0.10 m ahead of the workspace floor point', () => {
      const ws = L.workspace(headAt([0, 1.3, 0], 0));
      const m = L.stageFrame(ws, 0.85);
      assert.equal(m.length, 16);
      assert.deepEqual([m[12], m[13], m[14], m[15]].map(v => +v.toFixed(9)), [0.45, 0.85, -0.10, 1]);
      assert.deepEqual([m[0], m[1], m[2]].map(v => +v.toFixed(9)), [1, 0, 0]);
      assert.deepEqual([m[4], m[5], m[6]].map(v => +v.toFixed(9)), [0, 1, 0]);
      assert.deepEqual([m[8], m[9], m[10]].map(v => +v.toFixed(9)), [0, 0, 1]);
      const w = L.workspace(headAt(HEAD, rad(90)));                           // facing +x: right is +z, ahead is +x
      const r = L.stageFrame(w, 0.8);
      near(r[12], HEAD[0] + 0.10, 1e-9); near(r[14], HEAD[2] + 0.45, 1e-9); near(r[13], 0.8, 1e-12);
      near(r[8], -1, 1e-9, 'z points back at the user'); near(r[10], 0, 1e-9);
   });

   await check('stageFrame ignores later head motion (it depends only on the frozen workspace)', () => {
      const head = headAt(HEAD, rad(20));
      const ws = L.workspace(head);
      const before = L.stageFrame(ws, 0.9).slice();
      head[12] += 3; head[14] -= 2;                                            // the head walks away
      const moved = L.workspace(headAt([5, 1.4, 5], rad(-80)));
      assert.notDeepEqual(moved.origin, ws.origin);
      assert.deepEqual(L.stageFrame(ws, 0.9), before);
   });

   await check('deskHit: stage coordinates on the mat, null off it, behind or parallel', () => {
      const ws = L.workspace(headAt(HEAD, rad(30)));
      const st = L.stageFrame(ws, 0.85);
      const onDesk = (x, z) => [st[12] + x * st[0] + z * st[8], 0.85, st[14] + x * st[2] + z * st[10]];
      const eye = [ws.origin[0], ws.eyeY, ws.origin[2]];
      for (const [x, z] of [[0, 0], [0.1, -0.05], [-0.19, 0.19], [0.2, 0.2]]) {
         const h = L.deskHit(rayFrom(eye, eye, onDesk(x, z)), st);
         assert.ok(h, `${x},${z}`);
         near(h[0], x, 1e-9); assert.equal(h[1], 0); near(h[2], z, 1e-9);
      }
      for (const [x, z] of [[0.21, 0], [-0.21, 0], [0, 0.21], [0, -0.21], [0.4, 0.4]])
         assert.equal(L.deskHit(rayFrom(eye, eye, onDesk(x, z)), st), null, `${x},${z}`);
      assert.equal(L.deskHit({ o: eye, d: [0, 1, 0] }, st), null, 'pointing up');
      assert.equal(L.deskHit({ o: eye, d: [Math.sin(rad(30)), 0, -Math.cos(rad(30))] }, st), null, 'parallel to the desk');
      assert.equal(L.deskHit({ o: [eye[0], 0.5, eye[2]], d: dirAt(0, 0, rad(-10)) }, st), null, 'from under the desk');
   });

   await check('a NaN ray (tracking loss) hits nothing', () => {
      const bad = [{ o: ws0.origin, d: [NaN, 0, -1] }, { o: ws0.origin, d: [0, Infinity, -1] }, { o: [NaN, 1, 0], d: [0, 0, -1] },
                   { o: ws0.origin, d: [NaN, NaN, NaN] }, { o: ws0.origin, d: [0, -1, 0 / 0] }];
      const st = L.stageFrame(ws0, 0.85);
      for (const r of bad) {
         assert.equal(L.yawPitchOf(ws0, r), null);
         assert.equal(L.hitCard(ws0, r, [0, 1, 2, 3, 4], 2), null);
         assert.equal(L.deskHit(r, st), null);
      }
      assert.equal(L.yawPitchOf(ws0, undefined), null);
   });

   // ---- gazeFocus ----

   await check('stepFocus: a dwell of 0.34 s does not switch, 0.36 s does; the ring fills', () => {
      for (const start of [null, 2]) {
         let st = F.stepFocus(F.newFocus(start), { t: 0, hit: start === 2 ? 2 : null, lastTextKeyT: null });
         assert.equal(st.focus, start);
         st = F.stepFocus(st, { t: 1, hit: 3, lastTextKeyT: null });
         assert.equal(st.focus, start); assert.deepEqual(st.charging, { slot: 3, p: 0 });
         const a = F.stepFocus(st, { t: 1.34, hit: 3, lastTextKeyT: null });
         assert.equal(a.focus, start, 'not yet');
         near(a.charging.p, 0.34 / 0.35, 1e-9); assert.equal(a.charging.slot, 3);
         const b = F.stepFocus(st, { t: 1.36, hit: 3, lastTextKeyT: null });
         assert.equal(b.focus, 3); assert.equal(b.charging, null);
      }
   });

   await check('stepFocus: gaze on nothing keeps focus; looking back or away cancels the dwell', () => {
      let st = F.stepFocus(F.newFocus(2), { t: 0, hit: 2, lastTextKeyT: null });
      for (let t = 0.1; t < 5; t += 0.1) { st = F.stepFocus(st, { t, hit: null, lastTextKeyT: null }); assert.equal(st.focus, 2); }
      st = F.stepFocus(st, { t: 6, hit: 3, lastTextKeyT: null });
      st = F.stepFocus(st, { t: 6.2, hit: null, lastTextKeyT: null });         // glance at the keyboard
      assert.equal(st.charging, null);
      st = F.stepFocus(st, { t: 6.3, hit: 3, lastTextKeyT: null });
      st = F.stepFocus(st, { t: 6.6, hit: 3, lastTextKeyT: null });
      assert.equal(st.focus, 2, 'the dwell restarted at 6.3');
      st = F.stepFocus(st, { t: 6.66, hit: 3, lastTextKeyT: null });
      assert.equal(st.focus, 3);
      st = F.stepFocus(st, { t: 7, hit: 4, lastTextKeyT: null });
      st = F.stepFocus(st, { t: 7.2, hit: 1, lastTextKeyT: null });            // another card restarts it
      st = F.stepFocus(st, { t: 7.5, hit: 1, lastTextKeyT: null });
      assert.equal(st.focus, 3); assert.equal(st.charging.slot, 1);
      st = F.stepFocus(st, { t: 7.56, hit: 1, lastTextKeyT: null });
      assert.equal(st.focus, 1);
   });

   await check('stepFocus: within 1 s of a text key nothing switches', () => {
      let st = F.newFocus(2);
      st = F.stepFocus(st, { t: 10, hit: 2, lastTextKeyT: 10 });
      for (const t of [10.1, 10.4, 10.8, 10.99]) {
         st = F.stepFocus(st, { t, hit: 3, lastTextKeyT: 10 });
         assert.equal(st.focus, 2, `t ${t}`); assert.equal(st.charging, null, 'no ring while locked');
      }
      st = F.stepFocus(st, { t: 11.1, hit: 3, lastTextKeyT: 10 });             // unlocked, the dwell starts counting
      assert.equal(st.focus, 2);
      st = F.stepFocus(st, { t: 11.3, hit: 3, lastTextKeyT: 10 });
      assert.equal(st.focus, 2);
      st = F.stepFocus(st, { t: 11.46, hit: 3, lastTextKeyT: 10 });
      assert.equal(st.focus, 3, 'a pause of more than 1 s plus a dwell moves it');
      // A fresh key restarts the lock.
      st = F.stepFocus(st, { t: 12, hit: 4, lastTextKeyT: 12 });
      st = F.stepFocus(st, { t: 12.9, hit: 4, lastTextKeyT: 12 });
      assert.equal(st.focus, 3);
   });

   await check('stepFocus: across a frame gap the dwell still starts when the lock ends', () => {
      let st = F.stepFocus(F.newFocus(2), { t: 10, hit: 2, lastTextKeyT: 10 });
      st = F.stepFocus(st, { t: 10.5, hit: 3, lastTextKeyT: 10 });             // last locked frame
      st = F.stepFocus(st, { t: 11.0, hit: 3, lastTextKeyT: 10 });             // next frame: lock just over
      assert.equal(st.focus, 2, 'no instant switch');
      assert.equal(st.charging.slot, 3); near(st.charging.p, 0, 1e-9, 'ring starts at the lock end');
      st = F.stepFocus(st, { t: 11.34, hit: 3, lastTextKeyT: 10 });
      assert.equal(st.focus, 2);
      st = F.stepFocus(st, { t: 11.36, hit: 3, lastTextKeyT: 10 });
      assert.equal(st.focus, 3);
      // Also when the whole dwell fell inside a long gap between two frames.
      let u = F.stepFocus(F.newFocus(2), { t: 20.2, hit: 3, lastTextKeyT: 20 });
      u = F.stepFocus(u, { t: 21.1, hit: 3, lastTextKeyT: 20 });
      assert.equal(u.focus, 2);
   });

   await check('stepFocus: release and set; steps do not mutate their input', () => {
      let st = F.newFocus(2);
      const frozen = Object.freeze({ ...st });
      F.stepFocus(frozen, { t: 1, hit: 3, lastTextKeyT: null });
      assert.equal(F.releaseFocus().focus, null);
      assert.equal(F.setFocus(4).focus, 4);
      st = F.stepFocus(F.releaseFocus(), { t: 1, hit: null, lastTextKeyT: null });
      assert.equal(st.focus, null);
      st = F.stepFocus(st, { t: 2, hit: 0, lastTextKeyT: null });
      st = F.stepFocus(st, { t: 2.36, hit: 0, lastTextKeyT: null });
      assert.equal(st.focus, 0, 'after Esc the next dwell acquires a card');
      assert.equal(F.stepFocus(undefined, { t: 0, hit: null, lastTextKeyT: null }).focus, null);
   });

   // ---- timeline ----

   await check('scrub: 100 units = 1 s, clamped to the window', () => {
      assert.equal(TL.scrub(10, 150, [0, 30]), 11.5);
      assert.equal(TL.scrub(10, -250, [0, 30]), 7.5);
      assert.equal(TL.scrub(10, 100000, [0, 30]), 30);
      assert.equal(TL.scrub(10, -100000, [0, 30]), 0);
      assert.equal(TL.scrub(29.9, 50, { min: 0, max: 30 }), 30);
      assert.equal(TL.scrub(-5, 0, [0, 30]), 0, 'an out-of-range playhead is clamped even for no motion');
      assert.equal(TL.scrub(10, NaN, [0, 30]), 10);
      assert.equal(TL.scrub(10, 100, [12, 12]), 12, 'an empty window');
      assert.equal(TL.UNITS_PER_SECOND, 100);
      assert.equal(TL.scrub(NaN, 50, [0, 30]), 30, 'a bad playhead becomes now');
      assert.equal(TL.scrub(undefined, 50, { t0: 0, t1: 30 }), 30);
      assert.equal(TL.scrub(Infinity, 0, { min: 0, max: 20 }), 20);
      assert.equal(TL.scrub(5, 100, { t0: 0, t1: 30 }), 6);
   });

   // ---- v2 input: keys, zoom sizes, sideways scroll ----
   await check('mapKey: Mod+B is the bus window; Mod+= / Mod++ zoom in, Mod+- out, Mod+0 reset (both platforms, no repeat)', () => {
      for (const [p, M] of [[mac, { m: true }], [win, { c: true }]]) {
         assert.deepEqual(K.mapKey(ev('b', M), p), { cmd: 'bus' });
         assert.deepEqual(K.mapKey(ev('B', { ...M, s: true }), p), { cmd: 'bus' });
         assert.deepEqual(K.mapKey(ev('=', M), p), { cmd: 'zoomIn' });
         assert.deepEqual(K.mapKey(ev('+', { ...M, s: true }), p), { cmd: 'zoomIn' });
         assert.deepEqual(K.mapKey(ev('-', M), p), { cmd: 'zoomOut' });
         assert.deepEqual(K.mapKey(ev('0', M), p), { cmd: 'zoomReset' });
         for (const k of ['b', '=', '-', '0']) assert.equal(K.mapKey(ev(k, M, { rep: true }), p), null, k + ' repeat');
      }
      assert.deepEqual(K.mapKey(ev('b'), win), { edit: { op: 'insert', text: 'b' } });
      assert.equal(K.mapKey(ev('b', { c: true }), mac), null, 'Ctrl+B on a Mac is the OS\'s');
      assert.equal(K.mapKey(ev('=', { m: true }), win), null, 'Meta+= on Windows is the OS\'s');
   });

   await check('mapKey: Mod+[ / Mod+] step back / forward, Shift (which types { and }) is the fine step; they repeat', () => {
      for (const [p, M] of [[mac, { m: true }], [win, { c: true }]]) {
         assert.deepEqual(K.mapKey(ev('[', M), p), { cmd: 'stepBack' });
         assert.deepEqual(K.mapKey(ev(']', M), p), { cmd: 'stepFwd' });
         assert.deepEqual(K.mapKey(ev('{', { ...M, s: true }), p), { cmd: 'stepBack', fine: true });
         assert.deepEqual(K.mapKey(ev('}', { ...M, s: true }), p), { cmd: 'stepFwd', fine: true });
         assert.deepEqual(K.mapKey(ev(']', M, { rep: true }), p), { cmd: 'stepFwd' }, 'holding the key keeps stepping');
      }
      assert.equal(K.mapKey(ev('[', { m: true, a: true }), mac), null, 'Cmd+Option: nothing');
      assert.deepEqual(K.mapKey(ev('[', {}), win), { edit: { op: 'insert', text: '[' } }, 'a bare [ is typed');
      // another layout: the key's place (code) says it, with or without Shift
      for (const [p, M] of [[mac, { m: true }], [win, { c: true }]]) {
         assert.deepEqual(K.mapKey(ev('ü', M, { code: 'BracketLeft' }), p), { cmd: 'stepBack' });
         assert.deepEqual(K.mapKey(ev('+', M, { code: 'BracketRight' }), p), { cmd: 'stepFwd' });
         assert.deepEqual(K.mapKey(ev('Ü', { ...M, s: true }, { code: 'BracketLeft' }), p), { cmd: 'stepBack', fine: true });
         assert.equal(K.mapKey(ev('ü', M, { code: 'KeyU' }), p), null);
      }
   });

   await check('ZOOMS: index 1 is today\'s 32 columns; 26 and 40 fit the 480 px code area and the card width with the same left margin', () => {
      assert.equal(L.ZOOM_DEFAULT, 1);
      assert.deepEqual(L.ZOOMS.map(z => z.cols), [26, 32, 40]);
      assert.deepEqual(L.ZOOMS[1], { cols: 32, font: 29, adv: 17.4, line: 40, rows: 12 });
      assert.equal(L.CARD.cols, 32); assert.equal(L.CARD.rows, 12); assert.equal(L.GRID.adv, 17.4); assert.equal(L.GRID.line, 40);
      for (const z of L.ZOOMS) {
         assert.ok(z.rows * z.line <= 480 && (z.rows + 1) * z.line > 480, `rows fill the code area: ${JSON.stringify(z)}`);
         assert.ok(L.GRID.padX + z.cols * z.adv <= L.CARD.px - 16, `columns fit: ${JSON.stringify(z)}`);
         assert.ok(Math.abs(z.adv - z.font * 0.6) < 1e-9, 'the advance is 0.6 of the font');
      }
      assert.ok(L.ZOOMS[0].font > 29 && L.ZOOMS[2].font < 29);
      assert.ok(L.ZOOMS[0].rows < 12 && L.ZOOMS[2].rows > 12);
   });

   const longLine = n => 'x'.repeat(n);
   await check('TextBuffer: size op sets columns and rows; the cursor stays in view with the new row count', () => {
      const b = new T.TextBuffer(Array.from({ length: 40 }, (_, i) => 'l' + i).join('\n'));
      assert.deepEqual([b.cols, b.rows, b.scrollX], [32, 12, 0]);
      for (let i = 0; i < 11; i++) b.apply({ op: 'move', dir: 'down' }, 0);
      assert.equal(b.scroll, 0);
      assert.equal(b.apply({ op: 'size', cols: 26, rows: 10 }, 0), true);
      assert.deepEqual([b.cols, b.rows], [26, 10]); assert.equal(b.scroll, 2, 'row 11 needs scroll 2 with 10 rows');
      b.apply({ op: 'size', cols: 40, rows: 15 }, 0); assert.equal(b.scroll, 2, 'a bigger window keeps the cursor in view');
      for (let i = 0; i < 20; i++) b.apply({ op: 'move', dir: 'down' }, 0);
      assert.ok(b.row >= b.scroll && b.row < b.scroll + 15);
      assert.equal(b.row, 31);
      b.apply({ op: 'move', dir: 'pageup' }, 0); assert.equal(b.row, 16, 'page keys move by the card\'s rows');
      b.apply({ op: 'size', cols: 26, rows: 10 }, 0); b.apply({ op: 'move', dir: 'pagedown' }, 0); assert.equal(b.row, 26);
      assert.equal(b.apply({ op: 'size', cols: 26, rows: 10 }, 0), false, 'the same size changes nothing');
      b.apply({ op: 'scroll', lines: 100 }, 0); assert.equal(b.scroll, 30, 'scroll clamps to lines - rows');
      b.apply({ op: 'size', cols: 'a', rows: -3 }, 0); assert.deepEqual([b.cols, b.rows], [26, 10], 'junk is ignored');
   });

   await check('TextBuffer: scrollX keeps the cursor two columns inside both edges, and goes back to 0 at the line start', () => {
      const b = new T.TextBuffer(longLine(100));
      const inside = () => { const v = b.col - b.scrollX; assert.ok(v >= Math.min(2, b.col) && v <= b.cols - 3, `col ${b.col} scrollX ${b.scrollX}`); };
      for (let i = 0; i < 29; i++) { b.apply({ op: 'move', dir: 'right' }, 0); inside(); }
      assert.equal(b.scrollX, 0, 'col 29 is the last that has two columns after it in 32');
      b.apply({ op: 'move', dir: 'right' }, 0); assert.equal(b.scrollX, 1); inside();
      for (let i = 0; i < 40; i++) { b.apply({ op: 'move', dir: 'right' }, 0); inside(); }
      assert.equal(b.scrollX, b.col - 29);
      b.apply({ op: 'move', dir: 'end' }, 0); inside(); assert.equal(b.scrollX, 100 - 29);
      b.apply({ op: 'move', dir: 'left' }, 0); assert.equal(b.scrollX, 100 - 29, 'moving left inside the window does not scroll');
      for (let i = 0; i < 80; i++) { b.apply({ op: 'move', dir: 'left' }, 0); inside(); }
      assert.equal(b.col, 19); assert.equal(b.scrollX, 17, 'two columns of margin at the left');
      b.apply({ op: 'move', dir: 'home' }, 0); assert.equal(b.scrollX, 0);
   });

   await check('TextBuffer: scrollX counts display columns (a tab is two), follows edits, zoom and a shorter line', () => {
      const b = new T.TextBuffer('\t'.repeat(20) + 'end');
      b.apply({ op: 'move', dir: 'end' }, 0);
      assert.equal(b.col, 23); assert.equal(b.scrollX, 43 - 29, 'column 43 on the card, not 23');
      b.apply({ op: 'size', cols: 40, rows: 15 }, 0); assert.equal(b.scrollX, 43 - 37, 'zoomed out: the clamp and then the cursor\'s two columns');
      b.apply({ op: 'size', cols: 26, rows: 10 }, 0); assert.equal(b.scrollX, 43 - 23, 'zoomed in: the cursor needs two columns at the right');
      b.apply({ op: 'insert', text: 'y' }, 0); assert.equal(b.scrollX, 44 - 23, 'typing at the end');
      const c = new T.TextBuffer('short\n' + longLine(60));
      c.apply({ op: 'move', dir: 'down' }, 0); c.apply({ op: 'move', dir: 'end' }, 0); assert.equal(c.scrollX, 60 - 29);
      c.apply({ op: 'move', dir: 'up' }, 0); assert.equal(c.scrollX, 3, 'a short line: the cursor at col 5 keeps two columns on its left');
      c.apply({ op: 'move', dir: 'home' }, 0); assert.equal(c.scrollX, 0);
      const d = new T.TextBuffer(longLine(60)); d.apply({ op: 'move', dir: 'end' }, 0);
      d.apply({ op: 'set', text: 'a' }, 0); assert.equal(d.scrollX, 0, 'set starts at the left');
   });

   await check('TextBuffer: the scrollX op (wheel) moves the window only, within the longest line; the next cursor move pulls it back', () => {
      const b = new T.TextBuffer(longLine(50) + '\nab');
      assert.equal(b.apply({ op: 'scrollX', cols: -3 }, 0), false); assert.equal(b.scrollX, 0);
      b.apply({ op: 'scrollX', cols: 5 }, 0); assert.equal(b.scrollX, 5); assert.deepEqual([b.row, b.col], [0, 0]);
      b.apply({ op: 'scrollX', cols: 500 }, 0); assert.equal(b.scrollX, 50 - 32 + 2, 'the end of the longest line plus two columns');
      b.apply({ op: 'move', dir: 'right' }, 0); assert.equal(b.scrollX, 0, 'the cursor (col 1) pulls the window back');
      const s = new T.TextBuffer('ab'); s.apply({ op: 'scrollX', cols: 9 }, 0); assert.equal(s.scrollX, 0, 'nothing to scroll to');
      b.apply({ op: 'scrollX', cols: 2.7 }, 0); assert.equal(b.scrollX, 2);
      assert.equal(b.apply({ op: 'reveal' }, 0), false, 'there is no such op: a focus change does not move the window');
   });

   await check('TextBuffer: zoom out pulls scrollX back to the longest line + 2 columns, and keeps the cursor in view', () => {
      const b = new T.TextBuffer(longLine(50) + '\n' + longLine(45));
      b.apply({ op: 'move', dir: 'down' }, 0); b.apply({ op: 'move', dir: 'end' }, 0); assert.equal(b.scrollX, 45 - 29);
      b.apply({ op: 'size', cols: 40, rows: 15 }, 0); assert.equal(b.scrollX, 50 + 2 - 40, 'no blank space beyond the longest line + 2');
      b.apply({ op: 'size', cols: 26, rows: 10 }, 0); assert.equal(b.scrollX, 45 - 23, 'zoom in: the cursor needs two columns at the right');
      b.apply({ op: 'move', dir: 'up' }, 0); b.apply({ op: 'move', dir: 'end' }, 0); assert.equal(b.scrollX, 50 - 23);
      b.apply({ op: 'size', cols: 40, rows: 15 }, 0); assert.equal(b.scrollX, 50 - 37, 'the cursor at the end of the longest line keeps its two columns');
   });

   await check('cardDraw view() follows the buffer\'s rows and carries scrollX', () => {
      const b = new T.TextBuffer(Array.from({ length: 40 }, (_, i) => 'l' + i).join('\n'));
      b.apply({ op: 'size', cols: 40, rows: 15 }, 0); b.apply({ op: 'scroll', lines: 100 }, 0);
      const v = D.view(b); assert.equal(v.scroll, 25); assert.equal(v.scrollX, 0); assert.equal(v.rows, 15);
      assert.equal(D.view({ text: 'a\nb', row: 0, col: 0 }).rows, 12, 'a plain object has the default rows');
   });

   await check('the bus, the plugs and the bus window: BUS numbers, plugCell/plugAt (5 degrees), onBus (1.5 degrees, the yaw range), busWindowFrame and the pixel under a ray', () => {
      assert.deepEqual(L.BUS, { y: -0.40, from: -62, to: 62 });
      const busPitch = deg(Math.atan2(-0.40, L.RADIUS));
      // the plug: the middle of the bottom edge, a little below it
      for (let s = 0; s < 5; s++) {
         const c = L.plugCell(s);
         assert.equal(c.x, 0); assert.ok(c.y < -0.25 && c.y > -0.30, 'a little below the card, ' + c.y);
         near(deg(c.yaw), L.SLOTS[s], 1e-9, 'under its card');
         near(c.pitch, Math.atan2(c.y - 0.02, L.RADIUS), 1e-9);
         assert.ok(c.pitch > Math.atan2(-0.40, L.RADIUS), 'above the bus');
      }
      assert.equal(L.plugCell(5), null); assert.equal(L.plugCell(-1), null); assert.equal(L.plugCell(1.5), null);
      const pc = L.plugCell(2), pitch0 = deg(pc.pitch);
      const w = L.plugWorld(ws0, 2); near(w[1], ws0.eyeY - 0.02 + pc.y, 1e-9, 'world height'); near(Math.hypot(w[0] - ws0.origin[0], w[2] - ws0.origin[2]), L.RADIUS, 1e-9);
      assert.equal(L.plugAt(ws0, aim(ws0, 0, pitch0), 2), true);
      assert.equal(L.plugAt(ws0, aim(ws0, 4.9, pitch0 + 4.9), 2), true, 'inside 5 degrees in both');
      assert.equal(L.plugAt(ws0, aim(ws0, 5.1, pitch0), 2), false, 'past 5 degrees of yaw');
      assert.equal(L.plugAt(ws0, aim(ws0, 0, pitch0 - 5.1), 2), false, 'past 5 degrees below');
      assert.equal(L.plugAt(ws0, aim(ws0, 0, pitch0 + 5.1), 2), false, 'past 5 degrees above');
      assert.equal(L.plugAt(ws0, aim(ws0, 6.9, pitch0), 2, rad(7)), true, 'a wider tolerance can be given (the leaving one of the hysteresis)');
      assert.equal(L.plugAt(ws0, aim(ws0, 7.1, pitch0), 2, rad(7)), false);
      assert.deepEqual([deg(L.PLUG_TOL), deg(L.PLUG_LEAVE)].map(Math.round), [5, 7], 'enter at 5 degrees, leave beyond 7');
      assert.equal(L.plugAt(ws0, aim(ws0, 0, pitch0), 1), false, 'another card');
      assert.equal(L.plugAt(ws0, aim(ws0, 25, pitch0), 3), true);
      assert.equal(L.plugAt(ws0, aim(ws0, 0, 0), 2), false, 'the card text');
      assert.equal(L.plugAt(ws0, { o: [NaN, 0, 0], d: [0, 0, -1] }, 2), false, 'tracking loss'); assert.equal(L.plugAt(ws0, aim(ws0, 0, pitch0), 9), false);
      // the bus band
      assert.equal(L.onBus(ws0, aim(ws0, 0, busPitch)), true);
      assert.equal(L.onBus(ws0, aim(ws0, 30, busPitch + 1.4)), true); assert.equal(L.onBus(ws0, aim(ws0, 30, busPitch - 1.4)), true);
      assert.equal(L.onBus(ws0, aim(ws0, 0, busPitch + 1.6)), false); assert.equal(L.onBus(ws0, aim(ws0, 0, busPitch - 1.6)), false);
      assert.equal(L.onBus(ws0, aim(ws0, 61.5, busPitch)), true); assert.equal(L.onBus(ws0, aim(ws0, 62.5, busPitch)), false);
      assert.equal(L.onBus(ws0, aim(ws0, -61.5, busPitch)), true); assert.equal(L.onBus(ws0, aim(ws0, -62.5, busPitch)), false);
      assert.equal(L.onBus(ws0, aim(ws0, 0, 0)), false); assert.equal(L.onBus(ws0, { o: [NaN, 0, 0], d: [0, 0, -1] }), false);
      assert.equal(L.onBus(ws0, aim(ws0, 180, busPitch)), false, 'behind');
      // the plug's zone (5 degrees) reaches down over the bus band under it: the IDE gives the plug the priority there
      assert.ok(deg(L.plugCell(2).pitch) - 5 < busPitch + 1.5, 'a plug zone overlaps the bus band');
      // the window: 1.0 m out, centred at its yaw, 0.05 m below the eye, facing the user
      const ws = L.workspace(headAt(HEAD, rad(40))), m = L.busWindowFrame(ws, rad(20));
      near(Math.hypot(m[12] - ws.origin[0], m[14] - ws.origin[2]), 1.0, 1e-9, 'radius 1.0'); near(m[13], ws.eyeY - 0.05, 1e-9, 'centre height');
      near(Math.atan2(m[12] - ws.origin[0], -(m[14] - ws.origin[2])), ws.yaw + rad(20), 1e-9, 'yaw');
      const toUser = [ws.origin[0] - m[12], 0, ws.origin[2] - m[14]]; near(m[8] * toUser[0] + m[10] * toUser[2], 1.0, 1e-9, 'z points at the user');
      assert.deepEqual(L.BUS_WINDOW, { w: 0.90, h: 0.56, radius: 1.0, drop: 0.05, px: [1024, 640] });
      const at = (x, y) => { const q = [m[12] + m[0] * x + m[4] * y, m[13] + m[1] * x + m[5] * y, m[14] + m[2] * x + m[6] * y]; return { o: ws.origin, d: q.map((v, i) => v - ws.origin[i]) }; };
      const px = L.busWindowPixel(ws, rad(20), at(0, 0)); near(px[0], 512, 1e-6); near(px[1], 320, 1e-6);
      const tl = L.busWindowPixel(ws, rad(20), at(-0.449, 0.279)); near(tl[0], 1024 * (0.5 - 0.449 / 0.9), 1e-6); near(tl[1], 640 * (0.5 - 0.279 / 0.56), 1e-6);
      const br = L.busWindowPixel(ws, rad(20), at(0.2, -0.2)); near(br[0], 1024 * (0.5 + 0.2 / 0.9), 1e-6); near(br[1], 640 * (0.5 + 0.2 / 0.56), 1e-6);
      assert.deepEqual(L.busWindowPixel(ws, rad(20), at(0.2, -0.2), m), br, 'with the frame already made: the same');
      assert.equal(L.busWindowPixel(ws, rad(20), at(0.451, 0)), null); assert.equal(L.busWindowPixel(ws, rad(20), at(0, -0.281)), null);
      assert.equal(L.busWindowPixel(ws, rad(20), { o: ws.origin, d: [m[8], 0, m[10]] }), null, 'looking the other way');
      assert.equal(L.busWindowPixel(ws, rad(20), { o: [NaN, 0, 0], d: [0, 0, -1] }), null);
      assert.equal(L.busWindowPixel(ws, rad(120), at(0, 0)), null, 'another yaw: not there');
   });

   console.log(`${passed} rails ui checks passed.`);
})().catch(err => { console.error(err); process.exit(1); });
