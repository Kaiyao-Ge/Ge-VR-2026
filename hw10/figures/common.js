// HW10 shared helpers: the HW10 namespace, figure registration and mounting, small SVG and time helpers.
// A classic script (no modules). It touches `document` only inside mountAll and the DOMContentLoaded hook, so Node can load it.
(function () {
   const H = globalThis.HW10 = globalThis.HW10 || {};
   const SVG_NS = 'http://www.w3.org/2000/svg';

   H.logic = H.logic || {};          // each figure's pure logic, by figure name (tested in Node)
   H.figures = H.figures || {};      // each figure's mount function, by figure name
   if (!('story' in H)) H.story = null;   // story.js fills this in

   // Registers the mount of the figure whose container has data-fig="<name>".
   H.register = (name, mount) => {
      if (typeof name !== 'string' || !name) throw new TypeError('HW10.register: a figure needs a name');
      if (typeof mount !== 'function') throw new TypeError(`HW10.register: the mount of "${name}" must be a function`);
      H.figures[name] = mount;
   };

   // Mounts every figure[data-fig] under root that has a registered mount. A mount that throws marks its own figure with
   // data-error (the caption stays) and the others still mount.
   H.mountAll = (root = document) => {
      for (const figure of root.querySelectorAll('figure[data-fig]')) {
         const mount = H.figures[figure.dataset.fig];
         if (!mount) continue;
         try { mount(figure.querySelector('.fig-stage'), figure); }
         catch (e) {
            figure.dataset.error = (e && e.message) || String(e);
            if (typeof console !== 'undefined') console.warn(`HW10: figure "${figure.dataset.fig}" failed:`, e);
         }
      }
   };

   // Creates an SVG element with the given attributes (null and undefined are skipped), appended to parent when it is given.
   H.svg = (tag, attrs, parent) => {
      const el = document.createElementNS(SVG_NS, tag);
      for (const k in attrs || {}) if (attrs[k] != null) el.setAttribute(k, attrs[k]);
      if (parent) parent.appendChild(el);
      return el;
   };

   // Records a figure's state as a data attribute (CSS and tests read it).
   H.setState = (figure, key, value) => { figure.dataset[key] = String(value); };

   // 'hh:mm' to minutes since midnight: '14:05' is 845.
   H.time = hhmm => {
      const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
      if (!m || +m[1] > 23 || +m[2] > 59) throw new RangeError(`HW10.time: not a time of day: ${hhmm}`);
      return +m[1] * 60 + +m[2];
   };

   // What was a member attending to at time t? `attention` is a list of { from, to, on } with 'hh:mm' times (story.attention.you);
   // t is 'hh:mm' or minutes. Returns the interval with from <= t < to (half-open), or null. F5 and F7 read it.
   H.attendingAt = (attention, t) => {
      const at = typeof t === 'number' ? t : H.time(t);
      return (Array.isArray(attention) ? attention : []).find(a => H.time(a.from) <= at && at < H.time(a.to)) || null;
   };

   H.reducedMotion = () => typeof globalThis.matchMedia === 'function' && !!globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches;

   // Mount once, after every deferred script has run (DOMContentLoaded comes after them).
   if (typeof document !== 'undefined') {
      if (document.readyState === 'complete') H.mountAll();
      else document.addEventListener('DOMContentLoaded', () => H.mountAll());
   }
})();
