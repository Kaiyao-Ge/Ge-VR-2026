// HW10 scene bar (nav#scenebar, sticky): marks the link of the scene being read with aria-current="true" (none before scene 1, none between scenes).
// A classic script. It touches `document` only inside init, and only when there is one, so Node can load it.
(function () {
   const H = globalThis.HW10 = globalThis.HW10 || {};
   H.nav = H.nav || {};

   // The index of the first rect (in page order) that holds the reading line, half-open [top, bottom), or -1.
   H.nav.pick = (rects, line) => {
      for (let i = 0; i < rects.length; i++) if (rects[i].top <= line && line < rects[i].bottom) return i;
      return -1;
   };

   H.nav.init = (doc = document) => {
      const nav = doc.getElementById('scenebar');
      if (!nav) return;
      const links = [...nav.querySelectorAll('a[href^="#scene-"]')];
      const scenes = links.map(a => doc.getElementById(a.getAttribute('href').slice(1)));
      if (scenes.some(s => !s)) return;
      let queued = false, shown = -2;
      const update = () => {
         queued = false;
         // The reading line sits a little below the bar and the title: about a third of the way down the window.
         const line = nav.getBoundingClientRect().bottom + 0.3 * (globalThis.innerHeight || 800);
         const i = H.nav.pick(scenes.map(s => s.getBoundingClientRect()), line);
         if (i === shown) return;
         shown = i;
         links.forEach((a, k) => { if (k === i) a.setAttribute('aria-current', 'true'); else a.removeAttribute('aria-current'); });
      };
      const queue = () => { if (!queued) { queued = true; globalThis.requestAnimationFrame(update); } };
      globalThis.addEventListener('scroll', queue, { passive: true });
      globalThis.addEventListener('resize', queue);
      globalThis.addEventListener('load', queue);
      update();
   };

   if (typeof document !== 'undefined') {
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => H.nav.init());
      else H.nav.init();
   }
})();
