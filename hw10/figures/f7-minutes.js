// F7, the minutes: the cloud LLM merges the text of the board and the transcript into minutes (decisions, action items with an
// owner and a due date, open questions). Click an item and the sentences and the board version it came from open under the list.
// Switch to "What you missed" and the list keeps only the items that have at least one source I was not attending to: the shared
// record minus my own attention. That view is built on my pocket device from my own gaze, and the shared view carries no marks.
// A scripted illustration with hand-made states, not a simulation. The logic is pure and loads in Node; `document` is touched
// only inside mount.
(function () {
   const H = globalThis.HW10 = globalThis.HW10 || {};

   // ---- the logic ------------------------------------------------------------------------------------------------------
   // Was a source in view? A source is { t: 'hh:mm', on }: `on` is the member who said the line, or 'board-<region>' for a board
   // version. It was attended when one of who's attention intervals covers the time (from <= t < to) with the same target.
   // Words the member said themselves count as attended: nobody misses their own voice.
   function attended(story, who, source) {
      if (source.on === who) return true;
      const list = story && story.attention && story.attention[who];
      if (!list) return false;
      const hit = H.attendingAt(list, source.t);
      return !!hit && hit.on === source.on;
   }

   const itemOf = (story, itemId) => {
      const item = story.minutes.find(m => m.id === itemId);
      if (!item) throw new RangeError(`HW10.logic.minutes: no minutes item "${itemId}"`);
      return item;
   };

   // The dialogue lines and the board versions an item came from, in the item's order.
   function sourcesOf(story, itemId) {
      const item = itemOf(story, itemId);
      const line = id => {
         const l = story.dialogue.find(d => d.id === id);
         if (!l) throw new RangeError(`HW10.logic.minutes: no dialogue line "${id}"`);
         return l;
      };
      const version = n => {
         const v = story.board.versions.find(x => x.n === n);
         if (!v) throw new RangeError(`HW10.logic.minutes: no board version ${n}`);
         return v;
      };
      return { dialogue: item.sources.dialogue.map(line), board: item.sources.board.map(version) };
   }

   // Every source of an item as { t, on }.
   const targetsOf = (story, itemId) => {
      const s = sourcesOf(story, itemId);
      return [...s.dialogue.map(d => ({ t: d.t, on: d.by })), ...s.board.map(v => ({ t: v.t, on: 'board-' + v.region }))];
   };

   // The ids of the items that have at least one source `who` was not attending to, in the order of the minutes.
   const missed = (story, who = 'you') =>
      story.minutes.filter(m => targetsOf(story, m.id).some(src => !attended(story, who, src))).map(m => m.id);

   H.logic = H.logic || {};
   H.logic.minutes = { attended, missed, sourcesOf };

   // ---- the picture ----------------------------------------------------------------------------------------------------
   // The list is html (a button for each item, at least 16 px); the evidence card is svg and sits to the right of the list at 1280
   // (under it on a narrow screen). The card is 400 units wide with text of 21 units: it is drawn 400 px wide, so its text is 21 px
   // at 1280, and at 375 px (a stage of about 317 px) 21 * 317 / 400 = 16.6 px. Lines are wrapped by measuring the text.
   const W = 400, FONT = 21, LH = 26, PAD = 12, GAP = 8, INDENT = 10;
   const REVEAL_MS = 320;                                                         // one source after another
   const KINDS = [['decision', 'Decisions'], ['action', 'Action items'], ['open', 'Open questions']];
   const START = 'm5';                                                            // the first state: Ben's levels and lamp puzzle, with its sources

   function mount(stage, figure) {
      const story = H.story, S = H.svg;
      const nameOf = id => story.members.find(m => m.id === id).name;
      const attendingAt = hhmm => { const hit = H.attendingAt(story.attention.you, hhmm); return hit ? hit.on : null; };
      const whereText = on => on === 'laptop' ? 'at laptop' : /^board-/.test(on || '') ? 'at board' : on ? 'watching ' + nameOf(on) : 'elsewhere';

      // The card's svg is put in the page first, so that the width of a text can be measured. (If it cannot be measured, because the
      // figure is not shown, the width is a guess from the number of letters.)
      const svg = S('svg', { viewBox: `0 0 ${W} 100`, class: 'f7-svg', role: 'group',
         'aria-label': 'Where the selected minutes item came from: the sentences from the transcript and the board text it was merged from, one after the other. In the what-you-missed view, each source is marked as seen or missed.' });
      const ruler = S('text', { x: 0, y: 0, 'font-size': FONT, class: 'f7-ruler' }, svg);
      const rulerBold = S('text', { x: 0, y: 0, 'font-size': FONT, class: 'f7-ruler f7-name' }, svg);
      stage.appendChild(svg);
      const widthOf = (str, bold) => {
         const el = bold ? rulerBold : ruler;
         el.textContent = str;
         const w = el.getComputedTextLength ? el.getComputedTextLength() : 0;
         return w > 0 ? w : str.length * FONT * (bold ? 0.62 : 0.58);
      };
      // Lines that fit `max` units, broken at spaces.
      const wrap = (str, max) => {
         const out = [];
         let cur = '';
         for (const w of str.split(' ')) {
            if (cur && widthOf(cur + ' ' + w) > max) { out.push(cur); cur = w; } else cur = cur ? cur + ' ' + w : w;
         }
         if (cur) out.push(cur);
         return out;
      };
      const AVAIL = W - 2 * PAD;

      // One block per source: { head, tag, body }. `tag` is my personal mark on the head's line, used in the "missed" view only;
      // `body` is a list of { text, cls }.
      function blocksOf(item, personal) {
         const src = sourcesOf(story, item.id), blocks = [];
         const tagOf = (target, own) => {
            if (!personal) return null;
            if (own) return { text: 'I said it', miss: false };
            if (attended(story, 'you', target)) return { text: 'seen', miss: false };
            return { text: 'missed: ' + whereText(attendingAt(target.t)), miss: true };
         };
         src.dialogue.forEach(d => blocks.push({ head: `${nameOf(d.by)} ${d.t}`,
            tag: tagOf({ t: d.t, on: d.by }, d.by === 'you'),
            body: wrap(`"${d.text}"`, AVAIL - INDENT).map((text, k, all) => ({ text: k < all.length - 1 ? text + ' ' : text, cls: 'fill-ink' })) }));   // a space joins the lines, so that the text reads on in a reader or a search
         if (!src.dialogue.length) blocks.push({ head: null, body: [{ text: 'No sentence: it came from the board.', cls: 'fill-muted' }] });
         src.board.forEach(v => blocks.push({ head: `Board v${v.n} ${v.t}${v.erased ? ', erased later' : ''}`,
            tag: tagOf({ t: v.t, on: 'board-' + v.region }, false),
            body: v.lines.map(text => ({ text, cls: v.erased ? 'fill-ink f7-erased' : 'fill-ink' })) }));
         if (!src.board.length) blocks.push({ head: null, body: [{ text: 'No board text: it was only said.', cls: 'fill-muted' }] });
         return blocks;
      }
      // Rows with a y inside their block (the head, with its tag on the same line when both fit, else under it; then the body), and
      // the block's height.
      function layout(item, personal) {
         return blocksOf(item, personal).map(b => {
            const rows = [];
            let n = 0;
            const y = () => ++n * LH - 6;
            if (b.head) {
               const hy = y();
               rows.push({ text: b.head, cls: 'fill-ink f7-name', x: PAD, y: hy });
               if (b.tag) {
                  const cls = b.tag.miss ? 'fill-warn f7-name' : 'fill-muted';
                  if (widthOf(b.head, true) + widthOf(b.tag.text, b.tag.miss) + 16 <= AVAIL) rows.push({ text: b.tag.text, cls, x: W - PAD, anchor: 'end', y: hy });
                  else rows.push({ text: b.tag.text, cls, x: PAD + INDENT, y: y() });
               }
            }
            for (const r of b.body) rows.push({ ...r, x: PAD + INDENT, y: y() });
            return { rows, h: n * LH + GAP, miss: !!(b.tag && b.tag.miss), top: 0 };
         });
      }
      // Every item's rows, in both views, measured once here (the ruler goes away after), and one viewBox height for all of them, so
      // that the card does not jump when you click.
      const cache = {};
      const layoutOf = (item, personal) => cache[item.id + personal] || (cache[item.id + personal] = layout(item, personal));
      const TOP = 8;
      const HT = TOP + 2 + Math.max(...story.minutes.flatMap(m => [false, true].map(p => layoutOf(m, p).reduce((h, b) => h + b.h, 0)))) + 4;
      svg.setAttribute('viewBox', `0 0 ${W} ${HT}`);
      ruler.remove(); rulerBold.remove();

      // ---- the list, as a document ----
      const doc = document.createElement('div');
      doc.className = 'f7-doc';
      const bar = document.createElement('div');
      bar.className = 'f7-bar';
      const views = document.createElement('div');
      views.className = 'f7-views';
      views.setAttribute('role', 'group');
      views.setAttribute('aria-label', 'View');
      const mkView = (view, label) => {
         const b = document.createElement('button');
         b.type = 'button'; b.textContent = label; b.dataset.view = view; b.setAttribute('aria-pressed', 'false');
         views.appendChild(b);
         return b;
      };
      const viewBtns = { everyone: mkView('everyone', 'Everyone'), missed: mkView('missed', 'What you missed') };
      bar.appendChild(views);
      doc.appendChild(bar);
      const buttons = {}, rowsOf = {}, groups = [];
      for (const [kind, label] of KINDS) {
         const group = document.createElement('div');
         group.className = 'f7-group';
         const head = document.createElement('p');
         head.className = 'f7-head';
         head.textContent = label;
         const ul = document.createElement('ul');
         ul.className = 'f7-list';
         group.append(head, ul);
         for (const item of story.minutes.filter(m => m.kind === kind)) {
            const li = document.createElement('li');
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'f7-item';
            b.dataset.item = item.id;
            b.setAttribute('aria-pressed', 'false');
            const t = document.createElement('span');
            t.className = 'f7-text';
            t.textContent = item.text;
            b.appendChild(t);
            if (kind === 'action') {
               const meta = document.createElement('span');
               meta.className = 'f7-meta';
               meta.textContent = `${nameOf(item.owner)}, ${item.due}`;
               b.appendChild(meta);
            }
            li.appendChild(b);
            ul.appendChild(li);
            buttons[item.id] = b; rowsOf[item.id] = li;
         }
         groups.push({ group, kind });
         doc.appendChild(group);
      }

      // ---- the evidence card ----
      S('rect', { x: 2, y: 2, width: W - 4, height: HT - 4, rx: 8, class: 'f7-frame stroke-line fill-bg' }, svg);
      const sources = S('g', { class: 'sources' }, svg);

      const readout = document.createElement('p');
      readout.className = 'f7-readout sr-only';
      readout.setAttribute('aria-live', 'polite');
      stage.replaceChildren(doc, svg, readout);

      // ---- state ----
      const reduced = () => H.reducedMotion();
      let selected = START, view = 'everyone', timer = null;
      const missedIds = missed(story, 'you');

      function drawSources(item, animate) {
         clearTimeout(timer); timer = null;
         while (sources.firstChild) sources.removeChild(sources.firstChild);
         const instant = !animate || reduced();
         let y = TOP;
         const els = layoutOf(item, view === 'missed').map(b => {
            const g = S('g', { class: 'f7-block' + (instant ? ' on' : ''), transform: `translate(0 ${y})` }, sources);
            if (b.miss) S('path', { d: `M5 ${b.top + 4}V${b.h - GAP - 2}`, class: 'f7-bar-mark stroke-warn fill-none' }, g);
            for (const r of b.rows) {
               const t = S('text', { x: r.x, y: r.y, 'text-anchor': r.anchor || 'start', 'font-size': FONT, class: r.cls }, g);
               t.textContent = r.text;
            }
            y += b.h;
            return g;
         });
         if (instant) { H.setState(figure, 'reveal', 'done'); return; }
         H.setState(figure, 'reveal', 'busy');
         let i = 0;
         const step = () => {
            els[i].classList.add('on');
            i++;
            if (i < els.length) timer = setTimeout(step, REVEAL_MS);
            else { timer = null; H.setState(figure, 'reveal', 'done'); }
         };
         timer = setTimeout(step, 60);
      }

      function render(animate) {
         const item = story.minutes.find(m => m.id === selected);
         const shown = view === 'missed' ? missedIds : story.minutes.map(m => m.id);
         H.setState(figure, 'selected', selected);
         H.setState(figure, 'view', view);
         for (const id in buttons) {
            rowsOf[id].hidden = !shown.includes(id);
            buttons[id].setAttribute('aria-pressed', String(id === selected));
         }
         for (const g of groups) g.group.hidden = !story.minutes.some(m => m.kind === g.kind && shown.includes(m.id));
         for (const v in viewBtns) viewBtns[v].setAttribute('aria-pressed', String(v === view));
         drawSources(item, animate);
         const src = sourcesOf(story, item.id), n = src.dialogue.length, m = src.board.length;
         const all = targetsOf(story, item.id);
         readout.textContent = view === 'missed'
            ? `Only I see this. My pocket device builds it from my gaze. I missed ${all.filter(t => !attended(story, 'you', t) && t.on !== 'you').length} of ${all.length} sources.`
            : `The cloud writes the minutes from text. This item has ${n} sentence${n === 1 ? '' : 's'} and ${m} board version${m === 1 ? '' : 's'}.`;
      }

      for (const id in buttons) buttons[id].addEventListener('click', () => { selected = id; render(true); });
      for (const v in viewBtns) viewBtns[v].addEventListener('click', () => {
         view = v;
         if (view === 'missed' && !missedIds.includes(selected)) selected = missedIds[0];      // the panel is never blank
         render(false);
      });

      render(false);
   }

   H.register('minutes', mount);
})();
