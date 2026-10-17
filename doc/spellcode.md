# HW4: Spellcode — Root Access

Spellcode is a cooperative VR game in which two players fight the system itself. **ROOT**, the AI that controls the machine, designs enemies (daemons) to counter the players' gun program and sabotages both players during combat. The gunner is jacked in and fires two guns; the coder reads ROOT's code and programs the guns. Hold the uplink through four waves to win. Losing all five core segments ends the run.

HW4 adds the AI antagonist to the HW3 multiplayer game, using the classroom `AIQuery` helper from `aiquery.js`. The full design and its reasoning are in the [HW4 design document](spellcode-hw4-design.md).

## Launch

Run the server from the repository root with Node 18:

```sh
nvm use 18
node server/main.js 2026 2026 http
```

For model-designed waves, create `.env` in the repository root before starting the server. The server works with any OpenAI-compatible provider; this project is tested with DeepSeek's non-thinking model:

```sh
OPENAI_API_KEY=sk-...
OPENAI_BASE_URL=https://api.deepseek.com/v1
OPENAI_MODEL=deepseek-chat
```

Leave out the last two lines to use OpenAI (`gpt-5.1`). `.env` is ignored by git. With DeepSeek, one request takes about 2–4 seconds and a plan, including at most one retry, takes 3–7 seconds; ROOT starts planning at 70% of a wave, so the plan is ready before the break. In a test of 18 plans, 14 came from the model and 4 fell back after two rejected attempts (malformed JSON or a solution needing two unowned blocks). Without a key the game is still fully playable: ROOT uses hand-written fallback scripts, and the debrief says `ROOT OFFLINE: FALLBACK SCRIPT`.

On both headsets, open the same URL, replacing `HOST` with the computer's LAN IP address:

```text
http://HOST:2026/?spellcodeRoom=TEAM42
```

Select **spellcode** on both devices. One player chooses **GUNNER**; the other chooses **CODER**. The gunner starts once both players have joined. The design assumes both players are in the same room and can talk.

Without `spellcodeRoom`, choose **SOLO DEBUG** to test both roles alone on a desktop or one headset. DEBUG starts with 99 of each block.

## How a run works

| Wave | Length | ROOT |
| --- | --- | --- |
| 1 | 45 s | Watches and logs. No sabotage. |
| 2 | 60 s | First designed daemon and first countermeasures (budget 6). |
| 3 | 75 s | A daemon aimed at your current program; larger budget (10). |
| 4 | 90 s | Everything at once (budget 14). The uplink completes at the end. |

Waves end when their timer runs out; remaining daemons are purged. Each survived wave repairs one core segment and adds two program slots. Daemons score `50 × hp`.

Between waves:

- The HUD shows the **debrief**: ROOT's reasons for the last wave and who resolved each countermeasure, and how fast.
- The coder's console shows the **intercepted source** of the next wave's daemon, with a comment on each trait naming its counter (for example `armor(1); // -1 per bolt → power`), and offers **three blocks**; the coder picks one. At least one offer is a block that beats the new daemon.
- The gunner starts the next wave when ready. If ROOT has not finished planning, the fallback script is used; the game never waits for the model.

## ROOT's countermeasures

ROOT's eye on the back wall turns to its target and its line appears about a second before each attack. After an attack starts, the eye opens for two seconds: three hits halve every active countermeasure and cost ROOT one budget point. Each player suffers at most one countermeasure at a time, with at least 8 seconds between attacks on the same player.

A tip board below the aim corridor tells each player what to do about every active countermeasure, including the ones aimed at the teammate; the coder's console repeats the coder's task in its status line. The first countermeasure of each type in a run gives three times the usual warning, so there is time to read the tip. Outside combat the board shows how to start and when to pick a block.

| Countermeasure | Target | Effect | Resolution |
| --- | --- | --- | --- |
| BLACKOUT | Gunner | A black packet flies at the gunner's head. If it lands, vision goes 92% dark for about a second. | Shoot the packet or lean out of its path. No breach resolves during a blackout. |
| POPUP | Gunner | 1–3 error dialogs block shots in the aim corridor. | Shoot the gold ✕ at each dialog's top right. |
| GUN_LOCK | Gunner | One gun stops firing; the gunner's HUD shows four glyphs. | The gunner reads the glyphs aloud; the coder enters them on the console. |
| INJECT | Coder | A hidden `wait(0.8)` or a misfiring line that looks exactly like `fire()` appears in the program. | The gunner describes the symptom; the coder finds and deletes the line. It reverts after 30 s. The fake line never counts as a `fire()`, so deleting the real one leaves an incomplete draft and the gun keeps its last program. |
| PANEL_LOCK | Coder | The console cannot be edited. | The gunner shoots the gold lock in the arena. |
| THIEF | Coder | A gold daemon carries one stock block toward the gates. | The gunner kills it within 6 s to return the block. If the wave ends first, the block comes back. |

Every countermeasure ends after its maximum duration even if nobody resolves it.

## Controls

| Gunner | Coder |
| --- | --- |
| Both triggers fire. | Right ray + trigger edits code, picks draft blocks and enters lock glyphs. |
| Left grip opens a **read-only** code preview. | Left grip opens or closes the private console. |
| Point at **START RUN**, **NEXT WAVE** or **PLAY AGAIN** on the side HUD. | Choose a `+` slot, then a block; select a line to **MOVE TO +**, **DELETE** or **CHANGE xN**. |

A clicked button consumes that trigger press. Desktop preview: click to aim and fire with the right gun, `Enter` starts or advances a wave, `Tab` toggles the code panel, `P` pauses. In DEBUG, `1` selects the gunner and `2` the coder; switching roles pauses the run. Press `3` at the role menu to enter DEBUG.

## Programming rules

The run starts with `while (triggerHeld) { fire(); }` and one each of `fire`, `for` and `spread` in stock. Every block uses one slot; capacity starts at 4 and grows to 10.

| Block | Behavior |
| --- | --- |
| `fire()` | One volley with the modifiers in scope. |
| `for` | Repeat 2, 3 or 5 times per trigger press; finishes after release. |
| `while (triggerHeld)` | Repeat while the trigger is held. At most one. |
| `wait` | Pause 0.2, 0.4 or 0.8 s. |
| `spread()` | 3- or 5-bolt fan (total cap 5). |
| `power()` | 2× or 3× damage per bolt (total cap 3). |
| `pierce()` | Each bolt also hits the next daemon behind its target. |
| `chain()` | Each hit jumps once to the nearest daemon within 2 m, so it can reach a shield from the side. |

There is no energy. After a volley of `bolts × damage` weight, that hand waits `0.18 × weight` seconds, so ideal damage per second is the same for basic, spread and powered fire; modifiers change delivery, not raw rate. A trigger cannot fire more than 64 bolts per press. A valid edit applies on the next trigger press; a held `while` adopts it at the end of its current cycle.

## Daemons

Daemons use a small trait language: `approach`, `strafe`, `armor`, `shield`, `regen`, `phase` and `onDeath { split }`. The source shown to the coder is rendered from the same data the game executes. The base library (drone, skitter, brick, bulwark, pulse, mender, splitter) fills the waves; ROOT adds one designed daemon per wave.

## How ROOT plans

At 70% of each wave, the gunner's client (or the SOLO DEBUG client) sends one request through `AIQuery.queryFull` with a JSON response format. The request contains telemetry: the program, owned blocks, accuracy, hand use, kills by daemon, and how each countermeasure was resolved, plus a one-line memory of the previous run from `localStorage`. The model returns a daemon design (traits, up to 12 Clay primitives, and its own solution program), spawn groups, and conditional tactics with prewritten lines.

The game clamps every value to its allowed range and then tests the design: a headless simulation must show the AI's solution killing the daemon before it reaches the breach line, using at most one block type the coder does not own. The starter program `while (triggerHeld) { fire(); }` on one gun must also kill it before it breaches, so no daemon is immune, and its spawn groups together arrive no faster than that one gun can clear them. A rejected plan gets one retry with the errors; after that, or after a network error or missing key, the fallback script is used. Responses for an old run or wave are discarded. In combat, the local director evaluates the script's triggers every frame and enforces the budget and the one-attack-per-player rule. Each request and response is kept in `window.spellcodeRootLog` for inspection.

## Multiplayer

The gunner's client is authoritative: it runs the simulation, ROOT's director and the model requests, and sends snapshots every 100 ms and after events. The coder sends `edit`, `pick`, `unlock` and `panel` commands; the gunner applies them. Messages use the classroom `server.init/send/sync` framework with `accumulate: true`, room-specific channels, per-session identifiers, and heartbeats; silence longer than three seconds pauses the battle. Lock glyphs and injected-line flags are present in snapshots, and the coder's client does not display them; this relies on the classroom relay's trusted, same-room participants.

## Spatial audio

Sound uses the AudioContext, Resonance Audio scene and two mono samples from the class `construct.js` example. ROOT's telegraphs and attacks play from the eye's position; shots, kills, breaches and a nearby-daemon warning play at their arena positions. Compile and unlock feedback is private to the coder. The HUD sound button cycles 50%, 100% and off.

## Checks

```sh
node tests/spellcode.test.cjs
node tests/spellcode-network.test.cjs
node tests/spellcode-audio.test.cjs
```

These cover the block language and capacity, the 64-bolt limit, cycle-boundary deployment, every daemon trait, pierce and chain, time-based waves and victory/defeat, each countermeasure and its resolution, the eye, budget and per-player limits, script normalization, generate-and-test, retry/fallback/stale handling in `Root`, snapshots and commands over the real classroom client, panels, and audio voices.

With the server running and `NODE_PATH` pointing to a separate Playwright installation, `node tests/spellcode-coop-browser.test.cjs` runs two browser clients and checks pairing, focus changes, panel toggles and battle progress.

Live DeepSeek planning was tested through the server proxy with scripted telemetry, not yet in a played run. Not yet verified: headset comfort of BLACKOUT, and frame time on a headset. At very low frame rates the simulation's 50 ms frame cap stretches countermeasure timings in real time.
