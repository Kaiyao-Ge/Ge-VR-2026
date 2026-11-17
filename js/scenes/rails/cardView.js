// The nodes of one Rails card and the decision of when to repaint, apart from the plumbing that makes the canvas
// (cards.js), so that Node can run it on fakes. The card's own frame is in metres: origin at its centre, x right, y up,
// facing +z; the caller puts `node` where the card hangs.
//
// The canvas (cardDraw.js) is painted again only when its key changes; everything that moves or blinks is a quad on top
// of it: the `ln r/n` (line-font text on a plate), the error bar behind the failing line, the cursor, the focus frame (6 mm bright when focused,
// 2 mm faint when only looked at, 4 mm red on an error card, and, outside any of these, 5 mm light blue when the card publishes or takes the variable selected in the bus window), the charge ring that fills along the card's border during the gaze's dwell, and the
// card's brightness (85 % when idle, 92 % looked at, 15 % less when unplugged and not focused) which is the colour of the face, not a repaint. The cursor and
// the bar follow the card's zoom and its first visible column; the canvas itself is painted again when either changes (cardDraw.drawKey).
import { clamp } from '../../render/core/cg.js';
import { CARD, GRID, cellAt } from './layout.js';
import { drawCard, drawKey, view, statusOf, errorOf, visualCol, rowOf, zoomOf, scrollXOf, LN, PALETTE } from './cardDraw.js';
import { unlit, colourOf, quadAt, drawText, releaseText } from './glyphs.js';

const HALF = CARD.w / 2, CURSOR_W = 0.0025;
const FOCUS_T = 0.006, HOVER_T = 0.002, ERROR_T = 0.004, RING_T = 0.008, BAR_PAD = 0.004;
const DIM = PALETTE.dim, LN_Y = (CARD.px / 2 - 26) / GRID.ppm, LN_X = HALF - 16 / GRID.ppm;   // the `ln r/n`: right aligned, on the header's first line
export const BRIGHT = { focused: 1, hovered: 0.92, idle: 0.85, unplugged: 0.85 };   // unplugged is a factor, for a card that is not focused
const ACCENT = { running: '#59d0ff', edited: PALETTE.edited, error: PALETTE.error, quarantined: PALETTE.quarantined };
const RED = PALETTE.error;
const RING = '#ffd23f', CURSOR = '#ffffff', BAR = PALETTE.error;
export const MARK = '#9ff0ff';                                          // the frame of a card that publishes or takes the variable selected in the bus window
const MARK_T = 0.005;

const bright = k => unlit([k, k, k]);

export function createCardView(node, { ctx, face, onDraw, now = () => performance.now() / 1000 }) {
   const quad = (colour, opacity) => node.add('square').color(colourOf(colour)).opacity(opacity);
   const bar = quad(BAR, 0.3), cursor = quad(CURSOR, 1);
   const frame = [0, 1, 2, 3].map(() => quad(ACCENT.running, 1)), ring = [0, 1, 2, 3].map(() => quad(RING, 1));
   const ln = node.add();                                                // holds the line-font text of `ln r/n`
   const markFrame = [0, 1, 2, 3].map(() => quad(MARK, 1));              // outside the frame the card has, for the bus window's selection
   const nodes = [face, bar, cursor, ...frame, ...ring, ln, ...markFrame];
   [bar, cursor, ...frame, ...ring, ...markFrame].forEach(q => { q.ignore = true; });

   let drawKeyLast = null, layoutLast = null, draws = 0, cursorOn = false;

   const repaint = (state, v) => {
      ctx.clearRect(0, 0, CARD.px, CARD.px);
      drawCard(ctx, state, { view: v });
      draws++;
      onDraw?.();
   };
   repaint(null);                                                        // a blank card is in the canvas before the first frame
   draws = 0;

   // The four bars of a rectangle border of thickness t outside the card.
   // `inset` is how far from the card's edge it starts (a frame outside another one).
   const border = (bars, t, colour, z, inset = 0) => {
      const R = HALF + inset + t / 2, L = HALF + inset + t;
      const spec = [[0, R, L, t / 2], [R, 0, t / 2, L], [0, -R, L, t / 2], [-R, 0, t / 2, L]];
      bars.forEach((q, i) => { quadAt(q, ...spec[i], z); q.color(colourOf(colour)); q.ignore = false; });
   };

   // The ring's progress p (0..1) around the border, clockwise from the top left corner.
   const drawRing = p => {
      const side = CARD.w + 2 * RING_T, R = HALF + RING_T / 2;
      for (let i = 0; i < 4; i++) {
         const len = clamp(p * 4 * side - i * side, 0, side);
         if (len < 1e-4) { ring[i].ignore = true; continue; }
         ring[i].ignore = false;
         const a = -HALF - RING_T + len / 2, b = HALF + RING_T - len / 2;    // the piece's centre along its side
         const [x, y, hw, hh] = [[a, R, len / 2, RING_T / 2], [R, b, RING_T / 2, len / 2], [-a, -R, len / 2, RING_T / 2], [-R, -b, RING_T / 2, len / 2]][i];
         quadAt(ring[i], x, y, hw, hh, 0.002);
      }
   };

   const arrange = (s, kind, v, err, z, sx, marked) => {
      const key = [marked, s.focused, s.hovered, kind, v.lines.length, v.scroll, v.row, v.col, err && err.line, s.charging && s.charging.p, v.lines[v.row], z.cols, z.rows, sx, !!s.unplugged].join('|');
      if (key === layoutLast) return;
      layoutLast = key;
      face.color(bright((s.focused ? BRIGHT.focused : s.hovered ? BRIGHT.hovered : BRIGHT.idle) * (s.unplugged && !s.focused ? BRIGHT.unplugged : 1)));
      const failed = kind === 'error' || kind === 'quarantined';              // an error card keeps a red frame (spec 2.5)
      let inner = 0;                                                         // the thickness of the card's own frame, which the mark goes outside of
      if (s.focused) border(frame, inner = FOCUS_T, failed ? RED : ACCENT[kind], 0.001);
      else if (s.hovered) border(frame, inner = HOVER_T, failed ? RED : ACCENT[kind], 0.001);
      else if (failed) border(frame, inner = ERROR_T, RED, 0.001);
      else frame.forEach(q => { q.ignore = true; });
      if (marked) border(markFrame, MARK_T, MARK, 0.001, inner);
      else markFrame.forEach(q => { q.ignore = true; });
      const where = `ln ${rowOf(v) + 1}/${v.lines.length}`.slice(0, LN.chars);
      drawText(ln, where, { x: LN_X, y: LN_Y, z: 0.002, size: LN.size, color: DIM, align: 'right' });
      const line = z.line / GRID.ppm / 2;                                    // half a line of this zoom, in metres
      const errRow = err && err.line != null ? err.line - 1 - v.scroll : -1;
      bar.ignore = !(errRow >= 0 && errRow < z.rows);
      if (!bar.ignore) quadAt(bar, 0, cellAt(z, 0, errRow).y, HALF - BAR_PAD, line, 0.002);
      // The cursor shows when its row and its column are in the window (the column may be one past the last: the end of a full line).
      const col = visualCol(v.lines[v.row] ?? '', v.col) - sx;
      cursorOn = !!s.focused && v.row >= v.scroll && v.row < v.scroll + z.rows && col >= 0 && col <= z.cols;
      if (cursorOn) {
         const c = cellAt(z, col, v.row - v.scroll);
         quadAt(cursor, c.x - z.adv / 2 / GRID.ppm + CURSOR_W / 2, c.y, CURSOR_W / 2, line, 0.003);
      }
      if (s.charging && !s.focused) drawRing(clamp(Number(s.charging.p) || 0));
      else ring.forEach(q => { q.ignore = true; });
   };

   return {
      // state: see drawCard, and `hovered`, `charging` ({ p }), and `time` (seconds, for the blink; the clock if missing). `marked`: the card
      // publishes or takes the variable selected in the bus window (a frame of its own, outside the card's other frame).
      update(state, marked = false) {
         const s = state || {}, z = zoomOf(s), v = view(s.buffer, z.rows), key = drawKey(s, v);
         if (key !== drawKeyLast) { drawKeyLast = key; repaint(s, v); }
         const kind = statusOf(s);
         arrange(s, kind, v, errorOf(s), z, scrollXOf(s, v), !!marked);
         cursor.ignore = !cursorOn || Math.floor((Number.isFinite(s.time) ? s.time : now()) * 2) % 2 === 1;   // 2 blinks a second
      },
      // How many times the canvas was painted since the card was made (the blank first paint is not counted).
      get draws() { return draws; },
      dispose() { releaseText(ln); nodes.forEach(n => node.remove(n)); },
   };
}
