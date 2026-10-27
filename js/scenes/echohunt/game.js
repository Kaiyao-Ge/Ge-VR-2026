// The game: during a round, moths flutter around the dark room, bouncing off
// the walls, the furniture and your head, and tap each time they hit
// something. Each one shot is a hit; a caught moth comes back elsewhere two
// seconds later. Between rounds there are none.
import { toRoom, toWorld } from './room.js';

export const ROUND = 60, MOTHS = 10, RADIUS = .05, HEAD = .15;

export class Game {
   constructor(room, random = Math.random) {
      this.random = random;
      this.room = room;
      this.moths = Array.from({ length: MOTHS }, () => ({ alive: false }));
      this.hits = 0;
      this.endsAt = null;     // the time the round ends, null between rounds
   }
   get running() { return this.endsAt !== null; }
   remaining(now) { return this.running ? Math.max(0, this.endsAt - now) : 0; }

   // A free spot away from the furniture and the players.
   spawn(m, heads, now) {
      const { min, max, boxes } = this.room, R = this.random;
      let p;
      // Away from the players if there is room, else anywhere free.
      for (let k = 0; k < 120; k++) {
         p = [0, 1, 2].map(i => min[i] + .3 + (max[i] - min[i] - .6) * R());
         p[1] = Math.min(Math.max(p[1], min[1] + .8), Math.min(max[1] - .3, min[1] + 2.1));
         if (!boxes.some(b => inside(b, p, .15)) && !this.solid?.(p) && (k >= 60 || heads.every(h => dist(h, p) > 1.2))) break;
      }
      const a = 2 * Math.PI * R();
      return Object.assign(m, { p, v: [.3 * Math.cos(a), 0, .3 * Math.sin(a)], alive: true, respawnAt: 0, tapAt: now });
   }

   // Host: move the moths. heads: world positions. Returns what happened.
   step(now, dt, headsWorld) {
      const events = [], heads = headsWorld.map(h => toRoom(this.room, h)), { min, max, boxes } = this.room, R = this.random;
      if (this.running && now >= this.endsAt) {
         this.endsAt = null; events.push({ k: 'end' });
         for (const m of this.moths) m.alive = false;
      }
      this.moths.forEach((m, i) => {
         if (!m.alive) { if (this.running && now >= m.respawnAt) this.spawn(m, heads, now); return; }
         const { p, v } = m;
         let hit = false;
         // Flutter: a random push, a pull back to flying height, and a speed
         // between 0.15 and 0.4 m/s, slow enough to reach for.
         for (let j = 0; j < 3; j++) v[j] += (R() * 2 - 1) * dt;
         v[1] += (Math.min(Math.max(p[1], min[1] + .7), min[1] + 2.2) - p[1]) * 1.5 * dt;
         const s = Math.hypot(...v), want = Math.min(.4, Math.max(.15, s)), was = [...p];
         for (let j = 0; j < 3; j++) { v[j] *= want / (s || 1); p[j] += v[j] * dt; }
         // Into something solid (a scanned room's own shape): back along each axis that went in, bouncing.
         if (this.solid?.(p)) {
            for (let j = 0; j < 3; j++) {
               const q = [...was]; q[j] = p[j];
               if (this.solid(q)) { p[j] = was[j]; v[j] = -v[j]; }
            }
            if (this.solid(p)) { p.splice(0, 3, ...was); v.forEach((x, j) => v[j] = -x); }
            hit = true;
         }
         for (let j = 0; j < 3; j++) {
            if (p[j] < min[j] + RADIUS) { p[j] = min[j] + RADIUS; v[j] = Math.abs(v[j]); hit = true; }
            if (p[j] > max[j] - RADIUS) { p[j] = max[j] - RADIUS; v[j] = -Math.abs(v[j]); hit = true; }
         }
         for (const b of boxes) if (inside(b, p, RADIUS)) {
            // Out through the nearest face, bouncing off it.
            let best = Infinity, axis = 0, side = 1;
            for (let j = 0; j < 3; j++) for (const sd of [-1, 1]) {
               const d = sd < 0 ? p[j] - (b.min[j] - RADIUS) : b.max[j] + RADIUS - p[j];
               if (d < best) { best = d; axis = j; side = sd; }
            }
            p[axis] += side * best;
            v[axis] = side * Math.abs(v[axis]);
            hit = true;
         }
         // Off a head, as the balls in bouncing.js do.
         for (const h of heads) {
            const d = dist(p, h);
            if (d < HEAD + RADIUS) {
               const n = p.map((x, j) => (x - h[j]) / (d || 1)), vn = n[0] * v[0] + n[1] * v[1] + n[2] * v[2];
               for (let j = 0; j < 3; j++) { p[j] = h[j] + n[j] * (HEAD + RADIUS); if (vn < 0) v[j] -= 2 * vn * n[j]; }
               hit = true;
            }
         }
         // A moth caught in a gap, hitting something every few frames, starts again elsewhere, quietly.
         m.hits = hit ? (m.hits || 0) + 1 : Math.max(0, (m.hits || 0) - dt * 20);
         if (m.hits > 30) { m.hits = 0; this.spawn(m, heads, now); return; }
         if (hit && now - m.tapAt > .2) { m.tapAt = now; events.push({ k: 'tap', i, p: toWorld(this.room, p) }); }
      });
      return events;
   }

   // Shoot moth i: a hit, if it is there.
   catch(i, now) {
      const m = this.moths[i];
      if (!m?.alive || !this.running) return null;
      m.alive = false; m.respawnAt = now + 2;
      this.hits++;
      return { k: 'catch', i, p: toWorld(this.room, m.p) };
   }
   // A round: the moths appear, away from the heads.
   start(now, heads = []) {
      this.hits = 0;
      this.endsAt = now + ROUND;
      const h = heads.map(p => toRoom(this.room, p));
      for (const m of this.moths) this.spawn(m, h, now);
      return { k: 'start' };
   }
   // Where moth i is, in the world.
   where(i) { return toWorld(this.room, this.moths[i].p); }
}

// The nearest of the points (null: not seen) near a ray { o, d }: within 8 cm,
// plus 3 cm for each metre away, so far moths are not too hard to hit.
export function aim(ray, points) {
   let pick = null, best = Infinity;
   points.forEach((p, i) => {
      if (!p) return;
      const v = p.map((x, j) => x - ray.o[j]), t = v[0] * ray.d[0] + v[1] * ray.d[1] + v[2] * ray.d[2];
      const d = Math.hypot(...v.map((x, j) => x - t * ray.d[j]));
      if (t > 0 && d < .08 + .03 * t && t < best) { pick = i; best = t; }
   });
   return pick;
}

const inside = (b, p, pad) => p.every((x, j) => x > b.min[j] - pad && x < b.max[j] + pad);
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
