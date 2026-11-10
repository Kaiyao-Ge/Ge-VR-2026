// What the scene takes from a scanned room (see scanner.js): the mesh in
// Clay's vertex layout, and the table to put the miniature on. Pure maths, so
// it runs without Clay or a headset. A room is as echohunt/scan.js makes it:
// room.mesh = { vertices (STRIDE floats: position, normal, ...), indices },
// room.boxes in a room frame turned by room.yaw about the vertical.
import { STRIDE, toRoom, toWorld } from '../echohunt/room.js';

// Triangles the drawn room may have: a headset draws them twice a frame, and merging more finely costs time when the scan ends.
export const MAX_TRIS = 40000;
const FLOOR = [.4, .34, .28], TOP = [.78, .62, .4], WALL = [.62, .64, .68], CEILING = [.8, .8, .82];

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a, or) => { const l = Math.hypot(...a); return l > 1e-9 ? a.map(v => v / l) : or; };

// Clay's packing of a normal with its tangent and of a colour into one float each (see vertexArray in clay.js).
const packAB = (a, b) => Math.floor(40000 * Math.max(0, Math.min(.9999, .5 * a + .5))) + Math.max(0, Math.min(.9999, .5 * b + .5));
const packRGB = c => c.reduce((s, v, i) => s + Math.floor(256 * Math.max(0, Math.min(.9999, v))) / 256 * 256 ** i, 0);

// The surface's colour from its facing and height: the floor low and facing up,
// tops (tables, seats) higher up, ceilings facing down, the rest wall.
export const colour = (n, y, floor) => n[1] > .7 ? (y < floor + .12 ? FLOOR : TOP) : n[1] < -.7 ? CEILING : WALL;

// The vertices of a triangle mesh in groups: each vertex goes to the group of
// its cell, of side `cell` (0: each its own). Returns the groups' mean
// positions and summed normals, and the group of each vertex.
function group(V, count, cell) {
   const of = new Int32Array(count), ids = new Map(), P = [], N = [], K = [];
   for (let v = 0; v < count; v++) {
      const o = v * STRIDE;
      let g = v;
      if (cell) {
         const key = [0, 1, 2].reduce((k, a) => k * 4096 + 2048 + Math.floor(V[o + a] / cell), 0);
         g = ids.get(key);
         if (g === undefined) { g = ids.size; ids.set(key, g); P.push(0, 0, 0); N.push(0, 0, 0); K.push(0); }
      } else { P.push(0, 0, 0); N.push(0, 0, 0); K.push(0); }
      of[v] = g;
      K[g]++;
      for (let a = 0; a < 3; a++) { P[3 * g + a] += V[o + a]; N[3 * g + a] += V[o + 3 + a]; }
   }
   for (let g = 0; g < K.length; g++) for (let a = 0; a < 3; a++) P[3 * g + a] /= K[g];
   return { P, N, of };
}

// The room's mesh as triangles in Clay's layout (16 floats a vertex: position,
// normal and tangent packed, uv, colour packed, weights), at most `max`
// triangles, wound to face the way the scan's normals point (into the room).
// Over the limit, vertices are merged in cells that grow until it fits.
// skip(centre): true for a triangle (its centre, in the world) that is left out.
export function roomMesh(room, max = MAX_TRIS, skip = null) {
   const { vertices: V, indices: I } = room.mesh, count = V.length / STRIDE, floor = room.min[1];
   let cell = 0, g, tris, from;
   for (;;) {
      g = group(V, count, cell);
      tris = []; from = [];
      for (let i = 0; i + 2 < I.length; i += 3) {
         const a = g.of[I[i]], b = g.of[I[i + 1]], c = g.of[I[i + 2]];
         if (a !== b && b !== c && a !== c) { tris.push(a, b, c); from.push(i); }
      }
      if (tris.length / 3 <= max) break;
      cell = cell ? cell * 1.3 : .06;
   }
   const out = new Float32Array(tris.length * 16), at = k => g.P.slice(3 * k, 3 * k + 3);
   let o = 0;
   for (let i = 0; i < tris.length; i += 3) {
      let t = [tris[i], tris[i + 1], tris[i + 2]];
      const p = t.map(at), face = cross(sub(p[1], p[0]), sub(p[2], p[0])), len = Math.hypot(...face);
      if (!(len > 1e-12) || skip?.(p[0].map((v, a) => (v + p[1][a] + p[2][a]) / 3))) continue;
      // The scan's normals, those of the triangle's own vertices, say which side is the front.
      const side = [0, 1, 2].reduce((s, j) => { const o = I[from[i / 3] + j] * STRIDE + 3; return s + face[0] * V[o] + face[1] * V[o + 1] + face[2] * V[o + 2]; }, 0) < 0;
      if (side) t = [t[0], t[2], t[1]];
      const n = face.map(v => (side ? -v : v) / len), rgb = packRGB(colour(n, (p[0][1] + p[1][1] + p[2][1]) / 3, floor));
      for (const k of t) {
         const q = at(k), m = unit(g.N.slice(3 * k, 3 * k + 3), n), u = unit(cross(m, Math.abs(m[0]) < .9 ? [1, 0, 0] : [0, 1, 0]), [1, 0, 0]);
         out.set([...q, packAB(m[0], u[0]), packAB(m[1], u[1]), packAB(m[2], u[2]), 0, 0, rgb, 1, 0, 0, 0, 0, 0, 0], o);
         o += 16;
      }
   }
   return out.subarray(0, o);
}

// The triangles roomMesh makes, for drawing (see scandraw.js): 20 bytes a vertex
// instead of 64. Position as three floats, then the normal and the colour as
// bytes, unpacked from Clay's packing of them. An ArrayBuffer.
export function compact(triangles) {
   const n = triangles.length / 16, buffer = new ArrayBuffer(n * 20), f = new Float32Array(buffer), s = new Int8Array(buffer), u = new Uint8Array(buffer);
   for (let v = 0; v < n; v++) {
      const o = 16 * v, c = triangles[o + 8];
      for (let a = 0; a < 3; a++) {
         f[5 * v + a] = triangles[o + a];
         s[20 * v + 12 + a] = Math.round(127 * (2 * Math.floor(triangles[o + 3 + a]) / 40000 - 1));
         u[20 * v + 16 + a] = Math.floor(256 * ((c / 256 ** a) % 1));
      }
   }
   return buffer;
}

// Which triangles are the top of this table (a box of the room's, as pickTable
// returns): the world draws the table itself, and a second surface there would flicker.
export const tableTop = (room, { min, max }) => c => {
   const r = toRoom(room, c);
   return r[0] > min[0] - .03 && r[0] < max[0] + .03 && r[2] > min[2] - .03 && r[2] < max[2] + .03 && r[1] > max[1] - .08 && r[1] < max[1] + .06;
};

// The table to put the miniature on: of the room's boxes that are tables (plate),
// the one nearest the player within `range`, in front of them if any is, from
// the player at `eye` facing `fwd` (horizontal, [x, z]). Returns { p: the middle
// of its top, in the world; yaw: so that the table's x axis runs along its
// longer side and its z axis points towards the player (as the default table
// does); size: [long, short]; box: the room's box }, or null.
export function pickTable(room, eye, fwd, range = 2) {
   let best = null;
   for (const b of room.boxes || []) {
      if (!b.plate) continue;
      const mid = [(b.min[0] + b.max[0]) / 2, b.max[1], (b.min[2] + b.max[2]) / 2], p = toWorld(room, mid);
      // How far the player is from the top's footprint, measured in the room frame.
      const e = toRoom(room, eye), dx = Math.max(b.min[0] - e[0], 0, e[0] - b.max[0]), dz = Math.max(b.min[2] - e[2], 0, e[2] - b.max[2]);
      const d = Math.hypot(dx, dz);
      if (d > range) continue;
      const ahead = (p[0] - eye[0]) * fwd[0] + (p[2] - eye[2]) * fwd[1] > 0, cost = d + (ahead ? 0 : 100);
      if (!best || cost < best.cost) best = { cost, b, p };
   }
   if (!best) return null;
   const { b, p } = best, w = b.max[0] - b.min[0], d = b.max[2] - b.min[2];
   // The room's x axis is the world's yaw = room.yaw; its z axis is a quarter turn short of that.
   let yaw = w >= d ? room.yaw : room.yaw - Math.PI / 2;
   if (Math.sin(yaw) * (eye[0] - p[0]) + Math.cos(yaw) * (eye[2] - p[2]) < 0) yaw += Math.PI;
   return { p, yaw: Math.atan2(Math.sin(yaw), Math.cos(yaw)), size: [Math.max(w, d), Math.min(w, d)], box: b };
}
