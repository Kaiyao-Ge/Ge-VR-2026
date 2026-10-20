// Static physics of the building: modules are rigid blocks that rest on the
// table or on each other, with no glue. Checked rules (doc/hw5-design.md):
//   support   a module must rest on something (contact within 2 mm)
//   overlap   two modules may not share space
//   stability at every height where modules rest, each connected group above
//             must have its centre of mass inside the convex hull of its
//             contacts below, with 5 mm margin
import * as cg from '../../render/core/cg.js';
import { corners, span } from './design.js';

const TOUCH = .002, MARGIN = .005, MIN_AREA = 1e-4; // m, m, m² (1 cm²)

// Convex polygons in the xz plane, as [x, z] points, counter-clockwise.
const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
export const area = p => p.reduce((s, a, i) => s + cross([0, 0], a, p[(i + 1) % p.length]), 0) / 2;
const ccw = p => area(p) < 0 ? p.slice().reverse() : p;
// Sutherland–Hodgman: the part of `subject` inside the convex `clip`.
export function clip(subject, clipper) {
   let out = ccw(subject);
   const c = ccw(clipper);
   c.forEach((a, i) => {
      const b = c[(i + 1) % c.length], input = out;
      out = [];
      input.forEach((p, j) => {
         const q = input[(j + 1) % input.length], pin = cross(a, b, p) >= 0, qin = cross(a, b, q) >= 0;
         if (pin) out.push(p);
         if (pin !== qin) {
            const t = cross(a, b, p) / (cross(a, b, p) - cross(a, b, q));
            out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
         }
      });
   });
   return out.length >= 3 ? out : [];
}
// Monotone chain convex hull.
export function hull(points) {
   const p = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]), lower = [], upper = [];
   for (const x of p) { while (lower.length > 1 && cross(lower.at(-2), lower.at(-1), x) <= 0) lower.pop(); lower.push(x); }
   for (const x of p.reverse()) { while (upper.length > 1 && cross(upper.at(-2), upper.at(-1), x) <= 0) upper.pop(); upper.push(x); }
   return lower.slice(0, -1).concat(upper.slice(0, -1));
}
// Signed distance from a point to the boundary of a convex polygon (positive inside).
export function inside(poly, p) {
   if (poly.length < 3) return -Infinity;
   return Math.min(...poly.map((a, i) => {
      const b = poly[(i + 1) % poly.length];
      return cross(a, b, p) / Math.hypot(b[0] - a[0], b[1] - a[1]);
   }));
}

// What a module at `at` rests on: the table, or placed modules whose tops are
// at its bottom. placed: [{ m, at }]. Returns [{ on, poly, area }].
export function contacts(m, at, placed, table) {
   const foot = corners(m, at), [bottom] = span(m, at), out = [];
   if (Math.abs(bottom) <= TOUCH) {
      const [w, d] = table, poly = clip(foot, [[-w / 2, -d / 2], [-w / 2, d / 2], [w / 2, d / 2], [w / 2, -d / 2]]);
      if (area(poly) > MIN_AREA) out.push({ on: null, poly, area: area(poly) });
   }
   for (const p of placed) {
      if (p.m === m || Math.abs(span(p.m, p.at)[1] - bottom) > TOUCH) continue;
      const poly = clip(foot, corners(p.m, p.at));
      if (area(poly) > MIN_AREA) out.push({ on: p, poly, area: area(poly) });
   }
   return out;
}

// Where a module is, in cm, for messages: "x -8.0..8.0 z 6.0..8.0 y 0.0..5.0".
const cm = v => (v * 100).toFixed(1);
export function extent(m, at) {
   const c = corners(m, at), [b, t] = span(m, at), r = i => `${cm(Math.min(...c.map(p => p[i])))}..${cm(Math.max(...c.map(p => p[i])))}`;
   return `x ${r(0)} z ${r(1)} y ${cm(b)}..${cm(t)}`;
}

// Errors from putting module m at `at` among the placed modules.
export function placementErrors(m, at, placed, table) {
   const errors = [], [bottom, top] = span(m, at), foot = corners(m, at);
   let under = 0; // the highest top below the module's bottom, under its footprint
   for (const p of placed) {
      if (p.m === m) continue;
      const [b, t] = span(p.m, p.at), depth = Math.min(top, t) - Math.max(bottom, b), shared = area(clip(foot, corners(p.m, p.at)));
      if (shared > MIN_AREA && t <= bottom + TOUCH) under = Math.max(under, t);
      if (depth > TOUCH && shared > MIN_AREA)
         errors.push({ kind: 'overlap', text: `${m.id} (${extent(m, at)}) overlaps ${p.m.id} (${extent(p.m, p.at)}): ` +
            `${Math.round(shared * 1e6)} mm² in plan, ${Math.round(depth * 1000)} mm in height` });
   }
   if (!contacts(m, at, placed, table).length)
      errors.push({ kind: 'support', text: `${m.id} (${extent(m, at)}) rests on nothing: its bottom is at ${cm(bottom)} cm and the highest ` +
         `surface under it is at ${cm(under)} cm` });
   return errors;
}

// Tipping check of everything placed. For each height where something rests,
// every connected group of modules at or above it must have its centre of
// mass over the hull of the contacts that hold it up.
export function stabilityErrors(placed, table) {
   const rests = new Map(placed.map(p => [p, contacts(p.m, p.at, placed, table)]));
   const bottom = p => span(p.m, p.at)[0];
   const levels = [...new Set(placed.map(p => Math.round(bottom(p) * 1000)))].sort((a, b) => a - b);
   const errors = [], seen = new Set();
   for (const level of levels) {
      const above = placed.filter(p => bottom(p) >= level / 1000 - TOUCH);
      // Connected groups among the modules above the cut.
      const group = new Map();
      for (const p of above) {
         if (group.has(p)) continue;
         const g = [p], stack = [p];
         group.set(p, g);
         while (stack.length) {
            const q = stack.pop();
            for (const r of above) if (!group.has(r) &&
               (rests.get(q).some(c => c.on === r) || rests.get(r).some(c => c.on === q))) { group.set(r, g); g.push(r); stack.push(r); }
         }
      }
      for (const g of new Set(group.values())) {
         const key = g.map(p => p.m.id).sort().join();
         if (seen.has(key)) continue;
         seen.add(key);
         const held = g.flatMap(p => rests.get(p).filter(c => !g.includes(c.on)));
         if (!held.length) continue; // floating; reported by placementErrors
         let mass = 0, com = [0, 0, 0];
         for (const p of g) { mass += p.m.mass; com = cg.add(com, cg.scale(cg.add(p.at, p.m.com), p.m.mass)); }
         com = cg.scale(com, 1 / mass);
         const margin = inside(hull(held.flatMap(c => c.poly)), [com[0], com[2]]);
         if (margin < MARGIN) {
            const ids = g.map(p => p.m.id);
            errors.push({ kind: 'stability', text: `${ids[0]}${ids.length > 1 ? ` and ${ids.length - 1} more` : ''} would tip: ` +
               `centre of mass ${Math.round(margin * 1000)} mm inside the edge of its support at ${(level / 10).toFixed(1)} cm (needs ${MARGIN * 1000} mm)` });
         }
      }
   }
   return errors;
}

// The finished building, placed bottom-up: what check_structure reports.
export function checkStructure(modules, table) {
   const placed = [], errors = [];
   for (const m of modules.slice().sort((a, b) => span(a, a.target)[0] - span(b, b.target)[0])) {
      errors.push(...placementErrors(m, m.target, placed, table));
      placed.push({ m, at: m.target });
   }
   return errors.concat(stabilityErrors(placed, table));
}
