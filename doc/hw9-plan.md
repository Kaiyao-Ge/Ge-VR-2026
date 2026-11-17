# Rails Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A spatial IDE in which modules that only declare ports are wired to visible bus rails by gaze and trackpad, typed into on the laptop's real keyboard, run on the laptop, and can be paused, scrubbed and (last) ghost-replayed.

**Architecture:** Pure modules carry all logic and are tested in Node. The laptop runs the bus in a module Web Worker at a fixed 60 steps/s; the headset is the IDE and renders everything without waiting on the network. The two talk over the class server's ordered message queue.

**Tech Stack:** ES modules in the browser (Clay, WebXR on Quest), a module Worker, `server.init/send/sync`, `POST /api/saveScene`; Node 18 tests via `tests/esm.cjs`; Playwright.

**Spec:** `doc/hw9-design.md` (read it first). More detail and rejected alternatives: `.superpowers/hw9/draft-runtime.md`, `draft-interaction.md`, `draft-integration.md`; the review behind this plan: `.superpowers/hw9/plan-review.md`. Where they differ, the spec wins, then this plan.

## Global Constraints

- Do not commit and do not run state-changing git commands; the user commits.
- Scene `rails`: `js/scenes/rails.js`, `js/scenes/rails/`; channel `railsLink`; tests `tests/rails.test.cjs` (bus side), `tests/rails-ui.test.cjs` (text, keys, spatial logic), `tests/rails-link.test.cjs` (wire, link, store, runtime, host), `tests/rails-browser.test.cjs`.
- Do not change other scenes, `js/render/**`, `js/util/**` or `server/**`. Touch `js/scenes/scenes.js` only to register `rails` after `kbdEvents2`.
- Style as `js/scenes/doorways/`: 3-space indent, semicolons, short functions, full-sentence comments saying why, a header comment per module.
- Pure modules import nothing from Clay, the DOM or the server, and import siblings only as `from './x.js'` (single quotes, no cycles, no side-effect or dynamic imports) because `tests/esm.cjs` rewrites only that form. `import.meta.url` appears only in `runtimeHost.js`.
- Numbers from the spec: `DT = 1/60`, bus time `t = n * DT`; `MAX_PASSES = 8`; 2000 handler calls per module per step; value ≤ 4096 bytes JSON, depth ≤ 6; state ≤ 16 KB; draw ≤ 128 shapes `sphere|box|line|text`; types `any|num|bool|str|vec3|time`; 30 s window, 1 segment/s, ≤ 100 000 ops; hello 2 Hz; snap 30 Hz; dev ≤ 60 Hz; silence 3 s; stale `in` 2 s; watchdog 500 ms; dwell 350 ms; hysteresis 4°; typing lock 1000 ms; lens dwell 250 ms; scrub 100 units = 1 s; radius 1.25 m; cards 0.50 m, yaw −50/−25/0/25/50, 32 × 12 chars, 640 px; lanes −0.40, −0.485, −0.57, −0.655, −0.74 m below eye (lowest = `clock`); stage mat 0.40 m, centre 0.45 m right and 0.10 m further than the workspace origin's floor point; desk default eye − 0.45 m; names `/^[a-z][a-z0-9_]{0,31}$/`; source ≤ 64 KB; snap ≤ 256 KB; paste ≤ 4096 chars.
- **Texture budget:** at most 7 canvases in the scene (5 cards, timeline, lens); everything else uses the line font (`js/render/core/linefont.js`, as `js/scenes/linefont.js` draws it). Canvases are created and uploaded before the first frame (copy `ownTexture`/`uploadNow` from `js/scenes/doorways/symbols.js`) and released in `deinit` (as `js/scenes/doorways.js` cleanup does).
- Mod = Cmd when the **laptop** is a Mac (`hello.caps.mac`, from `/Mac|iPhone|iPad/.test(navigator.platform)`), Ctrl otherwise.
- Node: `source ~/.nvm/nvm.sh && nvm use 18`. Browser tests: `P=~/.cache/doorways-pw; LD_LIBRARY_PATH=$(find $P/libs -type d | tr '\n' ':') NODE_PATH=$P/pw/node_modules`; one browser at a time; `free -m` ≥ 3000 MB first; if a server answers on http://127.0.0.1:2026/ use it and leave it running, else start one inside the test command and kill it at its end; tests intercept `/api/saveScene` and `/log` and never write the repository.
- Existing suites keep passing: `tests/doorways.test.cjs`, `tests/doorways-pair.test.cjs`, `tests/miniature.test.cjs`, `tests/echohunt.test.cjs`.

## Review Focus

- A stranger on the shared relay sends hellos, keys or commands: ignored without errors; cannot type or change the bus. Tests: Task 6 (link), Task 9a (page level).
- A module that hangs or floods: the IDE stays responsive, the Worker restarts, the module is quarantined, the hanging source is never saved, others run again. Tests: Task 2b (runaway), Task 7b (restart contract), Task 9c (end to end).
- A reload that renames a docked port or changes its kind: the dock is dropped with a visible notice, others survive, nothing throws. Tests: Task 2b, Task 10a.
- The laptop window blurs or the link stalls mid-typing: held buttons/keys clear, a grab cancels, stale keys are dropped, typing resumes. Tests: Task 6, Task 9c.
- Ghost window containing docks, undocks and a reload of the ghosted module itself: an unchanged ghost equals the tape. Test: Task 12.

---

### Task 1: Values and sandbox

**Files:** Create `js/scenes/rails/values.js`, `js/scenes/rails/sandbox.js`. Test `tests/rails.test.cjs` (new; harness as `tests/doorways.test.cjs`; prints "N rails checks passed.").

**Interfaces — produces:**
- `values.js`: `TYPES`; `typeOk(type, v) -> bool` (`vec3` = 3 finite numbers, `time` = `{t, dt, n}`); `validateValue(v) -> {ok, error?}`; `freezeCopy(v)` (deep copy, deep frozen); `validDraw(list) -> {ok, error?}` (shapes `{shape, p, s, color, text?, to?}`, colours `#rgb`/`#rrggbb`); `validState(o) -> {ok, error?}`; `migrate(old, defaults)`; `compatible({dir, kind, type}, rail {kind, type}) -> {ok, reason?}` (the one dock rule, also used by the IDE).
- `sandbox.js`: `makeRng(seed) -> {random(), state}` (mulberry32, `state` get/set); `hashSeed(seed, id) -> uint32`; `PARAMS`; `compile(name, source) -> {ok, run?, error?}`, `run(api)` executes setup with `api = {input, output, state, draw, random, log}` and the shadows (`window document globalThis self fetch XMLHttpRequest WebSocket Worker localStorage navigator server setTimeout setInterval requestAnimationFrame queueMicrotask Promise` = undefined; `Math.random`, `Date.now`, `new Date`, `performance.now` throw an Error whose message contains `time input` or `random()`); `error = {phase, message, line, col}` with `line = null` for `phase:'compile'` (V8 gives no position); `lineOf(err, name) -> {line, col} | null` (offset calibrated once; null when the stack has no `module:<name>:` frame).

- [ ] **Step 1: Failing tests:** `validateValue` accepts `[1,2,3]`, `{a:'x'}`; rejects NaN, Infinity, `undefined` inside, functions, depth 7, a 5000-char string. `freezeCopy` deep-frozen, not `===`. `typeOk('vec3',[1,2])` false. `validDraw` rejects 129 shapes, `'cone'`, colour `'red'`; accepts a sphere. `migrate({a:1,b:'x',c:[1]}, {a:0,b:0,d:true})` → `{a:1,b:0,d:true}`. `compatible` refuses kind and type mismatches with reasons, accepts `any`. `makeRng(7)` repeats; `state` round-trips mid-sequence. Running `'Date.now()'`, `'Math.random()'`, `'window.x'` fails with the teaching messages / an error; a throw on source line 3 gives `line 3`; a syntax error gives `ok:false`, `line:null`.
- [ ] **Step 2:** `node tests/rails.test.cjs` — FAIL. **Step 3:** Implement. **Step 4:** PASS; existing suites PASS.

### Task 2a: Bus core (rails, ports, devices, delivery)

**Files:** Create `js/scenes/rails/bus.js`. Test `tests/rails.test.cjs` (append).

**Interfaces — consumes** Task 1. **Produces** `bus.js`: `DT`, `MAX_PASSES`, `BUDGET = 2000`; `class Bus`:
- `constructor({seed = 1})`: device `clock` with state output `time` (type `time`) docked to rail `clock` (state, time).
- Rails: `addRail({id, kind, type = 'any'})`, `removeRail(id)`, `renameRail(id, to)`, `setKind(id, kind)`; devices: `addDevice({id, outputs: {name: {kind, type}}}) -> {set(name, v), emit(name, v)}` (owner `dev:<id>`); docks: `canDock(owner, port, rail)`, `dock(owner, port, rail)`, `undock(owner, port)`. All structure calls validate at once and return `{ok, reason?}`, then append to `bus.queue`; `step()` applies the queue first in call order; nothing is applied while paused. Docking a docked port moves it (logged undock + dock). Docking an output that has a value publishes it.
- Time: `step()`, `pause()`, `resume()`, `paused`, `n`, `t = n * DT`.
- Delivery exactly as the spec's §1 "Rails, ports, delivery" and "Step" (state retained/coalesced/stale/contested; events ordered, exactly once; passes; carry-over).
- Read model: `rails: Map id -> {id, kind, type, value, by, seq, stale, contested, writers, tail}`; `devices`; `rev`.
- Ops via `onOp(fn)` (the only shapes): `{k:'pub', n, p, rail, v, by}` (`by` = `'dev:gaze.hit'` / `'mod:ball.out'`; a carried message is pass 0 of the next step), `{k:'dock'|'undock', n, owner, port, rail, reason?}`, `{k:'reload', n, mod, ver}`, `{k:'quarantine', n, mod, error}`; `onStep(fn)` with `{n, t}`.
- Modules, basic: `addModule(id, source) -> {ok, error?}` compiles (Task 1), runs setup (ports, `state`, handlers, `draw`, `random`, `log`) and registers the ports; read model `modules: Map id -> {id, source, ports, draw, logs, calls}`. Reload, quarantine, versions and persistence are Task 2b.

- [ ] **Step 1: Failing tests:** state rail: late dock receives the retained value with `retained:true`; undocking the publisher keeps the value, `stale`; two publishers in a step → last wins, `contested`; coalescing (subscriber called once per pass). Event rail: ordered, exactly once, late dock gets nothing. Dock refusals carry reasons. Docking an output with a value publishes it. Re-docking moves. Ops made while paused apply on the first step after `resume()`; two ops in one step apply in order. A module feeding its own input runs 8 hops a step and carries the rest. `t === n * DT`. Swapping the publisher of rail `target` (two devices of type vec3) leaves a subscriber's state untouched and its value follows the new publisher.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS.

### Task 2b: Module lifecycle, persistence, demo modules

**Files:** Modify `js/scenes/rails/bus.js`. Create `js/scenes/rails/templates.js`, `js/scenes/rails/modules/{oscillator,ball,flowers,constant}.js`. Test `tests/rails.test.cjs` (append).

**Interfaces — produces:**
- `Bus`: `addModule(id, source) -> {ok, error?}` and `reload(id, source, {resetState} = {}) -> {ok, error?}` compile and run setup in a trial at once (result real), refused while paused with reason `'paused: Mod+Enter runs a ghost, Mod+P resumes'`, swapped in at the start of the next step; `revert(id)`; `removeModule(id)`; `renameModule(id, to)`; inputs named `time` with type `time` auto-dock to `clock`; quarantine on handler error / bad publish / runaway (> 2000 calls), state restored from the step checkpoint, outputs keep values marked stale; `editError` when a reload fails (old version keeps running); last 10 good sources; reload reconciles docks by name/dir/kind/type and drops the rest with op `undock` reason `'orphaned'` and a notice; `notices: [{id, n, text}]` (last 8); `modules: Map id -> {id, ver, source, status, error, editError, ports, draw, logs (last 50), calls (handler invocations), rev}` where `rev` grows when ver, status, error, editError, ports, draw or logs change; `stage(id, source)`, `commit(id)` (stage keeps a compiled candidate; commit = reload with it).
- Persistence: `layout() -> {rails: {id: {kind, type}}, modules: {id: source}, docks: [[owner, port, rail]]}`, `restore(layout)`; `snapshot() -> {n, t, rails: {id: {kind, type, value, by, seq, stale, contested, writers}}, modules: {id: {ver, state, rng, status}}, docks, devices}`; `restoreSnapshot(snap, layout)` into a fresh Bus (setup runs again, `set`/`emit` during that setup ignored, state filled from the snapshot, rng restored).
- `templates.js`: `skeleton(name) -> string` (time input, state output `out`, a `draw` call, comments).
- Demo modules (stage coordinates, metres on the 0.40 m mat): **oscillator** (time in, `target` state vec3 out: `[Math.sin(S.phase) * .15, 0, Math.cos(S.phase * .7) * .12]`, phase += dt · 0.8); **ball** (time + `target` in; eased chase `k = 1 − exp(−6 dt)` from `[0, .015, 0]`; sphere `s: .015`, `#ffb000`); **flowers** (time + `target` in, `planted` event num out; a flower every 0.5 s at the target, `random()` colour from 3, ≤ 40 kept, sphere `s: .02 * min(1, (t − born) / 1.5)`); **constant** (`target` out `[0, 0, 0]`, set once on time 0). Sources follow `.superpowers/hw9/draft-runtime.md` §1 with these coordinates.

- [ ] **Step 1: Failing tests:** a throwing handler quarantines, its state equals the checkpoint, its outputs are stale, others continue; a fixed reload recovers with migrated state; a reload with a syntax error keeps the old version and sets `editError`; `revert` restores the previous source; renaming a docked port or changing its kind drops that dock with a notice, keeps the others, never throws; `Date.now()` in a handler quarantines with the teaching message; a publisher without bound is quarantined as runaway while others step; two buses with the same seed give the same `random()`; `addModule`/`reload` while paused are refused with the reason; `layout()`/`restore()` round-trip; `snapshot()` + `restoreSnapshot()` into a fresh Bus mid-run, then 100 steps equal the original's; the four demo modules compile and run (ball follows oscillator; flowers emit `planted`).
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS.

### Task 3: Recorder and tape scrub

**Files:** Create `js/scenes/rails/recorder.js`, `js/scenes/rails/replay.js`. Test `tests/rails.test.cjs` (append).

**Interfaces — consumes** Task 2 (`onOp`, `onStep`, `snapshot`). **Produces:** `class Recorder { constructor(bus, {window = 30, maxOps = 100000}); range() -> {t0, t1, frames, dropped}; segments; opsBetween(t0, t1) }` (segments `{snap, frames: [{n, t, ops}]}`, one per second; trimming drops whole segments; the op cap shrinks the window); `replay.js`: `railsAt(recorder, t) -> {railId: {value, by, seq, recent: [{t, v, by}] (≤ 8 up to t)}}`, `density(recorder, bins = 60) -> number[]`.

- [ ] **Step 1: Failing tests:** the window never exceeds 30 s; the op cap shrinks it; `railsAt` gives the last state value ≤ t and the events before t; `density` sums to the logged deliveries; pausing logs nothing and resuming continues `n` without a gap.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS.

### Task 4: Text buffer, keymap, command line

**Files:** Create `js/scenes/rails/textBuffer.js`, `js/scenes/rails/keymap.js`, `js/scenes/rails/commands.js`. Test `tests/rails-ui.test.cjs` (new).

**Interfaces — produces:**
- `class TextBuffer { constructor(text = ''); text; row; col; scroll; lines; dirty; apply(op, now) -> changed }`; ops `insert {text}`, `newline` (keeps indent), `tab` (2 spaces), `backspace`, `delete`, `move {dir: left|right|up|down|home|end|pageup|pagedown}`, `deleteLineStart`, `undo`, `redo`, `scroll {lines}`, `set {text}` (clears dirty); undo snapshots on 800 ms idle, newline, or insert↔delete switch; arrows never snapshot; cursor valid; `scroll` keeps it in 12 visible lines.
- `isMac(platform)`; `mapKey(ev, {mac}) -> {edit: op} | {cmd: 'run'|'adopt'|'pause'|'play'|'recentre'|'escape'} | null`, `ev = {d, key, code, mods: {c, a, s, m}, rep}`; Mod+Z/Shift+Z map to edit `undo`/`redo`; never Mod+W/T/N/Q/R, F5, F11, F12; modifier-only keys and unnamed multi-char keys → null; commands ignore `rep`.
- `parseCommand(line) -> {op, ...} | {error}`: `card <name>` → `addModule`; `rail <name> [state|event] [type]` → `addRail` (defaults `state`, `any`); `rm`; `rename <name>`; `kind state|event`; `undock`; `undo`; `reset`; `revert`; `pause`; `live` (resume); `play`.

- [ ] **Step 1: Failing tests:** typing, indent on Enter, Backspace joining lines, arrow clamps, Home/End, Tab, undo/redo round trip, a 4 KB paste, 1000 random ops keep the cursor valid; `mapKey` Mac: Cmd+Enter → run, Cmd+Shift+Enter → adopt, Ctrl+Enter → null; Windows: Ctrl+Enter → run, Meta+Enter → null; Mod+W → null; Shift alone → null; repeated `a` inserts; repeated Mod+Enter → null; `parseCommand('rail target event vec3')`, `('rail Target')` → error, `('card')` → error, `('fly')` → error, `('revert')`.
- [ ] **Step 2:** `node tests/rails-ui.test.cjs` — FAIL. **Step 3:** Implement. **Step 4:** PASS.

### Task 5: Spatial logic

**Files:** Create `js/scenes/rails/layout.js`, `js/scenes/rails/gazeFocus.js`, `js/scenes/rails/grab.js`, `js/scenes/rails/timeline.js`. Test `tests/rails-ui.test.cjs` (append).

**Interfaces — produces** (model frame, metres, radians unless stated):
- `layout.js`: `RADIUS`, `SLOTS` (degrees), `CARD = {w, h, px, cols, rows}`, `LANES`, `LENS = {radius: 1.0, y: -.50}`; `workspace(head) -> {origin, yaw, eyeY}`; `yawPitchOf(ws, ray) -> {yaw, pitch, height} | null`; `cardRect(slot)`; `hitCard(ws, ray, slots /* occupied */, focused) -> slot|null` (focused enlarged 4°); `pinCell(index, dir) -> {x, y}` (card-local); `pinWorld(ws, slot, index, dir) -> [x, y, z]`; `pinAt(ws, ray, slot, ports /* [{name, dir, rail}] */) -> {port, dir, docked} | null` (footer strip ± 3°, nearest by yaw; agrees with `pinCell`); `laneAt(height, current) -> lane|null` (± 0.6 pitch, 0.9° hysteresis); `cell(col, row) -> {x, y}`; `stageFrame(ws, deskY) -> mat16`; `deskHit(ray, stage) -> [x, 0, z] | null` (off the mat → null).
- `gazeFocus.js`: `stepFocus(st, {t, hit, lastTextKeyT}) -> {focus, charging: {slot, p}|null, ...}` (state may carry `candidate`, `since`).
- `grab.js`: `stepGrab(st, {t, press, release, pin, lane, escape}) -> {st, action: null | {dock: {port, lane}} | {undock: {port}} | {cancel: true}}`.
- `timeline.js`: `scrub(playhead, dx, range) -> t`.

- [ ] **Step 1: Failing tests** (fake clock): a straight ray hits slot 2; 3° outside the focused card still hits it, not an unfocused one; dwell 0.34 s no switch, 0.36 s switch; gaze on nothing keeps focus; within 1 s of a text key no switch; `pinAt` nearest pin and agrees with `pinCell`; `docked` reported; `laneAt` hysteresis; `deskHit` null off the mat, right coordinates on it; `stageFrame` ignores later head motion; `stepGrab` press on pin → grabbing, release on lane → dock, release on nothing (docked) → undock, escape → cancel; `scrub` clamps.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS.

### Task 6: Wire, link, store, report

**Files:** Create `js/scenes/rails/wire.js`, `link.js`, `store.js`, `report.js`. Test `tests/rails-link.test.cjs` (new; fake queue delivering `(msg, sender)` with random batching; fake clock).

**Interfaces — produces** (this task is the single source of truth for message shapes):
- Envelope `{type, from, epoch, seq, t}` (`t` = sender `now()` ms). Types: `hello {role, rank, caps: {mac}, echo?: {seq, t}}`; `in {ev}` with `ev` = `{k:'key', d, key (≤ 16), code, mods: {c,a,s,m}, rep}` | `{k:'paste', text (≤ 4096)}` | `{k:'wheel', dx, dy}` | `{k:'btn', d}` | `{k:'blur'}`; `dev {id, port, value}`; `ack {cmd, ok, reason?}`; `cmd {id, op, ...}` with the op/field table of Task 7a (names by regex, `source` ≤ 65536, numbers finite, no path field); `snap` (top-level types checked; total JSON ≤ 256 KB).
- `wire.js`: `valid(msg) -> bool`, `copy(msg)`.
- `link.js`: `class Link { constructor({id, clients, send, now, rank, forced, caps}); role; peer; live; receive(msg, sender); tick(); sendIn/sendSnap/sendAck/sendDev/sendCmd; on(type, fn) }`; `rankOf({xr, ua}) -> 2|1` (2 for XR or `/OculusBrowser|Quest/`); roles: `forced` wins even alone; alone otherwise `'both'`; with a live peer the higher rank is `'ide'`, the lower `'runtime'`, ties → lower id is runtime; emits `on('role', role)` on change, `on('pair', peer)` when a peer is accepted or re-accepted (new epoch), `on('release')` on peer silence > 3 s or `{k:'blur'}`; pairing as HW8 `js/scenes/doorways/net.js`; duplicates and old `seq` dropped; staleness `off = min(now − t)`, an `in` with `(now − t) − off > 2000` dropped; RTT from `hello.echo`.
- `store.js`: `createStore({fetch}) -> {saveModule(name, source), saveLayout(obj), loadModule(name) -> source|null, loadLayout() -> obj|null, stats}`; POST JSON `{path, contents}` to `/api/saveScene`; paths only `js/scenes/rails/modules/<name>.js` and `js/scenes/rails/data/layout.js`; layout text `export default ${JSON.stringify(obj, null, 1)};\n`, read back by fetching the text (cache-busted, no-store), stripping the prefix and `;`, `JSON.parse`; name and size checks; one write in flight per path, latest content wins; one retry.
- `report.js`: `reportOf(s)` copies exactly the spec §4 field names, clamps strings to 200 chars, drops everything else.

- [ ] **Step 1: Failing tests:** `valid` accepts each good message and rejects mutations (unknown type, missing epoch, `op:'eval'`, `key` 17 chars, NaN, a `path` field on `cmd`, a 300 KB `snap`); a desktop and an XR-rank link become runtime/ide; `forced:'ide'` alone stays ide; a third client's hello/in/cmd ignored; reload re-accepted with `pair` fired; 200 `in` events through random batching arrive once, in order; a 2.5 s stall drops the old `in`; silence 3 s → `release`; `store` refuses `../x`, `Abc`, a 33-char name, 70 KB; two quick saves → one at a time, last wins; layout text round-trips; `reportOf` never contains key text.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS.

### Task 7a: Runtime (pure)

**Files:** Create `js/scenes/rails/runtime.js`. Test `tests/rails-link.test.cjs` (append).

**Interfaces — consumes** Tasks 2, 3, 6. **Produces:** `class Runtime { constructor({seed}); bus; recorder; load({layout, sources}); layoutFile() -> {cards: {id: {slot}}, rails: {id: {kind, type, lane}}, docks}; handle(cmd) -> {cmd: id, ok, reason?}; setDevice(id, port, value); snapshot() -> snap; full(); step(); notices }`.
- Devices at start: `gaze` (`hit` state vec3, `on` state bool), `pointer` (`pos` state vec3, `down` state bool). Device values are ignored while paused.
- Commands (`cmd.op` and fields): `commit {module, source}`, `addModule {module, source?}` (default `skeleton(module)`), `rmModule {module}`, `renameModule {module, to}`, `reset {module}`, `revert {module}`, `dock {owner, port, rail}`, `undock {owner, port}`, `addRail {rail, kind, type?}`, `rmRail {rail}`, `renameRail {rail, to}`, `kind {rail, kind}`, `pause`, `resume`, `seek {t}`, `play`, `stop`, `geometry {cards: {id: {slot}}, rails: {id: {lane}}}`, and (Task 12) `ghost {module, source}`, `adopt {module}` — refused here with reason `'not yet'`. A card's module with a missing source loads the skeleton.
- Snapshot `{rev, t, paused, playhead, window: [t0, t1], density, rails: {id: {kind, type, value, stale, contested, seq, tail, pubs, subs}} (seq newer than sent, all every 2 s), modules: {id: {ver, status, error, editError, ports, draw, logs, calls, source?}} (rev newer than sent; `source` only when `ver` is newer than sent), geometry, notices, ghost: null}`; numbers in draw lists rounded to 4 decimals; `full()` resets what was sent. While paused or after `seek`, rail values come from `railsAt` at the playhead; `play` advances the playhead at 1× to the window end.

- [ ] **Step 1: Failing tests:** `addModule` without source uses the skeleton; `commit` with a syntax error acks `ok:false`, `reason` = the message (no line), old version kept; a refused dock acks the reason; `pause` + `seek(t)` → snapshot rails equal `railsAt(t)`; device values while paused are ignored; snapshots carry only changed modules and the source only on a new ver; `full()` resends everything; a `gaze.hit` value reaches a module docked to its rail; `load` + `layoutFile` round-trip.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS.

### Task 7b: Worker and runtime host

**Files:** Create `js/scenes/rails/worker.js`, `js/scenes/rails/runtimeHost.js`. Test `tests/rails-link.test.cjs` (append; a fake Worker and clock injected).

**Interfaces — produces:**
- `worker.js`: messages in: `{type:'init', seed, layout, sources, snapshot|null, hung: [id]}` (restore from `snapshot`+`layout` or from layout+sources; each `hung` id is quarantined with error `{phase:'handler', message:'hung (infinite loop?)'}` running its last good source, never calling setup of the hanging one; a module with no earlier version is left out with a notice), `{type:'cmd', cmd}`, `{type:'dev', id, port, value}`, `{type:'full'}`. Out: `{type:'ack'}`, `{type:'beat', n, paused}` on **every timer tick** (~60 Hz, paused or not), `{type:'snap', snap}` every second tick, `{type:'snapshot', snap, layout}` once a second. Steps with `setInterval`, catching up at most 4 steps.
- `runtimeHost.js`: `createRuntimeHost({link, store, now, makeWorker = () => new Worker(new URL('./worker.js', import.meta.url), {type:'module'})}) -> {start(), feedPointer(pos), stats, setActive(bool)}`: `start()` loads layout and sources via `store`; relays `cmd`/`dev` from the link and `snap`/`ack` to it; on `pair` sends the Worker `full`; merges `pointer.pos` (from `feedPointer`) and `pointer.down` (from the IDE's `dev`); keeps `lastGood` per module and the commit in flight; saves a committed source only after two beats following its ack, and the layout (`layoutFile`) 1 s after structure changes; the watchdog starts after the first beat (5 s grace), and after 500 ms without a beat terminates and restarts the Worker with the last snapshot and `hung: [the module of the commit in flight, else the most recently committed]`; more than 3 restarts in 10 s: stop restarting, restart once with every module quarantined; the restart and its reason appear in the next snap's notices.

- [ ] **Step 1: Failing tests (fake Worker):** silence 500 ms after a beat → restart with snapshot and `hung`; no restart before the first beat; a paused Worker that keeps beating is not restarted; a commit followed by silence is never saved; a commit followed by two beats is saved once; 4 hangs in 10 s stop the loop; `pair` sends `full`; pointer pos and down merge into one value.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS.

### Task 8: Laptop terminal and scene shell

**Files:** Create `js/scenes/rails/terminal.js`, `js/scenes/rails.js`, `js/scenes/rails/ide.js` (stub: `export const createIde = () => ({frame() {}, setActive() {}, debug: {}})`, replaced in Task 9c), empty dirs via files `js/scenes/rails/data/layout.js` (`export default {"cards":{},"rails":{},"docks":[]};`). Modify `js/scenes/scenes.js`, `.gitignore` (`railsLink.json`).

**Interfaces — produces:**
- `createTerminal({listen, sendIn, onPointer, mac, active: () => bool}) -> {status(view), dispose()}`: capture-phase `window` listeners (keydown, keyup, paste, wheel non-passive, mousemove, mousedown/up, blur), only while `active()`; `preventDefault` + `stopImmediatePropagation` for forwarded keys (never Mod+W/T/N/Q/R, F5, F11, F12, typing in INPUT/TEXTAREA); keys → `in` `key`, paste → `paste`, wheel → `wheel`, mousedown/up → `btn`, blur → `blur`; pointer position normalised to the window → `onPointer`; sets `window.keydown`/`window.keyup` to the same path (course `interactMode 4`); a DOM HUD: link state, role, focused card, last 5 keys, the platform keymap, "keep this window visible".
- `rails.js`: `init`/`deinit`; `?railsRole`; `Link` on `railsLink` (`server.init('railsLink', {}, {accumulate: true})`, `server.sync` each frame as `js/scenes/doorways/pair.js`); creates both parts at load and switches them with `setActive` on `role` changes (an inactive runtime terminates its Worker and stops saving; an active one loads committed files; the IDE keeps its buffers and refills from the first full snap); role `both` connects IDE and runtime host with an in-page loopback (no server); `window.railsDebug`; `/log` every 5 s via `reportOf`; `deinit` releases listeners, Worker and textures.

- [ ] **Step 1:** Implement; verified by Task 9a.

### Task 9a: Browser harness and smoke test

**Files:** Create `tests/rails-browser.test.cjs` (routed relay as `tests/doorways-browser.test.cjs`; routes serving `**/js/scenes/rails/data/layout.js*` and `**/js/scenes/rails/modules/*.js*` from a test-local map; `**/api/saveScene` recorded and fulfilled without writing; `**/log` recorded).

- [ ] **Step 1: Test:** pages `?railsRole=runtime` and `?railsRole=ide` load `rails` with no page errors and pair (`railsDebug.role`); a third page (or raw `server.send` from a third client id) sends hello, `in` keys and `cmd addRail` → runtime rails and IDE state unchanged; a single page `?railsRole=both` loads with no `railsLink` traffic; `new Set(window.txtrChannel).size` grows by ≤ 7 after load and returns after leaving the scene; `/log` lines parse with `role`.
- [ ] **Step 2:** Run (safety rules) — PASS (fix Task 8 if not).

### Task 9b: Cards and stage

**Files:** Create `js/scenes/rails/cards.js`, `js/scenes/rails/stage.js`, `js/scenes/rails/glyphs.js` (line-font text: `drawText(node, text, {x, y, size, color})`).

**Interfaces — produces:** `createCard(node, {owned}) -> {update({buffer, status, error, editError, ports, focused, charging, pending, echo, notice, command}), dispose()}`: one 640 px canvas per card (header, code with `context.fillText` and a fixed advance, footer pins/error, echo or command line), uploaded at creation, redrawn only on change (counter trick as `js/scenes/doorways/panel.js`); cursor, focus frame, charge ring, error bar as quads; pins at `pinCell`. `createStage(node) -> {update(stageMatrix, drawLists, ghostDraw)}`: mat outline; `sphere|box|line` as Clay primitives, `text` via `glyphs.js`; ghost shapes translucent.

- [ ] **Step 1:** Implement; checked through Task 9c's test (visible state via `railsDebug.cards`).

### Task 9c: The IDE

**Files:** Replace `js/scenes/rails/ide.js`. Test `tests/rails-browser.test.cjs` (append).

**Interfaces — produces:** `createIde({model, link, owned}) -> {frame(head, hands, views), setActive(bool), debug}`: buffers per card; `mac = link.peer?.caps?.mac ?? isMac(navigator.platform)`; `in` → `mapKey` → buffer or command; `run` sends `cmd commit` with the buffer; pending until `ack`; snaps applied (last two kept; draw lists interpolated); a new `ver` replaces a clean buffer, a dirty one is kept and marked "run changed under you"; a new card takes its source from the first snap; `held = {buttons, keys}` cleared on `blur`/`release` (an active grab cancels); gaze → `stepFocus`, `deskHit` → `dev gaze.hit` (≤ 60 Hz) and `gaze.on`; `btn` → `stepGrab` when on a pin, else `dev pointer.down`; X on the left controller sets the desk height; "keyboard lost focus" shown on blur.

- [ ] **Step 1: Failing tests:** `railsDebug.setFocus(slot)` + 200 typed characters on the runtime page → that buffer equals them, others unchanged; Mod+Enter → runtime source equals the text and the intercepted save body has the module path and text (after two beats); a runtime page with `caps.mac = true`: Meta+Enter commits, Ctrl+Enter does nothing; a syntax error turns that card `error` while another module's `calls` keep rising; a committed `while (true) {}` → within 3 s the Worker restarts, the module is quarantined `hung`, others' `calls` rise again, and no save request carries that source; btn down then blur → `held` empty, grab cancelled; a key 3 s old after a stall is dropped.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS; Node suites PASS.

### Task 10a: Rails, docking, device cards

**Files:** Create `js/scenes/rails/rails3d.js`. Modify `js/scenes/rails/ide.js`. Test `tests/rails-browser.test.cjs` (append).

**Interfaces — produces:** `createRails(node) -> {update(ws, rails, docks, pending, ghost, t)}`: arcs per lane; state tag via `glyphs.js` (≤ 28 chars), flash on change, amber when stale; event beads from publisher to subscribers (1 m/s, ≤ 60); plumb wires from `pinWorld`, dashed while pending; refusals via `compatible` shown before release; device cards `gaze`, `pointer` at yaw ±42° (line font, output pins on top); notices under the focused card's footer for 5 s.

- [ ] **Step 1: Failing tests:** a simulated grab (via `railsDebug`) docks a port: the runtime dock exists and the IDE draws it solid after the ack; a kind-mismatch dock is refused before release with the reason; a subscriber docked late to a state rail gets the retained value; a reload with a renamed port shows the notice and other docks stay; a btn press on a pin does not set `pointer.down`, elsewhere it does; a head ray set via `railsDebug` onto the mat reaches a module docked to `gaze.hit`.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS.

### Task 10b: Timeline, pause and scrub, command line, lens

**Files:** Create `js/scenes/rails/timelineView.js`, `js/scenes/rails/lens.js`. Modify `js/scenes/rails/ide.js`. Test `tests/rails-browser.test.cjs` (append).

**Interfaces — produces:** `createTimeline(node, {owned}) -> {update({window, playhead, paused, density, ghost})}` (one canvas); `createLens(node, {owned}) -> {update(rail|null, pos)}` (one canvas, at `LENS`, after 250 ms gaze on a rail, closes 1.2 s after gaze leaves); Mod+P pause/resume, wheel-x scrub while paused, Mod+. play; Esc command line in the focused card's echo line with `parseCommand`; targets: the rail gazed at in the last 1 s if the lens is open, else the focused card; `rm` twice within 3 s; `undo` re-creates the last removed card or rail with its docks; full slots or 4 user rails → notice, no command.

- [ ] **Step 1: Failing tests:** Mod+P → runtime paused; wheel-x moves the playhead and snap rail values equal `railsAt` there; Mod+P again resumes; `rail extra event` creates a rail; `rm` twice removes it; `undo` restores it with its docks; a sixth `card` gives a notice.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS.

### Task 11: Demo layout and the as-built doc

**Files:** Modify `js/scenes/rails/data/layout.js` (cards oscillator, ball, flowers, constant in slots 0–3; rails `target` state vec3, `planted` event num, `clock`; docks for the demo). Modify `doc/hw9-design.md` (an "As built" section). Test `tests/rails.test.cjs` (append: every module in `modules/` compiles in a Bus; `oscillator.target`, `constant.target`, `gaze.hit` and `pointer.pos` are all `vec3` state outputs, so swapping them cannot break `ball`).

- [ ] **Step 1:** Write layout, test, doc; run all Node suites and the browser test once. Note in the doc that `modules/` and `data/` must exist on the demo machine before a headset test (they do once committed).

### Task 12: Ghost run (cut first if time is short)

**Files:** Modify `js/scenes/rails/replay.js` (`makeGhost`), `runtime.js` (`ghost`, `adopt`; `resume` clears the ghost), `rails3d.js`, `timelineView.js`, `cards.js`, `ide.js` (Mod+Enter while paused = ghost, Mod+Shift+Enter = adopt). Test `tests/rails.test.cjs`, `tests/rails-browser.test.cjs`.

**Interfaces — produces:** `makeGhost(recorder, moduleId, source) -> {ok, error?, from, seek(t), rails, draw, compare() -> [{port, rail, first}], diverged}`: starts at the first segment whose `snap.modules[id].ver` equals the module's current ver (window start if unchanged; refuses with a reason if none); a private one-module Bus with state/rng migrated to the candidate's defaults, fed with other publishers' logged `pub` ops at their pass; outputs on ghost rails, draw to the ghost list; `diverged` reported only when the ghost source equals the live one; `seek` forward incremental, backward re-runs from `from`; a ghost that hangs is a Worker hang (restart notice says "ghost hung"). Snapshot `ghost: {module, from, rails, draw, compare, diverged}`. Visuals per spec §2.5.

- [ ] **Step 1: Failing tests:** the three demo modules plus a scripted gaze device for 600 steps with a dock, an undock and a reload of the ball 10 s into the window; ghost of the ball with unchanged source from `from` → all `first === null`, `diverged === null`; an edited constant → `first` at the first step it matters; a self-fed module ghosts; live rails/modules deep-equal before and after; browser: edit while paused → ghost data with `first`, Mod+Shift+Enter adopts and resumes, Mod+P discards.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS.
