# HW6 design: Echo Hunt

Status: the `echohunt` scene runs on a Quest headset and on the desktop.

- **Unit checks:** `tests/echohunt.test.cjs` covers fusion accuracy, the
  sound's paths, the moths and the round.
- **Browser test:** `tests/echohunt-browser.test.cjs` runs a headless browser
  through the real server. It covers the round, a click, a tap, a shot and the
  sonar.

## The game

One player is a bat in their own dark room. When they enter the scene, the
headset scans the room and draws it as the sound sees it. Every sound lights
the surfaces it reaches, as a wave that spreads from where the sound was made.

- **Sounds:**
  - The player clicks with the left trigger.
  - The player can also speak into the microphone.
  - A moth taps whenever it hits a wall, the furniture or the player's head.
    The tap is played in 3D at that spot.
- **Seeing moths:** a moth shows only while a wave passes it. The wrist sonar
  marks where a wave last found each moth.
- **Shooting:** the right trigger fires silently along the controller's beam.
  It hits the nearest moth that is visible and near the ray. A hit moth comes
  back 2 s later, somewhere away from the player.
- **The round:** pressing `start` brings ten moths. They fly for 60 s, then
  all of them vanish. The score is the number of hits.

## Controls

| Control | Where | What it does |
| --- | --- | --- |
| left trigger | left controller | Clicks along the controller's beam, every 0.35 s while held |
| left grip | left controller | Turns the microphone on or off. It starts off |
| right trigger | right controller | Shoots along the beam |
| `A` | right controller | Scans again, adding to the room |
| sonar | above the left wrist | See below |
| `start` button and timer | the clock above the middle of the room | Starts a round. The disc shrinks with the time left. The button reads `scanning` and does nothing while the room is scanned |

The sonar is fixed to the room. Its up is the way the player faced when the
round began, or when they entered the scene.

- **Rings:** a ring every metre, out to 4 m.
- **Room:** the room's outline.
- **Player:** a triangle at the centre that turns as the player turns.
- **Moths:** a blip wherever a wave last found a moth, fading over 3 s. Moths
  that no sound has reached do not show.
- **Text:** the hits, the time left and the microphone state.

Panels face the viewer.

## Moths (`game.js`)

The moths keep the elements of `bouncing.js`: velocity, reflection off the
walls, bouncing off the head, and a sound at each bounce.

- **Bouncing:** in a scanned room, the moths bounce off the solid cells of the
  path grid (see below). A moth stuck in geometry is moved somewhere else.
- **Pausing:** the moths wait while the room is scanned.
- **Respawning:** they are respawned whenever a new room arrives during a
  round.

## Room scanning

The scan starts by itself when the player enters the scene in a headset. The
source depends on what the headset offers.

1. **Depth fusion** (`depth.js`, `tsdf.js`, `fuse.worker.js`). This is the
   normal case on a Quest.
   - **Capture:** each frame, `XRWebGLBinding.getDepthInformation` gives the
     depth texture.
     - A shader samples it into an 80 × 80 target, with a rotating offset.
     - The target is read back asynchronously through a pixel buffer.
     - The samples are unprojected into world points.
   - **Fusion:** a worker fuses the points into a truncated signed distance
     volume.
     - The volume uses 4 cm voxels with 12 cm truncation.
     - The points around where the player stands are kept free of furniture.
   - **Meshing:** surface nets turn the volume into a mesh. The mesh is
     redrawn every 1.5 s during the 12 s scan, and the game takes the final
     mesh.
   - **Materials:** `scan.js` gives each vertex a material.
     - A floor, walls and a yaw are found from the normals.
     - A height map of up-facing surfaces is split into rectangles.
     - Each rectangle is classified as a table, a bed or sofa (fabric), or
       wood.
   - **Accuracy:** in the unit check, the median error is 0.1 cm.
2. **Space Setup meshes** (`window.detectedMeshes`). When present, these are
   rebuilt into boxes and a mesh by label, at most every 2 s.
3. **Hit-test sweep.** This is used when there is no depth: a fan of hit tests
   from the eye, for 12 s.
4. **Virtual room.** This is used on the desktop: the prototype's
   6 × 3 × 6 m room.

## Sound field and rendering

This is the Echo prototype (`echo/`) moved into the scene.

### Sound field (`field.js`)

- **The voice** is a stream of 20 ms slots, one row per material.
- **Short sounds** are pulses: a click, a tap, a hit, the bell.
- **Arrival:** a surface point at distance *d* shows the sound that left the
  source *d* / 5 m/s ago.
- **Moths:** the CPU evaluates the same field at each moth, to decide how
  visible the moth is.
- **Caps:** to keep the frame rate up, only the 2 taps nearest the player and
  the 3 newest clicks are drawn at once. Every tap is still heard. A click is
  drawn for 1.2 s.

### Paths round things (`paths.js`, `paths.worker.js`)

Sound bends round furniture and through doorways, and does not pass through
walls.

- **Grid:** the room is a 10 cm grid of solid and free cells. Cells come from
  the fused volume, or from the boxes.
- **Path fields:** for each source, a worker runs Dial's shortest-path
  algorithm.
  - The search uses 26 neighbours and never cuts a corner.
  - It stores the path's excess over the straight line, in 2.5 cm steps.
  - The last 64 fields are kept.
- **Shader:** the fields are stacked in an R8 3D texture. The shader does one
  lookup per source per pixel, however many triangles the room has.
  - Sound arrives `excess` later and is weakened by `exp(-excess / 0.5 m)`.
  - Where no path leads, nothing arrives.

### Rendering (`render.js`)

- **Drawing order:** the scene's `animate` draws the room with its own WebGL2
  program, once per view, before Clay draws the moths and panels into the same
  frame.
- **Relief:** each face is a thin shell. Each pixel marches into the shell to
  a 3D wave function.
- **Shading once:** a depth pre-pass makes sure each pixel is shaded only
  once.
- **Skipping:** a source whose wave cannot have reached a pixel yet is
  skipped.
- **Headset settings:**
  - The room is drawn on an opaque layer, so the passthrough camera never
    shows through.
  - The framebuffer is scaled to 0.8.
  - Fixed foveation is set to 1.
  - The march is capped at 12 steps.
- **Robust frames:** if the game logic throws, the room is still drawn, so a
  frame never drops to the camera. The error is counted in the log.

On a Quest the scene runs at about 50–65 fps while quiet, and 25–40 fps with
several sounds at once.

## Desktop testing

- **Moving around:** WASD and the arrow keys, from the framework.
- **Sounds:**
  - `K`: click from the mouth.
  - `2` / `3`: test voices.
  - `M`: microphone on/off.
  - `G`: shows the room.
- **Shooting:** click on a visible moth.
- **Sonar:** at the lower left of the view.

## Test build

Every 5 s, the scene posts a report to the server's `/log`. It includes:

- the fps and the number of sources;
- scan statistics;
- the layer state;
- errors.

Scanned points are also posted once per scan. `window.echohuntDebug` exposes
the renderer, the paths and the GL context.

## Limits

- **Single player:** the multiplayer version was removed.
- **Glass:** windows without curtains can leave false surfaces in the scan.
- **Frame rate:** it drops with many sounds at once. This is why the drawn
  taps and clicks are capped.
