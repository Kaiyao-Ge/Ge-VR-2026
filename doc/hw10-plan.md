# HW10 "AI attends where you don't" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An illustrated essay page (English, 2,000–2,500 words) with nine small interactive SVG figures, presenting the author's
vision of a future mixed reality workspace: the AI attends where you don't, walked through one afternoon of a project group.

**Architecture:** One static page, `hw10/index.html`, with `hw10/style.css`. Every figure is one classic script in
`hw10/figures/` that keeps its pure logic in `HW10.logic.<name>` (tested in Node) and its drawing in a `mount` function
(tested in a headless browser). A shared `common.js` mounts each `<figure data-fig>`; one figure that throws breaks nothing else.
The shared scenario content (members, board, dialogue, attention, minutes) lives in one data file, `story.js`.

**Tech Stack:** HTML, CSS, plain JavaScript (classic scripts, no modules), inline SVG. Tests: Node 18 (`vm`) and Playwright
(Chromium) from `~/.cache/doorways-pw`.

**Spec:** `doc/hw10-design.md` (read it whole before any task; the figure table in its section 7 is the source for every figure).

## Global Constraints

- Plain HTML, CSS and plain JavaScript; figures in inline SVG; no framework, no build step, no network requests or external
  files (system fonts); the page opens by double-click (`file://`) and from the class server alike.
- Classic `<script src defer>` files, not ES modules. A figure file touches `document` only inside `mount` and the
  `DOMContentLoaded` hook, so Node can load it.
- English, plain words, short sentences; 2,000–2,500 words.
- Laptop browsers first (Chrome, Safari); readable at 375 px wide; light and dark themes; motion respects `prefers-reduced-motion`.
- Figure colours come only from CSS custom properties through classes in `style.css`: `--bg`, `--ink`, `--muted`, `--line`,
  `--accent`, `--warn`, `--danger`, `--fig-bg`. No literal colour in a figure's markup (`fill`/`stroke`/`style` attributes may be
  `none`, `currentColor` or `url(#…)` only).
- All drawings original; nothing copied from the book; no chapter or page of the book is named.
- Nobody else's screen is read, shown or mentioned anywhere.
- Every figure is a scripted illustration with hand-made states, never a simulation. Its `<figcaption>` says what it shows, and
  its first state already shows the point.
- Work on the branch `hw10`, made from `hw9` by the controller before Task 1. Subagents do not commit or run state-changing
  git; the controller snapshots each task. The author commits.

## Review Focus

1. A phone-width reader (375 px): SVG text scaled down below legibility → every figure's SVG text renders ≥ 10 px tall at 375 px
   (generic check, Task 1, run for each figure).
2. A keyboard-only reader: a drag-only control is unreachable → every figure has a focusable control and a key changes its
   `data-state` (generic focusable check in Task 1; a key test in each figure task).
3. Dark mode: a hard-coded stroke disappears on a dark background → no literal colours in figure markup (generic check, Task 1).
4. `prefers-reduced-motion`: an animated cue the reader must wait for → with reduced motion, F2 and F5 jump to their end state
   (Tasks 4 and 6).
5. Clicking again mid-animation (ask "keys" during the USB cue; change an event kind or item while one is shown) → the figure
   ends in the state of the last click, never stuck between two (Tasks 4, 7, 8).

## File Structure

| File | Responsibility |
|---|---|
| `hw10/index.html` | the essay: sections, prose, figure containers with captions, notes, script tags |
| `hw10/style.css` | layout, typography, the colour tokens for light and dark, figure classes, reduced motion |
| `hw10/figures/common.js` | `HW10` namespace, `register`, `mountAll`, `svg`, `setState`, `time`, `reducedMotion` |
| `hw10/figures/story.js` | `HW10.story`: the afternoon's members, seats, board versions, dialogue, attention, minutes |
| `hw10/figures/f1-attention.js` … `f9-glasses.js` | one figure each: `HW10.logic.<name>` and its `mount` |
| `tests/hw10.test.cjs` | Node: every file loads without a DOM; each figure's logic |
| `tests/hw10-browser.test.cjs` | Chromium on `file://`: structure, generic figure checks, each figure's interaction |

**Ids and names (fixed).** Sections in this order: `#top` (h1 "AI attends where you don't", the thesis paragraph, the strip
`nav#afternoon` with five links to `#scene-1` … `#scene-5`), `#complement`, `#device`, `#story` (with `#scene-1`, `#scene-2`,
`#joining`, `#scene-3`, `#scene-4`, `#scene-5`), `#boundaries`, `#closing`, `#notes`. Figures, each
`<figure class="fig" id="fN" data-fig="name"><div class="fig-stage"></div><figcaption>…</figcaption></figure>`:
f1 `attention` (in `#complement`), f8 `tiers` and f9 `glasses` (in `#device`), f2 `desk` (`#scene-1`), f3 `street`
(`#scene-2`), f6 `bus` (`#joining`), f4 `board` (`#scene-3`), f5 `table` (`#scene-4`), f7 `minutes` (`#scene-5`).

**Commands.**
- Node: `source ~/.nvm/nvm.sh && nvm use 18 && node tests/hw10.test.cjs` → prints `N hw10 checks passed.` and exits 0.
- Browser (safety: `free -m` shows ≥ 3000 MB available first; one browser; afterwards `pgrep -af chrom` shows nothing; kill
  exact PIDs only, never `pkill -f`; no server is needed, the test opens `file://`):
  `P=~/.cache/doorways-pw; LD_LIBRARY_PATH=$(find $P/libs -type d | tr '\n' ':') NODE_PATH=$P/pw/node_modules timeout 300 node tests/hw10-browser.test.cjs`
  → prints `N hw10 browser checks passed.` and exits 0. Launch Chromium as `tests/rails-browser.test.cjs` does
  (`headless: true, args: ['--no-sandbox']`).

---

### Task 1: The page skeleton, the shared helpers and both test harnesses

**Files:**
- Create: `hw10/index.html`, `hw10/style.css`, `hw10/figures/common.js`, `tests/hw10.test.cjs`, `tests/hw10-browser.test.cjs`

**Interfaces:**
- Produces (`common.js`, on `window.HW10`, which is `globalThis` in Node):
  - `HW10.logic = {}`, `HW10.figures = {}`, `HW10.story = null`
  - `HW10.register(name: string, mount: (stage: HTMLElement, figure: HTMLElement) => void)`
  - `HW10.mountAll(root = document)`: for each `figure[data-fig]` under `root` with a registered mount, calls it; a throw sets
    `figure.dataset.error` to the message and leaves the caption; runs once on `DOMContentLoaded`.
  - `HW10.svg(tag: string, attrs: object, parent?: Element) -> SVGElement`
  - `HW10.setState(figure: HTMLElement, key: string, value: string|number)`: sets `figure.dataset[key]`.
  - `HW10.time(hhmm: string) -> number` (minutes since midnight; `'14:05'` → 845)
  - `HW10.reducedMotion() -> boolean` (`matchMedia('(prefers-reduced-motion: reduce)')`, false without `matchMedia`)
- Produces (tests): in `tests/hw10.test.cjs`, `loadAll() -> HW10` runs `common.js`, `story.js` and every `f*.js` that exists in
  one `vm` context with no `document`; in `tests/hw10-browser.test.cjs`, `figureChecks(page, id)` asserts for one figure: it
  has an `svg` in `.fig-stage`, no `data-error`, at least one focusable control (`button`, `input`, or `[tabindex="0"]`), no
  literal colour in its markup, and, at a 375 px viewport, every SVG `text` is ≥ 10 px tall. Later tasks call it.

- [ ] **Step 1: Write the failing tests**
  Node: `common.js loads with no document`; `HW10.time('14:05') === 845` and `HW10.time('00:00') === 0`; `HW10.reducedMotion()`
  is false with no `matchMedia`.
  Browser (1280 × 800 unless said): `the page opens from file:// with no console error, no page error, and only file:// requests`;
  `sections are present in the fixed order` (the ids above); `nine figures, each with a non-empty figcaption`;
  `the strip has five links to #scene-1…#scene-5, and clicking the third scrolls #scene-3 into view`;
  `dark mode changes the body background` (`emulateMedia({ colorScheme: 'dark' })` vs light);
  `no horizontal scroll at 375 px` (`scrollingElement.scrollWidth <= 375`);
  `a figure whose mount throws gets data-error and its neighbour still mounts` (in `page.evaluate`: build two figures in a
  detached root, register `boom` throwing and `ok` drawing an `svg`, call `HW10.mountAll(root)`).
- [ ] **Step 2: Run both; they fail** (no files yet).
- [ ] **Step 3: Write the skeleton.** Headings as in the spec's section 7 order (h1 above; h2s "Where you look, you need no
  help", "Senses on the head, thinking elsewhere", "One afternoon", "Boundaries", "Closing", "Notes"), one placeholder sentence
  per section, the nine figure containers with a one-line placeholder caption, the strip, the script tags (`common.js`,
  `story.js`, then `f1`–`f9` in number order, all `defer`; a missing file must not break the page). `style.css`: a readable
  column (~42em), the colour tokens for light and `prefers-color-scheme: dark`, `.fig` blocks that may be wider than the text
  column on a laptop, reduced motion turns transitions off.
- [ ] **Step 4: Run both; they pass.**
- [ ] **Step 5: Report** (the controller snapshots).

### Task 2: The prose, the captions, the notes and the story data

**Files:**
- Modify: `hw10/index.html` (all text)
- Create: `hw10/figures/story.js`
- Test: `tests/hw10.test.cjs`, `tests/hw10-browser.test.cjs`

**Interfaces:**
- Produces `HW10.story` (the content is the writer's, within the spec's scenario; the shape is fixed):
  ```
  { members: [{ id, name }],                       // 5; the first is { id: 'you', name: 'You' }
    seats: { [memberId]: [x, y] },                 // around the table, in metres, for F5
    board: { regions: ['left', 'right'],
             versions: [{ n, t: 'HH:MM', region, lines: [string], erased: bool }] },   // n = 1, 2, …
    dialogue: [{ id, t: 'HH:MM', by: memberId, text, mentionsYou: bool }],
    attention: { you: [{ from: 'HH:MM', to: 'HH:MM', on }] },  // on: a member id, 'board-left', 'board-right' or 'laptop'
    minutes: [{ id, kind: 'decision'|'action'|'open', text, owner?, due?,
                sources: { dialogue: [dialogueId], board: [versionN] } }] }
  ```
  Consumed by Tasks 6 (F4, F5), 7 (F6, names only) and 8 (F7).

- [ ] **Step 1: Write the failing tests**
  Node `story: shape`: 5 members, the first `you`; ≥ 4 board versions over both regions, at least one `erased: true`; ≥ 12
  dialogue lines in time order, ids unique, every `by` a member; at least one line with `mentionsYou: true` said while
  `attention.you` is on `'laptop'`; `attention.you` intervals in order, not overlapping, covering the first to the last line;
  ≥ 6 minutes items with ≥ 2 `decision`, ≥ 2 `action` (each with `owner` a member and `due`), ≥ 1 `open`; every source resolves.
  Browser `word count is 2,000–2,500`: words of `#top, #complement, #device, #story, #boundaries, #closing` text in `p, li, h1,
  h2, h3`, not counting anything inside `figure` or `#notes`. Browser `every figcaption has at least 12 words`.
  Browser `#notes lists the sources`: it contains "Simons", "Chabris", "1999", "Strasburger", "2011", "The Way Things Work",
  "1967", "archive.org/details/waythingswork0000vari_j3y5".
- [ ] **Step 2: Run them; they fail.**
- [ ] **Step 3: Write the text and `story.js`.** Every idea of the spec's sections 2–4 appears in its place (section 7's order);
  the five scenes are told as the spec's section 3 tells them ("what you are looking at, what the AI is looking at"); the group
  plans its final project for this VR course; numbers only those in the spec (the tier latencies are called design targets; the
  HW9 numbers are the log's); future abilities are stated as assumptions ("we assume glasses that…"); the book is named as in
  the notes, never a chapter or page. Notes, exactly these sources (plus one line saying the HW9 numbers come from the author's
  headset log of 2026-11-17):
  - Simons, D. J., & Chabris, C. F. (1999). Gorillas in our midst: Sustained inattentional blindness for dynamic events.
    *Perception*, 28(9), 1059–1074.
  - Strasburger, H., Rentschler, I., & Jüttner, M. (2011). Peripheral vision and pattern recognition: A review. *Journal of
    Vision*, 11(5):13.
  - *The Way Things Work* (1967). New York: Simon and Schuster. https://archive.org/details/waythingswork0000vari_j3y5/
  Captions: one to three sentences each, from the spec's figure table ("the reader learns" in plain words).
- [ ] **Step 4: Run them; they pass.**
- [ ] **Step 5: Report.**

### Task 3: F1, the attention field

**Files:** Create `hw10/figures/f1-attention.js`. Test: both test files.

**Interfaces:** Produces `HW10.logic.attention = { sharpRadius(widthPx, fieldDeg = 200, sharpDeg = 2) -> number,
marked(objects: [{ id, x, y }], gaze: { x, y }, r: number) -> [id] }` (`marked` = the objects outside the sharp spot, in input
order). The figure's `data-state` is `'eye'` or `'glasses'`; the gaze handle is `.gaze` (`tabindex="0"`); `data-gaze-x` and
`data-gaze-y` hold its position in SVG units.

- [ ] **Step 1: Failing tests.** Node: `sharpRadius(800) === 4` (2° of 200° across 800 px, half of it a radius);
  `sharpRadius(800, 100, 2) === 8`; `marked` leaves out an object at distance r − 1 and keeps one at r + 1. Browser:
  `figureChecks(page, 'f1')`; first state `'eye'`; the toggle button sets `'glasses'` and shows ≥ 1 `.found`; focusing `.gaze`
  and pressing ArrowRight increases `data-gaze-x`; dragging `.gaze` moves it.
- [ ] **Step 2: Run; they fail.**
- [ ] **Step 3: Implement.** The field spans 200° across the figure's width, so the sharp spot is drawn to scale (that is the
  point); outside it, in `'eye'`, the scene is blurred and pale (an SVG filter); in `'glasses'` everything is sharp and the
  objects `marked` returns get a `.found` outline.
- [ ] **Step 4: Run; they pass.**
- [ ] **Step 5: Report.**

### Task 4: F2, the desk

**Files:** Create `hw10/figures/f2-desk.js`. Test: both test files.

**Interfaces:** Produces `HW10.logic.desk = { lastSighting(log: [{ t, object, x, y, by: 'camera'|'gaze' }], object) -> entry|null,
cueSide(headingDeg, bearingDeg) -> 'left'|'right'|'ahead', DATA: { objects, log } }` (`lastSighting`: the latest entry for
that object; `cueSide`: `'ahead'` when the signed difference is within ±15°, the difference taken around 360°). Buttons
`[data-ask="usb"]` and `[data-ask="keys"]`; `data-state` goes `'idle'` → `'cue-usb'` → `'found-usb'` (or the keys).

- [ ] **Step 1: Failing tests.** Node: `lastSighting` picks the latest of three entries and returns null for an unknown object;
  in `DATA`, the USB drive's last sighting is `by: 'camera'` and no `'gaze'` entry for it exists (you never looked at it);
  `cueSide(350, 10) === 'right'`, `cueSide(10, 350) === 'left'`, `cueSide(0, 14) === 'ahead'`. Browser: `figureChecks(page,
  'f2')`; clicking `usb` reaches `'found-usb'` within 3 s via `'cue-usb'`; with `emulateMedia({ reducedMotion: 'reduce' })`
  it is `'found-usb'` at once; clicking `keys` during the USB cue ends in `'found-keys'`; Enter on the focused `keys` button works.
- [ ] **Step 2: Run; they fail.**
- [ ] **Step 3: Implement.** A messy desk from above, last night's gaze trail (never on the USB drive), the camera's wide view as
  a faint wedge; the cue is a glow at the edge of a small "your view" frame on the side `cueSide` gives, then the highlight.
- [ ] **Step 4: Run; they pass.**
- [ ] **Step 5: Report.**

### Task 5: F3, the street

**Files:** Create `hw10/figures/f3-street.js`. Test: both test files.

**Interfaces:** Produces `HW10.logic.street = { HUMAN_HALF: 100, CAMERA_HALF: 150, LEVELS: ['none', 'edge glow',
'directional sound', 'text', 'haptic tap', 'forced overlay'], inField(observer: { x, y, headingDeg }, halfDeg, p: { x, y }) ->
bool, ttc(distM, closingMps) -> seconds (Infinity when closing ≤ 0), ladder(ttcS, seenByYou) -> 0..5 }`. `ladder`: 0 when
`seenByYou` (you can see it, so the AI keeps quiet) or `ttcS > 8`; else 1 for ≤ 8, 2 for ≤ 5, 3 for ≤ 3.5, 4 for ≤ 2.5,
5 for ≤ 1.5. The slider is `input.bike-pos` (0–100); the figure sets `data-level` (0–5) and `data-link` (`'up'`/`'down'`,
button `[data-toggle="link"]`); the shown level name is `.level-name`.

- [ ] **Step 1: Failing tests.** Node: `ladder(9, false) === 0`, `ladder(8, false) === 1`, `ladder(5, false) === 2`,
  `ladder(3.5, false) === 3`, `ladder(2.5, false) === 4`, `ladder(1.5, false) === 5`, `ladder(1, true) === 0`; `ttc(10, 5) === 2`,
  `ttc(10, 0) === Infinity`; `inField` true at 99° and false at 101° off the heading with `HUMAN_HALF`, true at 130° with
  `CAMERA_HALF`. Browser: `figureChecks(page, 'f3')`; slider at 0 → `data-level` 0; at 100 → 5 and `.level-name` reads
  "forced overlay"; toggling the link → `data-link` `'down'` and the same slider value gives the same level; ArrowRight on the
  focused slider raises the level from some position below 100.
- [ ] **Step 2: Run; they fail.**
- [ ] **Step 3: Implement.** A street from above: you, head down at the phone; your field (`HUMAN_HALF`) and the cameras'
  (`CAMERA_HALF`) as two wedges; the cyclist comes from behind on your side along a fixed path, an anonymous shape; the route a
  thin line ahead on the ground. The level comes from `ttc` along the path and `inField` with `HUMAN_HALF`. "Link down" greys
  only the route's live update and says the warning runs on the glasses and the pocket device.
- [ ] **Step 4: Run; they pass.**
- [ ] **Step 5: Report.**

### Task 6: F4, the whiteboard, and F5, the table

**Files:** Create `hw10/figures/f4-board.js`, `hw10/figures/f5-table.js`. Test: both test files.

**Interfaces:**
- Consumes `HW10.story` (Task 2).
- Produces `HW10.logic.board = { bestViewer(viewers: [{ id, angleDeg, distM, blocked }]) -> id|null, VIEWERS: { [versionN]:
  { [region]: viewers } } }` (score `cos(angle) / dist`; `blocked` or `angleDeg >= 90` never chosen; a tie goes to the nearer).
  The slider is `input.board-time` (0 … versions − 1); the figure sets `data-version` (the `n` shown) and `data-erased`
  (`'true'`/`'false'`); each region shows its reader's name in `.reader-<region>`; a list `.pdf` shows every version.
- Produces `HW10.logic.table = { transcriberOf(line) -> memberId (line.by), nameAlert(line, attendingId) -> bool }`
  (`mentionsYou` and you are not attending the speaker). Buttons `[data-play]` and `[data-step="-1"|"1"]`; the figure sets
  `data-line` (the dialogue id shown), `data-speaker`, and `data-state` `'alert'` on a line where `nameAlert` is true
  (attending from `story.attention.you` at the line's time), else `'listen'`.

- [ ] **Step 1: Failing tests.** Node: `bestViewer` picks the frontal-and-near over the near-but-oblique (0° at 2 m beats 60° at
  1.5 m), skips `blocked`, returns null when all are blocked; with `VIEWERS`, the reader of some region changes at least once
  over the versions (the relay is visible); `nameAlert` is true for a `mentionsYou` line while attending `'laptop'` and false
  while attending its speaker; `transcriberOf` is the speaker. Browser: `figureChecks` for `f4` and `f5`; f4: the slider through
  all versions shows `data-version` 1 … n, `data-erased` `'true'` at least once, `.pdf` lists n entries; f5: stepping reaches a
  line with `data-state` `'alert'`; `[data-play]` reaches it within 10 s, and at once under reduced motion; the shown speaker
  changes.
- [ ] **Step 2: Run; they fail.**
- [ ] **Step 3: Implement.** F4: the board with its two regions and the text of the version shown, an erase shown as such, the
  reader's name per region. F5: the table from above with the five seats, a sound arc from the speaker, the line under it
  transcribed by the speaker's own device; on an alert, a glow at the edge of "your view" and the line as text.
- [ ] **Step 4: Run; they pass.**
- [ ] **Step 5: Report.**

### Task 7: F6, the room bus

**Files:** Create `hw10/figures/f6-bus.js`. Test: both test files.

**Interfaces:** Produces `HW10.logic.bus = { KINDS: ['raw', 'board', 'utterance', 'attention', 'private'], route(kind, { hubDown =
false } = {}) -> [hop], cover(owners: { [region]: id }, down: id, candidates: { [region]: [id] }) -> { [region]: id } }`.
Routes: `raw` → `['glasses', 'pocket']`; `board` and `utterance` → `['glasses', 'pocket', 'room', 'cloud']`; `attention` →
`['glasses', 'pocket', 'room']`; `private` → `['glasses', 'pocket']`. With `hubDown`, a route that reaches `'room'` ends
`[…, 'pocket', 'held']` instead (kept locally, merged later). `cover`: a region whose owner is `down` goes to its first candidate
that is not `down`. Buttons `[data-kind="…"]`, `[data-fault="hub"]`, `[data-fault="device"]`; the figure sets `data-kind`,
`data-stops` (the route's last hop), `data-hub` and `data-device` (`'up'`/`'down'`).

- [ ] **Step 1: Failing tests.** Node: each route above exactly; `route('board', { hubDown: true })` is `['glasses', 'pocket',
  'held']`; `route('raw', { hubDown: true })` is unchanged; `cover({ left: 'a', right: 'b' }, 'a', { left: ['a', 'c'], right:
  ['b'] })` is `{ left: 'c', right: 'b' }`. Browser: `figureChecks(page, 'f6')`; `raw` → `data-stops` `'pocket'`; `utterance`
  → `'cloud'`; `private` → `'pocket'`; hub down then `board` → `'held'`; clicking `attention` while a `utterance` event is
  travelling ends with `data-kind` `'attention'`; the device fault reassigns a region's reader (shown).
- [ ] **Step 2: Run; they fail.**
- [ ] **Step 3: Implement.** Five member columns (glasses → pocket), the room bus, the cloud; the chosen kind travels hop by hop
  and stops where `route` ends, with the reason in one line (raw media never leaves the pocket; private scenes never reach the
  room; the cloud gets text only).
- [ ] **Step 4: Run; they pass.**
- [ ] **Step 5: Report.**

### Task 8: F7, the minutes

**Files:** Create `hw10/figures/f7-minutes.js`. Test: both test files.

**Interfaces:**
- Consumes `HW10.story`, `HW10.time`.
- Produces `HW10.logic.minutes = { attended(story, who, source: { t, on }) -> bool, missed(story, who = 'you') -> [itemId],
  sourcesOf(story, itemId) -> { dialogue: [line], board: [version] } }`. A dialogue line is attended when an interval of
  `story.attention[who]` covers its time with `on === line.by`; a board version when one covers its time with
  `on === 'board-' + region`. An item is missed when any of its sources is not attended. Buttons `[data-item="<id>"]` and
  `[data-view="everyone"|"missed"]`; the figure sets `data-selected`, `data-view`, and shows the sources in `.sources`.

- [ ] **Step 1: Failing tests.** Node, on a small hand-made story: an item whose only source was said by the member you were
  watching is not missed; one said while you were on `'laptop'` is; one with a board source written while you watched that
  region is not. On `HW10.story`: `1 <= missed().length <= minutes.length - 1`. Browser: `figureChecks(page, 'f7')`; clicking an
  item sets `data-selected` and `.sources` contains its first source's text; the `missed` view shows exactly `missed()` items;
  clicking a second item during the first's reveal ends with the second selected.
- [ ] **Step 2: Run; they fail.**
- [ ] **Step 3: Implement.** The minutes as a short document (decisions, actions with owner and due, open questions); a selected
  item opens its sentences and board version; the `missed` view keeps only your missed items, titled "What you missed".
- [ ] **Step 4: Run; they pass.**
- [ ] **Step 5: Report.**

### Task 9: F8, the three tiers, and F9, the glasses taken apart

**Files:** Create `hw10/figures/f8-tiers.js`, `hw10/figures/f9-glasses.js`. Test: both test files.

**Interfaces:**
- Produces `HW10.logic.tiers = { tierOf(waitS) -> 'glasses'|'pocket'|'cloud', TASKS: [{ id, name, waitS }], FPS: [[s, fps]] }`.
  `tierOf`: ≤ 0.05 s glasses, ≤ 0.5 s pocket, else cloud. `TASKS` (exactly): stabilise the picture 0.02, eye tracking 0.01,
  something approaching fast 0.05, OCR 0.3, find an object 0.3, speech to text 0.3, small video model 0.2, minutes 5, board to
  a clean PDF 10. `FPS` is the spec's section 7 table, 23 pairs from `[5, 82.5]` to `[445, 29.2]`. Buttons `[data-task="<id>"]`;
  the figure sets `data-selected` and `data-tier`.
- Produces `HW10.logic.glasses = { PARTS: [{ id, name, principle, adds }] }` with ids, in order: `wide-cameras`, `eye-cameras`,
  `thermal`, `depth`, `mic-array`, `bone-mic`, `speakers`. Each part is a focusable SVG group `[data-part="<id>"]`; the figure
  sets `data-selected`.

- [ ] **Step 1: Failing tests.** Node: `tierOf(0.05) === 'glasses'`, `tierOf(0.06) === 'pocket'`, `tierOf(0.5) === 'pocket'`,
  `tierOf(0.6) === 'cloud'`; the tiers of `TASKS` are glasses ×3, pocket ×4, cloud ×2; `FPS` has 23 pairs, first `[5, 82.5]`,
  last `[445, 29.2]`, the minimum 27; `PARTS` ids in order, each with a non-empty `principle` and `adds`. Browser:
  `figureChecks` for `f8` and `f9`; clicking `minutes` sets `data-tier` `'cloud'`; focusing a part and pressing Enter selects it
  and shows its principle; the chart has 23 points.
- [ ] **Step 2: Run; they fail.**
- [ ] **Step 3: Implement.** F8: three columns (glasses, pocket, cloud) with the tasks placed by `tierOf`; a selected task says
  why (how long it can wait, power, privacy); beside it a small line chart of `FPS` (axes in seconds and fps, the code's
  under-1 ms per frame noted). F9: an original line drawing of the glasses taken apart, each part leading to its principle and
  what it adds.
- [ ] **Step 4: Run; they pass.**
- [ ] **Step 5: Report.**
