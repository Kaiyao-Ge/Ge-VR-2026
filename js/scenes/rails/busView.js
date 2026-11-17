// What the bus and the plugs of Rails look like, as pure numbers: no Clay, no DOM, no clock of its own (bus3d.js puts these in nodes and
// passes the time in). Model frame: metres, y up, yaw in radians relative to the workspace (positive to the right), as layout.js has it.
//
//  - the bus: one thin band across BUS.from..BUS.to degrees at BUS.y below the eye, on the cards' cylinder, as triangles (both faces);
//  - a card's connector: its plug at plugCell, a drop line from the plug and a dot at the end of it. Plugged, the line runs down to the bus
//    at the card's own yaw and the dot is solid, on the bus. Unplugged, the line hangs a short way and the dot is a hollow ring;
//  - the held plug (while a grab is in flight) has its drop line run to where the gaze meets the cylinder;
//  - the pulses: when a card publishes a variable (its `seq` grew), a short pulse runs along the bus from the connector of that card to
//    the connector of each card that takes the variable, at 1 m/s, in the variable's hue; at most 60 at once. An event always pulses,
//    and a stream of events on one route (less than 0.1 s apart) is one longer, brighter pulse; a state variable changes all the time,
//    so it pulses at most once per route every 0.3 s, and only when somebody takes it (an event nobody takes pulses in place). A device
//    (the clock, the gaze, the pointer) never pulses, and a card without a connector (unplugged, or gone) neither publishes nor takes.
// The pulses live in a fixed array and are reused: nothing is allocated after construction (but a message's route key).
import { BUS, SLOTS, RADIUS, cylPoint, plugWorld, yawPitchOf } from './layout.js';
import { rad, railHue } from './geom.js';
import { finite } from './values.js';

export const BUS_HALF = 0.01;                    // the band is 2 cm high
export const BUS_PIECES = 12;                    // 124 degrees in 12 straight pieces (the sag, 5 mm, is under the band's half height)
export const DROP_R = 0.0025;                    // the drop line is 5 mm thick
export const HANG = 0.035;                       // an unplugged plug's line hangs this far
export const PLUG_FRONT = 0.004, DOT_FRONT = 0.012, PULSE_FRONT = 0.006;      // how far in front of the cylinder (towards the user)
export const DOT_R = 0.012, RING_R = [0.007, 0.013];
export const PULSE_R = 0.014, PULSE_MIN = 0.02, PULSE_MAX = rad(10);
export const MAX_PULSES = 60, PULSE_SPEED = 1, PULSE_FADE = 0.3, MERGE_S = 0.1, STATE_EVERY = 0.3;

// ---- meshes (vertices [x, y, z, nx, ny, nz], three to a triangle) ----

// The bus: a band along the arc, both faces (culling is on in Clay, and the band is seen from either side while the person leans).
export function busRibbon(ws) {
   const out = [], pts = [];
   for (let k = 0; k <= BUS_PIECES; k++) pts.push(cylPoint(ws, rad(BUS.from + (BUS.to - BUS.from) * k / BUS_PIECES), BUS.y));
   for (let k = 0; k + 1 < pts.length; k++) {
      const a = pts[k], b = pts[k + 1], mx = (a[0] + b[0]) / 2 - ws.origin[0], mz = (a[2] + b[2]) / 2 - ws.origin[2], l = Math.hypot(mx, mz) || 1;
      const n = [-mx / l, 0, -mz / l], m = [-n[0], 0, -n[2]];
      const lo0 = [a[0], a[1] - BUS_HALF, a[2]], hi0 = [a[0], a[1] + BUS_HALF, a[2]], lo1 = [b[0], b[1] - BUS_HALF, b[2]], hi1 = [b[0], b[1] + BUS_HALF, b[2]];
      for (const [v, nor] of [[[lo0, lo1, hi1, lo0, hi1, hi0], n], [[lo0, hi1, lo1, lo0, hi0, hi1], m]]) for (const p of v) out.push([...p, ...nor]);
   }
   return out;
}

// The shapes below are in the frame of a node (x right, y up, z towards the user), both faces.
const face = (corners, out) => {
   for (const [idx, z] of [[[0, 1, 2, 0, 2, 3], 1], [[0, 2, 1, 0, 3, 2], -1]]) for (const k of idx) out.push([corners[k][0], corners[k][1], 0, 0, 0, z]);
};
const rect = (x0, y0, x1, y1, out) => face([[x0, y0], [x1, y0], [x1, y1], [x0, y1]], out);

// A plug: a body 3.2 x 1.6 cm and two prongs pointing down at the line.
export function plugTriangles() {
   const out = [];
   rect(-0.016, -0.008, 0.016, 0.008, out);
   rect(-0.008, -0.016, -0.004, -0.008, out); rect(0.004, -0.016, 0.008, -0.008, out);
   return out;
}

// A solid dot and a ring (`r` = [inner, outer]), as 12-gons.
const SIDES = 12;
const onCircle = (r, k) => [r * Math.cos(2 * Math.PI * k / SIDES), r * Math.sin(2 * Math.PI * k / SIDES)];
export function discTriangles(r) {
   const out = [];
   for (let k = 0; k < SIDES; k++) {
      const a = onCircle(r, k), b = onCircle(r, k + 1);
      for (const [p, z] of [[[[0, 0], a, b], 1], [[[0, 0], b, a], -1]]) for (const v of p) out.push([v[0], v[1], 0, 0, 0, z]);
   }
   return out;
}
export function ringTriangles(inner, outer) {
   const out = [];
   for (let k = 0; k < SIDES; k++) face([onCircle(inner, k), onCircle(outer, k), onCircle(outer, k + 1), onCircle(inner, k + 1)], out);
   return out;
}

// ---- the connectors ----

// A card's connector for `slot`: { plug, line: [from, to], dot } as world points. Null for a slot that does not exist.
export function connectorOf(ws, slot, plugged) {
   if (!Number.isInteger(slot) || slot < 0 || slot >= SLOTS.length) return null;
   const plug = plugWorld(ws, slot), end = plugged ? cylPoint(ws, rad(SLOTS[slot]), BUS.y) : [plug[0], plug[1] - HANG, plug[2]];
   return { plug, line: [plug, end], dot: end };
}

// Where the held plug's line ends: the gaze on the cylinder, { end, yaw, height } (yaw relative to the workspace, height above the eye), or null.
export function heldEnd(ws, ray) {
   const h = yawPitchOf(ws, ray);
   return h && { end: cylPoint(ws, h.yaw, h.height), yaw: h.yaw, height: h.height };
}

// ---- colour ----

// The hue of a variable: the same hash as the card's bindings (hsl(h, 75%, 62%)), as [r, g, b] in 0..1.
export function hueRgb(variable) {
   const h = railHue(variable), s = 0.75, l = 0.62, a = s * Math.min(l, 1 - l);
   const f = n => { const k = (n + h / 30) % 12; return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); };
   return [f(0), f(8), f(4)];
}

// ---- the pulses ----

export class Pulses {
   constructor() {
      this.serial = 0;                  // counts the pulses made, so that a node can tell a new pulse in its slot
      this.slots = Array.from({ length: MAX_PULSES }, () => ({ alive: false, serial: 0, route: '', variable: '', from: 0, to: 0, born: 0, last: 0, count: 0, head: 0, tail: 0, alpha: 0 }));
      this.seen = new Map();            // variable -> the seq already looked at
   }

   get alive() { let n = 0; for (const p of this.slots) if (p.alive) n++; return n; }

   // A variable looked at. When it has messages newer than the last look (the first look sees none: a page that has just come does not
   // replay the old ones), a pulse for each taker. `yawOf(card)` gives the yaw of a card's connector, or null when it has none.
   observe(variable, rail, yawOf, t) {
      if (!rail || !finite(rail.seq)) { this.seen.delete(variable); return; }
      const prev = this.seen.get(variable);
      this.seen.set(variable, rail.seq);
      if (prev === undefined || !(rail.seq > prev)) return;
      const pubs = Array.isArray(rail.pubs) ? rail.pubs : [], subs = Array.isArray(rail.subs) ? rail.subs : [], tail = Array.isArray(rail.tail) ? rail.tail : [];
      const start = card => typeof card !== 'string' || card.startsWith('dev:') ? null : yawOf(card);
      let from = null;
      for (let i = tail.length - 1; i >= 0 && from === null; i--) {
         const by = tail[i] && tail[i].seq > prev && typeof tail[i].by === 'string' ? tail[i].by.replace(/^mod:/, '') : null;
         if (by) from = start(by.slice(0, by.lastIndexOf('.')));
      }
      for (let i = 0; i < pubs.length && from === null; i++) from = start(Array.isArray(pubs[i]) ? pubs[i][0] : null);
      if (from === null) return;
      const n = rail.seq - prev, event = rail.kind === 'event';
      let any = false;
      for (const s of subs) {
         const card = Array.isArray(s) ? s[0] : null, to = typeof card === 'string' ? yawOf(card) : null;
         if (to !== null) { this._add(variable, `${variable}|${card}`, from, to, t, n, event); any = true; }
      }
      if (!any && event) this._add(variable, `${variable}|`, from, from, t, n, event);
   }

   _add(variable, route, from, to, t, n, event) {
      let slot = null, oldest = null;
      for (const p of this.slots) {
         if (p.alive && p.route === route && p.from === from && p.to === to) {
            if (!event) { if (t - p.born < STATE_EVERY) return; }                 // a state variable: one pulse per route in 0.3 s
            else if (t - p.last < MERGE_S) { p.last = t; p.count += n; return; }
         }
         if (!p.alive) slot = slot || p;
         else if (!oldest || p.born < oldest.born) oldest = p;
      }
      Object.assign(slot || oldest, { alive: true, serial: ++this.serial, route, variable, from, to, born: t, last: t, count: n, head: from, tail: from, alpha: 1 });
   }

   // Moves every pulse to its place at time t (`head` and `tail` yaws, `alpha`) and retires the ones that have faded.
   step(t) {
      for (const p of this.slots) {
         if (!p.alive) continue;
         const dist = Math.abs(p.to - p.from), dir = p.to >= p.from ? 1 : -1;
         const h = PULSE_SPEED * (t - p.born) / RADIUS, k = PULSE_SPEED * (t - p.last) / RADIUS;
         p.head = h >= dist ? p.to : p.from + dir * h;
         p.tail = k >= dist ? p.to : p.from + dir * k;
         const doneAt = p.last + dist * RADIUS / PULSE_SPEED, level = Math.min(1, 0.7 + 0.03 * (p.count - 1));
         p.alpha = t <= doneAt ? level : Math.max(0, 1 - (t - doneAt) / PULSE_FADE) * level;
         if (t > doneAt + PULSE_FADE) p.alive = false;
      }
   }
}
