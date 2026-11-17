// What the bus window's canvas shows, drawn with nothing but 2D context calls (so that Node can draw it on a recording context). The
// canvas is 1024 x 640 px for the 0.90 x 0.56 m panel and its rows are exactly those of WIN (busWindow.js), because the gaze's hover and
// press hit-test those pixels: the header (64 px), the inputs label and four input rows (28 + 4 x 36), the variables label and nine
// rows (28 + 9 x 36, the first is `scroll`) and the footer (52). `bus` is the `bus` of ideCore's view (see busWindow.js `view()`).
//   header     BUS · 9 variables   /filter_                         at −3.2 s (while paused)
//   inputs     target ← gaze_hit (use)   waiting / incompatible / sending…       (the focused card; plugged or unplugged)
//   variables  name   kind type   value   rate   publishers → takers   (stale amber, contested !, built-ins last)
//   footer     a refusal or a note for 5 s, else the keys
// The selected row is filled (brighter while its section is the active one), the row under the gaze is outlined, and the active
// section's label has a bar at its left. The background is opaque and every font is at least 22 px: the panel is read over the room.
// BusPaint decides when to paint again; highlightOf says which cards the selected variable touches.
import { PALETTE } from './cardDraw.js';
import { WIN } from './busWindow.js';

const W = WIN.px[0], H = WIN.px[1];
export const PAL = {
   back: PALETTE.body, head: PALETTE.header.running, foot: PALETTE.footer, rule: PALETTE.rule, ink: PALETTE.ink, dim: PALETTE.dim,
   mark: PALETTE.mark, use: PALETTE.use, dimSel: '#c3d0de', error: '#ff6b6b', builtin: '#9fc4e8',
   sel: '#1f4a7a', selDim: '#152c47', hover: '#9fb8d0',
};
export const HELP = 'Tab ↑↓ Enter · Backspace reset · type to filter · Esc';
export const BUS_REPAINT_S = 0.25;        // live: the window is painted again at most 4 times a second ...
export const PAUSED_REPAINT_S = 0.1;      // ... and while paused 10 times (the picture changes only by what the gaze does)
export const URGENT_GAP_S = 0.05;         // what the person did: at once, but 20 times a second at the most
export const HOVER_GAP_S = 0.1;           // the gaze moving over the rows: 10 times a second at the most

const BOLD = 'bold 22px monospace', PLAIN = '22px monospace', TITLE = 'bold 28px monospace', FILTER = '24px monospace';
const COL = { name: 28, type: 244, value: 388, rate: 646, who: 736, end: 1006 };           // the variables table's columns (x, px)
const IN = { port: 28, arrow: 186, variable: 214, tag: 526, state: 670 };                   // the inputs rows' columns
const fit = (s, n) => (s.length <= n ? s : n <= 1 ? '…'.slice(0, n) : s.slice(0, n - 1) + '…');
const list = a => (Array.isArray(a) ? a : []);
const FOOT_CHARS = 74;                                                                       // a footer line: (1024 - 40) / 13.2 characters
// s in at most n lines of up to `cols` characters, cut at a space where there is one; what does not fit ends the last line with `…`.
function split(s, cols, n) {
   const out = [];
   let rest = s.replace(/\s+/g, ' ').trim();
   while (rest && out.length < n) {
      if (out.length === n - 1) { out.push(fit(rest, cols)); break; }
      if (rest.length <= cols) { out.push(rest); break; }
      let cut = rest.lastIndexOf(' ', cols);
      if (cut <= 0) cut = cols;
      out.push(rest.slice(0, cut)); rest = rest.slice(cut).trim();
   }
   return out;
}

function text(ctx, s, x, y, colour, font, maxWidth, align = 'left') {
   ctx.font = font; ctx.fillStyle = colour; ctx.textAlign = align;
   ctx.fillText(s, x, y, maxWidth);
}

export function drawBusWindow(ctx, bus) {
   ctx.fillStyle = PAL.back; ctx.fillRect(0, 0, W, H);
   ctx.textBaseline = 'middle';
   if (!bus || !bus.open) return;
   const section = bus.section === 'inputs' ? 'inputs' : 'vars', sel = bus.selected || {}, hover = bus.hover || null;
   const inputs = list(bus.inputs), rows = list(bus.rows);

   // The header.
   ctx.fillStyle = PAL.head; ctx.fillRect(0, 0, W, WIN.header);
   const title = bus.header && bus.header.title ? String(bus.header.title) : 'BUS';
   text(ctx, title, 20, WIN.header / 2, PAL.ink, TITLE, 300);
   const filter = String(bus.filter || '');
   if (filter) text(ctx, `/${filter}_`, 340, WIN.header / 2, PAL.use, FILTER, 500);
   else text(ctx, 'type to filter', 340, WIN.header / 2, PAL.dim, FILTER, 500);
   if (bus.header && bus.header.at) text(ctx, String(bus.header.at), W - 20, WIN.header / 2, PAL.mark, TITLE, 160, 'right');
   ctx.fillStyle = PAL.rule; ctx.fillRect(0, WIN.header - 1, W, 1);

   // The inputs of the focused card.
   const card = bus.card;
   const label = (top, active) => { ctx.fillStyle = PAL.head; ctx.fillRect(0, top, W, 28); if (active) { ctx.fillStyle = PAL.use; ctx.fillRect(0, top, 6, 28); } };
   label(WIN.inputsLabel, section === 'inputs');
   const labelY = WIN.inputsLabel + 14, labelInk = section === 'inputs' ? PAL.ink : PAL.dim;
   text(ctx, card ? `INPUTS · ${fit(String(card.name), 20)}${inputs.length ? '' : ' · none'}` : 'INPUTS · look at a card', 20, labelY, labelInk, BOLD, 420);
   if (card) {
      if (card.unplugged) text(ctx, 'unplugged', W - 20, labelY, PAL.error, BOLD, 160, 'right');
      else text(ctx, 'plugged', W - 20, labelY, PAL.dim, PLAIN, 120, 'right');
      if (bus.moreInputs > 0) text(ctx, `+${bus.moreInputs} more`, W - 190, labelY, PAL.dim, PLAIN, 120, 'right');
   }
   inputs.slice(0, WIN.inputRows).forEach((inp, i) => {
      const top = WIN.inputsTop + i * WIN.rowH, mid = top + WIN.rowH / 2;
      const on = sel.port === inp.port, dim = on ? PAL.dimSel : PAL.dim;       // dim text is lighter on the selected fill
      rowBack(ctx, top, on, section === 'inputs', !!hover && hover.section === 'inputs' && hover.port === inp.port);
      text(ctx, fit(String(inp.port), 12), IN.port, mid, PAL.ink, BOLD, 150);
      text(ctx, '←', IN.arrow, mid, dim, PLAIN, 24);
      text(ctx, fit(String(inp.variable), 22), IN.variable, mid, inp.isDefault ? dim : PAL.use, PLAIN, 300);
      text(ctx, inp.isDefault ? '(default)' : '(use)', IN.tag, mid, inp.isDefault ? dim : PAL.use, PLAIN, 130);
      if (inp.pending) text(ctx, 'sending…', IN.state, mid, PAL.mark, PLAIN, 330);
      else if (!inp.bound && inp.reason && inp.reason !== 'unplugged') {
         const incompatible = /^incompatible/.test(inp.reason);
         text(ctx, fit(String(inp.reason), 24), IN.state, mid, incompatible ? PAL.error : PAL.mark, PLAIN, 330);
      }
   });

   // The variables.
   label(WIN.varsLabel, section === 'vars');
   const headY = WIN.varsLabel + 14, headInk = section === 'vars' ? PAL.ink : PAL.dim;
   text(ctx, 'VARIABLES', 20, headY, headInk, BOLD, 200);
   text(ctx, 'kind/type', COL.type, headY, PAL.dim, PLAIN, 136); text(ctx, 'value', COL.value, headY, PAL.dim, PLAIN, 100);
   text(ctx, 'rate', COL.rate, headY, PAL.dim, PLAIN, 84); text(ctx, 'from → to', COL.who, headY, PAL.dim, PLAIN, 270);
   const first = Math.max(0, Math.trunc(bus.scroll) || 0);
   if (!rows.length) text(ctx, filter ? 'no variable matches' : 'no variables yet', COL.name, WIN.varsTop + WIN.rowH / 2, PAL.dim, PLAIN, 600);
   for (let i = 0; i < WIN.visibleRows && first + i < rows.length; i++) {
      const r = rows[first + i], top = WIN.varsTop + i * WIN.rowH, mid = top + WIN.rowH / 2;
      const on = sel.variable === r.id, dim = on ? PAL.dimSel : PAL.dim;
      rowBack(ctx, top, on, section === 'vars', !!hover && hover.section === 'vars' && hover.variable === r.id);
      const ink = r.stale ? PAL.mark : PAL.ink;
      if (r.contested) text(ctx, '!', 8, mid, PAL.mark, BOLD, 14);
      text(ctx, fit(String(r.id), 15), COL.name, mid, r.stale ? PAL.mark : r.builtin ? PAL.builtin : PAL.ink, BOLD, 208);
      text(ctx, `${r.kind} ${r.type}`, COL.type, mid, dim, PLAIN, 136);
      const v = String(r.value ?? '');
      text(ctx, fit(v, 19), COL.value, mid, ink, PLAIN, 250);
      if (r.rate != null && Number.isFinite(r.rate)) text(ctx, `${r.rate.toFixed(1)}/s`, COL.rate, mid, dim, PLAIN, 84);
      const pubs = list(r.pubs), takers = list(r.takers);
      if (pubs.length || takers.length) text(ctx, fit(`${pubs.join(', ') || '-'} → ${takers.join(', ') || '-'}`, 20), COL.who, mid, dim, PLAIN, COL.end - COL.who);
   }
   if (rows.length > WIN.visibleRows) {                                    // a scroll bar at the right edge
      const track = WIN.visibleRows * WIN.rowH, thumb = Math.max(16, track * WIN.visibleRows / rows.length);
      const y = WIN.varsTop + (track - thumb) * Math.min(1, first / (rows.length - WIN.visibleRows));
      ctx.fillStyle = PAL.dim; ctx.fillRect(W - 8, y, 6, thumb);
   }

   // The footer: a refusal (red) or a note, else the keys.
   ctx.fillStyle = PAL.foot; ctx.fillRect(0, WIN.footerTop, W, H - WIN.footerTop);
   ctx.fillStyle = PAL.rule; ctx.fillRect(0, WIN.footerTop, W, 1);
   const fy = WIN.footerTop + (H - WIN.footerTop) / 2, f = bus.footer;
   if (f && f.text) {
      const ink = f.kind === 'error' ? PAL.error : PAL.ink, lines = split(String(f.text), FOOT_CHARS, 2);
      lines.forEach((l, i) => text(ctx, l, 20, lines.length === 1 ? fy : WIN.footerTop + 14 + i * 24, ink, PLAIN, W - 40));
   } else text(ctx, HELP, 20, fy, PAL.dim, PLAIN, W - 40);
}

// The back of a row: the selected one is filled (brighter while its section is the active one), the one under the gaze is outlined.
function rowBack(ctx, top, selected, active, hovered) {
   if (selected) {
      ctx.fillStyle = active ? PAL.sel : PAL.selDim; ctx.fillRect(0, top, W, WIN.rowH);
      if (active) { ctx.fillStyle = PAL.use; ctx.fillRect(0, top, 5, WIN.rowH); }
   }
   if (hovered) { ctx.strokeStyle = PAL.hover; ctx.lineWidth = 2; ctx.strokeRect(2, top + 1, W - 4, WIN.rowH - 2); }
}

// The cards that publish or take what is selected: the selected variable of the table, or (with the inputs active) the variable the
// selected input is on. A Set of card names, the same one while `bus` is the same object and while the selected row is the same row
// (a new bus object for a hover, a footer or a rate elsewhere changes nothing here), and one shared empty set for none.
const NONE = new Set();
let lastBus = null, lastRow = null, lastSet = NONE;
export function highlightOf(bus) {
   if (!bus || !bus.open) return NONE;
   if (bus === lastBus) return lastSet;
   lastBus = bus;
   const sel = bus.selected;
   let name = sel ? sel.variable : null;
   if (sel && bus.section === 'inputs') { const inp = list(bus.inputs).find(i => i.port === sel.port); name = inp ? inp.variable : null; }
   const row = name == null ? null : list(bus.rows).find(r => r.id === name) || null;
   if (row === lastRow && (row || lastSet === NONE)) return lastSet;
   lastRow = row; lastSet = NONE;
   if (row) { const names = new Set([...list(row.pubs), ...list(row.takers)]); if (names.size) lastSet = names; }
   return lastSet;
}

// When to paint again. A bus object that is the one painted is nothing. A change of the person's making or of the card (open, section,
// selection, filter, footer, scroll, the card and its inputs, pause or live) is painted as soon as URGENT_GAP_S has passed since the last
// paint (a key held down or the wheel moves the selection every frame: at most 20 uploads a second); a change of only the row under the
// gaze after HOVER_GAP_S; whatever else makes a new object (values, rates, the count) at most every BUS_REPAINT_S live, PAUSED_REPAINT_S
// paused. A change that waited is still there at the next frame (the object is not remembered until it is painted), so it is painted then.
export class BusPaint {
   constructor() { this.last = null; this.at = -Infinity; this.painted = 0; }
   changed(bus, t) {
      if (!bus || !bus.open) { this.last = null; return false; }
      if (bus === this.last) return false;
      const a = this.last;
      if (a) {
         const wait = urgent(a, bus) ? URGENT_GAP_S : hoverOnly(a, bus) ? HOVER_GAP_S : bus.header && bus.header.at ? PAUSED_REPAINT_S : BUS_REPAINT_S;
         if (t - this.at < wait) return false;
      }
      this.last = bus; this.at = t; this.painted++;
      return true;
   }
   reset() { this.last = null; }
}

function urgent(a, b) {
   const as = a.selected || {}, bs = b.selected || {}, af = a.footer || {}, bf = b.footer || {}, ac = a.card || {}, bc = b.card || {};
   return a.filter !== b.filter || a.section !== b.section || a.scroll !== b.scroll || as.section !== bs.section || as.port !== bs.port || as.variable !== bs.variable
      || af.text !== bf.text || af.kind !== bf.kind || ac.name !== bc.name || ac.unplugged !== bc.unplugged || a.inputs !== b.inputs || a.moreInputs !== b.moreInputs
      || !!(a.header && a.header.at) !== !!(b.header && b.header.at);
}

// Nothing but the row under the gaze differs (the rows, the count and the time are the same).
function hoverOnly(a, b) {
   const ah = a.header || {}, bh = b.header || {};
   return a.rows === b.rows && ah.title === bh.title && ah.at === bh.at;
}
