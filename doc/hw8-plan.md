# Doorways Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A two-player scene, `doorways`, in which a full-scale giant arranges rooms on a table and a 1/12 mini walks through them to the treasure, each knowing half of what is needed.

**Architecture:** Pure modules (rules, generator, walking, session protocol) carry the logic and are tested in Node; Clay modules (rooms, board, symbols, panel) build the models; `doorways.js` glues input, roles, drawing and network. The giant's client owns room placement, the mini's client owns the mini and its progress; both share a seed and the table's frame.

**Tech Stack:** Plain ES modules in the browser (Clay, WebXR on Quest), the class server's message queue (`server.init / send / sync`), `clientState`; Node 18 tests via `tests/esm.cjs`; Playwright browser tests.

**Spec:** `doc/hw8-design.md` (read it first; this plan argues from it).

## Global Constraints

- Do not commit. The user commits; leave changes in the working tree.
- Scene name `doorways`; files under `js/scenes/doorways/` as listed in the spec's section 5.
- Do not change the behaviour of the `miniature` scene; reuse `js/scenes/miniature/{mapping,physics,rays,world,avatar,scanner,scanned,scandraw}.js` as they are (small, backwards-compatible additions only if unavoidable).
- Style as in `js/scenes/miniature/`: 3-space indent, semicolons, short functions, comments in full sentences saying why; no new dependencies.
- Table frame: origin at the middle of the table top, x along the table, y up, z towards the near side. Table metres throughout; `U = 1/12` turns avatar metres into table metres.
- Values from the spec: `CELL = .18`, grid 3 × 3, 7 rooms on the board, 2 empty cells, 1–2 depot rooms in slots `d0`, `d1`, entrance beside cell (0, 1) on its W side, symbols `moon star sun tree fish mountain`, colours `red blue`, chest penalty 20 s, snap radius 12 cm, peer timeout 3 s, hello 2 Hz, snapshots 20 Hz, held-room interpolation 100 ms behind.
- Run Node tests with `source ~/.nvm/nvm.sh && nvm use 18`. Browser tests need the server: if nothing answers on `http://localhost:2026/`, start `node server/main.js 2026 2026 http` in the background for the test and stop it afterwards. Playwright: `S=/tmp/claude-1000/-home-abelard-VR-2026-Fall/165e0e2b-7a5e-401e-bdf1-55e9b6b7a9ad/scratchpad; LD_LIBRARY_PATH=$(find $S/libs -type d | tr '\n' ':') NODE_PATH=$S/pw/node_modules`.
- The existing suites must keep passing: `tests/miniature.test.cjs` (34), `tests/echohunt.test.cjs` (16), `tests/miniature-browser.test.cjs`.

## Review Focus

- A peer that joins (or reloads) in the middle of a round adopts the round: the same seed, the giant's room placement and the mini's progress from the snapshots. Test in Task 6.
- Dragging the desktop mouse on empty space still turns the view; dragging on a room holds the room and does not. W/A/S/D/F walk and act for the mini without moving the desktop camera. Test in Task 5.
- A teleport aimed at a room the mini cannot reach is refused, and walking never leaves the floors (no walking across water to another room's doorway). Tests in Tasks 4 and 5.
- The mini standing in a room the giant lifts, turns and drops stays inside it, on both clients, through and after the snap. Tests in Tasks 5 and 7.
- Messages from a stale epoch, from a third client, or malformed, are ignored without errors. Test in Task 6.

---

### Task 1: Rules engine

**Files:**
- Create: `js/scenes/doorways/rules.js`
- Test: `tests/doorways.test.cjs` (new; same harness as `tests/miniature.test.cjs`: `load`, `check`, `near`)

**Interfaces:**
- Produces (all exported from `rules.js`, pure, no Clay):
  - Constants: `U = 1/12`, `CELL = .18`, `GRID = 3`, `SYMBOLS`, `COLOURS`, `CELLS = ['c0'..'c8']` (index `r*3+c`, r = 0 is the −z row), `DEPOT = ['d0','d1']`, `ENTRANCE = 'entrance'`, `ENTRANCE_CELL = 'c3'`, `PENALTY = 20`, `SNAP = .12`.
  - `ROOM = { FLOOR: .1*U, WALL: 2.6*U, T: .15*U, DOOR_W: 1*U, DOOR_H: 2.1*U }` and `SPOTS = { key, switch, chest }`, each `[x, z]` in the room's frame, three different corners at `±.3*CELL`.
  - Sides: 0 N (−z), 1 E (+x), 2 S (+z), 3 W (−x). `facing(side, rot) -> (side + rot) % 4`.
  - `slotCentre(slot) -> [x, 0, z]` in the table frame: cells at `x = (c−1)*CELL, z = (r−1)*CELL`; `d0` at `[.45, 0, −.1]`, `d1` at `[.45, 0, .1]`; `entrance` at `[−1.5*CELL − CELL/4, 0, 0]`.
  - `slotPose(slot, rot) -> mat16` (translate to the centre, turn `−rot * π/2` about y, so that local N turned once faces E).
  - `openings(room, rot) -> [bool × 4]` world sides with a doorway.
  - `neighbour(slot, side) -> slot | 'entrance' | null` (`c3` side 3 is `entrance`; depot slots have no neighbours).
  - `links(level, state) -> Map<id, Set<id>>` (rooms and `'entrance'`): an edge where both facing sides are open and neither doorway has a gate still locked (`gate` set and the room id not in `state.unlocked`). The entrance is open on its E side only.
  - `reachable(level, state) -> Set<id>` from `state.mini`.
  - `movable(level, state, id) -> bool` (not the entrance; `anchor` null or in `state.pressed`).
  - `snap(level, state, id, p, yaw) -> { slot, rot } | null`: the nearest free slot (cells and depot, not the room's own unless it is the nearest) within `SNAP` of `p` (table frame, xz distance), and `rot = round(−yaw / (π/2)) mod 4`.
  - `startState(level) -> state` and `apply(level, state, action) -> { state } | { error }` for the actions in the spec (`place`, `go`, `take`, `unlock`, `press`, `open`); `open` of a wrong chest adds `PENALTY` to `state.penalty`; `open` of the goal sets `state.won = true`.

- [ ] **Step 1: Write the failing tests** in `tests/doorways.test.cjs`, with a hand-made 3-room level fixture:

```js
await check('sides turn with the room, and cells neighbour across them', () => {
   assert.equal(R.facing(0, 1), 1);
   assert.deepEqual(R.openings({ doors: 0b0001 }, 1), [false, true, false, false]); // N door turned once faces E
   assert.equal(R.neighbour('c4', 0), 'c1'); assert.equal(R.neighbour('c3', 3), 'entrance'); assert.equal(R.neighbour('c0', 0), null);
   nearV(R.slotCentre('c0'), [-.18, 0, -.18]); nearV(R.slotCentre('entrance'), [-.315, 0, 0]);
});
await check('two rooms link only where both facing sides are open, and a locked gate cuts the link until unlocked', () => {
   // r0 at c3 (doors E|W), r1 at c4 (doors W): linked; r1 turned so its door faces N: not linked;
   // r1 with gate { side: 3, colour: 'red' }: not linked until state.unlocked includes 'r1'.
});
await check('the mini reaches only its connected rooms; the entrance opens east only', () => {
   // from 'entrance': reaches r0 at c3 (door W) and r1 linked to it, not r2 on its own;
   // a room at c3 with no W door: reachable is { 'entrance' } only.
});
await check('an anchored room is not movable until its colour is pressed; the entrance never is', () => {
   // anchor 'blue': movable false; state.pressed ['blue']: true; movable(level, state, 'entrance') false.
});
await check('snap: the nearest free slot within 12 cm and the nearest quarter turn; none near is null', () => {
   // released at slotCentre('c8') + [.05, 0, .02], yaw −1.4 -> { slot: 'c8', rot: 1 } (c8 free);
   // over an occupied cell -> the nearest free one if within .12, else null; far off the board -> null.
});
await check('actions: place, go, take, unlock, press, open; illegal ones return an error and leave the state', () => {
   // go to an unreachable room -> error; unlock without the key -> error; place an anchored room -> error;
   // open a wrong chest -> penalty 20; open the goal -> won.
});
```

- [ ] **Step 2: Run** `node tests/doorways.test.cjs` — expected: FAIL (`rules.js` not found).
- [ ] **Step 3: Implement `rules.js`** with the interfaces above. States are plain objects; `apply` returns a new state (copy, do not mutate).
- [ ] **Step 4: Run** `node tests/doorways.test.cjs` — expected: all checks pass.

### Task 2: Generator

**Files:**
- Create: `js/scenes/doorways/generate.js`
- Test: `tests/doorways.test.cjs` (append)

**Interfaces:**
- Consumes: everything in Task 1.
- Produces: `rng(seed) -> () => number in [0, 1)` (mulberry32); `generate(seed, options = {}) -> { level, plan, seed }` where `seed` is the one actually used (seed, seed+1, … up to 50 tries); `validate(level, plan) -> { ok, error }`. `options = { pathMin: 3, pathMax: 6, gates: 2, anchors: 1, turntable: .5, emptyChests: 2 }` (maxima; probabilities for `turntable`). Level shape exactly as in the spec's section 2; room ids `'r0'…`.

- [ ] **Step 1: Write the failing tests:**

```js
await check('the same seed makes the same level', () => assert.deepEqual(G.generate(7), G.generate(7)));
await check('1000 seeds: each level is valid, its plan wins, and the goal is not reachable at the start', () => {
   for (let s = 1; s <= 1000; s++) {
      const { level, plan } = G.generate(s);
      assert.ok(G.validate(level, plan).ok, 'seed ' + s);
      assert.ok(!R.reachable(level, R.startState(level)).has(level.goal));
      assert.equal(Object.keys(level.start).filter(k => level.start[k].slot.startsWith('c')).length, 7);
      assert.equal(new Set(Object.values(level.start).map(v => v.slot)).size, Object.keys(level.start).length);
      assert.equal(level.rooms.filter(r => r.symbol === level.goalSymbol).length, 1);
      assert.equal(level.rooms.filter(r => r.chest).length, 3);
   }
});
await check('across 200 seeds every mechanism appears: gates, anchors, turntables', () => {
   // count levels with a gate, with an anchor, and plans that place a room while the mini is in it: each > 20.
});
await check('validate rejects a plan with a step out of order', () => {
   // a seed with a gate: move its 'unlock' before its 'take' -> validate(...).ok === false with an error.
});
```

- [ ] **Step 2: Run** — expected FAIL.
- [ ] **Step 3: Implement** the spec's steps 1–6. Build the plan while building the level, in order: for each path room, the giant's `place` actions that put it right (and turn a turntable with the mini inside), then the mini's `go`, `take`, `unlock`, `press` as the mechanisms require, ending with `open` on the goal. A key or switch goes in a path room before the mechanism, or in a side room that the plan connects (with its own `place` steps) before it.
- [ ] **Step 4: Run** — expected PASS; the 1000-seed check under 10 s.

### Task 3: Room, board and symbol models

**Files:**
- Create: `js/scenes/doorways/rooms.js`, `js/scenes/doorways/board.js`, `js/scenes/doorways/symbols.js`
- Test: `tests/doorways.test.cjs` (append; fake nodes as in the house tests of `tests/miniature.test.cjs`)

**Interfaces:**
- Consumes: `rules.js` (`ROOM`, `SPOTS`, `CELL`, `U`, `slotCentre`).
- Produces:
  - `symbols.js`: `drawSymbol(g2, name, x, y, size)` (G2, simple shapes); `symbolTexture(node, name)` gives `node` the shared texture of that symbol (one canvas and one texture unit per symbol, made on first use: `setTxtr(canvas, true)` then `txtr(unit)` for the rest).
  - `rooms.js`: `createRoom(node, room) -> view` with `view.colliders(state) -> [{min, max}]` in the room's frame (floor slab top at `ROOM.FLOOR`; walls broken by doorways; a lintel above each doorway; the gate's box while locked); `view.floor -> {min, max}` (its footprint); `view.things(state) -> [{ what: 'key'|'switch'|'chest'|'gate', at: [x,y,z], size }]` in the room's frame (only what is there now: not a taken key, not an opened chest or unlocked gate); `view.update(state, { roofed })` (roof shown when `roofed`; gate swung open when unlocked; switch down when pressed; chest lid open when opened; stake of `anchor` colour on the roof while not pressed; the rug with the room's symbol on the floor). Also `choose(hand, things) -> what | null` (nearest within `.6*U` of `hand.p`, else the first `rayBox` hit within `2.5*U`, as `house.js` does).
  - `board.js`: `createBoard(node) -> { update(), entrance: { colliders, floor } }` (water plate under the 3 × 3, grid lines, depot pads, the entrance hall: a half-cell floor with walls on N, S, W and an open E side).

- [ ] **Step 1: Write the failing tests:** colliders of a room with doors N and E: a point in the middle of the N doorway at feet height is not blocked, the middle of the S wall is (use `physics.blocked`); a locked gate blocks its doorway until `state.unlocked` has the room; `things` lists a key until taken; the entrance is open only on E; `choose` prefers the nearest in reach, then the ray.
- [ ] **Step 2: Run** — expected FAIL.
- [ ] **Step 3: Implement.** Colours: walls cream, roofs dark red, gate and stake by colour (`red [.85,.2,.2]`, `blue [.2,.4,.9]`), gate grey on its outer face. The roof is one slab over the walls; from inside the mini sees its underside as the ceiling.
- [ ] **Step 4: Run** — expected PASS.

### Task 4: Walking among the rooms

**Files:**
- Create: `js/scenes/doorways/walk.js`
- Test: `tests/doorways.test.cjs` (append)

**Interfaces:**
- Consumes: `miniature/physics.js` (`move`, `blocked`, `RADIUS`), Task 1 and 3 shapes.
- Produces: `walk(boxes, floors, feet, dx, dz) -> { feet, blocked }`: as `physics.move`, and additionally the feet must end over one of `floors` (`[{min, max}]` footprints, table frame); a step that would leave every floor slides along the free axis or stays. `roomAt(rooms, p) -> id | 'entrance' | null`: the room (settled, by its slot's footprint) or the entrance under the point `p` (table frame); ties on a shared edge go to the lower slot index. `toTable(boxes, pose) -> boxes`: room-frame boxes taken to the table frame by a settled pose (quarter turns keep them boxes).

- [ ] **Step 1: Write the failing tests:** walking from one room into its linked neighbour through the doorways succeeds; walking out of a doorway that faces an empty cell stops at the floor's edge (`blocked`); walking into a wall slides along it; `roomAt` on the boundary picks the lower slot; `toTable` of a box turned a quarter swaps its x and z extents.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS.

### Task 5: The scene, solo

**Files:**
- Create: `js/scenes/doorways.js`, `js/scenes/doorways/input.js`, `js/scenes/doorways/panel.js`
- Modify: `js/scenes/scenes.js` (add `{ name: "doorways", path: "./doorways.js", public: true }` after `miniature`)
- Test: `tests/doorways-browser.test.cjs` (new; pattern of `tests/miniature-browser.test.cjs`)

**Interfaces:**
- Consumes: Tasks 1–4; `miniature/{mapping,rays,world,avatar,scanner,scanned,scandraw}.js` as `miniature.js` uses them (table from the scan or X, the room drawn in the mini's view, the flight between views).
- Produces:
  - `input.js`: `createInput({ listen, xr }) -> { frame(head, views) -> { hands: [{hand, m, ray, grip, gripPressed, trigger, pressed}], walk: {x, y}, turn: {x, y}, buttons: { switchRole, newRound, swap, calibrate }, mouse: { ray, down, pressed, released, rotate: -1|0|1 } | null } }`. The headset reads `controllerInput.js` as `miniature.js` does; the desktop reads keys (W/A/S/D walk, Q/E turn the mini or the held room, T held aims a teleport, G grip, F trigger, V switch role, N new round, M swap), catching these on `window` in the capture phase with `stopImmediatePropagation` on both keydown and keyup (the desktop viewer moves its camera on W/A/S/D/F/C from `document` listeners), only while not in XR and not typing in an input and the mouse (ray from the camera through the cursor, via `clay.views[0]` and the canvas size). A `mousedown` on the canvas whose ray hits a room is stopped in the capture phase (`window`, `true`, `stopPropagation`) along with the drag's `mousemove`s, so the view does not turn; elsewhere the event passes.
  - `panel.js`: `class Panel { constructor(model); update({ role, time, penalty, goalSymbol (giant only), keys (mini only), message, waiting }, pos, eye) }` (G2, `view('main')`, redrawn 10 times a second as `miniature/panel.js` does; the task card draws the symbol with `drawSymbol`).
  - `doorways.js`: `init(model, ctx, ctxForever)` / `deinit()` as `miniature.js`; one state `{ level, state, held: { id, m } | null, mini: { ref, local } }`; `window.doorwaysDebug = { get level(), get state(), get role(), roomPose(id), hold(id, m), release(), go(id), act(what), setRole(role), newRound(seed) }` for tests.

- [ ] **Step 1: Write the failing browser test** (one page, solo): the scene starts as giant with a level from a seed; `doorwaysDebug.hold` + `release` over a free cell moves a room there (state `at` changes); a drag with the mouse on a room moves it while the view matrix stays the same, and a drag on empty space changes the view matrix; V flies to the mini's view (`role === 'mini'`, world scaled 12); walking (W held) moves the mini, never off the floors, and does not move the desktop camera; F at a switch presses it and the stake goes; teleport at an unreachable room is refused; the mini in a room the giant holds and turns stays inside it after the snap; opening the goal chest shows the win; no page errors.
- [ ] **Step 2: Run** — FAIL (no scene).
- [ ] **Step 3: Implement.** Giant: grip (or mouse) holds a movable room by reach (`.03`) or ray (3 m), the room follows the hand, release snaps with `rules.snap` or returns; Q/E turn the held room a quarter. Mini: physics in the table frame with `walk` over the settled rooms' and the entrance's colliders and floors; while the mini's room is held, physics in that room's frame with its own colliders (as HW7's riding), drawn through the held pose; teleport onto a floor of a room in `rules.reachable`; `rooms.choose` on `view.things` for grip and trigger, then `rules.apply`. Roofs drawn in the giant's view only. Solo: V or A switches role with the HW7 flight; the client owns both parts.
- [ ] **Step 4: Run** the browser test — PASS; then the HW7 suites — PASS.

### Task 6: Session protocol

**Files:**
- Create: `js/scenes/doorways/net.js`
- Test: `tests/doorways.test.cjs` (append; a fake transport that delivers messages between two `Session`s with a controllable clock)

**Interfaces:**
- Produces: `class Session { constructor({ id: () => number, clients: () => number[], send: message => void, now: () => ms }) ; role ('solo'|'giant'|'mini'); seed; round (number); peer ({ id, role, xr, table, epoch, heard } | null); waiting (bool); latest = { giant: snapshot|null, mini: snapshot|null }; receive(message, sender); tick({ want, table, xr, giant: () => snapshot, mini: () => snapshot }); newRound(seed, giantId) }`. Messages `{ type: 'hello'|'giant'|'mini'|'round', from, epoch, round, ... }` as in the spec's table, deep-copied before sending. `lerpPose(a, b, f) -> mat16` (element lerp, columns 0–2 re-orthonormalised) and `class Interp { push(t, m); at(t) }` (100 ms behind).

- [ ] **Step 1: Write the failing tests:** alone → `solo`; two sessions → one `giant` one `mini`, and with the same `want` the higher id yields; `newRound` on one adopts the seed and roles on both; a session joining after a round started adopts its seed and round number from `hello`; snapshots land in `latest` only from the peer of the current epoch; a third client's, an old epoch's and malformed messages are ignored; silence for 3 s sets `waiting`; `Interp.at` lies between its neighbours.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS.

### Task 7: Two players

**Files:**
- Create: `js/scenes/doorways/bodies.js`
- Modify: `js/scenes/doorways.js`
- Test: `tests/doorways-browser.test.cjs` (append a two-page part, with the routed-socket relay of `tests/spellcode-coop-browser.test.cjs`)

**Interfaces:**
- Consumes: Tasks 5 and 6; `clientState.head(id)`, `clientState.hand(id, hand)`.
- Produces: `peerBody(peer, snapshotBody, clientState) -> { head, left, right } | null` in the table frame (`inv(peer.table) · clientState…` for an XR peer, the snapshot's body for a desktop one); the scene wired to `Session` on channel `'doorways'` (`server.init(channel, {}, { accumulate: true })`, `server.send`, `server.sync` each frame, as `spellcode.js` pumps it).

- [ ] **Step 1: Write the failing two-page test:** the pages become giant and mini with the same seed; a room released on the giant's page is in the new slot on the mini's; the switch pressed on the mini's page makes the anchored room movable on the giant's; the mini inside a room the giant holds (moving its matrix) is drawn inside it on the giant's page and is still inside after the release on the mini's; the goal chest opened on the mini's page shows the win on both; swap after the win exchanges the roles with a new seed; a page reloaded mid-round rejoins the same round.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** the spec's section 3: snapshots from the owner of each part, the other part applied from `latest`; the giant avatar (an `Avatar` at real size) on the mini's client from `peerBody`, a desktop giant's hand at its mouse grab point; the mini avatar on the giant's client as `T · pose(ref) · map · body`; the held room on the mini's client from `Interp`; rounds and swap through `newRound`; "waiting for your partner" on the panel while `waiting`.
- [ ] **Step 4: Run** — PASS; the Node suites and HW7 suites — PASS.

### Task 8: As built

**Files:**
- Modify: `doc/hw8-design.md` (an "As built" section: what differs from the plan and why), `js/scenes/doorways.js` header comment (controls, parts, design pointer as `miniature.js` has).

- [ ] **Step 1:** Run every suite: `node tests/doorways.test.cjs`, `node tests/miniature.test.cjs`, `node tests/echohunt.test.cjs`, both browser tests for doorways and miniature. All pass.
- [ ] **Step 2:** Write the section; list what only a headset can check (scan, alignment of the giant with the real person, comfort of riding, frame rate).
