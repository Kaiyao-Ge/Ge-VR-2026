// The room: its bounds and furniture as boxes, in a room frame turned by
// `yaw` about the vertical axis from the world, so a scanned room's walls are
// axis-aligned. Boxes drive the moths' bounces and the sound shadows; the
// drawn surfaces are those boxes, or the scanned triangles when there are any.

// decay: how long a surface rings after it is hit (s); weight: response to
// low, mid and high bands; grain: tremor cells per metre; stiff: how hard it trembles.
export const MATERIALS = [
   { name: 'concrete', decay: .12, weight: [.8, 1, .9], grain: 55, stiff: .6 },
   { name: 'wood', decay: .25, weight: [1, .9, .5], grain: 35, stiff: .8 },
   { name: 'fabric', decay: .04, weight: [.7, .35, .15], grain: 18, stiff: .35 },
   { name: 'metal', decay: 1.2, weight: [.6, 1, 1.3], grain: 90, stiff: 1.2 },
   { name: 'glass', decay: .5, weight: [.4, .9, 1.3], grain: 70, stiff: 1 },
];
export const MAT = Object.fromEntries(MATERIALS.map((m, i) => [m.name, i]));
export const MAX_BOX = 24;

// 6 x 3 x 6 m, origin at the floor's centre.
export function virtualRoom() {
   const box = (min, max, mat, plate = false) => ({ min, max, mat: MAT[mat], plate });
   return { yaw: 0, min: [-3, 0, -3], max: [3, 3, 3], boxes: [
      box([-.6, .72, -1.6], [.6, .76, -.9], 'wood', true),    // table
      box([-.58, 0, -1.58], [-.54, .72, -1.54], 'metal'),
      box([.54, 0, -1.58], [.58, .72, -1.54], 'metal'),
      box([-.58, 0, -.96], [-.54, .72, -.92], 'metal'),
      box([.54, 0, -.96], [.58, .72, -.92], 'metal'),
      box([-.25, 0, -.75], [.25, .45, -.3], 'wood'),          // chair
      box([-.25, .45, -.35], [.25, .95, -.3], 'wood'),
      box([1.2, 0, 1.7], [2.8, .42, 2.6], 'fabric'),          // sofa
      box([1.2, .42, 2.35], [2.8, .9, 2.6], 'fabric'),
      box([1.2, .42, 1.7], [1.4, .62, 2.35], 'fabric'),
      box([2.6, .42, 1.7], [2.8, .62, 2.35], 'fabric'),
      box([-2.95, 0, .4], [-2.6, 1.9, 1.8], 'metal'),         // shelf
      box([1.4, 0, -1.4], [1.8, 3, -1], 'concrete'),          // pillar
      box([-.9, 1, -2.99], [.9, 2.2, -2.96], 'glass'),        // window
   ] };
}

// Between the world and the room frame.
export const toRoom = (room, p) => turn(p, -room.yaw);
export const toWorld = (room, p) => turn(p, room.yaw);
function turn([x, y, z], a) {
   const c = Math.cos(a), s = Math.sin(a);
   return [c * x + s * z, y, c * z - s * x];
}

// Scene-model labels from the headset (Quest names them in lower case).
function labelMaterial(label) {
   const l = (label || '').toLowerCase();
   if (/floor|table|desk|storage|art/.test(l)) return MAT.wood;
   if (/couch|sofa|bed|plant/.test(l)) return MAT.fabric;
   if (/window/.test(l)) return MAT.glass;
   if (/screen|lamp/.test(l)) return MAT.metal;
   return MAT.concrete;
}
const STRUCTURE = /wall|floor|ceiling|global|door|window|invisible/;

// meshes: [{ label, positions (world xyz), indices }]. Returns a room with
// its scanned triangles (world xyz, 9 per triangle) and a material per triangle.
export function roomFromMeshes(meshes) {
   const tris = meshes.map(m => triangles(m));
   // The walls' direction: average 4 x the angle of near-vertical faces, so
   // walls 90 degrees apart agree, weighted by area.
   let C = 0, S = 0;
   for (const list of tris) for (const t of list) if (Math.abs(t.n[1]) < .3) {
      const a = 4 * Math.atan2(t.n[0], t.n[2]);
      C += t.area * Math.cos(a); S += t.area * Math.sin(a);
   }
   const room = { yaw: Math.atan2(S, C) / 4 };
   const global = meshes.findIndex(m => /global/.test(m.label));
   const bound = (list, min, max) => {
      for (const t of list) for (const p of t.p) {
         const q = toRoom(room, p);
         for (let i = 0; i < 3; i++) { min[i] = Math.min(min[i], q[i]); max[i] = Math.max(max[i], q[i]); }
      }
   };
   const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
   const shell = meshes.map((m, i) => i).filter(i => /wall|floor|ceiling/.test(meshes[i].label));
   for (const i of shell.length ? shell : global >= 0 ? [global] : meshes.map((m, i) => i)) bound(tris[i], min, max);
   Object.assign(room, { min, max });
   room.boxes = meshes.map((m, i) => i).filter(i => !STRUCTURE.test(meshes[i].label) && tris[i].length).map(i => {
      const bmin = [Infinity, Infinity, Infinity], bmax = [-Infinity, -Infinity, -Infinity];
      bound(tris[i], bmin, bmax);
      return { min: bmin, max: bmax, mat: labelMaterial(meshes[i].label), plate: /table|desk/.test(meshes[i].label) };
   }).sort((a, b) => volume(b) - volume(a)).slice(0, MAX_BOX);
   // Drawn surfaces: the whole-room mesh, its triangles taking the material of
   // the furniture they lie in; else every mesh with its own label.
   const drawn = global >= 0 ? [global] : meshes.map((m, i) => i);
   const n = drawn.reduce((s, i) => s + tris[i].length, 0);
   room.scan = { positions: new Float32Array(n * 9), mats: new Uint8Array(n), plates: new Int8Array(n).fill(-1) };
   let k = 0;
   for (const i of drawn) for (const t of tris[i]) {
      room.scan.positions.set(t.p.flat(), k * 9);
      const c = toRoom(room, t.p.reduce((a, p) => a.map((v, j) => v + p[j] / 3), [0, 0, 0]));
      const inside = global >= 0 ? room.boxes.findIndex(b => b.min.every((v, j) => c[j] > v - .03 && c[j] < b.max[j] + .03)) : -1;
      room.scan.mats[k] = inside >= 0 ? room.boxes[inside].mat
         : global >= 0 ? (t.n[1] > .7 && c[1] < min[1] + .15 ? MAT.wood : MAT.concrete) : labelMaterial(meshes[i].label);
      // The top of a table is a plate: its triangles share the table's face coordinates.
      const box = room.boxes[inside];
      if (box?.plate && t.n[1] > .9 && c[1] > box.max[1] - .05) room.scan.plates[k] = inside;
      k++;
   }
   return room;
}
const volume = b => (b.max[0] - b.min[0]) * (b.max[1] - b.min[1]) * (b.max[2] - b.min[2]);

function triangles({ positions: P, indices: I }) {
   const out = [];
   for (let i = 0; i + 2 < I.length; i += 3) {
      const p = [0, 1, 2].map(j => [P[3 * I[i + j]], P[3 * I[i + j] + 1], P[3 * I[i + j] + 2]]);
      const n = cross(sub(p[1], p[0]), sub(p[2], p[0])), len = Math.hypot(...n);
      if (len > 1e-9) out.push({ p, n: n.map(v => v / len), area: len / 2 });
   }
   return out;
}

// The vertices the echo shader draws, 18 floats each: position 3, normal 3,
// face uv 2, face size 2 (m), material, plate, and the face's axes along u and v.
export const STRIDE = 18;
export function buildGeometry(room) {
   const V = [], I = [];
   const W = p => toWorld(room, p);
   if (room.mesh) return room.mesh;
   if (room.scan) {
      const { positions: P, mats, plates } = room.scan;
      for (let k = 0; k < mats.length; k++) {
         const p = [0, 1, 2].map(j => [P[9 * k + 3 * j], P[9 * k + 3 * j + 1], P[9 * k + 3 * j + 2]]);
         const n = normalize(cross(sub(p[1], p[0]), sub(p[2], p[0])));
         const box = room.boxes[plates[k]];
         let tu = normalize(sub(p[1], p[0])), tv = cross(n, tu);
         if (box) { tu = W([1, 0, 0]); tv = W([0, 0, 1]); }
         for (const q of p) {
            // A free triangle has no face edges: the centre of a huge face.
            let uv = [.5, .5], size = [1e3, 1e3];
            if (box) {
               const r = toRoom(room, q);
               size = [box.max[0] - box.min[0], box.max[2] - box.min[2]];
               uv = [(r[0] - box.min[0]) / size[0], (r[2] - box.min[2]) / size[1]];
            }
            I.push(V.length / STRIDE);
            V.push(...q, ...n, ...uv, ...size, mats[k], box ? 1 : 0, ...tu, ...tv);
         }
      }
   } else {
      addBox(V, I, W, room.min, room.max, (a, s) => a === 1 && s < 0 ? MAT.wood : MAT.concrete, true);
      for (const b of room.boxes) addBox(V, I, W, b.min, b.max, () => b.mat, false, b.plate);
   }
   return { vertices: new Float32Array(V), indices: new Uint32Array(I) };
}
function addBox(V, I, W, min, max, faceMat, inward = false, plateTop = false) {
   for (let a = 0; a < 3; a++) for (const s of [-1, 1]) {
      const b = (a + 1) % 3, c = (a + 2) % 3, n = [0, 0, 0], tu = [0, 0, 0], tv = [0, 0, 0], first = V.length / STRIDE;
      n[a] = inward ? -s : s; tu[b] = 1; tv[c] = 1;
      const size = [max[b] - min[b], max[c] - min[c]], mat = faceMat(a, s), plate = plateTop && a === 1 && s === 1 ? 1 : 0;
      for (const [i, j] of [[0, 0], [1, 0], [1, 1], [0, 1]]) {
         const p = [];
         p[a] = s > 0 ? max[a] : min[a]; p[b] = i ? max[b] : min[b]; p[c] = j ? max[c] : min[c];
         V.push(...W(p), ...W(n), i, j, ...size, mat, plate, ...W(tu), ...W(tv));
      }
      I.push(first, first + 1, first + 2, first, first + 2, first + 3);
   }
}

// Does the segment a-b (room frame) pass through a box? The sound shadow.
export function blocked(boxes, a, b) {
   for (const box of boxes) {
      let tin = 0, tout = 1;
      for (let i = 0; i < 3 && tin <= tout; i++) {
         const d = b[i] - a[i];
         if (Math.abs(d) < 1e-9) { if (a[i] < box.min[i] || a[i] > box.max[i]) tout = -1; continue; }
         const t1 = (box.min[i] - a[i]) / d, t2 = (box.max[i] - a[i]) / d;
         tin = Math.max(tin, Math.min(t1, t2)); tout = Math.min(tout, Math.max(t1, t2));
      }
      if (tin < tout) return true;
   }
   return false;
}

// The part of a room that is shared over the network: no scanned triangles.
export const shareable = room => ({ yaw: room.yaw, min: room.min, max: room.max, boxes: room.boxes });

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const normalize = a => { const l = Math.hypot(...a) || 1; return a.map(v => v / l); };
