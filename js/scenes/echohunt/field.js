// The sound field: where and when sounds left, and how loud they were.
// Voices are streams: their envelope is kept in a ring of 20 ms slots, one
// row per channel (player) and material, with that material's afterglow
// (peak hold with exponential release) and the raw transient. Short sounds
// (a click, a moth hitting the wall, the bell) are pulses with a fixed shape.
// A surface point at distance d from a source shows envelope(now - d / speed).
import { MATERIALS } from './room.js';

export const DT = .02, SLOTS = 128, HISTORY = (SLOTS - 2) * DT;   // about 2.5 s
export const CHANNELS = 4, MAX_SRC = 16, SPEED = 5;
const NMAT = MATERIALS.length, FABRIC = 2;

export class Field {
   constructor() {
      this.ring = new Float32Array(SLOTS * CHANNELS * NMAT * 4);
      this.glow = Array.from({ length: CHANNELS * NMAT }, () => [0, 0, 0]);
      this.queues = Array.from({ length: CHANNELS }, () => []);
      this.sources = Array.from({ length: CHANNELS }, () => []);
      this.pulses = [];
      this.lastSlot = -1;
      this.heard = [0, 0, 0, 0];   // the local voice in the newest slot
      this.out = [];               // local slots not yet sent
   }
   // Write every slot up to now. mic: the local voice now, [low, mid, high, transient].
   record(now, mic) {
      const cur = Math.floor(now / DT);
      if (this.lastSlot < 0) this.lastSlot = cur - 1;
      for (let s = this.lastSlot + 1; s <= cur; s++) {
         for (let c = 0; c < CHANNELS; c++) {
            const queue = this.queues[c];
            let q = queue.shift() || [0, 0, 0, 0];
            // A remote voice that fell behind plays two slots in one, keeping its peaks, until it catches up.
            if (c && queue.length > 10) { const r = queue.shift(); q = q.map((x, j) => Math.max(x, r[j])); }
            // The transient belongs to the first slot after a frame only.
            const v = c ? q : mic.map((x, j) => Math.max(j < 3 || s === this.lastSlot + 1 ? x : 0, q[j]));
            if (!c) { this.heard = v; this.out.push(v); }
            for (let k = 0; k < NMAT; k++) {
               const g = this.glow[c * NMAT + k], r = Math.exp(-DT / MATERIALS[k].decay);
               for (let b = 0; b < 3; b++) g[b] = Math.max(v[b], g[b] * r);
               this.ring.set([...g, v[3]], ((c * NMAT + k) * SLOTS + s % SLOTS) * 4);
            }
         }
      }
      // Clear the oldest slot, so filtering at the write head never blends in stale sound.
      const next = (cur + 1) % SLOTS;
      for (let r = 0; r < CHANNELS * NMAT; r++) this.ring.fill(0, (r * SLOTS + next) * 4, (r * SLOTS + next) * 4 + 4);
      this.lastSlot = cur;
      this.pulses = this.pulses.filter(p => p.end > now);
   }
   // Slots of a remote voice, played back in order from now on.
   push(c, slots) {
      const q = this.queues[c];
      q.push(...slots);
      if (q.length > 250) q.splice(0, q.length - 250);
   }
   // Where a voice leaves from: a new source whenever the mouth moves 20 cm or
   // turns 20 degrees, so waves already travelling keep their origin.
   track(c, now, mouth, facing) {
      const list = this.sources[c], last = list.at(-1);
      if (!last || dist(last.pos, mouth) > .2 || dot(last.facing, facing) < .94) list.push({ t0: now, pos: mouth, facing });
      while (list.length > 1 && list[1].t0 < now - HISTORY) list.shift();
   }
   // A short sound. bands: [low, mid, high]; dur: seconds at full strength; fall:
   // multiplies the distance falloff; wrap 1 lights surfaces from any side;
   // life: seconds it is drawn, short for a sound that only lights its surroundings.
   pulse(now, { pos, dir = [0, 0, 0], bands, strength = 1, dur = .03, fall = 1, wrap = 0, life = HISTORY }) {
      this.pulses.push({ t0: now, pos, dir, bands, strength, dur, fall, wrap, end: now + life });
   }
   // A sound of a kind drawn only max at a time, as each sound lit costs every
   // pixel it reaches: those that score highest (a moth's tap: the nearest; a
   // click: the newest). A new one takes the place of the lowest if it scores
   // higher. Returns whether it is drawn.
   capped(now, opts, kind, max, score) {
      const same = this.pulses.filter(p => p.kind === kind && p.end > now), mine = score(opts.pos, now);
      if (same.length >= max) {
         const low = same.reduce((a, b) => a.score < b.score ? a : b);
         if (mine <= low.score) return false;
         this.pulses.splice(this.pulses.indexOf(low), 1);
      }
      this.pulse(now, opts);
      Object.assign(this.pulses.at(-1), { kind, score: mine });
      return true;
   }
   // Loudest value of channel c between two times.
   energy(c, t0, t1, now) {
      let e = 0;
      for (let s = Math.max(0, Math.floor(t0 / DT), Math.floor((now - HISTORY) / DT)); s <= Math.min(Math.ceil(t1 / DT), Math.floor(now / DT)); s++)
         for (let k = 0; k < NMAT; k++) {
            const o = ((c * NMAT + k) * SLOTS + s % SLOTS) * 4;
            e = Math.max(e, this.ring[o], this.ring[o + 1], this.ring[o + 2], this.ring[o + 3]);
         }
      return e;
   }
   // The sources that still carry sound, newest first, as the shader takes them:
   // a: position, start; b: facing, end; c: bands, channel (-1 for a pulse);
   // d: strength, duration, falloff factor, wrap.
   live(now) {
      const out = [];
      for (let c = 0; c < CHANNELS; c++) {
         const list = this.sources[c];
         for (let i = list.length - 1; i >= 0; i--) {
            const s = list[i], t1 = list[i + 1]?.t0 ?? 1e9;
            if (this.energy(c, s.t0, Math.min(t1, now), now) > 1e-3)
               out.push({ a: [...s.pos, s.t0], b: [...s.facing, t1], c: [0, 0, 0, c], d: [1, 0, 1, 0] });
         }
      }
      for (let i = this.pulses.length - 1; i >= 0; i--) {
         const p = this.pulses[i];
         out.push({ a: [...p.pos, p.t0], b: [...p.dir, p.t0 + HISTORY], c: [...p.bands, -1], d: [p.strength, p.dur, p.fall, p.wrap] });
      }
      return out.slice(0, MAX_SRC);
   }
   // How loud the sound passing a point is now, from every side: what makes a moth show.
   // excess(a, p): the extra way (m) round things from a source at a to p, Infinity if none.
   intensityAt(p, now, sources, excess, falloff) {
      let sum = 0;
      for (const { a, b, c, d } of sources) {
         const ex = excess(a, p);
         if (ex === Infinity) continue;
         const straight = dist(a, p), dd = straight + ex, te = now - dd / SPEED;
         if (te < a[3] || te >= b[3] || now - te > HISTORY) continue;
         const facing = .5 + .5 * (b[0] * (p[0] - a[0]) + b[1] * (p[1] - a[1]) + b[2] * (p[2] - a[2])) / (straight || 1);
         const geo = (.25 + .75 * facing) / (1 + falloff * d[2] * dd * dd) * Math.exp(-ex / .5);
         let e;
         if (c[3] >= 0) {
            const s = Math.floor(te / DT) % SLOTS, o = ((c[3] * NMAT + FABRIC) * SLOTS + s) * 4;
            e = (this.ring[o] + this.ring[o + 1] + this.ring[o + 2]) / 3 + this.ring[o + 3];
         } else {
            const tau = te - a[3];
            e = d[0] * ((c[0] + c[1] + c[2]) / 3 * (tau < d[1] ? 1 : Math.exp(-(tau - d[1]) / .05)) + (tau < .04 ? 1 : 0));
         }
         sum += geo * e;
      }
      return sum;
   }
}

// [low, mid, high, transient] in 0..1 and pitch in Hz (0 if none) from an AnalyserNode.
export function listen(an, state, gate = -55) {
   const { time, freq } = state, rate = an.context.sampleRate;
   an.getFloatTimeDomainData(time); an.getFloatFrequencyData(freq);
   let sq = 0;
   for (const x of time) sq += x * x;
   const db = 10 * Math.log10(sq / time.length + 1e-12);
   // The noise floor (a headset's fan, the room) follows the quietest level:
   // down at once, up 0.05 dB a frame (about 3 dB a second). Only sound 10 dB above it counts, or the
   // room would glow faintly all the time, brightest at its edges.
   state.db = db;
   state.floor = Math.min(db, (state.floor ?? db) + .05);
   const level = Math.min(1, Math.max(0, (db - Math.max(gate, state.floor + 10)) / 40));
   const band = [0, 0, 0], hz = rate / an.fftSize;
   for (let i = 1; i < freq.length; i++) {
      const f = i * hz, p = 10 ** (freq[i] / 10);
      if (f >= 80 && f < 300) band[0] += p; else if (f >= 300 && f < 2000) band[1] += p; else if (f >= 2000 && f < 8000) band[2] += p;
   }
   const total = band[0] + band[1] + band[2] + 1e-20;
   const bands = [1.6, 2.5, 6].map((k, i) => level * Math.min(1, band[i] / total * k));
   const transient = Math.min(1, Math.max(0, level - state.slow) * 3);
   state.slow += (level - state.slow) * .15;
   // Pitch by autocorrelation, only when there is something to hear, and
   // only every 6th frame: it is the costliest part on a headset.
   if (level <= .15) state.pitch = 0;
   else if ((state.n = (state.n || 0) + 1) % 6 === 0) {
      let r0 = 0, best = 0, lag0 = 0;
      for (let i = 0; i < 1024; i++) r0 += time[i] * time[i];
      for (let lag = Math.floor(rate / 800); lag <= Math.ceil(rate / 70); lag++) {
         let r = 0;
         for (let i = 0; i < 1024; i++) r += time[i] * time[i + lag];
         if (r > best) { best = r; lag0 = lag; }
      }
      state.pitch = best / (r0 + 1e-12) > .6 ? rate / lag0 : 0;
   }
   return { bands: [...bands, transient], pitch: state.pitch || 0 };
}

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
