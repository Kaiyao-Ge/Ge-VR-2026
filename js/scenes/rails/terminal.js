// The laptop's input for Rails: the real keyboard and trackpad of the laptop, captured on the window and sent to the
// headset as `in` events (doc/hw9-design.md, section 3.3), plus a small HUD that tells the person at the laptop what is happening.
// Our own capture-phase listeners, not the course's kbdEvents state: upstream's interactMode 4 leaves its Space flag set
// after Space+K, so the first typed `k` would end the mode again. window.keydown and window.keyup are set to the same
// path anyway, so that the course's mode 4 reaches us too; an event that arrives by both routes is handled once.
//
// Only while active() is true (the page is the runtime, or alone) is anything taken. A key that is sent is also
// prevented and stopped, so that Tab, Space and Backspace do not act on the laptop's page and the viewer's own keys do
// not fly the camera. A key that the browser or the OS keeps (Mod+W/T/N/Q/R, F5, F11, F12, Ctrl+Tab, Alt+Tab) is never
// taken, nor is anything typed into an INPUT or TEXTAREA; Mod+V is sent but not prevented, so that the browser's own paste
// event comes, which carries the text. A key or paste that sendIn refuses is not consumed either. Mod is Cmd on a Mac
// and Ctrl elsewhere.
// The wheel is summed and sent once a frame (flush(), called by the scene) and before any other event, so the order holds.
// Shift+wheel with no sideways delta of its own is sideways (a mouse has no horizontal wheel). Ctrl+wheel and Cmd+wheel (a pinch
// arrives as Ctrl+wheel) are never the page's zoom: they are zoom steps for the focused card, one per ZOOM_UNITS of wheel, wheel up = in.
import { clamp } from '../../render/core/cg.js';
import { MAX_PASTE } from './values.js';
import { MAX_KEY } from './wire.js';

const SHOWN_KEYS = 5, MAX_CODE = 32;
const ZOOM_UNITS = 40;                                         // wheel units for one zoom step (a notch is 48 to 120, a pinch many small ones)
const ZOOM_KEEP_MS = 200;                                      // the part of a step is kept this long without a zoom event
const NOTCH_UNITS = 4;                                         // a lone zoom event (after a pause) of this many units is a step by itself
const RESERVED = new Set(['w', 't', 'n', 'q', 'r']);          // with Mod
const FKEYS = new Set(['F5', 'F11', 'F12']);
const MODIFIERS = new Set(['Control', 'Shift', 'Alt', 'AltGraph', 'Meta', 'CapsLock', 'OS']);

const isText = v => typeof v === 'string';
const clamp01 = v => Number.isFinite(v) ? clamp(v) : 0;
// A form field of the page is the page's own: keys typed there are not ours.
const typing = t => !!t && (['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName) || t.isContentEditable === true);

export const modOf = (e, mac) => !!(mac ? e.metaKey : e.ctrlKey);

// Keys the browser or the OS keeps for itself.
export function reserved(e, mac) {
   const key = isText(e.key) ? e.key : '';
   if (FKEYS.has(key)) return true;
   if (!mac && e.metaKey) return true;                          // the Windows key and its combinations belong to the OS
   if (modOf(e, mac) && RESERVED.has(key.toLowerCase())) return true;
   return key === 'Tab' && (!!e.ctrlKey || !!e.altKey);        // Ctrl+Tab switches tabs, Alt+Tab windows
}

// The `in` event of a key, or null when the wire would not take it (a name over 16 characters, for one).
export function keyEvent(e, d) {
   if (!e || !isText(e.key) || e.key.length < 1 || e.key.length > MAX_KEY) return null;
   const code = isText(e.code) ? e.code.slice(0, MAX_CODE) : '';
   return { k: 'key', d, key: e.key, code, mods: { c: !!e.ctrlKey, a: !!e.altKey, s: !!e.shiftKey, m: !!e.metaKey }, rep: !!e.repeat };
}

// The text of a paste: at most the wire's limit, with no half of a surrogate pair at the cut, and line ends as \n.
export function pasteText(text) {
   let t = text.replace(/\r\n?/g, '\n').slice(0, MAX_PASTE);
   const last = t.charCodeAt(t.length - 1);
   if (last >= 0xd800 && last <= 0xdbff) t = t.slice(0, -1);
   return t;
}

// The keys of the editor for the HUD, with the laptop's own name for Mod.
export function keymapText(mac) {
   const m = mac ? 'Cmd' : 'Ctrl';
   return [
      `${m}+Enter run   ${m}+Shift+Enter continue from here (paused)`,
      `${m}+Z undo   ${m}+Shift+Z redo${mac ? '' : '   Ctrl+Y redo'}`,
      `${m}+P pause   ${m}+. play   ${m}+Home recentre`,
      `${m}+Backspace delete to line start   ${m}+V paste`,
      ...(mac ? ['Cmd+Left / Cmd+Right home / end'] : []),
      'Esc command line, then release focus',
      'command line: card rm rename undo reset revert pause live play use plug unplug here',
      'arrows, Home, End, PageUp, PageDown move; Tab = 2 spaces',
      'wheel: up/down scroll; Shift+wheel (or left/right) sideways, or scrub while paused',
      `${m}+wheel or ${m}+= / ${m}+- zoom the card, ${m}+0 resets`,
      `${m}+B bus window   ${m}+[ / ${m}+] step the playhead (Shift: finer, paused)`,
      'hold the button on a plug to plug or unplug a card',
      `never taken: ${m}+W/T/N/Q/R, F5, F11, F12, Ctrl+Tab, Alt+Tab`,
   ].join('\n');
}

// How a key is shown in the HUD: "Ctrl+Enter", "a", "Space".
const label = (ev, mac) => {
   const name = ev.key === ' ' ? 'Space' : ev.key;
   const { c, a, s, m } = ev.mods;
   return [c ? 'Ctrl' : '', a ? 'Alt' : '', s && name.length > 1 ? 'Shift' : '', m ? (mac ? 'Cmd' : 'Meta') : '', name].filter(Boolean).join('+');
};

// win, doc: the window and document (the defaults are the page's). sendIn(ev) -> bool sends an `in` event;
// onPointer({x, y}) gets the pointer's place in the window, each from 0 to 1; mac: the laptop is a Mac;
// active() -> bool: whether anything is taken now; listen(target, event, handler, options), if given, adds the listeners
// instead (it may return a function that removes it). Returns { status(view), flush(), dispose(), stats, keys() }.
export function createTerminal({ win = globalThis.window, doc = globalThis.document, listen, sendIn, onPointer = () => {},
                                 mac = false, active = () => true, now = () => (globalThis.performance ? performance.now() : Date.now()) }) {
   const stats = { sent: 0, refused: 0, blurs: 0, keys: 0 };
   const disposers = [], seen = new WeakSet(), shown = [];
   let wheelX = 0, wheelY = 0, wheelZ = 0, zoomN = 0, zoomAcc = 0, zoomAt = -Infinity, gone = false;

   const on = (event, handler, options = { capture: true }) => {
      if (listen) {
         const off = listen(win, event, handler, options);
         if (typeof off === 'function') disposers.push(off);
         return;
      }
      win.addEventListener(event, handler, options);
      disposers.push(() => win.removeEventListener(event, handler, options));
   };

   const flush = () => {
      const dx = wheelX, dy = wheelY, dz = wheelZ, n = zoomN;
      wheelX = wheelY = wheelZ = zoomN = 0;
      // Zoom: small deltas add up to a step per ZOOM_UNITS; what is left after ZOOM_KEEP_MS without a zoom event is forgotten; a single
      // event after such a pause that is a notch (NOTCH_UNITS, so any line-mode one) is a step at once.
      let step = 0;
      if (n > 0) {
         const t = now(), pause = t - zoomAt > ZOOM_KEEP_MS;
         if (pause) zoomAcc = 0;
         zoomAcc += dz; zoomAt = t;
         if (Math.abs(zoomAcc) >= ZOOM_UNITS || (pause && n === 1 && Math.abs(dz) >= NOTCH_UNITS)) { step = Math.sign(zoomAcc); zoomAcc = 0; }
      }
      if (!active()) return;
      if (dx !== 0 || dy !== 0) send({ k: 'wheel', dx, dy });
      if (step) send({ k: 'wheel', dx: 0, dy: 0, zoom: step });
   };
   const send = ev => {
      if (ev.k !== 'wheel') flush();
      if (sendIn(ev) === false) { stats.refused++; return false; }
      stats.sent++;
      return true;
   };
   const consume = e => { e.preventDefault?.(); e.stopImmediatePropagation?.(); };

   // ---- keys ---------------------------------------------------------------------------------------------------------
   // One path for the capture listeners and for window.keydown/keyup; an event that comes by both is taken once.
   const onKey = (e, d) => {
      if (gone || !e || typeof e !== 'object' || seen.has(e) || !active()) return;
      seen.add(e);
      if (typing(e.target) || reserved(e, mac)) return;
      const ev = keyEvent(e, d);
      if (!ev) return;
      if (!send(ev)) return;     // a key that was not sent is left to the page
      if (d === 'down' && !MODIFIERS.has(ev.key) && !ev.rep) {
         shown.push(label(ev, mac)); stats.keys++;
         if (shown.length > SHOWN_KEYS) shown.shift();
      }
      if (modOf(e, mac) && ev.key.toLowerCase() === 'v') e.stopImmediatePropagation?.();   // the paste event must still come
      else consume(e);
   };
   on('keydown', e => onKey(e, 'down'));
   on('keyup', e => onKey(e, 'up'));
   const hooks = { keydown: win.keydown, keyup: win.keyup };
   const ownDown = e => onKey(e, 'down'), ownUp = e => onKey(e, 'up');
   win.keydown = ownDown; win.keyup = ownUp;

   // ---- paste, wheel, trackpad ---------------------------------------------------------------------------------------
   on('paste', e => {
      if (gone || !active() || typing(e.target)) return;
      const data = e.clipboardData;
      const text = data && typeof data.getData === 'function' ? data.getData('text/plain') || data.getData('text') : '';
      if (isText(text) && text && !send({ k: 'paste', text: pasteText(text) })) return;
      consume(e);
   });

   on('wheel', e => {
      if (gone || !active() || typing(e.target)) return;
      e.preventDefault?.();       // no page scroll, no pinch zoom
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? (win.innerHeight || 800) : 1;
      const num = v => (Number.isFinite(Number(v)) ? Number(v) : 0) * unit;
      const x = num(e.deltaX), y = num(e.deltaY);
      if (e.ctrlKey || e.metaKey) { wheelZ -= y; zoomN++; }     // wheel up (a negative delta) zooms in
      else if (e.shiftKey && x === 0) wheelX += y;              // Shift+wheel: sideways
      else { wheelX += x; wheelY += y; }
   }, { capture: true, passive: false });

   on('mousemove', e => {
      if (gone || !active()) return;
      onPointer({ x: clamp01(e.clientX / (win.innerWidth || 1)), y: clamp01(e.clientY / (win.innerHeight || 1)) });
   });
   on('mousedown', e => { if (!gone && active() && e.button === 0 && !typing(e.target)) send({ k: 'btn', d: 'down' }); });
   on('mouseup', e => { if (!gone && active() && e.button === 0) send({ k: 'btn', d: 'up' }); });

   // The window lost the keyboard: the headset lets go of every key and button. (A blur of an element reaches a capture
   // listener on the window too, and is not this.)
   on('blur', e => {
      if (gone || !active() || (e && e.target && e.target !== win)) return;
      stats.blurs++;
      send({ k: 'blur' });
   });

   // ---- the HUD ------------------------------------------------------------------------------------------------------
   let hud = null, shownText = null;
   if (doc && doc.body && typeof doc.createElement === 'function') {
      hud = doc.createElement('div');
      hud.id = 'rails-terminal';
      hud.style.cssText = 'position:fixed;left:12px;top:12px;z-index:10;max-width:520px;padding:10px 12px;border-radius:6px;' +
         'background:rgba(0,0,0,.72);color:#e8e8e8;font:12px/1.45 monospace;white-space:pre-wrap;pointer-events:none;display:none';
      doc.body.appendChild(hud);
   }

   // view: { link: text, role, focus }; returns the text it shows. Called every frame; the DOM is touched only on a change.
   const status = (view = {}) => {
      const live = active();
      const text = [
         `RAILS  laptop terminal   role: ${view.role ?? '?'}`,
         `link: ${view.link ?? '?'}`,
         `focus: ${view.focus ?? 'on the headset'}`,
         `keys: ${shown.length ? shown.join('  ') : '-'}`,
         '',
         keymapText(mac),
         '',
         'Keep this window visible and in front: the runtime stops when the page is hidden.',
      ].join('\n');
      if (hud && !gone) {
         if (text !== shownText) { hud.textContent = text; shownText = text; }
         hud.style.display = live ? 'block' : 'none';
      }
      return text;
   };

   const dispose = () => {
      if (gone) return;
      gone = true;
      for (const off of disposers.splice(0)) off();
      if (win.keydown === ownDown) win.keydown = hooks.keydown;
      if (win.keyup === ownUp) win.keyup = hooks.keyup;
      if (hud && hud.parentNode) hud.parentNode.removeChild(hud);
      hud = null; wheelX = wheelY = wheelZ = zoomN = zoomAcc = 0; shown.length = 0;
   };

   return { status, flush, dispose, stats, keys: () => [...shown] };
}
