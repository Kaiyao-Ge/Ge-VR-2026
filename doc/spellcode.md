# HW3: Spellcode multiplayer

Spellcode is a cooperative VR game with two roles. The gunner uses two guns to defend a core; the coder collects blocks dropped by defeated bugs and edits the guns' firing program. Survive three waves to win. Five core breaches end the run. Each defeated bug earns `100 × wave` points.

The in-game text explains the controls and shows the score, wave, core health, and energy. The final screen displays **YOU WIN** or **YOU LOSE** and offers a replay button.

This assignment extends the HW2 game with the classroom message-passing API, controller-beam dragging, and spatial audio.

## Launch

After installing the project's dependencies, run the server from the repository root with Node 18:

```sh
nvm use 18
node server/main.js 2026 2026 http
```

On both headsets, open the **same URL**, replacing `HOST` with the computer's LAN IP address:

```text
http://HOST:2026/?spellcodeRoom=TEAM42
```

Select **spellcode** on both devices. One player chooses **GUNNER**; the other chooses **CODER**. Enter VR with two tracked controllers per player. The gunner can start once both players have joined.

If the coder stops sending messages, the battle pauses until communication resumes. A closed connection requires the coder to reload and choose CODER again. Opening the coder's panel or editing code does not pause a cooperative battle. Switching roles in SOLO DEBUG does pause the run. To change a co-op role, reload the page and choose again; reloading the gunner starts a new run.

Each player has a private code panel, so the coder's workspace does not obstruct the gunner's view. Both devices show the same arena relative to each player's starting head position. This version does not align physical play spaces or display teammate avatars.

Without `spellcodeRoom`, choose **SOLO DEBUG** on the in-game role screen. This works on desktop or one headset. The Python anchor service is not required.

## Test alone with SOLO DEBUG

### Browser headset emulation

Enable Immersive Web Emulator and reload `http://localhost:2026/`. Select
**spellcode**, then click **ENTER AR** to start the simulated headset. The classroom
framework uses an inline session for preview and restores the canvas to the page
so the scene menu remains accessible. Use the emulator's headset and controller controls to aim,
press triggers, and operate the panels. **SOLO DEBUG** still allows one person to
switch between shooting and editing. End the simulated session to return to the
page; **ENTER AR** starts another session without resetting the game.
Switching display modes pauses an active run. Point the right controller at
**RESUME RUN** and press its trigger before shooting again.

The optional `tests/xr-emulator.test.cjs` browser check uses Playwright and the
official `iwer` runtime, installed separately from the app. It checks page
preview, AR entry, controller shooting, exit, and re-entry. Set
`NODE_PATH` to that installation's `node_modules` and run
`node tests/xr-emulator.test.cjs` with the server running. `XR_TEST_URL` overrides
the default `http://localhost:2026/` address. This does not replace testing the
extension UI or a real headset.

### Game controls

1. Open `http://HOST:2026/` (or `localhost` on the computer), select **spellcode**, then **SOLO DEBUG**. You start as the coder with 99 of each block, so you can build code before the first shot.
2. Select a `+` slot, then a block. After adding a loop or modifier, insert or move a `fire()` call into its body to complete the draft.
3. Press **GUNNER** on the HUD. Point at **START RUN**, then fire. During a wave, switching roles automatically pauses the simulation.
4. Press **CODER** to inspect/edit or collect drops while paused. Press **GUNNER**, then **RESUME** to continue. The HUD also has a manual **PAUSE/RESUME** button and a DEBUG-only **COLLECT DROPS** button for drops obstructed by the desktop panel.

On desktop, click enemies to shoot as the gunner. As the coder, hold the mouse button on a dropped block, aim toward the cyan collection ring, and scroll down to pull it closer (up to push it away). Release inside the ring to collect it. Close the code panel with `Tab` if it covers a drop or the ring. In DEBUG, `1` selects the gunner, `2` selects the coder, and `P` pauses or resumes. Press `3` at the initial menu to enter DEBUG.

In VR, use the right controller to select buttons and the left controller to collect drops as the coder. DEBUG runs locally, even when the URL includes a room name.

## Controls

| Gunner | Coder |
| --- | --- |
| Both triggers fire. | Hold the left trigger on a drop, drag it to the cyan ring, then release. Pull the left stick back to bring it closer; push forward to move it away. Right ray + trigger edits code. No gun firing. |
| Left grip/side button opens or closes a **read-only** code preview. | Left grip/side button opens or closes the private IDE workspace. |
| Point at **START RUN**, **NEXT WAVE**, or **PLAY AGAIN** on the HUD with the right ray. | Choose a `+` insertion slot, then a collected block; select a code line to **MOVE TO +**, **DELETE**, or **CHANGE xN**. |

The HUD also has an **OPEN/CLOSE CODE** button. If tracking, focus, or display mode pauses the game, point at **RESUME RUN**. Desktop preview uses the mouse to aim/click the right gun and UI; `Enter` starts or advances a wave, `Tab` toggles the code panel, and `P` pauses/resumes for the gunner.

A held block follows the closest point on the controller beam, with stick input adjusting its depth. The ring turns gold when the block is inside. Releasing outside the ring leaves the block in the arena. Losing tracking, closing the panel, or switching roles cancels the drag without collecting it. Only the coder can drag or collect blocks.

## Multiplayer messages

`spellcode.js` initializes a room-specific channel with `server.init`, queues messages with `server.send`, and processes them through `server.sync` on a 100 ms timer and on rendering frames. This follows `construct.js` in the supplied class checkout; that checkout does not contain `connect.js`. Beam projection follows the technique in `beamSphere.js`.

Spellcode uses `server.init(channel, {}, { accumulate: true })` to retain incoming message batches until the next network update. The classroom receiver would otherwise replace each batch, dropping edits when the sender runs faster than the receiver. Other scenes keep the classroom behavior. Delivery relies on an open, ordered WebSocket connection.

Every scene session has a unique identifier. Snapshots identify the accepted coder, and commands identify the host session they target; stale commands cannot modify a restarted run. A new host session resets the coder's event baseline. Extra coders see **CODER ROLE OCCUPIED** and cannot send commands until paired. Both clients send a departure message when leaving the scene; heartbeat timeouts cover departures that cannot be delivered.

The gunner runs the simulation and sends snapshots every 100 ms, after game events, and after coder commands. The gunner checks each command's sender, role, inventory, code structure, and drag ray before applying it. Queued snapshots hold copies of the state, so later game updates cannot change an unsent message. Block positions, inventory, enemies, score, and the gun program are shared; controller poses and panels stay local.

Both clients send a heartbeat once per second. A separate timer receives and sends messages even when render callbacks stop or head tracking is unavailable. The timer does not advance the battle, and leaving the scene clears it. Pending sound and visual events are capped at 128 and discarded after 500 ms without a new batch.

Browsers can delay timers or suspend all JavaScript. Silence longer than three seconds pauses the battle and releases held blocks, as does a missing peer in the client list. Closing the local socket immediately invalidates pairing and stops new outgoing messages from accumulating. Heartbeats restore communication after a render stall; a closed WebSocket requires a page reload. Automatic socket reconnection, host migration, and persistent matches are not implemented. The classroom relay assumes trusted participants.

## Spatial audio

Sound uses the AudioContext, Resonance Audio scene, and three mono samples from the class `construct.js` example. The placeholder effects vary those samples' playback rate and gain. The HUD sound button enables audio and cycles through 50%, 100%, and off. Each player controls their own volume.

Gun volleys, kills, core damage, collection, and round results play at their arena positions, transformed into the local headset's coordinates. A quiet loop follows a held chip; a rate-limited warning identifies the nearest enemy within 2.5 meters. Compile feedback is private to the coder. Eight independent short-effect voices and one drag voice prevent simultaneous sounds from sharing a position. There is no background music or voice chat.

Both clients play shared events locally; no audio streams are transmitted. Repeated snapshots do not replay the same event batch. Pausing stops battle sounds, while SOLO DEBUG still allows drag and edit feedback. Losing focus, waiting for a teammate, muting, or leaving the scene stops active sounds. Missing audio assets or an unavailable Resonance library leave the game playable without sound. In VR, if sound remains locked, select the sound button after entering the session.

On a headset, test left/right shots and turn your head while dragging a chip: sound should stay at the visible object. Disconnect the coder and switch scenes to check for lingering loops. Headphone testing is needed to judge direction and volume.

## Visual design

The arena is a low-poly data-core station: repeated structural frames establish depth, cyan floor markers lead toward the enemy entrance, and five floor-mounted lights show core health. Enemy drones use red armor and an amber visor. Dropped code appears as amber chips; the collection ring has a **CODE INTAKE** sign and turns gold when a held chip is inside.

The private editor uses a file tab, line numbers, indentation guides, and syntax colors. The HUD separates score, wave progress, core health, and energy. Guns have an energy indicator on top. Geometry is generated with the existing Clay primitives and a narrowed version of its torus mesh; panels use Canvas textures. There are no imported game assets, full-screen flashes, or bloom passes. The geometric environments and contrasting accents in [Pistol Whip's official screenshots](https://www.cloudheadgames.com/pistol-whip) served as visual reference, not as assets.

## Programming rules

The initial program contains one `fire(weapon, hand)` call. Insert blocks at the `+` slots between statements or inside a loop or modifier. Move existing blocks to change their order or nesting. In co-op, you earn blocks from kills; DEBUG provides them at the start.

- `fire()` fires one bolt.
- `for` repeats its body 2, 3, or 5 times per trigger press.
- `while (triggerHeld)` repeats its body until that trigger is released.
- `spread()` wraps its body with a 3- or 5-bolt fan.
- `power()` wraps its body with 2× or 3× damage.

Select **CHANGE xN** to cycle a block's allowed values. You can leave a loop or modifier empty while arranging the draft; the gun keeps its last valid program until the draft is complete. The validator checks block IDs, nesting, loop structure, and weapon limits. Only one `while` block is allowed. The game interprets the blocks directly without evaluating arbitrary JavaScript.

A valid edit takes effect on the next trigger press. A firing sequence already in progress keeps its original program. A finite `for` run finishes after trigger release; releasing a trigger stops a program containing `while`. Each volley costs `9 + 4 × (bolts − 1) + 4 × (damage − 1)` energy, which regenerates at 18 per second.

## Checks

```sh
node tests/spellcode.test.cjs
node tests/spellcode-network.test.cjs
node tests/spellcode-audio.test.cjs
```

These checks cover block order and nesting, validation, trigger release, role permissions, close-range hits, dragging and collecting drops, room synchronization, victory and defeat, and HUD text. The transport check runs the actual `server/client.js` in isolated JavaScript contexts with an in-memory WebSocket relay; it checks two-client editing and collection plus a third client in a different room. It is not a browser or headset test.

The network regression test independently schedules each client. It checks low frame rates, networking without rendering, bounded effects, socket closure, membership changes, timeout recovery, ordered commands, role occupancy, and stale session messages. The audio test uses audio-node doubles to check voice isolation, coordinate mapping, drag movement, pause, mute, and cleanup.

With the server running and `NODE_PATH` pointing to a separate Playwright installation, run `node tests/spellcode-coop-browser.test.cjs`. It uses two browser clients and an isolated broadcast relay to check focus changes, panel toggles, and battle progress after killing the first enemy and stopping all coder render callbacks for five seconds. It does not simulate a browser freezing all JavaScript.

For a two-client manual check, open the same room URL in two browser windows and choose GUNNER and CODER. Kill a bug, drag its drop into the ring as the coder, then use the collected block in the program. Confirm the gunner's read-only preview updates. Close the coder window and confirm the battle freezes; rejoin as CODER and confirm it resumes. Use different room names to check isolation. Finally, repeat on two headsets to check readability, controller alignment, and comfort.

Known validation issue: A sequence of more than 64 top-level `fire()` calls can bypass the shot limit. The existing automated checks do not catch this case.
