// F2, the desk: memory of what you did not attend to. A messy desk from above. The dashed trail is where my eyes went last night; it
// never touches the USB drive or the keys. The faint wedge is the wide camera's view, which saw both. Ask for one of them: the AI
// looks up its last sighting, a glow comes first at the edge of the small "my view" frame (on the side cueSide gives), I turn,
// and then the object is highlighted. A scripted illustration with hand-made states, not a simulation.
// The logic is pure and loads in Node; `document` is touched only inside mount.
(function () {
   const H = globalThis.HW10 = globalThis.HW10 || {};

   // A time may be minutes since midnight or 'HH:MM'.
   const minutes = t => (typeof t === 'string' ? H.time(t) : t);

   // The latest log entry for that object (a later entry wins a tie), or null when the object was never seen.
   const lastSighting = (log, object) => {
      let best = null;
      for (const e of log) if (e.object === object && (best === null || minutes(e.t) >= minutes(best.t))) best = e;
      return best;
   };

   // Which edge of the view the cue goes to: the signed difference from the heading to the bearing, taken around 360 degrees,
   // is in (-180, 180]; within 15 degrees it is straight ahead.
   const AHEAD_DEG = 15;
   const cueSide = (headingDeg, bearingDeg) => {
      let d = (bearingDeg - headingDeg) % 360;
      if (d > 180) d -= 360; else if (d <= -180) d += 360;
      return Math.abs(d) <= AHEAD_DEG ? 'ahead' : d > 0 ? 'right' : 'left';
   };

   // The desk, in SVG units. I sit at ME below the desk and face up (heading 0). A bearing is degrees clockwise from straight up.
   const ME = { x: 235, y: 392 };
   const bearing = (from, to) => Math.round(Math.atan2(to.x - from.x, from.y - to.y) * 18000 / Math.PI) / 100;

   const t = H.time;
   const DATA = {
      objects: [
         { id: 'usb', label: 'USB drive' }, { id: 'keys', label: 'keys' },
         { id: 'notebook', label: 'notebook' }, { id: 'laptop', label: 'laptop' }, { id: 'mug', label: 'mug' },
      ],
      // Last night. The camera saw the USB drive and the keys; my eyes went to the notebook, the laptop and the mug.
      log: [
         { t: t('18:05'), object: 'usb', x: 350, y: 322, by: 'camera' },     // an older sighting, by the mug
         { t: t('22:10'), object: 'notebook', x: 232, y: 246, by: 'gaze' },
         { t: t('22:16'), object: 'laptop', x: 270, y: 96, by: 'gaze' },
         { t: t('22:24'), object: 'notebook', x: 262, y: 262, by: 'gaze' },
         { t: t('22:31'), object: 'mug', x: 400, y: 300, by: 'gaze' },
         { t: t('22:36'), object: 'laptop', x: 312, y: 104, by: 'gaze' },
         { t: t('22:41'), object: 'usb', x: 130, y: 152, by: 'camera' },      // set down under the pile of books, unseen
         { t: t('22:44'), object: 'notebook', x: 205, y: 238, by: 'gaze' },
         { t: t('22:47'), object: 'keys', x: 410, y: 235, by: 'camera' },
         { t: t('22:52'), object: 'notebook', x: 240, y: 258, by: 'gaze' },
      ],
   };

   H.logic = H.logic || {};
   H.logic.desk = { lastSighting, cueSide, bearing, DATA, ME };

   // ---- the picture ----------------------------------------------------------------------------------------------------
   // Every text is 24 units: at a 375 px screen the stage is about 317 px wide, 24 * 317 / 720 = 10.6 px.
   const W = 720, HT = 430, FONT = 24;
   const CUE_MS = 1300;                          // how long the edge cue shows before the highlight
   const FRAME = { x: 490, y: 20, w: 220, h: 150 };   // the small "my view" frame
   const hhmm = m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
   const pt = (deg, r) => [ME.x + r * Math.sin(deg * Math.PI / 180), ME.y - r * Math.cos(deg * Math.PI / 180)];

   // The desk, from above, as a line drawing (original). The USB drive goes first so that the books lie over it.
   function drawDesk(g) {
      const S = H.svg;
      const line = (d, cls = 'stroke-ink') => S('path', { d, class: `f2-line ${cls} fill-none` }, g);
      const label = (x, y, text, anchor = 'middle') => S('text', { x, y, 'text-anchor': anchor, 'font-size': FONT, class: 'fill-ink' }, g).textContent = text;
      S('rect', { x: 0, y: 0, width: 470, height: HT, class: 'fill-fig' }, g);                           // floor
      S('rect', { x: 20, y: 20, width: 430, height: 330, rx: 6, class: 'f2-line stroke-ink fill-bg' }, g); // the desk
      const usb = lastSighting(DATA.log, 'usb'), keys = lastSighting(DATA.log, 'keys');
      // USB drive: a body and a metal end, mostly under the books
      S('rect', { x: usb.x - 8, y: usb.y - 8, width: 32, height: 16, rx: 3, class: 'f2-line stroke-ink fill-muted', transform: `rotate(-24 ${usb.x} ${usb.y})` }, g);
      S('rect', { x: usb.x + 22, y: usb.y - 5, width: 10, height: 10, class: 'f2-line stroke-ink fill-bg', transform: `rotate(-24 ${usb.x} ${usb.y})` }, g);
      // the pile of books
      S('rect', { x: 40, y: 92, width: 96, height: 66, rx: 2, class: 'f2-line stroke-ink fill-line', transform: 'rotate(-6 88 125)' }, g);
      S('rect', { x: 46, y: 84, width: 86, height: 62, rx: 2, class: 'f2-line stroke-ink fill-bg', transform: 'rotate(7 89 115)' }, g);
      line('M56 100L120 96M56 112L116 108M58 124L110 121');
      label(88, 72, 'books');
      label(88, 208, 'USB drive');
      // keys: a ring and two teeth
      S('circle', { cx: keys.x - 6, cy: keys.y - 6, r: 11, class: 'f2-line stroke-ink fill-none' }, g);
      line(`M${keys.x + 2} ${keys.y + 2}L${keys.x + 22} ${keys.y + 18}M${keys.x + 12} ${keys.y + 10}V${keys.y + 20}M${keys.x + 18} ${keys.y + 15}V${keys.y + 24}`);
      label(keys.x, keys.y - 30, 'keys');
      // the notebook, open, with lines of writing
      S('rect', { x: 165, y: 212, width: 140, height: 76, rx: 3, class: 'f2-line stroke-ink fill-bg', transform: 'rotate(-4 235 250)' }, g);
      line('M235 214V286M180 232H225M180 246H225M180 260H225M246 232H292M246 246H292M246 260H285');
      label(235, 318, 'notebook');
      // the laptop, open, seen from above
      S('rect', { x: 225, y: 70, width: 120, height: 62, rx: 4, class: 'f2-line stroke-ink fill-bg' }, g);
      S('rect', { x: 225, y: 50, width: 120, height: 16, rx: 3, class: 'f2-line stroke-ink fill-line' }, g);
      line('M240 86H330M240 98H330M240 110H330M240 122H330', 'stroke-muted');
      label(360, 100, 'laptop', 'start');
      // the mug
      S('circle', { cx: 400, cy: 300, r: 16, class: 'f2-line stroke-ink fill-bg' }, g);
      line('M416 296C428 296 428 308 416 308');
      label(400, 336, 'mug');
   }

   // A small picture of one thing, centred on 0,0, for the "my view" frame.
   function drawGlyph(id, g) {
      const S = H.svg;
      const cls = 'f2-line stroke-ink';
      if (id === 'notebook') {
         S('rect', { x: -34, y: -22, width: 68, height: 44, rx: 3, class: `${cls} fill-bg` }, g);
         S('path', { d: 'M0 -22V22M-24 -8H-8M-24 4H-8M8 -8H24M8 4H24', class: `${cls} fill-none` }, g);
      } else if (id === 'usb') {
         S('rect', { x: -26, y: -9, width: 42, height: 18, rx: 3, class: `${cls} fill-muted` }, g);
         S('rect', { x: 14, y: -6, width: 12, height: 12, class: `${cls} fill-bg` }, g);
         S('path', { d: 'M-40 -14L-8 -14L-8 14L-40 14Z', class: `${cls} fill-line` }, g);
      } else {
         S('circle', { cx: -8, cy: -8, r: 12, class: `${cls} fill-none` }, g);
         S('path', { d: 'M1 1L26 22M14 11V24M21 17V28', class: `${cls} fill-none` }, g);
      }
   }

   const ASKS = {
      usb: { button: "Where's my USB drive?", name: 'USB drive', is: 'is', it: 'it' },
      keys: { button: 'Where are my keys?', name: 'keys', is: 'are', it: 'them' },
   };

   function mount(stage, figure) {
      const S = H.svg;
      const svg = S('svg', { viewBox: `0 0 ${W} ${HT}`, class: 'f2-svg', role: 'group',
         'aria-label': 'A messy desk seen from above, with a notebook, a laptop, a mug, a pile of books with a USB drive under it, and keys. A dashed trail shows where my eyes went last night: never to the USB drive or the keys. A faint wedge shows what the wide camera saw. A small frame on the right, "my view", shows an edge cue and then the highlight.' });
      const defs = S('defs', {}, svg);
      const grad = (id, x1, y1, x2, y2) => {
         const g = S('linearGradient', { id, x1, y1, x2, y2 }, defs);
         S('stop', { offset: '0', class: 'f2-stop', 'stop-opacity': 0.9 }, g);
         S('stop', { offset: '1', class: 'f2-stop', 'stop-opacity': 0 }, g);
      };
      grad('f2-glow-l', 0, 0, 1, 0); grad('f2-glow-r', 1, 0, 0, 0); grad('f2-glow-t', 0, 0, 0, 1);
      S('rect', { x: 0, y: 0, width: 470, height: HT }, S('clipPath', { id: 'f2-desk-clip' }, defs));
      S('rect', { x: FRAME.x, y: FRAME.y, width: FRAME.w, height: FRAME.h, rx: 8 }, S('clipPath', { id: 'f2-frame-clip' }, defs));

      drawDesk(S('g', { class: 'f2-desk' }, svg));

      // the camera's wide view: a faint wedge, +-100 degrees, clipped to the desk's side of the picture
      const [lx, ly] = pt(-100, 560), [rx, ry] = pt(100, 560);
      S('path', { d: `M${ME.x} ${ME.y}L${lx} ${ly}A560 560 0 1 1 ${rx} ${ry}Z`, class: 'f2-camera fill-accent' }, S('g', { 'clip-path': 'url(#f2-desk-clip)' }, svg));

      // last night's gaze trail, from the log: a dashed path through every gaze entry in time order, with a dot for each
      const gaze = DATA.log.filter(e => e.by === 'gaze').sort((a, b) => a.t - b.t);
      const trail = S('g', { class: 'f2-trail' }, svg);
      S('path', { d: 'M' + gaze.map(e => `${e.x} ${e.y}`).join('L'), class: 'f2-trail-line stroke-muted fill-none' }, trail);
      for (const e of gaze) S('circle', { cx: e.x, cy: e.y, r: 5, class: 'fill-muted' }, trail);

      // me at the desk, and the narrow cone of what I am attending to; it turns when I turn
      S('circle', { cx: ME.x, cy: ME.y, r: 14, class: 'f2-line stroke-ink fill-bg' }, svg);
      S('path', { d: `M${ME.x - 34} ${ME.y + 36}C${ME.x - 34} ${ME.y + 12} ${ME.x + 34} ${ME.y + 12} ${ME.x + 34} ${ME.y + 36}`, class: 'f2-line stroke-ink fill-none' }, svg);
      S('text', { x: ME.x - 44, y: ME.y + 26, 'text-anchor': 'end', 'font-size': FONT, class: 'fill-ink' }, svg).textContent = 'me';
      const view = S('g', { class: 'f2-view' }, S('g', { 'clip-path': 'url(#f2-desk-clip)' }, svg));
      const [vlx, vly] = pt(-20, 300), [vrx, vry] = pt(20, 300);
      S('path', { d: `M${ME.x} ${ME.y}L${vlx} ${vly}A300 300 0 0 1 ${vrx} ${vry}Z`, class: 'f2-view-cone stroke-ink' }, view);

      // the highlight: a ring on the last sighting, drawn only once the object is found
      const ring = S('circle', { r: 34, class: 'f2-ring stroke-accent fill-none' }, svg);

      // the small "my view" frame, with the edge glows (cue) and what is at its centre
      S('rect', { x: FRAME.x, y: FRAME.y, width: FRAME.w, height: FRAME.h, rx: 8, class: 'f2-line stroke-ink fill-bg' }, svg);
      const inside = S('g', { 'clip-path': 'url(#f2-frame-clip)' }, svg);
      const glow = {
         left: S('rect', { x: FRAME.x, y: FRAME.y, width: 60, height: FRAME.h, fill: 'url(#f2-glow-l)', class: 'f2-glow' }, inside),
         right: S('rect', { x: FRAME.x + FRAME.w - 60, y: FRAME.y, width: 60, height: FRAME.h, fill: 'url(#f2-glow-r)', class: 'f2-glow' }, inside),
         ahead: S('rect', { x: FRAME.x, y: FRAME.y, width: FRAME.w, height: 50, fill: 'url(#f2-glow-t)', class: 'f2-glow' }, inside),
      };
      S('text', { x: FRAME.x + FRAME.w / 2, y: FRAME.y + 34, 'text-anchor': 'middle', 'font-size': FONT, class: 'fill-muted' }, svg).textContent = 'my view';
      const cx = FRAME.x + FRAME.w / 2, cy = FRAME.y + 82;
      const glyphs = {};
      for (const id of ['notebook', 'usb', 'keys']) { glyphs[id] = S('g', { transform: `translate(${cx} ${cy})`, class: 'f2-glyph' }, svg); drawGlyph(id, glyphs[id]); }
      S('circle', { cx, cy, r: 38, class: 'f2-frame-ring stroke-accent fill-none' }, svg);
      const frameLabel = S('text', { x: cx, y: FRAME.y + FRAME.h - 10, 'text-anchor': 'middle', 'font-size': FONT, class: 'fill-ink' }, svg);

      // the legend
      const leg = S('g', { class: 'f2-legend' }, svg);
      const row = (y, text) => S('text', { x: 534, y: y + 8, 'font-size': FONT, class: 'fill-ink' }, leg).textContent = text;
      S('path', { d: 'M492 222H522', class: 'f2-trail-line stroke-muted fill-none' }, leg); S('circle', { cx: 507, cy: 222, r: 5, class: 'fill-muted' }, leg);
      row(222, 'where I looked');
      S('rect', { x: 492, y: 252, width: 30, height: 20, class: 'f2-camera fill-accent' }, leg);
      row(262, "camera's view");
      S('path', { d: 'M492 302L522 292L522 312Z', class: 'f2-view-cone stroke-ink' }, leg);
      row(302, 'my view');
      const seen1 = S('text', { x: FRAME.x, y: 362, 'font-size': FONT, class: 'fill-ink f2-seen' }, svg);
      const seen2 = S('text', { x: FRAME.x, y: 394, 'font-size': FONT, class: 'fill-muted f2-seen' }, svg);
      stage.appendChild(svg);

      // controls and a live note
      const bar = document.createElement('div');
      bar.className = 'f2-controls';
      const buttons = {};
      for (const id of Object.keys(ASKS)) {
         const b = document.createElement('button');
         b.type = 'button'; b.dataset.ask = id; b.textContent = ASKS[id].button; b.setAttribute('aria-pressed', 'false');
         buttons[id] = b; bar.appendChild(b);
      }
      const note = document.createElement('p');
      note.className = 'f2-note sr-only';   // words for a screen reader; the picture shows the same
      note.setAttribute('aria-live', 'polite');
      bar.appendChild(note);
      stage.appendChild(bar);

      let state = 'idle', timer = null, heading = 0;

      function render(cue, target) {
         const asked = state === 'idle' ? null : state.split('-')[1];
         const found = state.startsWith('found');
         H.setState(figure, 'state', state);
         H.setState(figure, 'cue', cue || 'none');
         H.setState(figure, 'heading', Math.round(heading));
         for (const id of Object.keys(buttons)) buttons[id].setAttribute('aria-pressed', String(id === asked));
         for (const side of Object.keys(glow)) glow[side].classList.toggle('on', side === cue);
         view.style.transform = `rotate(${heading}deg)`;
         for (const id of Object.keys(glyphs)) glyphs[id].classList.toggle('f2-hide', id !== (found ? asked : 'notebook'));
         figure.classList.toggle('f2-found', found);
         if (found) { ring.setAttribute('cx', target.x); ring.setAttribute('cy', target.y); }
         frameLabel.textContent = found ? ASKS[asked].name : 'notebook';
         seen1.textContent = found ? `last seen ${hhmm(minutes(target.t))}` : '';
         seen2.textContent = found ? `by the ${target.by === 'camera' ? 'camera' : 'eyes'}` : '';
         if (state === 'idle') {
            note.textContent = 'The dashed trail is where I looked. It never touches the USB drive or the keys. Ask for one.';
         } else if (!found) {
            note.textContent = `The AI checks its memory of events. A glow shows at the ${cue === 'ahead' ? 'top' : cue} edge of my view.`;
         } else {
            const never = !DATA.log.some(e => e.object === asked && e.by === 'gaze');
            note.textContent = `I turn. My ${ASKS[asked].name} ${ASKS[asked].is} highlighted.` + (never ? ` I never looked at ${ASKS[asked].it}.` : '');
         }
      }

      // Asking restarts from the same place each time: my eyes are on the notebook, heading 0.
      function ask(id) {
         if (timer !== null) { clearTimeout(timer); timer = null; }
         const target = lastSighting(DATA.log, id);
         const toward = bearing(ME, target);
         heading = 0;
         const finish = () => { timer = null; state = `found-${id}`; heading = toward; render('none', target); };
         if (H.reducedMotion()) { finish(); return; }
         state = `cue-${id}`;
         render(cueSide(heading, toward), target);
         timer = setTimeout(finish, CUE_MS);
      }

      for (const id of Object.keys(buttons)) buttons[id].addEventListener('click', () => ask(id));
      render('none', null);
   }

   H.register('desk', mount);
})();
