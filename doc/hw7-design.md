# HW7 design: Miniature

Status: Phases A, B and C are built (A1 to A5: the flight between the views,
the object's colliders with the avatar's physics and riding, teleport and the
ray grab, the giant, haptics and the wrist panel; B: the house, now the default
object; C: the depth scan of the real room, drawn in the avatar's view, and the
scanned table). The scan itself has only been run on the desktop with a
synthetic room, not in a headset. This document is the brief for the phases
below.

## The assignment

- A miniature object on a table and a 1/12 scale avatar of the player: a head
  and two controllers at least. A 6 ft player has an avatar whose head is
  6 in above the table.
- Two views, switchable:
  1. the player's own view, in which they can pick up and move the object;
  2. the avatar's view, in which they interact with the object at the
     avatar's size (open the door of a house and walk in, pluck an apple...).
- In the avatar's view, a representation of the physical room and table is
  suggested (the classroom tables are 60 x 24 in).

## The main constraint: the player stands still

A player in a headset stays within about half a metre of where they started,
standing or sitting. They cannot walk round the table or through the room.
Every design choice follows from this:

- **The avatar is moved by the player's hands, never by their feet.** The left
  stick walks it. The right stick turns it in snaps. Pushing the right stick
  forward aims a teleport, in either view. The player's own small movements
  still map onto the avatar at 1/12: leaning in to peek round a door works.
- **The object is reached by the ray, not by walking up to it.** In the
  player's view the grip grabs the object where the right controller's ray
  meets it, at any distance. The object then keeps its place relative to the
  controller, like a stick.
- **The far side of the table is reached by teleporting the avatar there**,
  and the house is turned in the hand to look into it.
- **Turning in place is fine.** The avatar's facing follows the head.

## Coordinates (unchanged)

`mapping.js`: `toMini = stand * scale(1/12) * body⁻¹`.

- `body` is the player's place on the floor and their facing.
- `stand` is the avatar's place, its feet, and its facing.
- The player's view draws the world as it is. The avatar is the player's
  poses times `toMini`.
- The avatar's view draws the whole world times `toWorld = toMini⁻¹`.

The avatar's feet may now be above the table top: `stand.p[1]` is the height
of the ground under it, on a step or on a roof.

## Phase A: the core

### A1. Fly in and fly out

Switching views is animated over 1.5 s, with t from 0 to 1 eased by
smoothstep. Inputs that move the avatar are ignored meanwhile. With E my eye
now (physical) and A = toMini(E) the avatar's eye:

    W(t) = T(E) · Ry(θ·t) · S(12^t) · T(−X(t))
    X(t) = E + (A − E) · (1 − 12^−t) / (1 − 1/12)
    θ    = the turn of toWorld (body.yaw − stand.yaw)

- **Endpoints:** W(0) is the identity and W(1) is `toWorld`.
- **The approach:** X moves in log scale, so the approach feels even.
- **Every frame:** W is recomputed from the current E and A.
- **Flying out** runs t from 1 to 0. Switching again mid-flight turns the
  flight round.
- **Room and table:** they show solid as soon as t > 0, their opacity rising
  over the first 0.3 of t. In the headset the passthrough is covered from
  then on.

### A2. Standing on things: object colliders and the avatar's physics

The object API gets colliders. It is backward compatible: the cube gets them
too.

    create(node) -> {
      bounds: { min, max },    // local box the ray grabs it by (player view)
      colliders() -> [{ min, max }],  // local boxes in its current state
      update(ctx)
    }
    ctx = { mode, t, now, dt,
            hands: [{ hand, p, ray: { o, d }, trigger, pressed, grip, gripPressed }],
            haptic(hand, strength, ms) }

- `p`, `ray`: the hand's point and its ray in the object's coordinates. They
  are the avatar's hand in the avatar's view.
- `pressed`, `gripPressed`: true on the frame the button went down.

The avatar's physics goes in a new pure module, `physics.js`, so it can be
tested. All lengths are in avatar metres times 1/12:

| Quantity | Value |
| --- | --- |
| radius | 0.25 m |
| step | at most 0.45 m |
| headroom | 1.9 m |

- **Ground:** the highest collider top under the feet circle that is at most
  `step` above the feet. Otherwise it is the table top.
- **Falling:** the feet drop to the ground at once.
- **Blocking:** a move is blocked by any collider whose top is more than
  `step` above the feet and whose bottom is below the head. The move slides
  along the other axis if that is free. A box that
  already blocks at the start position does not block a step that goes no
  nearer to it, so an avatar the object was put down on (or that a snap turn
  swung into a wall) can walk out, and cannot walk on through.
- **Coordinates:** the test is done in the object's local frame. The object
  stands upright on the table, turned only about the vertical.
- **The table:** the feet stay on the table. This uses `world.clamp`, as now,
  on the stand (the avatar's body); leaning with the head is not checked.
- **Haptics:** a blocked move gives a short pulse on the left controller, at
  most every 0.3 s.

**Riding.** If the avatar's ground is one of the object's colliders, it rides
the object. When the object's pose changes (it is grabbed, or put down), the
stand frame is carried by the same change: its position fully, its yaw by the
object's turn. The avatar stays wherever the object takes it. When the
object is put back down upright, the avatar is upright on it again.

### A3. Rays: teleport and grab

- **Teleport.** While the right stick is pushed forward (y < −0.6), the right
  controller's ray is cast at the walkable tops: the table top within its
  bounds, and the collider tops.
  - In the avatar's view the ray is first mapped into the world by `toMini`.
  - A ring marker shows the target, in world coordinates. That is 4 cm across
    on the table, and so 0.5 m round the avatar.
  - Releasing the stick moves the stand so the feet land on the target. The
    facing does not change.
  - Snap turns use the stick's x only while y is not pushed, and again only
    once the stick has come back near the centre.
  - On the desktop, T held aims along the view, a little down.
- **Grab (player view).** On a grip press, a hand within `REACH` of the
  bounds grabs the object. Otherwise, the hand grabs it if its ray hits the
  bounds within 3 m.
  - The object then follows the hand with the grab-time offset.
  - Release puts the object down upright on the table, as now.

### A4. The giant you

When the avatar's view starts, a second `Avatar` is left at full size where
the player is: the head and hands as at the switch, and the body from the
floor.

- **When it shows:** in the avatar's view and during the transitions. Its
  head shows only once t > 0.3.
- **What the player sees:** looking up from the table, they see themselves
  standing over it, 12 times their size.

### A5. Haptics and the wrist panel

- **Haptics:** `window.vibrate?.(hand, strength, ms)` exists in the
  framework. Pulse on:
  - a grab;
  - a hand starting to touch something it can use;
  - a blocked step.
- **The wrist panel:** a small G2 panel above the left controller, real size
  in both views (it is added to the model, not the world). It shows:
  - the view;
  - the controls (A view, B reset, sticks, grip, trigger, X table);
  - a short message: scanning, "point at the table"...

  Follow `js/scenes/echohunt/panels.js` for G2 panels: billboard, refresh
  every 7 frames, and unlit colour.

## Phase B: the house

`objects/house.js` becomes the default object; the cube stays available.
Sizes are given in avatar metres. The module divides by 12.

| Part | Size (avatar metres) |
| --- | --- |
| Floor plan | 6 x 4.8 |
| Walls | 3 high, 0.15 thick |
| Gable roof | to 4.5 |
| Porch and steps | two 0.2 m steps up to a 0.4 m floor |
| Door | 1.0 x 2.1, hinged, in the front wall |
| Windows | one on each side, with frames |
| Inside | a table with an apple, a lamp, and a light switch by the door |

On the table this is about 50 x 40 x 38 cm, and the door is 8 x 18 cm.

**What each view can do.** The giant's fingers are too big for the door, and
the avatar cannot lift the house:

| | Player's view (giant) | Avatar's view (small) |
| --- | --- | --- |
| Door | — | the trigger near the handle opens or closes it, swinging over 0.6 s; a closed door is a collider |
| Light | sees it through the windows | the trigger on the switch turns the lamp on or off; on, the lamp glows and the inside brightens |
| Apple | sees it through the windows | the grip near it picks it up; it follows the hand and stays where it is released, on the nearest top below |
| Roof | the trigger on the roof lifts it off and sets it beside the house (animated); again puts it back. Off, the giant can look in from above | — |
| House | the grip moves it (A3) | — |

- **Colliders:** walls with a door gap, the door while closed, the steps, the
  porch and floor, the roof (while on; it can be stood on if reached), and the
  table.
- **Contact:** touching, lighting and haptic pulses follow the cube's
  pattern.
- - **Shared state:** every state (door, light, roof, apple) is the same in
  both views. A change in one is seen in the other.

**As built** (`objects/house.js`; the deviations and the choices the table left
open):

- **Placement:** the house is turned a quarter on the table so that its 6 m
  (50 cm) width runs across the table, the 4.8 m (40 cm) depth and the
  1.6 m (13 cm) porch along it. It stands in the middle, its front to the near
  end, which leaves 20 cm in front of the steps for the avatar's start, in line
  with the door, and room behind for the roof set down (to x = 70 cm of 76).
  `miniature.js` has `OBJECT_AT`, `OBJECT_YAW` and `AVATAR_AT` for this.
- **Heights:** the floor is at 0.4 m, the walls are 3 m from the table, so
  2.6 m inside; the door is 2.1 m above the floor, the sill of the windows 1.2 m
  above the table. The porch deck is the second 0.2 m rise: the lower step is
  0.2 m, the deck 0.4 m.
- **Door:** 1.0 m wide, hinged on its left, swinging 90 degrees inwards. It
  blocks until half open. The avatar (0.5 m wide) fits through it up to 0.25 m
  off the middle. A collider for the leaf, open or not, would be in the way:
  none while open.
- **Colliders:** the walls are whole, windows included (the glass is solid);
  the roof is four bands of boxes up each slope, each less than 0.45 m higher
  than the last, so it can be walked up. It has no colliders once it has
  started to lift, and is back when it has set down.
- **Roof:** it lifts, moves 5.7 m (47 cm) behind the house and sets down on the
  table, in 1.2 s; it clears the walls before it comes down. The trigger works by the ray or by the hand touching its box,
  in either place.
- **Apple:** it stays on whatever is under it, every frame, so it falls if
  the door or roof it rests on goes. The grip's reach is 0.4 m (avatar).
- **The light:** Clay has no point lights, so the lamp on brightens the colours
  of the inside, a thin lining on each wall's inner face (so the walls are
  pale outside and in), the floor and the ceiling, tints the panes and the lamp
  shade, and moves the switch.
- **Parts:** about 70 nodes, fixed ones placed once; only the door, the roof and
  the apple are placed again when they move. The gable is a mesh defined with
  `clay.defineMesh`, which the Node tests do without.
- **Other changes, from the review of Phase A:** a box that already blocks the
  feet where they start does not block a step that goes no nearer to it (an
  object put down on the avatar, a snap turn into a wall); the right stick must come back to the centre before it snap turns
  again after aiming; controllers that are not tracked are not hands.

## Phase C: the real room

Reuse HW6's scan without changing Echo Hunt. A new module,
`miniature/scanner.js`, imports `../echohunt/depth.js` and starts
`../echohunt/fuse.worker.js`, as `echohunt.js` does in `startSweep` and
`depthFrame`.

- **When it scans:** on entering XR it scans for 12 s. The wrist panel says
  "look around". The views cannot be switched meanwhile. Left Y scans again.
- **The room:** the fused mesh replaces the box room in the avatar's view.
  - It is decimated to at most about 60k triangles.
  - It is drawn by a small program of its own, not as a Clay mesh (see below).
  - It is coloured by normal: floor, walls, tops.
  - It is drawn only when the world is solid, that is in the avatar's view
    and the transitions. In the player's view the passthrough shows the real
    room.
  - Because the scan lines up with the real room, the fly-in starts almost
    seamlessly.
- **The table:** the scan's boxes include tables (`plate`, 0.62–1.05 m high).
  - The table nearest in front of the player, within 2 m, becomes the
    world's table: its centre, top height, yaw and size.
  - `World` gets a per-table size, defaulting to 60 x 24 in.
  - Left X, with the controller laid on a table, still overrides the scan.
- **Desktop and failures:** the box room and the default table.

**As built** (`miniature/scanner.js`, `miniature/scanned.js`; the deviations and
the choices the plan left open):

- **The scan:** `Scanner` does what `startSweep` and `depthFrame` do, in the
  depth path only: a `DepthReader`, the points moved into the model's frame by
  `inverseRootMatrix`, `reset`, `clear` (every 15 frames, where I stand) and
  `frame` messages to `fuse.worker.js` (at most 40 in flight), 12 s of it, then
  one `mesh`. It asks for no mesh meanwhile (nothing is drawn while scanning),
  so the first `room` reply is the final one. Without depth, or if the worker
  or the capture fails, or the room comes back empty, the state is `failed`:
  the wrist panel says so and Y tries again; the box room and the default table stay.
- **When:** on the first XR frame of each session. Left Y scans again, from my
  own view only (it is ignored in the avatar's view and in flight); a scan that
  starts while I am in the avatar's view flies me back first. A, the view
  switch, is ignored while scanning or waiting for the room.
- **The mesh:** `roomMesh` turns `room.mesh` into triangles in Clay's layout
  (16 floats a vertex, as `vertexArray` packs them) in a `Float32Array`, kept
  by `World.setScan`. Over `MAX_TRIS` (40000) it merges vertices in cells of
  6 cm, growing by 1.3 until it fits, rather than skipping triangles, which
  leaves holes. Each triangle is wound to face the scan's own vertex normals
  (the drawing culls back faces), its lighting normals are the merged vertex
  normals, and its colour comes from its facing and height: up and low is
  floor, up and higher is a top, down is ceiling, the rest wall.
- **Drawing the mesh** (`miniature/scandraw.js`): as a Clay mesh it would go up
  to the GPU again every frame. Clay keeps one vertex buffer and uploads a mesh
  to it whenever the mesh drawn differs from the one drawn before (`drawMesh` in
  `clay.js`, `mesh != prevMesh`); the scan, drawn among the table and the house,
  is never the one before: 7.7 MB a frame at 40k triangles. So `ScanDraw` has
  a program, a vertex array and a buffer of its own: the mesh goes up once
  (`compact`: 20 bytes a vertex, position as floats, normal and colour as
  bytes), and each frame it is drawn once for each eye, from the animate
  function and before Clay draws, with the world node's global matrix and Clay's
  views, saving and restoring Clay's program, vertex array, buffer and
  viewport. It is shaded as Clay shades a white, dull surface (Clay's two
  directional lights, the vertex colour, the same square root) and fades with
  the world's opacity.
- **The box room** is hidden while there is a scanned mesh; the mesh is drawn
  only while the world is solid, as the box room was.
- **The table:** `pickTable` takes the `plate` boxes within 2 m of the player
  (distance to the top's footprint, in the room frame), preferring those in
  front of them (centre ahead of the head's facing, at the moment the scan
  ends); if none is in front, the nearest behind is taken, since where I look at
  the end of a scan is chance. Its top centre is the table's `p`; its size is
  [longer, shorter]; its `yaw` runs the table's x axis along the longer side
  (the room's x or z axis), with its z axis pointing towards me as the default
  table's does, so the avatar's start and the house's front end up at the near
  side as before. The scan's own top is cut from the mesh (`tableTop`: the
  box's footprint, 3 cm out, from 8 cm under the top to 6 cm over it), because
  the world draws the table itself and two surfaces there would flicker.
- **`World`** has `table.size` (60 x 24 in by default, kept by `setTable` when
  none is given), used by `clamp`, `contains` and the drawing; `TABLE.size`
  remains the default. After a scanned table, the house and the avatar are put
  at their starting places on it as for X, and the avatar's start is clamped
  to the table, for a table shorter than 1.1 m.
- **Mapping:** `Mapping.turn(angle)` turns the stand frame about `stand.p`, the
  point the physics tracks, so a snap turn leaves it where it is (it used to
  turn about the avatar's feet under its head, which could swing `stand.p` into a
  wall when the head was off the body). The avatar's body, under its head, swings
  about the stand point instead. The physics' rule for a box that already blocks is unchanged.
- **Desktop:** no scan. `miniatureDebug.takeRoom(room)` hands the scene a
  room as the scanner would, for the tests.

## After the first headset test

- The wrist panel showed green and black stripes. The depth reader
  (echohunt/depth.js) bound its own texture on whatever unit was active, which
  was the panel's, and did not put the old one back. It now does.
- The scan shows in my own view for 3 s when it is done, over the real room,
  and fades; the panel tells whether a table was found.
- The avatar's hand uses the door, the switch and the apple from 0.6 m (was
  0.35 / 0.4), or points at them with its ray from up to 2.5 m; a pointed-at
  apple comes to the hand. What a hand can use lights up.
- The avatar inside the house shows through the windows: it is drawn before
  the house, so the panes (which write depth) no longer hide it.
- The avatar standing on the house is held fast to it while the house is in my
  hand, tilting with it (`pose * carried⁻¹` on its root); it is carried there,
  upright, when the house is put down.
- The wrist panel shows a live picture (camera.js): in my view through the
  avatar's eye, level, the way it faces, where it can see me at my size
  (an avatar drawn only for the camera); in the avatar's view through the
  giant's eyes. Clay draws every node into the camera's framebuffer as an
  offscreen view (`window.clay.offscreenViews`, a small patch to drawMesh in
  clay.js); `view('main')` keeps a node out of it, `view('offscreen')` keeps it
  only in it. Two pictures alternate, since WebGL refuses to draw into a texture
  bound on a unit the program samples. It is drawn every other frame in the headset.

## Testing

- **Node:** `tests/miniature.test.cjs`, extended for the transition endpoints
  (W(0) = I, W(1) = toWorld), physics (steps, walls, ground, riding), ray
  picking, teleport targets, and the house's states and colliders.
- **Browser:** a Playwright test like `tests/echohunt-browser.test.cjs`
  (desktop: V, R, I/J/K/L, U/O), and screenshots of both views.
- **Regression:** Echo Hunt's tests must still pass.

## Code conventions

These follow the repository:

- 3-space indentation, ES modules, single quotes (the Node loader needs them).
- Comments only where needed, in full sentences, matching the existing files.
- Simple, efficient code.
