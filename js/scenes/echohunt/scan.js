// A quick room scan without Space Setup: while you look around for a few
// seconds, a fan of hit tests from the eye finds the real surfaces (the
// headset hits its live depth). The points, one per 3 cm cell, become a room
// of the usual shape: walls turned to their direction, floor, ceiling, and
// the furniture as boxes from a 10 cm height map.
import { MAT, MAX_BOX, STRIDE, toRoom, toWorld } from './room.js';

export const SCAN_TIME = 12, CELL = .1;
const VOXEL = .03, MAX_POINTS = 40000;

export class Sweep {
   constructor() { this.points = new Map(); }   // voxel -> { p, n } in the world
   add(p, n) {
      if (this.points.size >= MAX_POINTS) return;
      const key = p.map(v => Math.floor(v / VOXEL)).join();
      if (!this.points.has(key)) this.points.set(key, { p, n });
   }
   get size() { return this.points.size; }
   room() { return roomFromPoints([...this.points.values()]); }
}

const pct = (list, f) => { if (!list.length) return NaN; const s = [...list].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(f * s.length))]; };

// points: [{ p, n }], world positions and surface normals; clear: world points
// no box may stand on (where the player was). Null if too few points.
export function roomFromPoints(points, clear = []) {
   if (points.length < 200) return null;
   // The walls' direction, as for a scanned mesh: 4 x the angle of horizontal normals agrees for walls 90 degrees apart.
   let C = 0, S = 0;
   for (const { n } of points) if (Math.abs(n[1]) < .3) { const a = 4 * Math.atan2(n[0], n[2]); C += Math.cos(a); S += Math.sin(a); }
   const room = { yaw: Math.hypot(C, S) > 20 ? Math.atan2(S, C) / 4 : 0 };
   const q = points.map(({ p, n }) => ({ p: toRoom(room, p), n: toRoom(room, n) }));
   const up = q.filter(r => r.n[1] > .8), down = q.filter(r => r.n[1] < -.8);
   // The floor: the lowest height where many points face up (a few stray points lie below it).
   let floor = 0;
   if (up.length > 30) {
      const bins = new Map(), y0 = Math.min(...up.map(r => r.p[1]));
      for (const r of up) { const b = Math.floor((r.p[1] - y0) / .02); bins.set(b, (bins.get(b) || 0) + 1); }
      const peak = Math.max(...bins.values()), lowest = Math.min(...[...bins].filter(([b, c]) => c >= Math.max(10, peak * .1)).map(([b]) => b));
      floor = y0 + (lowest + .5) * .02;
   }
   const top = pct(q.map(r => r.p[1]), .99);
   const ceil = down.length > 30 ? pct(down.map(r => r.p[1]), .97) : Math.max(floor + 2.4, top + .1);
   // Walls: past almost every point. A side never looked at ends at the farthest floor seen.
   const min = [0, 2].map(i => pct(q.map(r => r.p[i]), .01)), max = [0, 2].map(i => pct(q.map(r => r.p[i]), .99));
   room.min = [min[0], floor, min[1]];
   room.max = [Math.max(max[0], min[0] + 2), ceil, Math.max(max[1], min[1] + 2)];

   // Furniture: a height map of the tops, the points facing up off the floor,
   // inside the walls and below the ceiling. Walls and the fronts of things are
   // left out: near a wall they are hard to tell from it. The fan leaves thin
   // trails, so cells two apart still join.
   const nx = Math.ceil((room.max[0] - room.min[0]) / CELL);
   const cells = new Map();   // cell -> heights
   for (const { p, n } of q) {
      if (n[1] < .7 || p[1] < floor + .15 || p[1] > ceil - .3) continue;
      if (p[0] < room.min[0] + .15 || p[0] > room.max[0] - .15 || p[2] < room.min[2] + .15 || p[2] > room.max[2] - .15) continue;
      const k = Math.floor((p[0] - room.min[0]) / CELL) + nx * Math.floor((p[2] - room.min[2]) / CELL);
      (cells.get(k) || cells.set(k, []).get(k)).push(p[1]);
   }
   // Tops come at a few heights (a bed, a desk, a stack of boxes): the peaks of
   // their heights in 4 cm steps. Each cell takes the nearest; only cells of one height join.
   const hist = [], all = [...cells.values()].flat();
   for (const y of all) { const b = Math.floor((y - floor) / .04); hist[b] = (hist[b] || 0) + 1; }
   const at = b => (hist[b - 1] || 0) + 2 * (hist[b] || 0) + (hist[b + 1] || 0);
   const levels = [];
   for (let b = 0; b < hist.length; b++) if (at(b) >= 20 && at(b) >= at(b - 1) && at(b) > at(b + 1)) levels.push(floor + (b + .5) * .04);
   const level = y => levels.reduce((best, l) => Math.abs(l - y) < Math.abs(best - y) ? l : best, Infinity);
   const height = new Map();
   for (const [k, ys] of cells) { const l = level(pct(ys, .5)); if (Math.abs(l - pct(ys, .5)) < .08) height.set(k, l); }
   const seen = new Set(), boxes = [];
   for (const k0 of height.keys()) {
      if (seen.has(k0)) continue;
      const part = [k0];
      seen.add(k0);
      for (let i = 0; i < part.length; i++) {
         const k = part[i], x = k % nx, z = Math.floor(k / nx);
         for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
            const j = x + dx + nx * (z + dz);
            if (x + dx >= 0 && x + dx < nx && height.get(j) === height.get(k) && !seen.has(j)) { seen.add(j); part.push(j); }
         }
      }
      const ys = part.flatMap(k => cells.get(k));
      if (part.length < 4 || ys.length < 8) continue;
      // By height and size: a table (sound passes under its top) is at desk height and
      // smaller than a bed, which may be as high; a bed or a couch, or a cupboard.
      const h = pct(ys, .5), area = part.length * CELL * CELL;
      const table = h - floor >= .62 && h - floor < 1.05 && area < 1.6;
      const mat = table ? MAT.wood : h - floor < .62 || area >= 1.6 && h - floor < 1.05 ? MAT.fabric : MAT.wood;
      // A piece of any shape (a bed and the sill beside it) as rectangles, not one box over the floor between.
      for (const [x0, x1, z0, z1] of rectangles(part, nx))
         boxes.push({ min: [room.min[0] + x0 * CELL, table ? h - .04 : floor, room.min[2] + z0 * CELL],
            max: [room.min[0] + (x1 + 1) * CELL, h, room.min[2] + (z1 + 1) * CELL], mat, plate: table });
   }
   // Walls inside the room (a pillar, a corner of a closet): cells with wall points
   // from below 0.8 m to above 1.4 m, more than 30 cm in from the bounds. Solid from
   // there back to the bound behind them, floor to ceiling.
   const wall = new Map();   // cell -> { lo, hi, n }
   for (const { p, n } of q) {
      if (Math.abs(n[1]) > .3) continue;
      if (p[0] < room.min[0] + .3 || p[0] > room.max[0] - .3 || p[2] < room.min[2] + .3 || p[2] > room.max[2] - .3) continue;
      const k = Math.floor((p[0] - room.min[0]) / CELL) + nx * Math.floor((p[2] - room.min[2]) / CELL);
      const w = wall.get(k) || wall.set(k, { lo: 9, hi: -9, n: [0, 0] }).get(k);
      w.lo = Math.min(w.lo, p[1]); w.hi = Math.max(w.hi, p[1]); w.n[0] += n[0]; w.n[1] += n[2];
   }
   const tall = [...wall].filter(([k, w]) => w.lo < floor + .8 && w.hi > floor + 1.4);
   const used = new Set();
   for (const [k0, w0] of tall) {
      if (used.has(k0)) continue;
      // Facing along x or z; the cells of one face lie in a line across it.
      const ax = Math.abs(w0.n[0]) > Math.abs(w0.n[1]) ? 0 : 2, sign = Math.sign(ax ? w0.n[1] : w0.n[0]);
      const line = tall.filter(([k, w]) => !used.has(k) && (ax ? Math.floor(k / nx) === Math.floor(k0 / nx) : k % nx === k0 % nx)
         && Math.sign(ax ? w.n[1] : w.n[0]) === sign && Math.abs(ax ? w.n[1] : w.n[0]) > Math.abs(ax ? w.n[0] : w.n[1]));
      line.forEach(([k]) => used.add(k));
      if (line.length < 3) continue;
      const along = line.map(([k]) => ax ? k % nx : Math.floor(k / nx)), o = 2 - ax;
      const at = room.min[ax] + ((ax ? Math.floor(k0 / nx) : k0 % nx) + (sign > 0 ? 0 : 1)) * CELL;
      const bmin = [0, floor, 0], bmax = [0, ceil, 0];
      bmin[o] = room.min[o] + Math.min(...along) * CELL; bmax[o] = room.min[o] + (Math.max(...along) + 1) * CELL;
      // The face looks into the room; the solid is behind it.
      if (sign > 0) { bmin[ax] = room.min[ax]; bmax[ax] = at; } else { bmin[ax] = at; bmax[ax] = room.max[ax]; }
      boxes.push({ min: bmin, max: bmax, mat: MAT.concrete, plate: false });
   }
   const volume = b => (b.max[0] - b.min[0]) * (b.max[1] - b.min[1]) * (b.max[2] - b.min[2]);
   const free = clear.map(p => toRoom(room, p));
   room.boxes = boxes.filter(b => !free.some(p => p[0] > b.min[0] - .2 && p[0] < b.max[0] + .2 && p[2] > b.min[2] - .2 && p[2] < b.max[2] + .2)).sort((a, b) => volume(b) - volume(a)).slice(0, MAX_BOX);
   return room;
}

// Cells (index x + nx z) as rectangles [x0, x1, z0, z1]. Holes a cell wide are
// filled first (grown by a cell, then shrunk); then runs along x in each row, and
// a run joins the rectangle above it when their ends are within a cell. Specks are left out.
function rectangles(cells, nx) {
   const near = (set, k, all) => { let n = 0; for (const dz of [-1, 0, 1]) for (const dx of [-1, 0, 1]) n += set.has(k + dx + dz * nx) ? 1 : 0; return all ? n === 9 : n > 0; };
   const set = new Set(cells), grown = new Set();
   for (const k of set) for (const dz of [-1, 0, 1]) for (const dx of [-1, 0, 1]) grown.add(k + dx + dz * nx);
   const filled = [...grown].filter(k => set.has(k) || near(grown, k, true));
   const rows = new Map();
   for (const k of filled) { const z = Math.floor(k / nx); (rows.get(z) || rows.set(z, []).get(z)).push(k - z * nx); }
   const out = [];
   let open = [];
   for (const z of [...rows.keys()].sort((a, b) => a - b)) {
      const xs = rows.get(z).sort((a, b) => a - b), runs = [], next = [];
      for (const x of xs) if (runs.length && x - runs.at(-1)[1] <= 1) runs.at(-1)[1] = x; else runs.push([x, x]);
      for (const [x0, x1] of runs) {
         const r = open.find(r => r[3] === z - 1 && Math.abs(r[0] - x0) <= 1 && Math.abs(r[1] - x1) <= 1);
         if (r) { r[0] = Math.min(r[0], x0); r[1] = Math.max(r[1], x1); r[3] = z; open = open.filter(o => o !== r); next.push(r); }
         else { const n = [x0, x1, z, z]; out.push(n); next.push(n); }
      }
      open = next;
   }
   return out.filter(([x0, x1, z0, z1]) => (x1 - x0 + 1) * (z1 - z0 + 1) >= 4);
}

// The hit tests: a fan from the eye, 70 degrees wide, from 14 degrees up to 65
// down, so the floor and the bed at your feet are found while you look ahead.
const FAN_UP = [.25, 0, -.4, -.84, -1.4, -2.2];
export async function startHitTests(session) {
   const viewer = await session.requestReferenceSpace('viewer'), sources = [];
   for (let i = 0; i < 5; i++) for (const y of FAN_UP) {
      const offsetRay = new XRRay({ x: 0, y: 0, z: 0, w: 1 }, { x: (i - 2) * .35, y, z: -1, w: 0 });
      sources.push(await session.requestHitTestSource({ space: viewer, offsetRay, entityTypes: ['point', 'plane', 'mesh'] })
         .catch(() => session.requestHitTestSource({ space: viewer, offsetRay })).catch(() => null));
   }
   return sources.filter(Boolean);
}

// A room from a fused mesh ({ positions, normals, indices } in the world):
// its walls, floor and furniture boxes from the mesh's points as from a sweep,
// and the mesh itself to draw, each vertex with the material of where it lies.
export function meshRoom(mesh, clear = []) {
   const { positions: P, normals: Nr, indices } = mesh, count = P.length / 3;
   const step = Math.max(1, Math.floor(count / 20000)), pts = [];
   for (let v = 0; v < count; v += step) pts.push({ p: [P[3 * v], P[3 * v + 1], P[3 * v + 2]], n: [Nr[3 * v], Nr[3 * v + 1], Nr[3 * v + 2]] });
   const room = roomFromPoints(pts, clear);
   if (!room) return null;
   const V = new Float32Array(count * STRIDE), W = p => toWorld(room, p);
   const ex = W([1, 0, 0]), ez = W([0, 0, 1]);
   for (let v = 0; v < count; v++) {
      const p = [P[3 * v], P[3 * v + 1], P[3 * v + 2]], n = [Nr[3 * v], Nr[3 * v + 1], Nr[3 * v + 2]], r = toRoom(room, p);
      const b = room.boxes.findIndex(b => b.min.every((m, j) => r[j] > m - .05 && r[j] < b.max[j] + .05));
      const box = room.boxes[b], plate = box?.plate && n[1] > .7 && r[1] > box.max[1] - .06;
      const mat = box ? box.mat : n[1] > .7 && r[1] < room.min[1] + .1 ? MAT.wood : MAT.concrete;
      let uv = [.5, .5], size = [1e3, 1e3], tu, tv;
      if (plate) {
         size = [box.max[0] - box.min[0], box.max[2] - box.min[2]];
         uv = [(r[0] - box.min[0]) / size[0], (r[2] - box.min[2]) / size[1]];
         tu = ex; tv = ez;
      } else {
         const a = Math.abs(n[1]) < .9 ? [0, 1, 0] : [1, 0, 0];
         tu = norm(cross(a, n)); tv = cross(n, tu);
      }
      V.set([...p, ...n, ...uv, ...size, mat, plate ? 1 : 0, ...tu, ...tv], v * STRIDE);
   }
   room.mesh = { vertices: V, indices };
   return room;
}
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = a => { const l = Math.hypot(...a) || 1; return a.map(v => v / l); };
