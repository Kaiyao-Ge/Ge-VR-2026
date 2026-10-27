// How sound gets around things. The room is a 10 cm grid of solid and free
// cells; from a source, the shortest way through free cells to every cell
// (26 neighbours) is found once, and kept as the excess over the straight
// line: zero in the open, growing behind a bed or round a corner. Sound
// arrives that much later and weaker. Speech is 0.3 to 3 m long, so a 10 cm
// grid is as fine as its bending; the waves themselves stay sharp, drawn at
// the straight distance plus this smooth excess. The cost per pixel is one
// texture read per source, however many triangles the room has.
import { toRoom } from './room.js';
import { VOXEL } from './tsdf.js';

export const CELL = .1, UNIT = .025, FAR = 255;   // excess in 2.5 cm steps; 255: no way there

// A grid over the room's bounds (world axes), cells outside the room solid.
function frame(room) {
   const corners = [];
   for (const x of [room.min[0], room.max[0]]) for (const z of [room.min[2], room.max[2]]) {
      const c = Math.cos(room.yaw), s = Math.sin(room.yaw);
      corners.push([c * x - s * z, s * x + c * z]);   // toWorld of [x, 0, z]
   }
   const lo = [Math.min(...corners.map(p => p[0])) - .2, room.min[1] - .2, Math.min(...corners.map(p => p[1])) - .2];
   const hi = [Math.max(...corners.map(p => p[0])) + .2, room.max[1] + .2, Math.max(...corners.map(p => p[1])) + .2];
   const n = [0, 1, 2].map(i => Math.ceil((hi[i] - lo[i]) / CELL));
   return { min: lo, n, cell: CELL, solid: new Uint8Array(n[0] * n[1] * n[2]) };
}
const centre = (g, i, j, k) => [g.min[0] + (i + .5) * CELL, g.min[1] + (j + .5) * CELL, g.min[2] + (k + .5) * CELL];
const outside = (room, r) => r[0] < room.min[0] || r[0] > room.max[0] || r[1] < room.min[1] || r[1] > room.max[1] || r[2] < room.min[2] || r[2] > room.max[2];

// From a room of boxes.
export function gridFromBoxes(room) {
   const g = frame(room), [nx, ny, nz] = g.n;
   for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const r = toRoom(room, centre(g, i, j, k));
      // A box solidifies every cell it reaches into, so a thin wall at an angle leaves no gap.
      if (outside(room, r) || room.boxes.some(b => r.every((v, a) => v > b.min[a] - CELL * .7 && v < b.max[a] + CELL * .7))) g.solid[i + nx * (j + ny * k)] = 1;
   }
   return g;
}

// From a fused volume: a cell is solid where a surface seen at least minW times
// passes through it, or just behind one.
export function gridFromVolume(volume, room, minW = 4) {
   const g = frame(room), [nx, ny, nz] = g.n, [vx, vy, vz] = volume.n, V = volume.min, vox = VOXEL;
   for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++)
      if (outside(room, toRoom(room, centre(g, i, j, k)))) g.solid[i + nx * (j + ny * k)] = 1;
   for (let c = 0; c < vz; c++) for (let b = 0; b < vy; b++) for (let a = 0; a < vx; a++) {
      const q = a + vx * (b + vy * c);
      if (volume.w[q] < minW || volume.d[q] > vox * .5) continue;
      const i = Math.floor((V[0] + (a + .5) * vox - g.min[0]) / CELL), j = Math.floor((V[1] + (b + .5) * vox - g.min[1]) / CELL), k = Math.floor((V[2] + (c + .5) * vox - g.min[2]) / CELL);
      if (i >= 0 && j >= 0 && k >= 0 && i < nx && j < ny && k < nz) g.solid[i + nx * (j + ny * k)] = 1;
   }
   return g;
}

export const cellOf = (g, p) => {
   const i = Math.floor((p[0] - g.min[0]) / CELL), j = Math.floor((p[1] - g.min[1]) / CELL), k = Math.floor((p[2] - g.min[2]) / CELL);
   return i < 0 || j < 0 || k < 0 || i >= g.n[0] || j >= g.n[1] || k >= g.n[2] ? -1 : i + g.n[0] * (j + g.n[1] * k);
};
export const solidAt = (g, p) => { const c = cellOf(g, p); return c < 0 || g.solid[c] === 1; };

// 26 neighbours: offsets and lengths in millimetres (100, 141, 173 for a 10 cm cell).
const NEIGHBOURS = [];
for (const dz of [-1, 0, 1]) for (const dy of [-1, 0, 1]) for (const dx of [-1, 0, 1])
   if (dx || dy || dz) NEIGHBOURS.push([dx, dy, dz, Math.round(Math.hypot(dx, dy, dz) * CELL * 1000)]);

// The excess of the shortest way from src over the straight line, per cell, in
// UNIT steps; FAR where there is no way. Solid cells take their best free
// neighbour's, so reading between cells near a wall stays smooth.
export function pathField(g, src) {
   const [nx, ny, nz] = g.n, count = nx * ny * nz, S = g.solid;
   const dist = new Int32Array(count).fill(0x3fffffff), out = new Uint8Array(count).fill(FAR);
   // Start in the source's cell, or the nearest free one (a tap against a wall).
   let start = cellOf(g, src);
   if (start < 0 || S[start]) {
      start = -1;
      const i0 = Math.floor((src[0] - g.min[0]) / CELL), j0 = Math.floor((src[1] - g.min[1]) / CELL), k0 = Math.floor((src[2] - g.min[2]) / CELL);
      let best = Infinity;
      for (let dk = -3; dk <= 3; dk++) for (let dj = -3; dj <= 3; dj++) for (let di = -3; di <= 3; di++) {
         const i = i0 + di, j = j0 + dj, k = k0 + dk, d = di * di + dj * dj + dk * dk;
         if (i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz || d >= best || S[i + nx * (j + ny * k)]) continue;
         best = d; start = i + nx * (j + ny * k);
      }
      if (start < 0) return out;
   }
   // Dial's algorithm: a ring of buckets, one per millimetre of distance. The
   // grid's outer cells are solid (outside the room) and never left from, so
   // a free cell's neighbours are always in it.
   const RING = 174, buckets = Array.from({ length: RING }, () => []);
   // A step on a slant may not cut a corner: the cells it passes, along each axis, must be free too.
   const step = NEIGHBOURS.map(([dx, dy, dz]) => dx + nx * (dy + ny * dz)), len = NEIGHBOURS.map(n => n[3]);
   const via = NEIGHBOURS.map(([dx, dy, dz]) => [dx, nx * dy, nx * ny * dz].filter((v, a) => [dx, dy, dz][a] && (dx !== 0) + (dy !== 0) + (dz !== 0) > 1));
   const si = start % nx, sj = Math.floor(start / nx) % ny, sk = Math.floor(start / (nx * ny));
   dist[start] = 0; buckets[0].push(start);
   let pending = 1;
   for (let d = 0; pending; d++) {
      const bucket = buckets[d % RING];
      while (bucket.length) {
         const c = bucket.pop();
         pending--;
         if (dist[c] !== d) continue;
         for (let n = 0; n < 26; n++) {
            const q = c + step[n], e = d + len[n], v = via[n];
            if (S[q] || dist[q] <= e || v.length && (S[c + v[0]] || S[c + v[1]] || v.length > 2 && S[c + v[2]])) continue;
            dist[q] = e; buckets[e % RING].push(q); pending++;
         }
      }
   }
   // The excess over the same grid's straight way (its 26 directions make any
   // way a few per cent long; this cancels that in the open).
   for (let c = 0; c < count; c++) {
      if (S[c] || dist[c] >= 0x3fffffff) continue;
      let x = Math.abs(c % nx - si), y = Math.abs(Math.floor(c / nx) % ny - sj), z = Math.abs(Math.floor(c / (nx * ny)) - sk), t;
      if (x < y) { t = x; x = y; y = t; } if (y < z) { t = y; y = z; z = t; } if (x < y) { t = x; x = y; y = t; }
      const straight = (x - y) * 100 + (y - z) * 141 + z * 173;
      out[c] = Math.min(FAR - 1, Math.round((dist[c] - straight) / (UNIT * 1000)));
   }
   for (let c = 0; c < count; c++) {
      if (!S[c]) continue;
      const i = c % nx, j = Math.floor(c / nx) % ny, k = Math.floor(c / (nx * ny));
      let best = FAR;
      for (const [dx, dy, dz] of NEIGHBOURS) {
         const a = i + dx, b = j + dy, e = k + dz;
         if (a < 0 || b < 0 || e < 0 || a >= nx || b >= ny || e >= nz) continue;
         const q = a + nx * (b + ny * e);
         if (!S[q] && out[q] < best) best = out[q];
      }
      out[c] = best;
   }
   return out;
}

// Metres of excess at p, from a field; Infinity where no way leads.
export function excessAt(g, field, p) {
   const c = cellOf(g, p);
   if (c < 0) return Infinity;
   return field[c] === FAR ? Infinity : field[c] * UNIT;
}
// How much of a sound gets round: none of it where no way leads, less the further it has to go round.
export const through = excess => Math.exp(-excess / .5);

// The page's side: the grid of the room drawn, and the fields of the sources
// heard, asked of a worker and kept (the 64 used last). Until a field is
// back, its sound goes straight.
export class Paths {
   constructor(onGrid) {
      this.worker = new Worker(new URL('./paths.worker.js', import.meta.url), { type: 'module' });
      this.grid = null; this.gen = 0; this.fields = new Map(); this.clock = 0;
      this.worker.onmessage = ({ data: m }) => {
         if (m.gen !== this.gen) return;
         if (m.t === 'grid') { this.grid = m.grid; onGrid?.(m.grid); }
         else if (this.fields.has(m.key)) this.fields.get(m.key).data = m.data;
      };
   }
   setRoom(room) {
      this.gen++; this.grid = null; this.fields.clear();
      const { yaw, min, max, boxes } = room;
      this.worker.postMessage({ t: 'room', gen: this.gen, room: { yaw, min, max, boxes }, grid: room.grid || null });
   }
   // The field of a source at src (one per grid cell), asked for if new.
   field(src) {
      if (!this.grid) return null;
      const key = cellOf(this.grid, src);
      let f = this.fields.get(key);
      if (!f) {
         f = { key, data: null, used: 0 };
         this.fields.set(key, f);
         this.worker.postMessage({ t: 'field', gen: this.gen, key, src: [...src] });
         if (this.fields.size > 64) {
            const oldest = [...this.fields.values()].reduce((a, b) => a.used < b.used ? a : b);
            this.fields.delete(oldest.key);
         }
      }
      f.used = ++this.clock;
      return f;
   }
   excess(src, p) { const f = this.field(src); return f?.data ? excessAt(this.grid, f.data, p) : 0; }
   solid(p) { return this.grid ? solidAt(this.grid, p) : false; }
   dispose() { this.worker.terminate(); }
}
