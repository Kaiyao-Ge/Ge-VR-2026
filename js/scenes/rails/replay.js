// Reading the tape back: what was on the rails at a past time, and how busy the tape was (railsAt and density, pure
// functions of a Recorder's segments, which never touch the live bus), and the replay world at the end, which runs every
// module again, in a bus of its own, up to a past time, so that what the modules drew then can be shown.
import { Bus, DT, MAX_PASSES } from './bus.js';
import { bindingKey } from './values.js';

export const RECENT = 8;                    // messages kept per rail in `recent`

// The rails as they were at bus time t, as {railId: {kind, type, value, by, seq, stale, recent}}.
//   state rail: `value` is the last delivered value at or before t (undefined when nothing was delivered yet);
//   event rail: `value` stays undefined and `recent` holds the latest <= 8 messages [{t, v, by}] at or before t
//               within the window, oldest first; a state rail's `recent` is [];
//   `by` and `seq` are as logged: the last publisher and the number of deliveries so far;
//   `stale` (state rails) is as the bus had it: set when the rail lost its last living publisher (an undock, a
//   quarantine), cleared by a delivery from a living publisher.
// A time outside the window clamps to its ends; an empty tape gives {}. Rails keep the id they were logged with.
export function railsAt(recorder, t) {
   const si = recorder.segmentIndexAt(t);
   if (si < 0) return {};
   const seg = recorder.segments[si], out = {};
   for (const [id, r] of Object.entries(seg.snap.rails)) out[id] = { kind: r.kind, type: r.type, value: r.value, by: r.by, seq: r.seq, stale: !!r.stale, recent: [] };
   const end = lastFrameAt(seg, t), life = lifeOf(recorder, seg);
   for (let i = 0; i <= end; i++) for (const op of seg.frames[i].ops) apply(out, seg, life, op);
   collectRecent(recorder, out, si, end, t);
   return out;
}

// The pub counts per bin over the whole window (t0, t1], `bins` bins of equal width. The sum is the number
// of deliveries in the window. An empty tape, or a window with no frames, gives all zeros. Scanning every op is the cost,
// so the answer is kept until the tape can have changed: it grows with a step of the bus and shrinks by whole segments.
const DENSITIES = new WeakMap();      // recorder -> { key, out }

export function density(recorder, bins = 60) {
   if (!(bins >= 1)) return [];
   const key = `${bins}|${recorder.bus.n}|${recorder.dropped}|${recorder.segments.length}`, kept = DENSITIES.get(recorder);
   if (kept && kept.key === key) return kept.out.slice();
   const out = scanDensity(recorder, bins);
   DENSITIES.set(recorder, { key, out });
   return out.slice();
}

function scanDensity(recorder, bins) {
   const out = new Array(bins).fill(0), segs = recorder.segments;
   if (!segs.length) return out;
   const n0 = segs[0].snap.n, last = segs[segs.length - 1].frames, span = last[last.length - 1].n - n0;
   if (!(span > 0)) return out;
   for (const seg of segs) {
      for (const f of seg.frames) {
         let k = 0;
         for (const op of f.ops) if (op.k === 'pub') k++;
         // Integer arithmetic, so a frame exactly on a bin's upper edge lands in that bin and never the next.
         if (k) out[Math.min(bins - 1, Math.max(0, Math.ceil((f.n - n0) * bins / span) - 1))] += k;
      }
   }
   return out;
}

// The index of the last frame of the segment with t <= `t`, or -1 when t is before its first frame.
function lastFrameAt(seg, t) {
   let i = seg.frames.length - 1;
   while (i >= 0 && seg.frames[i].t > t + 1e-9) i--;
   return i;
}

// Who publishes to which rail and which modules are dead, as the segment's snapshot had it, then kept up to date
// by dock, undock, reload and quarantine ops. Port directions come from what the recorder noted when it logged.
function lifeOf(recorder, seg) {
   const pubs = new Map(), dead = new Set();
   for (const [id, m] of Object.entries(seg.snap.modules)) if (m.status !== 'ok') dead.add(id);
   const life = { pubs, dead, out: key => recorder.dirs.get(key) === 'out' };
   for (const [owner, port, rail] of seg.snap.docks) if (life.out(`${owner}.${port}`)) addPub(pubs, rail, `${owner}.${port}`);
   return life;
}

function addPub(pubs, rail, key) { if (!pubs.has(rail)) pubs.set(rail, new Set()); pubs.get(rail).add(key); }
const modOf = key => (key && key.startsWith('mod:') ? key.slice(4, key.indexOf('.')) : null);
const alive = (life, key) => !life.dead.has(modOf(key));
const hasLivingPublisher = (life, rail) => [...(life.pubs.get(rail) || [])].some(k => alive(life, k));

// One logged op applied to the rails. A delivery updates the last publisher and the count, a state rail's value, and
// clears staleness unless its publisher is dead. A rail the snapshot did not know comes from the segment's `born`
// table; with no record at all it is taken to be a state rail.
function apply(out, seg, life, op) {
   switch (op.k) {
      case 'pub': return deliver(out, seg, life, op);
      // A variable comes and goes: made fresh (seq 0, nothing delivered), then possibly swept.
      case 'rail': out[op.id] = { kind: op.kind, type: op.type, value: undefined, by: null, seq: 0, stale: false, recent: [] }; life.pubs.delete(op.id); return;
      case 'unrail': delete out[op.id]; life.pubs.delete(op.id); return;
      case 'dock': { const key = `${op.owner}.${op.port}`; if (life.out(key)) addPub(life.pubs, op.rail, key); return; }
      case 'undock': {
         const key = `${op.owner}.${op.port}`, set = life.pubs.get(op.rail);
         if (set && set.delete(key)) staleIfDead(out, life, op.rail);
         return;
      }
      case 'quarantine': life.dead.add(op.mod); for (const id of life.pubs.keys()) staleIfDead(out, life, id); return;
      case 'reload':
         life.dead.delete(op.mod);
         for (const [id, set] of life.pubs) if ([...set].some(k => modOf(k) === op.mod) && out[id] && out[id].kind === 'state' && out[id].value !== undefined) out[id].stale = !hasLivingPublisher(life, id);
         return;
   }
}

function staleIfDead(out, life, rail) {
   const r = out[rail];
   if (r && r.kind === 'state' && r.value !== undefined && !hasLivingPublisher(life, rail)) r.stale = true;
}

function deliver(out, seg, life, op) {
   let r = out[op.rail];
   if (!r) {
      const b = seg.born[op.rail];
      r = out[op.rail] = { kind: b ? b.kind : 'state', type: b ? b.type : 'any', value: undefined, by: null, seq: 0, stale: false, recent: [] };
   }
   r.seq++; r.by = op.by;
   if (r.kind === 'state') { r.value = op.v; r.stale = !alive(life, op.by); }
}

// The latest RECENT messages of each event rail at or before t, walking back from the frame `end` of segment `si`
// through older segments, and stopping as soon as every event rail has enough.
function collectRecent(recorder, out, si, end, t) {
   const open = new Set(Object.keys(out).filter(id => out[id].kind === 'event'));
   for (let s = si; s >= 0 && open.size; s--) {
      const frames = recorder.segments[s].frames;
      for (let i = s === si ? end : frames.length - 1; i >= 0 && open.size; i--) {
         const ops = frames[i].ops;
         for (let j = ops.length - 1; j >= 0; j--) {
            const op = ops[j];
            if (op.k === 'rail') { open.delete(op.id); continue; }       // what was said before the variable was made belongs to an earlier one
            const r = op.k === 'pub' && open.has(op.rail) && out[op.rail];       // (a rail that is closed has all it needs, or began after this)
            if (!r || r.kind !== 'event' || r.recent.length >= RECENT) continue;
            r.recent.unshift({ t: frames[i].t, v: op.v, by: op.by });
            if (r.recent.length >= RECENT) open.delete(op.rail);
         }
      }
   }
}

// ---- the replay world ----

const NONE = [];

// The world as it was at a past time, worked out by running it again. The tape has the rails but not the pictures, and a module's
// picture is a function of what it heard, so the replay runs every module (a private manual bus, restored from the snapshot at the
// start of the segment that holds the time, then stepped frame by frame) and takes what the tape cannot give from it: the draw lists,
// and, for "continue from here", the data of the world (module state, variable values, device values).
//   - Fed from the tape: only what comes from outside the modules, the device messages, in the pass where the live bus delivered
//     them (Bus.feed). Everything else the modules say themselves, so it comes out the same, loops and all.
//   - Applied from the tape at the step where it happened: dock, undock, rail, unrail (a manual bus has no wiring of its own), use and
//     plug (kept so that the world can be made live again), and the module ops: a reload or a card added (the source is on the tape),
//     removed or renamed. What is done between two steps (a card added) is on the tape after the last message of the frame; it is
//     applied at the start of the next step, as it was lived.
//   - What the replay cannot know: what a module keeps outside state() (a variable of its own, say) is not in a snapshot, so a replay
//     that starts from one begins it afresh, as a restarted Worker would.
// `at(t)` moves the world to the step of time t: forward from where it is when that is nearer than the segment's snapshot, else from
// the snapshot, so it never runs more than one segment (60 steps). A failure sets `problem` (and `bus` is then null); it is kept until
// the replay is dropped.
export class Replay {
   constructor(recorder) {
      this.recorder = recorder;
      this.bus = null;
      this.problem = null;
      this.dev = {};                               // device -> port -> its last value, which the replay bus does not hold (see _start)
      this._s = 0; this._f = 0;                    // the next frame to run: segment and frame index
      this._held = [];                             // structure ops of the last frame that belong to the start of the next step
      this._kinds = new Map();                     // rail -> its kind, as the replay bus will have it once its queue is applied
      this._fed = Array.from({ length: MAX_PASSES }, () => []);
      this._feed = { last: -1, at: p => this._fed[p] };
   }

   at(t) {
      if (this.problem) return false;
      try {
         const rec = this.recorder, si = rec.segmentIndexAt(t);
         if (si < 0) return this._fail('nothing is recorded yet');
         const seg = rec.segments[si], snapN = seg.snap.n, last = seg.frames[seg.frames.length - 1].n;
         const want = Math.min(last, Math.max(snapN, Math.floor(t / DT + 1e-6)));
         if (!this.bus || this.bus.n < snapN || this.bus.n > want) { if (!this._start(si)) return false; }
         while (this.bus.n < want) if (!this._step()) return false;
         return true;
      } catch (err) { return this._fail(String(err && err.message || err)); }
   }

   // The bus's snapshot at the step reached; the device values are the replay's (the bus holds none, so that a dock does not hand out a
   // value that the tape already has). The runtime takes the data of the world from it (see Runtime._pastWorld).
   snapshot() {
      const s = this.bus.snapshot();
      s.devices = { ...s.devices };
      for (const [id, ports] of Object.entries(this.dev)) s.devices[id] = { ...ports };
      return s;
   }

   _fail(why) { this.problem = why; this.bus = null; return false; }

   _start(si) {
      const rec = this.recorder, live = rec.bus, seg = rec.segments[si], snap = seg.snap;
      const bus = new Bus({ seed: live.seed, auto: false });
      for (const [id, d] of live.devices) if (id !== 'clock') bus.addDevice({ id, outputs: Object.fromEntries(d.ports.map(p => [p.name, { kind: p.kind, type: p.type }])) });
      const r = bus.restoreSnapshot({ ...snap, devices: {} }, { modules: seg.sources });
      if (!r.ok) return this._fail((r.errors && r.errors[0] && r.errors[0].message) || r.reason || 'the world could not be built');
      bus.undock('dev:clock', 'time');             // the tape brings the clock, in its place among the messages
      bus.clockRail = live.clockRail;              // and its rail is the tape's (the private bus has a rail of its own called clock): a new subscriber is handed no retained tick
      for (const item of seg.inbox) {
         if (item.to) { const dot = item.to.indexOf('.'); bus.resend(item.to.slice(0, dot), item.to.slice(dot + 1)); }
         else bus.inbox.push({ rail: item.rail, kind: item.kind, v: item.v, by: item.by, to: null });
      }
      bus.feed = this._feed;
      this.dev = {};
      for (const [id, ports] of Object.entries(snap.devices || {})) if (id !== 'clock') this.dev[id] = { ...ports };
      this._kinds = new Map([...bus.rails].map(([id, rail]) => [id, rail.kind]));
      this._held.length = 0; this._s = si; this._f = 0;
      this.bus = bus;
      return true;
   }

   // One tape frame: the structure ops of its start go in, the device messages are handed over per pass, and the bus steps.
   _step() {
      const segs = this.recorder.segments;
      let seg = segs[this._s];
      if (this._f >= seg.frames.length) { seg = segs[++this._s]; this._f = 0; if (!seg) return this._fail('the replay ran past the end of the tape'); }
      const ops = seg.frames[this._f++].ops, fed = this._fed;
      for (const op of this._held) this._apply(op, seg);
      this._held.length = 0;
      let i = 0;
      for (; i < ops.length && ops[i].k !== 'pub' && ops[i].k !== 'quarantine'; i++) this._apply(ops[i], seg);
      if (!this.bus) return false;                 // a module could not be made again
      for (const list of fed) list.length = 0;
      let last = -1;
      for (; i < ops.length; i++) {
         const op = ops[i];
         if (op.k === 'pub') {
            if (!op.by.startsWith('dev:')) continue;
            const kind = this._know(op.rail, seg), dot = op.by.indexOf('.'), id = op.by.slice(4, dot);
            fed[op.p].push({ rail: op.rail, kind, v: op.v, by: op.by, to: null });
            if (op.p > last) last = op.p;
            if (kind === 'state' && id !== 'clock') (this.dev[id] ||= {})[op.by.slice(dot + 1)] = op.v;
         } else if (op.k !== 'quarantine') this._held.push(op);      // after the deliveries: it was done between steps
      }
      this._feed.last = last;
      this.bus.step();
      return true;
   }

   // One structure op of the tape. The bus's queue is used directly: the ops happened once, so they need no checking, and one for a
   // port or a module that this world does not have does nothing.
   _apply(op, seg) {
      const bus = this.bus;
      switch (op.k) {
         case 'rail': case 'unrail':
            // A variable was swept, or made (again): the same here, so what was in flight to the old one is gone.
            if (this._kinds.has(op.id)) { bus.queue.push({ k: 'removeRail', id: op.id }); this._kinds.delete(op.id); }
            if (op.k === 'rail') { bus.queue.push({ k: 'addRail', id: op.id, kind: op.kind, type: op.type }); this._kinds.set(op.id, op.kind); }
            return;
         case 'dock': this._know(op.rail, seg); bus.queue.push({ k: 'dock', owner: op.owner, port: op.port, rail: op.rail }); return;
         case 'undock': bus.queue.push({ k: 'undock', owner: op.owner, port: op.port }); return;
         case 'use': { const key = bindingKey(op.card, op.port); if (op.variable === null) delete bus.uses[key]; else bus.uses[key] = op.variable; return; }
         case 'plug': if (op.on) bus.unplugged.delete(op.card); else bus.unplugged.add(op.card); return;
         case 'removeModule': bus.queue.push({ k: 'removeModule', id: op.id }); return;
         case 'renameModule': bus.queue.push({ k: 'renameModule', id: op.id, to: op.to }); return;
         case 'addModule': case 'reload': {
            const r = op.k === 'reload' ? (bus.modules.has(op.mod) ? bus.reload(op.mod, op.source, { resetState: op.resetState === true }) : { ok: true }) : bus.addModule(op.id, op.source);
            if (!r.ok) this._fail(`could not make '${op.k === 'reload' ? op.mod : op.id}' again (${op.k}): ${r.reason || (r.error && r.error.message) || 'refused'}`);
         }
      }
   }

   // The kind of a rail; a rail the replay bus does not have yet (a manual bus logs no op when one is added, and the snapshot is from before)
   // is made first, with the kind and type that the tape or else the live bus knows.
   _know(id, seg) {
      if (!this._kinds.has(id)) {
         const b = seg.born[id] || seg.snap.rails[id] || this.recorder.bus.rails.get(id) || { kind: 'state', type: 'any' };
         this.bus.queue.push({ k: 'addRail', id, kind: b.kind, type: b.type });
         this._kinds.set(id, b.kind);
      }
      return this._kinds.get(id);
   }
}
