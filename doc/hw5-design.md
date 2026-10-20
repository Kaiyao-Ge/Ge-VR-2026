# HW5 design: AI construction site

Status: steps 1 to 3 of the [implementation order](#implementation-order)
are built: the `construction` scene, where four arms build a hand-written
design (`designs/tower.js`, 21 modules, 48.5 s simulated) with annotations and
take-over; the format, physics checks and simulation; and the AI tool loop
with the four presets. On the preset panel, a row builds that preset's saved
AI design at once (a live session takes 2–14 minutes); its AI button starts a
new session. Numbers are starting values,
not measured results, unless a section says they were measured. Values marked
*(estimate)* must be checked against a datasheet or a scale before they are
shown as facts.

Differences between this design and the implementation (steps 1 to 3):

- Inverse kinematics is numerical, not analytic (see
  [Inverse kinematics](#inverse-kinematics)).
- A top-down grasp reaches much less than the arm's full length: measured,
  0.04–0.30 m horizontally from the pan axis at the height of the arm's base,
  and the tip can rise at most about 0.10 m above the base. Lifts are
  therefore required for anything above the first two floors of a model.
- The arms use decimated meshes (`media/stl/SO101_low`, made by
  `tools/decimate-stl.cjs` with 1.5 mm cells): one arm drops from about
  400,000 to about 40,000 triangles.
- Clearance capsules are 30 mm in radius; 22 mm let two arms visibly overlap.
- An unreachable target is refused: the arm holds its pose and the target is
  marked red, instead of straining toward it (which drove the tip into the
  table in testing).
- The reach band is drawn at the working height (the goal during take-over,
  otherwise the tip). It depends only on the height above the arm's base, so
  one cache per centimetre serves every arm and lift; the scene fills it one
  height per frame at start. Recomputing it during lift moves had dropped the
  scene to about 10 fps while an arm was selected.
- Desktop preview controls exist for development: click selects, `Tab`
  cycles, `G` takes over, the mouse moves the target, `W`/`S` change height,
  `Q`/`E` yaw, `Space` grips.
- Each arm's supply tray rides on its lift, at the height of the arm's base,
  so picking up always happens in the comfortable part of the reach band.
  There is no separate list of lifts: an arm has a starting `lift`, and plan
  steps move it.
- Modules rest without glue, so the physics rules changed: the 30% contact
  rule and the overhang rule are replaced by a tipping check at every height
  (see [Physical model](#physical-model)).
- An arm that is waiting or finished pulls back to a parking pose. Without
  it, an idle arm left its gripper beside the tower and another arm came
  within 9 mm of it.
- `simulate_plan` is the scene's own runner without rendering, so what the
  simulation reports is what the player sees. The tower simulates in about
  0.6 s in Node; in the browser the run yields every 12 ms so the scene keeps
  rendering.
- The tool loop allows 40 turns and 15 minutes instead of 20 steps and 120 s:
  a thinking model needs 10–140 s per turn (see [Model](#model)).
- Every `set_*` and `patch_*` call also returns the check it affects
  (`check_structure`, `check_site` or `simulate_plan`). Without this, the
  model spent half its turns asking for the check after each change.
- Overlap and support failures quote both boxes in cm
  (`x min..max z min..max y min..max`) and the surface under a floating
  module. With only "overlaps by 66 mm in height", the model concluded the
  checker was wrong and spent ten turns testing it.
- `set_building` warns about modules wider than the jaws in both directions,
  before any plan exists.
- Earlier copies of a part are removed from the conversation when a later
  `set_*` call replaces them, so requests stay small. The proxy accepts 5 MB
  bodies and forwards `max_tokens` (`server/main.js`).

## Summary

The player gives one prompt, such as "an Art Deco skyscraper going up". The AI
designs everything that follows: the building, the construction site, where
the SO101 robot arms stand, and the order in which they build. The player then
watches the arms assemble the building module by module. Any arm can be
selected to show its annotations, or taken over to place a module by hand.

The AI is responsible for physical correctness, but it does not do physics in
its head. It works like an engineer with simulation software: it writes a
draft, calls local checking tools on it, reads the measured failures, and fixes
them. The engine measures and reports; it never changes the AI's design. Only a
design that passes every check is built.

The two parts of the assignment share this scene:

- **Part 1 (AI production assistant).** The AI writes the whole scene as
  hierarchical JSON from a fixed set of primitives and components it can
  extend, then verifies it with tools.
- **Part 2 (robot arm annotations).** Every arm is an instance of one `Arm`
  class that draws joint angles and limits, reach, end-effector error, motion
  paths and estimated load. The same calculations are the tools the AI uses to
  check its plan.

## Assignment fit

| Requirement | Where it is met |
| --- | --- |
| Teach the AI by demonstration, then ask for more | A hand-written example component in the prompt; the AI defines new components in the same form ([Components](#components)) |
| A complex scene from variations of simple shapes | A building of several hundred primitives from a few components, plus the site and arms |
| Explore possibilities and limits | Design logs, the tool-loop transcript, and the [experiment](#experiment-possibilities-and-limits) |
| Annotate the SO101 arm in VR | [Annotations](#annotations) |
| Information useful for a real task | Take-over: the player does a pick-and-place with the annotations as feedback |

## Who decides what

| Decision | Owner | Checked by |
| --- | --- | --- |
| Style, building form, components, colours | AI | Format and range validation |
| Site size, number of arms, their bases and lifts, supply trays | AI | `check_site` |
| Structural soundness of the finished building | AI | `check_structure` |
| Build order, arm assignment, grasp, concurrency | AI | `simulate_plan` |
| Inverse kinematics, motion sampling, timing | Engine | — (deterministic) |
| Fixed facts: SO101 geometry, joint limits, estimated masses and torque, primitive list | Engine | Given to the AI in the prompt |

The engine computes motions because they follow uniquely from the AI's choices
(target pose, grasp, order). The AI chooses everything that could have been
chosen differently.

## Scale and hard limits

The SO101 is used at real size. Its links are 0.116 m (upper arm) and 0.135 m
(forearm), with about 0.16 m from the wrist pivot to the gripper tip (joint
offsets in `SO101.js`). Because a top-down grasp spends the wrist-to-tip length
vertically, it reaches only 0.04–0.30 m horizontally at the base's height, and
the tip rises at most about 0.10 m above the base (measured with the step 1
IK). The building is therefore a model, and the AI must use lifts or more arms
to reach high floors.

The AI chooses freely within these limits; outside them the design is
rejected, not clamped:

| Item | Limit |
| --- | --- |
| Site (table top) | 0.8–2.0 m wide, 0.6–1.5 m deep, top at 0.75 m |
| Arms | 1–6, base on the table or on a lift |
| Lift | column 0.06 m square, height 0–0.6 m, moves only while its arm is idle |
| Building | inside the table, at most 1.0 m tall |
| Size | at most 120 modules and 800 primitives |
| Construction time | at most 4 minutes at 1× |

All coordinates are metres, origin at the centre of the table top, +y up.

## Part 1: scene description

### Generation loop

The request uses the classroom helper `AIQuery.askAIWithTools` (it is already
in `js/util/aiquery.js`, and `server/main.js` forwards `tools` and
`tool_choice` to the model). One design session:

1. **System prompt**: persona (a construction AI that must prove its design
   works), the JSON formats below, the hard limits, the fixed SO101 facts and
   the demonstration component.
2. **User message**: the player's prompt.
3. **Tool loop**: the AI calls the tools below on a draft held locally. At most
   40 turns and 15 minutes.
4. **Gate**: the AI ends by calling `submit`. Only a passing `submit` is built.
   If the budget runs out, the last draft is shown as a ghost with its failures
   marked in red, and the scene says that the AI did not finish. This is
   reported honestly as a result, not hidden.

The draft lives on the client, not in the conversation. The AI sends parts
with `set_*` and `patch_*` calls instead of repeating the whole JSON, which
keeps messages short and lets it fix one floor at a time.

### Tools

| Tool | Input | Returns |
| --- | --- | --- |
| `set_components` | component definitions | expansion errors (unknown names, out of range, too deep) |
| `set_building` / `patch_floor` | the building, or one floor | format errors, primitive and module counts, mass per module |
| `check_structure` | — | per-module errors: floating, overlap, too little contact, overhang, centre of mass outside its support |
| `set_site` | table, arms, lifts, trays | format and limit errors |
| `reach_report` | optional arm id | for each module: which arms can reach its place pose, at which minimum lift height, and the margin to the reach limit |
| `check_site` | — | arms too close to each other or to the building, trays out of reach, modules no arm can reach at any lift height |
| `set_plan` / `patch_plan` | build steps | format errors |
| `simulate_plan` | — | the first 10 failures in time order, each with time, step, arm and cause; total duration |
| `submit` | — | runs every check; `ok` or the list of failures |

Each tool result is short, numeric and specific, for example
`f4.n2: arm 1 cannot reach the place pose (0.43 m > 0.40 m); arm 1 needs lift >= 0.09 m, arm 2 reaches it at lift 0`.

While the loop runs, the scene shows the draft as wire outlines and the arms in
their proposed places, with each tool result flashing on the affected parts.
Watching the AI design becomes part of the experience, and it fills the
waiting time of several model calls.

### Levels

| Level | Unit | Rendered when |
| --- | --- | --- |
| Building | the whole structure | always: a wire outline shows the goal |
| Floor | one storey | always: a ghost outline until it is built |
| Module | the part one arm carries | once placed, or while carried |
| Component | a named group of primitives | expanded inside a module |
| Primitive | one Clay form | leaf |

The same levels serve as LOD. Beyond 2 m from the player's head, a placed
floor renders as one box in the floor's average colour. Closer, its modules
expand to primitives.

### Primitives

The forms Spellcode already validates (`js/scenes/spellcode/daemons.js`):
`cube`, `sphere`, `octahedron`, and the `cone`, `pyramid`, `torus`, `tube` and
`disk` forms on X, Y or Z. Colours come from a palette (`concrete`, `glass`,
`steel`, `accent`, `green`, `light`, `dark`, `gold`).

```json
{ "form": "cube", "pos": [0, 0.03, 0], "scale": [0.02, 0.03, 0.002], "color": "glass", "rot": [0, 0, 0] }
```

`pos` and `scale` are in the parent's units; `scale` is half-extent, as in
Clay. `rot` is degrees about X, Y and Z, applied in that order.

### Components

A component is a named list of primitives or earlier components, with optional
parameters. Parameters can only scale, offset or recolour children; there are
no expressions or loops, so the format stays data.

```json
"components": {
  "window_module": {
    "params": { "w": 0.04, "tint": "glass" },
    "parts": [
      { "form": "cube", "pos": [0, 0, 0], "scale": ["$w", 0.025, 0.002], "color": "$tint" },
      { "form": "cube", "pos": [0, 0.026, 0], "scale": ["$w", 0.002, 0.004], "color": "steel" }
    ]
  }
}
```

`window_module` is the demonstration in the prompt. The AI may define up to 16
components. A component may reference only components defined before it, so
cycles are impossible and expansion depth is bounded.

### Building

```json
"building": {
  "name": "HELIX",
  "origin": [0, 0, 0],
  "floors": [
    { "height": 0.06, "turn": 0,
      "modules": [
        { "id": "f0.c0", "use": "corner_column", "pos": [-0.11, 0, -0.11] },
        { "id": "f0.n1", "use": "window_module", "pos": [0, 0, -0.12], "args": { "tint": "accent" } }
      ] }
  ]
}
```

Module positions are relative to the floor's centre; `turn` rotates a floor
about Y, so a twisting facade is one number per floor.

Modules may also have their own `turn` in degrees, added to the floor's.
Primitive `rot` is applied as X, then Y, then Z.

### Site

```json
"site": {
  "table": [1.4, 0.9],
  "arms": [
    { "id": 0, "base": [0, 0.24], "yaw": 90, "lift": 0 },
    { "id": 1, "base": [0.24, 0], "yaw": 180 }
  ],
  "trays": [ { "arm": 0, "pos": [0.13, 0.17] } ]
}
```

`yaw` is in degrees about +y; an arm with yaw θ faces [cos θ, 0, −sin θ]. A
tray is the module supply of one arm: it rides on that arm's lift, at the
height of its base, and each module appears on it with its final orientation,
its box centred on the tray.

### Plan

```json
"plan": [
  { "step": 10, "module": "f0.n", "arm": 0, "grasp": 90 },
  { "step": 100, "arm": 0, "lift": 0.05 },
  { "step": 412, "module": "r.3", "arm": 2, "grasp": 90, "after": [411] }
]
```

Each arm takes its steps in list order; a step also waits for its `after`
steps on other arms. A lift step moves the arm's lift at 0.05 m/s. `grasp` is
the direction, in degrees in the module's frame, along which the jaws close:
0 grips across the module's local x, 90 across its local z.

### Motion of a step

The engine turns a module step into waypoints for the tip: over the tray, down
to the grip point, grip, up to the carry height, across, down to the place
pose, release, up 3 cm. The grip point is the module's box centre at its top,
up to 15 mm deep. The carry height is 3 cm above the higher of the two grip
points. Every waypoint is solved by IK before the arm moves; one unreachable
waypoint fails the step, with the distance, height and pan angle in the
message.

## Physical model

The checks are static and kinematic; there is no dynamic simulation. Each
check is simple enough to explain in the annotation that displays it.

Modules are rigid blocks with no glue. A module's shape for these checks is
its bounding box in its own frame, turned with it, so a twisted floor is
checked with turned footprints.

| Check | Rule |
| --- | --- |
| Support | A module must rest on the table or on placed modules: its bottom within 2 mm of their top, with at least 1 cm² of contact. An unsupported module falls: it is lost and its step fails |
| Overlap | Two modules may not share more than 2 mm of height over a shared footprint |
| Stability | After every placement, at every height where something rests, each connected group of modules at or above that height must have its centre of mass at least 5 mm inside the convex hull of the contacts holding it. Checked in plan order, so a half-built state can fail even if the finished building is sound. A bridge over two supports passes; a cantilever passes only while its weight is over its supports |
| Reach and limits | Numeric IK must reach every waypoint, with every joint inside `lo`/`hi` from `SO101.js` |
| Grip | The module's width across the jaws must fit the jaw opening, at most 62 mm *(estimate from a 70 mm jaw)* |
| Load | Static gravity torque on each pitch joint, carrying the module, must stay under 80% of stall torque |
| Clearance | Arm links, as 30 mm capsules, must stay 10 mm from each other and from placed modules, checked every frame, including arms moving at the same time. The jaw capsule is not checked against modules, because the jaws must reach between them |
| Collision | A carried module may not overlap a placed one by more than 3 mm (the arm places within about 2 mm) |
| Speed | Each joint at most 2 rad/s *(estimate)*; enforced by the engine, not a failure |
| Time | Construction must finish within 4 minutes of simulated time |

Masses:

- STS3215 servo: 55 g each *(estimate)*.
- Printed arm links: mesh volume × PLA 1.24 g/cm³ × 30% infill *(estimate)*.
- Modules: primitive volume × a fixed density of 0.4 g/cm³ (hollow print).
  A primitive's volume is its box volume times a fill fraction for its form
  (1 for a cube, π/6 for a sphere, π/4 for a cylinder, and so on).

Rated torque: the STS3215 datasheet lists stall torque by voltage version
(about 19.5 kg·cm for the 7.4 V model) *(to verify)*. Labels say "estimated
static load"; dynamic loads are ignored.

## Part 2: the arms

### One class for every arm

`Arm` (in `arm.js`) holds one arm's joint hierarchy, built from the link and
joint tables in `SO101.js`, and provides:

- forward kinematics, numeric IK and reach tests (in `kinematics.js`);
- a motion queue fed by the scheduler, or by the controller during take-over;
- the load model and capsule geometry used by the checks;
- headless instances (`new Arm(null, …)`) for the simulation.

One `Annotations` object (`annotate.js`) draws the annotations of whichever arm
is selected.

The AI's tools call the same methods on headless `Arm` instances, so what the
AI was told and what the player sees cannot disagree.

### Inverse kinematics

Top-down grasps (gripper pointing at the table). The URDF chain has small
lateral offsets at every joint, so a closed-form planar solution would be only
approximate. Instead `kinematics.js` uses damped least squares on the exact
chain:

- The residual is the tip position error, the approach direction's error from
  straight down, and, when a grasp yaw is given, the jaw hinge's error from
  that yaw.
- Each frame starts from the current pose (8 iterations). If that fails, it
  retries from four cold starts with the pan already aimed at the target.
- A target is reachable when the tip is within 2 mm and the approach within
  about 5° of vertical, with every joint inside its limits.

Measured: from cold starts, it finds 97–99% of randomly sampled reachable
top-down targets (the misses sit at joint limits); a solve takes about 1 ms in
Node.

### Motions

A placement is five segments: over the tray, down and grip, up 0.05 m, carry
at a safe height, down and release. Segments are straight in Cartesian space,
sampled every 0.01 m through IK.

### Annotations

Any arm can be selected. Annotations appear for the selected arm only. All
numbers are on one readout panel; the geometry in the scene carries colour but
no text. Clay's `label` text is black glyphs on an opaque white atlas sampled
without mipmaps, so tinted labels came out as coloured blocks with thin dark
digits that broke up in the headset. The panel faces the player at a constant
angular size, beside the arm on the side away from the site's centre and 15 cm
nearer the head so the neighbouring arms stay behind it. Panels are unlit (an
ambient term that cancels Clay's two default lights) and uploaded with
mipmaps; with Clay's lit, linearly filtered canvas texture their brightness
changed with the viewing side and thin strokes shimmered.

| Annotation | Shows | Form |
| --- | --- | --- |
| Joint arcs | Range and current angle of each joint | Arc from `lo` to `hi` at the joint, needle at the current angle, degrees on the panel; green, yellow within 15° of a limit, red at the limit |
| Reach shell | Where the gripper can go at the current lift height | Translucent band on the working plane and a ring on the table; an out-of-reach target turns the marker red and the panel shows `OUT OF REACH +3.2 cm` |
| End effector | Precision | Tip offset from the target in cm, distance, jaw opening in mm |
| Trail and preview | Past and planned motion | Fading trail of the last 3 s; planned path as a dotted curve; translucent ghost arm at the end pose |
| Joint load | Whether it can carry this module | One bar per pitch joint: estimated static torque as % of rated, and the module's mass |
| Clearance | How close it is to a collision | The nearest distance to another arm or module, as a line and a value in mm on the panel, red under 10 mm |
| Task | What it is doing | Current step, module id, and what it waits for |
| Lift | Base height | Height in cm on the column |

### Interaction

| Action | Input |
| --- | --- |
| Choose a prompt | Point at one of the preset prompts on the panel |
| Select an arm | Point the right controller at it and pull the trigger |
| Take over | With an arm selected, squeeze the right grip |
| Move the target | Move the controller; the arm follows through IK at the speed limit, and every annotation updates live |
| Grip or release | Right trigger while in take-over |
| Hand back | Squeeze the grip again |
| Construction speed | Panel buttons: pause, 1×, 4× |

Construction pauses while any arm is taken over, so the player's motions cannot
collide with a scheduled one. The player can grip only the module of the
arm's current step, from its tray, and an outline shows where it belongs.
Releasing it within 1 cm of the outline places it, with the same checks as an
automatic placement. Releasing it elsewhere returns it to the tray. On
hand-back, the arm finishes the step from wherever the player left it.
Modules keep their orientation while carried, so only position matters.

### Prompt presets

Text and speech input come later. The first version has four presets, each
chosen to stress something different:

1. "An Art Deco skyscraper with setbacks and a gold crown." (tall: lifts)
2. "A glass tower that twists 90 degrees from bottom to top." (rotation, reach)
3. "A terraced tower with a garden on every third floor." (many components)
4. "A brutalist block that cantilevers over its base." (overhang and stability)

## Experiment: possibilities and limits

Each preset is run three times under each condition:

| Condition | What the AI does |
| --- | --- |
| A. One shot, flat | Returns every primitive in world coordinates, site and plan, in one reply; checked afterwards, no tools |
| B. One shot, hierarchical | The formats above, in one reply; checked afterwards, no tools |
| C. Tool loop (the main pipeline) | The formats above, with the checking tools |

Measured for each run:

- whether it passes all checks, and after how many tool calls;
- the failures by type (format, structure, reach, load, clearance, order);
- model calls, total time, reply length, primitive count;
- a screenshot and the construction duration.

The question this answers is how much of "physical correctness" the model can
own by itself (A, B) and how much it can own when it can measure (C). An
optional condition D asks the model to write a JavaScript generator instead of
JSON, to show the interoperability problem: two equal buildings from D can
have unrelated code.

## Model

DeepSeek through the classroom proxy (`/api/aiquery`, OpenAI-compatible), as
in HW4. Function calling works through the proxy with both models (measured
2026-10-18); no JSON fallback is needed.

Measured on the four presets (`tools/run-design.cjs`, logs as JSON):

| Model | Runs | Accepted | Per turn | Session |
| --- | --- | --- | --- | --- |
| `deepseek-chat` | 2–3 per preset (10 in all), while the tools and prompt were improved | 0 | 1–8 s | 1–4 min, out of turns (30, then 40) |
| `deepseek-reasoner` | 1–2 per preset, after the tool improvements | 6 of 6 | 1–150 s | 2.3–14 min |

`deepseek-chat` fixes one error per turn and often gets the arithmetic of a
fix wrong (moving a beam back and forth between "overlaps" and "rests on
nothing"); its best run placed 26 of 27 modules. The thinking model computes
the geometry before calling and passed every preset, with designs of 16 to 60
modules built in 26–223 s of simulated construction. The scene therefore uses
`deepseek-reasoner` (`MODEL` in `ai.js`); HW4 keeps `deepseek-chat` from `.env`.

Its cost is waiting. The first one or two replies are often empty, because the
model spends its whole 32,000-token budget thinking (about 135 s each). An
empty reply is dropped and the model is told once to start with a simple
draft. That cut the empty turns from five to two, but a session still takes
2–14 minutes. In the scene the draft is drawn as it changes, so the wait shows
the design taking shape.

## Files

| File | Responsibility | Status |
| --- | --- | --- |
| `js/scenes/construction.js` | Scene: site, panels, input, selection, take-over | step 1 |
| `js/scenes/construction/kinematics.js` | SO101 tables, FK, IK, reach, load, capsules and clearance; no rendering | step 1 |
| `js/scenes/construction/arm.js` | `Arm`: Clay hierarchy, motion queue, gripper, trail | step 1 |
| `js/scenes/construction/annotate.js` | Annotations for the selected arm and its readout panel | step 1 |
| `js/scenes/construction/design.js` | Formats, validation, component expansion, module boxes and masses | step 2 (LOD in step 4) |
| `js/scenes/construction/physics.js` | Support, overlap, stability | step 2 |
| `js/scenes/construction/plan.js` | `Builder` runs a plan on the arms, checks clearance, load and collisions, handles take-over; `simulate()` runs it without rendering | step 2 |
| `js/scenes/construction/designs/preset-1.json` … `preset-4.json` | An accepted AI design for each preset, with its source (prompt, model, date, turns, tool calls, seconds); a preset row builds it at once, its AI button designs anew | step 3 |
| `js/scenes/construction/designs/tower.js` | The hand-written design: four storeys, roof, crown; four arms on climbing lifts | step 2 |
| `js/scenes/construction/tools.js` | The draft and the eleven tools; text results with measured numbers | step 3 |
| `js/scenes/construction/ai.js` | System prompt, presets, model and budget, the tool loop and its log | step 3 |
| `tools/run-design.cjs` | Runs design sessions in Node through the running server and saves each log as JSON | step 3 |
| `tests/construction.test.cjs` | Kinematics, IK, load; format errors; physics; the tower builds with no failures; broken variants report reach, grip and clearance; take-over; the tools accept the tower and report broken drafts with numbers | steps 1–3 |
| `tools/decimate-stl.cjs` | Makes `media/stl/SO101_low` from `media/stl/SO101` | step 1 |
| `doc/construction.md` | Player-facing description and the experiment results | planned |

`SO101.js` stays unchanged; `kinematics.js` copies its link and joint tables
and turns every joint about its own z axis, as the URDF does.

## Implementation order

1. `Arm` with IK, take-over and all annotations; several arms on a
   hand-written site. Part 2 is complete here.
2. Formats, validation, interpreter and physics checks on a hand-written
   building and plan; the arms build it.
3. Verify DeepSeek function calling through the proxy; then the tool loop with
   the four presets.
4. The live design view, LOD and speed controls.
5. The experiment runs and the write-up.

Each step leaves something presentable.

## Risks

- **The loop may not converge.** Twenty steps may not be enough for a hard
  prompt. Logs of failed sessions are still results; if most presets fail,
  the limits are relaxed or the tools return more specific advice.
- **Rendering cost.** Up to six STL arms plus 800 primitives on Quest. The
  decimated meshes bring an arm to about 40,000 triangles; the help panel
  shows the frame rate so it can be read in the headset. Measure after steps 1
  and 4; the LOD distance and primitive limit are the next things to reduce.
- **Estimated physical values.** Torque and masses are estimates, and the
  annotations say so.
- **Latency.** A session may take one to two minutes of model calls. The live
  design view makes this visible instead of a blank wait, and a finished
  design can be saved and replayed without the model.
- **IK simplification.** Only top-down grasps are solved.
