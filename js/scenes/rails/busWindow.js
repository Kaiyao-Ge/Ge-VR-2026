// The bus window, pure: what the panel under the gaze says and what its keys and clicks mean. ideCore.js owns one; it feeds it
// the keys, the wheel, the gaze and the snapshot's bus, and sends the `use` commands that come back. Nothing here reads a clock
// (times are seconds, passed in), draws, or sends: busWindowView.js draws `view()`.
//
// The panel has the inputs of the focused card on top (`target ← gaze_hit (use)`) and the variables of the bus below them
// (alphabetical, the built-in ones last, filtered by what is typed). One input and one variable are selected; the row the gaze
// is on is the hover. Three ways to point an input at a variable, with the same result:
//  - gaze: look at an input row and press (or Enter), then at a variable row and press (or Enter);
//  - keys: Tab switches between the sections, up/down/PageUp/PageDown choose, Enter assigns, Backspace/Delete on an input puts
//    it back on its own name; letters filter the variables;
//  - the command line, which is not this file's.
// Esc clears the filter, then leaves the variables section, then closes. A refusal or a note shows in the footer for FOOTER_S.
// Everything view() returns keeps its identity while it does not change (the rows too, one by one), so that the drawing can skip.
import { BUS_WINDOW, busWindowPixel, busWindowFrame } from './layout.js';
import { DEVICE_VARS, finite, clip } from './values.js';
import { behindText } from './timeline.js';

// The canvas in pixels (1024 x 640 for 0.90 x 0.56 m): the header, the inputs (a label, then `inputRows` rows), the variables (a
// label, then `visibleRows` rows) and the footer.
export const WIN = { ...BUS_WINDOW, header: 64, rowH: 36, inputsLabel: 64, inputsTop: 92, inputRows: 4, varsLabel: 236, varsTop: 264, visibleRows: 9, footerTop: 588 };
export const FOOTER_S = 5;
export const FILTER_MAX = 32;

const BUILTIN = new Set(Object.values(DEVICE_VARS).flatMap(o => Object.values(o)));
const NOT_A_TEXT_KEY = new Set(['undo', 'redo', 'deleteLineStart']);       // the card's own (Mod chords), even with the window open
const NEVER = [];

// A value in a few characters: 1.23, true, "ab", [1, 2, 3], t 0.08.
export function compact(v) {
   const num = x => String(Math.round(x * 100) / 100);
   if (v === undefined || v === null) return '';
   if (typeof v === 'number') return finite(v) ? String(Math.round(v * 1000) / 1000) : String(v);
   if (typeof v === 'boolean') return String(v);
   if (typeof v === 'string') return clip(JSON.stringify(v), 16);
   if (Array.isArray(v)) return clip('[' + v.map(x => (typeof x === 'number' && finite(x) ? num(x) : compact(x))).join(', ') + ']', 24);
   if (typeof v === 'object' && finite(v.t) && finite(v.n)) return `t ${num(v.t)}`;        // the clock's value
   return clip(JSON.stringify(v), 24);
}

const owner = o => String(o).replace(/^(dev|mod):/, '');
const owners = list => [...new Set((Array.isArray(list) ? list : []).map(e => owner(Array.isArray(e) ? e[0] : e)))];
const same = (a, b) => a === b || (a.length === b.length && a.every((x, i) => x === b[i]));
const flat = (a, b) => a === b || (!!a && !!b && Object.keys(a).length === Object.keys(b).length && Object.keys(a).every(k => (Array.isArray(a[k]) && Array.isArray(b[k]) ? same(a[k], b[k]) : a[k] === b[k])));

export function createBusWindow() {
   let open = false, frameYaw = 0, filter = '', section = 'inputs', selPort = null, selVar = null, scroll = 0;
   let lastSv = null, footer = null, px = null, lastT = 0, cardName = null, chosen = -1, frameWs = null, frameOf = 0, frameM = null, total = 0, more = 0;
   let inputs = NEVER, rows = NEVER, selIdx = 0, pendPrev = NEVER, bindPrev = null, inputsOut = NEVER;
   let rowsOut = NEVER, prev = null;
   const rowsKey = [undefined, undefined, undefined, undefined, undefined], cur = new Array(17), saved = new Array(17);       // what the rows and the view were made from (nothing is made per frame while it is the same)
   const CLOSED = { open: false, frameYaw: 0, card: null, header: null, filter: '', section: 'inputs', inputs: NEVER, moreInputs: 0, rows: NEVER, selected: null, hover: null, footer: null, scroll: 0 };

   const sec = () => (inputs.length ? section : 'vars');       // a card with no inputs has only the variables to choose from
   const inputIdx = () => inputs.findIndex(i => i.port === selPort);
   const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
   // The input row and the variable row (an index, or -1) that the gaze is on.
   const rowAt = (top, n, first, count) => { const i = px && px[1] >= top && px[1] < top + n * WIN.rowH ? first + Math.floor((px[1] - top) / WIN.rowH) : -1; return i < count ? i : -1; };
   const hoverInput = () => rowAt(WIN.inputsTop, WIN.inputRows, 0, inputs.length);
   const hoverRow = () => rowAt(WIN.varsTop, WIN.visibleRows, scroll, rows.length);
   // A key that chooses a row (arrows, Tab, typing, the wheel) wins over the gaze resting on a row, until the gaze goes to another row: Enter and
   // Backspace then act on the chosen row, not on the one the eyes happen to be on. A press is always the gaze's.
   const hoverCode = () => { const i = hoverInput(); return i >= 0 ? i : hoverRow() >= 0 ? 100 + hoverRow() : -1; };
   const chose = () => { chosen = hoverCode(); };
   const liveInput = () => (hoverCode() === chosen ? -1 : hoverInput());
   const liveRow = () => (hoverCode() === chosen ? -1 : hoverRow());

   function reset(yaw) {
      open = true; frameYaw = finite(yaw) ? yaw : 0;
      filter = ''; section = 'inputs'; selPort = null; selVar = null; scroll = 0; footer = null; prev = null; rowsKey.fill(undefined); px = null; cardName = null; chosen = -1; lastSv = null;
   }
   const note = (text, kind = 'error', t = lastT) => { if (open) footer = { text: String(text).slice(0, 200), kind, until: t + FOOTER_S }; };
   const showSel = () => { scroll = clamp(scroll, 0, Math.max(0, rows.length - WIN.visibleRows)); if (selIdx < scroll) scroll = selIdx; else if (selIdx >= scroll + WIN.visibleRows) scroll = selIdx - WIN.visibleRows + 1; };

   // Moves the selection of a section by n rows.
   function move(n, s = sec()) {
      if (s === 'inputs') { const i = clamp(inputIdx() + n, 0, inputs.length - 1); if (inputs[i]) selPort = inputs[i].port; return; }
      selIdx = clamp(selIdx + n, 0, rows.length - 1);
      if (rows[selIdx]) selVar = rows[selIdx].id;
      showSel();
   }

   // The input selected when the person has not chosen one: the first with a problem (incompatible, then waiting), else the first that is not
   // `time` (every card has it, and nothing can be assigned to it), else the first.
   function defaultPort() {
      const why = re => inputs.find(i => re.test(i.reason || ''));
      const i = why(/^incompatible/) || why(/^waiting/) || inputs.find(x => x.port !== 'time') || inputs[0];
      return i ? i.port : null;
   }

   // The `use` command for the selected input: the variable, or null for the input's own name.
   function assign(variable) {
      const i = inputs.find(x => x.port === selPort);
      if (!cardName || !i) { note(inputs.length ? 'pick an input first' : 'look at a card with inputs first'); return null; }
      return { op: 'use', module: cardName, port: i.port, variable: variable === i.port ? null : variable };
   }
   // Backspace and Delete: the input under the gaze, else the selected one (when the inputs are the active section), goes back to its own name.
   const resetHere = () => { const hi = liveInput(); return resetInput(hi >= 0 ? inputs[hi] : sec() === 'inputs' ? inputs.find(x => x.port === selPort) : null); };
   function resetInput(i) {
      if (!i) return null;
      if (i.isDefault) { note(`${i.port} already takes its own name`, 'info'); return null; }
      return { op: 'use', module: cardName, port: i.port, variable: null };
   }

   // The variables: sorted, filtered, and each row the same object as before while it says the same; the selection kept on its variable.
   function makeRows() {
      const sv = lastSv;
      if (!sv) return;
      if (rowsKey[0] !== sv.railsRev || rowsKey[1] !== sv.vars || rowsKey[2] !== filter || rowsKey[3] !== sv.rates || rowsKey[4] !== sv.paused) {
         rowsKey[0] = sv.railsRev; rowsKey[1] = sv.vars; rowsKey[2] = filter; rowsKey[3] = sv.rates; rowsKey[4] = sv.paused;
         const fresh = [];
         total = 0;                                                   // the variables that have a row (one still on its way is not counted), filter or not
         for (const id of sv.vars) {
            const r = Object.hasOwn(sv.rails, id) ? sv.rails[id] : null;
            if (!r || !r.kind) continue;
            total++;
            if (filter && !id.includes(filter)) continue;
            fresh.push({ id, kind: r.kind, type: r.type, value: compact(r.value !== undefined ? r.value : r.tail && r.tail.length ? r.tail[r.tail.length - 1].v : undefined),
               rate: sv.paused ? null : (sv.rates && Object.hasOwn(sv.rates, id) ? sv.rates[id] : null), pubs: owners(r.pubs), takers: owners(r.subs),
               stale: !!r.stale, contested: !!r.contested, builtin: BUILTIN.has(id) });
         }
         fresh.sort((a, b) => a.builtin - b.builtin || (a.id < b.id ? -1 : 1));
         const old = new Map(rowsOut.map(r => [r.id, r]));
         const kept = fresh.map(r => { const o = old.get(r.id); return o && flat(o, r) ? o : r; });
         rows = rowsOut = kept.length === rowsOut.length && kept.every((r, i) => r === rowsOut[i]) ? rowsOut : kept;
      }
      selIdx = rows.findIndex(r => r.id === selVar);
      if (selIdx < 0) { selIdx = 0; selVar = rows.length ? rows[0].id : null; }
      showSel();
   }

   const api = {
      get open() { return open; },
      get over() { return open && px !== null; },                   // the gaze is on the panel (any part of it)
      get frameYaw() { return frameYaw; },                          // where the panel hangs, yaw relative to the workspace
      toggle(yaw) { if (open) open = false; else reset(yaw); return open; },
      openAt(yaw) { if (!open) reset(yaw); },
      close() { open = false; },
      note,

      // Which edit keys the window takes while it is open: all but the card's own Mod chords.
      takes: op => !!op && !NOT_A_TEXT_KEY.has(op.op),

      // A key (a text edit of keymap.js); returns the `use` command it makes, or null.
      key(op) {
         if (!open) return null;
         switch (op.op) {
            case 'insert': {
               const typed = String(op.text).toLowerCase().replace(/[^a-z0-9_]/g, '');
               if (!typed) return null;
               filter = (filter + typed).slice(0, FILTER_MAX); section = 'vars'; scroll = 0; chose(); makeRows();
               return null;
            }
            case 'tab': if (inputs.length) section = sec() === 'inputs' ? 'vars' : 'inputs'; chose(); return null;
            case 'backspace':
               if (filter) { filter = filter.slice(0, -1); scroll = 0; makeRows(); return null; }
               return resetHere();
            case 'delete': return resetHere();
            case 'newline': return api.activate(true);
            case 'move':
               chose();
               if (op.dir === 'up') move(-1);
               else if (op.dir === 'down') move(1);
               else if (op.dir === 'pageup') move(-(sec() === 'inputs' ? WIN.inputRows : WIN.visibleRows));
               else if (op.dir === 'pagedown') move(sec() === 'inputs' ? WIN.inputRows : WIN.visibleRows);
               return null;
            default: return null;                                     // left, right, home, end: nothing to move here
         }
      },

      // Esc: clears the filter, then leaves the variables section, then closes. False when the window is not open.
      escape() {
         if (!open) return false;
         if (filter) { filter = ''; scroll = 0; makeRows(); } else if (sec() === 'vars' && inputs.length) section = 'inputs'; else open = false;
         return true;
      },

      // The wheel, in whole lines: it moves the selection of the section the gaze is on (or the active one).
      wheel(lines) { if (open && lines) { move(lines, hoverInput() >= 0 ? 'inputs' : hoverRow() >= 0 ? 'vars' : sec()); chose(); } },

      // The gaze: where the ray meets the panel in canvas pixels (or null).
      hoverAt(ray, ws) {
         if (!open || !ws || !ray) px = null;
         else {
            if (frameWs !== ws || frameOf !== frameYaw) { frameWs = ws; frameOf = frameYaw; frameM = busWindowFrame(ws, frameYaw); }       // (made once while the window stays where it is)
            px = busWindowPixel(ws, frameYaw, ray, frameM);
         }
         if (chosen !== -1 && hoverCode() !== chosen) chosen = -1;                  // a chosen row holds only while the gaze stays on that row
         return px;
      },

      // A press or Enter: on an input row it selects the input, on a variable row it assigns that variable to the selected input.
      // Enter with the gaze elsewhere goes on from the inputs to the variables, and assigns the selected variable there.
      activate(fromKey = false) {
         if (!open) return null;
         const hi = fromKey ? liveInput() : hoverInput(), hr = fromKey ? liveRow() : hoverRow();
         if (hi >= 0) { selPort = inputs[hi].port; section = 'inputs'; return null; }
         if (hr >= 0) { selIdx = hr; selVar = rows[hr].id; return assign(selVar); }
         if (!fromKey) return null;
         if (sec() === 'inputs') { section = 'vars'; return null; }
         return rows[selIdx] ? assign(rows[selIdx].id) : null;
      },
      click() { return api.activate(false); },

      // What to show. `sv` is the core's bus view ({ rails, vars, railsRev, paused, playhead, window, rates }), `card` the focused card's
      // { name, unplugged, bindings, pending: [ports with a `use` on its way] } or null, `t` seconds.
      view(sv, card, t) {
         if (!open) return CLOSED;
         lastT = t;
         if ((card ? card.name : null) !== cardName) { cardName = card ? card.name : null; selPort = null; }
         // The inputs of the card (at most as many as there are rows for).
         const pend = card ? card.pending : NEVER;
         if (!card) { inputs = inputsOut = NEVER; bindPrev = null; more = 0; }
         else if (card.bindings !== bindPrev || !same(pend, pendPrev)) {
            bindPrev = card.bindings; pendPrev = pend.slice();
            const all = card.bindings.filter(b => b.dir === 'in');
            more = Math.max(0, all.length - WIN.inputRows);
            const next = all.slice(0, WIN.inputRows).map(b => ({ port: b.port, variable: b.variable, isDefault: b.isDefault, bound: b.bound, reason: b.reason, pending: pend.includes(b.port) }));
            inputs = inputsOut = inputsOut.length === next.length && inputsOut.every((x, i) => flat(x, next[i])) ? inputsOut : next;
         }
         if (!inputs.some(i => i.port === selPort)) selPort = defaultPort();
         lastSv = sv; makeRows();
         if (footer && t >= footer.until) footer = null;
         // Unchanged? Then the same object as last time.
         const hi = hoverInput(), hr = hoverRow(), at = sv.paused && finite(sv.playhead) && sv.window ? Math.round((sv.playhead - sv.window[1]) * 10) : null;
         cur[0] = frameYaw; cur[1] = total; cur[2] = at; cur[3] = filter; cur[4] = sec(); cur[5] = selPort; cur[6] = selVar; cur[7] = hi; cur[8] = hr;
         cur[9] = footer && footer.text; cur[10] = footer && footer.kind; cur[11] = scroll; cur[12] = cardName; cur[13] = !!(card && card.unplugged); cur[14] = inputsOut; cur[15] = rowsOut; cur[16] = more;
         let changed = !prev;
         for (let i = 0; i < cur.length; i++) if (cur[i] !== saved[i]) { changed = true; saved[i] = cur[i]; }
         if (!changed) return prev;
         const atText = at === null ? null : `at ${behindText(-at)}`;
         return prev = {
            open: true, frameYaw, card: card ? { name: card.name, unplugged: !!card.unplugged } : null,
            header: { title: `BUS · ${total} variable${total === 1 ? '' : 's'}`, at: atText }, filter, section: sec(), inputs: inputsOut, moreInputs: more, rows: rowsOut,
            selected: { section: sec(), port: selPort, variable: selVar },
            hover: hi >= 0 ? { section: 'inputs', port: inputs[hi].port, variable: null } : hr >= 0 ? { section: 'vars', port: null, variable: rows[hr].id } : null,
            footer: footer ? { text: footer.text, kind: footer.kind } : null, scroll,
         };
      },
   };
   return api;
}
