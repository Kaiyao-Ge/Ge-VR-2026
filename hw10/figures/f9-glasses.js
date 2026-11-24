// F9, the glasses taken apart: an original line drawing, an exploded view of the glasses with seven parts drawn away from the
// frame. Hover, focus or tap a part (or press Enter on it) to see the principle behind it and what it adds to your senses.
// The principles are the kind that The Way Things Work (1967) illustrates; the drawing and the words are my own.
// A scripted illustration with hand-made states, not a simulation. The logic is pure and loads in Node; `document` is touched
// only inside mount.
(function () {
   const H = globalThis.HW10 = globalThis.HW10 || {};

   // ---- the logic ------------------------------------------------------------------------------------------------------
   // The seven parts, in the order of the page. `label` is the short name written on the drawing; `principle` is the idea that
   // makes the part work; `adds` is what it gives the wearer beyond the eye.
   const PARTS = [
      { id: 'wide-cameras', name: 'Wide cameras', label: 'wide cameras',
         principle: 'A lens bends light into a picture on a sensor.',
         adds: 'A view wider than your own. The AI keeps events. It does not keep video.' },
      { id: 'eye-cameras', name: 'Eye cameras', label: 'eye cameras',
         principle: 'Infrared lights shine on the eye. A camera reads where the pupil is.',
         adds: 'Where you look. A cue opens when you look at it. The AI knows what you attend to.' },
      { id: 'thermal', name: 'Thermal camera', label: 'thermal',
         principle: 'Warm things give off infrared light. A thermal camera shows that heat.',
         adds: 'Heat you cannot see: a soldering iron left on, a hot cup.' },
      { id: 'depth', name: 'Depth sensor', label: 'depth',
         principle: 'Echo ranging, as in sonar: send a pulse and time its echo. The delay gives the distance.',
         adds: 'How far away things are: a step, an obstacle.' },
      { id: 'mic-array', name: 'Microphone array', label: 'mic array',
         principle: 'Two microphones hear a sound at slightly different times, as two ears do. The delay tells the direction.',
         adds: 'Where a sound comes from. It hears your name from the side or from behind.' },
      { id: 'bone-mic', name: 'Bone-conduction microphone', label: 'bone mic',
         principle: 'When you speak, your skull vibrates. A pad on the bone feels mostly your own voice.',
         adds: 'It knows the voice is the wearer\'s own. Each device writes down only its own wearer.' },
      { id: 'speakers', name: 'Speakers', label: 'speakers',
         principle: 'A moving coil pushes a cone, and the cone pushes the air. Sound from two sides lets you place it.',
         adds: 'A directional sound as a cue, from the side where the thing is.' },
   ];

   H.logic = H.logic || {};
   H.logic.glasses = { PARTS };

   // ---- the picture ----------------------------------------------------------------------------------------------------
   // Every svg text is 21 units: at a 375 px screen the stage is about 317 px wide, 21 * 317 / 640 = 10.4 px.
   const W = 640, HT = 312, FONT = 21;
   const START = 'wide-cameras';                           // the first state: the wide cameras, with their principle

   function mount(stage, figure) {
      const S = H.svg;
      const svg = S('svg', { viewBox: `0 0 ${W} ${HT}`, class: 'f9-svg', role: 'group',
         'aria-label': 'The glasses taken apart: a line drawing of the frame with seven parts drawn away from it. Wide cameras and a thermal camera above, eye cameras and a depth sensor below, a microphone array and a bone-conduction microphone on the arms, a speaker at the tip of an arm. Choose a part to read the principle behind it and what it adds.' });
      const line = 'f9-line stroke-ink';
      const path = (parent, d, cls = line + ' fill-none') => S('path', { d, class: cls }, parent);
      const guide = (parent, d) => S('path', { d, class: 'f9-guide stroke-muted fill-none' }, parent);
      const text = (parent, x, y, str, anchor = 'start') => {
         const t = S('text', { x, y, 'text-anchor': anchor, 'font-size': FONT, class: 'f9-label fill-ink' }, parent);
         t.textContent = str;
         return t;
      };

      // ---- the frame: two lenses, the bridge, and the two arms drawn away from it ----
      const frame = S('g', { class: 'f9-frame' }, svg);
      for (const x of [175, 345]) {
         S('rect', { x, y: 135, width: 120, height: 65, rx: 24, class: line + ' fill-bg' }, frame);
         path(frame, `M${x + 22} ${192}Q${x + 14} 186 ${x + 14} 176`, 'f9-glint stroke-muted fill-none');       // a glint on the glass
         path(frame, `M${x + 34} ${196}Q${x + 22} 190 ${x + 22} 180`, 'f9-glint stroke-muted fill-none');
      }
      path(frame, 'M295 150Q320 134 345 150');
      path(frame, 'M297 176Q320 164 343 176');
      path(frame, 'M158 159H175M465 159H482', 'f9-guide stroke-muted fill-none');                    // where each arm belongs
      path(frame, 'M158 152H48Q24 152 24 176V190H38V178Q38 166 50 166H158Z', line + ' fill-bg');       // the left arm
      path(frame, 'M482 152H592Q616 152 616 176V190H602V178Q602 166 590 166H482Z', line + ' fill-bg'); // the right arm

      // ---- the parts: [id, label x, label y, label anchor, draw(g)] ----
      const camera = (g, cx, cy, r) => {
         S('circle', { cx, cy, r, class: line + ' fill-bg' }, g);
         S('circle', { cx, cy, r: r * 0.5, class: line + ' fill-none' }, g);
         S('circle', { cx: cx - r * 0.15, cy: cy - r * 0.15, r: 2.5, class: 'fill-ink' }, g);
      };
      const hit = (g, x, y, w, h) => S('rect', { x, y, width: w, height: h, rx: 8, class: 'f9-hit fill-none stroke-none' }, g);
      const DRAW = {
         'wide-cameras': (g) => {                                                   // two lenses above the corners of the frame
            for (const cx of [160, 480]) {
               guide(g, `M${cx} 90V135`);
               camera(g, cx, 72, 17);
               hit(g, cx - 26, 44, 52, 52);
            }
         },
         'thermal': (g) => {                                                        // a box with a lens, giving off heat
            guide(g, 'M320 92V138');
            S('rect', { x: 296, y: 54, width: 48, height: 38, rx: 8, class: line + ' fill-bg' }, g);
            S('circle', { cx: 314, cy: 73, r: 9, class: line + ' fill-none' }, g);
            path(g, 'M331 62q4 5 0 10t0 10', 'f9-heat stroke-ink fill-none');
            hit(g, 288, 46, 64, 52);
         },
         'eye-cameras': (g) => {                                                    // two small cameras with an infrared light each
            for (const cx of [200, 440]) {
               guide(g, `M${cx} 203V232`);
               S('rect', { x: cx - 22, y: 232, width: 44, height: 26, rx: 6, class: line + ' fill-bg' }, g);
               S('circle', { cx: cx - 6, cy: 245, r: 7, class: line + ' fill-none' }, g);
               S('circle', { cx: cx + 12, cy: 245, r: 3, class: 'fill-ink' }, g);
               hit(g, cx - 30, 224, 60, 42);
            }
         },
         'depth': (g) => {                                                          // a sender, a receiver, and the echo between
            guide(g, 'M320 152V230');
            S('rect', { x: 290, y: 232, width: 60, height: 26, rx: 8, class: line + ' fill-bg' }, g);
            S('circle', { cx: 305, cy: 245, r: 6, class: line + ' fill-none' }, g);
            S('circle', { cx: 335, cy: 245, r: 6, class: line + ' fill-none' }, g);
            path(g, 'M300 266q20 10 40 0', 'f9-echo stroke-ink fill-none');
            path(g, 'M294 272q26 14 52 0', 'f9-echo stroke-ink fill-none');
            hit(g, 282, 224, 76, 56);
         },
         'mic-array': (g) => {                                                      // three small pickups along the top of the left arm
            for (const cx of [38, 64, 90]) {
               guide(g, `M${cx} 122V152`);
               S('circle', { cx, cy: 114, r: 7, class: line + ' fill-bg' }, g);
               S('circle', { cx, cy: 114, r: 2.5, class: 'fill-ink' }, g);
            }
            hit(g, 24, 100, 80, 28);
         },
         'bone-mic': (g) => {                                                       // a pad that rests on the bone behind the ear
            guide(g, 'M572 122V152');
            S('rect', { x: 546, y: 98, width: 52, height: 24, rx: 10, class: line + ' fill-bg' }, g);
            path(g, 'M554 110q5 -8 10 0t10 0t10 0t10 0', 'f9-heat stroke-ink fill-none');
            hit(g, 538, 90, 68, 40);
         },
         'speakers': (g) => {                                                       // a magnet, a cone, and the sound it pushes out
            guide(g, 'M31 192V224');
            S('rect', { x: 14, y: 226, width: 22, height: 30, rx: 4, class: line + ' fill-bg' }, g);
            path(g, 'M36 232L54 220V262L36 250Z', line + ' fill-bg');
            path(g, 'M60 232q8 10 0 20', 'f9-echo stroke-ink fill-none');
            path(g, 'M68 224q12 18 0 36', 'f9-echo stroke-ink fill-none');
            hit(g, 6, 214, 78, 52);
         },
      };
      const LABEL = {                                                               // where each name is written: [x, y, anchor]
         'wide-cameras': [160, 30, 'middle'], 'thermal': [320, 30, 'middle'], 'mic-array': [10, 82, 'start'],
         'bone-mic': [630, 82, 'end'], 'eye-cameras': [200, 300, 'middle'], 'depth': [320, 300, 'middle'], 'speakers': [50, 300, 'middle'],
      };

      const groups = {};
      for (const part of PARTS) {
         const g = S('g', { class: 'f9-part', 'data-part': part.id, tabindex: '0', role: 'button', 'aria-pressed': 'false',
            'aria-label': `${part.name}: show its principle and what it adds` }, svg);
         DRAW[part.id](g);
         const [x, y, anchor] = LABEL[part.id];
         text(g, x, y, part.label, anchor);
         groups[part.id] = g;
      }

      // ---- the radio link to the pocket device: a note, not a part ----
      const note = S('g', { class: 'f9-note', 'aria-hidden': 'true' }, svg);
      path(note, 'M597 226q12 -12 24 0M591 234q18 -18 36 0M585 242q24 -24 48 0', 'f9-echo stroke-muted fill-none');
      ['radio link to', 'the pocket device'].forEach((str, i) => {
         const t = S('text', { x: 630, y: 270 + 28 * i, 'text-anchor': 'end', 'font-size': FONT, class: 'fill-muted' }, note);
         t.textContent = str;
      });

      stage.appendChild(svg);

      // ---- the panel ----
      const panel = document.createElement('div');
      panel.className = 'f9-panel';
      panel.setAttribute('aria-live', 'polite');
      stage.appendChild(panel);

      function select(id) {
         const part = PARTS.find(p => p.id === id);
         H.setState(figure, 'selected', id);
         for (const k in groups) {
            groups[k].setAttribute('aria-pressed', String(k === id));
            groups[k].classList.toggle('sel', k === id);
         }
         while (panel.firstChild) panel.removeChild(panel.firstChild);
         const add = (cls, str) => {
            const p = document.createElement('p');
            p.className = cls;
            p.textContent = str;
            panel.appendChild(p);
         };
         add('f9-name', part.name);
         add('f9-principle', part.principle);
         add('f9-adds', part.adds);
      }
      for (const part of PARTS) {
         const g = groups[part.id];
         g.addEventListener('mouseenter', () => select(part.id));
         g.addEventListener('focus', () => select(part.id));
         g.addEventListener('click', () => select(part.id));
         g.addEventListener('keydown', e => {
            if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') { e.preventDefault(); select(part.id); }
         });
      }

      select(START);
   }

   H.register('glasses', mount);
})();
