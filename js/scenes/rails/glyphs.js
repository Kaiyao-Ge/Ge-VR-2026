// Text in the headset without a canvas: the line font of js/render/core/linefont.js, built into one path mesh per
// string. The scene has 14 canvas texture channels and 7 of them go to the cards, the timeline and the bus window, so the
// stage's `text` shapes and a card's line label are drawn with strokes instead.
//
// `textPaths` is pure (it only reads the font) and is what the tests check. `drawText(node, text, {...})` puts one text
// child on `node`: the child owns a mesh of its own, named for it, that is rebuilt only when the string or its
// alignment changes, so moving, scaling or recolouring a text costs no mesh. The mesh is built at height 1 and the
// child's matrix scales it to `size` metres, so one mesh serves every size. `releaseText(node)` gives the mesh back.
// UI text sits on an opaque dark plate (one more child of the node, made with the text and reused), so that a bright room
// seen through the headset cannot wash the thin strokes out; `plate: false` is for a module's own picture (the stage), which
// must not hide what is behind it and keeps its own opacity.
import { linefont } from '../../render/core/linefont.js';

export const MAX_CHARS = 200;                 // the longest `text` shape that validDraw lets through
const ADVANCE = 0.76, WIDE = 0.6;             // a character's pitch and its glyph's width, as fractions of the height
const STROKE = 0.18;                          // the stroke's width, as a fraction of the height
const UNIT = 100;                             // the font's own height

export const PLATE = '#05080f';               // the plate's colour: near black
const PLATE_X = 0.3, PLATE_Y = 0.7, PLATE_Z = 0.0006;   // how far it reaches past the text's ends and its half height (both in text heights), and how far behind the text it is (metres)

const clay = () => globalThis.clay ?? globalThis.window?.clay;

// The paths of text at height 1, for an origin at the text's vertical middle: x to the right, y up, z = 0. Each path is a
// list of [x, y, 0] points; a path with fewer than two distinct points is dropped, and a repeated point is skipped
// (the stroke builder divides by the length of a step). `align` 'left' | 'center' | 'right' sets what x = 0 is.
export function textPaths(text, align = 'left') {
   const s = String(text == null ? '' : text).slice(0, MAX_CHARS);
   const width = s.length ? (s.length - 1) * ADVANCE + WIDE : 0;
   const x0 = align === 'center' ? -width / 2 : align === 'right' ? -width : 0;
   const paths = [];
   for (let i = 0; i < s.length; i++) {
      const glyph = linefont[s.charCodeAt(i) - 32];                         // characters outside 32..126 are blanks
      if (!glyph) continue;
      for (const path of glyph.paths) {
         const points = [];
         for (const [x, y] of path) {
            const p = [x0 + i * ADVANCE + x / UNIT, 0.5 - y / UNIT, 0], last = points[points.length - 1];
            if (!last || last[0] !== p[0] || last[1] !== p[1]) points.push(p);
         }
         if (points.length > 1) paths.push(points);
      }
   }
   return paths;
}

// The number of straight segments in paths (each becomes a few triangles).
export const segmentCount = paths => paths.reduce((n, p) => n + p.length - 1, 0);

// The width of text at height 1.
export const textWidth = text => {
   const n = Math.min(String(text == null ? '' : text).length, MAX_CHARS);
   return n ? (n - 1) * ADVANCE + WIDE : 0;
};

// Clay's materials need the three lights cancelled to show a colour as it is (see doorways/panel.js UNLIT): the ambient
// term is multiplied by the sum of the two default lights, (2, 2.1, 2.2) with the ambient's own share.
export const unlit = ([r, g, b]) => [r / 2, g / 2.1, b / 2.2, 0, 0, 0, 0, 0, 0, 1];

// '#rgb' or '#rrggbb' as [r, g, b] in 0..1; anything else is white. The same colour gives the same (frozen) array: a module's shapes
// repeat a few colours, and they are read again whenever a draw list changes.
const parsed = new Map(), WHITE = Object.freeze([1, 1, 1]);
export function parseColour(c) {
   if (typeof c !== 'string') return WHITE;
   let rgb = parsed.get(c);
   if (!rgb) {
      const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(c);
      const h = !m ? null : m[1].length === 3 ? [...m[1]].map(x => x + x).join('') : m[1];
      rgb = h ? Object.freeze([0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16) / 255)) : WHITE;
      if (parsed.size >= 256) parsed.clear();
      parsed.set(c, rgb);
   }
   return rgb;
}

// A colour as the node takes it: '#rrggbb' or [r, g, b] in 0..1, lit as it is.
export const colourOf = c => unlit(typeof c === 'string' ? parseColour(c) : c);

// Puts a square-based node at (x, y, z) with half extents (hw, hh) (and hd deep): the node's matrix is made anew. Returns the node.
export const quadAt = (q, x, y, hw, hh, z = 0, hd = 1) => q.identity().move(x, y, z).scale(hw, hh, hd);

let counter = 0;
const slots = new WeakMap();          // node -> { child, plate, name, key, plateAt }

// Show text on node: x, y, z its position in node's frame (the text is centred on y, upright, facing +z), size its height
// in metres, color [r, g, b] in 0..1 or '#rrggbb', align 'left' | 'center' | 'right'. Returns the child node.
export function drawText(node, text, { x = 0, y = 0, z = 0, size = 0.02, color = [1, 1, 1], align = 'left', plate = true } = {}) {
   let slot = slots.get(node);
   if (!slot) {
      const name = 'railsText' + counter++;
      clay()?.definePathsMesh?.(name, STROKE, []);
      slot = { child: node.add(name), plate: plate ? node.add('square').color(colourOf(PLATE)).opacity(1) : null, name, key: '', plateAt: '' };
      if (slot.plate) slot.plate.ignore = true;
      slots.set(node, slot);
   }
   const s = String(text == null ? '' : text).slice(0, MAX_CHARS), key = align + '\0' + s;
   if (key !== slot.key) {
      slot.key = key;
      clay()?.definePathsMesh?.(slot.name, STROKE, textPaths(text, align));
   }
   quadAt(slot.child, x, y, size, size, z, size);
   slot.child.color(colourOf(color));
   slot.child.ignore = false;
   if (!slot.plate) return slot.child;
   // The plate: as wide as the text and a little more, just behind it; an empty text has none.
   const w = textWidth(s) * size, cx = align === 'center' ? x : align === 'right' ? x - w / 2 : x + w / 2;
   slot.plate.ignore = w === 0;
   const plateAt = cx + ',' + y + ',' + z + ',' + w + ',' + size;
   if (w > 0 && plateAt !== slot.plateAt) { slot.plateAt = plateAt; quadAt(slot.plate, cx, y, w / 2 + PLATE_X * size, PLATE_Y * size, z - PLATE_Z); }
   return slot.child;
}

// Hide the text on node without freeing anything.
export function hideText(node) {
   const slot = slots.get(node);
   if (slot) { slot.child.ignore = true; if (slot.plate) slot.plate.ignore = true; }
}

// Give back the mesh of the text on node. The children stay hidden, so call it when node itself is going away.
export function releaseText(node) {
   const slot = slots.get(node);
   if (!slot) return;
   delete clay()?.formMesh?.()?.[slot.name];
   slot.child.ignore = true; if (slot.plate) slot.plate.ignore = true;
   slots.delete(node);
}
