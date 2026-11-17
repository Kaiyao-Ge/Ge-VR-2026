// The life of a module on the Rails bus, pure and without graphics: registering a compiled
// module, swapping a new version in (hot reload), quarantining one that failed, renaming and
// removing it, and the persistence of the whole bus (snapshot, restore). These
// functions work on a Bus's own tables, so bus.js keeps the delivery rules and this file
// keeps what happens to a module over time. It imports no Bus: the Bus is passed in. It also holds wire(), the rule that
// works out the variables and docks from the modules.
import { TYPES, KINDS, NAME, MAX_VARS, isObject, jsonCopy, migrate, freezeCopy, validState, validDraw, typeOk, compatible, bindingKey } from './values.js';
import { makeRng, hashSeed } from './sandbox.js';

export const NAME_RULE = 'use a-z, 0-9 and _, starting with a letter, at most 32 characters; constructor is reserved';
export const MAX_LOGS = 50, MAX_PORTS = 64, VERSIONS = 10, NOTICES = 8;
export const PAUSED = 'paused: Mod+Shift+Enter continues from here, Mod+P returns to now';
export const goodName = name => typeof name === 'string' && NAME.test(name);
export const keyOf = p => `${p.owner}.${p.name}`;

const DRAW_KEY = new WeakMap();      // module record -> JSON of its draw list, so an unchanged draw is not a change
const sameShape = (a, b) => a.name === b.name && a.dir === b.dir && a.kind === b.kind && a.type === b.type;
// An error as the IDE shows it: the phase it happened in, and no line.
export const failure = (phase, message) => ({ phase, message, line: null, col: null });

// ---- the module record: the read model the IDE draws from ----

export function newRecord(id, source) {
   return { id, ver: 0, source, status: 'ok', error: null, editError: null, ports: [], draw: [], logs: [], calls: 0, rev: 0, state: null, defaults: null };
}

// The JSON of the module's draw list as setDraw saw it (undefined before the first draw): two modules draw the same picture when their keys are equal.
export const drawKey = mod => DRAW_KEY.get(mod);

export function setDraw(mod, list) {
   const key = JSON.stringify(list);
   if (key === DRAW_KEY.get(mod)) return;
   DRAW_KEY.set(mod, key); mod.draw = freezeCopy(list); mod.rev++;
}

export function addLog(mod, text) {
   mod.logs.push(String(text).slice(0, 500));
   if (mod.logs.length > MAX_LOGS) mod.logs.shift();
   mod.rev++;
}

export function setEditError(mod, error) {
   if (!error && !mod.editError) return;
   mod.editError = error; mod.rev++;
}

function replaceKeys(target, source) {
   for (const k of Object.keys(target)) delete target[k];
   for (const k of Object.keys(source)) Object.defineProperty(target, k, { value: source[k], enumerable: true, writable: true, configurable: true });
}

// Notices tell the IDE about things that happened without a command: a `use` dropped by a reload, a card that could not be
// loaded, a message from the host.
export function notice(bus, text) {
   bus.notices.push({ id: ++bus._noticeId, n: bus.n, text });
   if (bus.notices.length > NOTICES) bus.notices.shift();
}

// ---- registering and swapping versions ----

// A module whose setup ran (an instance from Bus._trial) becomes part of the bus. Ranks are given here and
// not when the ports are declared, so a setup that fails leaves no trace. `order` never changes afterwards,
// so a module is called in the same place among the others after any number of reloads and renames.
export function register(bus, inst, wire = true) {
   const mod = inst.mod, id = mod.id;
   const meta = { order: bus._order++, lastVer: 1, versions: [{ ver: 1, source: mod.source }], compiledAs: inst.name };
   mod.ver = 1;
   bus.modules.set(id, mod); bus._rngs.set(id, inst.rng); bus._meta.set(id, meta);
   bus._rankPorts(mod.ports, meta.order);
   for (const p of mod.ports) bus._ports.set(keyOf(p), p);
   mod.rev++; bus.rev++;
   // The module's docks are worked out at once (not a structure op of the user), so that a snapshot taken before the next step
   // already has them. A manual bus has no wiring of its own. (A module made by hand goes on the tape with its source; one that a restore
   // builds is in the snapshot.)
   if (wire) { bus._log({ k: 'addModule', n: bus.n, id, source: mod.source }); bus._reconcile(); }
}

// Swaps a new version in at the start of a step. The state is the running one migrated to the new defaults
// (for a quarantined module that is the checkpoint it was rolled back to), docks follow ports that keep their
// name, direction, kind and type, and the other docks are dropped (and with them a `use` of an input that is gone, with a
// notice). A docked state input is handed its rail's value again so a changed handler can initialise from it, except the
// clock, which publishes in this very step anyway.
export function swap(bus, op) {
   const mod = bus.modules.get(op.id);
   if (!mod) return;
   const meta = bus._meta.get(op.id), inst = op.inst, cand = inst.mod;
   const old = mod.ports, fresh = cand.ports;
   const same = new Map(fresh.map(q => [q, old.find(p => sameShape(p, q))]));
   const kept = new Set(same.values());
   dropUses(bus, mod.id, old.filter(p => p.dir === 'in' && !kept.has(p)));
   for (const p of old) if (p.rail && !kept.has(p)) bus._detach(p, 'orphaned');
   const gone = new Set(old);
   bus.inbox = bus.inbox.filter(m => !gone.has(m.to));
   for (const p of old) { bus._ports.delete(keyOf(p)); bus._rank.delete(p); bus._got.delete(p); }
   bus._rankPorts(fresh, meta.order);
   for (const q of fresh) {
      q.owner = `mod:${mod.id}`;
      bus._ports.set(keyOf(q), q);
      const p = same.get(q);
      if (!p) continue;
      const own = q.value;                          // a value the new source's setup set
      q.value = own !== undefined ? own : p.value;
      if (!p.rail) continue;
      q.rail = p.rail; bus._docked.get(p.rail).delete(p); bus._docked.get(p.rail).add(q);
      const rail = bus.rails.get(q.rail);
      if (q.dir === 'out' && own !== undefined && rail.kind === 'state') bus.inbox.push({ rail: q.rail, kind: 'state', v: own, by: keyOf(q), to: null });
      if (q.dir === 'in' && rail.kind === 'state' && rail.value !== undefined && q.rail !== bus.clockRail) {
         q.value = rail.value; bus.inbox.push({ rail: q.rail, kind: 'state', to: q });
      }
   }
   if (cand.defaults) {
      replaceKeys(cand.state, migrate(op.resetState ? {} : mod.state, cand.defaults));
      mod.state = cand.state; mod.defaults = cand.defaults;
   } else { mod.state = null; mod.defaults = null; }
   Object.assign(mod, { ports: fresh, source: cand.source, status: 'ok', error: null });
   for (const q of fresh) if (q.dir === 'out' && q.rail) bus._restale(bus.rails.get(q.rail));   // a recovered publisher makes its rail live again
   if (cand.draw.length) setDraw(mod, cand.draw);
   for (const line of cand.logs) addLog(mod, line);
   inst.mod = mod; inst.rng = bus._rngs.get(op.id); meta.compiledAs = inst.name;
   mod.ver = ++meta.lastVer;
   const entry = { ver: mod.ver, source: mod.source }, vs = meta.versions;
   if (op.revert && vs.length > 1) vs.splice(-2, 2, entry); else vs.push(entry);
   if (vs.length > VERSIONS) vs.shift();
   bus._checkpoints.delete(op.id);
   mod.rev++; bus.rev++;
   // The tape keeps the source and the reset, so that a replay can make the same reload (replay.js).
   bus._log({ k: 'reload', n: bus.n, mod: op.id, ver: mod.ver, source: mod.source, ...(op.resetState ? { resetState: true } : {}) });
}

// ---- quarantine ----

// The module stops for good until it is reloaded or reverted: no more handlers, nothing delivered to it, docks kept,
// outputs keep their values but their rails go stale, and the state is rolled back to the checkpoint taken before
// its first handler of this step so it is never left half-mutated.
export function quarantine(bus, mod, error) {
   if (mod.status !== 'ok') return;
   mod.status = 'quarantined'; mod.error = error;
   const checkpoint = bus._checkpoints.get(mod.id);
   if (mod.state && typeof checkpoint === 'string') replaceKeys(mod.state, JSON.parse(checkpoint));
   else if (mod.state && !validState(mod.state).ok) replaceKeys(mod.state, migrate({}, mod.defaults));   // no checkpoint to go back to
   const mine = new Set(mod.ports);
   bus.inbox = bus.inbox.filter(m => !mine.has(m.to));
   for (const p of mod.ports) if (p.dir === 'out' && p.rail) bus._staleIfDead(bus.rails.get(p.rail));
   mod.rev++; bus.rev++;
   bus._log({ k: 'quarantine', n: bus.n, mod: mod.id, error });
}

// ---- removing and renaming (applied inside step) ----

export function removeModule(bus, id) {
   const mod = bus.modules.get(id);
   if (!mod) return;
   bus._log({ k: 'removeModule', n: bus.n, id });
   const mine = new Set(mod.ports);
   for (const p of mod.ports) if (p.rail) bus._detach(p, 'module removed');
   bus.inbox = bus.inbox.filter(m => !mine.has(m.to));
   for (const p of mod.ports) { bus._ports.delete(keyOf(p)); bus._rank.delete(p); bus._got.delete(p); }
   bus.modules.delete(id);
   for (const table of [bus._rngs, bus._meta, bus._checkpoints, bus._budget, bus._sent, bus._staged]) table.delete(id);
   bus._sent.delete(`mod:${id}`);
   bus.unplugged.delete(id);
   for (const key of Object.keys(bus.uses)) if (key.startsWith(`${id}.`)) delete bus.uses[key];
   bus.rev++;
}

// A reload that drops inputs also drops their `uses`, with a notice (what a use pointed at has nothing to bind to now).
function dropUses(bus, id, gone) {
   for (const p of gone) {
      const key = bindingKey(id, p.name), variable = bus.uses[key];
      if (variable === undefined) continue;
      delete bus.uses[key];
      notice(bus, `the use of ${key} (${variable}) was dropped: the new source has no input '${p.name}' of kind ${p.kind} and type ${p.type}`);
   }
}

// Renaming keeps the module's place in the Map (it is the registration order that the bus keeps),
// its ports and docks, and rewrites the publisher names the read model still shows.
export function renameModule(bus, id, to) {
   const mod = bus.modules.get(id);
   if (!mod || bus.modules.has(to)) return;
   bus._log({ k: 'renameModule', n: bus.n, id, to });
   const entries = [...bus.modules];
   bus.modules.clear();
   for (const [k, v] of entries) bus.modules.set(k === id ? to : k, v);
   for (const table of [bus._rngs, bus._meta, bus._staged]) if (table.has(id)) { table.set(to, table.get(id)); table.delete(id); }
   mod.id = to;
   const from = `mod:${id}`, now = `mod:${to}`, fix = by => (typeof by === 'string' && by.startsWith(`${from}.`) ? now + by.slice(from.length) : by);
   for (const p of mod.ports) { bus._ports.delete(keyOf(p)); p.owner = now; bus._ports.set(keyOf(p), p); }
   for (const rail of bus.rails.values()) { rail.by = fix(rail.by); rail.writers = rail.writers.map(fix); }
   for (const m of bus.inbox) if (m.by) m.by = fix(m.by);
   renameUses(bus.uses, id, to);
   if (bus.unplugged.delete(id)) bus.unplugged.add(to);
   mod.rev++; bus.rev++;
}

// The `uses` keys of a card follow its new name.
function renameUses(uses, id, to) {
   for (const key of Object.keys(uses)) {
      if (!key.startsWith(`${id}.`)) continue;
      uses[`${to}.${key.slice(id.length + 1)}`] = uses[key]; delete uses[key];
   }
}

// How the queued module ops change the picture of ports and docks that checks run against (see Bus._view).
export function projectModule(view, op) {
   if (view.mods) projectAuto(view, op);
   const { docks, ports } = view;
   const mine = id => [...ports.keys()].filter(k => k.startsWith(`mod:${id}.`));
   if (op.k === 'removeModule') for (const k of mine(op.id)) { docks.delete(k); ports.delete(k); }
   if (op.k === 'renameModule') {
      for (const k of mine(op.id)) {
         const to = `mod:${op.to}.${k.slice(`mod:${op.id}.`.length)}`;
         docks.set(to, docks.get(k)); ports.set(to, ports.get(k)); docks.delete(k); ports.delete(k);
      }
   }
   if (op.k === 'reload') {
      const fresh = op.inst.mod.ports;
      for (const k of mine(op.id)) {
         const old = ports.get(k);
         if (!fresh.some(q => sameShape(old, q))) { docks.delete(k); ports.delete(k); }
      }
      for (const q of fresh) { const k = `mod:${op.id}.${q.name}`; ports.set(k, q); if (!docks.has(k)) docks.set(k, null); }
   }
}

// The same for a bus that wires itself: the modules' ports, `uses` and `unplugged` of the view.
function projectAuto(view, op) {
   const { mods, uses, unplugged } = view;
   if (op.k === 'removeModule') {
      mods.delete(op.id); unplugged.delete(op.id);
      for (const key of Object.keys(uses)) if (key.startsWith(`${op.id}.`)) delete uses[key];
   }
   if (op.k === 'renameModule') {
      const entries = [...mods];
      mods.clear();
      for (const [k, ports] of entries) mods.set(k === op.id ? op.to : k, ports);
      renameUses(uses, op.id, op.to);
      if (unplugged.delete(op.id)) unplugged.add(op.to);
   }
   if (op.k === 'reload' && mods.has(op.id)) {
      const fresh = op.inst.mod.ports;
      for (const p of mods.get(op.id)) if (p.dir === 'in' && !fresh.some(q => sameShape(p, q))) delete uses[bindingKey(op.id, p.name)];
      mods.set(op.id, fresh);
   }
}

// ---- the wiring ----

// Works out, from a view (see Bus._baseView), the variables and docks of a bus that wires itself: {vars, docks, problems}.
//   vars: name -> {kind, type, pubs, takers}, the variables that will exist (built-ins, the ones with a publisher, the ones a
//         card still takes); `pubs` and `takers` are card ids, oldest card first.
//   docks: 'mod:card.port' -> variable name or null, for every port of every card: outputs first, then inputs, in card order.
//   problems: card id -> the first reason one of its outputs gets no variable.
// The rules: a plugged output makes its variable, whose kind and type are the first publisher's; any other output of that name
// must match exactly (`any` matches only `any`). A variable that exists keeps its shape while a card publishes or takes it; one
// that nothing holds will be swept by the end of the step, so it takes the next publisher's shape. An input takes `uses[its key]`
// or else the variable of its own name, if that fits it (compatible); if it does not exist or fits badly the input waits.
// An unplugged card has no docks. A built-in name is never a user's output, and there are at most MAX_VARS variables.
// With `last`, that card's outputs are looked at last, so a conflict is always found in the card that is being added.
export function wire(view, last = null) {
   const { mods, uses, unplugged, rails, docks: held, builtins } = view;
   const vars = new Map(), docks = new Map(), problems = new Map();
   for (const [name, r] of rails) vars.set(name, { kind: r.kind, type: r.type, pubs: [], takers: [] });
   const key = (id, p) => `mod:${id}.${p.name}`, shape = x => `${x.kind} ${x.type}`;
   const plugged = [...mods.keys()].filter(id => !unplugged.has(id));
   for (const id of mods.keys()) if (unplugged.has(id)) for (const p of mods.get(id)) docks.set(key(id, p), null);
   // who holds a variable now (an output that stays docked to it), and who takes it
   const want = (id, p) => uses[bindingKey(id, p.name)] || p.name;
   for (const id of plugged) for (const p of mods.get(id)) {
      const v = vars.get(p.name);
      if (p.dir === 'out' && v && held.get(key(id, p)) === p.name && shape(v) === shape(p)) { v.pubs.push(id); docks.set(key(id, p), p.name); }
   }
   for (const id of plugged) for (const p of mods.get(id)) {
      const v = p.dir === 'in' && vars.get(want(id, p));
      if (v && compatible(p, v).ok && !v.takers.includes(id)) v.takers.push(id);
   }
   let count = 0;
   for (const [name, v] of vars) if (builtins.has(name) || v.pubs.length || v.takers.length) count++;
   const order = last && plugged.includes(last) ? [...plugged.filter(id => id !== last), last] : plugged;
   for (const id of order) for (const p of mods.get(id)) {
      if (p.dir !== 'out' || docks.has(key(id, p))) continue;
      const refuse = text => { if (!problems.has(id)) problems.set(id, text); docks.set(key(id, p), null); };
      if (builtins.has(p.name)) { refuse(`${p.name} is built in`); continue; }
      let v = vars.get(p.name);
      const free = !v || (!v.pubs.length && !v.takers.length);
      if (free && count >= MAX_VARS) { refuse(`too many variables (${MAX_VARS})`); continue; }
      if (free) { count++; v = Object.assign(v || { pubs: [], takers: [] }, { kind: p.kind, type: p.type }); vars.set(p.name, v); }
      else if (shape(v) !== shape(p)) { refuse(v.pubs.length ? `${p.name} is ${shape(p)} here but ${shape(v)} in ${v.pubs[0]}` : `${p.name} is ${shape(v)} (taken by ${v.takers[0]}), but ${shape(p)} here`); continue; }
      v.pubs.push(id); docks.set(key(id, p), p.name);
   }
   for (const id of plugged) for (const p of mods.get(id)) {
      if (p.dir !== 'in') continue;
      const name = want(id, p), v = vars.get(name), bound = v && compatible(p, v).ok;
      docks.set(key(id, p), bound ? name : null);
      if (bound && !v.takers.includes(id)) v.takers.push(id);
   }
   for (const [name, v] of vars) if (!builtins.has(name) && !v.pubs.length && !v.takers.length) vars.delete(name);
   return { vars, docks, problems };
}

// ---- persistence ----

const byPort = (a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0);
const dockList = bus => [...bus._ports.values()].filter(p => p.rail).map(p => [p.owner, p.name, p.rail]).sort(byPort);
const isFresh = bus => bus.n === 0 && bus.modules.size === 0 && bus.rails.size === bus.builtins.size && bus.queue.length === 0;
const NOT_FRESH = { ok: false, reason: 'restore needs a fresh Bus: nothing stepped, no modules, no rails but the built-in ones (the clock)' };

const wiringPrefs = bus => ({ uses: { ...bus.uses }, unplugged: [...bus.unplugged].sort() });

// The `uses` and `unplugged` of a layout or snapshot are preferences and are read leniently: what is not of the right shape is
// left out, and once the modules are built the entries of a card that is not there, an input it does not have, or the default
// itself are dropped. An entry for a variable that does not exist yet stays: the input waits for it.
function setPrefs(bus, uses, unplugged) {
   bus.uses = {}; bus.unplugged = new Set();
   for (const [key, variable] of Object.entries(isObject(uses) ? uses : {})) if (goodName(variable) && key.split('.').length === 2 && key.split('.').every(goodName)) bus.uses[key] = variable;
   for (const id of Array.isArray(unplugged) ? unplugged : []) if (goodName(id)) bus.unplugged.add(id);
}

function prunePrefs(bus) {
   for (const [key, variable] of Object.entries(bus.uses)) {
      const [id, port] = key.split('.'), mod = bus.modules.get(id);
      if (!mod || variable === port || !mod.ports.some(p => p.name === port && p.dir === 'in')) delete bus.uses[key];
   }
   for (const id of [...bus.unplugged]) if (!bus.modules.has(id)) bus.unplugged.delete(id);
}

// Builds rails, modules (compile and setup run again) and docks into a fresh bus, in that order, and reports what it
// could not build instead of throwing. Docks that are already there (the clock's own) stay. (The docks of a bus that wires
// itself come from the modules and `uses`; the list matters for a manual bus, the replay's.)
function build(bus, rails, modules, docks, quiet = false, prefs = null) {
   const errors = [];
   setPrefs(bus, prefs && prefs.uses, prefs && prefs.unplugged);
   const bad = (what, message) => errors.push({ what, message });
   for (const [id, r] of Object.entries(isObject(rails) ? rails : {})) {
      const ok = goodName(id) && isObject(r) && KINDS.includes(r.kind) && TYPES.includes(r.type);
      if (ok && !bus.rails.has(id)) { bus._newRail(id, r.kind, r.type); bus.rev++; } else bad(`rail ${id}`, 'not a rail the bus can build');
   }
   for (const [id, source] of Object.entries(isObject(modules) ? modules : {})) {
      let t = goodName(id) && !bus.modules.has(id) ? bus._trial(id, source, makeRng(hashSeed(bus.seed, id)), quiet) : { ok: false, error: failure('setup', `bad module name '${id}'`) };
      const clash = t.ok && bus._problem(id, view => view.mods.set(id, t.inst.mod.ports));      // a card that clashes with an earlier one is left out
      if (clash) t = { ok: false, error: failure('setup', clash) };
      if (t.ok) register(bus, t.inst, false); else bad(`module ${id}`, t.error.message);
   }
   prunePrefs(bus);
   for (const d of Array.isArray(docks) ? docks : []) {
      const [owner, port, rail] = Array.isArray(d) ? d : [];
      const p = bus._ports.get(`${owner}.${port}`), r = bus.canDock(owner, port, rail);
      if (!p || !r.ok) bad(`dock ${owner}.${port}`, r.reason || 'no such port'); else if (p.rail !== rail) bus._applyDock(p, rail);
   }
   bus._reconcile(true);
   return errors;
}

export function restore(bus, layoutIn) {
   if (!isFresh(bus)) return NOT_FRESH;
   const l = isObject(layoutIn) ? layoutIn : {};
   const errors = build(bus, l.rails, l.modules, l.docks, false, l);
   return { ok: errors.length === 0, errors };
}

// A snapshot must never throw, even for a state that is not JSON (it is quarantined and rolled back, but never trust that here).
function safeCopy(state) {
   try { return state ? freezeCopy(state) : null; } catch (err) { return null; }
}

// The running world at one moment, as plain data that survives JSON: rail values with their bookkeeping, each module's
// state copy, generator, status and last output values, the docks, and the last value of every device output.
export function snapshot(bus) {
   const rails = {}, modules = {}, devices = {};
   for (const [id, r] of bus.rails) {
      rails[id] = { kind: r.kind, type: r.type, value: r.value, by: r.by, seq: r.seq, stale: r.stale, contested: r.contested, writers: [...r.writers] };
   }
   for (const [id, m] of bus.modules) {
      // `draw` is the list as it stands (already frozen, so kept by reference): a module that draws only now and then is still drawn after a restore.
      modules[id] = { ver: m.ver, state: safeCopy(m.state), rng: bus._rngs.get(id).state, status: m.status, draw: m.draw };
      // The last value each state output set: a later dock of the port puts it on the new rail, so it is part of the world (already
      // validated and frozen when it was set, so at most 4096 bytes each and 64 ports: within the limits). Only when there is one.
      const outs = {};
      for (const p of m.ports) if (p.dir === 'out' && p.kind === 'state' && p.value !== undefined) outs[p.name] = p.value;
      if (Object.keys(outs).length) modules[id].outs = outs;
   }
   for (const [id, d] of bus.devices) {
      devices[id] = {};
      for (const p of d.ports) if (p.value !== undefined) devices[id][p.name] = p.value;
   }
   return { n: bus.n, t: bus.t, rails, modules, docks: dockList(bus), devices, ...wiringPrefs(bus) };
}

// Rebuilds a snapshot into a fresh bus: structure from the snapshot's rails and docks, sources from the layout,
// setup runs again (what it sets or emits is ignored), then the saved state, generators, rail values and device
// values are filled in. With {migrate: true} the saved state is migrated to the source's defaults (for a source
// that has changed since); with a Set of module ids, only those are; otherwise it is copied as it was.
export function restoreSnapshot(bus, snap, layoutIn, { migrate: migrating = false } = {}) {
   if (!isFresh(bus)) return NOT_FRESH;
   if (!isObject(snap) || !isObject(snap.rails) || !isObject(snap.modules) || !Number.isInteger(snap.n)) return { ok: false, reason: 'not a snapshot', errors: [] };
   const sources = isObject(layoutIn) && isObject(layoutIn.modules) ? layoutIn.modules : {};
   const wanted = {}, errors = [];
   for (const id of Object.keys(snap.modules)) {
      if (typeof sources[id] === 'string') wanted[id] = sources[id]; else errors.push({ what: `module ${id}`, message: 'the layout has no source for it' });
   }
   const rails = {};
   for (const [id, r] of Object.entries(snap.rails)) if (!bus.builtins.has(id)) rails[id] = r;
   // The bus's own `uses` and `unplugged` win over the layout's, which supplies the sources.
   const prefs = Array.isArray(snap.unplugged) || isObject(snap.uses) ? snap : layoutIn;
   errors.push(...build(bus, rails, wanted, snap.docks, true, prefs));
   for (const [id, s] of Object.entries(snap.modules)) fillModule(bus, id, s, migrating === true || (migrating instanceof Set && migrating.has(id)));
   fillRails(bus, snap.rails);
   for (const [id, ports] of Object.entries(isObject(snap.devices) ? snap.devices : {})) {
      for (const p of bus.devices.has(id) ? bus.devices.get(id).ports : []) if (isObject(ports) && ports[p.name] !== undefined) p.value = freezeCopy(ports[p.name]);
   }
   bus.n = snap.n; bus.rev++;
   return { ok: errors.length === 0, errors };
}

function fillModule(bus, id, s, migrating) {
   const mod = bus.modules.get(id), meta = bus._meta.get(id);
   if (!mod || !isObject(s)) return;
   mod.ver = meta.lastVer = s.ver; meta.versions = [{ ver: s.ver, source: mod.source }];
   if (mod.state && isObject(s.state)) replaceKeys(mod.state, migrating ? migrate(s.state, mod.defaults) : jsonCopy(s.state));
   if (Number.isInteger(s.rng)) bus._rngs.get(id).state = s.rng;
   if (isObject(s.outs)) for (const p of mod.ports) if (p.dir === 'out' && p.kind === 'state' && Object.hasOwn(s.outs, p.name) && typeOk(p.type, s.outs[p.name])) p.value = freezeCopy(s.outs[p.name]);
   if (Array.isArray(s.draw) && validDraw(s.draw).ok) setDraw(mod, s.draw);
   if (s.status === 'quarantined') { mod.status = 'quarantined'; mod.error = failure('handler', 'quarantined before this snapshot was taken'); }
}

// Rail values come back as they were, and every docked state input has received the rail's latest delivery, so none
// is handed the value again. A state output's own value is the one the snapshot kept (`outs`), else, and while it is docked, where the rail says it published last.
function fillRails(bus, saved) {
   for (const [id, rail] of bus.rails) {
      const s = saved[id];
      if (!isObject(s)) continue;
      Object.assign(rail, { value: s.value === undefined ? undefined : freezeCopy(s.value), by: s.by === undefined ? null : s.by, seq: s.seq, stale: !!s.stale,
                            contested: !!s.contested, writers: Array.isArray(s.writers) ? [...s.writers] : [] });
   }
   for (const [id, rail] of bus.rails) {
      if (rail.kind !== 'state' || rail.value === undefined) continue;
      for (const p of bus._docked.get(id)) if (p.dir === 'in') { p.value = rail.value; bus._got.set(p, rail.seq); }
      const publisher = bus._ports.get(rail.by);
      if (publisher && publisher.dir === 'out' && (publisher.value === undefined || publisher.rail === id)) publisher.value = rail.value;   // (an undocked output's own `outs` is the better word)
   }
}
