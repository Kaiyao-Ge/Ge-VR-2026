// The text of one Rails card, pure and without graphics: lines, a cursor, a scroll window (`rows` lines and `cols` columns,
// twelve by 32 until the card's zoom says otherwise; `scroll` is its first line, `scrollX` its first column), a dirty flag (text differs from what is running) and undo/redo. Every change
// goes through apply(op, now) so the laptop's keys, the wheel and the paste event all use one
// path, and `now` is passed in (ms) so tests need no clock. There is no selection in v1.
//
// Undo takes a snapshot of the state before an edit when the edit starts a new group: the first
// edit, one 800 ms after the previous edit, a newline, a paste, or a switch between inserting and
// deleting. Moving the cursor never snapshots and never ends a group. A new edit clears redo.
import { clamp } from '../../render/core/cg.js';
import { MAX_PASTE } from './values.js';
import { visualCol } from './cardDraw.js';

export { MAX_PASTE };
export const VISIBLE = 12;           // lines a card shows at the default zoom
export const COLUMNS = 32;           // and columns
export const MARGIN = 2;             // columns of room that the cursor keeps at the left and right edge of the window
export const IDLE = 800;             // ms without an edit that starts a new undo group
export const MAX_CHARS = 65536;      // the source limit, in chars (the caller checks bytes)
export const MAX_UNDO = 100;         // snapshots kept per card
const INDENT = '  ';

const clean = s => String(s).replace(/\r\n?/g, '\n');
const EDITS = new Set(['insert', 'newline', 'tab', 'backspace', 'delete', 'deleteLineStart', 'undo', 'redo', 'set']);   // the ops that can change the text

export class TextBuffer {
   constructor(text = '') {
      this._text = this._dirty = null;
      this.rows = VISIBLE; this.cols = COLUMNS; this.scrollX = 0;
      this.apply({ op: 'set', text }, 0);
   }

   // The joined text and `dirty` are worked out when asked and kept until the next op (the card, the notice and the IDE's frame ask every frame).
   get text() { return this._text ??= this._lines.join('\n'); }
   get lines() { return this._lines.slice(); }
   // Dirty means the text is not the text that was last set or marked clean (that is, running).
   get dirty() { return this._dirty ??= this.text !== this._base; }

   // Returns true when the text, the cursor or the scroll changed.
   apply(op, now = 0) {
      const handler = op && HANDLERS[op.op];
      if (!handler) return false;
      const edit = EDITS.has(op.op), text = edit && this._lines ? this.text : null, { row, col, scroll, scrollX, rows, cols } = this;
      handler(this, op, now);
      if (op.op !== 'scroll' && op.op !== 'scrollX' && op.op !== 'base') this._reveal();       // (a commit's ack must not move the view)
      this._dirty = null;
      if (edit) this._text = null;
      return (edit && this.text !== text) || this.row !== row || this.col !== col || this.scroll !== scroll || this.scrollX !== scrollX
         || this.rows !== rows || this.cols !== cols;
   }

   _state() { return { text: this.text, row: this.row, col: this.col }; }
   _restore(s) {
      this._lines = s.text.split('\n'); this._text = null;
      this.row = clamp(s.row, 0, this._lines.length - 1);
      this.col = clamp(s.col, 0, this._lines[this.row].length);
      this._want = null;
   }

   // Called before an edit that changes the text: pushes a snapshot when this edit begins a group.
   _group(kind, now, force = false) {
      if (force || kind !== this._kind || now - this._time >= IDLE) {
         this._undo.push(this._state());
         if (this._undo.length > MAX_UNDO) this._undo.shift();
      }
      this._redo.length = 0;
      this._kind = kind; this._time = now; this._want = null;
   }

   // Keeps the cursor inside the window, and the window inside the text. Sideways it counts in the columns that the card shows (a tab
   // is two) and leaves the cursor MARGIN columns from either edge (less in a window too narrow for that; never before column 0).
   _reveal() {
      if (this.row < this.scroll) this.scroll = this.row;
      if (this.row >= this.scroll + this.rows) this.scroll = this.row - this.rows + 1;
      this.scroll = clamp(this.scroll, 0, Math.max(0, this._lines.length - this.rows));
      const v = visualCol(this._lines[this.row], this.col), m = Math.min(MARGIN, Math.floor((this.cols - 1) / 2));
      if (v - this.scrollX < m) this.scrollX = Math.max(0, v - m);
      else if (v - this.scrollX > this.cols - 1 - m) this.scrollX = v - (this.cols - 1 - m);
   }

   // The widest line, in columns of the card.
   _width() { return this._lines.reduce((w, l) => Math.max(w, visualCol(l, l.length)), 0); }

   _insert(text, now, force) {
      const room = MAX_CHARS - this.text.length;
      text = clean(text).slice(0, Math.min(MAX_PASTE, Math.max(0, room)));
      if (!text) return;
      this._group('insert', now, force || text.length > 1);
      const parts = text.split('\n'), line = this._lines[this.row];
      const head = line.slice(0, this.col), tail = line.slice(this.col);
      const last = parts[parts.length - 1];
      this._lines.splice(this.row, 1, ...parts.map((p, i) => (i === 0 ? head : '') + p + (i === parts.length - 1 ? tail : '')));
      this.row += parts.length - 1;
      this.col = (parts.length === 1 ? head.length : 0) + last.length;
   }

   _newline(now) {
      this._group('insert', now, true);
      const line = this._lines[this.row];
      const indent = /^ */.exec(line)[0].slice(0, this.col);
      this._lines.splice(this.row, 1, line.slice(0, this.col), indent + line.slice(this.col));
      this.row++; this.col = indent.length;
   }

   // Joins the line with the one before it, with the cursor at the join.
   _joinPrev() {
      const prev = this._lines[this.row - 1];
      this._lines.splice(this.row - 1, 2, prev + this._lines[this.row]);
      this.row--; this.col = prev.length;
   }

   _backspace(now) {
      if (this.col === 0 && this.row === 0) return;
      this._group('delete', now);
      if (this.col === 0) return this._joinPrev();
      const line = this._lines[this.row];
      this._lines[this.row] = line.slice(0, this.col - 1) + line.slice(this.col);
      this.col--;
   }

   _delete(now) {
      const line = this._lines[this.row];
      if (this.col === line.length && this.row === this._lines.length - 1) return;
      this._group('delete', now);
      if (this.col < line.length) this._lines[this.row] = line.slice(0, this.col) + line.slice(this.col + 1);
      else this._lines.splice(this.row, 2, line + this._lines[this.row + 1]);
   }

   // Deletes from the line start to the cursor; at the line start it joins the previous line instead.
   _deleteLineStart(now) {
      if (this.col === 0) return this._backspace(now);
      this._group('delete', now);
      this._lines[this.row] = this._lines[this.row].slice(this.col);
      this.col = 0;
   }

   _move(dir) {
      const L = this._lines, vertical = { up: -1, down: 1, pageup: -this.rows, pagedown: this.rows }[dir];
      if (vertical) {
         if (this._want === null) this._want = this.col;
         this.row = clamp(this.row + vertical, 0, L.length - 1);
         this.col = Math.min(this._want, L[this.row].length);
         return;
      }
      this._want = null;
      if (dir === 'home') this.col = 0;
      else if (dir === 'end') this.col = L[this.row].length;
      else if (dir === 'left') {
         if (this.col > 0) this.col--;
         else if (this.row > 0) { this.row--; this.col = L[this.row].length; }
      } else if (dir === 'right') {
         if (this.col < L[this.row].length) this.col++;
         else if (this.row < L.length - 1) { this.row++; this.col = 0; }
      }
   }

   _swap(from, to) {
      if (!from.length) return;
      to.push(this._state());
      this._restore(from.pop());
      this._kind = null; this._time = -Infinity;      // the next edit starts a group of its own
   }
}

const DIRS = ['left', 'right', 'up', 'down', 'home', 'end', 'pageup', 'pagedown'];

const HANDLERS = {
   insert: (b, op, now) => { if (typeof op.text === 'string') b._insert(op.text, now, false); },
   newline: (b, op, now) => b._newline(now),
   tab: (b, op, now) => b._insert(INDENT, now, false),
   backspace: (b, op, now) => b._backspace(now),
   delete: (b, op, now) => b._delete(now),
   deleteLineStart: (b, op, now) => b._deleteLineStart(now),
   move: (b, op) => { if (DIRS.includes(op.dir)) b._move(op.dir); },
   undo: b => b._swap(b._undo, b._redo),
   redo: b => b._swap(b._redo, b._undo),
   // The wheel moves the window only; the cursor is pulled back into view by the next cursor move or edit.
   scroll: (b, op) => {
      const n = Math.trunc(Number(op.lines)) || 0;
      b.scroll = clamp(b.scroll + n, 0, Math.max(0, b._lines.length - b.rows));
   },
   // The same sideways: to the end of the widest line and MARGIN columns more.
   scrollX: (b, op) => {
      const n = Math.trunc(Number(op.cols)) || 0;
      b.scrollX = clamp(b.scrollX + n, 0, Math.max(0, b._width() + MARGIN - b.cols));
   },
   // The card's zoom changed its size: columns and rows. A window that now shows blank space at the right is pulled back (as the wheel
   // would), then apply() moves the window to keep the cursor in view.
   size: (b, op) => {
      const ok = v => Number.isInteger(v) && v >= 1 && v <= 200;
      if (ok(op.cols)) b.cols = op.cols;
      if (ok(op.rows)) b.rows = op.rows;
      b.scrollX = Math.min(b.scrollX, Math.max(0, b._width() + MARGIN - b.cols));
   },

   // Marks the current text as the running text without touching the history.
   clean: b => { b._base = b.text; },
   // Sets the running text (what `dirty` compares with) to `text` without touching the buffer: the text that the runtime runs is
   // not always the one in the buffer (typing went on after a commit, or the run came from elsewhere).
   base: (b, op) => { b._base = typeof op.text === 'string' ? clean(op.text) : b.text; },
   set: (b, op) => {
      b._lines = clean(typeof op.text === 'string' ? op.text : '').split('\n');
      b._text = null; b._base = b.text;
      b.row = 0; b.col = 0; b.scroll = 0; b.scrollX = 0; b._want = null;
      b._undo = []; b._redo = []; b._kind = null; b._time = -Infinity;
   },
};
Object.setPrototypeOf(HANDLERS, null);      // so that an op named `constructor` or `toString` finds nothing
