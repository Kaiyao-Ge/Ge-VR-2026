// The state machine of the Rails IDE, pure: no Clay, no DOM, no clock of its own. ide.js puts it in the headset (cards,
// stage, head and hands to rays); this file decides everything else. It listens to the link (`in`, `snap`, `ack`,
// `release`, `pair`), keeps one text buffer per card, the focus, the command line, the commands waiting for the runtime,
// the merged snapshot, the notices and the held keys and buttons, and each frame it says what to send (`cmd` and `dev`
// through the link) and what to show (the view that frame() returns).
//
// What it holds to:
//  - `pair` (also repeated, also from a rebuilt runtime) resets the snapshot baselines (rev, notices seen, devices sent)
//    and expects a full snapshot; commands that were still waiting are marked failed ("link reset — run again") and never
//    sent again (a second send could apply twice); a command with no ack for 5 s is marked "no answer". Commands and
//    devices are sent only after `pair` has been seen, and an inactive IDE (the page is the runtime) ignores the link and
//    sends nothing. The buffers are kept through all of it.
//  - A failure ack after a Worker restart means "unknown outcome": the reason is shown and the buffer stays dirty (it is
//    only ever made clean by an ok ack or by a snapshot that carries exactly its text).
//  - A snapshot's `rev` never goes down, and one with an equal rev is still applied (the clock and the draw lists move
//    without a structural change). Notices are told apart by `id` (ids grow across restarts) and shown for 5 s under the
//    focused card. `geometry` is the list of what exists (removals arrive by it); a card of the geometry may be missing
//    from `modules` for a few snapshots; a module's `source` comes only with a new `ver`: a clean buffer takes it, a dirty
//    one is kept and marked "run changed under you", a new card takes it from the first snapshot that has it.
//  - The bus: the rails are the variables, by name. The head's `vars` is the list of what exists (a rail that is not in it is
//    dropped; a name in it with no rail yet is still on its way, not missing), `uses` says which variable an input takes
//    instead of its own name ('card.input' -> variable) and `unplugged` which cards are off the bus. `cardState.bindings` says
//    for each port of a card what it is bound to and, if it is not, why. `use`, `plug` and `unplug` act on the focused card;
//    one that is acked while paused only applies on the resume, and says so until the head shows it. `rm`, `rename` and
//    `undo` of a card keep its uses and its plug state with it (the runtime moves or drops them; `undo` sends them again).
//    `rm`, `rename` and a new card are refused while paused (the runtime says so, and nothing changes).
//  - The bus window (busWindow.js) opens with Mod+B, or when the gaze rests on the bus band for BAND_S while no button is held and no
//    plug is grabbed (it does not open again until the gaze has left the band), centred at the gaze's yaw; it stays until it is closed
//    (Esc: filter, then section, then closed; Mod+B). While it is open and no command line is, its edit keys are the window's (Mod chords
//    still work), the wheel over it is its own, a press on it is its own (never `pointer.down`), and a gaze on it does not move the focus.
//    The plug: a press with the gaze on a card's plug holds it, and the release on the bus plugs the card in, anywhere else unplugs it
//    (only if that changes it); a blur or a silent peer drops the grab. Neither press is `pointer.down`. `rates` are the messages per
//    second of each variable over the last RATE_S of live time. The plug under the gaze (gaze.js: 5 degrees to get on it, 7 to leave it, and
//    a press takes a plug that was the target within 0.2 s) comes before the bus band under it, so a gaze on a plug opens no window.
//  - The gaze: the head's ray is smoothed (gaze.js, about 60 ms, whatever the frame rate) and that ray is the one every hit test uses and the
//    view carries (`ray`). `view.gaze` is what the cursor shows: where that ray meets the nearest of the bus window, a card, a plug, the bus band
//    and the desk mat (else the cylinder), with `kind`, `progress` (the card's focus dwell, the bus window's opener), `holding` and `plug`.
//  - Paused: the runtime sends the past, so the draw lists of a paused snapshot are what the modules drew at the playhead and the
//    stage shows them as they are (the IDE does nothing to them). Mod+Enter while paused sends nothing (the edit stays in the buffer) and
//    says the paused text; Mod+Shift+Enter (or `here`) sends `resumeHere`, which makes the playhead the new present (the runtime then
//    says `paused: false` and a notice, which is shown); live it says "live already".
//  - Input: a key up may come without its down. `held` is cleared on `blur` and `release`, and "keyboard lost focus" shows on the
//    focused card until the next key. Mod is the laptop's: `link.peer.caps.mac`. A button press is the pointer device's (`pointer.down`).
//  - Nothing typed and no source goes into `debug` (it feeds the log line); `inspect` is for the tests only.
//
// Time: now() is in ms (an injected clock); the pure spatial modules take seconds. Rays are {o, d} in the model frame.
import * as cg from '../../render/core/cg.js';
import { NAME, isObject, finite, sameJson, compatible, bindingKey } from './values.js';
import { isMatrix } from './geom.js';
import { TextBuffer } from './textBuffer.js';
import { mapKey, isMac } from './keymap.js';
import { parseCommand } from './commands.js';
import { workspace, hitCard, stageFrame, deskHit, yawPitchOf, onBus, SLOTS, ZOOMS, ZOOM_DEFAULT } from './layout.js';
import { createRaySmoother, PlugTargets, gazeAt } from './gaze.js';
import { newFocus, setFocus, releaseFocus, stepFocus, TYPING_LOCK } from './gazeFocus.js';
import { scrub, UNITS_PER_SECOND } from './timeline.js';
import { keyLabel, lerpDraw } from './ideFormat.js';
import { statusOf } from './cardDraw.js';
import { createBusWindow } from './busWindow.js';

export const NOTICE_S = 5;            // a runtime notice or a refusal is shown this long
const PAUSED = 'paused: Mod+Shift+Enter continues from here, Mod+P returns to now';      // what the runtime says to a commit while paused (lifecycle.js)
export const NO_ANSWER_MS = 5000;     // a command with no ack for this long is marked "no answer"
export const CONFIRM_S = 3;           // `rm` must be given twice within this
export const HIT_MS = 1000 / 60;      // gaze.hit is sent at most this often
export const SEEK_S = 0.05;           // and a scrub's seek this often
export const GRACE_S = 3;             // a use or plug that waited for the resume is looked for this long after it
export const LINES_PER_PX = 3 / 100;  // the wheel: 3 lines for a notch of 100 px
export const COLS_PER_PX = 6 / 100;   // and 6 columns sideways while live (columns are narrower than lines are tall)
export const BLEND_MAX = 0.2;         // two draws are blended only if they are at most this many seconds apart, in simulated time and in arrival
export const STEP_S = 0.5;            // Mod+] moves the paused playhead this far (Shift: FINE_S)
export const FINE_S = 0.1;
export const DESK_BELOW_EYE = 0.45;   // the default desk height, below the eye
export const BAND_S = 0.4;            // the gaze on the bus this long opens the bus window
export const RATE_S = 1;              // a variable's messages per second is the count over this long

const TEXT_OPS = new Set(['insert', 'newline', 'tab', 'backspace', 'delete', 'deleteLineStart']);
const MODIFIER_KEYS = new Set(['Shift', 'Control', 'Alt', 'Meta', 'AltGraph', 'CapsLock', 'OS']);
const unit = v => (cg.norm(v) > 0 ? cg.normalize(v) : v);

export { keyLabel, lerpDraw };

export function createIdeCore({ link, now = () => 0, platform = '' }) {
   const stats = { oldSnaps: 0, sent: 0, keys: 0 };
   let active = false, paired = false, nextId = 1;
   // The runtime's side as the snapshots told us.
   const cards = new Map();                       // id -> card (below)
   const rails = Object.create(null);             // variable name -> its merged entry (no prototype: a snapshot's `__proto__` key is only a name)
   let haveGeometry = false;
   let vars = null, varSet = null, uses = {}, unplugged = [], unpluggedSet = new Set();        // the bus: variable names, 'card.input' -> variable, cards off the bus
   let clock = { t: 0, paused: false, playhead: null, window: [0, 0], density: [] };
   let rev = -1, noticeIds = new Set(), expectFull = false, railsRev = 0;     // railsRev: grows with every applied snapshot, for what is derived from the rails
   // What the IDE itself holds.
   let focus = newFocus(null), lastTextKeyT = null, kbLost = false, echo = [];
   let cmdLine = null, cmdCard = null, confirm = null, lastDeleted = null, wantFocus = null, afterPair = false;
   const restoring = new Map();                   // card id -> { text, uses, unplugged }: what comes back when the card is back
   const ownGone = new Map();                     // id -> { until, to? }: removals and renames this IDE asked for
   const held = { buttons: new Set(), keys: new Set() };
   let pressed = false, released = false, pointerDown = false;
   const pending = new Map();                     // command id -> { id, op, module, at, source, queue }
   const queued = new Map();                      // 'use:card.input' | 'plug:card' -> a use or plug that was acked while paused: the head shows it after the resume
   let toasts = [];                               // [{ text, until, card }] seconds
   let wheelDx = 0, wheelDy = 0, wheelZoom = 0, scrollAcc = 0, scrollXAcc = 0, busAcc = 0, scrubT = null, scrubAt = -Infinity, scrubDirty = false, playing = false;
   let ws = null, stage = null, deskY = null, recentre = false, aimRay = null, leftX = false;
   let lastHit = null, lastHitAt = -Infinity, sentOn = null, hintAt = -Infinity;
   let lastSlotsHit = null;
   const bw = createBusWindow();
   let grab = null, bandSince = null, armed = true, bwWasOpen = false, lastYaw = null;        // the plug in hand ({ card, over }); the gaze on the bus band since; the window may open from it; the gaze's yaw
   const smoother = createRaySmoother(), plugs = new PlugTargets(SLOTS.length);                 // the head's ray, smoothed; the plug the gaze is on (with its hysteresis and grace)
   const NO_RATES = {};
   let rates = NO_RATES, rateMarks = {}, rateAt = -Infinity;                                       // messages per second by variable, and the counts they were made from
   const busSrc = { rails: null, vars: null, railsRev: 0, paused: false, playhead: null, window: null, rates: null };      // what the window is shown (reused)
   const busCard = { name: null, unplugged: false, bindings: null, pending: [] };

   const T = () => now() / 1000;
   const mac = () => link.peer?.caps?.mac ?? isMac(platform);

   // ---- messages shown to the person ---------------------------------------------------------------------------------
   const say = (text, card = null, seconds = NOTICE_S) => {
      toasts.push({ text: String(text).slice(0, 300), until: T() + seconds, card });
      if (toasts.length > 12) toasts.shift();
   };

   // ---- cards ------------------------------------------------------------------------------------------------------
   const freeSlot = () => { const taken = new Set([...cards.values()].map(c => c.slot)); for (let s = 0; s < SLOTS.length; s++) if (!taken.has(s)) return s; return 0; };
   const newCard = (id, slot) => ({ id, slot, buffer: new TextBuffer(''), loaded: false, ver: null, running: null, status: 'ok', error: null, editError: null,
      ports: [], calls: 0, changedUnder: false, draw: [], drawPrev: null, drawAt: 0, drawPrevAt: 0, drawT: 0, drawPrevT: 0, bindings: [], bindingsRev: -1, zoom: ZOOM_DEFAULT });
   const ensureCard = (id, slot = freeSlot()) => {
      let c = cards.get(id);
      if (!c) { c = newCard(id, slot); cards.set(id, c); if (wantFocus && wantFocus.id === id && T() < wantFocus.until) { focus = setFocus(c.slot); wantFocus = null; } }
      return c;
   };
   const cardIf = id => (id && cards.has(id) ? id : null);        // the id when it is a card, for a notice to show on
   const bySlot = slot => { for (const c of cards.values()) if (c.slot === slot) return c; return null; };
   const focusedCard = () => (focus.focus == null ? null : bySlot(focus.focus));
   const occupied = () => [...cards.values()].map(c => c.slot);

   // What `undo` needs to bring a card back: its slot, the source that ran, the text in the buffer, and its uses and plug state.
   const remains = c => ({ id: c.id, slot: c.slot, running: c.running, text: c.buffer.text, dirty: c.buffer.dirty,
      uses: Object.entries(uses).filter(([k]) => k.startsWith(c.id + '.')).map(([k, v]) => [k.slice(c.id.length + 1), v]), unplugged: unpluggedSet.has(c.id) });

   const OWN_S = 15;                              // an own removal or rename is looked for this long in the geometry

   const removeCard = id => {
      const c = cards.get(id);
      if (!c) return;
      if (focus.focus === c.slot) focus = releaseFocus();
      const own = ownGone.get(id);
      ownGone.delete(id);
      if (own && own.until >= T()) {
         // This IDE's own `rm` (remembered for `undo` when it was sent) or `rename`: the edited text moves to the new name.
         if (own.to && c.buffer.dirty) restoring.set(own.to, { text: c.buffer.text, uses: [], unplugged: false });   // (the text now: typing went on until the removal arrived)
      } else if (c.loaded && c.buffer.dirty) {
         // Anything else that removes a card with edits in it (the runtime, another editor): the edits are kept.
         lastDeleted = remains(c);
         say(`${id}: removed by the runtime — your edits are kept, undo restores`);
      }
      cards.delete(id);
   };

   // ---- the snapshot -----------------------------------------------------------------------------------------------
   function applyGeometry(g) {
      haveGeometry = true;
      if (isObject(g.cards)) {
         for (const id of [...cards.keys()]) if (!Object.hasOwn(g.cards, id)) removeCard(id);
         for (const [id, v] of Object.entries(g.cards)) {
            if (!NAME.test(id) || !isObject(v)) continue;
            const c = ensureCard(id, Number.isInteger(v.slot) ? v.slot : freeSlot());
            if (Number.isInteger(v.slot)) c.slot = v.slot;
         }
      }
   }

   // The source of a module that has a new ver. The buffer's `dirty` is its text against the running text, so the running
   // text is set here (and at an ok ack of our own commit). A source equal to the running one is nothing new (a full
   // snapshot after a re-pair sends every source again). The buffer takes it when it is the first one or the buffer is clean
   // (the run came from elsewhere: a revert, a restart); our own commit coming back (acked, or still on its way: the snapshot
   // may come first) only updates what runs; a dirty buffer that meets someone else's run is kept and marked.
   function takeSource(c, source) {
      if (c.loaded && source === c.running) return;
      const first = !c.loaded, text = c.buffer.text, wasClean = !c.buffer.dirty;
      const own = source === c.committed || [...pending.values()].some(p => p.module === c.id && p.source === source);
      c.running = source; c.loaded = true;
      // (A first source never overwrites a buffer that already has edits: it is kept and marked, like any other run it did not make.)
      if ((first && wasClean) || (wasClean && text !== source)) { c.buffer.apply({ op: 'set', text: source }); c.changedUnder = false; return; }
      c.buffer.apply({ op: 'base', text: source });
      c.changedUnder = text !== source && !own;
   }

   // After `undo` of a removed card, or a rename: when the card is back (whenever that is), its uses and plug state are sent again (a
   // `use` per input, then `plug off`) and the edited text returns as a dirty buffer. A buffer that already has edits is never overwritten.
   function restoreCard(c) {
      const r = restoring.get(c.id);
      if (!r || !c.loaded) return;
      restoring.delete(c.id);
      if (lastDeleted?.id === c.id) lastDeleted = null;
      for (const [port, variable] of r.uses) if (uses[bindingKey(c.id, port)] !== variable) sendUse(c, port, variable);
      if (r.unplugged && !unpluggedSet.has(c.id)) sendPlug(c, false);
      if (r.text !== c.buffer.text) {
         if (c.buffer.dirty) { say(`${c.id}: not restored — it has edits`, c.id); return; }
         c.buffer.apply({ op: 'set', text: r.text }); c.buffer.apply({ op: 'base', text: c.running });
      }
   }

   function applyModule(id, e, at, simT) {
      if (!isObject(e)) return;
      let c = cards.get(id);
      if (!c) { if (haveGeometry || !NAME.test(id)) return; c = ensureCard(id); }
      if (Number.isInteger(e.ver)) c.ver = e.ver;
      if (typeof e.status === 'string') c.status = e.status;
      if ('error' in e) c.error = isObject(e.error) ? e.error : null;
      if ('editError' in e) c.editError = isObject(e.editError) ? e.editError : null;
      if (Array.isArray(e.ports)) c.ports = e.ports.filter(isObject).map(p => ({ name: String(p.name), dir: p.dir === 'out' ? 'out' : 'in', kind: p.kind, type: p.type, rail: p.rail ?? null }));
      if (finite(e.calls)) c.calls = e.calls;
      if (Array.isArray(e.draw)) { c.drawPrev = c.fresh ? null : c.draw; c.drawPrevAt = c.drawAt; c.drawPrevT = c.drawT; c.draw = e.draw; c.drawAt = at; c.drawT = simT; c.fresh = false; }
      if (typeof e.source === 'string') takeSource(c, e.source);
      restoreCard(c);
   }

   // The bus fields of a head: the variables that exist (a rail of any other name is dropped), which input takes which variable, which cards are off.
   // Names only: anything else in them is ignored.
   function applyBus(s) {
      // (What did not change stays the same object, so that what is drawn from it is not worked out again.)
      if (Array.isArray(s.vars) && s.vars.every(x => typeof x === 'string') && !(vars && sameJson(vars, s.vars))) {
         vars = s.vars.slice(); varSet = new Set(vars);
         for (const id of Object.keys(rails)) if (!varSet.has(id)) delete rails[id];
      }
      if (isObject(s.uses)) {
         const next = {};
         for (const [k, v] of Object.entries(s.uses)) if (typeof v === 'string') next[k] = v;
         if (!sameJson(uses, next)) uses = next;
      }
      if (Array.isArray(s.unplugged) && s.unplugged.every(x => typeof x === 'string') && !sameJson(unplugged, s.unplugged)) { unplugged = s.unplugged.slice(); unpluggedSet = new Set(unplugged); }
   }

   function applySnap(s) {
      if (Number.isInteger(s.rev)) {
         if (s.rev < rev) { stats.oldSnaps++; return; }
         rev = s.rev;
      }
      expectFull = false; railsRev++;
      const at = now();
      if (finite(s.t)) clock.t = s.t;
      if (typeof s.paused === 'boolean') {
         // On the resume what was waiting is applied by the runtime's next step: it is looked for a few seconds from now.
         if (clock.paused && !s.paused) for (const q of queued.values()) q.until = T() + GRACE_S;
         clock.paused = s.paused;
      }
      if (typeof s.playing === 'boolean') playing = s.playing;          // the runtime's word: it ends at the window's end, and a seek stops it
      if (s.playhead === null || finite(s.playhead)) clock.playhead = s.playhead;
      if (Array.isArray(s.window) && s.window.length === 2) clock.window = s.window.slice();
      if (Array.isArray(s.density)) clock.density = s.density.slice();
      if (isObject(s.geometry)) applyGeometry(s.geometry);
      applyBus(s);
      if (isObject(s.rails)) for (const [id, r] of Object.entries(s.rails)) if (isObject(r) && (!varSet || varSet.has(id))) rails[id] = { ...rails[id], ...r };
      // The simulated time of this snapshot's pictures: the playhead while paused (it also moves while the past plays), else the head's time.
      const simT = clock.paused && finite(clock.playhead) ? clock.playhead : clock.t;
      if (isObject(s.modules)) for (const [id, e] of Object.entries(s.modules)) applyModule(id, e, at, simT);
      const first = afterPair; afterPair = false;
      if (Array.isArray(s.notices)) {
         for (const n of s.notices) {
            if (!isObject(n) || !Number.isInteger(n.id) || noticeIds.has(n.id)) continue;
            noticeIds.add(n.id);
            // The first snapshot after `pair` has the last 8 notices of a runtime that may have run for long: only a recent one
            // (its step against the snapshot's time) is shown, the rest are marked seen.
            const old = first && finite(s.t) && finite(n.n) && s.t - n.n / 60 > NOTICE_S;
            if (!old) say(typeof n.text === 'string' ? n.text : 'notice', null);
         }
         if (noticeIds.size > 500) noticeIds = new Set([...noticeIds].slice(-100));
      }
   }

   // ---- commands ---------------------------------------------------------------------------------------------------
   // Sends a command and remembers it until its ack. Nothing goes before `pair`.
   // A message about something the bus window asked for goes to its footer while it is open, else under the card.
   function tell(win, text, card) { if (win && bw.open) bw.note(text, 'error', T()); else say(text, card); }

   function send(spec, card = null, extra = {}) {
      if (!active) return null;
      if (!paired) { tell(extra.win, 'waiting for the runtime: not paired yet', card); return null; }
      const id = nextId++;
      pending.set(id, { id, op: spec.op, module: spec.module ?? null, at: now(), ...extra });
      let ok = false;
      try { ok = link.sendCmd({ id, ...spec }); } catch (_) { ok = false; }
      if (!ok) { pending.delete(id); tell(extra.win, `could not send ${spec.op}`, card); return null; }
      stats.sent++;
      return id;
   }

   // `use` and `plug` for a card. An ok ack while paused does not mean it applies: it waits for the resume, which `queued` remembers
   // (and the card says) until the head shows it, or for a few seconds after the resume.
   // (`win`: it came from the bus window, which then says how it went in its footer.)
   function sendUse(c, port, variable, win = false) {
      const key = bindingKey(c.id, port), own = variable === null || variable === port;
      const queue = { key: `use:${key}`, card: c.id, what: `use ${port}${variable === null ? '' : ' ' + variable}`, done: () => (own ? !Object.hasOwn(uses, key) : uses[key] === variable) };
      return send({ op: 'use', module: c.id, port, variable }, c.id, { queue, port, win });
   }
   function sendPlug(c, on) {
      const queue = { key: `plug:${c.id}`, card: c.id, what: `plug ${on ? 'on' : 'off'}`, done: () => unpluggedSet.has(c.id) !== on };
      return send({ op: 'plug', module: c.id, on }, c.id, { queue });
   }

   // A command that will not be acked (refused, no answer, link reset): it is forgotten, and so is what was prepared for it.
   function unpend(p) {
      pending.delete(p.id);
      if (p.restore) restoring.delete(p.restore);
      if (p.op === 'rmModule' || p.op === 'renameModule') ownGone.delete(p.module);
   }

   function onAck(m) {
      if (!active) return;
      const p = pending.get(m.cmd);
      if (!p) return;
      pending.delete(m.cmd);
      const c = p.module ? cards.get(p.module) : null;
      if (m.ok) {
         // Our commit runs now: that is the text the buffer is compared with, whatever was typed since.
         if (p.op === 'commit' && c && typeof p.source === 'string') { c.committed = p.source; c.buffer.apply({ op: 'base', text: p.source }); if (c.buffer.text === p.source) c.changedUnder = false; }
         if (p.queue && clock.paused && !p.queue.done()) {
            queued.set(p.queue.key, { ...p.queue, until: T() + 1 });
            if (p.win && bw.open) bw.note(`${p.queue.what}: applies when you resume`, 'info', T());
            else say(`${p.queue.what}: applies when you resume`, p.queue.card);
         }
         return;
      }
      // A failure is shown with the runtime's reason; after a Worker restart it means "unknown outcome" and the buffer
      // stays dirty (it is made clean only by an ok ack, or by a snapshot that carries its text).
      unpend(p);
      if (p.op === 'rmModule' && lastDeleted?.id === p.module) lastDeleted = null;
      if (p.op === 'seek') return;
      if (p.win && bw.open) return bw.note(`${p.op} refused: ${m.reason || 'no reason given'}`, 'error', T());
      say(p.restore ? `undo failed: ${m.reason || 'no reason given'}` : `${p.op} refused: ${m.reason || 'no reason given'}`, c ? c.id : null);
   }

   function failPending(text) {
      const seen = new Set();
      for (const p of pending.values()) {
         const key = `${p.module}|${text}`;
         if (!seen.has(key)) { seen.add(key); tell(p.win, text, cardIf(p.module)); }
      }
      for (const p of pending.values()) unpend(p);
   }

   // ---- link events ------------------------------------------------------------------------------------------------
   function onPair() {
      if (!active) return;
      paired = true;
      rev = -1; noticeIds = new Set(); afterPair = true; expectFull = true; sentOn = null; lastHit = null; playing = false;
      queued.clear();
      for (const c of cards.values()) { c.drawPrev = null; c.fresh = true; }          // the first draw of a new runtime is not blended with the old one
      failPending('link reset — run again');
   }

   function sendPointer(down) {
      if (!paired || pointerDown === down) return;
      pointerDown = down;
      link.sendDev('pointer', 'down', down);
   }

   // A blur or the laptop going silent: every held key and button is let go, and the pointer is up.
   function releaseAll() {
      held.keys.clear(); held.buttons.clear(); pressed = released = false; grab = null;
      if (pointerDown) { pointerDown = false; if (paired) link.sendDev('pointer', 'down', false); }
   }

   function onRelease(reason) {
      if (!active) return;
      if (reason !== 'blur') paired = false;      // a silent peer is sent nothing, not even the pointer going up
      releaseAll();
      kbLost = true;
   }

   function onIn(m) {
      if (!active) return;
      const ev = m.ev;
      if (!isObject(ev)) return;
      if (ev.k === 'key') onKey(ev);
      else if (ev.k === 'paste') onPaste(ev.text);
      else if (ev.k === 'wheel') { wheelDx += ev.dx || 0; wheelDy += ev.dy || 0; wheelZoom += Math.sign(ev.zoom) || 0; }       // (junk steps count as one)
      else if (ev.k === 'btn') {
         if (ev.d === 'down') { if (!held.buttons.has('left')) { held.buttons.add('left'); pressed = true; } }
         else { held.buttons.delete('left'); released = true; }
      } else if (ev.k === 'blur') { releaseAll(); kbLost = true; }
   }

   // ---- keys -------------------------------------------------------------------------------------------------------
   const hint = text => { if (T() - hintAt > 2) { hintAt = T(); say(text, null, 2); } };

   function onKey(ev) {
      if (ev.d === 'up') { held.keys.delete(ev.code); return; }
      held.keys.add(ev.code);
      kbLost = false; stats.keys++;
      if (!MODIFIER_KEYS.has(ev.key) && !ev.rep) { echo.push(keyLabel(ev)); if (echo.length > 8) echo.shift(); }
      const act = mapKey(ev, { mac: mac() });
      if (!act) return;
      if (act.edit) routeEdit(act.edit);
      else if (act.cmd) onCmdKey(act.cmd, !!act.fine);
   }

   function onPaste(text) {
      if (typeof text !== 'string') return;
      kbLost = false;
      routeEdit({ op: 'insert', text });
   }

   // While the bus window is open (and no command line) it takes the edit keys, except the card's own Mod chords.
   function routeEdit(op) {
      if (!bw.open || cmdLine || !bw.takes(op)) return editKey(op);
      const u = bw.key(op), c = u && cards.get(u.module);
      if (c) sendUse(c, u.port, u.variable, true);
   }

   function editKey(op) {
      if (cmdLine) return commandEdit(op);
      const c = focusedCard();
      if (!c) { hint('no card is focused: look at one first'); return; }
      if (!c.loaded) { hint('this card has no source yet'); return; }
      c.buffer.apply(op, now());
      if (TEXT_OPS.has(op.op)) lastTextKeyT = T();
   }

   function onCmdKey(name, fine = false) {
      if (name === 'escape') return escape();
      if (name === 'recentre') { recentre = true; return; }
      if (name === 'bus') { bw.toggle(lastYaw ?? 0); return; }
      if (cmdLine && (name === 'run' || name === 'here')) return;
      if (name === 'run') return run();
      if (name === 'here') return continueHere();
      if (name === 'zoomIn' || name === 'zoomOut' || name === 'zoomReset') {
         const c = focusedCard();
         if (!c) return hint('no card is focused: look at one first');
         return setZoom(c, name === 'zoomReset' ? ZOOM_DEFAULT : c.zoom + (name === 'zoomIn' ? -1 : 1));
      }
      if (name === 'stepBack' || name === 'stepFwd') return step((name === 'stepBack' ? -1 : 1) * (fine ? FINE_S : STEP_S));
      if (name === 'pause') return pauseToggle();
      if (name === 'play') return playToggle();
   }

   // Mod+Enter: the focused card's text is committed (hot reload). While paused nothing is sent (the runtime would refuse): the edit
   // stays in the buffer and the toast says how to go on.
   function run() {
      const c = focusedCard();
      if (!c) return hint('no card is focused: look at one, then Mod+Enter');
      if (!c.loaded) return hint('this card has no source yet');
      if (clock.paused) return say(PAUSED, c.id);
      const source = c.buffer.text;
      send({ op: 'commit', module: c.id, source }, c.id, { source });
   }

   // Mod+Shift+Enter, or `here`: while paused the playhead becomes the new present (the runtime keeps the code of now).
   function continueHere() {
      if (!clock.paused) return say('live already', null, 2);
      send({ op: 'resumeHere' });
   }

   // Zoom 0 is the nearest (26 columns), 2 the farthest (40); the buffer gets the size and keeps its cursor in view.
   function setZoom(c, z) {
      z = cg.clamp(z, 0, ZOOMS.length - 1);
      if (z === c.zoom) return;
      c.zoom = z;
      c.buffer.apply({ op: 'size', cols: ZOOMS[z].cols, rows: ZOOMS[z].rows }, now());
   }

   // Mod+[ and Mod+]: the paused playhead moves by `dt` seconds. The seek goes out with the wheel's (stepWheel), at most every SEEK_S.
   function step(dt) {
      if (!clock.paused) return;
      if (scrubT === null) scrubT = finite(clock.playhead) ? clock.playhead : clock.window[1];
      const was = scrubT;
      scrubT = scrub(scrubT, dt * UNITS_PER_SECOND, clock.window);
      if (scrubT !== was) scrubDirty = true;
   }

   function pauseToggle() { send({ op: clock.paused ? 'resume' : 'pause' }); }
   function playToggle() {
      if (!clock.paused) return hint('play needs a pause (Mod+P)');
      send({ op: playing ? 'stop' : 'play' });
   }

   // ---- the command line -------------------------------------------------------------------------------------------
   function escape() {
      if (!cmdLine && bw.escape()) return;
      if (cmdLine) {
         const empty = cmdLine.text === '';
         cmdLine = null; cmdCard = null;
         if (empty) focus = releaseFocus();
         return;
      }
      const c = focusedCard();
      cmdCard = c ? c.id : null;
      cmdLine = new TextBuffer('');
   }

   // The command line is one line: Enter runs it, and the keys that would make a second line or move between lines do nothing.
   function commandEdit(op) {
      if (op.op === 'newline') return submit();
      if (op.op === 'tab' || (op.op === 'move' && ['up', 'down', 'pageup', 'pagedown'].includes(op.dir))) return;
      if (op.op === 'insert') op = { op: 'insert', text: String(op.text).split(/\r?\n/)[0] };
      cmdLine.apply(op, now());
      if (TEXT_OPS.has(op.op)) lastTextKeyT = T();
   }

   function submit() {
      const r = parseCommand(cmdLine.text), id = cmdCard;
      if (r.error) { say(r.error, commandCardId()); return; }       // the line stays open to be corrected
      cmdLine = null; cmdCard = null;
      execute(r, id && cards.get(id) || null);
   }

   // A new card needs one of the five slots: when they are all taken (counting commands that are still on their way) the person is told,
   // and no command is sent.
   function slotRoom(cid) {
      const inFlight = [...pending.values()].filter(p => p.op === 'addModule').length;
      if (cards.size + inFlight >= SLOTS.length) { say(`all ${SLOTS.length} card slots are taken: rm a card first`, cid); return false; }
      return true;
   }

   function execute(r, c) {
      const cid = c ? c.id : null;
      const needCard = () => { if (!c) say('no card is focused: look at one, then Esc', null); return c; };
      switch (r.op) {
         case 'addModule':
            if (!slotRoom(cid)) break;
            wantFocus = { id: r.name, until: T() + 5 };
            send({ op: 'addModule', module: r.name }, cid);
            break;
         case 'rm': {
            if (!c) return say('nothing to remove: focus a card', null);
            const what = `card ${c.id}`;
            if (confirm && confirm.what === what && T() <= confirm.until) {
               confirm = null;
               const was = lastDeleted;
               lastDeleted = remains(c);
               ownGone.set(c.id, { until: T() + OWN_S });
               if (send({ op: 'rmModule', module: c.id }, cid) === null) { ownGone.delete(c.id); lastDeleted = was; }
            } else { confirm = { what, until: T() + CONFIRM_S }; say(`rm again to confirm: ${what}`, cid, CONFIRM_S); }
            break;
         }
         case 'rename':
            if (needCard()) {
               ownGone.set(c.id, { until: T() + OWN_S, to: r.name });
               if (send({ op: 'renameModule', module: c.id, to: r.name }, cid) === null) ownGone.delete(c.id);
            }
            break;
         case 'use': if (needCard()) sendUse(c, r.port, r.variable); break;
         case 'plug': if (needCard()) sendPlug(c, r.on); break;
         case 'undo':
            if (lastDeleted) {
               // (lastDeleted stays until the card is back, so that a refused undo can be tried again.)
               const d = lastDeleted;
               if (!slotRoom(cid)) break;
               restoring.set(d.id, { text: d.text, uses: d.uses, unplugged: d.unplugged });
               if (send({ op: 'addModule', module: d.id, source: typeof d.running === 'string' ? d.running : d.text }, cid, { restore: d.id }) === null) restoring.delete(d.id);
            }
            else say('nothing to undo', cid);
            break;
         case 'reset': if (needCard()) send({ op: 'reset', module: c.id }, cid); break;
         case 'revert': if (needCard()) send({ op: 'revert', module: c.id }, cid); break;
         case 'pause': if (!clock.paused) pauseToggle(); break;
         case 'live': if (clock.paused) pauseToggle(); break;
         case 'play': playToggle(); break;
         case 'here': continueHere(); break;
         default: say(`unknown command ${r.op}`, cid);
      }
   }

   // ---- what a frame decides ---------------------------------------------------------------------------------------
   // The gaze ray: the head's, smoothed (the cursor and every hit test use this one, so what is seen is what is hit). The test's `aim` is used as it is.
   const rayOf = (head, t) => (aimRay || (isMatrix(head) ? smoother.step({ o: [head[12], head[13], head[14]], d: unit([-head[8], -head[9], -head[10]]) }, t) : null));

   const messageCard = () => focusedCard() || [...cards.values()].sort((a, b) => a.slot - b.slot)[0] || null;
   const commandCardId = (message = messageCard()) => (cmdCard && cards.has(cmdCard) ? cmdCard : (message || {}).id ?? null);

   function sendDevices(hit, on) {
      if (!paired) return;
      if (on !== sentOn) { sentOn = on; link.sendDev('gaze', 'on', on); }
      if (hit && now() - lastHitAt >= HIT_MS) {
         const v = hit.map(x => Math.round(x * 1e4) / 1e4);
         if (!lastHit || v.some((x, i) => x !== lastHit[i])) { lastHit = v; lastHitAt = now(); link.sendDev('gaze', 'hit', v); }
      }
   }

   // A press of the button is the pointer device's (`pointer.down`), and so is its release, unless it is the bus window's (the gaze is on it)
   // or it takes a plug (the gaze is on one): then the release unplugs or plugs, and the pointer never knows.
   function stepPointer(ray, t) {
      const press = pressed, release = released;
      pressed = released = false;
      if (press) {
         if (bw.over) windowUse(bw.click());
         else if (!startGrab(t)) sendPointer(true);
      }
      if (release) { if (grab) endGrab(ray); else if (pointerDown) sendPointer(false); }
   }
   function windowUse(u) {
      const c = u && cards.get(u.module);
      if (c) sendUse(c, u.port, u.variable, true);
   }
   // A press takes the plug the gaze is on, or the one it was on within the last 0.2 s (the press moves the head).
   function startGrab(t) {
      if (!ws) return false;
      const c = bySlot(plugs.grabbable(t, occupied()));
      if (!c) return false;
      grab = { card: c.id, over: null };
      return true;
   }
   // Released on the bus: plugged in; anywhere else: unplugged. Nothing is sent when that is how the card is already.
   function endGrab(ray) {
      const g = grab, c = cards.get(g.card);
      grab = null;
      if (!c) return;
      const on = !!(ws && ray && onBus(ws, ray)), plugged = !unpluggedSet.has(c.id);
      if (on !== plugged) sendPlug(c, on);
   }

   // The messages per second of each variable: the count over the last RATE_S of live time (nothing while paused).
   function sampleRates(ms) {
      if (clock.paused) { if (rateAt !== -Infinity) { rateMarks = {}; rateAt = -Infinity; rates = NO_RATES; } return; }
      if (ms - rateAt < RATE_S * 1000) return;
      const dt = (ms - rateAt) / 1000, next = {}, marks = {};
      for (const [id, r] of Object.entries(rails)) {
         if (!finite(r.seq)) continue;
         marks[id] = r.seq;
         const was = rateMarks[id];
         next[id] = finite(was) && dt < 5 * RATE_S && r.seq >= was ? Math.round((r.seq - was) / dt * 10) / 10 : null;
      }
      rateMarks = marks; rateAt = ms;
      if (!sameJson(rates, next)) rates = next;
   }

   // The wheel: vertical scrolls the focused card, horizontal scrubs the timeline while paused (100 units = 1 s) and scrolls the
   // focused card sideways while live; a zoom step zooms the focused card.
   function stepWheel(t) {
      if (!clock.paused) { scrubT = null; scrubDirty = false; }          // live again: the runtime's playhead (none) is the one to show
      if (wheelZoom) {
         const c = focusedCard();
         if (c) setZoom(c, c.zoom - wheelZoom);                           // a step of +1 is in, which is the smaller zoom index
         wheelZoom = 0;
      }
      const onWindow = bw.over && !cmdLine;                  // a gaze on the bus window: the wheel is its own
      if (wheelDy) {
         const c = !cmdLine && !onWindow && focusedCard();
         if (onWindow) { busAcc += wheelDy * LINES_PER_PX; const n = Math.trunc(busAcc); busAcc -= n; if (n) bw.wheel(n); }
         else if (c) {
            scrollAcc += wheelDy * LINES_PER_PX;
            const n = Math.trunc(scrollAcc); scrollAcc -= n;
            if (n) c.buffer.apply({ op: 'scroll', lines: n }, now());
         }
         wheelDy = 0;
      }
      if (wheelDx) {
         if (clock.paused) {
            const range = clock.window;
            if (scrubT === null) scrubT = finite(clock.playhead) ? clock.playhead : range[1];
            const was = scrubT;
            scrubT = scrub(scrubT, wheelDx, range);
            if (scrubT !== was) scrubDirty = true;
         } else {
            const c = !cmdLine && !onWindow && focusedCard();
            if (c) {
               scrollXAcc += wheelDx * COLS_PER_PX;
               const n = Math.trunc(scrollXAcc); scrollXAcc -= n;
               if (n) c.buffer.apply({ op: 'scrollX', cols: n }, now());
            }
         }
         wheelDx = 0;
      }
      if (scrubDirty && t - scrubAt >= SEEK_S) { scrubDirty = false; scrubAt = t; send({ op: 'seek', t: scrubT }); }
      if (!scrubDirty && scrubT !== null && t - scrubAt > 0.5) scrubT = null;
   }

   function noticeOf(c, target) {
      const own = [...toasts].reverse().find(x => x.card === c.id);
      if (own) return own.text;
      if (c.id === null || (target && target.id === c.id)) {
         const g = [...toasts].reverse().find(x => x.card === null);
         if (g) return g.text;
         if (!paired) return 'waiting for the laptop';          // (the cards stay as they were while it is away)
      }
      return c.changedUnder && c.buffer.text !== c.running ? 'run changed under you' : null;
   }

   const pendingOf = c => { for (const p of pending.values()) if (p.module === c.id && p.op === 'commit') return true; return false; };

   // What each port of a card is bound to: [{ port, dir, variable, isDefault, bound, reason }]. An input asks for the variable of its `uses` entry,
   // else the one of its own name; an output always makes the one of its own name. `bound` is whether the runtime has the port on a rail;
   // when it has not, `reason` says why: 'unplugged', 'waiting: ...' (no such variable yet, or it is still on its way) or 'incompatible: ...'
   // (the variable is there with another kind or type). Worked out once per snapshot, and the same array as before when nothing in it changed.
   const sameBindings = (a, b) => a.length === b.length && a.every((x, i) => Object.keys(x).every(k => x[k] === b[i][k]));
   function bindingsOf(c) {
      if (c.bindingsRev === railsRev) return c.bindings;
      const plugged = !unpluggedSet.has(c.id);
      c.bindingsRev = railsRev;
      const next = c.ports.map(p => {
         const key = bindingKey(c.id, p.name), isDefault = p.dir === 'out' || !Object.hasOwn(uses, key), variable = isDefault ? p.name : uses[key], bound = p.rail != null;
         return { port: p.name, dir: p.dir, variable, isDefault, bound, reason: bound ? null : whyNot(p, variable, plugged) };
      });
      if (!sameBindings(c.bindings, next)) c.bindings = next;
      return c.bindings;
   }
   function whyNot(p, variable, plugged) {
      if (!plugged) return 'unplugged';
      if (p.dir === 'out') return 'not published';
      const r = Object.hasOwn(rails, variable) ? rails[variable] : null;
      if (r && r.kind) {
         if (!compatible({ dir: 'in', kind: p.kind, type: p.type }, r).ok) return `incompatible: ${variable} is ${r.kind} ${r.type}, ${p.name} is ${p.kind} ${p.type}`;
         return `waiting: ${variable} is not connected yet`;
      }
      return varSet && varSet.has(variable) ? `waiting: ${variable} is still arriving` : `waiting: no variable '${variable}' yet`;
   }

   // The uses and plugs of a card that were acked while paused and are not in the head yet.
   const NONE = [];
   const queuedOf = id => {
      let out = NONE;
      for (const q of queued.values()) if (q.card === id) { if (out === NONE) out = []; out.push({ what: q.what, note: 'applies when you resume' }); }
      return out;
   };

   function cardState(c, t, ctx) {
      const slot = c.slot, charging = focus.charging && focus.charging.slot === slot ? { p: focus.charging.p } : null;
      const focused = focus.focus === slot, isCmd = cmdLine && ctx.commandCard === c.id;
      const notice = noticeOf(c, ctx.message), isPending = pendingOf(c);
      const ports = c.ports;
      return { name: c.id, ver: c.ver, buffer: c.buffer, status: c.status, error: c.error, editError: c.editError, ports,
         bindings: bindingsOf(c), zoom: c.zoom, cols: c.buffer.cols, rows: c.buffer.rows, scrollX: c.buffer.scrollX, unplugged: unpluggedSet.has(c.id), queued: queuedOf(c.id), focused, hovered: ctx.hover === slot && !focused, charging, pending: isPending, notice, command: isCmd ? cmdLine.text : null,
         echo: focused ? (kbLost ? 'keyboard lost focus' : echo.slice()) : null, time: t };
   }

   // The draw lists as they are at time `ms`: each module's last two, moved by the fraction of the way through the
   // interval between their arrivals (one snapshot behind, so there is always a next to move towards). Only two pictures that
   // are neighbours in simulated time (the second at most BLEND_MAX later than the first, never earlier) and that arrived close
   // together are blended. After a seek, a long pause or a jump of the clock the new picture is shown at once: a draw is sent
   // only when it changed, so the one before it can be seconds old and the blend would glide slowly from there.
   function drawLists(ms) {
      const out = {};
      for (const c of cards.values()) {
         if (!c.draw.length && !(c.drawPrev && c.drawPrev.length)) continue;
         const span = c.drawAt - c.drawPrevAt, dT = c.drawT - c.drawPrevT;
         out[c.id] = c.drawPrev && span > 0 && span <= BLEND_MAX * 1000 && dT > 0 && dT <= BLEND_MAX ? lerpDraw(c.drawPrev, c.draw, cg.clamp((ms - c.drawAt) / span, 0, 1)) : c.draw;
      }
      return out;
   }

   // The gaze on the bus band for BAND_S, with no button held and no plug in hand, opens the bus window. After it was closed, or a button went
   // down on the band (a plug let go there), it is the gaze leaving the band that arms it again.
   function watchBand(t, ray) {
      if (bwWasOpen && !bw.open) armed = false;
      const band = !!(ws && ray && onBus(ws, ray)) && plugs.slot === null;                     // (a plug under the gaze comes first: looking at one does not open the window)
      if (!band) { armed = true; bandSince = null; }
      else if (held.buttons.size || grab) { armed = false; bandSince = null; }
      else if (lastTextKeyT !== null && t - lastTextKeyT < TYPING_LOCK) bandSince = null;      // a glance down while typing opens nothing
      else if (armed && !bw.open) {
         if (bandSince === null) bandSince = t;
         if (t - bandSince >= BAND_S - 1e-9) { bw.openAt(lastYaw ?? 0); bandSince = null; }
      } else bandSince = null;
      bwWasOpen = bw.open;
   }

   // What the cursor shows: where the (smoothed) gaze meets what it hits first, what that is, how far along the wait for it is (the card's
   // 350 ms focus dwell, the bus window's 0.4 s opener), whether a plug is in hand, and the plug under the gaze (or in hand). Null when there is no
   // workspace or no usable ray. While a plug is in hand the plug targets do not count (what matters is where it would be let go).
   function gazeView(t, ray, hover) {
      if (!ws || !ray) return null;
      const target = grab ? null : plugs.slot;
      const at = gazeAt(ws, ray, { window: bw.over ? bw.frameYaw : null, stage, plug: target, bus: onBus(ws, ray), card: hover });
      if (!at) return null;
      let progress = 0;
      if (at.kind === 'card' && focus.charging && focus.charging.slot === hover) progress = focus.charging.p;
      else if (at.kind === 'bus' && bandSince !== null) progress = Math.min(1, Math.max(0, (t - bandSince) / BAND_S));
      const held = grab && cards.get(grab.card);
      return { point: at.point, dist: at.dist, kind: at.kind, progress, holding: !!grab, plug: held ? held.slot : target };
   }

   // What the bus window is shown from: the focused card's bindings and the variables (the same objects while nothing changed).
   function busWindowView(t) {
      if (!bw.open) return bw.view(null, null, t);
      busSrc.rails = rails; busSrc.vars = vars || NONE; busSrc.railsRev = railsRev; busSrc.paused = clock.paused; busSrc.playhead = scrubT ?? clock.playhead;
      busSrc.window = clock.window; busSrc.rates = rates;
      const c = focusedCard();
      if (c) {
         busCard.name = c.id; busCard.unplugged = unpluggedSet.has(c.id); busCard.bindings = bindingsOf(c); busCard.pending.length = 0;
         for (const p of pending.values()) if (p.op === 'use' && p.module === c.id) busCard.pending.push(p.port);
      }
      return bw.view(busSrc, c ? busCard : null, t);
   }

   function frame({ head = null, hands = [] } = {}) {
      if (!active) return null;
      const ms = now(), t = ms / 1000;
      toasts = toasts.filter(x => x.until > t);
      // Expire what has waited too long.
      for (const p of [...pending.values()]) if (ms - p.at > NO_ANSWER_MS) { unpend(p); tell(p.win, `${p.op}: no answer`, cardIf(p.module)); }
      // A use or plug that waited for the resume stays until the head shows it (while paused for as long as it takes, after it for a few seconds).
      for (const [k, q] of queued) if (!cards.has(q.card) || q.done() || (q.until < t && !clock.paused)) queued.delete(k);
      if (confirm && confirm.until < t) confirm = null;
      // The workspace is made from the first head and again when asked; the desk is the left hand's X, else eye - 0.45 m.
      if (recentre) { ws = null; recentre = false; }
      if (!ws && isMatrix(head)) { ws = workspace(head); stage = null; }
      const left = hands.find(h => h && h.hand === 'left' && isMatrix(h.m));
      const x = !!(left && left.buttons && left.buttons[4] && left.buttons[4].pressed);
      if (x && !leftX && ws) { deskY = left.m[13]; stage = null; say('desk set here', null, 2); }
      leftX = x;
      if (ws && !stage) stage = stageFrame(ws, deskY ?? ws.eyeY - DESK_BELOW_EYE);
      const ray = rayOf(head, t);
      lastYaw = ws && ray ? (yawPitchOf(ws, ray) || {}).yaw ?? null : null;
      bw.hoverAt(ray, ws);
      const occ = occupied();
      plugs.update(ws, bw.over ? null : ray, occ, t);                  // (the window is in front of the plugs: a gaze on it is not on a plug)
      watchBand(t, ray);
      sampleRates(ms);
      if (grab) { if (cards.has(grab.card)) { const over = ws && ray && onBus(ws, ray) ? 'bus' : null; if (over !== grab.over) grab = { card: grab.card, over }; } else grab = null; }
      // Gaze: the card under it takes focus after the dwell (not through the bus window, which is in front of the cards); the desk under it is the gaze device.
      let hover = null;
      if (ws && ray) {
         hover = bw.over ? null : hitCard(ws, ray, occ, focus.focus);
         focus = stepFocus(focus, { t, hit: hover, lastTextKeyT });
         if (focus.focus != null && !bySlot(focus.focus)) focus = releaseFocus();
      }
      lastSlotsHit = hover;
      stepPointer(ray, t);
      stepWheel(t);
      const hit = stage && ray ? deskHit(ray, stage) : null;
      sendDevices(hit, !!hit);
      const gaze = gazeView(t, ray, hover);
      const message = messageCard(), ctx = { hover, message, commandCard: commandCardId(message) };
      const slots = SLOTS.map((_, slot) => {
         const c = bySlot(slot);
         return c ? { slot, id: c.id, state: cardState(c, t, ctx) } : null;
      });
      // With no card at all the command line still needs somewhere to show: the middle slot, which then exists for it.
      if (cmdLine && !cards.size) slots[2] = { slot: 2, id: null, state: { name: '(no card)', ver: null, buffer: { lines: [''], row: 0, col: 0, scroll: 0, dirty: false },
         status: 'ok', error: null, editError: null, ports: [], bindings: [], zoom: ZOOM_DEFAULT, cols: ZOOMS[ZOOM_DEFAULT].cols, rows: ZOOMS[ZOOM_DEFAULT].rows, scrollX: 0, unplugged: false, queued: NONE, focused: true, hovered: false, charging: null, pending: false,
         notice: noticeOf({ id: null }, message), command: cmdLine.text, echo: null, time: t } };
      return { ws, stage, slots, draws: drawLists(ms), focus: focus.focus, hover, paused: clock.paused, playing, playhead: scrubT ?? clock.playhead, window: clock.window,
         density: clock.density, rails, vars: vars || NONE, uses, unplugged, railsRev, ray, busOpen: bw.open, bus: busWindowView(t), plugGrab: grab, gaze };
   }

   // ---- hooking up -------------------------------------------------------------------------------------------------
   link.on('in', onIn); link.on('snap', m => { if (active && isObject(m.snap)) applySnap(m.snap); });
   link.on('ack', onAck); link.on('release', onRelease); link.on('pair', onPair);

   // The log line's fields: names and counts, never text.
   let railMarks = {}, railRows = [], railRowsAt = -Infinity;
   // (While the IDE is not the active part the cards and rails are null, so that the scene reports what it heard of the runtime.)
   const debug = {
      get focus() { const c = active && focusedCard(); return c ? c.id : null; },
      get cards() { return !active ? null : [...cards.values()].sort((a, b) => a.slot - b.slot).map(c => [c.id, statusOf({ status: c.status, error: c.error, editError: c.editError, buffer: c.buffer }), c.buffer.dirty]); },
      // [id, kind, publishers, subscribers, messages per second]; the rate is over the time since the last look, at most once a second.
      get rails() {
         if (!active) return null;
         const ms = now();
         if (ms - railRowsAt < 1000) return railRows;
         const dt = (ms - railRowsAt) / 1000;
         railRows = Object.entries(rails).filter(([, r]) => r.kind).map(([id, r]) => {
            const m = railMarks[id], rate = m && finite(r.seq) && finite(m.seq) && dt > 0 && dt < 60 ? Math.round((r.seq - m.seq) / dt * 10) / 10 : null;
            railMarks[id] = { seq: r.seq };
            return [id, r.kind, (r.pubs || []).length, (r.subs || []).length, rate];
         });
         railRowsAt = ms;
         return railRows;
      },
   };

   // For the tests. This does carry text (the buffers), so it is not part of `debug`.
   const inspect = {
      card: id => cards.get(id) || null,
      text: id => cards.get(id)?.buffer.text ?? null,
      running: id => cards.get(id)?.running ?? null,
      get held() { return { buttons: [...held.buttons], keys: [...held.keys] }; },
      get pending() { return [...pending.values()].map(p => ({ id: p.id, op: p.op, module: p.module })); },
      get toasts() { return toasts.map(x => x.text); },
      get command() { return cmdLine ? cmdLine.text : null; },
      get clock() { return { ...clock, playhead: scrubT ?? clock.playhead }; },
      get ws() { return ws; }, get stage() { return stage; }, get rev() { return rev; }, get paired() { return paired; }, get active() { return active; },
      get expectFull() { return expectFull; }, get rails() { return rails; }, get kbLost() { return kbLost; },
      get hover() { return lastSlotsHit; }, get focusState() { return focus; }, stats,
      // Focus a slot and hold the gaze on it (the test's head may be looking anywhere, and the dwell would move the focus).
      setFocus(slot) {
         focus = setFocus(slot);
         if (!ws) return;
         const a = ws.yaw + SLOTS[slot] * Math.PI / 180;
         aimRay = { o: [...ws.origin], d: unit([Math.sin(a) * 1.25, -0.02, -Math.cos(a) * 1.25]) };
      },
      aim(ray) { aimRay = ray; },
      lastTextKeyT: () => lastTextKeyT,
   };

   return {
      frame, debug, inspect,
      // A new workspace from the next head (as Mod+Home); `desk` also forgets a desk height that was set by hand (the page entered XR).
      recentre(desk = false) { recentre = true; if (desk) deskY = null; },
      setActive(on) {
         on = !!on;
         if (on === active) return;
         active = on;
         if (!on) { releaseAll(); paired = false; kbLost = false; cmdLine = null; pending.clear(); smoother.reset(); plugs.reset(); }
      },
   };
}
