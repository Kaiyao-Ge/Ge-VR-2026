// The room as a truncated signed distance field: a 4 cm grid where each cell
// keeps the averaged distance (m) to the nearest surface along the camera's
// rays, positive in the air, and how many times it was seen. Many noisy depth
// frames average into surfaces good to a centimetre or two; a surface nets
// pass turns the zero crossing into a mesh.
export const VOXEL = .04;
const TRUNC = 3 * VOXEL, MAX_W = 60;

export class Volume {
   // centre: [x, y, z] of the box's floor-level middle; size: metres.
   constructor(centre, size = [8, 3.2, 8]) {
      this.n = size.map(s => Math.round(s / VOXEL));
      this.min = [centre[0] - size[0] / 2, centre[1], centre[2] - size[2] / 2];
      const count = this.n[0] * this.n[1] * this.n[2];
      this.d = new Float32Array(count).fill(TRUNC);
      this.w = new Uint8Array(count);
      this.points = 0;
   }
   index(i, j, k) { return i + this.n[0] * (j + this.n[1] * k); }

   // One depth frame: points (flat xyz) seen from origin. Cells within TRUNC of
   // each point along its ray take the distance from their centre to the point
   // along the ray. Points nearer than 0.5 m are hands.
   integrate(points, origin) {
      const [nx, ny, nz] = this.n, [x0, y0, z0] = this.min, d = this.d, w = this.w;
      for (let p = 0; p < points.length; p += 3) {
         const dx = points[p] - origin[0], dy = points[p + 1] - origin[1], dz = points[p + 2] - origin[2];
         const len = Math.hypot(dx, dy, dz);
         if (len < .5 || len > 6) continue;
         const ux = dx / len, uy = dy / len, uz = dz / len;
         for (let s = -TRUNC; s <= TRUNC; s += VOXEL * .7) {
            const i = Math.floor((points[p] + ux * s - x0) / VOXEL), j = Math.floor((points[p + 1] + uy * s - y0) / VOXEL), k = Math.floor((points[p + 2] + uz * s - z0) / VOXEL);
            if (i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz) continue;
            const c = i + nx * (j + ny * k);
            // The cell centre's distance along the ray, before (+) or behind (-) the surface.
            const cx = x0 + (i + .5) * VOXEL - origin[0], cy = y0 + (j + .5) * VOXEL - origin[1], cz = z0 + (k + .5) * VOXEL - origin[2];
            const sdf = Math.max(-TRUNC, Math.min(TRUNC, len - (cx * ux + cy * uy + cz * uz)));
            const wc = w[c];
            d[c] = (d[c] * wc + sdf) / (wc + 1);
            if (wc < MAX_W) w[c] = wc + 1;
         }
      }
      this.points += points.length / 3;
   }

   // Surface nets: a vertex in each cell where the distance changes sign (the
   // mean of its edge crossings, normal from the distance's gradient) and a
   // quad across each crossed edge. Cells seen fewer than minW times are left out.
   mesh(minW = 4) {
      const [nx, ny, nz] = this.n, [x0, y0, z0] = this.min, d = this.d, w = this.w;
      const vid = new Int32Array(nx * ny * nz).fill(-1), pos = [], nor = [], idx = [];
      const ok = c => w[c] >= minW;
      const corner = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]];
      const edges = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
      const v = new Float64Array(8), cs = new Int32Array(8);
      for (let k = 0; k < nz - 1; k++) for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
         const c0 = i + nx * (j + ny * k);
         // Most cells are far from any surface: one look at the first corner.
         if (!w[c0] || d[c0] >= VOXEL * 2.5 || d[c0] <= -VOXEL * 2.5) continue;
         let pos_ = 0, neg = 0, seen = true;
         for (let q = 0; q < 8; q++) {
            const c = c0 + corner[q][0] + nx * (corner[q][1] + ny * corner[q][2]);
            cs[q] = c; v[q] = d[c];
            if (!ok(c)) { seen = false; break; }
            if (v[q] > 0) pos_++; else neg++;
         }
         if (!seen || !pos_ || !neg) continue;
         let sx = 0, sy = 0, sz = 0, m = 0;
         for (const [a, b] of edges) {
            if ((v[a] > 0) === (v[b] > 0)) continue;
            const t = v[a] / (v[a] - v[b]);
            sx += corner[a][0] + t * (corner[b][0] - corner[a][0]);
            sy += corner[a][1] + t * (corner[b][1] - corner[a][1]);
            sz += corner[a][2] + t * (corner[b][2] - corner[a][2]);
            m++;
         }
         vid[c0] = pos.length / 3;
         pos.push(x0 + (i + .5 + sx / m) * VOXEL, y0 + (j + .5 + sy / m) * VOXEL, z0 + (k + .5 + sz / m) * VOXEL);
         const gx = v[1] + v[3] + v[5] + v[7] - v[0] - v[2] - v[4] - v[6];
         const gy = v[2] + v[3] + v[6] + v[7] - v[0] - v[1] - v[4] - v[5];
         const gz = v[4] + v[5] + v[6] + v[7] - v[0] - v[1] - v[2] - v[3];
         const g = Math.hypot(gx, gy, gz) || 1;
         nor.push(gx / g, gy / g, gz / g);
      }
      // A quad for each crossed edge from a cell's first corner along x, y and z,
      // between the four cells that share that edge, turned to face the air.
      const quad = (a, b, c, e) => {
         if (a < 0 || b < 0 || c < 0 || e < 0) return;
         const P = i => [pos[3 * i], pos[3 * i + 1], pos[3 * i + 2]];
         const [pa, pb, pc] = [P(a), P(b), P(c)];
         const u = [pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]], t = [pc[0] - pa[0], pc[1] - pa[1], pc[2] - pa[2]];
         const cr = [u[1] * t[2] - u[2] * t[1], u[2] * t[0] - u[0] * t[2], u[0] * t[1] - u[1] * t[0]];
         const n = [nor[3 * a] + nor[3 * c], nor[3 * a + 1] + nor[3 * c + 1], nor[3 * a + 2] + nor[3 * c + 2]];
         if (cr[0] * n[0] + cr[1] * n[1] + cr[2] * n[2] >= 0) idx.push(a, b, c, a, c, e); else idx.push(a, c, b, a, e, c);
      };
      for (let k = 1; k < nz - 1; k++) for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
         const c = i + nx * (j + ny * k);
         if (!ok(c) || d[c] >= VOXEL * 2.5 || d[c] <= -VOXEL * 2.5) continue;
         const s = d[c] > 0, X = 1, Y = nx, Z = nx * ny;
         if (ok(c + X) && (d[c + X] > 0) !== s) quad(vid[c], vid[c - Y], vid[c - Y - Z], vid[c - Z]);
         if (ok(c + Y) && (d[c + Y] > 0) !== s) quad(vid[c], vid[c - Z], vid[c - X - Z], vid[c - X]);
         if (ok(c + Z) && (d[c + Z] > 0) !== s) quad(vid[c], vid[c - X], vid[c - X - Y], vid[c - Y]);
      }
      return { positions: new Float32Array(pos), normals: new Float32Array(nor), indices: new Uint32Array(idx) };
   }
}
