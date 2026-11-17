# HW9: Rails, a spatial IDE for modules on a bus

> **Rails v2 replaced the rails, lanes, pins, device cards and the lens of this document.** There is now one bus
> (variables by name, `use` to point an input at another variable, one plug per card, an on-demand bus window); the
> headset test's mouse, legibility and zoom problems were fixed with it. Everything else here still holds: the
> runtime in a Worker, delivery, recording, the watchdog, saving, pairing and the log. **The ghost run (replay of one
> edited module while paused) was removed later**: the paused scene now shows the past itself, and Mod+Shift+Enter
> continues from the playhead; every ghost passage below is history. The v2 design
> and its "As built" (how to run the demo, the controls, every decision, known limitations, the tests) are in
> **doc/hw9-v2-design.md**. This file is kept as the record of the first version; text that no longer applies is
> marked **[v1 only]**, and the demo, controls and tests of the v1 "As built" below are superseded by the v2 ones.

You sit with a Quest on your head and a laptop in front of you. Floating cards hold
the code of small modules; you type into the card you look at, on the laptop's real
keyboard. A module's code only declares its ports (`input`, `output`), like a program's
stdin and stdout. Which data reaches which port is decided in space: glowing **rails**
(the bus channels) run below the cards, and you wire a port to a rail by looking at the
port, holding the trackpad, looking at the rail and letting go. Many modules can publish
to and read from one rail, and none knows the others. What the modules draw appears on
your real desk. Pause the world, scrub back, edit a module, and replay the same past
input through the edited version as a translucent ghost beside the real one.

Scene name `rails` (js/scenes/rails.js, js/scenes/rails/). Message channel `railsLink`.

## 0. Decisions

| Question | Decision |
|---|---|
| Wiring | **Code declares ports, space binds them to rails.** No rail name ever appears in code; bindings live in the layout. (UNIX: programs know stdin/stdout, the shell does the pipes.) |
| Rail kinds | `state` (retained latest value) and `event` (ordered messages), chosen per rail |
| Record & replay | in v1: 30 s recording, pause, scrub, play, ghost run of one edited module |
| Not in v1 | editing the editor's own modules; modules spread over several devices; full-world rewind of drawn objects (stretch) |
| Devices | **Headset = IDE** (text, focus, layout geometry, all rendering; never waits on the network). **Laptop = runtime** (bus, compile, hot reload, isolation, recording, saving; the bus runs in a Web Worker at a fixed 60 steps/s). Either device alone does both. |
| Sync | asynchronous both ways: ordered messages with sequence numbers, whole snapshots, optimistic UI on the headset confirmed by the runtime |
| Keys | our own capture listeners on the laptop (upstream's Space+K mode exits on the first typed `k`); a `window.keydown` compatibility hook too |
| Platforms | developed on Windows (WSL2), demoed on a Mac: chords use **Mod** = Cmd on Mac, Ctrl elsewhere |
| Stage | the real desk: a 40 × 40 cm **stage mat** right of the laptop; the gaze device publishes where the gaze ray meets the desk inside the mat |

## 1. Modules and the bus (pure, runs in the runtime Worker; Node-tested)

### A module's source

A module is the body of a function; its top level runs once per (re)load (the setup pass)
to declare ports and state and register handlers; afterwards it only runs inside handlers.

```js
const time   = input('time', 'state', 'time');      // input(name, kind, type) -> { value, docked, on(fn) }
const target = input('target', 'state', 'vec3');
const out    = output('trail', 'event', 'vec3');    // output(name, kind, type) -> { value, set(v) | emit(v) }
const S = state({ p: [0, 0, 0] });                  // persistent JSON object, migrated on hot reload
time.on(({ t, dt, n }) => { ... });                 // per message (event) or per change (state); 2nd arg { retained, t, by }
draw([{ shape: 'sphere', p: [x, y, z], s: .02, color: '#ffb000' }]);   // effect-only sink (positions on the stage mat)
random(); log('text');                              // seeded PRNG; log lines shown on the card
```

- An input named `time` of type `time` is auto-docked to the built-in `clock` rail.
- `kind` is required (`state`|`event`); `type` optional (`any|num|bool|str|vec3|time`, default `any`).
- **Everything a module knows comes from the bus, time included.** `Date`, `performance`,
  `Math.random` throw a teaching error ("use the time input"); `window`, `document`, `fetch`,
  `setTimeout`, `Promise`, `server`, … are shadowed as `undefined`. This is a determinism
  fence, not a security boundary.
- `state({defaults})` is the only persistent state (JSON, ≤ 16 KB). On reload,
  `migrate(old, defaults)` keeps keys present in both with the same JS type, takes defaults
  for new or retyped keys, drops removed keys. The runtime API also offers a reload with
  `resetState` (defaults only), reachable from the command line as `reset`.
- `draw(list)` replaces the module's draw list: ≤ 128 shapes `sphere|box|line|text`,
  finite numbers, colours `#rgb`/`#rrggbb`, positions in **stage coordinates** (metres,
  origin at the mat's centre on the desk, x right, y up, z towards the user).

### Rails, ports, delivery

**[v1 only: replaced by v2, see doc/hw9-v2-design.md]** for how ports are bound: the bus now creates, docks and sweeps its rails itself, one per variable name (v2 section 1). The delivery rules below are unchanged.

- `Rail { id, kind, type, value, by, seq, stale, contested, writers, tail (last 32) }`;
  `Port { module, name, dir, kind, type, rail|null }`. A port binds to at most one rail; a
  rail has any number of ports.
- Values are validated (JSON, finite, depth ≤ 6, ≤ 4 KB), deep-copied and frozen at publish.
- Dock check: direction, equal kinds, types equal or either `any`; refusal carries a reason.
- **State:** retains the latest delivered value; publishes coalesce within a pass; docking an
  input delivers the retained value at once (`retained: true`); docking an output with a
  value publishes it; undocking a publisher leaves the value, marked `stale`; several
  publishers: last delivered wins, `contested` set when two publish in one step.
- **Event:** every message delivered exactly once, in order, to every input docked at
  delivery; nothing retained.
- **Step** (`bus.step()`, fixed dt = 1/60 s): apply queued structure ops; enqueue device
  values (fixed order); the clock publishes `{t, dt, n}` last; deliver in passes (each pass
  delivers the queue as it stood; publishes from handlers form the next pass), at most 8
  passes per step, the rest carried over. Cycles are legal; a module exceeding 2000 handler
  calls per step is quarantined ("runaway").

### Isolation, errors, versions

- Compile with `new Function(...params, '"use strict";\n' + source + '\n//# sourceURL=module:' + name)`;
  line numbers calibrated once; error shape `{ phase: 'compile'|'setup'|'handler'|'publish', message, line, col }`.
- A compile/setup failure on reload leaves the old version running (`editError`).
- A runtime error quarantines the module: no more handlers, docks kept, outputs keep their
  last value (`stale`), state rolled back to the step's checkpoint. Recovery: a successful
  reload, or `revert`. Every handler call is wrapped; others never stop.
- Last 10 good sources kept; reload reconciles docks by port name/dir/kind/type.
- **Hangs:** the Worker posts a heartbeat every step; the runtime host terminates and
  restarts it after 500 ms of silence, restores the last snapshot, and quarantines the most
  recently changed module, telling the IDE why.

### Record & replay (pure)

- Always recording, window 30 s: one segment per second `{ snap, frames }`;
  `snap = { n, t, rails, modules: {id: {ver, state, rng, status}}, docks }`; frame ops in
  delivery order: `pub {rail, v, by, p}` (delivered messages only), `dock/undock`, `reload`,
  `quarantine`. Caps: 100k ops, 16 KB state per module; trimming drops whole segments.
- **Pause** freezes everything (no device sampling, no steps, clock stops); resume continues
  from the same bus time without a gap. While paused, `commit`, `reset`, `revert` and `addModule` (the
  command line's `card`) are refused with a reason; dock, undock, rail, `rm` and `rename` ops are
  accepted and apply after resume.
- **Scrub (v1, tape only):** rails and the lens show the recorded values at the playhead
  (state: last value ≤ t; event: the messages near t); drawn objects stay as at the pause.
  Full-world rewind by re-running all modules from a snapshot is a stretch goal.
- **Ghost:** while paused, Mod+Enter on an edited card stages the source (compile only) and
  re-runs that one module in a private one-module bus from the window start (its state/rng
  from the snapshot, migrated), fed from the tape (other publishers' logged messages at
  their pass), its outputs going to **ghost rails** and its draw list to a **ghost draw
  list**. Ghost and tape advance together on the playhead. `compare()` gives, per output
  port, the first differing time. With unchanged source, ghost must equal the tape (the
  runtime's determinism self-check; a mismatch is reported on the card).
- **Adopt:** Mod+Shift+Enter turns the staged source into a normal reload (state migrated
  from the live module), clears the ghost and resumes. Resuming with Mod+P discards the ghost.

## 2. The IDE in the headset (and its pure logic)

### 2.1 Layout (metres, degrees; set around the seated head; re-centred on entering VR and by Mod+Home)

- A cylinder of radius 1.25 m around the head. **Cards**: 5 slots at yaw −50, −25, 0, +25,
  +50, centre at eye height −0.02, 0.50 × 0.50 m, facing the centre, upright; 640 × 640 px
  canvas; monospace, 32 columns × 12 lines, em 29 px; header (name, status dot, version) and
  footer (port strip, error message).
- **Rails** **[v1 only: replaced by v2, see doc/hw9-v2-design.md]**: 5 horizontal arcs (−70…+70 yaw) at heights −0.40, −0.485, −0.57, −0.655, −0.74
  below eye level; the lowest is the fixed `clock` rail, so 4 user rails. Tube 0.02 m.
- **Timeline**: a strip above the cards (+0.40), 1.5 × 0.03 m (0.06 when paused).
- **Stage mat** on the real desk, 0.40 × 0.40 m, its centre 0.45 m right of and 0.10 m
  further than the head's floor projection; desk height from the X calibration (left
  controller flat on the desk, button X, as HW7/HW8), default eye height − 0.45 m.
- Nothing virtual below −33° pitch near yaw 0 (laptop screen, keyboard, trackpad).
- Text canvases redraw only on change; cursor, focus frame, charge ring and error bar are
  separate quads.
- **Texture budget:** Clay has 14 canvas texture channels. The scene uses at most 7: one canvas
  per card (header, code, footer, key echo / command line), one for the timeline, one for the
  lens. Rail tags, device cards and stage `text` shapes use the line font
  (`js/render/core/linefont.js`), never a canvas. Every canvas is created and uploaded before the
  first frame and released in `deinit`.
- The lens sits at radius 1.0 m, centre 0.50 m below eye level (above the −33° line); the
  command line replaces the focused card's key echo line while it is open.

### 2.2 Gaze focus (pure state machine `gazeFocus.js`)

Gaze ray = head forward. A card is acquired after a **350 ms** dwell (a charge ring fills on
its border); the focused card's hit rect is enlarged **4°**; gazing at nothing, rails or the
keyboard keeps focus; within **1000 ms** of the last text key focus cannot move. Esc opens the
command line; Esc on an empty command line releases focus. A key echo line under the focused
card shows the last 8 keys.

### 2.3 Editing (pure `textBuffer.js`, `keymap.js`)

Insert, Enter with indent, Tab = 2 spaces, Backspace, Delete, arrows, Home/End, PageUp/Down,
Mod+Backspace deletes to line start, paste (laptop `paste` event, ≤ 4 KB), undo/redo with
snapshots on 800 ms idle, Enter, or insert/delete switch. No selection in v1. Wheel-Y scrolls
the focused card; the cursor scrolls itself into view. Header dot: green running, amber
edited-not-running, red error, violet ghost.

| Key (Mod = Cmd on Mac, Ctrl elsewhere) | Action |
|---|---|
| Mod+Enter | run (hot reload) the focused card; while paused: ghost run |
| Mod+Shift+Enter | while paused: adopt the ghost and resume |
| Mod+Z / Mod+Shift+Z | undo / redo (on a PC also Ctrl+Y for redo) |
| Cmd+← / Cmd+→ (Mac only) | cursor to line start / end |
| Mod+P | pause / resume |
| Mod+. | while paused: play the recording from the playhead / stop |
| Mod+Home | re-centre the workspace (a Mac keyboard without Home: Fn+Cmd+←) |
| Esc | command line (`card <name>`, `rail <name> state\|event`, `rm` (twice to confirm), `rename <name>`, `kind state\|event`, `undock`, `undo`, `reset` (reload with default state), `pause`, `live`, `play`); Esc again releases focus |
| two-finger vertical | scroll the focused card |
| two-finger horizontal | while paused: scrub (100 units = 1 s) |

Never bound (browser/OS keep them): Mod+W/T/N/Q/R, F5, F11, F12, Ctrl+Tab, Alt+Tab.

### 2.4 Docking (pure `grab.js`)

**[v1 only: replaced by v2, see doc/hw9-v2-design.md]** (pins and docking by grab are gone; the plug gesture replaces them, v2 section 2).

Ports sit in the card's footer strip: inputs on the left half, outputs on the right, pins
0.03 m, 2 per side per row (max 4 + 4). Gaze within 3° of the strip snaps to the nearest pin.
**Press and hold the trackpad** to grab: a wire runs from the pin to the gaze point; looking
down picks a rail by **pitch only** (nearest lane within ±0.6 lane pitch, 0.9° hysteresis);
release over a rail docks (or, if the dock check fails, the rail shows the reason and nothing
happens); release over nothing cancels, or unplugs if the pin was docked. A trackpad press
not on a pin goes to the `pointer` device. Docked pins are filled in the rail's hue with a
plumb wire and a bead on the rail; undocked pins are hollow.

### 2.5 Rails, lens, errors, ghost visuals

**[v1 only: replaced by v2, see doc/hw9-v2-design.md]** for the rails, tags, lens and the ghost's sub-lanes (now the bus and the bus window). Errors are unchanged; the violet ghost card and the translucent ghost shapes are gone (the ghost was removed).

- State rail: a glowing tube with a value tag (latest value, ≤ 28 chars) that flashes on
  change; stale values amber. Event rail: dark tube; each message a bead travelling from the
  publisher's dock to each subscriber's (1 m/s, ≤ 60 beads, faster rates merge into a streak).
- Gazing at a rail for 250 ms opens a lens below it: name, kind, publishers, subscribers,
  rate, last 8 messages.
- Error card: red header and frame, red bar behind the error line, message in the footer;
  quarantined: hollow grey pins with an x, faded wires.
- **Optimistic UI:** commands waiting for the runtime show dashed wires or "running…"; a
  confirmation makes them solid/green; a refusal retracts them with the reason.
- **Ghost:** *solid is live, translucent is ghost.* A dashed violet ghost sub-lane 0.028 m
  under each rail the ghost writes; state tags "live 3 | ghost 4" with "≠" when they differ;
  hollow translucent event beads; the ghost's draw list translucent on the stage; violet card
  header "GHOST"; the timeline banner "REPLAY, not live".

### 2.6 Devices (built-in publishers)

**[v1 only: replaced by v2, see doc/hw9-v2-design.md]** for the device cards and the port names `clock.time`, `gaze.hit` and so on as rails; the devices still send the same `dev` messages and publish the variables `time`, `gaze_hit`, `gaze_on`, `pointer_pos`, `pointer_down` (v2 section 1).

Devices have plain typed ports, so any target publisher can replace another:
`clock.time` (state, time); `gaze.hit` (state, vec3: where the gaze meets the desk in stage
coordinates, y = 0; while the gaze is off the mat `gaze.hit` is not updated and keeps its last
value, and `gaze.on` is false) and `gaze.on` (state, bool); `pointer.pos` (state, vec3: the trackpad position over the
laptop window mapped onto the mat, `[(x − .5) · .4, 0, (y − .5) · .4]`) and `pointer.down` (state,
bool). The laptop supplies the pointer's position, the IDE its `down` (a trackpad press that is
not on a pin). Device cards sit at yaw ±42 below the rails with output pins on top. Shapes drawn
outside the mat are drawn, not clipped.

## 3. Devices, messages, saving

### 3.1 Roles

Each client says hello with `rank` (XR 2, desktop 1; `?railsRole=ide|runtime|both` forces it
for tests). With a headset and a laptop live: the headset is the IDE, the laptop the runtime.
A client alone is both: its keys, commands and snapshots go through an in-page loopback and are
never sent to the server (only the `hello` presence message is, and not even that with
`?railsRole=both`). A headset that has paired once stays the IDE when the laptop goes silent (for
example a Wi-Fi drop) and shows "waiting for the laptop"; it does not turn into `both`. A runtime pairs with the first IDE heard while none is live (HW8
pairing: same id with a new epoch = reload; a stranger is ignored until the peer is silent
3 s), so strangers on the shared class relay cannot type into the editor.

### 3.2 Ownership

| IDE (headset) | Runtime (laptop) |
|---|---|
| text buffers, cursors, undo; focus; card and rail positions; rendering; pending UI | committed sources, compile, reload, isolation; bus structure (rails, kinds, docks); recording, replay, ghost; saving files |

### 3.3 Messages (`server.init('railsLink', {}, {accumulate: true})`, `send`, `sync`; all carry `from, epoch, seq`)

| Direction | Type | Content | Rate |
|---|---|---|---|
| both | `hello` | role, rank, caps `{mac}`, echo `{seq, t}` (for RTT) | 2 Hz |
| laptop → headset | `in` | `{k:'key', d:'down'\|'up', key, code, mods:{c,a,s,m}, rep}`, `{k:'paste', text}`, `{k:'wheel', dx, dy}`, `{k:'btn', d:'down'\|'up'}`, `{k:'blur'}` | on input |
| laptop → headset | `snap` | changed rails (value, seq, stale, contested, tail), changed modules (status, error, editError, ports, draw, calls, ver; source only on a new ver), clock (t, paused, playing, playhead, window, density[60]), notices (last 8, e.g. a dock dropped by a reload), ghost (rails, draw, compare) | 30 Hz |
| laptop → headset | `ack` | `{cmd, ok, reason?}` | per command |
| headset → laptop | `dev` | `{id, port, value}`: `gaze.hit`, `gaze.on`, `pointer.down` (latest only) | ≤ 60 Hz |
| headset → laptop | `cmd` | `{id, op: 'commit'\|'ghost'\|'adopt'\|'dock'\|'undock'\|'addRail'\|'rmRail'\|'renameRail'\|'kind'\|'addModule'\|'rmModule'\|'renameModule'\|'reset'\|'revert'\|'pause'\|'resume'\|'seek'\|'play'\|'stop'\|'geometry', …}` | on action |

The `pointer` device is fed on the laptop directly. Incoming messages are validated; malformed
ones are dropped. Every message carries the sender's clock `t`; the receiver keeps
`off = min(now − t)` and drops an `in` whose `(now − t) − off > 2000` ms (a stall). Mod is
resolved with the **laptop's** platform (`hello.caps.mac`), not the headset's.

### 3.4 Saving (runtime only, via `POST /api/saveScene`, which accepts only `js/scenes/**/*.js`)

- Module sources: `js/scenes/rails/modules/<name>.js` on commit (Mod+Enter), names
  `/^[a-z][a-z0-9_]{0,31}$/`, ≤ 64 KB; uncommitted drafts are not saved in v1.
- Layout: `js/scenes/rails/data/layout.js` written as `export default <JSON>;` (cards `{id:
  {slot}}`, rails `{id: {kind, type, lane}}`, docks `[[owner, port, rail]]`), debounced 1 s; read
  back by fetching the text and parsing the JSON (no `import`, so Node can test it). A card whose
  module file is missing starts from the skeleton. Only committed sources that compiled are saved,
  and only after the Worker has kept beating after the commit (a hanging source is never saved).
- One write in flight per path, latest content wins. Never `/writeFile` or `/set`.
- Start: the runtime loads layout and module files (`fetch` no-store with a cache buster); a bad
  layout starts empty and is reported. The `modules/` and `data/` directories must exist (the
  server's `fs.writeFile` does not create them).

## 4. Logging and testing

- `rails {json}` to `/log` every 5 s from both roles: `v, ev, role, rank, mutual, peer {live, heardMs},
  input {rx, gaps, dups}, rtt {p50, max}, focus, cards [[id, status, dirty]], rails [[id,
  kind, pubs, subs, perSec]], rec {paused, span}, saves {ok, fail}, worker {restarts}, fps,
  errors, lastError`.
- Node: `tests/rails.test.cjs` (bus, sandbox, recorder, replay, ghost exactness, textBuffer,
  keymap Mac/Win, gazeFocus, grab, layout hit tests, timeline), `tests/rails-link.test.cjs`
  (wire, link, store, report).
- Browser: `tests/rails-browser.test.cjs`, one Chromium with two pages (`?railsRole=runtime`,
  `?railsRole=ide`), the routed WebSocket relay of the HW8 test, `saveScene` and `/log`
  intercepted (never writes the repo).
- Safety: one browser at a time; a test server is started and stopped within the test
  command; check free memory first.

## 5. Only a headset can check

Focus stickiness while looking down at the keys; legibility at 1.25 m; typing latency feel;
desk calibration and the stage mat's place; gaze precision; Wi-Fi jitter; the Mac keyboard.

---

# As built

> **Superseded in part by v2.** The demo layout, the two-minute demo, the docking, lane, pin, device-card and lens
> items and the browser test described here belong to v1; v2's "As built" (doc/hw9-v2-design.md) says how to run the
> demo now and what changed. What is still true here: the setup steps, the runtime/pairing/saving/watchdog items
> and the limitations about them (the ghost items are history: the ghost was removed). v1-only parts are marked **[v1 only]**.

Sections 0 to 5 above are the design. This section says how to run what was built, what
differs from the design and why, and what is still missing. Where the two disagree, this
section is right.

## A. Running the demo

**[v1 only: replaced by v2, see doc/hw9-v2-design.md]** for the demo table, the rails, steps 2 and 3 of the demo and the docking line at its end; the setup and the other demo steps carry over (their v2 versions are in v2's "As built").

The scene opens with a working demo (`js/scenes/rails/data/layout.js`, and the four modules
in `js/scenes/rails/modules/`):

| Card (slot, yaw) | What it does | Docked to |
|---|---|---|
| `oscillator` (0, -50) | publishes a target that sweeps over the mat | `target` (state, vec3) |
| `ball` (1, -25) | an amber ball that chases the target | `target` |
| `flowers` (2, 0) | plants a flower at the target twice a second | `target`; publishes `planted` |
| `constant` (3, +25) | publishes a fixed target `[0, 0, 0]` | not docked (free for the demo) |

Rails: `target` (lane 0) and `planted` (event, num, lane 1), plus the built-in `clock`
(lowest lane; every module's `time` input is docked to it on load). So on load the ball
follows the oscillator on the stage mat and flowers grow where it goes.

**Setup**
1. Start the class server from the repository root with Node 18: `./startserver` (or
   `node server/main.js 2026 2026 http`). Use `http://127.0.0.1:2026/` on the laptop
   (`localhost` can hang on IPv6 in WSL) and `http://<laptop LAN address>:2026/` from the
   headset. The server is plain http, so WebXR on the headset needs the step from the
   README's "Run in VR": in the Quest browser's `chrome://flags`, enable *Insecure origins
   treated as secure* with the laptop's address, then relaunch the browser.
2. **The laptop opens the scene first**: open the page, pick `rails` in the scene list. On a
   Mac, Cmd is Mod. Keep that laptop tab **in front** (a hidden tab stops the runtime and
   its hang watchdog) and keep **only one laptop tab** open on the class server. A stray
   second tab at the same rank can win the pairing and the headset will talk to it.
3. The headset joins: Quest browser, same URL, pick `rails`, enter VR. A Quest is
   recognised as the headset and becomes the IDE; the laptop stays the runtime. The cards
   are placed around your head when you enter VR (the workspace is rebuilt from your real
   head position then; **Mod+Home** does the same by hand, and on a Mac keyboard without a
   Home key it is Fn+Cmd+←). The laptop window shows a small HUD with the last keys typed.
4. Alone on one device the scene is both roles at once: its keys, commands and snapshots stay
   in the page and only the `hello` presence message goes out. `?railsRole=ide|runtime|both`
   forces a role (for tests, or to try the IDE on the laptop alone); forced `both` sends no
   message at all.
5. The `modules/` and `data/` folders under `js/scenes/rails/` must exist on the demo
   machine, because the server's file write does not create folders. They do once the
   branch is committed and checked out. With no layout file the scene starts empty and says
   why.

**Two-minute demo**
1. Look at the `ball` card for about a third of a second (a ring fills), then type: change
   its colour `'#ffb000'` to `'#44ddff'`. Press **Mod+Enter**: the card reloads at once (and is
   saved to disk about a second later), keeps its state, and the ball on the desk changes colour.
2. Show the idea: the code only says `input('target', ...)`. Grab the `target` pin on the
   `oscillator` card (hold the trackpad on it) and release over nothing: it unplugs. The
   `target` rail keeps its last value (shown amber, stale), so the ball settles there and the
   flowers stop (a flower is planted only when the target has moved). Press and hold the `hit`
   pin of the **gaze** device card (the one at yaw -42, below the rails), look down at the
   `target` rail, let go: the ball now follows **where you look on the desk** (inside the 40 cm
   mat). When the gaze leaves the mat `hit` stops updating, so the ball rests at the last spot
   (no amber: only `gaze.on` turns false). Flowers follow it too; the `planted` rail shows a bead
   per flower.
3. Unplug the gaze pin the same way and dock the `pos` pin of the **pointer** device card (yaw +42)
   to `target`: the ball follows the **trackpad**. `constant.target` docked to `target`
   puts it back at the centre.
4. **Mod+P** pauses (the timeline strip grows). A two-finger horizontal swipe on the
   trackpad scrubs: rail values and the lens show the recorded past. **Mod+.** plays the
   recording from the playhead, **Mod+P** goes live again.
5. **The ghost.** Press **Mod+P**, then on the `ball` card change the `6` in `Math.exp(-6 * dt)` to
   `2` (the ball will chase more lazily) and press **Mod+Enter**: nothing is committed.
   The card turns violet (**GHOST**) and says where the ghost first differs from the tape; the
   timeline reads "REPLAY, not live"; a translucent second ball on the mat is the edited ball
   in the recorded past; scrub with the swipe and it follows the playhead. Rails the ghost
   writes get a dashed violet sub-lane and a tag "live ... | ghost ... !=". **Mod+Shift+Enter** adopts
   it (the edit runs, is saved like any commit, and the runtime is live again); **Mod+P**
   instead discards it.
6. The watchdog: on the `constant` card type `while (true) {}` at the end and press
   Mod+Enter. Within about half a second the laptop restarts the Worker, the card turns
   red/grey (quarantined, "hung"), the other cards keep running, and the hanging source is
   **never saved**. Delete the line (Mod+Backspace) and press Mod+Enter to bring the card back.

Gaze and docking in one line: look at a pin, hold the trackpad, look at the rail (picked by
pitch only), release. Esc opens the command line, Esc on an empty line releases focus.

## B. What changed from the design, and why

### Wire and pairing
- **`cmd` and `snap` are nested**: `{type:'cmd', cmd:{id, op, ...}}` and
  `{type:'snap', snap:{...}}`. The flat form of section 3.3 collides with the envelope's own
  `type` (addRail's rail type) and `t` (snapshot time).
- **Mutual pairing.** Each `hello` names the peer it listens to (`peer: {id, epoch}`); the
  link is paired only when both sides name each other, and only then do `in`, `snap`,
  `cmd`, `dev` and `ack` flow. Why: on the shared class relay a stranger's hellos must not
  be able to type into the editor or have the headset's commands run in their runtime.
  The log line gains `mutual` (section 4).
- **Rank preemption.** A higher-rank client (headset 2) takes over from a lower-rank
  current peer; a peer that has not become mutual is released after 3 s. Why: a stray
  laptop tab in class must not block the demo. Equal ranks never preempt (hence "one laptop
  tab").
- **A paired headset stays the IDE.** Normally a client whose peer has been silent for 3 s is
  alone and becomes `both`. A headset (rank 2) that has paired in this page session does not: it
  stays `ide`, keeps its cards and unsaved edits, and shows "waiting for the laptop" until the
  laptop comes back (a Wi-Fi drop must not make it load an empty layout of its own and remove
  every card). A laptop that is gone for good leaves the headset waiting; reload the headset page
  to start alone. A page that was alone from the start, a forced role and a laptop are unchanged.
- **Clock offset** is the minimum over a 30 s window, reset on a new epoch, so a backward
  clock step recovers. The 2 s stale rule drops only action events (key down, paste,
  wheel, button down), never key-up or blur, so a key can never stay stuck.
- **A full snapshot on every pairing**, and the IDE resets its baselines (revision, notice
  ids). Commands still waiting at a re-pair are marked "link reset - run again" and are
  never resent (a resend could apply twice); a command with no ack for 5 s shows "no
  answer".
- **Snapshot budget.** The whole snapshot message is at most 200 KB (the wire allows 256),
  with at most 128 KB of source; what does not fit goes in the next snapshots. A source over
  about 140 KB is never synced (a notice says so). Every 60th snapshot repeats all rails so
  a lost message heals. Why: five 64 KB sources would otherwise make every full snapshot
  invalid.
- **Notice ids and the snapshot revision never go backwards**, also across a Worker
  restart, so the IDE does not swallow the restart notice.

### Runtime and saving
- **The 60-beat save rule.** A commit is written to disk (and becomes the version a
  restart falls back to) only after the Worker has beaten 60 times (about 1 s) after the
  ack, not 2. Why: a source with a loop that starts a moment after load must never be saved.
  `revert` follows the same path.
- **Watchdog details.** The Worker restarts after 500 ms of silence, or if it never beats
  within 5 s of starting; a page that itself stalled does not count as a hang; commands in
  flight at a restart get a failure ack that means "unknown outcome"; after repeated
  restarts the runtime stops and says so, and later commands are refused. While a `ghost`
  command is the oldest one unanswered the silence allowed is 4 s (see the ghost run).
- **Pause.** While the runtime is paused, `commit`, `reset`, `revert` and `addModule` are refused
  with the reason "paused: Mod+Enter runs a ghost, Mod+P resumes"; dock, undock, rail (v2: `use`, `plug`), `rm` and
  `rename` commands are accepted and applied when it resumes. Device values that arrive while
  paused are not applied one by one: the newest value of each is applied once at resume.
- **The `time` input.** On load an input named `time` that the layout does not mention is
  docked to the clock, so an undock of `time` is not saved. Declaring `time` with another
  kind or type is a setup error, not a silent no-dock.
- **Limits beyond the spec:** 20 000 publishes per module per step; state depth at most 6
  and 10 000 nodes (cyclic or non-JSON state is refused instead of crashing the Worker's
  snapshot); `on()` outside setup is an error; the sandbox also shadows `crypto` and
  routes `console` to the card's log; a module's `migrate` is shallow (keys with the same
  JS type keep their value, arrays and objects are replaced as a whole).
- **The ghost run** (`replay.js makeGhost`, `runtime.js`). While paused, `Mod+Enter` sends `ghost`
  {module, source}; the runtime runs the edited source *inside that command*, over the whole
  recorded window at once, in a private one-module `Bus` that starts from the module's own
  snapshot (state and generator, migrated to the new defaults) at the first recorded second whose
  snapshot has the version that runs now (the window's start if it was not reloaded; if it was reloaded in
  the last second of the tape the command is refused with that reason). The module's own docks and
  undocks are replayed from the tape, and what every other publisher delivered, the clock included, is
  fed to it in the pass in which it was delivered (`Bus.feed`, one hook in `_deliver`); its own messages are
  its own, so a module that feeds itself runs. Its outputs go to ghost rails and its pictures to a ghost
  draw list; `compare()` reports, per output port and for `draw`, the first time the ghost differs
  (the picture is set against a second private run of the running source, since the tape holds no pictures).
  Where the source is the running one, the ghost must equal the tape: `diverged` is `null`, or says
  what differed (output, final state, final picture), and the card says the module is not deterministic.
  The snapshot's `ghost` field (rails, picture and times at the playhead, rounded like a live draw list,
  cut to 48 KB, counted in the 200 KB budget) is worked out when the ghost is new or the playhead moves and
  is sent then, every 60th call and after `full()`. `adopt` stages the ghost's source, resumes and commits it
  (the 60-beat save rule applies; its ack carries the source for the host to save); `resume` and every
  command that changes the structure end the ghost. A ghost that loops for ever is a Worker hang found by
  the watchdog after 4 s instead of 0.5 s (a ghost over a full window takes a few hundred ms, and one that
  would take more than 2 s of computing is refused as "ghost too slow", so the long leash only catches true
  loops): the live modules are not blamed, none is quarantined, it does not count toward the "too many
  hangs" rule, nothing is saved by it, the notice says `ghost hung`, and the restarted Worker goes on
  live from the last snapshot with no ghost and a new, empty tape, as after any restart (the last second
  of commits and the whole tape are lost). Any message from the Worker, not only a beat, counts as a sign
  of life for the watchdog, so a long command that has just been answered is not met by a stale timer.
  The bus snapshot also keeps each module's last state-output values (`outs`), so a restart or a ghost
  that starts after a dock of an output still puts the value on the new rail.
  Not replayed (shown only as a difference): a rail renamed or changed in kind inside the replayed window,
  and the order of an own and a foreign message of one pass on one *event* rail (own first).
- **Snapshots of the world** omit messages in flight inside the step (taken at step
  boundaries); only deep cycles carry any, so a Worker restart can lose such a message.
- **Recorder.** A segment's snapshot contains everything before its first frame, and every
  frame has `n` greater than the snapshot's; scrubbing reports `stale` for state rails.
- **Layout file.** What is saved is what the runtime reports (`layoutFile()`): it also lists
  the `clock` rail and the clock docks. At most 5 cards and 4 user rails; a sixth is refused
  with a notice.

### IDE
- **Edit safety.** A card whose module the runtime removes while it has unsaved edits is
  not lost: a notice appears and `undo` restores it with the edits as a dirty buffer, and a
  restore never overwrites a dirty buffer. A source equal to what is running is ignored; the
  IDE's own acked commit never shows "run changed under you"; a dirty card renamed by this IDE
  keeps its edits; after a re-pair only notices younger than 5 s show.
- **Typing lock.** The 350 ms dwell does not count while the 1 s typing lock holds, so a
  switch needs 1 s idle and then the dwell.
- **Lane choice** [v1 only]. "Hysteresis 0.9 degrees" means the gaze must be 0.9 degrees past the
  middle between two lanes before the pick switches. A ray that is not finite (tracking
  lost) hits nothing.
- **Command line** [v1 only for `rail`, `kind`, `undock`; v2 adds `use`, `plug`, `unplug`] is a little richer than section 2.3: `rail <name> <kind> [type]`,
  `revert`, and `rm` must be given twice within 3 s to take effect (a rail's `rm` and `undo` restore
  its kind, type, docks and lane; one level of undo).
- **Footer** [v1 only]. A card with more than two pins per row shows its message on a one-line strip
  over code row 11 (the cursor scrolls one line to stay clear); an error card keeps a red
  frame.
- **Timeline and lens** [v1 only for the lens] repaint at most once a second live and twice a second (the lens
  data ages 0.5 s); a pause, a seek or a state change repaints at once.

### Rendering
- **One ribbon mesh per lane** [v1 only; the bus is one mesh now] (both faces), nodes grouped by kind, device cards as one
  stroke mesh: about 26 drawn rail nodes in the demo instead of about 123. Why: the first
  version cost most of a Quest frame.
- **Texture budget kept**: 7 canvases (5 cards, timeline, lens; v2: the lens's canvas is the bus window's), all created and uploaded
  before the first frame and released when the scene is left.
- **Stage clamps:** a shape's size is at most 0.25 m, text at most 0.2 m, and its position
  within 2 m of the mat centre. Why: a module cannot fill the room or crash the renderer.
- **Cursor row `ln r/n`** is drawn with line-font glyphs, so moving between rows does not
  repaint a card canvas.

## C. Known limitations

What a user can meet today:
- A ghost can differ from what happened, with no change of source, when a rail was renamed or
  changed kind inside the replayed window, and a very long self-feeding chain (more than 8 passes a
  step, carried over steps) may differ too.
- Scrubbing shows recorded rail values only; the live modules' drawn objects stay as they were at
  the pause (as in the design's v1), so a ghost's picture at an earlier playhead sits beside the
  live picture of the pause. A ghost needs a recorded second of the version that runs: just after a
  commit, pause only a second later. The ghost's tag writes `!=` for the not-equal sign (the line
  font has none), its event messages are translucent beads rather than hollow ones, and a ghost
  over a full 30 s window costs the Worker up to a few hundred milliseconds (the page stays live).
- Only **committed** sources are saved; a draft that was not run (Mod+Enter) is lost on
  reload. A source with a syntax error is never saved.
- `rm` and `rename` leave the old `modules/<name>.js` on disk (the server cannot delete); a
  later module of the same name that starts without a source reads that old file.
- After a Worker restart only one earlier version is kept, so `revert` may say "no earlier
  version" (undo the text instead). If two modules are committed within one second and then
  one hangs, only the last is blamed; the other quietly returns to its last good version.
- **Module code is your own code, and the sandbox can be escaped.** A module runs in the Worker
  with the page's rights; the sandbox is a determinism fence, not security. It can be got round
  (for example `Function('return self')()` reaches the Worker's global scope), `Intl`, `location`
  and `indexedDB` are not blocked, and `Date.UTC` and `Date.parse` have no teaching message.
  Protection from strangers on the class server comes from the mutual pairing (a stranger cannot
  type into the editor or send commands), not from the sandbox.
- **The class relay is plain text.** Keys, module sources and snapshots cross it unencrypted and
  every client of the server can read them: never type a password or a key into the editor.
- **One pair at a time.** There is no pairing code. Run one laptop and one headset of `rails` on
  a shared server at once; a second pair would meet the first.
- **A permanently gone laptop** leaves the headset on "waiting for the laptop" (reload the
  headset page to start alone).
- **While the runtime is paused**, `commit`, `reset`, `revert` and `addModule` (`card`) are refused;
  only dock, undock, rail, `rm` and `rename` commands wait for the resume (v2: `use`, `plug`, `rm` and `rename`).
- [v1 only] A press anywhere on a device card (not only near a pin) starts a grab of its nearest pin.
- A module that redeclares a name of the API (for example `const log = ...`) fails to compile with
  the engine's own message ("Identifier 'log' has already been declared"), not a teaching one.
- [v1 only] Docking a new publisher to a stale rail leaves it stale until the publisher publishes.
- With two laptop tabs open, reloading the headset may pair with the stray one about half the
  time. A hidden laptop tab stops the runtime and makes a hang undetectable.
- While paired, the laptop scene swallows keys it does not need (so Ctrl+Shift+I and F1 to F10
  do nothing); Mod+W/T/N/Q/R, F5, F11, F12, Ctrl+Tab and Alt+Tab still reach the browser.
  Shift+Tab inserts two spaces, a paste is cut at 4096 characters, and Ctrl+Alt+letter on a
  PC inserts the letter.
- Esc with text in the command line only closes it; a second Esc releases focus.
- If the headset was alone (both roles) and the laptop then joins, a commit made in the
  last second and a layout change in the last second may be lost.
- [v1 only] The lens panel hides lanes 1 to 4 at its own yaw (as in the design's geometry).

**Only a headset can check:** legibility of the 16 to 20 px text at 1.25 m; the cost of a
typed character (about 400 `fillText` calls and a 1.6 MB texture upload; the scene counts them
in `draws`); the feel of the 350 ms gaze dwell, focus stickiness while looking at the keys,
and gaze precision at the pins; desk calibration (X on the left controller) and the stage
mat's place; the frame cost on a Quest (26 rail nodes, 7 textures; the 50 fps measured in
headless software rendering says nothing about a Quest); Wi-Fi jitter; and the Mac
keyboard (Cmd chords).

## D. Tests

(The suites and counts of v2, and its browser test, are in doc/hw9-v2-design.md; the browser test below was rewritten for v2.)

Node 18 (`source ~/.nvm/nvm.sh && nvm use 18`), from the repository root; each prints how
many checks passed:

```sh
for t in rails rails-ui rails-link rails-view rails-ide doorways doorways-pair miniature echohunt; do
  node tests/$t.test.cjs || break; done
```

- `rails`: values, sandbox, bus, lifecycle, recorder, replay, the ghost run (the three demo modules and a
  scripted gaze through a dock, an undock and a reload: an unchanged ghost equals the tape at every step;
  an edited constant differs at the first step it matters; a self-fed module; the live bus unchanged),
  and the demo (every module in
  `modules/` compiles; `oscillator.target`, `constant.target`, `gaze.hit` and `pointer.pos`
  are all `vec3` state outputs, so re-docking any of them cannot break `ball`; the layout
  loads with no notices and the ball moves).
- `rails-ui`: text buffer, keymap (Mac and PC), gaze focus, docking, layout hit tests.
- `rails-link`: wire, link and pairing, store, runtime (ghost, adopt, the snapshot budget), host (with a
  real Worker thread for a hang and for a ghost that loops for ever).
- `rails-view`: card, timeline and lens drawing and the Clay-side parts, with fake contexts.
- `rails-ide`: the IDE's state machine, against a fake link and against a real `Runtime`.
- Browser: `tests/rails-browser.test.cjs`, one headless Chromium with two pages on a routed
  relay (the real server serves the files; `saveScene` and `/log` are answered locally, so
  nothing is written to the repository). It takes about a minute. Safety: check
  `free -m` first (at least 3000 MB available), one browser at a time, start the server and
  stop it inside the same command, use 127.0.0.1, and finish with `pgrep -af "server/main.js"`
  and `pgrep -af chrom` showing nothing. Playwright lives in `~/.cache/doorways-pw`:

```sh
P=~/.cache/doorways-pw
(node server/main.js 2026 2026 http > /dev/null 2>&1 & echo $! > /tmp/rails-server.pid); sleep 3
XR_TEST_URL=http://127.0.0.1:2026/ LD_LIBRARY_PATH=$(find $P/libs -type d | tr '\n' ':') \
  NODE_PATH=$P/pw/node_modules timeout 300 node tests/rails-browser.test.cjs
kill $(cat /tmp/rails-server.pid)
```
