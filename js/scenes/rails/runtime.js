// The runtime of Rails, pure and without graphics: the laptop's side of the link. It wraps a Bus, its Recorder and the
// devices the headset feeds (gaze, pointer), carries out the commands the IDE sends (the inner object of a `cmd`
// message: { id, op, ...fields }) and answers each with an ack, and describes itself to the IDE as snapshots. The host
// (a Web Worker, see worker.js) calls step() 60 times a second and snapshot() 30 times a second; nothing here reads a
// clock, so the same commands, devices and steps always give the same snapshots.
//
// Pause and the playhead: while the bus runs, the playhead is null. `pause` freezes the bus (devices are ignored, no
// step is taken) and puts the playhead at the end of the tape; `seek` moves it inside the recorded window (and pauses
// first when live), `play` moves it forward one step per step() until the window end, `resume` goes live again (the real present).
// While a playhead is set, rail values in the snapshot are the tape's (railsAt), and, before the window's end, the pictures of the
// modules are the replay's (replay.js Replay): every module run again up to the playhead, so a paused scene shows the past exactly.
// `resumeHere` makes the playhead the new present: the world of then (state, variables, devices) goes under the program of now, and the tape after it goes.
//
// Snapshots (snapshotter.js) are incremental and have a size budget.
// `geometry` always lists every card, so it is also the list of what exists: the IDE drops what is not in it.
//
// The bus wires itself (see bus.js): its rails are the variables, named by what a card declares, so the IDE has `use {module,
// port, variable|null}` (point an input at another variable, or back at its own name) and `plug {module, on}` (take a card off
// the bus or put it back), and no rail or dock commands. The devices publish the built-in variables (values.js DEVICE_VARS), a
// snapshot's head says which variables exist (`vars`) and what the bus was told (`uses`, `unplugged`). The layout file is
// `{cards, uses, unplugged}`; an old layout (it has `rails` or `docks`) is converted when it loads:
//   - a v1 rail is the variable named by the port of its first publisher in the dock list (a module's output; for a device
//     output the variable of values.js DEVICE_VARS; the rail `clock` is `time`); a rail nobody publishes keeps its own name;
//   - an input docked to such a rail gets no entry when the input has the variable's name, else `uses[card.input] = variable`;
//   - a card with outputs that has none of them docked is `unplugged`;
//   - rails, lanes and the other docks are not carried over (an input that is not docked binds by name, as every input does).
//
// Owners are named as on the wire: a module by its name, a device as `dev:<id>`; the bus's own `mod:<name>` form is
// accepted when loading a layout and never written.
import { Bus, DT } from './bus.js';
import { MAX_REASON, CARD_SLOTS, DEVICE_VARS, isSlot, isObject, yes, no, errText, bindingKey } from './values.js';
import { Recorder } from './recorder.js';
import { Replay } from './replay.js';
import { createSnapshotter } from './snapshotter.js';
import { skeleton } from './templates.js';
import { PAUSED, notice } from './lifecycle.js';

// The ack reason for a failed bus call: a refusal has `reason`, a compile or setup failure has `error.message`
// (the message alone, since V8 gives no line for a syntax error).
const reasonOf = r => String(r.reason || (r.error && r.error.message) || 'refused').slice(0, MAX_REASON);

// A card that the bus has removed or renamed: its place goes (or moves to the new name), and the next snapshot sends it again.
function drop(rt, id) {
   delete rt.geometry.cards[id];
   rt._snap.forget('modules', id); rt._geo++;
}
function rename(rt, from, to) {
   const table = rt.geometry.cards;
   rt._snap.forget('modules', from);
   if (Object.hasOwn(table, from)) { table[to] = table[from]; delete table[from]; rt._geo++; }
}

// A v1 layout (it has `rails` or `docks`) is read as v2: the `uses` and `unplugged` that give the same wiring (see the top of
// this file). `portsOf(id)` gives a card's ports, which say which docks are outputs; a card that does not compile has none, so
// its docks say nothing. A dock that is not a list of three names is skipped.
const isV1 = l => isObject(l.rails) || Array.isArray(l.docks);
function convertV1(l, ids, portsOf) {
   const docks = (Array.isArray(l.docks) ? l.docks : []).filter(d => Array.isArray(d) && d.slice(0, 3).every(x => typeof x === 'string') && d.length >= 3)
                                                      .map(d => [d[0].startsWith('mod:') ? d[0].slice(4) : d[0], d[1], d[2]]);
   const portOf = (id, name) => (portsOf(id) || []).find(p => p.name === name);
   // The variable that a dock publishes: a device output's built-in variable, or the name of a module's output port.
   const published = ([owner, port]) => {
      if (owner.startsWith('dev:')) { const d = owner.slice(4); return Object.hasOwn(DEVICE_VARS, d) && Object.hasOwn(DEVICE_VARS[d], port) ? DEVICE_VARS[d][port] : null; }
      const p = portOf(owner, port);
      return p && p.dir === 'out' ? p.name : null;
   };
   const named = new Map();
   for (const d of docks) if (!named.has(d[2])) { const v = published(d); if (v !== null) named.set(d[2], v); }
   const variableOf = rail => (named.has(rail) ? named.get(rail) : rail === 'clock' ? 'time' : rail);
   const uses = {}, unplugged = [];
   for (const [owner, port, rail] of docks) {
      const p = owner.startsWith('dev:') ? null : portOf(owner, port);
      if (p && p.dir === 'in' && variableOf(rail) !== port) uses[bindingKey(owner, port)] = variableOf(rail);
   }
   for (const id of ids) {
      const outs = (portsOf(id) || []).filter(p => p.dir === 'out');
      if (outs.length && !outs.some(p => docks.some(d => d[0] === id && d[1] === p.name))) unplugged.push(id);
   }
   return { uses, unplugged };
}

// The commands. Each takes the runtime and the command, and returns the bus's result ({ok, reason?} or {ok, error}).
const OPS = {
   commit: (rt, c) => rt.bus.reload(c.module, c.source),
   addModule(rt, c) {
      if (rt.bus.paused) return no(PAUSED);
      if (Object.keys(rt.geometry.cards).length >= CARD_SLOTS) return no(`there are ${CARD_SLOTS} cards already, and no slot for another`);
      const r = rt.bus.addModule(c.module, typeof c.source === 'string' ? c.source : skeleton(c.module));
      if (r.ok) rt._place(c.module);
      return r;
   },
   rmModule(rt, c) {
      const r = rt.bus.removeModule(c.module);
      if (r.ok) drop(rt, c.module);
      return r;
   },
   renameModule(rt, c) {
      const r = rt.bus.renameModule(c.module, c.to);
      if (r.ok) rename(rt, c.module, c.to);
      return r;
   },
   // Reset reloads the module's current source with fresh state (the defaults of its state()); revert is the bus's revert,
   // one version back. Both come from the command line.
   reset(rt, c) {
      const mod = rt.bus.modules.get(c.module);
      return mod ? rt.bus.reload(c.module, mod.source, { resetState: true }) : no(`no module '${c.module}'`);
   },
   revert: (rt, c) => rt.bus.revert(c.module),
   use: (rt, c) => rt.bus.use(c.module, c.port, c.variable),
   plug: (rt, c) => rt.bus.plug(c.module, c.on),
   pause(rt) { rt._pause(); return yes(); },
   resume(rt) { rt._resume(); return yes(); },
   seek(rt, c) {
      if (typeof c.t !== 'number' || !Number.isFinite(c.t)) return no('t must be a finite number');
      rt._pause(); rt.playing = false; rt.playhead = rt._clamp(c.t); rt._follow();
      return yes();
   },
   play(rt) {
      if (rt.playhead === null) return no('play needs a pause: pause or seek first');
      rt.playing = true;
      return yes();
   },
   stop(rt) { rt.playing = false; return yes(); },
   geometry: (rt, c) => rt._setGeometry(c),
   // The playhead becomes the present: at the window's end that is plain `resume`; before it the live bus is made again from the replay's world.
   resumeHere(rt) {
      if (!rt.bus.paused) return no('continue from here needs a pause: pause or seek first');
      const w = rt.replay;
      if (w && w.problem) return no(`the past cannot be rebuilt: ${w.problem}`);
      if (!rt.past) { rt._resume(); return yes(); }
      return rt._continueFrom(w);
   },
};
Object.setPrototypeOf(OPS, null);      // so that an op named `constructor` or `toString` finds nothing

export class Runtime {
   constructor({ seed = 1, bases = {} } = {}) {
      this._seed = seed;
      this._revBase = Number.isSafeInteger(bases && bases.rev) && bases.rev > 0 ? bases.rev : 0;   // snap revs go on from a Worker that was replaced
      this._make();
      this.bus.setNoticeBase(bases && bases.notice);
      this.playhead = null;                         // null while live; else a bus time inside the window
      this.playing = false;
      this.replay = null;                           // the replay world (replay.js) while paused away from the window's end, else null
      this.past = null;                             // the replay while it stands at the playhead (what the pictures come from), else null
      this.geometry = { cards: {} };
      this._geo = 0;                                // grows with every geometry change, so it shows in `rev`
      this._held = new Map();                       // 'device.port' -> [device, port, value]: the last device value that came while paused
   }

   get notices() { return this.bus.notices; }

   // A fresh bus with its devices, its tape and its snapshotter (also what `resumeHere` makes the live world on).
   _make() {
      this.bus = new Bus({ seed: this._seed });
      this.recorder = new Recorder(this.bus);
      this.devices = {
         gaze: this.bus.addDevice({ id: 'gaze', outputs: { hit: { kind: 'state', type: 'vec3' }, on: { kind: 'state', type: 'bool' } }, vars: DEVICE_VARS.gaze }),
         pointer: this.bus.addDevice({ id: 'pointer', outputs: { pos: { kind: 'state', type: 'vec3' }, down: { kind: 'state', type: 'bool' } }, vars: DEVICE_VARS.pointer }),
      };
      this._snap = createSnapshotter(this);
   }

   // The host tells the IDE about something that is not a dock change (a Worker restart, say) as a notice.
   addNotice(text) { notice(this.bus, String(text)); }

   // ---- loading and saving the layout ----

   // Builds a fresh runtime from the layout file ({cards, uses, unplugged}, or an old one with rails and docks) and
   // the sources by module name. A card whose source is missing gets the skeleton; what cannot be built is reported (and noticed),
   // never thrown. With a bus `snapshot` the run carries on from there (rails, docks, uses, unplugged and state come from it)
   // instead of starting at step 0.
   load({ layout, sources, snapshot = null, migrate = false } = {}) {
      const l = isObject(layout) ? layout : {}, src = isObject(sources) ? sources : {};
      const cards = isObject(l.cards) ? l.cards : {}, modules = {}, extra = [];
      for (const [id, c] of Object.entries(cards)) {
         if (Object.keys(modules).length >= CARD_SLOTS) { extra.push({ what: `card ${id}`, message: `more than ${CARD_SLOTS} cards` }); continue; }
         modules[id] = typeof src[id] === 'string' ? src[id] : skeleton(id);
      }
      const wiring = isV1(l) ? convertV1(l, Object.keys(modules), this._portsOf(modules)) : { uses: l.uses, unplugged: l.unplugged };
      const built = { modules, ...wiring };
      let result;
      try { result = snapshot ? this.bus.restoreSnapshot(snapshot, built, { migrate }) : this.bus.restore(built); }
      catch (err) { result = { ok: false, errors: [{ what: 'load', message: errText(err) }] }; }
      const errors = [...extra, ...(result.errors || [])];
      if (!result.ok && !result.errors) errors.push({ what: 'load', message: result.reason || 'refused' });
      for (const e of errors) notice(this.bus, `${e.what}: ${e.message}`);
      this._placeAll(cards);
      this._geo++;
      return { ok: errors.length === 0, errors };
   }

   // What is saved as data/layout.js: where the cards are, and how they are wired: the `uses` (sorted, so that the text does not
   // change when nothing did) and the `unplugged` cards. The sources are saved separately, one file per module, when they are
   // committed (store.js).
   layoutFile() {
      const cards = {};
      for (const id of this.bus.modules.keys()) cards[id] = { slot: Object.hasOwn(this.geometry.cards, id) ? this.geometry.cards[id].slot : 0 };
      const uses = {};
      for (const k of Object.keys(this.bus.uses).sort()) uses[k] = this.bus.uses[k];
      return { cards, uses, unplugged: [...this.bus.unplugged].sort() };
   }

   // ---- commands, devices, time ----

   // The ack of one command: { cmd, ok, reason? }. It never throws, whatever it is given.
   handle(cmd) {
      const id = isObject(cmd) && Number.isSafeInteger(cmd.id) ? cmd.id : 0;
      let r;
      try {
         r = isObject(cmd) && OPS[cmd.op] ? OPS[cmd.op](this, cmd) : no(`unknown command '${isObject(cmd) ? cmd.op : cmd}'`);
      } catch (err) { r = no(errText(err)); }
      return r.ok ? { cmd: id, ok: true } : { cmd: id, ok: false, reason: reasonOf(r) };
   }

   // A device value from the headset (gaze.hit, gaze.on) or the laptop (pointer.pos); the bus refuses it when it is paused,
   // so the last one of each port is kept and set when the run resumes (the senders send only changes); also ignored when
   // the bus refuses it (an unknown port, a value of the wrong type).
   setDevice(id, port, value) {
      const dev = Object.hasOwn(this.devices, id) ? this.devices[id] : null;
      if (!dev) return no(`no device '${id}'`);
      if (this.bus.paused) { this._held.set(`${id}.${port}`, [dev, port, value]); return no('paused'); }
      try { dev.set(port, value); return yes(); } catch (err) { return no(errText(err)); }
   }

   // One step of time: the bus takes a step, or, paused and playing, the playhead moves one step towards the window end.
   step() {
      if (!this.bus.paused) return this.bus.step();
      if (!this.playing || this.playhead === null) return false;
      const end = this.recorder.range().t1;
      this.playhead = Math.min(end, this.playhead + DT);
      if (this.playhead >= end - 1e-9) { this.playhead = end; this.playing = false; }
      this._follow();
      return true;
   }

   // ---- snapshots (snapshotter.js) ----

   snapshot() { return this._snap.snapshot(); }

   // Forgets what was sent, so the next snapshots carry everything (the headset is new, or lost track).
   full() { this._snap.full(); }

   // ---- internals ----

   // The ports of each card as a throwaway bus makes them from the sources (for reading an old layout); null when a card does not
   // compile. Each card gets a bus of its own, so that two cards that clash over a variable are both read.
   _portsOf(modules) {
      const ports = new Map();
      for (const [id, source] of Object.entries(modules)) { const probe = new Bus({ seed: 1 }); if (probe.addModule(id, source).ok) ports.set(id, probe.modules.get(id).ports); }
      return id => ports.get(id) || null;
   }

   _clamp(t) {
      const { t0, t1 } = this.recorder.range();
      return Math.min(t1, Math.max(t0, Number.isFinite(t) ? t : t1));
   }

   _pause() {
      if (this.bus.paused) return;
      this.bus.pause();
      this.playhead = this._clamp(this.bus.t);
   }

   // Brings the replay world to the playhead (replay.js): at most one segment of steps. Not needed at the window's end, where the live bus
   // is the world. A replay that fails is told once, as a notice, and the pictures stay the live ones.
   _follow() {
      const end = this.recorder.range().t1;
      this.past = null;
      if (this.playhead === null || this.playhead >= end - 1e-9) return;
      const w = this.replay ||= new Replay(this.recorder), was = w.problem;
      if (w.at(this.playhead)) this.past = w;
      else if (!was && w.problem) notice(this.bus, `the past cannot be shown: ${w.problem}`);
   }

   // The program of now in the world of then. A snapshot is made from the live bus (its cards, sources, versions, `uses`, `unplugged`
   // and docks) and the data of the replay at the playhead is put over it: each card's state(), generator and outputs by name, the
   // variables' values and stale flags, the device values and the time. A card the replay does not have (added since) starts from its
   // initial state, and a variable it did not have starts empty; a card removed since stays removed. A card whose source is not
   // the one the replay ran (a fix committed since) has its state migrated to its defaults, as a hot reload does, and gets a fresh
   // chance (not quarantined). What a snapshot does not hold, the messages in flight at the playhead, is dropped.
   _pastWorld(w) {
      const live = this.bus.snapshot(), then = w.snapshot(), sources = {}, migrate = new Set();
      const snapshot = { ...live, n: then.n, t: then.t, devices: then.devices, rails: {}, modules: {} };
      for (const [id, r] of Object.entries(live.rails)) {
         const o = then.rails[id];
         snapshot.rails[id] = o && o.kind === r.kind && o.type === r.type ? { ...o } : { kind: r.kind, type: r.type, value: undefined, by: null, seq: 0, stale: false, contested: false, writers: [] };
      }
      for (const [id, m] of this.bus.modules) {
         sources[id] = m.source;
         const o = then.modules[id], was = w.bus.modules.get(id), ver = live.modules[id].ver;
         if (!o || !was) { snapshot.modules[id] = { ver, status: 'ok', state: null }; continue; }      // (a null state leaves the one that setup made)
         const same = was.source === m.source;
         if (!same) migrate.add(id);
         snapshot.modules[id] = { ver, state: o.state, rng: o.rng, status: same ? o.status : 'ok', draw: o.draw, ...(o.outs ? { outs: o.outs } : {}) };
      }
      return { snapshot, sources, migrate };
   }

   // The live bus is made again from that world, as a restarted Worker is from a snapshot (so what a snapshot lacks is lost the same
   // way), with an empty tape that starts at the playhead. Nothing changes when it cannot be made.
   _continueFrom(w) {
      const { snapshot, sources, migrate } = this._pastWorld(w), layout = this.layoutFile();
      const kept = { bus: this.bus, recorder: this.recorder, devices: this.devices, _snap: this._snap };
      const at = w.bus.t, revBase = this._revBase, notices = this.bus.notices;
      this._make();
      this.bus.setNoticeBase(kept.bus._noticeId);
      const r = this.load({ layout, sources, snapshot, migrate });
      if (!r.ok) { Object.assign(this, kept); return no(`could not build the past again: ${r.errors[0].message}`); }
      kept.recorder.dispose();
      for (const id of this.bus.modules.keys()) this.bus._meta.get(id).versions = kept.bus.versions(id);     // the versions to revert to stay
      this._revBase = revBase + kept.bus.rev + 1;
      for (const n of notices) this.bus.notices.push(n);
      this._resume();
      notice(this.bus, `continued from ${at.toFixed(1)} s: what was recorded after it is gone`);
      return yes();
   }

   _resume() {
      this.bus.resume();
      this.playhead = null; this.playing = false; this.replay = null; this.past = null;
      for (const [dev, port, value] of this._held.values()) { try { dev.set(port, value); } catch (err) { /* a value the bus refuses is dropped */ } }
      this._held.clear();
   }

   // A card takes the first free slot (slot 0 when all are taken).
   _place(id) {
      const table = this.geometry.cards;
      if (Object.hasOwn(table, id)) return;
      const taken = new Set(Object.values(table).map(v => v.slot)), free = [...Array(CARD_SLOTS).keys()].find(v => !taken.has(v));
      table[id] = { slot: free === undefined ? 0 : free };
      this._geo++;
   }

   // After a load: positions from the layout where they are good (and not taken), else the first free ones.
   _placeAll(cards) {
      const slots = new Set();
      for (const id of this.bus.modules.keys()) {
         const s = isObject(cards[id]) ? cards[id].slot : undefined;
         if (isSlot(s) && !slots.has(s)) { this.geometry.cards[id] = { slot: s }; slots.add(s); }
      }
      for (const id of this.bus.modules.keys()) this._place(id);
   }

   // Merges the card slots of a geometry command; ids that do not exist are ignored (the command may be a moment older than a
   // removal), and two cards may not share a slot: all or nothing.
   _setGeometry(c) {
      if (!isObject(c.cards)) return no('geometry.cards must be an object');
      const cards = { ...this.geometry.cards };
      for (const [id, v] of Object.entries(c.cards)) if (!isObject(v)) return no(`geometry.cards.${id} must be an object`);
      for (const [id, v] of Object.entries(c.cards)) if (Object.hasOwn(cards, id) && isSlot(v.slot)) cards[id] = { slot: v.slot };
      const owner = new Map();
      for (const [id, v] of Object.entries(cards)) {
         if (owner.has(v.slot)) return no(`slot ${v.slot} would hold both '${owner.get(v.slot)}' and '${id}'`);
         owner.set(v.slot, id);
      }
      this.geometry = { cards }; this._geo++;
      return yes();
   }
}
