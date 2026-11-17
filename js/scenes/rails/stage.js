// The stage mat on the real desk: a 0.40 m square whose outline the person sees through the headset, and on it what the
// modules draw (spec 2.6). Every shape is in stage coordinates (metres; origin at the mat's centre on the desk, x right,
// y up, z towards the user) and all of them sit under one root node that carries `stageMatrix`, so moving the mat moves
// them together. Shapes beyond the mat are drawn, not clipped.
//
// Shapes (the draw list of values.js): `sphere` at p, radius s; `box` at p, half sizes s (a number, or three); `line`
// from p to `to`, a tube of radius s; `text` at p, centred, upright and facing the user, s metres high, in the line font
// (glyphs.js), never a canvas. The nodes come from pools that grow when a frame needs more than any frame before and
// are never freed: a frame allocates nothing, shapes not used are hidden (`ignore`). While paused the mat's outline is amber
// (the scene is the past: what the modules drew then); the shapes themselves are drawn as always. Sizes are clamped to what a 0.40 m mat can sensibly show
// (a shape's size 0.25 m, a text's height 0.2 m, a position component 2 m), since a module's numbers are only finite.
// A list is read again when it is a different array, so pass a new array to change one.
import { MAX_SHAPES, SHAPES, finite, isVec3 } from './values.js';
import { MAT_SIZE } from './layout.js';
import { NodePool } from './pool.js';
import { drawText, hideText, releaseText, parseColour } from './glyphs.js';

export const MAX_DRAWN = 5 * MAX_SHAPES;       // five modules at the most that validDraw allows each
export const LIMITS = { size: 0.25, text: 0.2, pos: 2 };   // metres
export const OUTLINE = [0.45, 0.9, 1], PAUSED_OUTLINE = [1, 0.69, 0], OUTLINE_THICK = 0.004, FILL_OPACITY = 0.06;

// The draw lists of what the IDE has for the live shapes: an object of lists by module (an array of lists will do).
export function listsOf(x) {
   return x && typeof x === 'object' ? Object.values(x).filter(Array.isArray) : [];
}

// The shapes to draw: at most MAX_SHAPES per list and MAX_DRAWN in all. A shape that is not what validDraw describes is skipped,
// so a bad list cannot throw in a frame.
export function collect(lists) {
   const out = [];
   for (const list of listsOf(lists))
      for (let i = 0; i < Math.min(list.length, MAX_SHAPES) && out.length < MAX_DRAWN; i++) {
         const d = list[i];
         if (d && isVec3(d.p) && typeof d.shape === 'string') out.push(d);
      }
   return out;
}

const clamp = (v, m) => Math.max(-m, Math.min(m, v));
const size = (v, fallback, m) => finite(v) ? Math.min(Math.abs(v), m) : fallback;
const at = v => v.map(c => clamp(c, LIMITS.pos));

const FORMS = { sphere: 'sphere', box: 'cube', line: 'tubeZ' };

export function createStage(node) {
   const root = node.add();
   const flat = (x, y, z, w, h, d) => root.add('cube').identity().move(x, y, z).scale(w, h, d);
   // The mat: a faint fill and four edges, lying on the desk (their colour is the outline's, amber while paused).
   const h = MAT_SIZE / 2, mat = [];
   mat.push(flat(0, -0.0003, 0, h, 0.0002, h).color(OUTLINE).opacity(FILL_OPACITY).dull());
   for (const s of [-1, 1]) {
      mat.push(flat(0, 0, s * h, h + OUTLINE_THICK / 2, 0.0005, OUTLINE_THICK / 2).color(OUTLINE).dull());
      mat.push(flat(s * h, 0, 0, OUTLINE_THICK / 2, 0.0005, h - OUTLINE_THICK / 2).color(OUTLINE).dull());
   }
   // The pooled nodes of the shapes, all opaque.
   const group = () => {
      const holder = root.add(), pools = Object.fromEntries(SHAPES.map(kind => [kind, new NodePool(holder, kind === 'text' ? p => p.add() : p => p.add(FORMS[kind]).dull())]));
      // One shape on its pooled node.
      const place = (kind, n, d, p, to) => {
         const [x, y, z] = p, colour = parseColour(d.color);
         n.opacity(1);
         if (kind === 'text') {
            drawText(n, d.text, { x, y, z, size: size(d.s, 0.02, LIMITS.text), color: colour, align: 'center', plate: false });
            return;
         }
         n.color(colour);
         const s = size(d.s, 0.01, LIMITS.size);
         if (kind === 'sphere') n.identity().move(x, y, z).scale(s, s, s);
         else if (kind === 'box') {
            const [a, b, c] = isVec3(d.s) ? d.s.map(v => Math.min(Math.abs(v), LIMITS.size)) : [s, s, s];
            n.identity().move(x, y, z).scale(a, b, c);
         } else n.placeLimb(p, to, s);
      };
      return {
         pools,
         draw(list) {
            const used = { sphere: 0, box: 0, line: 0, text: 0 };
            for (const d of list) {
               const kind = d.shape;
               if (!SHAPES.includes(kind)) continue;
               if (kind === 'text' && typeof d.text !== 'string') continue;
               const p = at(d.p), to = kind === 'line' && isVec3(d.to) ? at(d.to) : null;
               if (kind === 'line' && (!to || to.every((v, i) => v === p[i]))) continue;   // a point has no direction
               place(kind, pools[kind].take(used[kind]++), d, p, to);
            }
            for (const kind of SHAPES) pools[kind].hideFrom(used[kind], kind === 'text' ? hideText : null);
         },
      };
   };
   const live = group();
   const stats = g => Object.fromEntries(SHAPES.map(k => [k, { pooled: g.pools[k].size, shown: g.pools[k].shown }]));
   let last = { lists: null, matrix: null, paused: false };

   return {
      // stageMatrix: column-major 16 numbers (layout.stageFrame), or null before the desk is known (then nothing is shown); `draws` is the
      // IDE's object of draw lists by module, `paused` whether the IDE is paused (the outline turns amber).
      update(stageMatrix, draws, paused) {
         const ok = Array.isArray(stageMatrix) && stageMatrix.length === 16 && stageMatrix.every(finite);
         root.ignore = !ok;
         if (!ok) return;
         const same = last.matrix && stageMatrix.every((v, i) => v === last.matrix[i]);
         if (!same) { root.setMatrix(stageMatrix); last.matrix = stageMatrix.slice(); }
         // The lists themselves are compared, not the object or array that holds them, so a caller may build that each frame.
         if (!!paused !== last.paused) { last.paused = !!paused; for (const n of mat) n.color(paused ? PAUSED_OUTLINE : OUTLINE); }
         const lists = listsOf(draws);
         if (last.lists && lists.length === last.lists.length && lists.every((l, i) => l === last.lists[i])) return;
         last.lists = lists;
         live.draw(collect(lists));
      },
      // How many pooled nodes there are and how many are in use, per kind.
      get stats() { return stats(live); },
      dispose() {
         for (const n of live.pools.text.nodes) releaseText(n);
         node.remove(root);
      },
   };
}
