// The runtime host: the laptop page's side of the runtime. The Runtime itself runs in a module Web Worker (worker.js)
// at a fixed 60 Hz, so a handler that never returns freezes the Worker and not the page. This host relays the IDE's
// commands and devices (from the Link) to the Worker, the Worker's snaps and acks back to the Link, saves what was
// committed and the layout through the store, and watches the Worker's beats: after 500 ms without one it kills the
// Worker and starts another from the last snapshot, with the module that was probably the culprit quarantined.
// The scene calls link.tick() every frame; the host does not. It has its own timer for the watchdog and the layout
// debounce (every 100 ms), injected so that Node can drive it with a fake clock and a fake Worker.
//
// Messages with the Worker are listed in worker.js. The host adds one field to `init`: `notice`, text for the IDE that
// says a restart happened and why (it reaches the IDE in the next snap's notices).
//
// Saving: a committed source (a `commit`, or an `addModule` that carries a source) or the source a `revert` returns to
// (the Worker attaches it to its ack as `ack.source`; the host does not pass it on to the link) is saved only after the
// Worker acked it as ok and then kept beating for 60 beats (about a second), so a source whose handlers never return,
// or whose loop starts within a second, is never written. That source then becomes the module's `lastGood`, which is
// what a restart runs for it (a restart is given all of `lastGood`); a restart discards what has not settled. The layout (`layoutFile()`, which the Worker sends with its
// once-a-second snapshot) is saved 1 s after it last changed; the first one seen is the baseline, so that starting
// does not write, unless a structure command was acked before it.
//
// The watchdog: it starts when the Worker's first beat arrives (a Worker that has not beaten at all in 5 s counts as
// hung too, so that a start that never finishes does not leave the laptop dead). Silence of 500 ms (a paused Worker
// still beats) is a hang. A check that comes more than 250 ms after the previous one means the page itself stalled, so
// the beats may be waiting in its queue; it gives the Worker a fresh 500 ms instead of blaming it.
// Restart rules: the hung module is the one whose commit is in flight (no ack yet, else the latest not yet saved),
// else the most recently committed one. A hang that is the fourth restart within 10 s restarts once with every module
// quarantined; if that one hangs as well, the host stops (stats.stopped) until setActive(true): the IDE gets a last snap
// with the notice STOPPED (again on every 'pair'), and every later command is nacked with that reason. A restart (and a
// stop) nacks every command that had not been acked, as `worker restarted: <reason>`, so the IDE does not wait for ever.
// A makeWorker that throws is counted and handled like a stop (notice, nack, setActive(true) tries again).
// Notice ids and snap revs go on across restarts (init carries noticeBase and revBase), so an IDE that skips what it has
// seen never swallows a restart or a stop notice. lastSnap() is the last snap sent to the IDE, for the laptop's log line.
import { isObject, isVec3, errText } from './values.js';

const WATCH_MS = 100, SILENT_MS = 500, FIRST_BEAT_MS = 5000, STALL_MS = 250, SETTLE_BEATS = 60;
const LAYOUT_MS = 1000, WINDOW_MS = 10000, MAX_RESTARTS = 3, MAX_CARDS = 16, MAX_OPEN = 256;
export const STOPPED = 'runtime stopped after repeated hangs — reload the laptop page';
const STRUCTURE = new Set(['addModule', 'rmModule', 'renameModule', 'use', 'plug', 'geometry']);


export function createRuntimeHost({ link, store, now, seed = 1, setInterval: every = globalThis.setInterval, clearInterval: stopEvery = globalThis.clearInterval,
                                    makeWorker = () => new Worker(new URL('./worker.js', import.meta.url), { type: 'module' }) }) {
   const stats = { active: false, restarts: 0, stopped: false, beats: 0, workerErrors: 0, lastError: null, lastRestart: null,
                   saved: { modules: 0, layout: 0 }, problem: null, pointer: { pos: [0, 0, 0], down: false } };
   let wanted = true, loaded = false, starting = null;
   let worker = null, watch = null, firstBeat = false, lastBeat = 0, lastCheck = 0;     // (before the first beat, lastBeat is when the Worker started)
   let layout = {}, snapshot = null;                  // the newest the Worker told us (or the file's layout, at first)
   let lastGood = {}, lastCommitted = null;           // module -> the source it runs (loaded or committed and settled)
   let pending = [];                                  // commits not saved yet: { cmd, module, source, acked, beats }
   let open = new Map();                              // cmd id -> the command, until its ack
   let restartTimes = [], allQuarantined = false, stopText = null, lastSnap = null;
   let noticeMax = 0, revMax = 0;                     // the highest notice id and snap rev relayed: a new Worker numbers on from them
   let savedJson = null, dirty = null, touched = false;   // the layout: what we think is on disk, what waits to be saved

   const post = m => { if (worker) worker.postMessage(m); };
   const cards = () => Object.keys(isObject(layout.cards) ? layout.cards : {});
   const saveModule = (name, source) => { stats.saved.modules++; Promise.resolve(store.saveModule(name, source)).catch(() => {}); };

   // ---- the Worker --------------------------------------------------------------------------------------------------
   const spawn = ({ hung = [], notice = null } = {}) => {
      let w;
      try { w = makeWorker(); }
      catch (err) {
         stats.workerErrors++; stats.lastError = `could not start the Worker: ${errText(err).slice(0, 150)}`;
         worker = null; giveUp(`runtime could not start (${stats.lastError}) — reload the laptop page`);
         return;
      }
      worker = w; firstBeat = false; lastBeat = lastCheck = now();
      pending = []; open = new Map(); touched = false;
      w.onmessage = e => { if (w === worker && e && isObject(e.data)) fromWorker(e.data); };
      w.onerror = e => { if (w === worker) { stats.workerErrors++; stats.lastError = errText(e).slice(0, 200); } };
      const init = { type: 'init', seed, layout, sources: { ...lastGood }, snapshot, hung, noticeBase: noticeMax, revBase: revMax };
      if (notice) init.notice = notice;
      w.postMessage(init);
      if (stats.pointer.pos.some(x => x !== 0)) post({ type: 'dev', id: 'pointer', port: 'pos', value: stats.pointer.pos });
      if (stats.pointer.down) post({ type: 'dev', id: 'pointer', port: 'down', value: true });
      if (watch === null) watch = every(check, WATCH_MS);
      stats.active = true;
   };

   const killWorker = () => { const w = worker; worker = null; if (w) w.terminate(); };

   const teardown = () => {
      killWorker();
      if (watch !== null) { stopEvery(watch); watch = null; }
      pending = []; open = new Map(); dirty = null; stats.active = false;
   };

   // ---- messages from the Worker ------------------------------------------------------------------------------------
   const fromWorker = m => {
      if (firstBeat) lastBeat = now();           // any message is a sign of life: a long command that has just been answered must not meet a watchdog that still counts from before it
      if (m.type === 'beat') onBeat();
      else if (m.type === 'snap') { lastSnap = m.snap; track(m.snap); if (link.mutual !== false) link.sendSnap(m.snap); }   // a peer that does not hear us gets a full one on 'pair'
      else if (m.type === 'ack') onAck(m);
      else if (m.type === 'snapshot') onSnapshot(m);
   };

   const track = snap => {
      if (Number.isSafeInteger(snap.rev) && snap.rev > revMax) revMax = snap.rev;
      if (Array.isArray(snap.notices)) for (const n of snap.notices) if (isObject(n) && Number.isSafeInteger(n.id) && n.id > noticeMax) noticeMax = n.id;
   };

   const onBeat = () => {
      stats.beats++; firstBeat = true; lastBeat = now();
      if (!pending.length) return;
      for (const p of pending) if (p.acked) p.beats++;
      const done = pending.filter(p => p.acked && p.beats >= SETTLE_BEATS && typeof p.source === 'string');
      if (!done.length) return;
      pending = pending.filter(p => !done.includes(p));
      for (const p of done) { lastGood[p.module] = p.source; lastCommitted = p.module; saveModule(p.module, p.source); }
   };

   const onAck = m => {
      const c = open.get(m.cmd);
      open.delete(m.cmd);
      link.sendAck(m.cmd, m.ok, m.reason);
      if (!c) return;
      const entry = pending.find(p => p.cmd === m.cmd && !p.acked);
      if (!m.ok) { if (entry) pending = pending.filter(p => p !== entry); return; }
      if (entry) entry.acked = true;
      else if (c.op === 'revert' && typeof m.source === 'string') pending.push({ cmd: c.id, module: c.module, source: m.source, acked: true, beats: 0 });
      if (STRUCTURE.has(c.op)) touched = true;
      if (c.op === 'renameModule') {
         for (const p of pending) if (p.module === c.module) p.module = c.to;
         if (lastCommitted === c.module) lastCommitted = c.to;
         if (typeof lastGood[c.module] === 'string') { lastGood[c.to] = lastGood[c.module]; delete lastGood[c.module]; saveModule(c.to, lastGood[c.to]); }
      } else if (c.op === 'rmModule') {
         delete lastGood[c.module]; pending = pending.filter(p => p.module !== c.module);
         if (lastCommitted === c.module) lastCommitted = null;
      }
   };

   const onSnapshot = m => {
      if (!isObject(m.snap) || !isObject(m.layout)) return;
      snapshot = m.snap; layout = m.layout;
      const json = JSON.stringify(m.layout);
      if (savedJson === null) { savedJson = json; if (touched) dirty = { layout: m.layout, json, at: now() }; }
      else if (json !== (dirty ? dirty.json : savedJson)) dirty = { layout: m.layout, json, at: now() };
      touched = false;
   };

   // ---- from the Link -----------------------------------------------------------------------------------------------
   link.on('cmd', m => {
      if (!m || !isObject(m.cmd)) return;
      const c = m.cmd;
      if (!worker) { if (stopText !== null && wanted) link.sendAck(c.id, false, stopText); return; }
      if (open.size >= MAX_OPEN) open.delete(open.keys().next().value);
      open.set(c.id, c);
      if (c.op === 'commit' || (c.op === 'addModule' && typeof c.source === 'string'))
         pending.push({ cmd: c.id, module: c.module, source: c.source, acked: false, beats: 0 });
      post({ type: 'cmd', cmd: c });
   });
   link.on('dev', m => {
      if (!worker || !m) return;
      if (m.id === 'pointer') { if (m.port !== 'down') return; stats.pointer.down = m.value === true; }   // the laptop owns the position
      post({ type: 'dev', id: m.id, port: m.port, value: m.value });
   });
   link.on('release', () => { if (worker && stats.pointer.down) post({ type: 'dev', id: 'pointer', port: 'down', value: false }); stats.pointer.down = false; });   // (a silent or blurred headset cannot say it let go)
   link.on('pair', () => { if (worker) post({ type: 'full' }); else if (stopText !== null && wanted && lastSnap) link.sendSnap(lastSnap); });

   // ---- the watchdog and the layout debounce ------------------------------------------------------------------------
   const check = () => {
      const t = now();
      if (dirty && t - dirty.at >= LAYOUT_MS && worker) {
         const d = dirty; dirty = null; savedJson = d.json; stats.saved.layout++;
         Promise.resolve(store.saveLayout(d.layout)).catch(() => {});
      }
      if (!worker) return;
      const stalled = t - lastCheck > STALL_MS;
      lastCheck = t;
      if (stalled) { lastBeat = t; return; }
      if (!firstBeat) { if (t - lastBeat >= FIRST_BEAT_MS) hang(`no first beat in ${FIRST_BEAT_MS / 1000} s`); }
      else if (t - lastBeat >= SILENT_MS) hang(`no beat for ${Math.round(t - lastBeat)} ms`);
   };

   const culprit = () => {
      const unacked = pending.filter(p => !p.acked), p = unacked.length ? unacked[unacked.length - 1] : pending[pending.length - 1];
      return p ? p.module : lastCommitted;
   };

   // Every command that was relayed and not answered gets a failure ack, so the IDE's pending list does not wait for ever.
   const nackOpen = reason => {
      for (const id of open.keys()) link.sendAck(id, false, reason);
      open = new Map();
   };

   // The host gives up: no Worker, every later command is nacked with `text`, and the IDE is told through a last snap that
   // carries the notice (the Worker's own notices came from the Runtime that is gone, so this one is made here).
   const giveUp = text => {
      stats.stopped = true; stopText = text; stats.active = false;
      if (watch !== null) { stopEvery(watch); watch = null; }
      const old = lastSnap && Array.isArray(lastSnap.notices) ? lastSnap.notices : [];
      const id = ++noticeMax;
      lastSnap = { ...(lastSnap || {}), rev: ++revMax, notices: [...old, { id, n: Number.isFinite(lastSnap && lastSnap.t) ? Math.round(lastSnap.t * 60) : 0, text }].slice(-8) };
      if (link.mutual !== false) link.sendSnap(lastSnap);
   };

   const hang = reason => {
      const t = now();
      restartTimes = restartTimes.filter(x => t - x < WINDOW_MS);
      if (restartTimes.length < MAX_RESTARTS) allQuarantined = false;
      let hung, text;
      if (restartTimes.length >= MAX_RESTARTS) {
         if (allQuarantined) {
            stats.lastError = `stopped: ${reason}`; stats.lastRestart = { at: t, reason: `${reason}; given up after repeated hangs`, hung: [] };
            nackOpen(`worker restarted: ${reason}`); teardown(); giveUp(STOPPED);
            return;
         }
         allQuarantined = true; hung = cards();
         text = `worker restarted (${reason}); too many hangs, every module quarantined`;
      } else {
         const id = culprit();
         hung = id === null || id === undefined ? [] : [id];
         text = `worker restarted (${reason})${hung.length ? `; quarantined: ${hung.join(', ')}` : ''}`;
      }
      restartTimes.push(t); stats.restarts++;
      stats.lastRestart = { at: t, reason, hung: [...hung] }; stats.lastError = `restart: ${reason}`;
      nackOpen(`worker restarted: ${reason}`);
      killWorker();
      spawn({ hung, notice: text });
   };

   // ---- the interface -----------------------------------------------------------------------------------------------
   const run = () => {
      restartTimes = []; allQuarantined = false; stats.stopped = false; stopText = null; snapshot = null;
      spawn();
   };

   return {
      stats,
      // Loads the layout and the module sources through the store, then starts the Worker (unless setActive(false) came first).
      start() {
         return starting ||= (async () => {
            const file = await store.loadLayout();
            stats.problem = store.problem || null;
            // A layout that could not be read is not an empty one: starting from nothing would show the IDE no cards and the first
            // save would overwrite the file. The host reports it and stays idle; the scene builds a new one when it is wanted again.
            if (store.failed) { stats.lastError = `runtime not started: ${stats.problem}`; throw new Error(stats.lastError); }
            layout = isObject(file) ? file : {};
            lastGood = {};
            for (const id of cards().slice(0, MAX_CARDS)) { const text = await store.loadModule(id); if (typeof text === 'string') lastGood[id] = text; }
            loaded = true; savedJson = null;
            if (wanted && !worker) run();
         })();
      },
      // The laptop's pointer position (a vec3), once a frame; the IDE feeds `pointer.down`. Only changes go to the Worker.
      feedPointer(pos) {
         if (!isVec3(pos) || pos.every((x, i) => x === stats.pointer.pos[i])) return;
         stats.pointer.pos = [...pos];
         post({ type: 'dev', id: 'pointer', port: 'pos', value: [...pos] });
      },
      // The runtime role runs the Worker, relays and saves; any other role does none of it.
      setActive(on) {
         wanted = !!on;
         if (!loaded) return;
         if (wanted && !worker) run();
         else if (!wanted) teardown();
      },
      // Asks the Worker for a full snapshot, as a 'pair' does (the scene uses it after it dropped snaps). Nothing when there is no Worker.
      resend: () => post({ type: 'full' }),
      // The last snap that went (or was due to go) to the IDE, or null; for the log line. Do not change it.
      lastSnap: () => lastSnap,
      // The watchdog and the layout save, for a caller that wants to drive them (it also runs on its own timer).
      tick: check,
   };
}
