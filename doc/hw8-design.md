# HW8: Doorways, a two-player miniature puzzle

The two-participant version of the HW7 miniature. One player is the
**giant**: at full scale, at the real table, able to lift and turn whole
rooms. The other is the **mini**: at 1/12 scale, walking through those
rooms, able to pick up keys, unlock gates and press switches. Neither can
finish alone, and each knows something the other does not.

Scene name `doorways`. It reuses the HW7 modules in `js/scenes/miniature/`
(mapping, physics, rays, world, avatar; the scan modules are not used, see "As built") and
leaves the single-player `miniature` scene unchanged.

## Decisions

| Question | Decision |
|---|---|
| Activity | Cooperative puzzle: the giant arranges rooms so that their doorways connect a path, the mini walks it |
| Devices | One headset and one desktop browser (two headsets also work); co-located, so the players talk directly |
| Roles | Either device can be either role; roles swap between rounds |
| Levels | Random, from a seed: generated solved, scrambled, then verified by replaying the intended solution |
| Moves | Rooms turn in 90° steps and move to free cells or depot slots |
| Information | Two-way: roofs hide the insides (symbols, locks, keys, switches) from the giant; only the giant's task card says which symbol marks the treasure room |
| Sync | Role ownership: the giant's client owns the rooms, the mini's client owns the mini and everything it has done |
| Shared frame | The table's frame (origin at the middle of the top, x along it, y up) |

## 1. Rules

### The board

- A 3 × 3 grid of cells, 18 cm each (2.16 m to the mini), centred on the
  table. Around and between the rooms is water: the mini can walk only on
  room floors and the entrance hall.
- A depot of 2 slots beside the board (at the +x end of the table) holds
  spare rooms.
- The entrance hall is a fixed half-cell at the −x side of the middle row,
  open towards cell (0, 1). The mini starts there. It cannot be moved.
- Each level has 7 rooms on the board (2 cells empty) and 1–2 in the depot.

### Rooms

- A room fills its cell: a floor, four walls 2.6 m high (to the mini) with
  doorways in the middle of 1–4 sides, and an opaque roof. Door patterns are
  pipe tiles: dead end (1), straight (2 opposite), corner (2 adjacent),
  T (3), cross (4).
- Inside, a room can hold:
  - a symbol painted on an inner wall, one of moon, star, sun, tree, fish,
    mountain;
  - a coloured key (red or blue);
  - a locked gate in one of its doorways, coloured on its inner face only
    (grey from outside);
  - a coloured switch (red or blue) on a wall;
  - a chest.
- An anchored room has a stake of the switch's colour standing out of its
  roof. The giant sees it and cannot lift that room until the mini has
  pressed the switch of that colour.

### Giant

- Grips any room that is not anchored (and not the entrance) and moves it
  freely in the hand. If the mini is inside, the mini rides with the room.
- On release, the room snaps to the nearest free cell or depot slot within
  12 cm of its centre and to the nearest 90° turn. If none is near, it goes
  back where it was.
- Sees the board from above: the doorways in the outer walls, the stakes,
  where the mini is. Cannot see inside: no lifting of roofs during a round.
- Has the task card on the wrist panel: "the treasure is in the ☾ room".

### Mini

- Walks (stick), turns (snap), teleports (aim with the right stick) only
  onto floors it can reach. Two rooms connect where both have doorways on
  the sides that face each other and no locked gate is in either.
- Grip on a key: takes it (carried on the panel, up to 2).
- Trigger at a gate with the key of its colour: unlocks it (it swings open,
  for good).
- Trigger at a switch: presses it, for good. The stake of its colour goes.
- Trigger at a chest: opens it. The chest in the room whose symbol is on the
  task card wins the round; any other is empty and costs 20 s.

### Round

- The clock counts up from the first move. Opening the right chest ends the
  round and shows the time (with penalties).
- After a round: either player can start a new round (new seed) or swap
  roles and start one. There is no losing.

## 2. Generation (`rules.js`, `generate.js`, both pure)

A level is a function of a seed. `generate(seed, options)` returns
`{ level, plan }` and is deterministic (a seeded mulberry32 RNG), so the two
clients need only share the seed.

### Data

```
level = {
  seed,
  rooms: [{ id, doors: 4-bit mask (N, E, S, W in the room's own frame),
            symbol, key: colour|null, switch: colour|null, chest: bool,
            gate: { side (own frame), colour }|null, anchor: colour|null }],
  goal: room id, goalSymbol,
  start: { [room id]: { slot, rot } },   // slot: 'c0'..'c8' (cell index r*3+c) or 'd0','d1'
}
state = { at: { [room id]: { slot, rot } },       // the giant's part
          mini: room id | 'entrance', keys: [colours],
          unlocked: [room ids], pressed: [colours], opened: [room ids], penalty }
```

Sides and turns: side `s` of a room turned `rot` quarter turns faces world
side `(s + rot) % 4`. Cell `(c, r)` neighbours `(c, r−1)` on N, and so on.

### Rules engine (`rules.js`)

Pure functions used by the generator, by both clients and by the tests:
`openings(room, rot)`, `neighbour(slot, side)`, `links(level, state)` (the
graph of connected rooms, the entrance included, gates respected),
`reachable(level, state)` (the rooms connected to the mini's room),
`movable(level, state, id)` (not anchored, or its switch pressed),
`snap(level, state, id, position, yaw)` (slot and rot for a release, or
null), and `apply(level, state, action)` returning the new state or an
error. Actions: `{ by: 'giant', place: id, slot, rot }`, `{ by: 'mini', go: id }`,
`take`, `unlock`, `press`, `open`.

### Generator (`generate.js`)

1. A random simple path of 3–6 cells from cell (0, 1) (beside the entrance)
   to the goal cell.
2. Rooms on it get door patterns containing the path's connections, plus
   random extra doors; the other cells get random rooms; 2 cells stay
   empty; the depot gets 1–2 rooms.
3. Mechanisms placed along the path, each after what unlocks it:
   - up to 2 gates on path doorways, their keys in rooms the mini reaches
     before the gate (side dead ends included);
   - up to 1 anchor on a path room that must turn or move, its switch in a
     room reached earlier;
   - sometimes a turntable: a dead-end room on the path that the giant must
     turn with the mini inside to connect it on to the next room.
4. The goal room gets the treasure chest and a symbol no other room has; 2
   other rooms get empty chests; every room gets a symbol.
5. Scramble: turn the movable rooms at random, swap some path rooms with
   empty cells or depot slots.
6. The intended solution is recorded as a plan (alternating giant and mini
   actions) while building.

`validate(level, plan)` replays the plan through the rules engine from the
start state and requires that it is legal and ends with the goal chest
open, and that at the start the goal room is not reachable. A failing seed
is replaced by `seed + 1` (up to 50 tries). Options set the path length,
gates (0–2), anchors (0–1), turntable, and empty chests.

## 3. Network and frames

### Shared frame

Everything shared is in the table's frame. The headset's table is the
X-calibrated real table (left controller laid flat on it, X); until then, and
on the desktop, it is the World default table. So the giant appears to the mini where the headset player really
stands at the real table.

### Bodies

- A peer in XR: its head and hands come from `clientState.head(id)` and
  `clientState.hand(id, hand)` (in the peer's model frame) and its table
  matrix, sent in its presence messages, takes them to the table frame.
- A desktop peer has no head in clientState: it sends its camera (and, as
  giant, a hand at the mouse's grab point) in its snapshots, in the table frame.
- The mini avatar: the mini's client sends `map`, the matrix that takes its
  real body (model frame) to its avatar, relative to `ref`: the room it
  stands in (in that room's frame) or the table. The giant draws the avatar
  as `T · pose(ref) · map · body`, so an avatar riding a room the giant holds
  stays in it, whatever the latency.

### Messages

On a channel of its own (`server.init / send / sync`, as Spellcode does),
whole snapshots, so a lost one does no harm:

| Type | From | Rate | Contents |
|---|---|---|---|
| `hello` | both | 2 Hz | role, epoch, seed, table matrix, xr |
| `giant` | giant | 20 Hz | seq, `at` (slot and rot of every settled room), held room id and matrix (table frame), desktop body |
| `mini` | mini | 20 Hz | seq, ref and map, keys, unlocked, pressed, opened, penalty, round time, desktop body |
| `round` | either | on event | new seed, roles (a swap is a new round with the roles exchanged) |

- The giant's client applies its own moves at once and is the only writer of
  `at`; the mini's client is the only writer of the rest. Rules that cross
  over (anchors depend on `pressed`) are evaluated by each client from the
  latest of both.
- The mini's client interpolates the held room's matrix (100 ms behind)
  for its physics and drawing.
- Roles: a client joining takes the free role; if both claim one, the higher
  clientID yields. Alone, a client is solo: A switches roles and views as
  in HW7, and it owns both parts. A peer silent for 3 s is gone: the panel
  says "waiting for your partner" and the local state is kept.

## 4. Controls

| | Giant | Mini |
|---|---|---|
| Headset | grip: hold a room (in reach or by ray); release: snap | left stick: walk; right stick: snap turn / aim teleport; grip: take a key; trigger: gate, switch, chest |
| Desktop | left-drag on a room: hold it (drag elsewhere still turns the view); Q / E: turn it 90°; release: snap | W/A/S/D: walk; Q / E: turn; T (held): aim a teleport; G: take; F: use |
| Both | A (desktop V): switch role (solo only); B (desktop N): new round after a win; Y (desktop M): swap roles after a win; X: calibrate the table (headset) |

The desktop viewer moves its camera with W/A/S/D, F, C and the arrows (it
listens on `document`). While this scene runs on the desktop, the keys it uses
are caught on `window` in the capture phase and stopped, both down and up, so
the camera does not move with the mini.

The wrist panel (desktop: low in front) shows the role, the round time, and
for the giant the task card, for the mini the keys carried and what is in
reach. In this scene the panel shows no live picture (it would show the
giant the insides).

## 5. Code

```
js/scenes/doorways.js            the scene: input, roles, drawing, glue
js/scenes/doorways/rules.js      pure: data, sides, links, reachability, snapping, actions
js/scenes/doorways/generate.js   pure: seeded generator, plan, validate
js/scenes/doorways/rooms.js      Clay: a room's model and colliders, from its data and state
js/scenes/doorways/board.js      Clay: water, grid, depot pads, entrance hall; slot positions
js/scenes/doorways/symbols.js    G2 canvases of the six symbols (one texture each, shared)
js/scenes/doorways/net.js        Session: presence, roles, snapshots, rounds, timeouts (transport injected)
js/scenes/doorways/bodies.js     peers' heads and hands in the table frame
js/scenes/doorways/input.js      desktop mouse ray and keys; headset buttons and sticks
js/scenes/doorways/panel.js      wrist panel: task card, keys, time, messages
```

The mini's physics reuses `miniature/physics.js`: the colliders of the rooms
are taken into the table frame (a settled room is turned by a multiple of
90°, so its boxes stay boxes), plus a rule that the feet must stay over a
floor. The mini riding a held room moves in that room's frame, as in HW7.

## 6. Testing

- `tests/doorways.test.cjs` (Node): sides and turns, links and gates,
  snapping, actions and their errors, 1000 seeds generated and validated,
  determinism, the session protocol with a fake transport (roles, the
  higher id yielding, swap, timeouts, applying snapshots), the avatar's
  `ref · map` composition.
- `tests/doorways-browser.test.cjs` (Playwright, two pages on the local
  server): roles assigned, the same seed, a room moved on the giant's page
  appears moved on the mini's, a switch pressed on the mini's page frees the
  anchor on the giant's, the mini riding a held room, a round won and a swap.
- The HW7 tests still pass.

## As built

What differs from the sections above, and why.

- **Roofs are drawn in both views.** Section 1 says opaque roofs; the plan said
  the giant's view only. The mini sees the underside as its ceiling. The
  entrance hall has no roof, so the mini sees the giant overhead from the
  start and through doorways. A stake goes with its roof when the roof is not
  drawn.
- **A depot room is a walkable island.** A mini carried into a depot slot does
  not freeze: the room's floor and colliders are in its world and `roomAt`
  answers over the depot pads. The room has no links, so the mini can walk
  and teleport inside it but cannot leave until the giant moves the room
  back. This keeps "the giant may put any movable room anywhere" and never
  traps anyone.
- **The state has two more fields,** `taken` (rooms whose key is taken) and
  `won`, both owned by the mini; without `taken` nothing says whether a key is
  still there. The action fields are `{ by, <verb>: roomId }` (`place` also has
  `slot`, `rot`); `unlock` works from the gate's room or from the room across
  its doorway when that doorway is open, and uses the key up.
- **`state.mini` comes from where the feet are.** The scene sets it from
  `roomAt` as the mini walks (physics is the authority); `rules.apply` is used
  for place, take, unlock, press and open. On a shared edge `roomAt` picks the
  lower cell index, and the entrance counts as lower than every cell. Walk
  steps are per frame (dt capped at 50 ms), since `move` checks only the end
  point. A teleport sets the stand directly, onto a floor of a room in
  `rules.reachable`.
- **Generator options:** `gates` and `anchors` are maxima (each has a .6 chance),
  `turntable` is a probability, `emptyChests` is an exact count (default 2, so
  3 chests in all). A key or switch can sit in a spur: a side room on a free
  cell next to a path room, given a doorway to it. Over seeds 1..200, 157 levels
  have a gate (65 two), 120 an anchor, 86 a turntable; 18 needed a retry.
  1000 seeds generate and validate in about 2 s.
- **Rounds.** A round is `{ round, seed, giant }`. Each client starts solo with
  its own seed; when a live pair is at round 0, the one whose role is giant
  starts round 1 with its seed, so both play the giant's level. N and M
  (after a win) start a round with the same or the other giant; the number
  goes to `max(own, peer's) + 1`. A client adopts a peer's round when its
  number is higher, or equal with a higher sender id. The scene restarts when
  the key `round|seed|giant` changes, not only the number, so two rounds started
  at once settle on one level. If the round's giant is neither client (the
  giant left), the lower id starts a round once. Every message carries
  `round`; a snapshot of another round is dropped, and a change of round clears
  the stored snapshots.
- **Waiting.** A client whose partner has been silent for 3 s keeps its role,
  view and state, shows "waiting for your partner", applies no snapshots and
  does not take over the other part. A and V stay disabled once a partner
  has been live; they work only for a page that has been alone from the start.
- **Bodies' frames.** A desktop giant sends its camera and its grab point in the
  table frame; the grab point is the held room's centre raised by the wall
  height. A desktop mini sends its camera in its own model frame, not the table
  frame, because `map` is applied to model-frame bodies and could not take a
  table-frame one. The giant draws the avatar as `T · pose(ref) · map · body`,
  with `body` from clientState for a mini in the headset.
- **Riding over the network.** The mini's client carries itself. Its stand is
  always kept in the room's settled frame; while the giant's snapshot shows the
  room held, the mini follows the interpolated held pose as a tilt on the
  avatar's root (as in HW7); when the settled slot or turn of its room changes,
  it does `carry(settled before, settled after)`. This also works if the held
  snapshots were missed. The giant's client draws the avatar from the mini's
  `ref` and `map`, so it stays in the room whatever the latency.
- **Desktop keys.** The giant uses only Q, E, V, N and M, and leaves W/A/S/D/F to
  the camera so it can look at the table; the mini takes all of its keys. In a
  drag, Q/E are taps, not held. The wheel and touch are not handled.
- **Snapshots are sent in the frame,** after its step, not on a timer: a hidden
  tab stops sending, and the partner shows "waiting" after 3 s. The next send is
  one interval after the last due time (not after the frame that sent it), so
  20 Hz stays 20 Hz at 72 fps; a page more than an interval behind starts afresh.
- **After a win the round is closed.** `rules.apply` refuses every mini action
  once `won` (error "the round is over"), so the frozen time cannot grow. The
  win message comes from `state.won` alone, not from a notice, so it ends with
  the round; `startRound` also clears any notice.
- **Panel hints follow `window.isXR()`:** controller buttons in the headset (A
  role when alone, B new round, Y swap roles, X table, left stick walk, right
  stick turn and, pushed forward, aim, grip take or hold, trigger use), keys on
  the desktop. After a win the message is drawn once, in the big line only.
- **There is no room scan.** The scene takes no depth scan (HW7's still does): a
  headset player found it useless, and it could put the board in the
  background. The table stays at the World default until X, with the left
  controller laid flat on the real table, calibrates it; the mini's view
  keeps World's solid box room round the table.
- **All six symbol textures are made and uploaded at init,** before the first
  round, on hidden nodes (scale 0) through `symbolTexture`; a rug only takes the
  unit of its symbol (`txtr`), so no canvas, channel or GL texture is made in
  the middle of a headset session. Clay uploads a canvas texture only in
  `drawMesh`, when a node using it is first drawn, and it skips nodes of scale
  0; so `symbolTexture` also uploads the pixels itself (`texImage2D` right
  after `setTxtr`, the active unit restored) and sets the channel's `counter`
  to 0 so that the first draw does not upload again. The cause of the sun that a
  headset player could not find on any rug in round 2 is still unconfirmed
  (not reproduced on the desktop); creation and upload in the middle of the
  session were the suspects. Another candidate: `getArbitraryChannel` hands out
  channels 1 to 14 and then reuses one in use, so two textures could share a
  channel. At init the scene warns once (`console.warn`) if the panel's channel
  or a symbol's is another's, and the report below says per symbol whether its
  channel is uploaded and still holds its own canvas.
- **The scene reports to the server log** (`doorways <json>` on `/log`, as
  echohunt does) at each round's start (`ev: 'round'`), at the win (`'win'`)
  and every 5 s (`'tick'`), on the desktop and in the headset, to diagnose a
  headset report. The line (`report.js`, version `v: 1`) holds `xr`, `role`,
  `paired`, `round`, the level (`seed`, `goal`, `goalSymbol`, `rooms`: `[id,
  symbol, slot, rot, flags]` with flags among k, s, c, g, a), `mini`,
  `visited` (rooms the client has had as `state.mini` this round, in order),
  `reachable`, the mini's part of the state, `channels` (per symbol: its texture
  `channel`, `uploaded` when its pixels are in the texture, `same` when the
  channel still holds the symbol's own canvas, false if another texture took
  it over), `txtrChannel`, and `errors` (with `lastError`). A frame that
  throws is counted, its first message of each kind goes to the console, and
  the frame loop goes on.
- **Textures are given back on leaving:** the panel's and the symbols' canvases
  take a texture channel and a GL texture each; cleanup removes them from
  `_canvas_txtr` and `txtrChannel` and deletes the textures (as Spellcode).
- **A window blur** clears the held keys of the desktop input.
- **A reloaded page** rejoins the same round, level and role without a new
  round. A reloaded mini loses its progress (keys, switches) and a reloaded
  giant the placement of the rooms, since each part has one owner.
- **Rough edges, left as they are.** The switch, key and chest have no
  colliders, so the mini can walk through them. Panel text is tight in places
  (the message over the hint lines), and the desktop panel covers part of the
  mini's view. After leaving the scene the class server's queue keeps collecting the
  partner's messages until the page closes (as Spellcode). The server's sync
  writes `doorways.json` on the master client (in `.gitignore`).

### Files

```
js/scenes/doorways.js            the scene: roles, flight, drawing, wrist panel, debug hooks
js/scenes/doorways/rules.js      data, sides, links, reachability, snapping, `apply`
js/scenes/doorways/generate.js   seeded generator, `plan`, `validate`
js/scenes/doorways/rooms.js      a room's model, colliders and things (key, switch, chest, gate), from its data and state
js/scenes/doorways/board.js      water, grid, depot pads, entrance hall, in the table frame
js/scenes/doorways/symbols.js    the six symbols on G2 canvases, one texture each
js/scenes/doorways/walk.js       the mini's feet: `walk` (walls and floors), `roomAt`, `toTable`
js/scenes/doorways/giant.js      choosing, holding, following, turning and setting down a room
js/scenes/doorways/mini.js       the mini's world, walking, riding, teleport aim, things in reach
js/scenes/doorways/input.js      headset and desktop input as one set of numbers; key and mouse capture
js/scenes/doorways/panel.js      wrist panel: task card, keys, clock, messages
js/scenes/doorways/net.js        `Session` (presence, roles, rounds, snapshots, timeouts), `lerpPose`, `Interp`
js/scenes/doorways/report.js     `reportOf`: the line the scene sends to the server log
js/scenes/doorways/pair.js       `Link`: what each client sends and applies, validation, rounds, the held room's interpolation
js/scenes/doorways/bodies.js     the partner's head and hands, the giant's and the mini's figures
js/scenes/scenes.js              one line to register `doorways`
tests/doorways.test.cjs          Node: rules, generator, geometry, walking, session
tests/doorways-pair.test.cjs     Node: bodies, snapshots, `Link`
tests/doorways-browser.test.cjs  Playwright: one page, then two
```

### Messages

On the channel `doorways`; `from`, `epoch` and (for snapshots) `seq` are added by
the session. Snapshots are whole; one is applied only if its `round` is the
current one and its `seq` is the highest seen for that epoch.

| Type | Contents |
|---|---|
| `hello` (2 Hz) | `round`, `seed`, `giant`, `want` (the role this page plays or views), `role`, `table` (`world.frame`), `xr` |
| `giant` (20 Hz) | `round`, `at` (`{ roomId: { slot, rot } }`), `held` (`{ id, m }` in the table frame, or null), `body` (desktop giant only: `{ head, right? }` in the table frame) |
| `mini` (20 Hz) | `round`, `state` (`mini`, `keys`, `taken`, `unlocked`, `pressed`, `opened`, `penalty`, `won`), `ref` (the room it stands in, or the entrance), `map` (`inv(settledPose(ref)) · inv(F) · toMini`), `time` (the round's clock), `body` (desktop mini only: `{ head }` in its model frame) |
| `round` (on event) | `round`, `seed`, `giant` |

Everything a receiver reads is checked field by field (room ids, unique valid
slots, turns 0..3, finite 16-number matrices, key colours and count,
non-negative penalty and time); a malformed message is ignored whole.
Interpolation of the held room is 100 ms behind (`Interp`, `lerpPose` keeps the
rotation orthonormal).

### Tests

Results of the last run (Node 18):

| Suite | Result | Covers |
|---|---|---|
| `node tests/doorways.test.cjs` | 45 checks | sides and turns, links and gates, snapping, actions and their errors, 1000 seeds generated and validated, mechanisms and options, rooms, board and symbols on fake nodes, walls, doorways and floors under `walk`, `roomAt` (ties, depot island), the session on a fake queue (roles, the higher id yielding, rounds, adoption, timeouts, malformed and old-round snapshots, reload), `lerpPose`, `Interp` |
| `node tests/doorways-pair.test.cjs` | 18 checks | the partner's body (headset, desktop, none), the giant's and the mini's figures and the rigid ride of a moved room, snapshot validation both ways, `Link` on a fake relay (first round, wants, held interpolation and carry, waiting, N and M rounds, two rounds at once, a giant gone, a reloaded page) |
| `tests/doorways-browser.test.cjs` | passes | one page: both roles, hold and release with snapping and refusal, a stake, the mouse drag and Q/E, V flight, W walking and key capture, switch, teleport, riding a held room (released with and without snapping), a depot island, wrong and right chest, N. Two pages: the same level, a room moved on the giant's page seen on the mini's, a switch on the mini's page freeing the anchor on the giant's, the mini drawn inside a held room on the giant's page, a won round on both, M swapping the roles, a reload, "waiting for your partner" |
| `node tests/miniature.test.cjs` | 34 checks | HW7, unchanged |
| `node tests/echohunt.test.cjs` | 16 checks | HW6, unchanged |
| `tests/miniature-browser.test.cjs` | passes | HW7, unchanged |

The browser tests need Playwright (`NODE_PATH`), the local server running, and one
browser at a time. In headless Chromium a frame takes hundreds of milliseconds,
so every cross-page wait polls (`until`, frame counts) and throws on timeout. The
desktop viewer's camera update is commented out in `immersive-pre.js`, so the
tests prove that a mouse drag or a key does or does not reach the viewer by its
side effects (`window.mouseZ`, a key counter on `document`) as well as by the
view matrix.

### What only a headset can check

- The table: that the table frame lines up with the real one (X to calibrate).
- That the giant figure on the mini's page stands where the real person stands at
  the real table, and that the mini's hands move with the real hands (the XR
  bodies come from `clientState`; only a fake one is tested).
- Gripping a room (the 3 cm reach, the 3 m ray, how it follows the hand) and
  turning it with the right stick; the teleport aim.
- Riding a room the giant turns: whether the tilt on the avatar is comfortable
  at 12 times scale, and the 1.5 s flight.
- Frame rate on Quest, with two views.
- The desktop giant's hand at the mouse grab point and its orientation (a guess
  to judge by eye), and the size and place of the wrist panel.

## Out of scope

Voice, more than two players, swapping in the middle of a round, hand
tracking, saving progress.
