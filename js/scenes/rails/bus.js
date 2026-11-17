// The Rails bus, pure and without graphics: rails (channels of two kinds, state and event),
// the ports that dock to them, devices that publish from outside, and modules that
// compile from source. Time only moves in step(), so a run is a function of its
// seed, its structure calls and its device values; nothing here reads a clock.
//
// A rail of kind `state` retains its latest value; a publish within a pass is coalesced,
// a late dock receives the retained value, and an undocked publisher leaves the value
// behind as stale. A rail of kind `event` delivers every message exactly once, in order,
// and retains nothing. Structure calls (rails, docks) are checked at once, queued, and
// applied at the start of the next step in call order, so topology never changes while
// messages are being delivered and the op log reads in the order things happened.
//
// A module is compiled and its setup is run at once, in a trial, so the caller learns right
// away whether the source is good; a reload is then queued like any structure call and the
// new version is swapped in at the start of the next step. A module that fails at run time
// (a handler throws, a publish is bad, it runs away) is quarantined and its state rolled
// back to the checkpoint taken before its first handler of the step. What happens to a
// module over time, and layout and snapshots, lives in lifecycle.js.
//
// The bus wires itself: a variable is a rail that exists as soon as a plugged module declares an output of that name, an
// input takes the variable of its own name unless `use` points it elsewhere, and a module can be unplugged. One idempotent
// _reconcile() makes the rails and docks that follow from the modules, `uses` and `unplugged`.
// A bus made with `auto: false` is a manual one: no wiring of its own, and rails and docks come from addRail(), dock() and
// undock(). Only the replay's private bus is one (replay.js): it replays a tape's rail and dock ops one at a time, and
// that is all it has to do. (The tests of the delivery rules also use one, which is the simplest way to set a bus up.)
import { TYPES, KINDS, MAX_SOURCE, yes, no, typeOk, validateValue, freezeCopy, validDraw, validState, migrate, compatible, bindingKey } from './values.js';
import { makeRng, hashSeed, compile, toError } from './sandbox.js';
import * as life from './lifecycle.js';
import { NAME_RULE, MAX_PORTS, PAUSED, goodName, keyOf, failure } from './lifecycle.js';

const WIRES_ITSELF = 'the bus wires itself: point an input with use(), take a card off with plug()';
const MANUAL = 'use() and plug() are for a bus that wires itself';

export const DT = 1 / 60;           // seconds of bus time per step
export const MAX_PASSES = 8;        // delivery passes per step; the rest is carried to the next step
export const BUDGET = 2000;         // handler calls per module per step
const MAX_SENDS = 10 * BUDGET;      // publishes per module per step, which keeps the inbox of a runaway publisher bounded
const TAIL = 32;

const phased = (err, phase) => { err.railsPhase = phase; return err; };
const HANDLERS = new WeakMap();     // input port -> its handler functions, kept out of the read model

// How a queued structure op changes the dock picture, without any effects: the view that
// the checks run against is the applied state with every queued op replayed on top of it.
function project(view, op) {
   const { rails, docks, ports } = view;
   const rebind = (from, to) => { for (const [k, r] of docks) if (r === from) docks.set(k, to); };
   switch (op.k) {
      case 'addRail': rails.set(op.id, { kind: op.kind, type: op.type }); break;
      case 'removeRail': rails.delete(op.id); rebind(op.id, null); break;
      case 'dock': docks.set(`${op.owner}.${op.port}`, op.rail); break;
      case 'undock': docks.set(`${op.owner}.${op.port}`, null); break;
      case 'use': if (op.variable === null) delete view.uses[bindingKey(op.card, op.port)]; else view.uses[bindingKey(op.card, op.port)] = op.variable; break;
      case 'plug': if (op.on) view.unplugged.delete(op.card); else view.unplugged.add(op.card); break;
      default: life.projectModule(view, op);
   }
}

export class Bus {
   constructor({ seed = 1, auto = true } = {}) {
      this.seed = seed;
      this.auto = !!auto;               // false: a manual bus, for the replay (see the header)
      this.n = 0;                       // steps taken; bus time is n * DT
      this.paused = false;
      this.rev = 0;                     // grows with every applied structure change
      this.rails = new Map();           // id -> {id, kind, type, value, by, seq, stale, contested, writers, tail}
      this.builtins = new Set();        // ids of the rails that belong to devices: never swept, never removed
      this.clockRail = auto ? 'time' : 'clock';
      this.uses = {};                   // 'card.port' -> the variable that input is pointed at (a preference: the variable may not exist yet)
      this.unplugged = new Set();       // ids of the cards that are not plugged into the bus
      this.devices = new Map();         // id -> {id, ports}
      this.modules = new Map();         // id -> {id, ver, source, status, error, editError, ports, draw, logs, calls, rev, state}
      this.notices = [];                // the last 8 {id, n, text}: things that happened without a command
      this.queue = [];                  // structure ops waiting for the next step
      this.inbox = [];                  // messages waiting for delivery, carried across steps
      this._ports = new Map();          // 'owner.port' -> port
      this._docked = new Map();         // rail id -> Set of ports
      this._rank = new Map();           // port -> (owner order, declaration order), which is delivery order
      this._order = 0;                  // the next owner order; devices and modules take one when they are registered
      this._pending = new Map();        // device id -> values set since the last step
      this._rngs = new Map();           // module id -> its generator
      this._budget = new Map();         // module id -> handler calls this step
      this._sent = new Map();           // 'mod:id' -> publishes this step
      this._checkpoints = new Map();    // module id -> its state as JSON before its first handler this step
      this._meta = new Map();           // module id -> {order, lastVer, versions, compiledAs}
      this._staged = new Map();         // module id -> a compiled candidate waiting for commit()
      this._noticeId = 0;
      this.hookError = null;           // the last error thrown by an onOp or onStep hook, which never aborts a step
      this._writerStep = new Map();     // rail id -> the step its writers list belongs to
      this._got = new Map();            // input port -> seq of the rail's last delivery it has received
      this._hooks = { op: [], before: [], step: [] };
      this.feed = null;                 // {last, at(pass) -> [message]}: messages from outside the bus for each pass of one step; only the replay sets it (replay.js)
      if (!auto) { this._newRail('clock', 'state', 'time'); this.builtins.add('clock'); }
      this.addDevice({ id: 'clock', outputs: { time: { kind: 'state', type: 'time' } }, ...(auto ? { vars: { time: 'time' } } : {}) });
      this._clock = this._ports.get('dev:clock.time');
      this._applyDock(this._clock, this.clockRail);
   }

   get t() { return this.n * DT; }

   pause() { this.paused = true; }
   resume() { this.paused = false; }
   // Each returns the function that takes the hook away again.
   _addHook(list, fn) { this._hooks[list].push(fn); return () => { this._hooks[list] = this._hooks[list].filter(f => f !== fn); }; }
   onOp(fn) { return this._addHook('op', fn); }
   // Called at the start of every step that will run (not while paused), before n grows and before the queue is applied.
   onBeforeStep(fn) { return this._addHook('before', fn); }
   onStep(fn) { return this._addHook('step', fn); }

   // ---- structure calls: checked at once, queued, applied by step() ----

   // What the bus is now, as plain tables. A bus that wires itself also has the modules' ports in registration order (`mods`),
   // `uses`, `unplugged` and the built-in rails, which is what the wiring is worked out from.
   _baseView() {
      const rails = new Map([...this.rails].map(([id, r]) => [id, { kind: r.kind, type: r.type }]));
      const docks = new Map([...this._ports].map(([k, p]) => [k, p.rail]));
      const view = { rails, docks, ports: new Map(this._ports) };
      if (this.auto) Object.assign(view, { mods: new Map([...this.modules].map(([id, m]) => [id, m.ports])), uses: { ...this.uses }, unplugged: new Set(this.unplugged), builtins: this.builtins });
      return view;
   }

   // The view of a bus that wires itself also has `vars` (name -> {kind, type}): the variables as they will be once the queue is applied
   // and the step has swept the ones nobody holds.
   _view() {
      const view = this._baseView();
      for (const op of this.queue) project(view, op);
      if (this.auto) view.vars = life.wire(view).vars;
      return view;
   }

   // The first thing wrong with a module's ports once `change` has been made to the view (the queue is in it), or null:
   // a shape that clashes with a variable, a built-in name, the 65th variable. The module is looked at last, so the clash
   // is always its own.
   _problem(id, change) {
      if (!this.auto) return null;
      const view = this._baseView();
      for (const op of this.queue) project(view, op);
      change(view);
      return life.wire(view, id).problems.get(id) || null;
   }

   _queue(op) { this.queue.push(op); return yes(); }

   _railProblem(view, id) {
      if (!view.rails.has(id)) return no(`no rail '${id}'`);
      return this.builtins.has(id) ? no('the clock rail is built in and cannot be removed') : null;
   }

   addRail({ id, kind, type = 'any' }) {
      if (this.auto) return no(WIRES_ITSELF);
      if (!goodName(id)) return no(`bad rail name '${id}': ${NAME_RULE}`);
      if (!KINDS.includes(kind)) return no(`a rail's kind must be state or event, not '${kind}'`);
      if (!TYPES.includes(type)) return no(`unknown type '${type}'`);
      if (this._view().rails.has(id)) return no(`rail '${id}' already exists`);
      return this._queue({ k: 'addRail', id, kind, type });
   }

   removeRail(id) {
      if (this.auto) return no(WIRES_ITSELF);
      return this._railProblem(this._view(), id) || this._queue({ k: 'removeRail', id });
   }

   // Ports are looked up in the view, so a port that a queued reload adds can be docked at once.
   _port(owner, name, view) {
      const p = view.ports.get(`${owner}.${name}`);
      if (p) return { p };
      const [what, id] = [owner.slice(0, 4), owner.slice(4)];
      if (what === 'mod:' && !this.modules.has(id) && ![...view.ports.keys()].some(k => k.startsWith(`${owner}.`))) return { bad: no(`no module '${id}'`) };
      if (what === 'dev:' && !this.devices.has(id)) return { bad: no(`no device '${id}'`) };
      if (what !== 'mod:' && what !== 'dev:') return { bad: no(`unknown owner '${owner}'`) };
      return { bad: no(`${owner} has no port '${name}'`) };
   }

   canDock(owner, port, rail, view = this._view()) {
      const { p, bad } = this._port(String(owner), port, view);
      if (bad) return bad;
      const target = view.rails.get(rail);
      return target ? compatible(p, target) : no(`no rail '${rail}'`);
   }

   // Docking a port that is docked elsewhere moves it; docking it where it already is does nothing.
   dock(owner, port, rail) {
      if (this.auto) return no(WIRES_ITSELF);
      const view = this._view();
      const r = this.canDock(owner, port, rail, view);
      if (!r.ok) return r;
      return view.docks.get(`${owner}.${port}`) === rail ? yes() : this._queue({ k: 'dock', owner, port, rail });
   }

   undock(owner, port) {
      if (this.auto) return no(WIRES_ITSELF);
      const view = this._view();
      const { bad } = this._port(String(owner), port, view);
      if (bad) return bad;
      return view.docks.get(`${owner}.${port}`) ? this._queue({ k: 'undock', owner, port }) : no(`${owner}.${port} is not docked`);
   }

   // Points an input at another variable (null: back to the variable of its own name). Refused when the variable does not
   // exist, the port is not an input of the card, or the shapes do not fit; a `uses` entry that comes from a layout or a
   // snapshot is only a preference and may wait for its variable.
   use(card, port, variable) {
      if (!this.auto) return no(MANUAL);
      const view = this._view(), ports = view.mods.get(card);
      if (!ports) return no(`no module '${card}'`);
      const p = ports.find(q => q.name === port);
      if (!p) return no(`${card} has no port '${port}'`);
      if (p.dir !== 'in') return no(`${card}.${port} is an output, and only an input can be pointed at a variable`);
      if (variable !== null && typeof variable !== 'string') return no('a variable name or null');
      const key = bindingKey(card, port);
      const reset = () => (view.uses[key] === undefined ? yes() : this._queue({ k: 'use', card, port, variable: null }));
      if (variable === null) return reset();
      const v = view.vars.get(variable);
      if (!v) return no(`no variable '${variable}'`);
      const fit = compatible(p, v);
      if (!fit.ok) return no(fit.reason);
      if (variable === port) return reset();                 // naming the default is resetting to it
      return view.uses[key] === variable ? yes() : this._queue({ k: 'use', card, port, variable });
   }

   // Takes a card off the bus or puts it back. A card that is off has no docks: it gets nothing and publishes nothing, and
   // the variables only it published have no publisher. Plugging back in is refused when a variable of its has since been
   // taken in another shape.
   plug(card, on) {
      if (!this.auto) return no(MANUAL);
      const view = this._view();
      if (!view.mods.has(card)) return no(`no module '${card}'`);
      if (typeof on !== 'boolean') return no('plug needs true or false');
      if (!view.unplugged.has(card) === on) return yes();
      const bad = on && this._problem(card, v => v.unplugged.delete(card));
      return bad ? no(bad) : this._queue({ k: 'plug', card, on });
   }

   // ---- applying structure ops (inside step) ----

   // A hook that throws must not abort the step it was called from; the last such error is kept for the host.
   _hook(fn, arg) { try { fn(arg); } catch (err) { this.hookError = err; } }
   _log(op) { for (const fn of this._hooks.op) this._hook(fn, op); }
   _rankPorts(ports, order) { ports.forEach((p, i) => this._rank.set(p, order * MAX_PORTS + i)); }

   _newRail(id, kind, type) {
      this.rails.set(id, { id, kind, type, value: undefined, by: null, seq: 0, stale: false, contested: false, writers: [], tail: [] });
      this._docked.set(id, new Set());
   }

   _on(railId) { return [...this._docked.get(railId)].sort((a, b) => this._rank.get(a) - this._rank.get(b)); }

   _apply(op) {
      const rail = this.rails.get(op.id);
      switch (op.k) {
         case 'addRail': this._newRail(op.id, op.kind, op.type); break;
         case 'removeRail':
            if (!rail) return;
            this._dropRail(op.id);
            break;
         case 'reload': life.swap(this, op); return;
         case 'removeModule': life.removeModule(this, op.id); return;
         case 'renameModule': life.renameModule(this, op.id, op.to); return;
         case 'use':
            if (!this.modules.has(op.card)) return;
            if (op.variable === null) delete this.uses[bindingKey(op.card, op.port)]; else this.uses[bindingKey(op.card, op.port)] = op.variable;
            this._log({ k: 'use', n: this.n, card: op.card, port: op.port, variable: op.variable });
            break;
         case 'plug':
            if (!this.modules.has(op.card)) return;
            if (op.on) this.unplugged.delete(op.card); else this.unplugged.add(op.card);
            this._log({ k: 'plug', n: this.n, card: op.card, on: op.on });
            break;
         case 'dock': this._applyDock(this._ports.get(`${op.owner}.${op.port}`), op.rail); return;
         case 'undock': { const p = this._ports.get(`${op.owner}.${op.port}`); if (p && p.rail) this._detach(p); return; }
      }
      this.rev++;
   }

   _dropRail(id) {
      for (const p of this._on(id)) this._detach(p, 'rail removed');
      this.rails.delete(id); this._docked.delete(id); this._writerStep.delete(id);
      this.inbox = this.inbox.filter(m => m.rail !== id);
   }

   // ---- the wiring of a bus that wires itself ----

   // Makes the rails and docks that follow from the modules, `uses` and `unplugged`, and nothing else (it can be called
   // at any time and any number of times). Rails first, for the variables that plugged outputs bring; then the docks,
   // outputs before inputs so an input is not handed a value that an output is about to replace; and, with `sweep`, the
   // rails that no port is docked to any more. Sweeping is left to the end of the structure phase (a rail whose publisher
   // goes in one op and comes back in the next keeps its value, seq and tail). The built-in rails are never swept. The
   // rail and unrail ops go to the log so a tape can tell when a variable began and ended.
   _reconcile(sweep = false) {
      if (!this.auto) return;
      const plan = life.wire(this._baseView());
      for (const [id, v] of plan.vars) {
         if (!v.pubs.length) continue;
         const rail = this.rails.get(id);
         if (rail && (rail.kind !== v.kind || rail.type !== v.type)) this._unrail(id);      // a variable nobody held, made again in another shape
         if (!this.rails.has(id)) {
            this._newRail(id, v.kind, v.type); this.rev++;
            this._log({ k: 'rail', n: this.n, id, kind: v.kind, type: v.type });
         }
      }
      for (const [key, id] of plan.docks) {
         const p = this._ports.get(key);
         if (!p || p.rail === id) continue;
         if (id) this._applyDock(p, id); else if (p.rail) this._detach(p, this.unplugged.has(p.owner.slice(4)) ? 'unplugged' : 'unbound');
      }
      if (sweep) for (const id of [...this.rails.keys()]) if (!this.builtins.has(id) && this._docked.get(id).size === 0) this._unrail(id);
   }

   _unrail(id) {
      this._dropRail(id); this.rev++;
      this._log({ k: 'unrail', n: this.n, id });
   }

   _applyDock(p, railId) {
      const rail = this.rails.get(railId);
      if (!p || !rail || !compatible(p, rail).ok || p.rail === railId) return;
      if (p.rail) this._detach(p, 'moved');
      p.rail = railId; this._docked.get(railId).add(p);
      this._log({ k: 'dock', n: this.n, owner: p.owner, port: p.name, rail: railId });
      this.rev++;
      if (rail.kind !== 'state') return;
      // A new subscriber is handed the retained value; a new publisher's value goes out at once.
      // The clock publishes in every step, so a new subscriber to it needs no retained value (it would tick twice).
      if (p.dir === 'in' && rail.value !== undefined && railId !== this.clockRail) this.inbox.push({ rail: railId, kind: 'state', to: p });
      if (p.dir === 'out' && p.value !== undefined && typeOk(rail.type, p.value)) this.inbox.push({ rail: railId, kind: 'state', v: p.value, by: keyOf(p), to: null });
   }

   // Unbinds a port. An input forgets its value; a state rail that loses its last publisher keeps its value, stale.
   _detach(p, reason) {
      const id = p.rail, rail = this.rails.get(id);
      p.rail = null; this._docked.get(id).delete(p);
      if (p.dir === 'in') {
         p.value = undefined; this._got.delete(p);
         this.inbox = this.inbox.filter(m => m.to !== p);     // a retained value that was waiting for this dock is void
      } else this._staleIfDead(rail);
      const op = { k: 'undock', n: this.n, owner: p.owner, port: p.name, rail: id };
      if (reason) op.reason = reason;
      this._log(op);
      this.rev++;
   }

   // A state rail whose value has no living publisher is stale: its publishers are undocked or quarantined.
   _staleIfDead(rail) {
      if (rail.kind === 'state' && rail.value !== undefined && !this._hasLivePublisher(rail)) rail.stale = true;
   }

   // Stale or live again, whichever the rail's publishers say: used when a publisher recovers.
   _restale(rail) {
      if (rail.kind === 'state' && rail.value !== undefined) rail.stale = !this._hasLivePublisher(rail);
   }

   _hasLivePublisher(rail) {
      return this._on(rail.id).some(q => q.dir === 'out' && !this._dead(keyOf(q)));
   }

   _dead(by) {
      const p = this._ports.get(by), mod = p && p.owner.startsWith('mod:') && this.modules.get(p.owner.slice(4));
      return !!mod && mod.status !== 'ok';
   }

   // Hands a docked state input the rail's value again, as at its dock. For the replay's private bus only: it uses it to rebuild a
   // delivery that was still waiting in the inbox when a snapshot was taken (the inbox is not in a snapshot). On the live bus
   // it would deliver the value twice.
   resend(owner, port) {
      const p = this._ports.get(`${owner}.${port}`);
      if (!p || p.dir !== 'in' || !p.rail || this.rails.get(p.rail).kind !== 'state') return;
      p.value = undefined; this._got.delete(p);
      this.inbox.push({ rail: p.rail, kind: 'state', to: p });
   }

   // ---- time ----

   // One step of bus time: structure ops, then device values in registration order, then the clock last, then delivery.
   step() {
      if (this.paused) return false;
      for (const fn of this._hooks.before) this._hook(fn, { n: this.n, t: this.t });
      this.n++;
      this._budget.clear(); this._sent.clear(); this._checkpoints.clear();
      const ops = this.queue; this.queue = [];
      for (const op of ops) { this._apply(op); this._reconcile(); }
      if (ops.length) this._reconcile(true);
      this._flushDevices();
      this._deliver();
      this._checkStates();
      for (const fn of this._hooks.step) this._hook(fn, { n: this.n, t: this.t });
      return true;
   }

   _flushDevices() {
      for (const [id, list] of this._pending) {
         for (const { p, v } of list) if (p.rail) this.inbox.push({ rail: p.rail, kind: p.kind, v, by: keyOf(p), to: null });
         this._pending.set(id, []);
      }
      const time = freezeCopy({ t: this.t, dt: DT, n: this.n });
      this._clock.value = time;
      if (this._clock.rail) this.inbox.push({ rail: this.clockRail, kind: 'state', v: time, by: keyOf(this._clock), to: null });
   }

   // Each pass delivers the inbox as it stood at its start; what handlers publish forms the next pass.
   // After MAX_PASSES the rest stays in the inbox and is the head of the next step's pass 0.
   _deliver() {
      const feed = this.feed;
      for (let pass = 0; pass < MAX_PASSES && (this.inbox.length || (feed && pass <= feed.last)); pass++) {
         const fed = feed ? feed.at(pass) : null;      // what the tape says other publishers delivered in this pass: it follows our own messages
         const batch = fed && fed.length ? this.inbox.concat(fed) : this.inbox; this.inbox = [];
         const last = new Map();
         batch.forEach((m, i) => { if (m.kind === 'state' && !m.to) last.set(m.rail, i); });
         batch.forEach((m, i) => {
            const rail = this.rails.get(m.rail);
            if (!rail || rail.kind !== m.kind) return;
            if (m.to) { this._retain(m.to, rail); return; }
            if (rail.kind === 'state') this._noteWriter(rail, m.by);
            if (rail.kind === 'state' && last.get(m.rail) !== i) return;     // coalesced into the last publish of the pass
            this._publish(rail, m, pass);
         });
      }
   }

   // A retained delivery hands a newly docked input the rail's value as it is now, never the one captured at dock
   // time, and nothing at all when the input has already received the latest delivery (a message that was ahead of it
   // in the queue), so an input never sees an older value after a newer one.
   _retain(p, rail) {
      if (p.rail !== rail.id || rail.value === undefined || this._got.get(p) >= rail.seq) return;
      this._got.set(p, rail.seq);
      this._receive(p, rail.value, { retained: true, t: this.t, by: rail.by });
   }

   // `contested` and `writers` describe the latest step in which the rail was published to.
   _noteWriter(rail, by) {
      if (this._writerStep.get(rail.id) !== this.n) { this._writerStep.set(rail.id, this.n); rail.writers = []; }
      if (!rail.writers.includes(by)) rail.writers.push(by);
      rail.contested = rail.writers.length > 1;
   }

   _publish(rail, m, pass) {
      rail.seq++; rail.by = m.by;
      if (rail.kind === 'state') { rail.value = m.v; rail.stale = this._dead(m.by); }
      rail.tail.push({ seq: rail.seq, t: this.t, v: m.v, by: m.by });
      if (rail.tail.length > TAIL) rail.tail.shift();
      this._log({ k: 'pub', n: this.n, p: pass, rail: rail.id, v: m.v, by: m.by });
      for (const p of this._on(rail.id)) {
         if (p.dir !== 'in') continue;
         this._got.set(p, rail.seq);
         this._receive(p, m.v, { retained: false, t: this.t, by: m.by });
      }
   }

   // A quarantined module is sent nothing: its inbox is dropped, not queued.
   _receive(p, v, meta) {
      const mod = this.modules.get(p.owner.slice(4));
      if (mod && mod.status !== 'ok') return;
      p.value = v;
      for (const fn of HANDLERS.get(p) || []) this._call(mod, fn, v, meta);
   }

   // Every handler call is wrapped. The state is checkpointed before a module's first handler of the step; an error,
   // a bad publish or more than BUDGET calls quarantines the module, which stops all its handlers at once.
   _call(mod, fn, v, meta) {
      if (mod.status !== 'ok') return;
      const used = (this._budget.get(mod.id) || 0) + 1;
      this._budget.set(mod.id, used);
      if (used > BUDGET) return life.quarantine(this, mod, failure('handler', `runaway handler: more than ${BUDGET} calls in one step`));
      if (!this._checkpoints.has(mod.id)) this._checkpoints.set(mod.id, this._checkpoint(mod));
      mod.calls++;
      try { fn(v, meta); }
      catch (err) { life.quarantine(this, mod, toError(err && err.railsPhase || 'handler', err, this._meta.get(mod.id).compiledAs)); }
   }

   // A module's state must stay JSON (no cycles, no NaN, at most 16 KB), or a snapshot and a rollback could not
   // hold it. It is checked once per step for each module that ran a handler; a bad one goes back to its checkpoint.
   _checkStates() {
      for (const id of this._checkpoints.keys()) {
         const mod = this.modules.get(id), r = mod && mod.status === 'ok' && mod.state ? validState(mod.state) : { ok: true };
         if (!r.ok) life.quarantine(this, mod, failure('handler', `the state of '${id}' is not valid JSON state: ${r.error}`));
      }
   }

   _checkpoint(mod) {
      try { return mod.state ? JSON.stringify(mod.state) : null; } catch (err) { return null; }
   }

   // ---- publishing from a port (a module's handle or a device's set/emit) ----

   _send(p, v, want, verb) {
      if (p.kind !== want) throw phased(new Error(`${verb}() is for ${want} outputs, but '${p.name}' is a ${p.kind} output: use ${p.kind === 'state' ? 'set' : 'emit'}()`), 'publish');
      if (p.owner.startsWith('mod:')) {
         const sent = (this._sent.get(p.owner) || 0) + 1;
         this._sent.set(p.owner, sent);
         if (sent > MAX_SENDS) throw new Error(`runaway publisher: more than ${MAX_SENDS} publishes in one step`);
      }
      const r = validateValue(v);
      if (!r.ok) throw phased(new Error(`${p.name}: ${r.error}`), 'publish');
      const rail = p.rail && this.rails.get(p.rail);
      for (const type of [p.type, rail && rail.type])
         if (type && !typeOk(type, v)) throw phased(new Error(`${p.name} is a ${type} port, and the value is not a ${type}`), 'publish');
      const frozen = freezeCopy(v);
      if (want === 'state') p.value = frozen;
      if (p.owner.startsWith('dev:')) this._pending.get(p.owner.slice(4)).push({ p, v: frozen });
      else if (p.rail) this.inbox.push({ rail: p.rail, kind: p.kind, v: frozen, by: keyOf(p), to: null });
   }

   _makePort(owner, name, dir, kind, type) {
      return { owner, name, dir, kind, type, rail: null, value: undefined };
   }

   // ---- devices ----

   // A device publishes from outside the bus (gaze, trackpad, the clock). Its values wait for the next step.
   // `vars` ({output: variable name}) gives outputs a built-in variable: the rail is made and docked at once,
   // and it is never swept.
   addDevice({ id, outputs = {}, vars }) {
      if (!goodName(id)) throw new Error(`bad device name '${id}': ${NAME_RULE}`);
      if (this.devices.has(id)) throw new Error(`device '${id}' already exists`);
      const ports = Object.entries(outputs).map(([name, { kind, type = 'any' }]) => {
         if (!goodName(name) || !KINDS.includes(kind) || !TYPES.includes(type)) throw new Error(`bad output '${name}' on device '${id}'`);
         return this._makePort(`dev:${id}`, name, 'out', kind, type);
      });
      const named = Object.entries(vars === undefined ? {} : vars);
      for (const [name, rail] of named) {
         if (!ports.some(p => p.name === name)) throw new Error(`device '${id}' has no output '${name}'`);
         if (!goodName(rail)) throw new Error(`bad variable name '${rail}': ${NAME_RULE}`);
         if (this.rails.has(rail)) throw new Error(`variable '${rail}' already exists`);
      }
      this.devices.set(id, { id, ports });
      this._pending.set(id, []);
      for (const p of ports) this._ports.set(keyOf(p), p);
      this._rankPorts(ports, this._order++);
      this.rev++;
      for (const [name, rail] of named) {
         const p = ports.find(q => q.name === name);
         this._newRail(rail, p.kind, p.type); this.builtins.add(rail);
         this._applyDock(p, rail);
      }
      const via = (want, verb) => (name, v) => {
         const p = ports.find(q => q.name === name);
         if (!p) throw new Error(`device '${id}' has no output '${name}'`);
         if (this.paused) return;       // a paused bus does not sample its devices, so nothing bursts on resume
         this._send(p, v, want, verb);
      };
      return { set: via('state', 'set'), emit: via('event', 'emit') };
   }


   // ---- modules: compile and setup in a trial, then register or queue ----

   // Compiles a source and runs its setup against a throwaway record, so nothing is registered, ranked or published
   // unless the caller keeps the instance. `rng` is the generator that setup draws from: a throwaway one for a reload.
   // With `quiet` a set or emit during setup does nothing (a restored snapshot supplies the values).
   _trial(id, source, rng, quiet = false) {
      if (typeof source !== 'string' || source.length > MAX_SOURCE) return { ok: false, error: failure('compile', `a module's source is text of at most ${MAX_SOURCE} characters`) };
      const c = compile(id, source);
      if (!c.ok) return { ok: false, error: c.error };
      const inst = { name: id, rng, setup: { open: true, quiet }, mod: life.newRecord(id, source) };
      try { c.run(this._api(inst)); }
      catch (err) { return { ok: false, error: toError('setup', err, id) }; }
      finally { inst.setup.open = false; }
      const valid = inst.mod.state ? validState(inst.mod.state) : { ok: true };
      if (!valid.ok) return { ok: false, error: failure('setup', `the state is not valid JSON state: ${valid.error}`) };
      return { ok: true, inst };
   }

   // A new module is registered at once, so its ports can be docked in the next call; the dock of its
   // time input to the clock is queued like any dock.
   addModule(id, source) {
      if (this.paused) return no(PAUSED);
      if (!goodName(id)) return { ok: false, error: failure('setup', `bad module name '${id}': ${NAME_RULE}`) };
      if (this.modules.has(id)) return { ok: false, error: failure('setup', `module '${id}' already exists`) };
      const t = this._trial(id, source, makeRng(hashSeed(this.seed, id)));
      if (!t.ok) return t;
      const bad = this._problem(id, view => view.mods.set(id, t.inst.mod.ports));
      if (bad) return { ok: false, error: failure('setup', bad) };
      life.register(this, t.inst);
      return yes();
   }

   // The result is real (the trial ran), the running version is untouched until the next step, and a failure
   // is also kept on the module as editError. The new version is migrated from the running state at the swap.
   reload(id, source, { resetState = false } = {}) {
      return this._swapIn(id, () => this._trial(id, source, makeRng(0)), { resetState });
   }

   stage(id, source) {
      const mod = this.modules.get(id);
      if (!mod) return no(`no module '${id}'`);
      const t = this._trial(id, source, makeRng(0));
      life.setEditError(mod, t.ok ? null : t.error);
      if (t.ok) this._staged.set(id, t.inst); else this._staged.delete(id);
      return t.ok ? yes() : t;
   }

   commit(id) {
      const staged = this._staged.get(id);
      return this._swapIn(id, () => (staged ? { ok: true, inst: staged } : no('nothing is staged for this module')), {}, () => this._staged.delete(id));
   }

   // Goes back to the version before the running one; asking again goes one further back.
   revert(id) {
      const meta = this._meta.get(id);
      if (!meta || meta.versions.length < 2) return no(meta ? 'there is no earlier version' : `no module '${id}'`);
      const { source } = meta.versions[meta.versions.length - 2];
      return this._swapIn(id, () => this._trial(id, source, makeRng(0)), { revert: true });
   }

   _swapIn(id, makeInst, extra, done) {
      if (this.paused) return no(PAUSED);
      const mod = this.modules.get(id);
      if (!mod) return no(`no module '${id}'`);
      let t = makeInst();
      if (t.ok) {
         const bad = this._problem(id, view => life.projectModule(view, { k: 'reload', id, inst: t.inst }));
         if (bad) t = { ok: false, error: failure('setup', bad) };
      }
      if (!t.ok) { if (t.error) life.setEditError(mod, t.error); return t; }
      life.setEditError(mod, null); this._staged.delete(id);
      if (done) done();
      return this._queue({ k: 'reload', id, inst: t.inst, ...extra });
   }

   removeModule(id) {
      if (this.paused) return no(PAUSED);
      return this.modules.has(id) ? this._queue({ k: 'removeModule', id }) : no(`no module '${id}'`);
   }

   // A restarted Worker carries on the numbering of notices: the next notice's id is above `n` (never lowers it).
   setNoticeBase(n) { if (Number.isSafeInteger(n) && n > this._noticeId) this._noticeId = n; }

   renameModule(id, to) {
      if (this.paused) return no(PAUSED);
      if (!this.modules.has(id)) return no(`no module '${id}'`);
      if (!goodName(to)) return no(`bad module name '${to}': ${NAME_RULE}`);
      return this.modules.has(to) ? no(`module '${to}' already exists`) : this._queue({ k: 'renameModule', id, to });
   }

   versions(id) { const meta = this._meta.get(id); return meta ? meta.versions.map(v => ({ ...v })) : []; }

   // ---- persistence (see lifecycle.js) ----

   restore(layout) { return life.restore(this, layout); }
   snapshot() { return life.snapshot(this); }
   restoreSnapshot(snap, layout, options) { return life.restoreSnapshot(this, snap, layout, options); }

   // The API a module's source sees. Declarations and handlers only work during setup. A set during setup keeps the value
   // on the port, to go out when the port is docked; an emit has no rail yet and is dropped.
   _api(inst) {
      const setup = inst.setup;
      const declare = (name, kind, type, dir) => {
         const what = dir === 'in' ? 'input' : 'output', mod = inst.mod;
         if (!setup.open) throw new Error(`${what}('${name}') must be called at the top level of the module (the setup pass), not inside a handler`);
         if (!goodName(name)) throw new Error(`bad port name '${name}': ${NAME_RULE}`);
         if (!KINDS.includes(kind)) throw new Error(`${what}('${name}'): kind must be 'state' or 'event', not '${kind}'`);
         if (!TYPES.includes(type)) throw new Error(`${what}('${name}'): type must be one of ${TYPES.join(', ')}, not '${type}'`);
         if (mod.ports.some(p => p.name === name)) throw new Error(`port '${name}' is declared twice`);
         if (mod.ports.length >= MAX_PORTS) throw new Error(`a module has at most ${MAX_PORTS} ports`);
         if (dir === 'in' && name === 'time' && (kind !== 'state' || type !== 'time')) throw new Error(`input('time') is the clock: declare it as input('time', 'state', 'time'), not '${kind}' and '${type}'`);
         const p = this._makePort(`mod:${mod.id}`, name, dir, kind, type);
         mod.ports.push(p);
         return p;
      };
      const send = (p, v, want, verb) => { if (!(setup.open && setup.quiet)) this._send(p, v, want, verb); };
      return {
         input: (name, kind, type = 'any') => {
            const p = declare(name, kind, type, 'in'), fns = [];
            HANDLERS.set(p, fns);
            return Object.freeze({ get value() { return p.value; }, get docked() { return p.rail !== null; },
                                   on(fn) {
                                      if (!setup.open) throw new Error('on() must be called at the top level of the module (the setup pass), not inside a handler');
                                      if (typeof fn !== 'function') throw new Error('on() needs a function');
                                      fns.push(fn);
                                   } });
         },
         output: (name, kind, type = 'any') => {
            const p = declare(name, kind, type, 'out');
            return Object.freeze({ get value() { return p.value; }, set: v => send(p, v, 'state', 'set'), emit: v => send(p, v, 'event', 'emit') });
         },
         state: defaults => {
            const mod = inst.mod;
            if (!setup.open) throw new Error('state() must be called at the top level of the module (the setup pass), not inside a handler');
            if (mod.state) throw new Error('state() is called once per module');
            const r = validState(defaults);
            if (!r.ok) throw new Error(r.error);
            mod.defaults = freezeCopy(defaults);
            return (mod.state = migrate({}, defaults));
         },
         draw: list => {
            const r = validDraw(list);
            if (!r.ok) throw new Error(r.error);
            life.setDraw(inst.mod, list);
         },
         random: () => inst.rng.random(),
         log: text => life.addLog(inst.mod, text),
      };
   }
}
