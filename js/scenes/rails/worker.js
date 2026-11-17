// The Web Worker that runs the Rails runtime on the laptop, so that an infinite loop in user code can never freeze the
// page: the page (runtimeHost.js) watches the beats this Worker posts and, when they stop, kills it and starts another.
// The Worker is a thin shell around the pure Runtime (runtime.js); everything it does is in workerCore, which takes its
// way of posting, its timers and its clock as arguments so that Node can run it with a fake interval.
//
// In (the page -> the Worker):
//    init     { seed, layout, sources, snapshot|null, hung: [id], notice?, noticeBase?, revBase? }   builds a Runtime and starts stepping.
//             With a `snapshot` (the bus's, see Bus.snapshot) the run carries on from there; otherwise from layout + sources.
//             Each `hung` id is quarantined with the error { phase: 'handler', message: 'hung (infinite loop?)' } and keeps
//             running the source it is given (the last good one); setup of the source that hung is never called. A hung
//             module that is given no source had no earlier version: it is left out (card, docks, snapshot entry) and a
//             notice says so. `notice` is text for the IDE (why the Worker was restarted), added after the load.
//    cmd      { cmd }       a command of the IDE (the inner object); answered with an ack
//    dev      { id, port, value }
//    full     {}            forget what was sent, so the next snaps carry everything (the IDE paired or came back)
// Out (the Worker -> the page):
//    ack      { cmd, ok, reason?, source? }   (source: only for a revert that succeeded, the source it runs from now on)
//    beat     { n, paused }       on EVERY timer tick (60 Hz), paused or not: the page's proof of life
//    snap     { snap }            every second tick (30 Hz): the incremental snapshot for the IDE
//    snapshot { snap, layout }    once a second: the bus's restorable snapshot and the layout file, for a restart
// A tick takes the steps that are due (60 per second of the clock) but at most 4, so a Worker that was slow does not
// run a burst to catch up. The beat is posted last, so that a beat means the whole tick finished.
import { Runtime } from './runtime.js';
import { quarantine, failure } from './lifecycle.js';
import { isObject, jsonCopy } from './values.js';

export const HUNG = 'hung (infinite loop?)';
export const STEP_MS = 1000 / 60;
export const MAX_CATCH_UP = 4;
const SNAP_EVERY = 2, SNAPSHOT_EVERY = 60;

// Removes what mentions the modules in `gone` from a layout file ({cards, uses, unplugged}, or an old one with docks) and from a bus snapshot.
function leaveOut(layout, snapshot, gone) {
   const owns = owner => gone.includes(owner) || (typeof owner === 'string' && owner.startsWith('mod:') && gone.includes(owner.slice(4)));
   for (const id of gone) if (isObject(layout.cards)) delete layout.cards[id];
   if (Array.isArray(layout.docks)) layout.docks = layout.docks.filter(d => !(Array.isArray(d) && owns(d[0])));
   const wiring = o => {
      if (isObject(o.uses)) for (const key of Object.keys(o.uses)) if (gone.includes(key.split('.')[0])) delete o.uses[key];
      if (Array.isArray(o.unplugged)) o.unplugged = o.unplugged.filter(id => !gone.includes(id));
   };
   wiring(layout);
   if (snapshot) {
      for (const id of gone) delete snapshot.modules[id];
      if (Array.isArray(snapshot.docks)) snapshot.docks = snapshot.docks.filter(d => !(Array.isArray(d) && owns(d[0])));
      wiring(snapshot);
   }
}

export function workerCore({ post, setInterval: every, clearInterval: stopEvery, now = () => performance.now() }) {
   let rt = null, timer = null, ticks = 0, acc = 0, prev = 0;

   const tick = () => {
      const t = now();
      acc += Math.min(Math.max(t - prev, 0), MAX_CATCH_UP * STEP_MS);
      prev = t;
      for (let k = 0; k < MAX_CATCH_UP && acc >= STEP_MS - 1e-6; k++) { rt.step(); acc -= STEP_MS; }
      acc = Math.min(Math.max(acc, 0), STEP_MS);
      ticks++;
      if (ticks % SNAP_EVERY === 0) post({ type: 'snap', snap: rt.snapshot() });
      if (ticks % SNAPSHOT_EVERY === 0) post({ type: 'snapshot', snap: rt.bus.snapshot(), layout: rt.layoutFile() });
      post({ type: 'beat', n: ticks, paused: rt.bus.paused });
   };

   const init = m => {
      if (timer !== null) stopEvery(timer);
      timer = null;
      const layout = isObject(m.layout) ? jsonCopy(m.layout) : {}, sources = isObject(m.sources) ? m.sources : {};
      const hung = Array.isArray(m.hung) ? m.hung.filter(id => typeof id === 'string') : [];
      let snapshot = isObject(m.snapshot) && Number.isInteger(m.snapshot.n) && isObject(m.snapshot.rails) && isObject(m.snapshot.modules) ? jsonCopy(m.snapshot) : null;
      const cards = isObject(layout.cards) ? layout.cards : {};
      const known = id => Object.hasOwn(cards, id) || (snapshot && Object.hasOwn(snapshot.modules, id));
      const noEarlier = hung.filter(id => known(id) && typeof sources[id] !== 'string');
      leaveOut(layout, snapshot, noEarlier);
      rt = new Runtime({ seed: Number.isFinite(m.seed) ? m.seed : 1, bases: { notice: m.noticeBase, rev: m.revBase } });
      rt.load({ layout, sources, snapshot });
      for (const id of hung) {
         const mod = rt.bus.modules.get(id);
         if (mod) quarantine(rt.bus, mod, failure('handler', HUNG));
      }
      for (const id of noEarlier) rt.addNotice(`module '${id}' hung and has no earlier version: left out`);
      if (typeof m.notice === 'string' && m.notice) rt.addNotice(m.notice);
      ticks = 0; acc = 0; prev = now();
      timer = every(tick, STEP_MS);
   };

   // The ack of a command. A `revert` that succeeded also carries `source`, the version it goes back to (the bus applies it
   // at the next step, so it is read before the command): the host saves it like a commit and strips it before the link.
   const ackOf = cmd => {
      let source;
      if (isObject(cmd) && cmd.op === 'revert' && typeof cmd.module === 'string') {
         const v = rt.bus.versions(cmd.module);
         if (v.length >= 2) source = v[v.length - 2].source;
      }
      const ack = rt.handle(cmd);
      return ack.ok && source !== undefined ? { type: 'ack', ...ack, source } : { type: 'ack', ...ack };
   };

   const onmessage = e => {
      const m = e && e.data;
      if (!isObject(m) || typeof m.type !== 'string') return;
      if (m.type === 'init') return init(m);
      if (!rt) return;
      if (m.type === 'cmd') post(ackOf(m.cmd));
      else if (m.type === 'dev') rt.setDevice(m.id, m.port, m.value);
      else if (m.type === 'full') rt.full();
   };

   return { onmessage, get runtime() { return rt; } };
}

// Installed only inside a real Worker, never when the file is loaded by Node or by a page.
if (typeof WorkerGlobalScope !== 'undefined' && typeof self !== 'undefined' && self instanceof WorkerGlobalScope) {
   const core = workerCore({ post: m => self.postMessage(m), setInterval: (fn, ms) => self.setInterval(fn, ms),
                             clearInterval: id => self.clearInterval(id), now: () => performance.now() });
   self.onmessage = core.onmessage;
}
