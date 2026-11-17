// The tape of the Rails bus: the last 30 seconds of what travelled on it, kept so the user can pause and
// scrub back to see past rail values. The recorder hooks one Bus (onOp, onStep) and is always on; it never
// touches the bus's behaviour. The log is a list of segments, one per second of bus time:
//    { snap, frames: [{ n, t, ops }] }          (plus `ops`, a count, `born`, `inbox` and `sources`, see below)
// `snap` is bus.snapshot() taken right before the segment's first step, so it contains everything that happened
// before the first frame and every frame has n > snap.n (a replay starts from a complete world and never counts
// anything twice). The recorder takes it in bus.onBeforeStep(), which runs before the step applies anything. `ops` are the bus's own op objects, kept by reference (their values are already frozen
// by the bus), in delivery order. Trimming drops whole segments, so the oldest retained frame always has
// a snapshot before it; the window never exceeds `window` seconds, and the op cap shrinks it further.
// Reading the tape back (rails at a time, density) lives in replay.js.
import { DT } from './bus.js';
import { keyOf } from './lifecycle.js';

export const FRAMES_PER_SEGMENT = 60;       // one second of bus time
export const WINDOW = 30;                   // seconds kept
export const MAX_OPS = 100000;              // ops kept over all segments

// A snapshot must never make the recorder throw: a bus that cannot snapshot records an empty world.
function safeSnapshot(bus) {
   try { return bus.snapshot(); } catch (err) { return { n: bus.n, t: bus.t, rails: {}, modules: {}, docks: [], devices: {} }; }
}

export class Recorder {
   constructor(bus, { window = WINDOW, maxOps = MAX_OPS } = {}) {
      this.bus = bus;
      this.window = window;
      this.maxOps = maxOps;
      this.segments = [];                   // oldest first; every segment has at least one frame
      this.dropped = 0;                     // segments dropped, whether aged out of the window or by the op cap
      this.capped = 0;                      // of those, the ones dropped because of the op cap (the window shrank)
      this.opCount = 0;                     // ops over all retained segments
      this.dirs = new Map();                // 'owner.port' -> 'in' | 'out', as ports were when they were docked
      this._lastN = bus.n;                  // the n of the last step seen; ops with a larger n belong to the next step
      this._pending = [];                   // ops of the step in progress, which become its frame
      for (const [id, d] of bus.devices) for (const p of d.ports) this._noteDir(`dev:${id}`, p);
      for (const [id, m] of bus.modules) for (const p of m.ports) this._noteDir(`mod:${id}`, p);
      this._unhook = [bus.onOp(op => this._onOp(op)), bus.onBeforeStep(() => this._before()), bus.onStep(s => this._onStep(s))];
   }

   // Stops recording; what was recorded stays readable.
   dispose() { for (const off of this._unhook) off(); this._unhook = []; }

   // The retained window: from the first snapshot to the last frame, with the number of frames and ops.
   range() {
      const segs = this.segments, base = { dropped: this.dropped, capped: this.capped };
      if (!segs.length) return { t0: this.bus.t, t1: this.bus.t, frames: 0, ops: 0, ...base };
      const last = segs[segs.length - 1].frames;
      let frames = 0;
      for (const s of segs) frames += s.frames.length;
      return { t0: segs[0].snap.t, t1: last[last.length - 1].t, frames, ops: this.opCount, ...base };
   }

   // Every op of the frames with t0 <= t <= t1, in delivery order.
   opsBetween(t0, t1) {
      const out = [];
      for (const s of this.segments) {
         if (s.frames[s.frames.length - 1].t < t0 - 1e-9) continue;
         if (s.frames[0].t > t1 + 1e-9) break;
         for (const f of s.frames) if (f.t >= t0 - 1e-9 && f.t <= t1 + 1e-9) for (const op of f.ops) out.push(op);
      }
      return out;
   }

   // The index of the segment that holds time t: the one whose snapshot is at or before t, where a time exactly
   // on a boundary belongs to the segment that ends there. Times outside the window clamp to its ends.
   segmentIndexAt(t) {
      const segs = this.segments;
      for (let i = 0; i < segs.length; i++) {
         const last = segs[i].frames[segs[i].frames.length - 1];
         if (t <= last.t + 1e-9) return i;
      }
      return segs.length - 1;
   }

   // ---- hooks ----

   // Runs just before each step of a running bus. Here a segment starts when the last one is full, from a snapshot
   // that holds every change made since, whether or not it logged an op (a module without a clock input, say).
   // A bus whose n moved by itself (a restore) starts a new history.
   _before() {
      const bus = this.bus;
      if (bus.n !== this._lastN) { this.segments = []; this.opCount = 0; this._pending = []; this._lastN = bus.n; }
      const segs = this.segments, last = segs[segs.length - 1];
      if (last && last.frames.length < FRAMES_PER_SEGMENT) return;
      // What a snapshot does not hold, so that a replay can start from it exactly: `inbox`, the messages waiting for delivery (a loop
      // that was cut at the last pass, a message to a card's input docked between steps that is still to be handed the rail's
      // value: { to: 'mod:card.port' }), and `sources`, the text of every module as it runs now (the reloads after it are on the tape).
      const inbox = bus.inbox.map(m => (m.to ? { to: keyOf(m.to) } : { rail: m.rail, kind: m.kind, v: m.v, by: m.by }));
      const sources = {};
      for (const [id, m] of bus.modules) sources[id] = m.source;
      segs.push({ snap: safeSnapshot(bus), frames: [], ops: 0, born: {}, inbox, sources });
   }

   _onOp(op) {
      this._noteDirOf(op);
      if (op.k === 'dock' && this.segments.length) this._noteRail(this.segments[this.segments.length - 1], op.rail);   // the rail is there now, and may be swept before the step ends
      if (op.n > this._lastN) { this._pending.push(op); return; }       // inside the step about to be closed
      // Between steps (a module added, a dock made now): it joins the last frame. With no segment yet it joins
      // no frame: the snapshot taken at the next step already contains what it did.
      const segs = this.segments, seg = segs[segs.length - 1];
      if (!seg) return;
      seg.frames[seg.frames.length - 1].ops.push(op);
      this._count(1);
   }

   _onStep({ n, t }) {
      const seg = this.segments[this.segments.length - 1];
      if (!seg) return;
      this._lastN = n;
      seg.frames.push({ n, t, ops: this._pending });
      this._count(this._pending.length);
      this._noteBorn(seg, this._pending);
      this._pending = [];
      this._trim();
   }

   // ---- internals ----

   _count(k) {
      this.opCount += k;
      this.segments[this.segments.length - 1].ops += k;
   }

   // `born` holds rails the snapshot did not know, so the tape can tell their kind and type (a rail added
   // mid-segment logs no op of its own). A rail is noted when a message is delivered to it and when a port is docked to it
   // (_onOp): a variable can be made, docked and swept inside the window, and the replay has to
   // know what it was.
   _noteBorn(seg, ops) {
      for (const op of ops) if (op.k === 'pub') this._noteRail(seg, op.rail);
   }

   _noteRail(seg, id) {
      if (seg.snap.rails[id] || seg.born[id]) return;
      const r = this.bus.rails.get(id);
      if (r) seg.born[id] = { kind: r.kind, type: r.type };
   }

   // The tape cannot see a port's direction in a dock op, so it is noted when the port is docked or its module reloaded.
   _noteDirOf(op) {
      if (op.k === 'dock' || op.k === 'undock') {
         const list = op.owner.startsWith('dev:') ? this.bus.devices.get(op.owner.slice(4)) : this.bus.modules.get(op.owner.slice(4));
         for (const p of list ? list.ports : []) if (p.name === op.port) this._noteDir(op.owner, p);
      } else if (op.k === 'reload') {
         const m = this.bus.modules.get(op.mod);
         for (const p of m ? m.ports : []) this._noteDir(`mod:${op.mod}`, p);
      }
   }

   _noteDir(owner, p) { this.dirs.set(`${owner}.${p.name}`, p.dir); }

   _trim() {
      const segs = this.segments, span = Math.round(this.window / DT);
      while (segs.length > 1 && this._lastN - segs[0].snap.n > span) { this.opCount -= segs.shift().ops; this.dropped++; }
      while (segs.length > 1 && this.opCount > this.maxOps) { this.opCount -= segs.shift().ops; this.dropped++; this.capped++; }
   }
}
