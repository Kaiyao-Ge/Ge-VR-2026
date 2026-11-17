// The snapshots of the runtime (runtime.js), pure and without graphics: what the laptop tells the headset about itself, and
// what it remembers of what it has told.
//
// Snapshots are incremental, because the headset keeps what it has (see wire.js, `snap`): a rail is sent when its
// seq, staleness, contest or docks changed (and all of them every 60th call, that is every 2 s at 30 Hz, so a lost
// message heals; then also the modules whose `calls` moved), a module when its rev or ports changed, and its source only
// when its ver is new. The whole message has a budget of 200 KB of JSON (the wire drops anything over 256 KB): the header
// always goes, rails and modules follow while they fit, and one that does not fit is left out and not marked as sent, so
// it comes in a later snapshot (see snapshot() for how nothing starves). At most 128 KB of source go out in one snapshot;
// a source whose JSON alone is over 140 KB is never synced (a notice says so). A snapshot carries a module's last 20
// log lines and an event rail's last 8 messages; the runtime keeps more. full() forgets what was sent, so the next
// snapshots carry everything.
// While the runtime is paused before the end of the tape, a module's `draw` is the replay's (replay.js), the picture it had at the playhead
// (a module the replay does not have, one added since, draws nothing); the rest of a module, and every rail, are as before.
//
// createSnapshotter(rt) reads the runtime it belongs to (bus, recorder, geometry, playhead, past) and keeps its own state.
import { isObject } from './values.js';
import { railsAt, density } from './replay.js';
import { notice } from './lifecycle.js';

export const SOURCE_CAP = 128 * 1024;       // characters of source (as JSON) in one snapshot
export const FULL_EVERY = 60;               // every this many snapshot() calls, everything is sent again
export const BUDGET = 200 * 1024;           // characters of JSON in one snapshot message (the wire allows 256 KB)
export const LOGS_SENT = 20;                // log lines per module in a snapshot (the runtime keeps 50)
export const TAIL_SENT = 8;                 // messages per rail tail in a snapshot (the bus keeps 32)
const ENVELOPE_ROOM = 1024;                 // what the message's own envelope may take
const OVERSIZE_SOURCE = 140 * 1024;         // a source whose JSON is longer than this is never synced
const DENSITY_BINS = 60;
const NO_DRAW = Object.freeze([]);          // what a module that did not exist at the playhead draws

// Numbers in a draw list are rounded to 4 decimals (0.1 mm on the mat), which keeps a snapshot small and hides float noise.
const round = x => Math.round(x * 1e4) / 1e4;
function rounded(v) {
   if (typeof v === 'number') return round(v);
   if (Array.isArray(v)) return v.map(rounded);
   if (isObject(v)) { const o = {}; for (const k of Object.keys(v)) o[k] = rounded(v[k]); return o; }
   return v;
}

// The ids starting at `from` (when it is one of them) and wrapping round.
function rotated(ids, from) {
   const i = ids.indexOf(from);
   return i > 0 ? [...ids.slice(i), ...ids.slice(0, i)] : ids;
}

// A scrubbed event rail's latest messages as the tail the live rail would show: consecutive deliveries, newest last.
function tailOf(t) {
   return t.recent.map((m, i) => ({ seq: t.seq - (t.recent.length - 1 - i), t: m.t, v: m.v, by: m.by }));
}

export function createSnapshotter(rt) {
   const bus = rt.bus;
   let calls = 0;                                   // snapshot() calls since the last full()
   let sent = { rails: new Map(), modules: new Map() };
   let lead = 'rails';                              // the class that goes first in the next snapshot
   let cursor = { rails: null, modules: null };     // where each class starts: the first item left out last time
   const costs = new Map();                         // module id -> { source, cost }: its source's JSON length
   const big = new Map();                           // module id -> the source that is too large to sync
   let view = null;                                 // the tape's rails at the playhead, cached while the bus is frozen

   // Forgets what was sent, so the next snapshots carry every rail and module (the headset is new, or lost track).
   function full() {
      sent = { rails: new Map(), modules: new Map() };
      calls = 0; lead = 'rails'; cursor = { rails: null, modules: null };
   }

   // The next snapshot carries this rail or module again (it was renamed or removed); `kind` is 'rails' or 'modules'.
   function forget(kind, id) { sent[kind].delete(id); }

   // The header (clock, geometry, notices) always goes. Then rails and modules are added while they fit the budget of
   // BUDGET characters of JSON for the whole message; an item that does not fit is left out and NOT marked as sent, so it
   // comes again. Nothing starves: the class that had something left out leads the next snapshot, and within a class
   // the first item left out goes first next time.
   function snapshot() {
      const range = rt.recorder.range();
      calls++;
      const sendAll = calls % FULL_EVERY === 0;
      noteOversize();
      const head = {
         rev: rt._revBase + bus.rev + rt._geo, t: bus.t, paused: bus.paused, playing: rt.playing, playhead: rt.playhead,
         window: [range.t0, range.t1], density: density(rt.recorder, DENSITY_BINS),
         geometry: { cards: { ...rt.geometry.cards } },
         notices: bus.notices.map(n => ({ ...n })),
         vars: [...bus.rails.keys()].sort(), uses: { ...bus.uses }, unplugged: [...bus.unplugged].sort(),
      };
      const room = { left: BUDGET - ENVELOPE_ROOM - JSON.stringify(head).length, source: 0 };
      const body = { rails: {}, modules: {} }, deferred = {};
      const order = lead === 'modules' ? ['modules', 'rails'] : ['rails', 'modules'];
      for (const kind of order) deferred[kind] = kind === 'rails' ? railsSnap(sendAll, room, body.rails) : modulesSnap(sendAll, room, body.modules);
      lead = deferred[order[1]] ? order[1] : 'rails';
      return { ...head, rails: body.rails, modules: body.modules };
   }

   // Adds the rails that changed (or all of them) to `out` while they fit; true when one was left out.
   function railsSnap(sendAll, room, out) {
      const ends = { pubs: {}, subs: {} };
      const note = (owner, p) => { if (p.rail) (ends[p.dir === 'out' ? 'pubs' : 'subs'][p.rail] ||= []).push([owner, p.name]); };
      for (const [id, d] of bus.devices) for (const p of d.ports) note(`dev:${id}`, p);
      for (const [id, m] of bus.modules) for (const p of m.ports) note(id, p);
      const tape = tapeView(), sentRails = sent.rails;
      for (const id of [...sentRails.keys()]) if (!bus.rails.has(id)) sentRails.delete(id);
      let first = null;
      for (const id of rotated([...bus.rails.keys()], cursor.rails)) {
         const r = bus.rails.get(id), t = tape && tape[id] && tape[id].kind === r.kind ? tape[id] : null;
         // Paused or seeking, a variable the tape has nothing for at the playhead (it is published later) shows no value, not its live one
         // (`null`, not undefined: the head merges entries, and a missing `value` would leave the one it had).
         const e = t ? { kind: r.kind, type: r.type, value: t.value, stale: t.stale, contested: r.contested, seq: t.seq, tail: tailOf(t) }
                     : tape ? { kind: r.kind, type: r.type, value: null, stale: r.stale, contested: r.contested, seq: r.seq, tail: [] }
                     : { kind: r.kind, type: r.type, value: r.value, stale: r.stale, contested: r.contested, seq: r.seq, tail: r.tail.slice(-TAIL_SENT) };
         e.pubs = ends.pubs[id] || []; e.subs = ends.subs[id] || [];
         const sig = [e.kind, e.type, e.seq, e.stale, e.contested, t ? 'tape' : tape ? 'blank' : 'live', JSON.stringify(e.pubs), JSON.stringify(e.subs)].join('|');
         if (!sendAll && sentRails.get(id) === sig) continue;
         const cost = JSON.stringify(e).length + id.length + 6;
         if (cost > room.left) { if (first === null) first = id; continue; }
         room.left -= cost; out[id] = e; sentRails.set(id, sig);
      }
      cursor.rails = first;
      return first !== null;
   }

   // Adds the modules that changed to `out` while they fit; true when one was left out. Every 60th call also the ones
   // whose `calls` moved. The source goes only with a new ver (or text), at most SOURCE_CAP characters per snapshot, and
   // never when it is too large to sync at all (see noteOversize).
   function modulesSnap(sendAll, room, out) {
      const sentModules = sent.modules;
      for (const id of [...sentModules.keys()]) if (!bus.modules.has(id)) sentModules.delete(id);
      let first = null;
      for (const id of rotated([...bus.modules.keys()], cursor.modules)) {
         const m = bus.modules.get(id), was = sentModules.get(id);
         const ports = m.ports.map(p => ({ name: p.name, dir: p.dir, kind: p.kind, type: p.type, rail: p.rail }));
         const key = `${m.rev}|${JSON.stringify(ports)}`;
         const newSource = !was || was.ver !== m.ver || was.source !== m.source;
         const draw = drawOf(id, m);
         if (!newSource && was.key === key && was.draw === draw && !(sendAll && was.calls !== m.calls)) continue;
         const e = { ver: m.ver, status: m.status, error: m.error, editError: m.editError, ports, draw: rounded(draw), logs: m.logs.slice(-LOGS_SENT), calls: m.calls };
         const tooBig = big.get(id) === m.source, text = newSource && !tooBig ? sourceCost(id, m.source) : 0;
         const cost = JSON.stringify(e).length + id.length + 6 + text;
         const over = text > 0 && room.source > 0 && room.source + text > SOURCE_CAP;       // the first source of a snapshot always goes
         if (cost > room.left || over) { if (first === null) first = id; continue; }
         room.left -= cost; room.source += text;
         if (text > 0) e.source = m.source;
         out[id] = e;
         sentModules.set(id, { key, ver: m.ver, source: m.source, calls: m.calls, draw });
      }
      cursor.modules = first;
      return first !== null;
   }

   // The picture to send for a module: its own, or, paused before the end of the tape, the replay's (the same array until it changes).
   function drawOf(id, m) {
      if (!rt.past) return m.draw;
      const r = rt.past.bus.modules.get(id);
      return r ? r.draw : NO_DRAW;
   }

   // The size of a source as JSON (its escapes count), kept per module since a source rarely changes.
   function sourceCost(id, source) {
      const c = costs.get(id);
      if (c && c.source === source) return c.cost;
      const cost = JSON.stringify(source).length;
      costs.set(id, { source, cost });
      return cost;
   }

   // A source that alone would not fit a snapshot (64 KB of control characters escapes to 390 KB) is never sent; the module
   // goes without its `source` and one notice says so.
   function noteOversize() {
      for (const id of [...costs.keys()]) if (!bus.modules.has(id)) { costs.delete(id); big.delete(id); }
      for (const [id, m] of bus.modules) {
         if (big.get(id) === m.source) continue;
         if (sourceCost(id, m.source) <= OVERSIZE_SOURCE) { big.delete(id); continue; }
         big.set(id, m.source);
         notice(bus, `module '${id}': the source is too large to sync with the headset (${m.source.length} characters)`);
      }
   }

   // The rails as the tape had them at the playhead, or null when live. The bus does not move while a playhead is set,
   // so the answer is kept until the playhead or the bus moves.
   function tapeView() {
      if (rt.playhead === null) return (view = null);
      const key = `${rt.playhead}@${bus.n}`;
      if (!view || view.key !== key) view = { key, rails: railsAt(rt.recorder, rt.playhead) };
      return view.rails;
   }

   return { snapshot, full, forget };
}
