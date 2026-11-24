// F3, the street: a warning for what is outside my view. A street from above. I walk up the footpath with my head down at the
// phone. My own field (a 200 degree wedge) is narrow next to the glasses' cameras (a 300 degree wedge with a blind gap straight
// behind). A bicycle comes from behind on my side: inside the cameras' view, outside mine. The slider (or dragging the bicycle)
// moves it along its fixed path; the time to contact picks a step of the escalation ladder, from nothing up to a forced overlay.
// The warning runs on the glasses and the pocket device. The bicycle is an anonymous object: the AI sees "a bicycle", not the rider. A scripted illustration with
// hand-made states, not a simulation.
// The logic is pure and loads in Node; `document` is touched only inside mount.
(function () {
   const H = globalThis.HW10 = globalThis.HW10 || {};

   const HUMAN_HALF = 100;      // degrees either side of where I face: about 200 degrees in all
   const CAMERA_HALF = 150;     // the glasses' cameras: about 300 degrees, with a gap straight behind
   const LEVELS = ['none', 'edge glow', 'directional sound', 'text', 'haptic tap', 'forced overlay'];

   // Is p inside the wedge of half angle halfDeg around the observer's heading? Points are in metres: x to the right, y ahead,
   // and headingDeg is clockwise from straight ahead (+y). The edge counts as inside.
   const inField = (observer, halfDeg, p) => {
      const bearing = Math.atan2(p.x - observer.x, p.y - observer.y) * 180 / Math.PI;
      let d = (bearing - observer.headingDeg) % 360;
      if (d > 180) d -= 360; else if (d < -180) d += 360;
      return Math.abs(d) <= halfDeg + 1e-9;
   };

   // Seconds until contact: distance over closing speed, never when nothing is closing.
   const ttc = (distM, closingMps) => (closingMps > 0 ? distM / closingMps : Infinity);

   // The step of the ladder: 0 when I can see it myself (the AI keeps quiet about what I am already handling) or when it is more
   // than 8 s away; then one step more at 8, 5, 3.5, 2.5 and 1.5 s.
   const ladder = (ttcS, seenByYou) => {
      if (seenByYou || !(ttcS <= 8)) return 0;
      return ttcS <= 1.5 ? 5 : ttcS <= 2.5 ? 4 : ttcS <= 3.5 ? 3 : ttcS <= 5 ? 2 : 1;
   };

   // The scene, in metres: I stand at the origin and face +y (up the page). The bicycle's path is one fixed curve, from a side
   // lane to the right and behind me to the footpath just behind my right shoulder. Position 0..100 is how far along it is.
   // Every point of it is outside my 200 degree view and inside the cameras' 300 degrees.
   const ME = { x: 0, y: 0, headingDeg: 0 };
   const CLOSING_MPS = 6;                                     // a fast bicycle (about 7.5 m/s) less my walking pace
   const P0 = { x: 45, y: -30 }, P1 = { x: 9, y: -18 }, P2 = { x: 3.5, y: -4 };
   const bikeAt = pos => {
      const t = Math.min(1, Math.max(0, pos / 100)), u = 1 - t;
      return { x: u * u * P0.x + 2 * u * t * P1.x + t * t * P2.x, y: u * u * P0.y + 2 * u * t * P1.y + t * t * P2.y };
   };
   const distAt = pos => { const b = bikeAt(pos); return Math.hypot(b.x - ME.x, b.y - ME.y); };
   const levelAt = pos => ladder(ttc(distAt(pos), CLOSING_MPS), inField(ME, HUMAN_HALF, bikeAt(pos)));

   H.logic = H.logic || {};
   H.logic.street = { HUMAN_HALF, CAMERA_HALF, LEVELS, inField, ttc, ladder, ME, CLOSING_MPS, bikeAt, distAt, levelAt };

   // ---- the picture ----------------------------------------------------------------------------------------------------
   // Every text is 24 units: at a 375 px screen the stage is about 317 px wide, 24 * 317 / 720 = 10.6 px.
   const W = 720, HT = 430, FONT = 24;
   const SC = 5.6;                                            // SVG units per metre
   const MX = 100, MY = 215;                                  // where I am in the picture
   const STREET = { w: 450, h: HT };                          // the street occupies the left part; the panel is on the right
   const FRAME = { x: 462, y: 12, w: 246, h: 140 };           // "my view"
   const LADDER_X = 480, LADDER_TOP = 214, ROW = 38;
   const START_POS = 46;                                      // the first state: a directional sound is already sounding

   const X = m => MX + SC * m, Y = m => MY - SC * m;          // metres to SVG units
   const pt = (deg, r) => [MX + r * Math.sin(deg * Math.PI / 180), MY - r * Math.cos(deg * Math.PI / 180)];
   const wedge = (half, r) => {
      const [lx, ly] = pt(-half, r), [rx, ry] = pt(half, r);
      return `M${MX} ${MY}L${lx} ${ly}A${r} ${r} 0 1 1 ${rx} ${ry}Z`;
   };
   const bikePoints = (n) => Array.from({ length: n + 1 }, (_, i) => bikeAt(100 * i / n)).map(b => `${X(b.x).toFixed(1)} ${Y(b.y).toFixed(1)}`);

   // The nearest position (0..100) on the path to a point given in SVG units.
   function nearestPos(sx, sy) {
      let best = 0, bd = Infinity;
      for (let p = 0; p <= 100; p += 0.5) {
         const b = bikeAt(p), d = Math.hypot(X(b.x) - sx, Y(b.y) - sy);
         if (d < bd) { bd = d; best = p; }
      }
      return best;
   }

   const fmtM = m => (m < 10 ? m.toFixed(1) : String(Math.round(m)));

   function mount(stage, figure) {
      const S = H.svg;
      const svg = S('svg', { viewBox: `0 0 ${W} ${HT}`, class: 'f3-svg', role: 'group',
         'aria-label': 'A street from above. I walk up a footpath with my head down at my phone. My own field of view is a wide wedge ahead of me; the glasses\' cameras see a wider wedge with a gap straight behind. A bicycle comes from behind on my right, inside the cameras\' view and outside mine. On the right, a picture of my view and a six-step ladder from none to forced overlay show how the warning escalates as the bicycle gets close.' });
      const defs = S('defs', {}, svg);
      const grad = S('linearGradient', { id: 'f3-glow-r', x1: 1, y1: 0, x2: 0, y2: 0 }, defs);
      S('stop', { offset: '0', class: 'f3-stop', 'stop-opacity': 0.9 }, grad);
      S('stop', { offset: '1', class: 'f3-stop', 'stop-opacity': 0 }, grad);
      S('rect', { x: 0, y: 0, width: STREET.w, height: STREET.h }, S('clipPath', { id: 'f3-street-clip' }, defs));
      S('rect', { x: FRAME.x, y: FRAME.y, width: FRAME.w, height: FRAME.h, rx: 8 }, S('clipPath', { id: 'f3-frame-clip' }, defs));
      const text = (parent, x, y, str, cls = 'fill-ink', anchor = 'start') => {
         const t = S('text', { x, y, 'text-anchor': anchor, 'font-size': FONT, class: cls }, parent);
         t.textContent = str;
         return t;
      };

      // ---- the street ----
      const street = S('g', { 'clip-path': 'url(#f3-street-clip)' }, svg);
      S('rect', { x: 0, y: 0, width: STREET.w, height: STREET.h, class: 'fill-fig' }, street);
      S('rect', { x: MX - 24, y: -4, width: 52, height: HT + 8, class: 'f3-line stroke-line fill-bg' }, street);            // the footpath
      S('rect', { x: MX - 44, y: -4, width: 92, height: 38, class: 'f3-line stroke-ink fill-bg' }, street);                // the room
      text(street, MX + 56, 24, 'room', 'fill-ink');
      S('path', { d: 'M' + bikePoints(24).join('L'), class: 'f3-lane stroke-line fill-none' }, street);                    // the bicycle's lane
      S('path', { d: 'M' + bikePoints(24).join('L'), class: 'f3-lane-dash stroke-muted fill-none' }, street);

      // what each of us can see: the cameras' wedge, then my own
      S('path', { d: wedge(CAMERA_HALF, 340), class: 'f3-camera fill-accent' }, street);
      S('path', { d: wedge(HUMAN_HALF, 150), class: 'f3-human fill-ink' }, street);
      S('path', { d: wedge(HUMAN_HALF, 150), class: 'f3-view-edge stroke-ink fill-none' }, street);

      // the route: a thin line on the ground ahead, never across the centre of my view
      const route = S('path', { d: `M${MX} ${MY - 20}V${MY - 120}Q${MX} 50 ${MX} 40`, class: 'f3-route stroke-accent fill-none' }, street);
      S('path', { d: `M${MX - 8} 52L${MX} 40L${MX + 8} 52`, class: 'f3-route-head stroke-accent fill-none' }, street);

      // cues around me: a directional sound toward the bicycle, and a haptic tap at the temples
      const sound = S('g', { class: 'f3-sound' }, street);
      for (const r of [34, 50, 66]) S('path', { d: `M${MX + r * Math.sin(-0.5)} ${MY - r * Math.cos(-0.5)}A${r} ${r} 0 0 1 ${MX + r * Math.sin(0.5)} ${MY - r * Math.cos(0.5)}`, class: 'f3-line stroke-accent fill-none' }, sound);
      const haptic = S('g', { class: 'f3-haptic' }, street);
      S('path', { d: `M${MX - 22} ${MY - 10}l-7 5l7 5l-7 5M${MX + 22} ${MY - 10}l7 5l-7 5l7 5`, class: 'f3-line stroke-warn fill-none' }, haptic);

      // me, from above, with my head down at the phone
      S('path', { d: `M${MX - 17} ${MY + 18}C${MX - 17} ${MY + 2} ${MX + 17} ${MY + 2} ${MX + 17} ${MY + 18}`, class: 'f3-line stroke-ink fill-bg' }, street);
      S('circle', { cx: MX, cy: MY, r: 11, class: 'f3-line stroke-ink fill-bg' }, street);
      S('rect', { x: MX - 5, y: MY - 24, width: 10, height: 14, rx: 2, class: 'f3-line stroke-ink fill-bg' }, street);       // the phone
      text(street, MX - 28, MY + 36, 'me', 'fill-ink f3-halo', 'end');

      // the bicycle: two wheels and a frame, no rider drawn; it is "a bicycle" to the AI. It points along its path (set below).
      const bike = S('g', { class: 'f3-bike', 'data-bike': '' }, street);
      S('rect', { x: -38, y: -26, width: 76, height: 52, class: 'f3-hit' }, bike);
      S('ellipse', { cx: -22, cy: 0, rx: 15, ry: 6, class: 'f3-line stroke-ink fill-bg' }, bike);
      S('ellipse', { cx: 22, cy: 0, rx: 15, ry: 6, class: 'f3-line stroke-ink fill-bg' }, bike);
      S('path', { d: 'M-22 0L22 0M10 -7L10 7', class: 'f3-line stroke-ink fill-none' }, bike);
      const bikeLabel = text(street, 0, 0, 'bicycle', 'fill-ink f3-halo');

      // legend
      const leg = S('g', { class: 'f3-legend' }, street);
      const row = (y, str) => text(leg, 196, y + 8, str);
      S('rect', { x: 160, y: 52, width: 28, height: 20, class: 'f3-human fill-ink' }, leg); S('rect', { x: 160, y: 52, width: 28, height: 20, class: 'f3-view-edge stroke-ink fill-none' }, leg);
      row(62, 'my view');
      S('rect', { x: 160, y: 84, width: 28, height: 20, class: 'f3-camera fill-accent' }, leg);
      row(94, "cameras' view");
      S('path', { d: 'M160 126H188', class: 'f3-route stroke-accent fill-none' }, leg);
      const routeText = row(126, 'route');

      // ---- the panel: my view, then the ladder ----
      S('rect', { x: FRAME.x, y: FRAME.y, width: FRAME.w, height: FRAME.h, rx: 8, class: 'f3-line stroke-ink fill-bg' }, svg);
      const inside = S('g', { 'clip-path': 'url(#f3-frame-clip)' }, svg);
      const glow = S('rect', { x: FRAME.x + FRAME.w - 56, y: FRAME.y, width: 56, height: FRAME.h, fill: 'url(#f3-glow-r)', class: 'f3-cue f3-cue-1' }, inside);
      text(svg, FRAME.x + 12, FRAME.y + 30, 'my view', 'fill-muted');
      const routeFrame = S('path', { d: `M${FRAME.x + 40} ${FRAME.y + FRAME.h - 10}Q${FRAME.x + FRAME.w / 2} ${FRAME.y + FRAME.h - 24} ${FRAME.x + FRAME.w - 60} ${FRAME.y + FRAME.h - 10}`, class: 'f3-route stroke-accent fill-none' }, svg);
      const soundFrame = S('g', { class: 'f3-cue f3-cue-2' }, svg);
      for (const k of [0, 1, 2]) S('path', { d: `M${FRAME.x + FRAME.w - 20 - k * 11} ${FRAME.y + 58}q9 12 0 24`, class: 'f3-line stroke-accent fill-none' }, soundFrame);
      const pill = S('g', { class: 'f3-cue f3-cue-3' }, svg);
      S('rect', { x: FRAME.x + 52, y: FRAME.y + 42, width: 140, height: 34, rx: 17, class: 'f3-line stroke-ink fill-bg' }, pill);
      text(pill, FRAME.x + 122, FRAME.y + 66, 'bike right', 'fill-ink', 'middle');
      const overlay = S('g', { class: 'f3-cue f3-cue-5' }, svg);
      S('rect', { x: FRAME.x + 38, y: FRAME.y + 40, width: 170, height: 60, rx: 8, class: 'f3-overlay stroke-danger fill-danger' }, overlay);
      S('path', { d: `M${FRAME.x + 56} ${FRAME.y + 70}H${FRAME.x + 100}M${FRAME.x + 86} ${FRAME.y + 58}L${FRAME.x + 100} ${FRAME.y + 70}L${FRAME.x + 86} ${FRAME.y + 82}`, class: 'f3-line stroke-bg fill-none' }, overlay);
      text(overlay, FRAME.x + 112, FRAME.y + 78, 'bicycle', 'fill-bg');

      text(svg, LADDER_X - 18, LADDER_TOP - 26, 'what the AI does', 'fill-muted');
      const rows = [];
      S('path', { d: `M${LADDER_X} ${LADDER_TOP}V${LADDER_TOP + 5 * ROW}`, class: 'f3-line stroke-line fill-none' }, svg);
      for (let level = 5; level >= 0; level--) {
         const y = LADDER_TOP + (5 - level) * ROW;
         const g = S('g', { class: level === 5 ? 'f3-step f3-top' : 'f3-step' }, svg);
         S('circle', { cx: LADDER_X, cy: y, r: 11, class: 'f3-line stroke-ink fill-bg f3-dot' }, g);
         text(g, LADDER_X + 24, y + 8, LEVELS[level], 'fill-muted f3-step-text');
         rows[level] = g;
      }
      stage.appendChild(svg);

      // ---- controls ----
      const bar = document.createElement('div');
      bar.className = 'f3-controls';
      const lab = document.createElement('label');
      lab.className = 'f3-slider';
      lab.append('Bicycle position');
      const slider = document.createElement('input');
      slider.type = 'range'; slider.min = '0'; slider.max = '100'; slider.step = '1'; slider.value = String(START_POS);
      slider.className = 'bike-pos';
      lab.appendChild(slider);
      bar.appendChild(lab);
      const readout = document.createElement('p');
      readout.className = 'f3-readout';
      readout.setAttribute('aria-live', 'polite');
      const levelName = document.createElement('strong');
      levelName.className = 'level-name';
      const detail = document.createElement('span');
      readout.append(levelName, detail);
      bar.appendChild(readout);
      stage.appendChild(bar);

      function render() {
         const pos = +slider.value;
         const b = bikeAt(pos), d = distAt(pos), tc = ttc(d, CLOSING_MPS);
         const level = levelAt(pos);
         H.setState(figure, 'level', level);
         H.setState(figure, 'pos', pos);
         // the bicycle, pointing the way it travels
         const bx = X(b.x), by = Y(b.y), ahead = bikeAt(Math.min(100, pos + 2)), back = bikeAt(Math.max(0, pos - 2));
         const ang = Math.atan2(-(ahead.y - back.y), ahead.x - back.x) * 180 / Math.PI;
         bike.setAttribute('transform', `translate(${bx.toFixed(1)} ${by.toFixed(1)}) rotate(${ang.toFixed(1)})`);
         const left = bx > 250;
         bikeLabel.setAttribute('x', (left ? bx - 38 : bx + 40).toFixed(1));
         bikeLabel.setAttribute('y', (by + 8).toFixed(1));
         bikeLabel.setAttribute('text-anchor', left ? 'end' : 'start');
         // the sound arcs point at the bicycle
         const bearing = Math.atan2(b.x - ME.x, b.y - ME.y) * 180 / Math.PI;
         sound.setAttribute('transform', `rotate(${bearing.toFixed(1)} ${MX} ${MY})`);
         sound.classList.toggle('on', level >= 2);
         haptic.classList.toggle('on', level >= 4);
         // my view, and the ladder
         for (const [el, from] of [[glow, 1], [soundFrame, 2], [pill, 3], [overlay, 5]]) el.classList.toggle('on', level >= from);
         rows.forEach((g, i) => { g.classList.toggle('lit', i === level); g.classList.toggle('below', i < level); });
         levelName.textContent = LEVELS[level];
         detail.textContent = `: ${fmtM(d)} m, ${Number.isFinite(tc) ? tc.toFixed(1) + ' s' : 'never'} to contact`;
      }

      slider.addEventListener('input', render);

      // dragging the bicycle along its path moves the slider
      let dragging = false;
      const toSvg = e => {
         const r = svg.getBoundingClientRect();
         return [(e.clientX - r.left) * W / r.width, (e.clientY - r.top) * HT / r.height];
      };
      bike.addEventListener('pointerdown', e => {
         dragging = true;
         try { bike.setPointerCapture(e.pointerId); } catch (_) { /* a synthetic pointer has no capture */ }
         e.preventDefault();
      });
      bike.addEventListener('pointermove', e => {
         if (!dragging) return;
         const [sx, sy] = toSvg(e);
         slider.value = String(Math.round(nearestPos(sx, sy)));
         render();
      });
      const stop = () => { dragging = false; };
      bike.addEventListener('pointerup', stop);
      bike.addEventListener('pointercancel', stop);

      render();
   }

   H.register('street', mount);
})();
