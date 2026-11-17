// Rails: a spatial IDE for a Quest headset and a laptop (design: doc/hw9-v2-design.md). The same scene runs on both. The
// headset is the IDE (renders the cards, takes the gaze, keeps the text buffers); the laptop is the runtime (runs the
// user's modules in a Worker, saves them, and sends its real keyboard and trackpad to the headset). This file creates the
// parts at load and switches them by role:
//   ide      the IDE is active; the runtime host is not (its Worker is terminated, nothing is saved); no keys are taken.
//   runtime  the runtime host and the terminal are active; the IDE is not, but keeps its buffers and refills from the
//            first full snapshot when it is active again.
//   both     one device alone (a laptop without a headset, say): all three, with the IDE and the host joined by an
//            in-page loopback (rails/loopback.js) and no message to the server but presence.
// The role comes from the Link (rails/link.js): the headset (rank 2: XR, or a Quest's browser) is the IDE, the laptop
// (rank 1) the runtime, a device alone is both; ?railsRole=ide|runtime|both forces it (and a forced `both` sends nothing at all).
// A runtime host that is activated again is a new one, so that it reads the files that the other device saved meanwhile.
// Every 5 s each role sends one line to the server log (rails/report.js). The laptop must keep its window visible: a
// hidden tab stops the page's frames, the Link and the watchdog with them.
import * as cg from '../render/core/cg.js';
import { buttonState, controllerMatrix } from '../render/core/controllerInput.js';
import { Link, rankOf } from './rails/link.js';
import { isMac } from './rails/keymap.js';
import { createStore } from './rails/store.js';
import { createRuntimeHost } from './rails/runtimeHost.js';
import { createTerminal } from './rails/terminal.js';
import { createIde } from './rails/ide.js';
import { createLoopback, routedLink } from './rails/loopback.js';
import { reportOf } from './rails/report.js';
import { errText } from './rails/values.js';
import { isMatrix } from './rails/geom.js';
import { MAT_SIZE } from './rails/layout.js';
import { releaseTextures } from './rails/textures.js';

export const CHANNEL = 'railsLink';
const REPORT_MS = 5000;

let cleanup;
export const init = async (model, ctx = {}, ctxForever = {}) => {
   ctxForever.railsCleanup?.();
   const now = () => performance.now(), xr = () => !!window.isXR?.();
   const params = new URLSearchParams(location.search);
   const mac = isMac(navigator.platform);

   // The link to the other device, over the class server's queue, and the loopback for the parts of one device.
   window.server?.init(CHANNEL, {}, { accumulate: true });
   // What the Link sends waits in this outbox until the frame's sync: the class server sends everything queued between two
   // syncs as ONE message, and sync runs only in frames, which stop in a hidden tab while the Worker goes on making snaps
   // (30 a second). So the outbox keeps every message except `snap`, of which it holds MAX_SNAPS at most: past that it drops
   // all of them, drops the new ones too, and asks the runtime host for one full snapshot after the next sync.
   const MAX_SNAPS = 15;
   const outbox = [];
   let outSnaps = 0, needFull = false;
   const queue = message => {
      if (message.type === 'snap') {
         if (needFull) return;
         if (outSnaps >= MAX_SNAPS) {
            let kept = 0;
            for (const m of outbox) if (m.type !== 'snap') outbox[kept++] = m;
            outbox.length = kept; outSnaps = 0; needFull = true;
            return;
         }
         outSnaps++;
      }
      outbox.push(message);
   };
   const link = new Link({ id: () => window.clientID, clients: () => window.clients || [], now,
      send: queue, rank: rankOf({ xr: xr(), ua: navigator.userAgent }),
      forced: params.get('railsRole'), caps: { mac } });
   const loop = createLoopback({ now, caps: { mac } });
   // A headset that has been paired in this page session does not become `both` when the laptop falls silent (a Wi-Fi drop): a
   // local runtime would load nothing, show the IDE an empty layout and take every card away. It stays the IDE, with no runtime,
   // and waits for the laptop to pair again. (A page that was alone from the start, or is forced, still follows the Link.)
   let everPaired = false;
   const roleOf = () => (everPaired && link.rank === 2 && !link.forced && link.role === 'both' ? 'ide' : link.role);
   link.on('pair', () => { everPaired = true; });
   let role = roleOf(), dead = false;
   const ideLink = routedLink({ real: link, loop, role: () => role, side: 'ide' });
   const terminalLink = routedLink({ real: link, loop, role: () => role, side: 'host' });

   // What the log line says of the cards and rails: the newest of each seen in the snaps (a snap has only what changed).
   const seen = { modules: {}, rails: {}, seqs: {}, paused: null, span: null, last: null, at: now() };
   const tally = snap => {
      if (!snap || typeof snap !== 'object') return;
      for (const [id, m] of Object.entries(snap.modules || {})) seen.modules[id] = m && m.status;
      for (const [id, r] of Object.entries(snap.rails || {}))
         seen.rails[id] = { kind: r.kind, pubs: r.pubs?.length ?? 0, subs: r.subs?.length ?? 0, seq: r.seq };
      const geometry = snap.geometry;
      if (geometry && geometry.cards) for (const id of Object.keys(seen.modules)) if (!Object.hasOwn(geometry.cards, id)) delete seen.modules[id];
      if (Array.isArray(snap.vars)) for (const id of Object.keys(seen.rails)) if (!snap.vars.includes(id)) delete seen.rails[id];
      if (typeof snap.paused === 'boolean') seen.paused = snap.paused;
      if (Array.isArray(snap.window)) seen.span = snap.window[1] - snap.window[0];
   };

   // The IDE: created now, switched by role. It gets the textures it makes in `owned`, to give back on leaving.
   const owned = [];
   const ide = createIde({ model, link: ideLink, owned });
   ideLink.on('snap', m => tally(m.snap));

   // The runtime host: one at a time, a fresh one for each time the runtime is wanted (it loads the committed files then).
   const store = createStore({ fetch: (...args) => window.fetch(...args) });
   let part = null, restarts = 0, errors = 0, lastError = '';
   const startHost = () => {
      const hostLink = routedLink({ real: link, loop, role: () => role, side: 'host' });
      const host = createRuntimeHost({ link: hostLink, store, now });
      part = { host, link: hostLink };
      host.start().catch(err => { errors++; lastError = `runtime start: ${errText(err)}`; });
   };
   const stopHost = () => {
      if (!part) return;
      part.host.setActive(false);
      part.link.retire();
      restarts += part.host.stats.restarts;
      part = null;
   };

   // The laptop's trackpad over the window, for the runtime's `pointer.pos` (the host feeds it to the Worker).
   let pointer = null;
   const terminal = createTerminal({
      mac, active: () => !dead && role !== 'ide', onPointer: p => { pointer = p; },
      // Keys go to the peer only while it hears us: before that they would only be seen by the whole class's relay.
      sendIn: ev => (role === 'both' || link.mutual) && terminalLink.sendIn(ev),
   });

   // Which parts run for a role. When the IDE's upstream changes (a host built for `both`, or a switch between the real link
   // and the loopback, either way) it is told `pair`, and so is the host in `both`, which then sends a full snapshot.
   let applied = null;
   const applyRole = next => {
      if (next === applied) return;
      const was = applied;
      applied = role = next;
      ide.setActive(role !== 'runtime');
      if (role === 'ide') stopHost(); else if (!part) startHost();
      if (role === 'both' || (was !== null && (was === 'both') !== (role === 'both'))) ideLink.signal('pair', ideLink.peer);
      if (role === 'both') loop.pair();
      if (was !== null) report('role');
   };
   link.on('role', () => applyRole(roleOf()));
   const syncRole = () => { if (roleOf() !== role) applyRole(roleOf()); };

   // ---- the log line -------------------------------------------------------------------------------------------------
   let frames = 0, framesAt = now(), reportAt = now() + REPORT_MS, fps = null;
   // Where a frame's time goes, for the log: the class server's queue and the link (snapshots are applied there), the IDE's
   // frame, the whole frame and its worst, snapshots a second, the JS heap. A frame rate that falls while these stay flat is
   // the GPU or the device (heat), not this code. Plain numbers added up each frame; nothing is made per frame.
   const perf = { n: 0, total: 0, net: 0, ide: 0, worst: 0, snaps: 0 };
   let lastPerf = null;
   ideLink.on('snap', () => { perf.snaps++; });
   const report = ev => {
      const t = now(), dt = (t - seen.at) / 1000;
      const cards = Array.isArray(ide.debug.cards) ? ide.debug.cards : Object.entries(seen.modules).map(([id, status]) => [id, status, null]);
      const rails = Array.isArray(ide.debug.rails) ? ide.debug.rails
         : Object.entries(seen.rails).map(([id, r]) => [id, r.kind, r.pubs, r.subs,
            dt > 0 && Number.isFinite(r.seq) && Number.isFinite(seen.seqs[id]) ? Math.round((r.seq - seen.seqs[id]) / dt * 10) / 10 : null]);
      seen.seqs = Object.fromEntries(Object.entries(seen.rails).map(([id, r]) => [id, r.seq])); seen.at = t;
      const line = reportOf({ ev, role, rank: link.rank, mutual: link.mutual, peer: { live: link.live, heardMs: link.heardMs },
         input: link.stats, rtt: link.rtt, focus: ide.debug.focus, cards, rails, rec: { paused: seen.paused, span: seen.span },
         saves: store.stats, worker: { restarts: restarts + (part ? part.host.stats.restarts : 0) }, fps, perf: lastPerf,
         errors: errors + loop.stats.errors, lastError: lastError || (part && part.host.stats.lastError) || loop.stats.lastError });
      const form = new FormData();
      form.append('log', 'rails ' + JSON.stringify(line));
      fetch('/log', { method: 'POST', body: form }).catch(() => {});
      return line;
   };

   // ---- the frame ----------------------------------------------------------------------------------------------------
   const linkText = () => {
      if (role === 'both') return link.forced === 'both' ? 'both parts run here (forced), no link' : 'no headset heard: the IDE and the runtime both run here';
      if (link.mutual) return `paired with the ${role === 'runtime' ? 'headset' : 'laptop'}${link.rtt.p50 === null ? '' : `, rtt ${Math.round(link.rtt.p50)} ms`}`;
      return link.live ? 'peer found, pairing' : 'waiting for the peer';
   };
   // The head between the eyes and the controllers, in the model frame, as the IDE takes them.
   const headOf = views => {
      const inv = v => cg.mInverse(v.viewMatrix);
      return cg.mMultiply(window.clay.inverseRootMatrix, views.length > 1 ? cg.mix(inv(views[0]), inv(views[1]), .5) : inv(views[0]));
   };
   // (A controller that is not tracked has no usable matrix: it is not a hand.)
   let wasXr = xr(), recentreIn = 0;
   const handsOf = () => !xr() ? [] : ['left', 'right'].filter(hand => isMatrix(controllerMatrix[hand]))
      .map(hand => ({ hand, m: cg.mMultiply(window.clay.inverseRootMatrix, controllerMatrix[hand]), buttons: buttonState[hand] }));

   const runFrame = () => {
      // A device forced to `both` neither says hello nor listens: it is alone by order.
      const quiet = link.forced === 'both';
      const netAt = performance.now();
      if (window.server) for (const m of outbox) window.server.send(CHANNEL, m);
      outbox.length = 0; outSnaps = 0;
      window.server?.sync(CHANNEL, (messages, sender) => { if (!quiet) for (const m of Object.values(messages || {})) link.receive(m, sender); });
      if (needFull) { needFull = false; if (part) part.host.resend(); }
      if (!quiet) link.tick();
      perf.net += performance.now() - netAt;
      syncRole();
      terminal.flush();
      if (part && pointer) part.host.feedPointer([(pointer.x - .5) * MAT_SIZE, 0, (pointer.y - .5) * MAT_SIZE]);
      const snap = part ? part.host.lastSnap() : null;
      if (snap && snap !== seen.last) { seen.last = snap; tally(snap); }
      // A runtime that could not start (its layout file failed to load) says so on the laptop, not only in the log.
      const stopped = part && /^runtime not started/.test(part.host.stats.lastError || '') ? part.host.stats.lastError : null;
      terminal.status({ role, link: stopped || linkText(), focus: typeof ide.debug.focus === 'string' ? ide.debug.focus : null });
      // The workspace is made from the first head the IDE sees, which on a Quest is the inline view before Enter VR. Entering
      // XR asks for a new one (with the desk at its default height) from the first head that is plausibly a person's, more
      // than 0.3 m above the floor, since the first frames of a session may still carry the inline view; or after 60 frames.
      const inXr = xr();
      if (inXr && !wasXr) recentreIn = 60;
      wasXr = inXr;
      const views = window.clay?.views;
      const head = views?.length ? headOf(views) : null;
      if (recentreIn > 0 && ((head && head[13] > .3) || --recentreIn === 0)) { recentreIn = 0; ide.recentre(true); }
      if (role !== 'runtime' && head) { const ideAt = performance.now(); ide.frame(head, handsOf()); perf.ide += performance.now() - ideAt; }
   };

   // A frame that throws is counted and goes on, as in Doorways; the first of each message is also shown in the console.
   model.animate(() => {
      if (dead) return;
      const frameAt = performance.now();
      try { runFrame(); } catch (e) {
         errors++;
         const message = e.message + ' ' + (e.stack?.split('\n')[1]?.trim() || '');
         if (message !== lastError) console.error('rails:', e);
         lastError = message;
      }
      const took = performance.now() - frameAt;
      perf.n++; perf.total += took; if (took > perf.worst) perf.worst = took;
      frames++;
      if (now() >= reportAt) {
         const secs = (now() - framesAt) / 1000, round = x => Math.round(x * 100) / 100, n = Math.max(1, perf.n);
         lastPerf = { xr: xr(), frameMs: round(perf.total / n), netMs: round(perf.net / n), ideMs: round(perf.ide / n), worstMs: round(perf.worst),
                      snaps: round(perf.snaps / secs), heapMB: performance.memory ? round(performance.memory.usedJSHeapSize / 1e6) : null };
         perf.n = perf.total = perf.net = perf.ide = perf.worst = perf.snaps = 0;
         fps = Math.round(frames / secs * 10) / 10; frames = 0; framesAt = now();
         reportAt = now() + REPORT_MS;
         report('tick');
      }
   });

   // Test hooks.
   window.railsDebug = {
      get role() { return role; }, get rank() { return link.rank; }, link, loop: loop.stats, ide, terminal: terminal.stats,
      get host() { return part ? part.host : null; }, get snap() { return part ? part.host.lastSnap() : null; },
      get owned() { return owned.map(t => t.channel); }, get errors() { return errors; }, get lastError() { return lastError; }, get seen() { return seen; },
      report: ev => report(ev || 'debug'),
      // For the browser test: focus a card's slot and hold the gaze on it (the IDE's `test` object carries the rest).
      setFocus: slot => ide.test?.setFocus(slot),
   };

   applyRole(role);
   report('start');

   cleanup = ctxForever.railsCleanup = () => {
      dead = true;
      terminal.dispose();
      stopHost();
      ide.setActive(false);
      ide.dispose();
      ideLink.retire(); terminalLink.retire();
      releaseTextures(owned);
      delete window.railsDebug;
      delete ctxForever.railsCleanup;
   };
};

export const deinit = () => { cleanup?.(); cleanup = null; };
