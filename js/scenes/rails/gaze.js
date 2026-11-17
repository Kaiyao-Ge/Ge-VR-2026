// The gaze of Rails, as pure rules: no Clay, no DOM, no clock of its own (time is passed in, in seconds).
//  - the head's ray is smoothed a little (about 60 ms), so that the cursor does not shake and a hit test does not flicker. The smoothing
//    does not depend on the frame rate: each frame takes the share alpha = 1 - exp(-dt / 0.06) of the way to the head's ray;
//  - the plugs have a hysteresis (the gaze gets onto a plug within 5 degrees and stays on it until it is beyond 7) and a grace: a press
//    counts as taking a plug that was the target within the last 0.2 s, because a press makes the head move;
//  - `gazeAt` says what the ray hits first (the bus window, the desk mat, or the cylinder of the cards, where a card, a plug and
//    the bus all sit) and where, for the cursor. The hit tests themselves (which card, which plug, on the bus) are the IDE's and
//    are given in; the cursor is drawn from the answer (reticle.js).
// A ray is { o: [x, y, z], d: [x, y, z] } with a unit `d`.
import { yawPitchOf, busWindowHit, deskTrace, plugAt, PLUG_TOL, PLUG_LEAVE, RADIUS } from './layout.js';

export const SMOOTH_TAU = 0.06;           // seconds
export const PLUG_GRACE_S = 0.2;          // a press takes a plug that was the target this recently
const RESET_S = 3;                        // after a pause this long the smoothing starts again from the head's ray

const finiteRay = r => !!r && r.o.every(Number.isFinite) && r.d.every(Number.isFinite);

// The smoothed ray. `step(ray, t)` takes the head's ray at time t and returns the smoothed one (a new object). The first ray is taken as it
// is, and so is one after a long pause (a page that was not drawn); a ray with a NaN in it is returned as it is and not remembered, so tracking
// loss hits nothing and the smoothing carries on from the last good ray afterwards. A frame with no time passed does not move it.
export function createRaySmoother(tau = SMOOTH_TAU) {
   let o = null, d = null, at = -Infinity;
   return {
      step(ray, t) {
         if (!finiteRay(ray) || !Number.isFinite(t)) return ray;
         const dt = t - at;
         if (!o || !(dt <= RESET_S)) { o = ray.o.slice(); d = ray.d.slice(); at = t; return { o: o.slice(), d: d.slice() }; }
         const a = 1 - Math.exp(-Math.max(dt, 0) / tau);
         for (let i = 0; i < 3; i++) { o[i] += (ray.o[i] - o[i]) * a; d[i] += (ray.d[i] - d[i]) * a; }
         const l = Math.hypot(d[0], d[1], d[2]);
         if (l > 1e-9) { d[0] /= l; d[1] /= l; d[2] /= l; } else { d = ray.d.slice(); }       // (opposite directions cancel: take the new one)
         at = t;
         return { o: o.slice(), d: d.slice() };
      },
      reset() { o = d = null; at = -Infinity; },
   };
}

// The plug the gaze is on, one state per slot. `update` is called every frame with the slots that have a card.
export class PlugTargets {
   constructor(slots) { this.on = Array.from({ length: slots }, () => false); this.seen = Array.from({ length: slots }, () => -Infinity); this.slot = null; }
   // The slot of the plug the gaze is on now (null for none): a plug that was on stays on within 7 degrees, one that was not gets on within 5.
   update(ws, ray, slots, t) {
      let found = null;
      for (let s = 0; s < this.on.length; s++) {
         const on = slots.includes(s) && !!ws && plugAt(ws, ray, s, this.on[s] ? PLUG_LEAVE : PLUG_TOL);
         this.on[s] = on;
         if (on) { this.seen[s] = t; if (found === null) found = s; }
      }
      return this.slot = found;
   }
   // The plug a press at time t takes: the one the gaze is on, else the one it was on most recently, within the grace.
   grabbable(t, slots) {
      if (this.slot !== null && slots.includes(this.slot)) return this.slot;
      let best = null;
      for (let s = 0; s < this.seen.length; s++) if (slots.includes(s) && t - this.seen[s] <= PLUG_GRACE_S + 1e-9 && (best === null || this.seen[s] > this.seen[best])) best = s;
      return best;
   }
   reset() { this.on.fill(false); this.seen.fill(-Infinity); this.slot = null; }
}

// What the ray hits first, for the cursor: { point, dist, kind }, `kind` one of 'window', 'desk', 'plug', 'bus', 'card' or null (nothing:
// the cursor is then on the cylinder of the cards, 1.25 m out, so that it is always there; with a ray that never meets the cylinder
// (straight up) it is 1.25 m along the ray). The window and the mat are real surfaces and win when they are nearer; the cylinder is the
// place of the cards, the plugs and the bus, which differ by millimetres, so there the given tests decide, plugs first, then the bus,
// then the cards. `hit` is { window: the window's yaw or null when the gaze is not on it, stage: the mat's frame or null, plug: a
// slot or null, bus: bool, card: a slot or null }. Null for a ray with a NaN in it.
export function gazeAt(ws, ray, hit) {
   if (!finiteRay(ray)) return null;
   const cyl = yawPitchOf(ws, ray);
   let t = cyl ? cyl.t : RADIUS, kind = hit.plug != null ? 'plug' : hit.bus ? 'bus' : hit.card != null ? 'card' : null;
   const win = hit.window != null ? busWindowHit(ws, hit.window, ray) : null;
   if (win && win.t < t) return { point: win.point, dist: win.t, kind: 'window' };
   const desk = hit.stage ? deskTrace(ray, hit.stage) : null;
   if (desk && desk.t < t) return { point: desk.point, dist: desk.t, kind: 'desk' };
   return { point: [ray.o[0] + ray.d[0] * t, ray.o[1] + ray.d[1] * t, ray.o[2] + ray.d[2] * t], dist: t, kind };
}
