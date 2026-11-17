# HW9 Rails v2 (one bus) Implementation Plan — revised after review

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Replace v1's rail-per-variable wiring with one bus (variables by name, overrides with `use`, one plug per card,
a bus window), and fix the four problems of the v1 headset test (mouse, unclear UI, legibility, zoom/sideways scroll).

**Architecture:** The bus gains an `auto` mode: it keeps one internal rail per variable but creates, docks and sweeps them
itself through one idempotent `_reconcile()`. v1 behaviour stays available as `auto:false` (all v1 tests, and the ghost's
private bus) until Task 4 flips the default. The IDE shows one bus line, a plug per card and an on-demand bus window
instead of lanes, pins, device cards and the lens.

**Spec:** doc/hw9-v2-design.md (v2) on top of doc/hw9-design.md (v1 + "As built"). Where this plan's "Decisions" sharpen
the spec, the plan wins (and Task 4 writes them into the spec's "As built").

## Global Constraints

- Everything in doc/hw9-plan.md's Global Constraints still holds (Node 18; browser-test command and safety rules —
  `free -m` ≥ 3000 MB available first, one browser, server started and killed inside the same command,
  http://127.0.0.1:2026, `timeout 400`, `pgrep -af "server/main.js"` / `pgrep -af chrom` empty afterwards, kill exact
  PIDs only, never `pkill -f`, tests never write the repository; ≤ 7 canvases; pure modules import siblings and
  js/render/core/cg.js only; style as js/scenes/doorways/; no commits).
- Render-cost rules: the bus is one mesh; pooled nodes, no per-frame node allocation; canvases repaint only on change
  (bus window ≤ 4 Hz live); nothing allocates per frame when nothing changed. Plates count as drawn nodes.
- Each task leaves every **Node** suite green. New behaviour is tested with `auto:true`; v1 tests keep running
  unchanged on `auto:false` until Task 4. Tests of features that a task removes are deleted with the feature, listed in
  the report. Never weaken an assertion of a feature that stays. The **browser** test may be red from Task 1 until Task 4
  for the parts that click lanes, pins, device cards or the lens.
- Comments in plain words (no task numbers, no "Ruling N"). Delete what a task makes dead, except v1 code still used by
  `auto:false` (Task 4 deletes it).

## Decisions (binding; they sharpen the spec)

- **Names.** Built-in variables: `time` (clock, state time), `gaze_hit` (state vec3), `gaze_on` (state bool),
  `pointer_pos` (state vec3), `pointer_down` (state bool). Device ids/ports stay `clock.time`, `gaze.hit|on`,
  `pointer.pos|down` (the `dev` messages are unchanged); only the rail names change. In auto mode the clock's rail id is
  `time`. A user output named like a built-in is a setup error (`gaze_hit is built in`). `MAX_VARS = 64` counts the five
  built-ins.
- **Shapes.** A variable's kind/type come from its first publisher; another output of that name must match kind and type
  exactly (`any` matches only `any`), else it is a setup error of the later module: `target is state vec3 here but event
  num in ball` (the other side named is the oldest docked module). Inputs bind with `compatible()` (an `any` input takes
  anything). A same-name variable of an incompatible shape leaves the input unbound (no error) and `bindings` shows why.
  A variable with no publisher keeps its shape while it is taken; with no docked port at all it is swept at the end of
  the structure phase (never in the middle of a swap: the same-shape port re-docks first, so value, seq and tail survive).
- **Conflicts are checked at queue time** against a projected view that includes queued ops (`_view()` gains `vars`,
  `uses`, `unplugged`; `project()` handles `reload`, `removeModule`, `renameModule`, `use`, `plug`). So `addModule`,
  `reload`/`commit`/`revert`, `use` and `plug` are refused with a reason before anything changes: a reload that would
  change the shape of a variable another card takes (`target is state vec3 (taken by ball), but event num here`), a
  65th variable (`too many variables (64)`), a built-in name. The 64 count ignores removals a queued sweep would free.
- **`use`** (live command): refused if the variable does not exist, the port is not an input, or the shapes are not
  compatible. **`uses` in a loaded layout or a restored snapshot are preferences**: an entry naming a variable that does
  not exist yet waits. A reload that drops an input with a `uses` entry drops the entry with a notice. `use`/`plug`/
  `rename`/`rm` keep `uses` keys and `unplugged` consistent (rename moves them; rm drops them; card undo restores them
  with `addModule` → `use` per key → `plug off`).
- **Plug.** Unplugged: no docks. A state output's `set()` while unplugged is published on plug-in (its latest value); an
  event `emit()` while unplugged is dropped. `use`/`plug` while paused queue like v1 docks: acked, applied on resume
  (the bus window says "applies when you resume").
- **Snapshot (auto).** The head always carries `vars` (sorted names ≤ 64), `uses` (object), `unplugged` (array);
  `geometry` cards only; `rails` entries without `lane`; `rev` changes on `use` and `plug`. The IDE drops rails not in
  `vars`. `uses` and `unplugged` are bus state: they are in `bus.snapshot()` / `restoreSnapshot` (a Worker restart keeps
  them; the bus snapshot wins over the layout, which supplies sources and slots).
- **Layout (auto).** `{cards: {id: {slot}}, uses, unplugged}`. v1 conversion on `load`: a v1 rail's variable name is the
  port name of its first publisher (the rail `clock` is `time`); an input docked to that rail gets no entry if its name
  matches, else a `use`; a rail fed by a device dock `dev:<d>.<p>` means every input docked to it (with no other
  override) gets `use DEVICE_VARS[d][p]`; a card whose outputs were all undocked becomes `unplugged`; rails/lanes ignored.
- **Recorder.** Auto-docks are ordinary `dock` ops. `recorder._noteBorn` also records the rail of every `dock` op with its
  kind/type at that moment (so a variable created, docked and swept inside the window is still known to the ghost).
  Accepted: a variable removed and re-created with another shape inside the window is not replayed exactly (doc).
- **Ghost.** The ghost's private bus and its trial bus are `new Bus({seed, auto:false})`; its own docks/undocks replay
  from the tape as today.
- **Default code zoom** stays 32 columns at 29 px (zoom index 1 of 0/1/2 = 26/32/40 columns). "30 % larger" in the spec
  means the line-font floating text, not the code.
- **Bus window inputs.** A click on a bus-window row never reaches `pointer_down` or starts a plug grab; while the window
  is open Esc belongs to it (filter → section → close), so the command line opens after the window closes. Zoom-in takes
  `=` and `+`. While paused `dx` scrubs (no sideways trackpad scroll in a card then; keys still move).
- **Rates** in the bus window are computed by the IDE (Δseq over the last second of live snapshots), blank while paused.

## Review Focus

1. `use` on a variable that does not exist yet or of another shape → refused with a reason; a layout `uses` entry for a
   missing variable waits instead.
2. A reload that changes a taken variable's shape → refused at queue time; old version and takers untouched.
3. Unplugging the only publisher → "no publisher", stale; replay and the ghost reproduce it exactly.
4. The committed v1 demo layout loads into v2 with the same bindings (and the stated conversions).
5. Dozens of variables: 59 user outputs + 5 built-ins fit; the 65th is refused; the snapshot budget defers but delivers
   all 64; the bus window scrolls and filters; the bus is one mesh.
6. A mouse-only machine: every v1 trackpad action has a mouse or keyboard path.
7. `rm` of a card whose output others take → the variable stays, no publisher, last value, stale.
8. Undo of a removed card restores its source, `uses`, plug state and dirty text; rename moves `uses` keys.
9. A user output named like a built-in → setup error.
10. Layout load order decides which of two conflicting cards fails; the failing card is left out of the next saved layout
    (doc).

---

### Task 1A: Bus auto mode — reconcile, projection, built-ins, recorder, ghost

**Files:** `js/scenes/rails/{bus.js, lifecycle.js, values.js, recorder.js, replay.js}`. Test `tests/rails.test.cjs`.
**Produces:** `new Bus({seed, auto = false})`; in auto mode: `_reconcile()` (ensure rails for plugged outputs; dock outputs
first, then inputs: `uses[key]` → same name → wait; sweep undocked rails at the end of the structure phase), called at the
end of every structure op and of `register`, `removeModule`, `swap`, `restore`, `restoreSnapshot`; `bus.use(card, port,
variable|null)`, `bus.plug(card, on)` (structure ops, queued while paused, logged as their resulting dock/undock ops);
`bus.uses`, `bus.unplugged`; `bus.builtins` (rail ids that are never swept and that `isFresh`/`layout`/`restore` treat
like v1's `clock`); `addDevice({id, outputs, vars})` creates and docks built-in rails at once; queue-time checks via the
extended `_view()`/`project()`; `bus.snapshot()`/`restoreSnapshot` carry `uses`/`unplugged`; values.js `MAX_VARS`,
`DEVICE_VARS`, `bindingKey`; recorder `_noteBorn` on dock ops; makeGhost uses `auto:false` buses. The isClock special
auto-dock is not used in auto mode (the generic rule binds `time`); the declare-time check that `input('time')` is
state/time stays.
- [ ] **Step 1: Failing tests (auto:true):** two modules bind by name; waiting input binds when the variable appears; a
  reload swap keeps value/seq/tail; sweep after the last port goes; `use`/reset; `use` refusals; `plug` off/on (state
  latest value published on plug-in; event dropped); shape conflict and built-in name refused at queue time (including
  two queued reloads in one step); the 65th variable refused; incompatible same-name input stays unbound; snapshot/restore
  keep `uses`/`unplugged`; `railsAt` equals live (on live variable ids) through use/plug/reload/rm; the ghost of an
  unchanged module stays exact after a `use`, an unplug and an event variable created/docked/swept inside the window.
  All v1 tests pass unchanged (auto:false).
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS (all Node suites).

### Task 1B: Runtime auto mode — commands, snapshot, layout v2, worker, host, demo modules

**Files:** `js/scenes/rails/{runtime.js, snapshotter.js, wire.js, worker.js, runtimeHost.js, store.js,
modules/constant.js}`; a new demo layout file used only by `auto:true` tests (`data/layout.js` itself is switched in
Task 4). Test `tests/rails.test.cjs`, `tests/rails-link.test.cjs`.
**Produces:** `new Runtime({seed, bases, auto = false})` (worker.js passes `auto` from `init`; the host passes `auto: true`
only when told to — the scene keeps v1 until Task 4); commands `use {module, port, variable: name|null}` and
`plug {module, on}` (wire.js `CMDS` gains both; `isSnap` gains `vars`, `uses`, `unplugged`); `GHOST_ENDS` and the host's
`STRUCTURE` gain `use`/`plug`; worker `leaveOut` strips `uses`/`unplugged` of a left-out card; snapshot head as in
Decisions; `layoutFile()` v2 and `load()` v2 + v1 conversion; `rename`/`rm` keep `uses`/`unplugged` consistent;
constant.js outputs `center`.
- [ ] **Step 1: Failing tests (auto:true):** the demo by name (ball follows oscillator, no uses); `use` / reset /
  refusals via `handle`; `plug`; snapshots validate with wire.js and carry `vars`/`uses`/`unplugged`; the IDE-side rule
  "drop rails not in vars" is possible (a removed variable leaves `vars`); v1 demo layout → v2 conversion (each rule);
  layoutFile round trip; a Worker restart keeps uses/unplugged; a ghost ends on `use`/`plug`; the host saves the layout
  after `use`/`plug`. v1 tests unchanged.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS.

### Task 2A: IDE core — strip v1 wiring, consume vars/uses/unplugged, commands

**Files:** `js/scenes/rails/{ideCore.js, commands.js}`. Test `tests/rails-ide.test.cjs`, `tests/rails-ui.test.cjs`.
**Produces:** ideCore drops lanes, pin grab, device grab, the lens control and rail commands (their tests deleted);
consumes `vars` (drop rails not in it), `uses`, `unplugged`; `cardState.bindings = [{port, dir, variable, isDefault,
bound, reason}]` (reason for waiting/incompatible), `cardState.unplugged`; commands `use <input> [variable]`, `plug`,
`unplug` (focused card); `rm`/`rename`/`undo` of cards keep `uses`/`unplugged` (undo: addModule → use per key → plug off
→ restore dirty text). Every sent cmd passes `wire.valid`. The v1 edit-safety and pairing checks stay green.
- [ ] Steps: failing tests (use from the command line + ack/refusal; bindings with waiting/incompatible; unplugged
  card; rename moves uses; undo restores uses/unplug/dirty text) → FAIL → implement → PASS.

### Task 2B: Input — wheel, zoom, sideways scroll, step keys, Mod+B

**Files:** `js/scenes/rails/{terminal.js, keymap.js, wire.js (the `in` wheel shape), ideCore.js, layout.js (ZOOMS)}`.
Test `tests/rails-ui.test.cjs`, `tests/rails-ide.test.cjs`.
**Produces:** terminal: Shift+wheel sends its vertical delta as `dx` when `deltaX` is 0; Ctrl/Cmd+wheel sends
`{k:'wheel', dx:0, dy:0, zoom:±1}` (wire accepts `zoom`; never page-zooms); keymap: Mod+B `bus`, Mod+= / Mod++ / Mod+- /
Mod+0 `zoomIn|zoomOut|zoomReset`, Mod+[ / Mod+] `stepBack|stepFwd` (Shift = 0.1 s); `ZOOMS = [{cols: 26, font: 36, adv,
line, rows}, {cols: 32, font: 29, adv: 17.4, line: 40, rows: 12}, {cols: 40, font: 23, adv, line, rows}]` in layout.js
(rows = what fits the 480 px code area); per-card `zoom` (default 1) and `scrollX` in display columns (tabs expanded),
two columns of margin; `dy` scrolls the focused card, `dx` scrubs while paused and scrolls sideways while live, `zoom`
zooms the focused card; step keys move the paused playhead 0.5 s (Shift 0.1 s).
- [ ] Steps: failing tests (each mapping; zoom keeps the cursor visible; scrollX keeps two columns; tabs; dx semantics;
  step keys) → FAIL → implement → PASS.

### Task 2C: Bus window logic and the plug gesture

**Files:** create `js/scenes/rails/busWindow.js` (pure); modify `ideCore.js`, `layout.js`. Test `tests/rails-ide.test.cjs`.
**Produces:** layout.js `BUS = {y: -0.40, from: -62, to: 62}`, `plugCell(slot)`, `plugAt(ws, ray, slot)`, `onBus(ws, ray)`,
`busWindowFrame(ws, yaw)`; busWindow.js exports its metrics (`WIN = {w: 0.90, h: 0.56, radius: 1.0, px: [1024, 640],
header, rowH, inputsTop, varsTop}`) and `createBusWindow()` → `{toggle, close, key(op), wheel(dy), hoverAt(ray, ws),
click(), view(snapshotView, focusedCard, t) → {open, header, filter, inputs, rows, section, selected, hover, footer}}`
returning the `use` commands for the core to send (pending, ack, refusals into the footer for 5 s; "applies when you
resume" while paused); opening by Mod+B or the gaze on the bus for 0.4 s while not holding; while open, keys go to the
window except Mod chords; plug grab: look at a plug (±3°), hold, release on the bus → `plug on`, elsewhere → `plug off`,
blur cancels; the view exposes `bus` and `plugGrab`.
- [ ] Steps: failing tests (open/close; rows sorted, built-ins last; filter; Tab/↑↓/Enter assign; Backspace resets; gaze
  hover + click assign; Esc order; footer refusal; click does not reach pointer_down; plug grab on/off/blur; the 0.4 s
  gaze opener) → FAIL → implement → PASS.

### Task 3A: Legibility and cards

**Files:** `js/scenes/rails/{glyphs.js, cardDraw.js, cardView.js, cards.js, timelineView.js}`. Test `tests/rails-view.test.cjs`.
**Produces:** glyph stroke 0.18 (was 0.12), every floating line-font text on an opaque dark plate, line-font text ×1.3;
cards: footer shows bindings (`target ← gaze_hit`, `→ target`, waiting/incompatible marked), header `unplugged`, the three
`ZOOMS` sizes, sideways scroll with ◀ ▶ marks, bold code font, idle brightness 0.85; timeline on a plate.
- [ ] Steps: failing tests (recording context: bindings text, unplugged header, zoom cols/rows, scrollX shows the cursor
  column and marks, bold font, brightness, plates, stroke) → FAIL → implement → PASS.

### Task 3B: The bus and the plugs in space

**Files:** create `js/scenes/rails/{busView.js (pure), bus3d.js (Clay)}`; modify `ide.js`. Test `tests/rails-view.test.cjs`.
**Produces:** `createBus(node) -> {update(ws, view, t), stats}`: one ribbon mesh at `BUS` rebuilt only on workspace change;
a plug quad per card at `plugCell` with a drop line and a connector dot (hollow red when unplugged); pulses from a
publisher's connector to its takers' connectors, ≤ 60, variable hue (`railHue`); the held plug follows the gaze while
grabbing. Drawn-node count for the demo ≤ 30 including plates.
- [ ] Steps: failing tests (one mesh; plug round trip with `plugAt`; pulses capped and routed; unplugged look; no per-frame
  allocation when unchanged) → FAIL → implement → PASS.

### Task 3C: The bus window view; remove v1 visuals

**Files:** create `js/scenes/rails/{busWindowDraw.js (pure), busWindowView.js}`; modify `ide.js`; delete `rails3d.js`,
`railsView.js`, `lens.js`, `lensDraw.js`, `lensGaze.js`, `lensControl.js` and their tests. Test `tests/rails-view.test.cjs`.
**Produces:** `createBusWindowView(node, {owned}) -> {update(view.bus, ws)}`: one canvas (the lens's slot; 7 in all),
opaque, at `busWindowFrame` under the gaze when opened; header, inputs section, rows (clipped), stale/contested marks,
ghost values, filter, footer; repaint only on change, ≤ 4 Hz live.
- [ ] Steps: failing tests (drawing contents; repaint policy; ≤ 7 canvases) → FAIL → implement → PASS.

### Task 4: Flip to v2, integration, browser test, docs, delete v1 wiring

**Files:** `js/scenes/rails.js`, `ide.js`, `runtime.js`/`bus.js` (default `auto: true`; remove `auto:false` paths except
the ghost's manual bus), `wire.js` (remove `addRail`, `rmRail`, `renameRail`, `kind`, `dock`, `undock`, `geometry.rails`),
`values.js`/`layout.js` (remove `LANES`, `isLane`, `CLOCK_LANE`, `USER_LANES`, `laneAt`, `DEVICES`, device frames/pins,
`LENS`), `data/layout.js` (v2 demo), `terminal.js` (HUD lists mouse/keyboard bindings), tests (delete v1-only tests,
listed), `tests/rails-browser.test.cjs`, `doc/hw9-design.md` (As built points to v2), `doc/hw9-v2-design.md` ("As built":
the Decisions above and anything that changed).
- [ ] **Step 1:** Browser test rewritten for v2 (keep every v1 check that still applies: pairing, stray client, `both`,
  textures ≤ 7 and leave/return, worker cleanup, real hang, 60-beat save, reload re-pair, unforced roles, ghost, /log):
  demo by name; `use target pointer_pos` → the mouse moves the ball; bus window via Mod+B, a gaze/Enter reassign, Esc
  closes; plug gesture via `railsDebug` hooks (flowers stop, `target` no publisher; plug back); Shift+wheel scrubs while
  paused; Mod+[ steps (verify Cmd+[ is preventable on Chromium; else switch to Mod+Alt+, / Mod+Alt+. per the spec);
  Ctrl+wheel zooms; a long line scrolls sideways; drawn bus nodes ≤ 30.
- [ ] **Step 2:** Run (safety rules) — PASS; all Node suites PASS; docs updated.
