# HW2: Spellcode

Spellcode is a cooperative VR game with two roles. The gunner uses two guns to defend a core; the coder collects blocks dropped by defeated bugs and edits the guns' firing program. Survive three waves to win. Five core breaches end the run. Each defeated bug earns `100 × wave` points.

The in-game text explains the controls and shows the score, wave, core health, and energy. The final screen displays **YOU WIN** or **YOU LOSE** and offers a replay button.

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

If the coder disconnects, the battle pauses until they reconnect. Reloading the gunner starts a new run. To change a co-op role, reload the page and choose again.

Each player has a private code panel, so the coder's workspace does not obstruct the gunner's view. Both devices show the same arena relative to each player's starting head position. This version does not align physical play spaces or display teammate avatars.

Without `spellcodeRoom`, choose **SOLO DEBUG** on the in-game role screen. This works on desktop or one headset. The Python anchor service is not required.

## Test alone with SOLO DEBUG

1. Open `http://HOST:2026/` (or `localhost` on the computer), select **spellcode**, then **SOLO DEBUG**. You start as the coder with 99 of each block, so you can build code before the first shot.
2. Select a `+` slot, then a block. After adding a loop or modifier, insert or move a `fire()` call into its body to complete the draft.
3. Press **GUNNER** on the HUD. Point at **START RUN**, then fire. During a wave, switching roles automatically pauses the simulation.
4. Press **CODER** to inspect/edit or collect drops while paused. Press **GUNNER**, then **RESUME** to continue. The HUD also has a manual **PAUSE/RESUME** button and a DEBUG-only **COLLECT DROPS** button for drops obstructed by the desktop panel.

On desktop, click enemies to shoot as the gunner, or click panel buttons and dropped blocks as the coder. In DEBUG, `1` selects the gunner, `2` selects the coder, and `P` pauses or resumes. Press `3` at the initial menu to enter DEBUG.

In VR, use the right controller to select buttons and the left controller to collect drops as the coder. DEBUG runs locally, even when the URL includes a room name.

## Controls

| Gunner | Coder |
| --- | --- |
| Both triggers fire. | Left ray + trigger picks up a dropped block; right ray + trigger edits the code. No gun firing. |
| Left grip/side button opens or closes a **read-only** code preview. | Left grip/side button opens or closes the private IDE workspace. |
| Point at **START RUN**, **NEXT WAVE**, or **PLAY AGAIN** on the HUD with the right ray. | Choose a `+` insertion slot, then a collected block; select a code line to **MOVE TO +**, **DELETE**, or **CHANGE xN**. |

The HUD also has an **OPEN/CLOSE CODE** button. If tracking, focus, or display mode pauses the game, point at **RESUME RUN**. Desktop preview uses the mouse to aim/click the right gun and UI; `Enter` starts or advances a wave, `Tab` toggles the code panel, and `P` pauses/resumes for the gunner.

## Programming rules

The initial program contains one `fire(weapon, hand)` call. Insert blocks at the `+` slots between statements or inside a loop or modifier. Move existing blocks to change their order or nesting. In co-op, you earn blocks from kills; DEBUG provides them at the start.

- `fire()` fires one bolt.
- `for` repeats its body 2, 3, or 5 times per trigger press.
- `while (triggerHeld)` repeats its body until that trigger is released.
- `spread()` wraps its body with a 3- or 5-bolt fan.
- `power()` wraps its body with 2× or 3× damage.

Select **CHANGE xN** to cycle a block's allowed values. You can leave a loop or modifier empty while arranging the draft; the gun keeps its last valid program until the draft is complete. The validator checks block IDs, nesting, loop structure, and weapon limits. Only one `while` block is allowed. The game interprets the blocks directly without evaluating arbitrary JavaScript.

A valid edit takes effect on the next trigger press. A run already in progress keeps its original program. A finite `for` run finishes after trigger release; releasing a trigger stops a program containing `while`. Each volley costs `9 + 4 × (bolts − 1) + 4 × (damage − 1)` energy, which regenerates at 18 per second.

## Checks

```sh
node tests/spellcode.test.cjs
```

These checks cover block order and nesting, validation, trigger release, role permissions, close-range hits, drops, room synchronization, victory and defeat, and HUD text. Previous browser checks also exercised role selection and the DEBUG sequence of editing, switching roles, shooting, pausing, and collecting drops. Headset readability, controller alignment, and two-person comfort still need on-device testing.

Known validation issue: A sequence of more than 64 top-level `fire()` calls can bypass the shot limit. The existing automated checks do not catch this case.
