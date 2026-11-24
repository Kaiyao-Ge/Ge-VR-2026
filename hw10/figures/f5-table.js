// F5, the table: who is speaking, from where, and a cue for what I missed. The table from above with its five seats. A sound arc
// leaves the speaker's seat, and the line is written under the plan by the speaker's own device: each device transcribes only
// its wearer's voice. When the line says "you" while I look at something other than the speaker (Kaifang says "Hand tracking is your
// part, right?" at 14:14 while I look at my laptop), a glow rises at the edge of my view, on the speaker's side, with that
// sentence as a line of text. The centre of my view stays quiet (it says what I look at); the cue's text sits at the edge, never
// across the 2 degrees I am looking at. When I am looking at the speaker, the AI says nothing. Play runs the short clip around that
// line from its start (the figure opens on the cue); the step buttons walk all sixteen lines. A scripted illustration with hand-made states, not a simulation.
// The logic is pure and loads in Node; `document` is touched only inside mount.
(function () {
   const H = globalThis.HW10 = globalThis.HW10 || {};
   const story = H.story;

   // ---- the logic ------------------------------------------------------------------------------------------------------
   // Whose device writes the line down: the speaker's own, and nobody else's.
   const transcriberOf = line => line.by;

   // Does the AI cue me? Only when the line is about me and I am not looking at the speaker.
   const nameAlert = (line, attendingId) => !!line.mentionsYou && attendingId !== line.by;

   // What I look at at a time of day: 'mia' ... 'tom', 'board-left', 'laptop'; null outside the story.
   const attendingAt = hhmm => { const hit = H.attendingAt(story && story.attention && story.attention.you, hhmm); return hit ? hit.on : null; };

   H.logic = H.logic || {};
   H.logic.table = { transcriberOf, nameAlert, attendingAt, CLIP: { from: 'd10', to: 'd12' } };

   // ---- the picture ----------------------------------------------------------------------------------------------------
   // Every text is 21 units: at a 375 px screen the stage is about 317 px wide, 21 * 317 / 640 = 10.4 px.
   const W = 640, HT = 566, FONT = 21;
   const PLAN = { cx: 330, cy: 152, s: 120 };                // the table's centre, and units per metre
   const SEAT_R = 28;
   const BOX = { x: 10, y: 308, w: 620, h: 98 };             // the transcript
   const VIEW = { x: 10, y: 418, w: 620, h: 138 };           // "my view"
   const PILL_W = 240, PILL_CHARS = 20;                      // the cue's pill at the edge of my view, and its line length
   const STEP_MS = 1500, HOLD_MS = 2800;                     // Play: a line every 1.5 s, the cue held for 2.8 s
   const START = story ? story.dialogue.findIndex(l => l.id === 'd10') : 0;   // the first state is Ben's line, the start of the clip: the AI is quiet; one Next brings Kaifang's "your part" and the cue (the author's choice, for a live demo)

   const px = m => PLAN.cx + m * PLAN.s, py = m => PLAN.cy + m * PLAN.s;
   const nameOf = id => story.members.find(m => m.id === id).name;
   const deviceOf = id => id === 'you' ? 'My device' : `${nameOf(id)}'s device`;   // each device writes only its own wearer's words
   const attendText = on => on === 'laptop' ? 'my laptop' : on === 'board-left' ? 'the board' : on ? nameOf(on) : 'nothing in the room';
   const atPoint = on => on === 'board-left' ? [-2.2, 0.6] : on === 'laptop' ? [story.seats.you[0], story.seats.you[1] - 0.4] : story.seats[on];

   // Lines of at most `max` characters, broken at spaces.
   const wrap = (str, max) => {
      const out = [];
      let cur = '';
      for (const w of str.split(' ')) {
         if (cur && (cur + ' ' + w).length > max) { out.push(cur); cur = w; } else cur = cur ? cur + ' ' + w : w;
      }
      if (cur) out.push(cur);
      return out;
   };

   function mount(stage, figure) {
      const S = H.svg;
      const lines = story.dialogue;
      const svg = S('svg', { viewBox: `0 0 ${W} ${HT}`, class: 'f5-svg', role: 'group',
         'aria-label': 'The discussion table from above with five seats and the whiteboard at its left end. A sound arc leaves the speaker. Under the plan, the speaker\'s own device writes the line. At the bottom, a frame shows my view: when someone says your part while I look at my laptop, a glow appears at the edge of the frame on the speaker\'s side, with the last sentence as text.' });
      const defs = S('defs', {}, svg);
      for (const [id, x1, x2] of [['f5-glow-r', 1, 0], ['f5-glow-l', 0, 1]]) {
         const grad = S('linearGradient', { id, x1, y1: 0, x2, y2: 0 }, defs);
         S('stop', { offset: '0', class: 'f5-stop', 'stop-opacity': 0.9 }, grad);
         S('stop', { offset: '1', class: 'f5-stop', 'stop-opacity': 0 }, grad);
      }
      S('rect', { x: VIEW.x, y: VIEW.y, width: VIEW.w, height: VIEW.h, rx: 8 }, S('clipPath', { id: 'f5-view-clip' }, defs));
      const text = (parent, x, y, str, cls = 'fill-ink', anchor = 'start') => {
         const t = S('text', { x, y, 'text-anchor': anchor, 'font-size': FONT, class: cls }, parent);
         t.textContent = str;
         return t;
      };

      // ---- the room from above: the board on the left wall, the table, the five seats ----
      S('path', { d: `M${px(-2.2)} ${py(-1.2)}V${py(1.2)}`, class: 'f5-wall stroke-line fill-none' }, svg);
      text(svg, px(-2.2) + 12, py(-1.2) + 8, 'board', 'fill-muted');
      S('rect', { x: px(-1.5), y: py(-0.6), width: 3 * PLAN.s, height: 1.2 * PLAN.s, rx: 8, class: 'f5-line stroke-line fill-bg' }, svg);
      text(svg, PLAN.cx, PLAN.cy + 7, 'table', 'fill-muted', 'middle');
      const youSeat = [px(story.seats.you[0]), py(story.seats.you[1])];
      const view = S('path', { d: '', class: 'f5-view fill-ink' }, svg);
      const viewEdge = S('path', { d: '', class: 'f5-view-edge stroke-ink fill-none' }, svg);
      const sound = S('g', { class: 'f5-sound' }, svg);
      for (const r of [42, 58, 74]) S('path', { d: `M${r * Math.sin(-0.55)} ${-r * Math.cos(-0.55)}A${r} ${r} 0 0 1 ${r * Math.sin(0.55)} ${-r * Math.cos(0.55)}`, class: 'f5-line stroke-accent fill-none' }, sound);
      const seats = {};
      for (const m of story.members) {
         const [sx, sy] = [px(story.seats[m.id][0]), py(story.seats[m.id][1])];
         const g = S('g', {}, svg);
         // a seat is a pill as wide as its name (a long name such as Kaifang does not fit in a circle)
         const hx = Math.max(SEAT_R, Math.round(m.name.length * FONT * 0.3 + 14)), hy = SEAT_R;
         const dot = S('rect', { x: sx - hx, y: sy - hy, width: 2 * hx, height: 2 * hy, rx: hy, class: 'f5-line stroke-ink fill-bg' }, g);
         const label = text(g, sx, sy + 7, m.name, 'fill-ink', 'middle');
         seats[m.id] = { dot, label, sx, sy, hx, hy };
      }

      // ---- the line, written by the speaker's own device ----
      S('rect', { x: BOX.x, y: BOX.y, width: BOX.w, height: BOX.h, rx: 8, class: 'f5-line stroke-ink fill-bg' }, svg);
      const boxHead = text(svg, BOX.x + 14, BOX.y + 28, '', 'fill-muted');
      const boxTime = text(svg, BOX.x + BOX.w - 14, BOX.y + 28, '', 'fill-muted', 'end');
      const boxText = [0, 1].map(i => text(svg, BOX.x + 14, BOX.y + 58 + i * 28, '', 'fill-ink'));

      // ---- my view: what I look at, and the cue at its edge ----
      S('rect', { x: VIEW.x, y: VIEW.y, width: VIEW.w, height: VIEW.h, rx: 8, class: 'f5-line stroke-ink fill-bg' }, svg);
      const inside = S('g', { 'clip-path': 'url(#f5-view-clip)' }, svg);
      const glowR = S('rect', { x: VIEW.x + VIEW.w - 110, y: VIEW.y, width: 110, height: VIEW.h, fill: 'url(#f5-glow-r)', class: 'f5-cue' }, inside);
      const glowL = S('rect', { x: VIEW.x, y: VIEW.y, width: 110, height: VIEW.h, fill: 'url(#f5-glow-l)', class: 'f5-cue' }, inside);
      text(svg, VIEW.x + 14, VIEW.y + 28, 'my view', 'fill-muted');
      // the centre of my view always says what I look at, in two short lines, and the cue never writes there
      const lookingG = S('g', { class: 'f5-looking' }, svg);
      const looking = [0, 1].map(i => text(lookingG, VIEW.x + VIEW.w / 2, VIEW.y + 74 + i * 28, '', 'fill-muted', 'middle'));
      // the cue's text: a narrow pill at the edge on the speaker's side: the speaker's name, then the sentence in two lines at most
      const pill = S('g', { class: 'f5-cue f5-pill' }, svg);
      const pillRect = S('rect', { x: VIEW.x + VIEW.w - 12 - PILL_W, y: VIEW.y + 30, width: PILL_W, height: 96, rx: 20, class: 'f5-line stroke-accent fill-bg' }, pill);
      const pillText = [0, 1, 2].map(i => text(pill, 0, VIEW.y + 58 + i * 26, '', 'fill-ink'));
      stage.appendChild(svg);

      // ---- controls ----
      const bar = document.createElement('div');
      bar.className = 'f5-controls';
      const mkBtn = (label, attrs) => {
         const b = document.createElement('button');
         b.type = 'button'; b.textContent = label;
         for (const k in attrs) b.setAttribute(k, attrs[k]);
         bar.appendChild(b);
         return b;
      };
      const back = mkBtn('Previous line', { 'data-step': '-1' });
      const play = mkBtn('Play the clip', { 'data-play': '', 'aria-pressed': 'false' });
      const next = mkBtn('Next line', { 'data-step': '1' });
      const readout = document.createElement('p');
      readout.className = 'f5-readout sr-only';
      readout.setAttribute('aria-live', 'polite');
      bar.appendChild(readout);
      stage.appendChild(bar);

      let idx = START, timer = null, playing = false;

      function render() {
         const line = lines[idx], by = transcriberOf(line), on = attendingAt(line.t);
         const alert = nameAlert(line, on);
         H.setState(figure, 'line', line.id);
         H.setState(figure, 'speaker', by);
         H.setState(figure, 'state', alert ? 'alert' : 'listen');
         // the speaker, and the arc leaving the seat toward the middle of the table
         for (const m of story.members) {
            const s = seats[m.id], speaking = m.id === by;
            s.dot.setAttribute('class', 'f5-line stroke-ink ' + (speaking ? 'fill-accent' : 'fill-bg'));
            s.label.setAttribute('class', speaking ? 'fill-bg' : 'fill-ink');
         }
         const sp = seats[by], toMiddle = Math.atan2(PLAN.cx - sp.sx, -(PLAN.cy - sp.sy)) * 180 / Math.PI;
         // the arcs start just outside the seat's pill, in the direction they leave it
         const ux = Math.sin(toMiddle * Math.PI / 180), uy = Math.cos(toMiddle * Math.PI / 180);
         const push = Math.max(0, Math.abs(ux) * sp.hx + Math.abs(uy) * sp.hy - SEAT_R);
         sound.setAttribute('transform', `translate(${sp.sx} ${sp.sy}) rotate(${toMiddle.toFixed(1)}) translate(0 ${-push.toFixed(1)})`);
         // my view of the room: a wedge toward what I look at
         const target = on ? atPoint(on) : null;
         if (target) {
            const a = Math.atan2(target[1] - story.seats.you[1], target[0] - story.seats.you[0]);
            const R = 120, half = 0.8, [ax, ay] = [a - half, a + half];
            const pts = [[youSeat[0] + R * Math.cos(ax), youSeat[1] + R * Math.sin(ax)], [youSeat[0] + R * Math.cos(ay), youSeat[1] + R * Math.sin(ay)]];
            const d = `M${youSeat[0]} ${youSeat[1]}L${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}A${R} ${R} 0 0 1 ${pts[1][0].toFixed(1)} ${pts[1][1].toFixed(1)}Z`;
            view.setAttribute('d', d); viewEdge.setAttribute('d', d);
         } else { view.setAttribute('d', ''); viewEdge.setAttribute('d', ''); }
         // the line, as the speaker's own device writes it
         boxHead.textContent = deviceOf(by);
         boxTime.textContent = line.t;
         const wrapped = wrap(`"${line.text}"`, 52);
         boxText.forEach((t, i) => { t.textContent = wrapped[i] || ''; });
         // my view: quiet, or the cue on the speaker's side
         looking[0].textContent = 'looking at ';     // (the space keeps the two lines one phrase in a reader)
         looking[1].textContent = attendText(on);
         pill.classList.toggle('on', alert);
         let side = 'right';
         pillText.forEach(t => { t.textContent = ''; });
         if (alert) {
            const f = [target[0] - story.seats.you[0], target[1] - story.seats.you[1]];
            const s = [story.seats[by][0] - story.seats.you[0], story.seats[by][1] - story.seats.you[1]];
            side = f[0] * s[1] - f[1] * s[0] >= 0 ? 'right' : 'left';
            const said = wrap(line.text, PILL_CHARS);
            if (said.length > 2) said.splice(2, said.length, said[1].slice(0, PILL_CHARS - 3) + '...');
            const rows = [`${nameOf(by)}:`, ...said];
            // the pill sits at the edge on the speaker's side; a space ends the first line, so the sentence reads on as one
            const x = side === 'right' ? VIEW.x + VIEW.w - 12 - PILL_W : VIEW.x + 12;
            pillRect.setAttribute('x', x);
            pillText.forEach((t, i) => { t.setAttribute('x', x + 14); t.textContent = rows[i] ? rows[i] + (rows[i + 1] ? ' ' : '') : ''; });
         }
         H.setState(figure, 'cue', alert ? side : 'none');
         glowR.classList.toggle('on', alert && side === 'right');
         glowL.classList.toggle('on', alert && side === 'left');
         // words for a screen reader, and the buttons
         readout.textContent = `Line ${idx + 1} of ${lines.length}. ${by === 'you' ? 'I speak.' : nameOf(by) + ' speaks.'} I look at ${attendText(on)}. ` +
            (alert ? `A cue shows the sentence at the ${side} edge.` : 'The AI stays silent.');
         back.disabled = idx === 0;
         next.disabled = idx === lines.length - 1;
         play.textContent = playing ? 'Pause' : 'Play the clip';
         play.setAttribute('aria-pressed', String(playing));
      }

      function stop() { clearTimeout(timer); timer = null; playing = false; }
      const clipFrom = lines.findIndex(l => l.id === H.logic.table.CLIP.from), clipTo = lines.findIndex(l => l.id === H.logic.table.CLIP.to);
      const alertIdx = () => lines.findIndex(l => nameAlert(l, attendingAt(l.t)));

      function tick() {
         if (idx >= clipTo) { stop(); render(); return; }
         idx++;
         render();
         timer = setTimeout(tick, lines[idx].mentionsYou ? HOLD_MS : STEP_MS);
      }

      play.addEventListener('click', () => {
         if (playing) { stop(); render(); return; }
         if (H.reducedMotion()) { idx = alertIdx(); render(); return; }      // no clip: the cue at once
         idx = clipFrom;                                                     // Play always runs the clip from its start
         playing = true;
         render();
         timer = setTimeout(tick, STEP_MS);
      });
      for (const b of [back, next]) b.addEventListener('click', () => {
         stop();
         idx = Math.min(lines.length - 1, Math.max(0, idx + (+b.dataset.step)));
         render();
      });

      render();
   }

   H.register('table', mount);
})();
