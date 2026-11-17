// The timeline, pure: the scrub (the horizontal trackpad scroll moves the playhead while paused, 100 wheel units to the
// second, and the playhead stays inside the recorded window of 30 s) and, below, the strip above the cards: where the
// playhead falls on it, its ticks and banner, its picture on a 2D context, and when that picture is painted again.
import { clamp } from '../../render/core/cg.js';
import { finite } from './values.js';

export const UNITS_PER_SECOND = 100;

// `range` is [min, max], {min, max} or {t0, t1} in seconds; a positive `dx` moves the playhead later.
// A playhead that is not a finite number (a bad restore) becomes the window's end, i.e. now.
export function scrub(playhead, dx, range) {
   const [a, b] = Array.isArray(range) ? range : [range.min ?? range.t0, range.max ?? range.t1];
   const lo = Math.min(a, b), hi = Math.max(a, b);
   if (!Number.isFinite(playhead)) return hi;
   const t = playhead + (Number.isFinite(dx) ? dx / UNITS_PER_SECOND : 0);
   return clamp(t, lo, hi);
}

// ---- the strip above the cards (spec 2.1, 2.5) ----
//
// The strip is 1.5 m wide and 0.03 m high (0.06 m while paused), 0.40 m above the eye at the cylinder's radius, and shows the
// recorded window (30 s at most): a density plot of the messages (60 bins), a tick every 5 s counted back from now, and the
// playhead. One canvas holds the plot and the ticks and the banner; the playhead is a quad on top (timelineView.js), so that
// scrubbing repaints nothing. The canvas is as dense as the strip is wide (a metre is 1365 px) in both directions and shows the
// strip fully in either of its two heights: live, the same picture is drawn at half the height, with the vertical scale doubled
// (the quad is half as high, so the two cancel); paused, it is drawn at the full 82 px and has room for the banner.

export const TIMELINE = { w: 1.5, h: 0.03, hPaused: 0.06, y: 0.40, margin: 0.012 };   // metres; y above the eye
export const STRIP = { w: 2048, h: 82 };                                                // the canvas's pixels (1365 per metre)
export const REPAINT_S = 0.1;                                                           // paused (scrubbing): painted again at most 10 times a second
export const LIVE_REPAINT_S = 1;                                                        // live: at most once a second (a bin of the plot moves by about a pixel in that time)
export const TICK_S = 5;
const COLOUR = { back: '#0b1320', backPaused: '#1c1708', bar: '#3a8fd0', barPaused: '#6b7f94', tick: '#7f93a8', ink: '#d7e3f4', amber: '#ffb000' };

// The window [t0, t1] as numbers (a bad one is an empty window at 0).
const span = w => (Array.isArray(w) && finite(w[0]) && finite(w[1]) && w[1] > w[0] ? w[1] - w[0] : 0);

// Where in the window (0 = oldest, 1 = now) a time falls; the playhead of a live strip (null) is at now.
export function fractionOf(playhead, window) {
   const s = span(window);
   if (!s || !finite(playhead)) return 1;
   return clamp((playhead - window[0]) / s);
}
// And back: the bus time of a fraction.
export function timeOf(fraction, window) {
   const s = span(window);
   return s ? window[0] + clamp(fraction) * s : (Array.isArray(window) && finite(window[1]) ? window[1] : 0);
}
// A fraction as the x of the strip's own frame (metres, 0 in the middle): the plot runs between the two margins.
export const xOfFraction = fraction => (fraction - 0.5) * (TIMELINE.w - 2 * TIMELINE.margin);
export const fractionOfX = x => clamp(x / (TIMELINE.w - 2 * TIMELINE.margin) + 0.5);

// A mark every TICK_S seconds counted back from the end of the window: [{ fraction, label }] with `-25`, `-20`, ... and `now`.
export function ticks(window) {
   const s = span(window), out = [];
   if (!s) return out;
   for (let k = 0; k * TICK_S <= s + 1e-9; k++) out.push({ fraction: 1 - k * TICK_S / s, label: k === 0 ? 'now' : String(-k * TICK_S) });
   return out;
}

// How far back the playhead is, in tenths of a second (0 at the end of the window); null while live.
export const behindTenths = (playhead, window) => (finite(playhead) && span(window) ? Math.max(0, Math.round((window[1] - playhead) * 10)) : null);
// That, as every paused text shows it (the banner and the bus window's header): `−3.2 s` (U+2212), `0.0 s` at the end.
export const behindText = tenths => `${tenths > 0 ? '\u2212' : ''}${(tenths / 10).toFixed(1)} s`;

// The banner of a paused strip: `PAST −12.4 s` while the playhead is before the window's end (the scene shows that moment), `PAUSED 0.0 s`
// at the end (the scene is now), `PLAYING −12.4 s` while the recording plays.
export function banner({ paused, playing, playhead, window }) {
   if (!paused) return '';
   const b = behindTenths(playhead, window), head = playing ? 'PLAYING' : b > 0 ? 'PAST' : 'PAUSED';
   return b === null ? head : `${head} ${behindText(b)}`;
}

// What the strip says next to the banner while the scene is the past (null at now, live, or with no playhead).
export const pastHint = (paused, playhead, window) => (paused && behindTenths(playhead, window) > 0 ? 'Mod+Shift+Enter here · Mod+P now' : null);

// The density bars as heights in 0..1, the tallest bin being 1 (all zero for a quiet tape).
export function barHeights(density, n = 60) {
   const out = new Array(n).fill(0);
   if (!Array.isArray(density)) return out;
   let top = 0;
   for (let i = 0; i < n; i++) { const v = density[i]; if (finite(v) && v > 0) top = Math.max(top, v); }
   if (top > 0) for (let i = 0; i < n; i++) { const v = density[i]; out[i] = finite(v) && v > 0 ? v / top : 0; }
   return out;
}

// The strip's picture, with nothing but 2D context calls (so Node can draw it on a recording context).
// s: { window, density, paused, playing, playhead }.
export function drawTimeline(ctx, s) {
   const paused = !!s.paused, H = paused ? STRIP.h : STRIP.h / 2;      // the height of the picture in its own units
   const left = TIMELINE.margin / TIMELINE.w * STRIP.w, right = STRIP.w - left, width = right - left;
   ctx.save();
   ctx.setTransform(1, 0, 0, paused ? 1 : 2, 0, 0);
   ctx.fillStyle = paused ? COLOUR.backPaused : COLOUR.back;
   ctx.fillRect(0, 0, STRIP.w, H);
   const top = paused ? 34 : 3, bottom = paused ? 66 : 27;              // the plot's rows
   const heights = barHeights(s.density), step = width / heights.length;
   ctx.fillStyle = paused ? COLOUR.barPaused : COLOUR.bar;
   for (let i = 0; i < heights.length; i++) {
      const h = Math.max(heights[i] > 0 ? 1 : 0, heights[i] * (bottom - top));
      if (h > 0) ctx.fillRect(left + i * step + 1, bottom - h, Math.max(1, step - 2), h);
   }
   ctx.fillStyle = COLOUR.tick; ctx.strokeStyle = COLOUR.tick; ctx.lineWidth = 1;
   ctx.font = '13px sans-serif'; ctx.textAlign = 'center';
   for (const k of ticks(s.window)) {
      const x = left + k.fraction * width;
      ctx.fillRect(x - 0.5, bottom, 1, 4);
      ctx.fillText(k.label, Math.min(right - 12, Math.max(left + 8, x)), H - 2);
   }
   if (paused) {
      const text = banner(s);
      ctx.textAlign = 'left'; ctx.font = 'bold 26px sans-serif';
      ctx.fillStyle = COLOUR.amber;
      if (text) ctx.fillText(text, left + 4, 27);
      const hint = pastHint(true, s.playhead, s.window);
      if (hint) { ctx.textAlign = 'right'; ctx.font = 'bold 20px sans-serif'; ctx.fillText(hint, right - 4, 27); }
   }
   ctx.restore();
}

// When the strip's canvas needs painting again: when what it shows changed (compared as numbers, nothing allocated unless it
// does). A change of `paused`, `playing` or, while paused or playing, the window's length (to whole seconds) is painted on
// the very next call, so that the picture and the strip's height never disagree (live, the ticks count back from now, and the window
// of a full tape saw-tooths between 29 and 30 s as the recorder drops a second at a time: no change worth a paint); the plot and the banner's tenths are painted at most every REPAINT_S
// while paused and every LIVE_REPAINT_S while live, and a change that has to wait is painted by a later call.
// `s` is what drawTimeline takes.
export class StripPaint {
   constructor() { this.last = null; this.at = -Infinity; this.density = []; this.painted = 0; }
   // True when the caller must paint `s` now (at time `t`, seconds).
   changed(s, t) {
      const prev = this.last, d = Array.isArray(s.density) ? s.density : [];
      const behind = s.paused ? behindTenths(s.playhead, s.window) : null, len = Math.round(span(s.window));
      const structural = !prev || prev.paused !== !!s.paused || prev.playing !== !!s.playing || ((s.paused || s.playing) && prev.len !== len);
      if (!structural) {
         let same = prev.behind === behind && this.density.length === d.length;
         for (let i = 0; same && i < d.length; i++) if (d[i] !== this.density[i]) same = false;
         if (same) return false;
         if (t - this.at < (s.paused ? REPAINT_S : LIVE_REPAINT_S)) return false;
      }
      this.last = { paused: !!s.paused, playing: !!s.playing, behind, len };
      this.density.length = d.length;
      for (let i = 0; i < d.length; i++) this.density[i] = d[i];
      this.at = t; this.painted++;
      return true;
   }
}
