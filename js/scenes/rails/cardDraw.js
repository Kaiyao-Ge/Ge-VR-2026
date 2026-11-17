// What a Rails card's canvas shows, drawn with nothing but a 2D context's calls (`fillRect`, `fillText`, `arc`, ...), so
// that Node can draw it on a recording context and check it. The canvas is 640 px (CARD.px) for 0.50 m, in the grid of
// layout.js: a 64 px header (a status dot, the name, then a line with the status, `unplugged` when the card is off the bus, and
// the key echo or the command line; the `ln r/n` at its right is a quad), the code area of 480 px, and a 96 px footer with the
// message line(s) and the bindings (`target <- gaze_hit`, `-> hit`).
//
// The code is bold and has three sizes (ZOOMS: 26, 32 or 40 columns, the rows fill the 480 px). Text goes on the grid one
// character at a time, so it lines up with `cellAt(zoom, col, row)` whatever the browser's monospace is. The first visible column
// is `scrollX`; a small triangle in the left or right gutter marks a line with text hidden on that side. A tab shows as two
// spaces (the buffer keeps pasted tabs); nothing wraps. Anything that is not code (the name, the messages, the echo, the
// command, the bindings) is cut to its width, with `…`, and also given as `maxWidth` to fillText: input of any length (a
// mistyped command is echoed whole) cannot run out of its place.
// The cursor, the focus frame, the charge ring and the error bar are quads, not here (cardView.js).
import { CARD, GRID, ZOOMS, ZOOM_DEFAULT } from './layout.js';
import { clamp } from '../../render/core/cg.js';
import { clip, clipTail } from './values.js';

const ROWS = CARD.rows;
const W = CARD.px;
const CODE_H = ROWS * GRID.line;                             // the code area's height: 480 at every zoom
const FOOTER_Y = GRID.header + CODE_H;                       // where the footer begins: 544
const MARGIN = 16;                                           // px at the left and right of the text outside the grid
const MSG_PX = 20, MSG_ADV = MSG_PX * 0.6;                   // the message line's font and its advance (0.6 em)
const BIND_PX = 18, BIND_ADV = BIND_PX * 0.6;                // a binding's font (bold) and its advance
const MARK = { w: 9, h: 9, pad: 4 };                         // the triangle of hidden text: half its height, its width, its distance from the text
// The `ln r/n` of the header is line-font text on a quad (cardView.js), so that moving the cursor between lines repaints nothing.
export const LN = { size: 0.014 * 1.3, chars: 12 };
const LN_PX = LN.size * 0.76 * GRID.ppm;                     // its advance in canvas pixels

export const PALETTE = {
   body: '#0b1320', footer: '#0f1a2b', rule: '#26384f', ink: '#d7e3f4', dim: '#7f93a8', mark: '#ffb000',
   use: '#59d0ff', running: '#3ddc84', edited: '#ffb000', error: '#d64545', quarantined: '#9a8f94',
   header: { running: '#16263d', edited: '#16263d', error: '#5a1f27', quarantined: '#3b2a2f' },
   tint: { error: 'rgba(214,69,69,0.20)', quarantined: 'rgba(214,69,69,0.12)' },
};

// s cut into at most n lines of cols characters; when it does not fit, the last line ends with `…`.
const split = (s, cols, n) => {
   const out = [];
   for (let i = 0; i < n && i * cols < s.length; i++) out.push(s.slice(i * cols, (i + 1) * cols));
   if (s.length > n * cols) out[n - 1] = out[n - 1].slice(0, cols - 1) + '…';
   return out;
};
const oneLine = s => String(s == null ? '' : s).slice(0, 400).replace(/\s+/g, ' ').trim();   // a message can carry newlines and a stack

// A line as the card shows it: tabs as two spaces, other control characters as a dot.
export const expand = line => String(line).replace(/\t/g, '  ').replace(/[\u0000-\u001f\u007f]/g, '·');

// The column of text position col of line on the card's grid (a tab before it takes two columns).
export function visualCol(line, col) {
   let v = 0;
   for (let i = 0; i < col && i < line.length; i++) v += line[i] === '\t' ? 2 : 1;
   return v + Math.max(0, col - line.length);
}

// The card's zoom (an index into ZOOMS; a missing or odd one is the default, a number outside is clamped).
export const zoomOf = s => ZOOMS[Number.isFinite(s?.zoom) ? clamp(Math.trunc(s.zoom), 0, ZOOMS.length - 1) : ZOOM_DEFAULT];

// Lines, scroll, scrollX, row, col and rows of a buffer (a TextBuffer or any object with these; `text` stands for `lines` when that is
// missing). `rows` is the card's zoom's when the caller gives it, else the buffer's own, else ROWS.
export function view(buffer, zoomRows) {
   const lines = Array.isArray(buffer?.lines) ? buffer.lines : String(buffer?.text ?? '').split('\n');
   const own = Number.isInteger(buffer?.rows) && buffer.rows > 0 ? buffer.rows : ROWS;
   const rows = Number.isInteger(zoomRows) && zoomRows > 0 ? zoomRows : own;
   const scroll = clamp(Math.trunc(buffer?.scroll) || 0, 0, Math.max(0, lines.length - rows));
   return { lines, scroll, scrollX: Math.max(0, Math.trunc(buffer?.scrollX) || 0), row: Math.trunc(buffer?.row) || 0, col: Math.trunc(buffer?.col) || 0, rows };
}

export const rowOf = v => clamp(v.row, 0, v.lines.length - 1);

// running | edited | error | quarantined, from the status the runtime reports, the errors, and whether the text
// differs from what runs. `status` may already be one of the four, or the runtime's `ok`.
export function statusOf(s) {
   if (s.status === 'quarantined') return 'quarantined';
   if (s.status === 'error' || s.error || s.editError) return 'error';
   if (s.status === 'edited' || s.buffer?.dirty) return 'edited';
   return 'running';
}

// The error to show and its words: the compile error of the last Mod+Enter wins over the one still running (that is what
// the person has just done), and `line` is 1-based, or null.
export function errorOf(s) {
   const e = s.editError || s.error;
   if (!e) return null;
   const where = Number.isInteger(e.line) ? `line ${e.line}: ` : e.phase ? `${e.phase}: ` : '';
   return { line: Number.isInteger(e.line) ? e.line : null, text: where + oneLine(e.message), edit: !!s.editError };
}

// The words in the header's second line.
const WORDS = { running: 'running', edited: 'edited', error: 'error', quarantined: 'quarantined' };
function statusWords(s, kind) {
   const v = Number.isInteger(s.ver) ? s.ver : null;
   let w = WORDS[kind];
   if (kind === 'running' && v != null) w += ' v' + v;
   if (kind === 'edited' && v != null) w += ', v' + v + ' runs';
   if (kind === 'error' && s.editError && v != null) w += ', kept v' + v;
   if (s.focused) w += ' · typing';
   return w;
}

// The first visible column: the state's, else the buffer's.
export const scrollXOf = (s, v) => Math.max(0, Math.trunc(Number.isFinite(s?.scrollX) ? s.scrollX : v.scrollX) || 0);

const text = (ctx, s, x, y, font, colour, align, maxWidth) => {
   ctx.font = font; ctx.fillStyle = colour; ctx.textAlign = align;
   ctx.fillText(s, x, y, maxWidth);
};

function drawHeader(ctx, s, kind, P) {
   ctx.fillStyle = P.header[kind]; ctx.fillRect(0, 0, W, GRID.header);
   ctx.fillStyle = P[kind]; ctx.beginPath(); ctx.arc(32, 32, 11, 0, 2 * Math.PI); ctx.fill();
   const right = W - MARGIN;
   const nameCols = Math.floor((right - 58 - LN.chars * LN_PX - 8) / (26 * 0.6));
   text(ctx, clip(oneLine(s.name), nameCols), 58, 30, 'bold 26px monospace', P.ink, 'left', nameCols * 26 * 0.6);
   const small = 17, adv = small * 0.6;
   if (typeof s.command === 'string') {                                     // the command line takes the second line
      const cols = Math.floor((right - MARGIN) / adv);
      text(ctx, clipTail('> ' + oneLine(s.command) + '_', cols), MARGIN, 54, `${small}px monospace`, P.ink, 'left', cols * adv);
      return;
   }
   const words = statusWords(s, kind), wordCols = 24;
   if (s.unplugged) {                                                       // off the bus: said first, in amber, the status beside it
      const lead = 'unplugged', rest = wordCols - lead.length - 1;
      text(ctx, lead, 58, 54, `bold ${small}px monospace`, P.mark, 'left', lead.length * adv);
      text(ctx, clip(words, rest), 58 + (lead.length + 1) * adv, 54, `${small}px monospace`, P[kind], 'left', rest * adv);
   } else text(ctx, clip(words, wordCols), 58, 54, `${small}px monospace`, P[kind], 'left', wordCols * adv);
   const keys = !s.focused || s.echo == null ? '' : oneLine(Array.isArray(s.echo) ? s.echo.slice(-8).join(' ') : s.echo);
   if (keys) {
      const cols = Math.floor((right - 58 - wordCols * adv - 8) / adv);
      text(ctx, clipTail(keys, cols), right, 54, `${small}px monospace`, P.dim, 'right', cols * adv);
   }
}

// A triangle in a gutter: pointing left or right, its middle at (x, cy).
function mark(ctx, x, cy, dir, P) {
   ctx.fillStyle = P.mark; ctx.beginPath();
   if (dir < 0) { ctx.moveTo(x + MARK.w, cy - MARK.h); ctx.lineTo(x, cy); ctx.lineTo(x + MARK.w, cy + MARK.h); }
   else { ctx.moveTo(x, cy - MARK.h); ctx.lineTo(x + MARK.w, cy); ctx.lineTo(x, cy + MARK.h); }
   ctx.closePath(); ctx.fill();
}

function drawCode(ctx, s, kind, P, v, err, z, sx) {
   const area = z.rows * z.line;
   ctx.fillStyle = P.body; ctx.fillRect(0, GRID.header, W, CODE_H);
   if (P.tint[kind]) { ctx.fillStyle = P.tint[kind]; ctx.fillRect(0, GRID.header, W, CODE_H); }
   const font = `bold ${z.font}px monospace`, right = GRID.padX + z.cols * z.adv;   // the right gutter starts where the last column ends
   ctx.font = font; ctx.textAlign = 'left'; ctx.fillStyle = P.ink;
   for (let r = 0; r < z.rows; r++) {
      const line = v.lines[v.scroll + r];
      if (line === undefined) break;
      const shown = expand(line), top = GRID.header + r * z.line, y = top + z.font;
      for (let c = sx; c < Math.min(shown.length, sx + z.cols); c++)
         if (shown[c] !== ' ') ctx.fillText(shown[c], GRID.padX + (c - sx) * z.adv, y);
      if (sx > 0 && shown.slice(0, sx).trim()) mark(ctx, GRID.padX - MARK.pad - MARK.w, top + z.line / 2, -1, P);
      if (shown.slice(sx + z.cols).trim()) mark(ctx, right + MARK.pad, top + z.line / 2, 1, P);
      if (err && err.line === v.scroll + r + 1) {                           // the arrow in the gutter; the bar itself is a quad
         ctx.fillStyle = P.error; ctx.beginPath();
         const cy = top + z.line / 2;
         ctx.moveTo(4, cy - 9); ctx.lineTo(4, cy + 9); ctx.lineTo(GRID.padX - 22, cy); ctx.closePath(); ctx.fill();
      }
      ctx.fillStyle = P.ink;
   }
   if (v.lines.length > z.rows) {                                            // a thin bar at the right edge, as long as the window
      const h = Math.max(12, area * z.rows / v.lines.length);
      ctx.fillStyle = P.rule;
      ctx.fillRect(W - 4, GRID.header + (area - h) * v.scroll / (v.lines.length - z.rows), 4, h);
   }
}

// A binding as the footer says it: its words and what it is (`dim` the default wiring, `use` a variable chosen with `use`,
// `warn` waiting for a variable, `bad` something that cannot work).
export function bindingLabel(b) {
   const port = String(b.port), variable = String(b.variable ?? b.port), reason = typeof b.reason === 'string' ? b.reason : null;
   if (b.dir === 'out') return reason === 'not published' ? { text: `→ ${variable} ✗`, tone: 'bad' } : { text: `→ ${variable}`, tone: 'dim' };
   if (reason && reason.startsWith('incompatible')) return { text: `${port} ✗ incompatible`, tone: 'bad' };
   if (reason && reason.startsWith('waiting')) return { text: b.isDefault ? `${port} ← (waiting)` : `${port} ← ${variable} (waiting)`, tone: 'warn' };
   return { text: `${port} ← ${variable}`, tone: reason === 'unplugged' || b.isDefault ? 'dim' : b.bound ? 'use' : 'warn' };
}

const bindingsOf = s => (Array.isArray(s.bindings) ? s.bindings : []).filter(b => b && typeof b === 'object' && b.port != null);

// The bindings in two columns: inputs on the left, outputs on the right, problems first (so a `+N` never hides one), then the
// ones chosen with `use`, then the defaults. `at` is the baseline of each row; what does not fit is `+N` on the last row.
const SEVERITY = { bad: 0, warn: 1, use: 2, dim: 3 };
function drawBindings(ctx, s, P, at) {
   const list = bindingsOf(s), half = W / 2, cols = Math.floor((half - MARGIN - 8) / BIND_ADV), rows = at.length;
   const tone = { dim: P.dim, use: P.use, warn: P.mark, bad: P.error };
   for (const side of ['in', 'out']) {
      const mine = list.filter(b => (b.dir === 'out' ? 'out' : 'in') === side).map(b => bindingLabel(b))
         .map((l, i) => [SEVERITY[l.tone], i, l]).sort((a, b) => a[0] - b[0] || a[1] - b[1]).map(x => x[2]), more = mine.length - rows;
      mine.slice(0, rows).forEach((l, i) => {
         const extra = i === rows - 1 && more > 0 ? ` +${more}` : '';
         text(ctx, clip(l.text, cols - extra.length) + extra, side === 'in' ? MARGIN : half + 8, at[i], `bold ${BIND_PX}px monospace`, tone[l.tone], 'left', cols * BIND_ADV);
      });
   }
}

// The message of the footer: the error, then a notice, then what waits for the resume, then `running…`; or null.
function messageOf(s, err, P) {
   if (err) return { text: err.text, colour: P.error };
   if (s.notice) return { text: oneLine(s.notice), colour: P.mark };
   const q = (Array.isArray(s.queued) ? s.queued : []).filter(x => x && typeof x.what === 'string');
   if (q.length) return { text: `${oneLine(q[0].what)}: ${oneLine(q[0].note ?? 'applies when you resume')}${q.length > 1 ? ` +${q.length - 1}` : ''}`, colour: P.mark };
   if (s.pending) return { text: typeof s.pending === 'string' ? oneLine(s.pending) : 'running…', colour: P.dim };
   return null;
}

function drawFooter(ctx, s, P, err) {
   ctx.fillStyle = P.footer; ctx.fillRect(0, FOOTER_Y, W, W - FOOTER_Y);
   ctx.fillStyle = P.rule; ctx.fillRect(0, FOOTER_Y, W, 1);
   // Without a message the bindings have both rows. A one-line message goes at the top and the two rows move down a little; a message of
   // two lines takes the upper half and leaves one row.
   const m = messageOf(s, err, P);
   if (!m) return drawBindings(ctx, s, P, [FOOTER_Y + 30, FOOTER_Y + 78]);
   const cols = Math.floor((W - 2 * MARGIN) / MSG_ADV), parts = split(m.text, cols, 2);
   if (parts.length <= 1) {
      text(ctx, parts[0] ?? "", MARGIN, FOOTER_Y + 20, `${MSG_PX}px monospace`, m.colour, 'left', cols * MSG_ADV);
      return drawBindings(ctx, s, P, [FOOTER_Y + 50, FOOTER_Y + 82]);
   }
   parts.forEach((part, i) => text(ctx, part, MARGIN, FOOTER_Y + 22 + i * 24, `${MSG_PX}px monospace`, m.colour, 'left', cols * MSG_ADV));
   drawBindings(ctx, s, P, [FOOTER_Y + 78]);
}

// Draw the whole card on ctx. state: { name, ver, buffer, status, error, editError, bindings, unplugged, queued, zoom, scrollX,
// focused, pending, echo, notice, command } (all optional; `charging` and the cursor are quads and not drawn here). opts.palette
// overrides colours, opts.view is view(state.buffer, zoom's rows) when the caller has it already.
export function drawCard(ctx, state, opts = {}) {
   const s = state || {}, P = { ...PALETTE, ...(opts.palette || {}) }, kind = statusOf(s), z = zoomOf(s);
   const v = opts.view || view(s.buffer, z.rows), err = errorOf(s);
   ctx.textBaseline = 'alphabetic';
   drawCode(ctx, s, kind, P, v, err, z, scrollXOf(s, v));
   drawHeader(ctx, s, kind, P);
   drawFooter(ctx, s, P, err);
}

// What a redraw depends on, as a string: equal strings mean the same picture. Row and col are not in it (the cursor and
// the `ln` are on quads), but the zoom and the first visible column are. Only the visible lines are read.
export function drawKey(state, v) {
   const s = state || {}, z = zoomOf(s), e = errorOf(s);
   v = v || view(s.buffer, z.rows);
   const bind = bindingsOf(s).map(b => [b.port, b.dir, b.variable, !!b.isDefault, !!b.bound, b.reason ?? null]);
   const queued = (Array.isArray(s.queued) ? s.queued : []).filter(x => x && typeof x.what === 'string').map(x => [x.what, x.note ?? null]);
   return JSON.stringify([s.name, s.ver, statusOf(s), v.lines.length, v.scroll, scrollXOf(s, v), s.zoom ?? null,
      v.lines.slice(v.scroll, v.scroll + z.rows), e && e.text, e && e.line, bind, !!s.unplugged, queued, !!s.focused, s.pending || null,
      s.focused ? s.echo ?? null : null, s.notice ?? null, s.command ?? null]);
}
