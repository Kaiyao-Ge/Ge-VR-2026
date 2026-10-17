# Spellcode HW4 design: Root Access

Status: the MVP is implemented; [spellcode.md](spellcode.md) describes the
playable game. This document replaces the earlier HW4 proposal (independent
batteries, manual recharge, AI coder). All numbers below are starting values for
playtesting, not measured results.

Differences between this design and the first implementation:

- GUN_LOCK glyphs appear on the gunner's HUD and tip board instead of on the
  gun, so the desktop preview can show them too.
- After the first playtest, a tip board in subtitle position tells each player
  what to do about every countermeasure (theirs and their teammate's), the
  first attack of each type warns three times longer, and the intercepted
  source comments each trait with its counter. ROOT's lines moved from the
  back wall to that board.
- BLACKOUT is a plain 92% dark layer without the code-rain texture, and the
  comfort option (world-anchored cloud) is not built yet.
- The HUD is a side console turned toward the player; the eye and the aim
  corridor stay clear.
- The planning deadline is the helper's 25-second timeout plus at most one
  retry; there is no separate 25-second break timer, because starting a wave
  always falls back immediately.
- ROOT's lines are at least 3 seconds apart, not 6.
- GHOST, FIREWALL, TROJAN, OBFUSCATE, text-to-speech, and coder-only daemon
  name labels in the arena are not implemented.

## Assignment fit

HW4 asks us to incorporate AI into a VR scene, starting from `aiquery.js`, and
to explore how AI can create content for VR worlds. In this design the AI does
not help the players. It is the antagonist, and it creates three kinds of
content that change play:

1. **Enemy designs.** Behavior, appearance, and a readable source listing for
   new enemies, built to counter the players' current gun program.
2. **Wave scripts.** Timed and conditional sabotage aimed at each player,
   with prewritten lines that reference what the players just did.
3. **Debriefs.** After each wave, the AI's plan and its reasons are shown, so
   the players can see that the attack was chosen for them.

## Premise

The setting follows the "humans versus the machine" idea from *The Matrix*.
Two humans have broken into a machine system and are holding an uplink open.
The system's controlling intelligence, **ROOT**, wants them out.

- The **Gunner** is jacked in. They stand in the simulated arena, see the
  threats, and fire two guns.
- The **Coder** is the operator at the console. They read the system's code,
  write the guns' firing program, and call out what the Gunner cannot see.
- **ROOT** is the system. Enemies (**daemons**) are its processes. Its
  sabotage (**countermeasures**) can reach anything in the system: the arena,
  the guns, the HUD, and the Coder's editor.
- The **uplink** fills during each wave. Survive every wave and the uplink
  completes. Lose all five integrity segments and the connection drops.

The intended feeling is that the whole game is working against both players,
and that they get through it only by helping each other.

## Experience principles

These rules keep "the game is against you" from turning into "the game is
unfair".

1. **Cross rescue.** Most countermeasures against one player are removed by
   the other player. ROOT's hostility is what forces cooperation: when the
   Gunner's gun is locked, the Coder unlocks it; when the Coder's panel is
   locked, the Gunner shoots the lock.
2. **Telegraph before impact.** ROOT's eye turns to its target and a line
   appears about one second before a countermeasure takes effect. A player
   who sees it coming blames themselves for missing it, not the game.
3. **Every attack is an opening.** When ROOT acts, its eye is exposed briefly.
   Hitting it shortens the countermeasure and drains ROOT's budget for the
   wave.
4. **Bounded and comfortable.** Each player suffers at most one
   countermeasure at a time, and each has a fixed maximum duration. Vision
   effects are short, never strobe, and never move the camera.
5. **Being watched.** ROOT quotes the players' behavior: hand preference,
   accuracy, how fast a previous sabotage was fixed, what the program relies
   on. The adaptation is visible in its lines and in the debrief.

Both players are assumed to be in the same room and can talk freely. The design
does not include voice chat or a ping system.

## Changes from HW3

| Keep | Remove | Add |
| --- | --- | --- |
| Gunner and Coder roles, room networking, SOLO DEBUG | Shared energy pool and low-energy waiting | ROOT: eye, lines, debrief |
| Block language, validator, private code panel | Dropped code chips and the collection ring | Daemon language and AI-generated daemons |
| Spatial audio system | Kill-count waves and wave-multiplied enemy health | Countermeasures with cross rescue |
| Two controller guns, stationary play area | — | Time-based waves with an uplink meter |
| — | — | Block draft between waves, slot capacity |
| — | — | Live editing during combat stays, and now matters more |

None of the previous proposal's battery, recharge, siphon, capacitor, APPLY
permission, or AI-coder rules remain.

## Match structure

A run has a preparation phase and four waves. Waves are time-based: daemons
stream in while the uplink fills, and the wave ends when the timer runs out.
Daemons still alive at the end are purged. Time-based waves keep session length
predictable and give ROOT's scripts a fixed timeline.

| Wave | Length | ROOT's behavior |
| --- | --- | --- |
| Preparation | Until the Gunner starts | No threats. Test target available. ROOT greets the players. |
| 1. Observation | 45 s | Base daemons only. ROOT takes no action and visibly logs behavior: `LOGGING GUNNER.RIGHT_HAND...` |
| 2. Probe | 60 s | One AI-designed daemon type and one countermeasure per role, introduced in a readable order. |
| 3. Trace | 75 s | A daemon designed against the current program and a targeted script with a larger budget. |
| 4. Purge | 90 s | All previous AI daemons, the largest budget, and the densest script. The uplink completes at the end. |

Total combat is 4.5 minutes; with breaks, a run lasts about 6–8 minutes.

Integrity has five segments. A daemon reaching the breach line removes one.
Each completed wave repairs one segment, up to five. Zero integrity loses the
run. Completing wave 4 wins.

### Between waves

The break begins when a wave ends and lasts until the Gunner starts the next
wave. It contains:

1. **Debrief.** ROOT's script for the last wave, its stated reasons, and how
   long each countermeasure took to resolve and who resolved it.
2. **Draft.** Three blocks are offered; the Coder picks one. At least one
   offer is a block used by the AI's solution to the next daemon (see
   [Generate and test](#generate-and-test)).
3. **Intercepted source.** The Coder's panel shows the source listing of the
   next wave's AI daemon. The Gunner sees only its name and silhouette, so the
   Coder explains it.
4. **Editing and testing.** The Coder edits; the Gunner tries the program on
   the test target.

ROOT's planning request runs while this happens. There is no countdown that
forces the players back into combat; the Gunner starts when ready.

## Player programming

The block language and its tree editor stay. Editing during combat is
allowed, because ROOT attacks the program during combat.

### Blocks

| Block | Behavior |
| --- | --- |
| `fire()` | Emit one volley with the modifiers in scope. |
| `for` | Repeat its body 2, 3, or 5 times per trigger press. |
| `while(triggerHeld)` | Repeat its body while that hand's trigger is held. At most one. |
| `wait` | Pause that hand's sequence for 0.2, 0.4, or 0.8 s. |
| `spread()` | 3- or 5-bolt fan. Total pellet cap 5. |
| `power()` | 2× or 3× damage per bolt. Total damage cap 3. |
| `pierce()` | Bolts pass through the first daemon and can hit one more behind it. |
| `chain()` | On a hit, a bolt jumps once to the nearest other daemon within 2 m. |

Eight blocks fit the inventory as two rows of four.

### Firing rate replaces energy

There is no energy. Each volley has a weight of `pellets × damage`, and the
hand's next volley waits `0.18 × weight` seconds. When every bolt lands, ideal
damage per second is the same for basic, spread, and power shots. Modifiers change *how* damage is delivered — fan coverage, burst size,
multiple targets — not the raw rate. Armor, strafing, and splitting make those
differences matter.

`while` no longer inserts a hidden 0.3 s wait. Explicit `wait` blocks set the
rhythm, which matters against phasing daemons.

### Capacity

The program's size is limited by slots, not energy. Every block uses one slot.
Capacity starts at 4 and grows by 2 after each wave (4, 6, 8, 10). Starting
inventory is `fire`, `for`, `while`, and one `spread`; the draft adds the rest.

### Validation and deployment

- Fix the known hole: the 64-bolt limit must also apply to top-level `fire()`
  sequences, not only to wrapped bodies.
- Reject unknown blocks, invalid values, nesting deeper than 8, and loop bodies
  that cannot reach `fire()`.
- A valid edit is used on the next trigger press. A running `while` program
  adopts the new version at the end of its current body cycle, so a held
  trigger cannot postpone a fix forever. This matters for removing ROOT's
  injected code.
- Incomplete drafts keep the last valid program live, as in HW3.

## Daemons

### One language for both sides

Players program guns with blocks. ROOT programs daemons with a small trait
language. The AI never writes JavaScript; it returns structured data that the
game validates and interprets. The source listing shown above a daemon and on
the Coder's panel is **rendered locally from the validated data**, so the
listing cannot disagree with the behavior.

Example listing:

```text
daemon MITOSIS (hp 3) {
   approach(0.45);
   strafe(0.6, 2.5s);
   onDeath { split(3, skitter); }
}
```

### Traits

| Trait | Parameters (allowed range) | Natural counters |
| --- | --- | --- |
| `approach(speed)` | 0.25–0.8 m/s, every daemon has one | — |
| `strafe(amplitude, period)` | 0.2–1.0 m, 1.5–4 s | `spread`, `chain` |
| `armor(n)` | Subtract 1–2 damage from each bolt; at least a quarter of each bolt lands, so unmodified fire still kills slowly | `power` |
| `shield(hp)` | Front-facing shield absorbs 2–8 damage before breaking | `power` bursts; `chain` from a neighbor hits from the side |
| `regen(n, every)` | Heal 1–2 hp every 0.5–1.5 s | Burst damage within one interval |
| `phase(on, off)` | Vulnerable 0.3–1.0 s, invulnerable 0.4–1.2 s | `wait` rhythm, sustained `while` |
| `onDeath { split(n, child) }` | 2–4 children from the base library | `spread`, `pierce`, `chain` |

A daemon has 1–8 hp, a size of 0.2–0.45 m, and at most three traits besides
`approach`. Collision remains a sphere test. `shield` is resolved by angle: a
bolt arriving within 60° of the daemon's facing is absorbed while the shield
has hp left.

### Base library

Hand-authored daemons fill wave 1, provide `split` children, and serve as the
fallback when the AI is unavailable.

| Daemon | Definition |
| --- | --- |
| Drone | `approach(0.4)`, hp 2 |
| Skitter | `approach(0.7)`, `strafe(0.4, 1.5s)`, hp 1, small |
| Brick | `approach(0.25)`, `armor(1)`, hp 6, large |
| Bulwark | `approach(0.35)`, `shield(4)`, hp 3 |
| Pulse | `approach(0.4)`, `phase(0.6, 0.9)`, hp 3 |
| Mender | `approach(0.3)`, `regen(1, 0.5s)`, hp 5 |
| Splitter | `approach(0.35)`, `onDeath { split(3, skitter) }`, hp 3 |

### AI-generated appearance

The AI composes each daemon's look from at most 12 Clay primitives, following
the `aiquery.js` scene coder's allowed forms. Each part has a form, a position
inside a unit box, a scale, a palette color (threat red, warning orange, dark
metal), and a tag: `body`, `shield`, `core`, or `detail`. The game normalizes the
result to the daemon's size and can mirror it left-to-right. A daemon with
`shield` must include a `shield` part on its front, so the protection is visible
in the silhouette. Silhouettes that fail these checks fall back to a base shape
with the AI's colors.

### Generate and test

Every AI daemon must come with a **solution**: a gun program that the AI claims
defeats it. Before accepting a daemon, the game simulates it headlessly with the
existing interpreter and idealized aim:

1. **Fair.** The solution kills the daemon before it reaches the breach line
   in every trial, and uses only blocks the Coder owns plus the draft offers.
2. **Not trivial.** If the current program kills it just as fast, the daemon
   is still accepted but is not counted as a counter in the debrief.
3. **Priced.** The simulated kill time sets the daemon's threat cost (see
   [Budgets](#budgets-and-limits)).
4. **Never immune.** The starter program `while (triggerHeld) { fire(); }` on
   one gun must also kill the daemon before it breaches, however slowly. The
   Coder can always rebuild that program, so no daemon can lock up a run.
5. **Paced.** The spawn groups together spawn no faster than that one starter
   gun can kill the daemon.

A failed check gets one retry with the errors sent back to the model. After that,
a base-library daemon is used and the debrief says so.

## Countermeasures

### Catalog

**Against the Gunner**

| Countermeasure | Telegraph | Effect | Resolution | Max duration |
| --- | --- | --- | --- | --- |
| BLACKOUT | Eye turns; a black null packet flies at the Gunner's head for 1.0 s | Vision goes dark for about one second (spec below) | Shoot the packet down or lean out of its path; the Coder can call it out | ~1.2 s |
| POPUP | System chime; a dialog unfolds in the aim corridor | 1–3 world-anchored error dialogs absorb bolts | Shoot each dialog's small close button | 8 s each |
| GUN_LOCK | Eye turns; the gun's emitter flickers | One gun cannot fire; four glyphs appear on that gun | The Gunner reads the glyphs aloud; the Coder enters them on the panel | 12 s |
| GHOST *(later)* | — | Fake daemons that look real to the Gunner | The Coder's view marks them; the Coder calls them out | 15 s |
| FIREWALL *(later)* | Wall frame assembles in a lane | AI-generated geometry blocks one lane | `chain` around it, or shoot its ports | 15 s |

**Against the Coder**

| Countermeasure | Telegraph | Effect | Resolution | Max duration |
| --- | --- | --- | --- | --- |
| INJECT | Eye turns to the Coder; panel border flickers once | ROOT inserts a hidden line that looks like a normal block: `wait(0.8)` or `misfire()`, which sends one bolt off target | The Gunner describes the symptom; the Coder finds and deletes the line | 30 s, then ROOT's line reverts |
| PANEL_LOCK | Lock icon spins up on the panel | The editor cannot be opened or used | The Gunner shoots the lock daemon, which appears in the arena | 12 s |
| THIEF | A small daemon emerges from the panel | It carries one inventory block toward a spawn gate | The Gunner kills it before it escapes; the block returns | 6 s to escape |
| TROJAN *(later)* | "SYSTEM ASSISTANT" offers an optimization | A strong-looking program change with one harmful line | The Coder reads it and accepts or rejects | Until answered |
| OBFUSCATE *(later)* | Text dissolves into glyph rain | Code collapses to one line without highlighting | The Coder restores lines one at a time | 20 s |

The MVP includes BLACKOUT, POPUP, GUN_LOCK, INJECT, PANEL_LOCK, and THIEF.

Injected nodes are flagged internally. Deleting one returns nothing to
inventory; deleting a legitimate block works as before. The Coder's panel
renders flagged and legitimate nodes identically. Whether to add a faint hint
after 15 seconds is a playtest question.

### BLACKOUT specification

BLACKOUT is an experiment, and the values below are starting points.

| Phase | Duration | Presentation |
| --- | --- | --- |
| Warning | 1.0 s | ROOT's eye turns to the Gunner; a black sphere with a distorted edge and a rising sound flies from the eye toward the Gunner's head position at launch. It does not home. |
| Fade in | 0.1 s | A head-locked layer fades to 92% black. |
| Hold | 0.8 s | Faint green code rain remains visible on the layer, so the view is not a complete void. |
| Fade out | 0.3 s | The layer fades back to the scene. |

Rules:

- Shooting the packet during the warning cancels it. Moving the head about
  0.4 m out of its path also avoids it. It is aimed at the head, not at a
  controller.
- No integrity loss resolves during a blackout or for 0.5 s after it. A daemon
  that reaches the breach line waits until then.
- At most one blackout every 20 s, and never two in a row against the same
  player without another countermeasure in between.
- Darkening without motion or flashing is generally better tolerated than a
  white flash, but comfort must be checked on a headset. A comfort option
  replaces the head-locked layer with a world-anchored dark cloud in front of
  the Gunner.

## ROOT's presence

- **The eye.** A large eye built from Clay primitives sits on the back wall.
  Its iris is green while observing and red while attacking. It turns toward
  the player it is about to target. In VR, a large entity turning to look at
  you is itself the telegraph.
- **The opening.** For 2 s after each countermeasure starts, the eye's core is
  exposed. Three hits shorten the countermeasure by half (BLACKOUT is cancelled
  outright if still in warning) and remove 1 threat point from ROOT's wave
  budget.
- **Lines.** ROOT speaks in short green monospace text projected on the back
  wall and floor: at most 60 characters, at least 6 seconds apart. Every line in
  combat is prewritten in the wave script, so none waits for the model.
  Text-to-speech is optional and can come later.
- **Ambient hostility.** Cosmetic only: HUD labels occasionally glitch into
  ROOT's phrasing, and the code rain on the walls forms ROOT's words. These
  never hide integrity, timers, or other information needed to play.
- **Memory.** A short summary of each finished run is kept in `localStorage`
  and included in the next planning request, so ROOT can open with "Welcome
  back. You lost at wave 3 last time."

## AI architecture

A model call takes several seconds or longer, so the model never makes
real-time decisions. Planning is split into two layers.

| Layer | Runs | Responsibility |
| --- | --- | --- |
| Strategic (model) | Once per break, prefetched | Reads telemetry; writes the next wave's daemon design, script, lines, and rationale |
| Tactical (local director) | Every simulation step | Evaluates triggers, enforces budgets and safety rules, executes countermeasures, plays lines |

In combat ROOT appears to react instantly because the director executes
conditional rules the model wrote ahead of time.

### Request lifecycle

1. At 70% of a wave's duration, the authoritative client builds a telemetry
   summary and sends a planning request through the classroom `AIQuery`
   helper (`askAIJson` / `queryFull` with `response_format: json_object`).
2. When the wave ends, the break shows "ROOT is analyzing you..." with lines
   from the program highlighted one by one. If the response has not arrived,
   the break continues normally.
3. When the response arrives, it is validated and tested. If it fails, one
   retry is sent with the error list.
4. Overall deadline: 25 s after the wave ends. After that, or after a second
   failure, a missing API key, or a network error, the director uses a
   hand-written fallback script chosen by simple rules from the same telemetry.
   The debrief labels it `ROOT OFFLINE: FALLBACK SCRIPT`.
5. Every request carries the run id and wave number. A response for an old run
   or wave is discarded. The existing `AIQuery.queryFull()` timeout does not
   abort its fetch, so this generation check, not cancellation, is what
   prevents late responses from acting.
6. Each wave keeps a local record of the telemetry, the raw response, the
   validation result, and whether the fallback was used. This record supports
   the debrief and the HW4 write-up.

### Telemetry (input)

```json
{
  "run": "a1f3", "nextWave": 3, "integrity": 4,
  "program": "while (triggerHeld(hand)) { with spread(weapon, 5) { fire(weapon, hand); } }",
  "inventory": { "fire": 1, "for": 1, "power": 1, "pierce": 1 },
  "capacity": 8, "draftOffers": ["power", "chain", "wait"],
  "gunner": { "accuracy": 0.41, "rightHandShare": 0.78, "killsByDaemon": { "drone": 9, "skitter": 6 } },
  "coder": { "editsLastWave": 5, "panelOpenShare": 0.62 },
  "countermeasures": [
    { "type": "GUN_LOCK", "target": "gunner.right", "resolvedBy": "coder", "seconds": 4.2 },
    { "type": "INJECT", "target": "coder", "resolvedBy": "coder", "seconds": 17.5 }
  ],
  "previousDaemons": ["pulse_variant"],
  "memory": "Last run: lost at wave 3; blackout avoided 1 of 2."
}
```

### Wave script (output)

```json
{
  "intro": "Your right hand carries you. Not for long.",
  "rationale": [
    "78% of shots come from the right hand: lock it early.",
    "The program spreads weak bolts: armored splitters punish that.",
    "INJECT took 17 s to find: repeat it while the panel is busy."
  ],
  "daemon": {
    "id": "shardling", "name": "SHARDLING", "summary": "Armored, splits on death.",
    "hp": 4, "size": 0.32,
    "traits": [
      { "type": "approach", "speed": 0.4 },
      { "type": "armor", "n": 1 },
      { "type": "split", "count": 3, "child": "skitter" }
    ],
    "parts": [
      { "form": "octahedron", "pos": [0, 0, 0], "scale": [1, 1, 1], "color": "threat", "tag": "body" },
      { "form": "coneZ", "pos": [0.6, 0, 0], "scale": [0.3, 0.3, 0.5], "color": "metal", "tag": "detail", "mirror": true }
    ],
    "solution": [
      { "type": "hold", "body": [ { "type": "power", "value": 2, "body": [ { "type": "pierce", "body": [ { "type": "fire" } ] } ] } ] }
    ]
  },
  "spawns": [ { "daemon": "shardling", "count": 5, "start": 10, "every": 9 } ],
  "tactics": [
    { "when": { "metric": "gunner.rightHandShare", "op": ">", "value": 0.7, "forSeconds": 8 },
      "do": { "type": "GUN_LOCK", "hand": "right" },
      "line": "Retiring your favorite hand." },
    { "when": { "metric": "coder.panelOpenSeconds", "op": ">", "value": 6 },
      "do": { "type": "INJECT", "code": "wait" },
      "line": "A small patch. You won't notice." },
    { "at": 50, "do": { "type": "BLACKOUT" }, "line": "Lights out." }
  ]
}
```

### Vocabulary

Triggers are either `at` (seconds into the wave) or `when` a metric crosses a
value for a duration. Metrics: `gunner.accuracy10s`, `gunner.rightHandShare`,
`gunner.idleSeconds`, `coder.panelOpenSeconds`, `coder.editsLast10s`,
`integrity`, `daemonsAlive`, and `secondsSinceResolved` (time since the
previous countermeasure was fixed). Each tactic fires at most once unless it
sets `repeat` with a minimum interval of 15 s.

Actions are the countermeasures in the catalog and `spawn` of the wave's
daemon. Lines are plain text, at most 60 characters.

### Prompt

The system prompt defines ROOT's persona (a cold, precise machine; short lines;
no profanity; never addresses the players as anything but intruders), the trait
and countermeasure vocabulary with allowed ranges, the wave budget, and the
rules: include a solution, cite telemetry in each rationale, and use only listed
forms and colors.

### Budgets and limits

Each wave has a threat budget; the director rejects anything above it.

| Wave | Budget |
| --- | --- |
| 2 | 6 |
| 3 | 10 |
| 4 | 14 |

Starting costs: BLACKOUT 3, GUN_LOCK 3, PANEL_LOCK 3, INJECT 2, POPUP 1 per
dialog, THIEF 2. An AI daemon's spawn group costs 1–4, based on its simulated
kill time. Base daemons follow a fixed schedule outside the budget. If
integrity is at 2 or less, the remaining budget is quietly reduced by 30%; this
adjustment is not announced.

The director's hard rules, which the model cannot override:

- At most one active countermeasure per player, and at least 8 s between two
  countermeasures against the same player.
- Never lock both guns, and never combine BLACKOUT with GUN_LOCK on the Gunner.
- Never combine PANEL_LOCK with an active INJECT, so injected code can always
  be found.
- At most 3 POPUP dialogs at once.
- Pause freezes every countermeasure timer; wave end, defeat, victory, and
  replay clear all of them.

## Interfaces and scene

### Arena

The arena becomes a black machine space with a floor grid, three lanes leading
from spawn gates to the breach line, and ROOT's eye on the back wall. Distant
wall planes show scrolling green code rain from a few canvas textures. Colors
have fixed meanings:

| Color | Meaning |
| --- | --- |
| Green | ROOT and the system: eye at rest, code rain, ROOT's text |
| Red / orange | Threats: daemons, the eye attacking, countermeasure telegraphs |
| Cyan | Player-owned: guns, panels, interactive buttons |
| Gold | Items to act on: close buttons, lock daemons, thieves |

Every color cue is paired with a shape, label, or motion. Decoration stays out of
the aim corridor. Frame time must be measured on the headset before adding code
rain density or more effects.

### Gunner

The Gunner sees aiming cues, integrity, the uplink meter, the wave timer, and
ROOT's current line. Setup buttons move to a side console. GUN_LOCK glyphs
appear on the locked gun. Left grip still opens a read-only code preview.

### Coder

The Coder's panel shows the program, inventory (two rows of four), slot usage,
and the intercepted daemon source between waves. During combat it adds a
GUN_LOCK glyph pad. In the arena, the Coder can see daemon names above each
daemon; later, GHOST daemons are marked only in this view.

### Audio

Reuse the positional audio system for ROOT's telegraphs (each countermeasure
gets a distinct cue from the eye's position), the null packet's flight, popup
chimes, lock and unlock, and THIEF escape warnings. Sound supplements visible
telegraphs and never replaces them.

## Networking

The Gunner's client remains authoritative. It runs the simulation, the director,
and the model requests. Snapshots add:

- active countermeasures with type, target, timers, and parameters;
- ROOT's state: eye target, exposure, current line;
- uplink progress, wave timer, and slot capacity;
- the current wave's daemon definitions, sent when a wave starts;
- the debrief and draft offers during breaks.

New Coder commands: `unlock(glyphs)`, `draftPick(type)`. Existing edit commands
handle deleting injected nodes. Program snapshots include the injected flag; the
Coder's client must not render it. GUN_LOCK glyphs are also in the snapshot and
must not appear on the Coder's panel. Both rules rely on the classroom relay's
existing assumption of trusted, same-room participants.

SOLO DEBUG lets one person play both roles and resolve every countermeasure,
with glyphs shown on both the gun and the pad. It is for testing, not a
supported way to play.

## Comfort and safety

- BLACKOUT is the only head-locked visual effect, and it follows the
  specification above. Every other obstruction is anchored in the world at least
  1.5 m away.
- No flicker faster than 3 Hz, no forced camera motion, and no sudden loud
  sounds.
- The comfort option replaces BLACKOUT with the world-anchored cloud.
- Countermeasure durations use simulation time. The current simulation clamps
  each frame to 50 ms, so at very low frame rates effects last longer in real
  time. Verify frame rate on the headset before tuning durations.

## Implementation order

Each step should be playable before the next begins.

1. **Combat core.** Remove energy and drops; add volley-weight firing rate, the
   new blocks, slot capacity, the 64-bolt fix, cycle-boundary deployment,
   time-based waves, the uplink, integrity repair, and the draft. Update the
   game and network tests.
2. **Daemons.** Trait interpreter, base library, sphere-plus-angle shield
   collision, rendered source listings, and the intercepted-source panel.
3. **Scripted ROOT.** Eye, lines, the six MVP countermeasures with cross
   rescue, the director's budget and hard rules, and hand-written scripts for
   waves 2–4. **Playtest here before adding the model**: the game has to be fun
   with a scripted ROOT first.
4. **Model-driven ROOT.** Telemetry, prompt, schema validation, generate-and-test
   with one retry, AI appearance, prefetch, deadline and fallback, debrief,
   run memory, and per-wave records.
5. **Presentation and comfort.** Arena pass, BLACKOUT comfort check, frame time
   on the headset, then the later countermeasures if time allows.

## Acceptance

- Without an API key, a run plays to victory or defeat using fallback scripts,
  and the debrief says the fallback was used.
- A late or malformed model response never changes a run it was not requested
  for, never exceeds the budget, and never breaks a hard rule.
- Every accepted AI daemon has passed its own solution test.
- Every countermeasure ends by its maximum duration even if nobody resolves it.
- Removing injected code takes effect by the next trigger press or `while`
  cycle.
- Two players in one room complete a run with at least one cross rescue each.
- The debrief for at least one wave shows a tactic that clearly cites the
  players' telemetry.

## Playtest questions

1. Does BLACKOUT at 0.8 s hold and 92% darkness feel tense rather than
   unpleasant? Try 0.6–1.2 s and 85–100%.
2. Do cross rescues take 2–5 seconds? If a rescue takes longer, simplify it.
3. Can the Gunner describe an INJECT symptom well enough for the Coder to find
   it? Is a hint after 15 s needed?
4. Does each AI daemon actually change which blocks the Coder uses?
5. Does the eye's opening get used, or is it ignored under pressure?
6. Are time-based waves better than clearing a fixed count? Does fast killing
   still feel rewarded?
7. Do ROOT's lines read as "it is watching us", or do they become noise?
8. Is the budget curve too punishing in wave 4? Watch integrity across runs.

## Open questions

- Should the eye's opening also contribute to score or a ROOT-damage meter, or
  stay purely defensive?
- Should ROOT speak with text-to-speech?
- How much run memory is enough before it feels repetitive?
- Which of GHOST, FIREWALL, TROJAN, and OBFUSCATE is worth building first after
  the MVP?
