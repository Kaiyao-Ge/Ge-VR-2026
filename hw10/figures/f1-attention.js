// F1, the attention field: a room seen through one eye. The sharpest spot (the fovea, about 2 degrees) is drawn to scale against a
// field of about 200 degrees, so it is tiny; outside it the blur grows smoothly with the distance from the gaze, along an
// exponential that levels off. Drag the gaze point (or use the arrow keys). "What the glasses see" makes everything sharp and
// outlines the things the AI found outside the clear area (about 10 degrees across).
// The logic is pure and loads in Node; `document` is touched only inside mount.
(function () {
   const H = globalThis.HW10 = globalThis.HW10 || {};

   // Radius, in the same unit as widthPx, of the sharp spot when the field spans widthPx: the field is fieldDeg wide and the
   // spot is sharpDeg wide, so the spot is widthPx * sharpDeg / fieldDeg across and half of that is its radius.
   const sharpRadius = (widthPx, fieldDeg = 200, sharpDeg = 2) => {
      if (!(widthPx > 0) || !(fieldDeg > 0) || !(sharpDeg >= 0)) throw new RangeError('sharpRadius: sizes must be positive numbers');
      return (widthPx * sharpDeg / fieldDeg) / 2;
   };

   // The ids of the objects outside the sharp spot (farther than r from the gaze), in input order.
   const marked = (objects, gaze, r) => objects.filter(o => Math.hypot(o.x - gaze.x, o.y - gaze.y) > r).map(o => o.id);

   // The blur of the eye's view, in viewBox units, at e degrees from the gaze: none in the central 2 degrees (e <= 1), then a saturating
   // exponential up to SIGMA_MAX. At 5 degrees (10 across) it is still about 1 unit, at 30 degrees about 4.4, far out near 6.
   const SIGMA_MAX = 6, TAU = 22, SHARP_E = 1;
   const blurAt = e => e <= SHARP_E ? 0 : SIGMA_MAX * (1 - Math.exp(-(e - SHARP_E) / TAU));
   // The eccentricity (degrees) where the blur reaches sigma (the inverse of blurAt; sigma below SIGMA_MAX).
   const eccAt = sigma => sigma <= 0 ? SHARP_E : SHARP_E - TAU * Math.log(1 - sigma / SIGMA_MAX);
   // The stack of copies of the room that approximates the continuous blur, sharpest (on top) first: each has a fixed blur sigma and
   // is exactly right at rDeg; between one radius and the next, two layers are cross-faded. The last one covers everything.
   const LAYERS = [0, 0.5, 1, 2, 3, 4, 5, 5.7].map(sigma => ({ sigma, rDeg: eccAt(sigma) }));

   H.logic = H.logic || {};
   H.logic.attention = { sharpRadius, marked, blurAt, eccAt, LAYERS, SIGMA_MAX, TAU };

   // ---- the picture ----------------------------------------------------------------------------------------------------
   const W = 800, ROOM = 420, HT = 490;   // viewBox; the field is 200 degrees across W. The room is the top 420; the scale is below it, on the page.
   const FONT = 26;                    // every text: 26 units: 26 * 680 / 800 = 22 px at 1280 wide, 26 * 317 / 800 = 10.3 px at 375 px wide
   const UNITS_PER_DEG = W / 200;       // 4 units per degree: the field is 200 degrees across the viewBox
   const PALE_MAX = 0.5;                // opacity of the pale overlay far from the gaze; it follows the same curve as the blur
   const START = { x: 400, y: 245 };   // the gaze starts on the laptop screen
   const STEP = 8, BIG_STEP = 40;      // keyboard steps, in SVG units

   // What the AI can find in the room: a centre, and how far the object reaches from it.
   const OBJECTS = [
      { id: 'plant', label: 'plant', x: 87, y: 285, rad: 40 },
      { id: 'window', label: 'window', x: 205, y: 135, rad: 62 },
      { id: 'clock', label: 'clock', x: 400, y: 75, rad: 24 },
      { id: 'door', label: 'door', x: 700, y: 215, rad: 62 },
      { id: 'mug', label: 'mug', x: 292, y: 275, rad: 18 },
      { id: 'laptop', label: 'laptop', x: 400, y: 245, rad: 52 },
      { id: 'phone', label: 'phone', x: 495, y: 277, rad: 16 },
      { id: 'keys', label: 'keys', x: 592, y: 281, rad: 16 },
      { id: 'bag', label: 'bag', x: 330, y: 355, rad: 30 },
   ];
   // Where each label sits: [x, y, anchor]. A label is in clear space: it touches no other label, no line of the drawing, and none of
   // the dashed outlines of the glasses view (a test measures this). The things on the desk are named above them, the bag to its side.
   const LABEL_AT = { plant: [87, 362, 'middle'], window: [205, 52, 'middle'], clock: [438, 84, 'start'], door: [700, 364, 'middle'],
      mug: [292, 236, 'middle'], laptop: [400, 172, 'middle'], phone: [506, 238, 'middle'], keys: [588, 238, 'middle'], bag: [378, 361, 'start'] };

   // The room as a line drawing (original), appended to g.
   function drawRoom(g) {
      const S = H.svg;
      const line = (d, cls = 'stroke-ink') => S('path', { d, class: `f1-line ${cls} fill-none` }, g);
      const box = (attrs) => S('rect', { ...attrs, class: 'f1-line stroke-ink fill-bg' }, g);
      S('rect', { x: 0, y: 0, width: W, height: ROOM, class: 'fill-fig' }, g);                     // wall
      S('rect', { x: 0, y: 330, width: W, height: ROOM - 330, class: 'fill-line f1-floor' }, g);    // floor
      line('M0 330H800');
      box({ x: 145, y: 80, width: 120, height: 110 });                                              // window
      line('M205 80V190M145 135H265M135 190H275');
      S('circle', { cx: 400, cy: 75, r: 24, class: 'f1-line stroke-ink fill-bg' }, g);             // clock
      line('M400 75V58M400 75L413 82');
      box({ x: 655, y: 100, width: 90, height: 230 });                                              // door
      line('M670 115H730V315H670Z');
      S('circle', { cx: 725, cy: 220, r: 4, class: 'fill-ink' }, g);
      line('M70 330L74 298H100L104 330Z');                                                          // plant
      line('M87 298C87 270 70 262 62 245M87 298C90 268 105 258 112 240M87 298V250');
      box({ x: 230, y: 288, width: 400, height: 12 });                                              // desk
      line('M245 300V372M618 300V372', 'stroke-muted');
      box({ x: 350, y: 205, width: 100, height: 70, rx: 4 });                                       // laptop
      line('M340 288H460L450 275H350Z');
      line('M365 222H435M365 236H420M365 250H430');
      box({ x: 282, y: 262, width: 20, height: 26 });                                               // mug
      line('M302 268C314 268 314 282 302 282');
      box({ x: 488, y: 266, width: 14, height: 22, rx: 2 });                                        // phone
      S('circle', { cx: 587, cy: 280, r: 6, class: 'f1-line stroke-ink fill-bg' }, g);             // keys
      line('M593 282L607 288M599 285V292');
      line('M300 372C296 345 310 335 330 335C350 335 364 345 360 372Z');                           // bag
      line('M316 340C318 328 342 328 344 340');
      for (const o of OBJECTS) {
         const [x, y, anchor] = LABEL_AT[o.id];
         S('text', { x, y, 'text-anchor': anchor, 'font-size': FONT, class: 'f1-label fill-ink' }, g).textContent = o.label;
      }
   }

   function mount(stage, figure) {
      const S = H.svg;
      const r = sharpRadius(W);                    // the sharpest 2 degrees
      const rClear = sharpRadius(W, 200, 10);      // the clear area, 10 degrees across
      let gaze = { ...START };
      let state = 'eye';

      const svg = S('svg', { viewBox: `0 0 ${W} ${HT}`, class: 'f1-svg', role: 'group',
         'aria-label': 'A small room: a desk with a laptop, mug, phone and keys, a window, a clock, a door, a plant and a bag. A small clear area marks where you look.' });
      const defs = S('defs', {}, svg);
      drawRoom(S('g', { id: 'f1-scene' }, defs));

      // The eye's view: the room, copied LAYERS.length times, each copy with its own fixed blur. A copy is masked by a radial gradient
      // centred on the gaze: opaque out to its own radius, fading to nothing by the next layer's radius, so the steps blend without a
      // ring. The bottom copy is the most blurred and covers everything. Moving the gaze only moves the gradient centres.
      const grads = [];                                    // every gradient that follows the gaze
      const ease = t => t * t * (3 - 2 * t);
      const addStop = (grad, offset, opacity) => S('stop', { class: 'f1-stop', offset: +offset.toFixed(4), 'stop-opacity': +opacity.toFixed(4) }, grad);
      const gradient = (id, radius) => { const g = S('radialGradient', { id, class: 'f1-grad', gradientUnits: 'userSpaceOnUse', cx: START.x, cy: START.y, fx: START.x, fy: START.y, r: radius }, defs); grads.push(g); return g; };
      S('use', { href: '#f1-scene', class: 'f1-base' }, svg);                // all sharp: the glasses view shows this one
      const stack = S('g', { class: 'f1-layers' }, svg);
      [...LAYERS.keys()].reverse().forEach(i => {                 // the most blurred is drawn first (at the bottom), the sharp one last (on top)
         const L = LAYERS[i];
         const last = i === LAYERS.length - 1;
         const layer = S('g', { class: 'f1-layer', 'data-sigma': L.sigma }, stack);
         let inner = layer;
         if (!last) {
            const from = L.rDeg * UNITS_PER_DEG, to = LAYERS[i + 1].rDeg * UNITS_PER_DEG;
            const g = gradient(`f1-fade-${i}`, to);
            for (let k = 0; k <= 6; k++) addStop(g, (from + (to - from) * k / 6) / to, 1 - ease(k / 6));
            g.insertBefore(S('stop', { class: 'f1-stop', offset: 0, 'stop-opacity': 1 }), g.firstChild);
            const m = S('mask', { id: `f1-mask-${i}`, class: 'f1-mask', maskUnits: 'userSpaceOnUse', x: 0, y: 0, width: W, height: HT }, defs);
            S('rect', { x: 0, y: 0, width: W, height: HT, fill: `url(#f1-fade-${i})` }, m);
            layer.setAttribute('mask', `url(#f1-mask-${i})`);
         }
         if (L.sigma > 0) {
            const f = S('filter', { id: `f1-blur-${i}`, x: '-5%', y: '-5%', width: '110%', height: '110%' }, defs);
            S('feGaussianBlur', { stdDeviation: L.sigma }, f);
            inner = S('g', { filter: `url(#f1-blur-${i})` }, layer);
         }
         S('use', { href: '#f1-scene' }, inner);
      });
      // Paleness follows the same curve as the blur: nothing at the centre, PALE_MAX far away.
      const pale = gradient('f1-pale-grad', 100 * UNITS_PER_DEG);
      for (const e of [0, 1, 3, 5, 8, 12, 18, 26, 36, 50, 70, 100]) addStop(pale, e / 100, PALE_MAX * blurAt(e) / SIGMA_MAX);
      S('rect', { class: 'f1-pale', x: 0, y: 0, width: W, height: ROOM, fill: 'url(#f1-pale-grad)' }, svg);

      // What the glasses see: an outline on each object the AI found outside the spot.
      const marks = S('g', { class: 'f1-marks' }, svg);
      const markEl = {};
      for (const o of OBJECTS) markEl[o.id] = S('circle', { class: 'f1-mark', cx: o.x, cy: o.y, r: o.rad + 6 }, marks);

      // The scale: the whole bar is the field (about 200 degrees); the tick under the gaze is the sharp spot (about 2 degrees).
      const scale = S('g', { class: 'f1-scale' }, svg);
      S('path', { d: `M10 472H${W - 10}M10 464V480M${W - 10} 464V480`, class: 'f1-line stroke-muted fill-none' }, scale);
      S('text', { x: W - 10, y: 452, 'text-anchor': 'end', 'font-size': FONT, class: 'f1-label fill-muted' }, scale).textContent = 'the whole field: about 200°';
      const tick = S('rect', { class: 'f1-tick fill-accent', y: 464, width: 2 * r, height: 16 }, scale);

      // The gaze handle: the ring of the sharpest 2 degrees and a faint dashed ring of the clear area (10 degrees across), both to
      // scale, a reticle, and a larger invisible grab area.
      const gz = S('g', { class: 'gaze', tabindex: '0', role: 'group', 'aria-label': 'Gaze point. Arrow keys move it; Home puts it back.' }, svg);
      const hit = S('circle', { class: 'f1-hit', r: 28 }, gz);
      const clear = S('circle', { class: 'f1-clear stroke-accent fill-none', r: rClear }, gz);
      const spot = S('circle', { class: 'f1-spot stroke-accent fill-none', r }, gz);
      const reticle = S('path', { class: 'f1-reticle stroke-accent fill-none', d: 'M-18 0H-9M9 0H18M0 -18V-9M0 9V18' }, gz);
      const draw = document.createElement('div');
      draw.className = 'fig-draw';
      draw.appendChild(svg);

      // the switch: two buttons in a row above the drawing; the selected one has aria-pressed="true"
      const side = document.createElement('div');
      side.className = 'fig-side';
      const bar = document.createElement('div');
      bar.className = 'f1-switch';
      bar.setAttribute('role', 'group');
      bar.setAttribute('aria-label', 'View');
      const buttons = {};
      for (const [view, label] of [['eye', 'My eye'], ['glasses', 'What the glasses see']]) {
         const b = document.createElement('button');
         b.type = 'button'; b.dataset.view = view; b.textContent = label; b.setAttribute('aria-pressed', 'false');
         b.addEventListener('click', () => setView(view));
         buttons[view] = b; bar.appendChild(b);
      }
      const note = document.createElement('p');
      note.className = 'f1-note';
      note.setAttribute('aria-live', 'polite');
      side.append(bar);
      stage.append(side, draw, note);

      function render() {
         const x = gaze.x, y = gaze.y;
         for (const g of grads) { g.setAttribute('cx', x); g.setAttribute('fx', x); g.setAttribute('cy', y); g.setAttribute('fy', y); }
         for (const el of [hit, spot, clear]) { el.setAttribute('cx', x); el.setAttribute('cy', y); }
         reticle.setAttribute('transform', `translate(${x} ${y})`);
         tick.setAttribute('x', x - r);
         gz.dataset.gazeX = String(x); gz.dataset.gazeY = String(y);
         H.setState(figure, 'gazeX', x); H.setState(figure, 'gazeY', y);
         // (in the glasses view CSS hides the blurred layers and the pale overlay, so the whole room is sharp)
         // an object is outside your gaze when the clear area (10 degrees across) does not touch it
         const outside = new Set(OBJECTS.flatMap(o => marked([o], gaze, rClear + o.rad)));
         for (const o of OBJECTS) markEl[o.id].classList.toggle('found', state === 'glasses' && outside.has(o.id));
         note.textContent = state === 'glasses'
            ? `The AI finds ${outside.size} of ${OBJECTS.length} things outside your clear area.`
            : '';   // the eye view speaks for itself
      }

      function setView(next) {
         state = next;
         H.setState(figure, 'state', state);
         for (const v in buttons) buttons[v].setAttribute('aria-pressed', String(v === state));
         render();
      }

      const round = v => Math.round(v * 10) / 10;
      function moveTo(x, y) {
         gaze = { x: round(Math.min(W - r, Math.max(r, x))), y: round(Math.min(ROOM - r, Math.max(r, y))) };
         render();
      }

      // pointer drag, in SVG units (the picture scales with the page)
      const toSvg = e => {
         const m = svg.getScreenCTM();
         if (!m) return gaze;
         const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
         return { x: p.x, y: p.y };
      };
      let dragging = false;
      gz.addEventListener('pointerdown', e => {
         dragging = true; gz.setPointerCapture(e.pointerId); gz.focus({ preventScroll: true }); e.preventDefault();
         const p = toSvg(e); moveTo(p.x, p.y);
      });
      gz.addEventListener('pointermove', e => { if (dragging) { const p = toSvg(e); moveTo(p.x, p.y); } });
      const stop = () => { dragging = false; };
      gz.addEventListener('pointerup', stop); gz.addEventListener('pointercancel', stop);
      // a tap elsewhere in the picture also puts the gaze there (easier on a phone than a precise drag)
      svg.addEventListener('pointerdown', e => {
         if (gz.contains(e.target)) return;
         const p = toSvg(e); moveTo(p.x, p.y); gz.focus({ preventScroll: true });
      });

      gz.addEventListener('keydown', e => {
         const k = e.shiftKey ? BIG_STEP : STEP;
         const d = { ArrowLeft: [-k, 0], ArrowRight: [k, 0], ArrowUp: [0, -k], ArrowDown: [0, k] }[e.key];
         if (d) { e.preventDefault(); moveTo(gaze.x + d[0], gaze.y + d[1]); }
         else if (e.key === 'Home') { e.preventDefault(); moveTo(START.x, START.y); }
      });

      setView('eye');
   }

   H.register('attention', mount);
})();
