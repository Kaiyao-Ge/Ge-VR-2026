// The pure formatting helpers of the IDE core: the key as the echo line shows it, and the move of a draw list between two snapshots. No state, no clock.
import { isObject, finite } from './values.js';

// The key as the echo line shows it: `ctrl+Enter`, `a`, `Space`.
export function keyLabel(ev) {
   const m = ev.mods || {}, name = ev.key === ' ' ? 'Space' : ev.key;
   const mods = (m.c ? 'ctrl+' : '') + (m.a ? 'alt+' : '') + (m.m ? 'cmd+' : '') + (m.s && name.length > 1 ? 'shift+' : '');
   return mods + name;
}

// The shapes of a draw list between two snapshots, by position: the same shape kinds in the same order are moved a
// fraction `a` of the way from `prev` to `cur` (numbers and number arrays), anything else is the newer list as it is.
// The snapshots come at 30 Hz and the headset draws at 72 or 90, so this is what makes the stage move smoothly.
const lerpValue = (p, c, a) => typeof p === 'number' && typeof c === 'number' ? p + (c - p) * a
   : Array.isArray(p) && Array.isArray(c) && p.length === c.length && p.every(finite) && c.every(finite) ? c.map((v, i) => p[i] + (v - p[i]) * a)
   : c;
export function lerpDraw(prev, cur, a) {
   if (!Array.isArray(prev) || !Array.isArray(cur) || prev.length !== cur.length || a >= 1) return cur;
   if (a <= 0) return prev;
   const out = [];
   for (let i = 0; i < cur.length; i++) {
      const p = prev[i], c = cur[i];
      if (!isObject(p) || !isObject(c) || p.shape !== c.shape) return cur;
      const o = { ...c };
      for (const k of ['p', 'to', 's']) if (k in c && k in p) o[k] = lerpValue(p[k], c[k], a);
      out.push(o);
   }
   return out;
}
