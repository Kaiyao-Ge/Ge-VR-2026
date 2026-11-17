# HW9 Rails v2: one bus

v1 (doc/hw9-design.md) gave every variable its own rail, drawn as its own arc. With three variables that reads well;
with dozens it becomes a circuit board. v2 keeps everything that runs (Worker, recording, watchdog, saving,
pairing) and changes how data is connected and shown:

- There is **one bus**. A card is either plugged into it or not. What a card reads is chosen by name in its code; the
  bus is where every named value lives.
- The bus's contents are looked at in **one window**, opened on demand, not as a tag per variable.

The headset test of v1 also found four problems that v2 fixes: no trackpad (mouse only), unexplained UI (a jumping
coordinate, the gaze/pointer boards), text unreadable over a busy passthrough background, and code that cannot be
zoomed or scrolled sideways.

## 1. Model (runtime)

**Variables.** A variable is a named value on the bus. It exists as soon as a plugged card declares an output of that
name (`output('target', 'state', 'vec3')`); its kind (state/event) and type come from that declaration. A second
output of the same name with the same kind and type also publishes (state: the last write wins and the variable is
marked contested, as in v1). A second output with a different kind or type is a setup error of the later module:
`target is state vec3 here but event num in ball`. A variable that no port refers to any more disappears from the bus
(the recording keeps its history). At most 64 variables.

**Default binding.** An input takes the variable of its own name: `input('target', …)` reads `target`. An input whose
variable does not exist yet waits and binds when it appears.

**Override (`use`).** An input can be pointed at another variable of a compatible kind and type: `ball.target` ← `gaze_hit`.
An incompatible choice is refused with the reason. Resetting returns it to the same-name default.

**Built-in variables.** Devices publish ordinary variables: `time` (the clock, state time), `gaze_hit` (state vec3:
where the gaze meets the desk mat), `gaze_on` (state bool), `pointer_pos` (state vec3: the laptop's mouse/trackpad over
the mat), `pointer_down` (state bool). A module can read them by name (`input('pointer_pos', 'state', 'vec3')`) or an
input can be pointed at them. v1's device cards are gone. An input named `time` binds to the clock as before.

**Plug.** Every card has one plug; a new card is plugged in. An unplugged card keeps running, but its inputs receive
nothing and its outputs are not published; a variable only it published goes stale: the bus window shows it amber, with `-` as its publisher. Plugging back in binds
again by the rules above.

**Saved layout (v2).** `{ cards: {id: {slot}}, uses: {"card.port": variable}, unplugged: [card] }` — no rails, no lanes,
no docks. A v1 layout still loads: a dock to the same-name rail is the default and is dropped; a dock to another rail
becomes a `use`; a device dock maps `dev:gaze.hit` → `gaze_hit` (likewise `gaze.on`, `pointer.pos`, `pointer.down`,
`clock.time` → `time`); its rail list is ignored.

**Inside.** The bus still keeps one rail per variable and logs dock operations, so recording, scrubbing and
the watchdog work unchanged: rails are now created and docked by the runtime, not by the user.

## 2. Space (headset)

- **The bus** is one horizontal arc under the cards (0.40 m below the eye, across all five slots), neutral grey, one mesh.
- **Each card** has a plug at the middle of its bottom edge and a drop line to the bus, ending in a connector dot when
  plugged. Unplugged, the plug hangs short with a hollow red dot, the card's header says `unplugged`, and a card that is not focused is dimmed to 0.85 times its idle or hover brightness.
- **Activity.** When a card publishes, a short pulse runs along the bus from its connector to the connectors of the
  cards that take that variable, in that variable's colour (at most 60 pulses). There are no value labels in space.
- **Plug gesture.** Look at a plug (±3°), hold the button (mouse or trackpad), look along the bus and release on it to
  plug, anywhere else to unplug.
- **Opening the bus window.** Look at the bus for 0.4 s (not while holding), or press Mod+B.

Removed from v1: the five lanes, per-rail tags, the gaze/pointer device cards, the lens, pin grabbing.

## 3. The bus window

One opaque panel in front of the cards (0.90 × 0.56 m at 1.0 m, centred under the gaze when opened), one canvas (it
takes the lens's texture slot: 5 cards + timeline + bus window = 7).

- **Header:** `BUS · 9 variables` and the filter text; while paused `at −3.2 s`.
- **Inputs of the focused card** (top section): one row per input, `target ← target (default)` or
  `target ← gaze_hit (use)`, with the card's plug state.
- **Variables** (main table, alphabetical, built-ins last): name, kind/type, the current value (compact), messages per
  second, publishers → takers (card names); stale rows amber, contested rows marked `!`.- **Selection.** The row under the gaze highlights; ↑↓ / wheel / PageUp/PageDown move the selection; the cards that
  publish or take the selected variable get a highlighted frame.
- **Reassigning an input** (three ways, same result):
  - gaze: look at an input row, Enter or click; look at a variable row, Enter or click;
  - keyboard: Tab switches between the inputs and the variables, ↑↓ choose, Enter assigns, Backspace/Delete on an input
    restores the default; typing letters filters the variables;
  - command line: `use target gaze_hit`, `use target` (default).
- **Closing:** Esc clears the filter, then leaves the variables section, then closes; Mod+B closes.
- Refusals (type mismatch, unknown variable) show in the window's footer for 5 s.
- Repaint only on change, at most 4 times a second live.

## 4. Fixes from the v1 headset test

- **Mouse.** Shift+wheel (and a horizontal wheel or trackpad swipe): while paused it scrubs the timeline, while live it
  scrolls the focused card sideways. Mod+[ / Mod+] step the paused playhead by 0.5 s (with Shift 0.1 s); if the browser
  will not let the page take Cmd+[ on a Mac, the step keys become Mod+Alt+, / Mod+Alt+. (decided in the browser test: Mod+[ / Mod+] stay, see "As built", C).
  Holding the mouse button works for the plug gesture; the mouse position is `pointer_pos`.
- **Readable over passthrough.** Every floating text (timeline, notices, the bus window, card headers) sits on an
  opaque dark plate; line-font strokes 50 % thicker and text 30 % larger; idle cards at 85 % brightness (was 65 %); the
  code font bold.
- **Zoom.** Each card has three text sizes (26, 32 or 40 columns; rows follow the line height); Mod+= / Mod+- / Mod+0
  and Ctrl/Cmd+wheel on the focused card. Local to the headset, not saved.
- **Sideways scrolling.** A card scrolls horizontally to keep the cursor in view (two columns of margin); ◀ / ▶ marks
  show hidden text on either side. No soft wrap (line numbers, errors and cursor movement stay simple).

## 5. Commands and messages

- Command line: `card`, `rm`, `rename`, `undo`, `reset`, `revert`, `pause`, `live`, `play` as v1, plus `use <input> [variable]`,
  `plug`, `unplug` (the focused card). Removed: `rail`, `kind`, `undock`, and `rm`/`rename`/`undo` of rails.
- Wire `cmd` ops: add `use {module, port, variable: name|null}` and `plug {module, on}`; remove `addRail`, `rmRail`,
  `renameRail`, `kind`, `dock`, `undock`; `geometry` carries cards only. Snapshot: `rails` keyed by variable (no lane),
  plus `uses` and `unplugged`; `geometry` cards only.

## 6. Demo

oscillator → `target`; ball ← `target`; flowers ← `target`, → `planted`; constant → `center` (a fixed point, not `target`,
so nothing is contested). Demo: watch the ball chase the oscillator; `use target pointer_pos` on the ball (it follows the
mouse); `use target gaze_hit` (it follows the gaze on the mat); `use target center` (it goes to the centre); unplug
the oscillator (flowers stop; the bus window shows `target` amber, stale, with `-` as its publisher); Mod+B to see the whole bus.

---

# As built

Sections 1 to 6 above are the design; the plan's "Decisions" sharpened it while it was built (section C below says how).
Where this section and the design disagree, this section is right. What v2 did not change (the Worker, delivery,
recording, the watchdog, saving, pairing, the log) is described in doc/hw9-design.md and its "As built" (its ghost
run was removed: see steps 7 and 8 below and section C).

## A. Running the demo

The scene opens with the demo in `js/scenes/rails/data/layout.js` (the v2 layout: four cards, no `uses`, nobody
unplugged) and the four modules in `js/scenes/rails/modules/`:

| Card (slot, yaw) | What it does | Variables |
|---|---|---|
| `oscillator` (0, -50) | a target that sweeps over the mat | publishes `target` (state, vec3) |
| `ball` (1, -25) | an amber ball that chases the target | takes `target` |
| `flowers` (2, 0) | plants a flower at the target twice a second while it moves | takes `target`; publishes `planted` (event, num) |
| `constant` (3, +25) | a fixed point, the centre of the mat | publishes `center` (state, vec3), not `target`, so nothing is contested |

The built-in variables are `time`, `gaze_hit`, `gaze_on`, `pointer_pos` and `pointer_down`. So on load the ball follows
the oscillator by name, with no `uses`, and flowers grow where it goes.

**Setup** (as in doc/hw9-design.md, "As built", A)
1. Start the class server from the repository root with Node 18: `./startserver` (or `node server/main.js 2026 2026
   http`). Use `http://127.0.0.1:2026/` on the laptop and `http://<laptop LAN address>:2026/` from the headset. The
   server is plain http, so on the Quest enable the browser flag *Insecure origins treated as secure* for the laptop's
   address (README, "Run in VR"), then relaunch the browser.
2. **The laptop opens the scene first** (pick `rails`) and keeps that tab **in front** and **alone**: a hidden tab stops
   the runtime and its hang watchdog, and a second tab at the same rank can win the pairing. On a Mac, Cmd is Mod.
3. The headset joins (Quest browser, same URL, `rails`, enter VR). It becomes the IDE; the laptop stays the runtime. The
   cards are placed around your head when you enter VR (Mod+Home does it by hand). The laptop window shows a small HUD
   with the keys and what was typed last.
4. Alone on one device the scene is both roles. `?railsRole=ide|runtime|both` forces a role.
5. The `modules/` and `data/` folders under `js/scenes/rails/` must exist, because the server's file write does not
   create folders.

**Two-minute demo** (the laptop is the keyboard, mouse and wheel; the headset is the gaze)
1. Watch the ball chase the oscillator on the desk and the flowers grow. Look at the `ball` card for a third of a
   second, change its colour `'#ffb000'` to `'#44ddff'` and press **Mod+Enter**: the card reloads at once, keeps its
   state, and is saved a second later. Nothing in `ball` says who publishes `target`.
2. **The mouse.** With the `ball` card focused press **Esc**, type `use target pointer_pos` and Enter. The footer of the
   card now says `target ← pointer_pos`, and the ball follows the laptop's mouse over the 40 cm mat (the laptop window
   is the mat).
3. **The gaze.** `use target gaze_hit`: the ball follows where you look on the desk. When the gaze leaves the mat
   `gaze_hit` keeps its last value, so the ball rests (only `gaze_on` goes false).
4. **A fixed point.** `use target center`: the ball goes to the centre. `use target` (no variable) puts it back on its
   own name: it follows the oscillator again.
5. **Unplug.** Look at the `oscillator` card's plug (the small square under the middle of its bottom edge), hold the
   mouse button, look away from the bus, release: the plug hangs short with a hollow red dot and the card says
   `unplugged`. The flowers stop, the ball rests, and `target` goes stale (amber, `-` as its publisher). Plug it back: hold on the plug and
   release on the bus. (`unplug` and `plug` on the command line do the same for the focused card.)
6. **The bus window.** **Mod+B** (or look at the bus for 0.4 s). The variables are listed, the built-in ones last, with
   value, rate, who publishes and who takes; the focused card's inputs are on top. Look at the input row `target`, click,
   look at the variable row `center`, click: it is reassigned. Or Tab, type a few letters of a name to filter, Enter.
   Backspace on an input puts it back. Esc clears the filter, then leaves the list, then closes.
7. **Pause and look at the past.** **Mod+P**. Shift+wheel scrubs (100 wheel units = 1 s); **Mod+[** / **Mod+]** step the
   playhead by 0.5 s (with Shift 0.1 s). The scene goes back with the playhead: the ball and the flowers on the mat are
   where they were then, the bus window shows the values of then, the mat's outline is amber and the timeline reads
   `PAST −3.2 s` with the hint `Mod+Shift+Enter here · Mod+P now`. **Mod+.** plays the past at normal speed (the scene
   moves as it did); **Mod+P** goes back to now.
8. **Continue from here.** Fix the code live (for instance the `6` in `Math.exp(-6 * dt)` on the `ball` card), pause,
   rewind to before the bug, and press **Mod+Shift+Enter** (or type `here`): the new code runs from the old state. The
   world goes live from the playhead with the data (module state, values, devices) of that moment and the code, cards
   and wiring of now; a notice says `continued from 12.4 s`. What was recorded after the playhead is gone, and the tape
   starts again from there. At the end of the timeline it is the same as **Mod+P**. While paused **Mod+Enter** sends
   nothing (the edit stays in the card): it says `paused: Mod+Shift+Enter continues from here, Mod+P returns to now`.
9. **The watchdog.** On the `constant` card type `while (true) {}` and press Mod+Enter: within about half a second the
   laptop restarts the Worker, the card is quarantined ("hung"), the other cards go on, and that source is never saved.
10. **Zoom and sideways scroll.** Ctrl+wheel (a trackpad pinch) or Mod+= / Mod+- zoom the focused card between 26, 32
    and 40 columns, Mod+0 resets. A wheel swipe to the side, or Shift+wheel, scrolls a long line sideways (live); the
    ◀ ▶ marks show hidden text.

## B. Controls

| Input | Does |
|---|---|
| look at a card for 350 ms | focuses it (a 1 s typing lock holds the focus while you type) |
| letters, arrows, Home, End, PageUp/Down, Tab (2 spaces), Backspace, Delete, Enter | edit the focused card |
| Mod+Enter / Mod+Shift+Enter | commit (hot reload; paused: nothing is sent, the card says how to go on) / paused: continue from the playhead (live: "live already") |
| Mod+Z, Mod+Shift+Z (Mod+Y on a PC), Mod+Backspace, Mod+V | undo, redo, delete to line start, paste |
| Cmd+Left, Cmd+Right (a Mac) | the cursor to the start or the end of the line |
| Mod+P, Mod+. , Mod+Home | pause or return to now, play the past from the playhead at normal speed, recentre the workspace |
| Mod+B | open or close the bus window |
| Mod+[ , Mod+] (Shift: 0.1 s) | step the paused playhead back or forward by 0.5 s; they repeat when held |
| Mod+= or Mod++, Mod+-, Mod+0 | zoom the focused card in, out, back to 32 columns |
| Esc | with the bus window open: clear the filter, then leave the variables, then close; otherwise open the command line; Esc on an empty line releases focus |
| command line | `card <name>`, `rm` (twice within 3 s), `rename <name>`, `undo`, `reset`, `revert`, `pause`, `live`, `play`, `here`, `use <input> [variable]`, `plug`, `unplug` |
| mouse move over the laptop window | `pointer_pos`, the position on the mat |
| mouse button | `pointer_down`; with the gaze on a plug it grabs the plug (release on the bus plugs, elsewhere unplugs); with the gaze on the bus window it is a click on a row |
| wheel up/down | scrolls the focused card (3 lines per 100 units) |
| wheel left/right, or Shift+wheel | live: scrolls the card sideways (6 columns per 100 units); paused: scrubs the playhead (100 units = 1 s) |
| Ctrl/Cmd+wheel, pinch | zooms the focused card (wheel up = in); never the page's zoom |
| gaze on the bus for 0.4 s | opens the bus window (not while a button is held or a plug is in hand) |
| gaze on a plug (5 degrees) | the plug is the target of a press, and is highlighted (bigger, yellow); once on it the gaze stays on it until it is beyond 7 degrees; a press takes a plug that was the target within the last 0.2 s |
| the gaze cursor | a small ring (0.6 degrees across, dark outline, bright body) where the head's ray meets the open bus window, a card, a plug, the bus band or the desk mat, whichever is nearest, else on the 1.25 m cylinder. On a plug it grows; on the bus it is amber and fills over the 0.4 s of the window opener; on a card it fills over the 350 ms focus dwell; with a plug in hand it is solid. The ray is smoothed (60 ms time constant, whatever the frame rate), and the cursor and every hit test use the smoothed ray. A plug under the gaze comes before the bus band under it, so the window opens from the band between the plugs |

Never taken from the laptop's browser: Mod+W/T/N/Q/R, F5, F11, F12, Ctrl+Tab, Alt+Tab.

## C. Decisions, in plain words, and why

These are the plan's binding decisions, which sharpen the design above.

- **Names.** The built-in variables are `time` (the clock), `gaze_hit`, `gaze_on`, `pointer_pos`, `pointer_down`. The
  devices keep their ids and ports (`clock.time`, `gaze.hit`, `pointer.pos`, ...) in the `dev` messages; only the
  variable names are new. A module's output named like a built-in is a setup error (`gaze_hit is built in`), and the
  64-variable limit counts the five. *Why:* the wire between the laptop and the headset stays as it was, and a module
  cannot shadow a device.
- **Shapes.** A variable's kind and type come from its first publisher. Another output of that name must match both
  exactly (`any` matches only `any`), or the later module has a setup error: `target is state vec3 here but event num in
  ball` (the other side named is the oldest docked module). An input binds with the dock check (`any` takes anything). An
  input whose same-name variable has an incompatible shape stays unbound, with no error; the card's footer says why. A
  variable with no publisher keeps its shape while something takes it; with no port docked it is swept at the end of the
  structure phase, never in the middle of a swap (a same-shape port re-docks first, so value, sequence and tail
  survive). *Why:* a publisher decides what a name means, a reader can be forgiving, and a reload must not lose data.
- **Conflicts are checked when a command is queued**, against a projected view that includes the queued commands
  (`addModule`, `reload`/`commit`/`revert`, `use`, `plug`, `rm`, `rename`). So a reload that would change the shape of a
  variable another card takes (`target is state vec3 (taken by ball), but event num here`), a 65th variable (`too many
  variables (64)`) or a built-in name is refused with its reason before anything changes. The count of 64 ignores
  variables a queued sweep would free. *Why:* a refusal that leaves the old version and its takers untouched is better
  than a half-applied change.
- **`use`** is refused if the variable does not exist, the port is not an input, or the shapes do not fit. `uses` in a
  loaded layout or a restored snapshot are only **preferences**: an entry naming a variable that does not exist yet
  waits for it. A reload that drops an input that has a `uses` entry drops the entry, with a notice. `use`, `plug`,
  `rename` and `rm` keep `uses` and `unplugged` consistent (rename moves them, rm drops them; undoing a removed card
  restores its source, its `uses`, its plug state and its unsaved text). *Why:* a typed command should fail at once, a
  saved layout should survive being loaded before the card that publishes.
- **Plug.** An unplugged card has no docks: it receives nothing (not even `time`) and publishes nothing. A state
  output's `set()` while unplugged is published, as its latest value, when the card is plugged in; an event `emit()`
  while unplugged is dropped. `use` and `plug` while paused are acked at once and applied at the resume (the bus window
  and the card say "applies when you resume"). `rm`, `rename` and a new card are refused while paused. *Why:* events are moments, state is a level.
- **Snapshot.** The head always carries `vars` (sorted names, at most 64), `uses` and `unplugged`; `geometry` has cards
  only; `rails` entries have no lane; `rev` changes on `use` and `plug`. The IDE drops rails that are not in `vars`
  (a name in `vars` with no rail yet is on its way, not missing). `uses` and `unplugged` are bus state: they are in the
  bus snapshot, so a Worker restart keeps them, and that snapshot wins over the layout, which supplies sources and
  slots.
- **Layout.** `{cards: {id: {slot}}, uses, unplugged}`. A v1 layout still loads, by these rules: a v1 rail's variable is
  the port name of its first publisher (the rail `clock` is `time`); an input docked to that rail gets no entry if its
  name matches, else a `use`; a rail fed by a device dock (`dev:<d>.<p>`) means every input docked to it, with no other
  override, gets `use` of that device's variable; a card whose outputs were all undocked becomes `unplugged`; rails and
  lanes are ignored.
- **Recorder.** The bus's automatic docks are ordinary `dock` ops on the tape. The recorder also notes, for the rail of
  every `dock` op, its kind and type at that moment, so a variable created, docked and swept inside the window is still
  known to the replay of the past. Accepted: a variable removed and made again with another shape inside the window is
  not replayed exactly.
- **The paused scene is the past.** While paused, the runtime runs every module again from the tape (a private manual
  bus, `new Bus({seed, auto: false})`, started from the snapshot before the playhead; docks, undocks, reloads and the
  other structure operations are replayed from the tape), and the draw lists of the snapshot are the ones of that
  moment. The IDE does nothing special: the stage draws what the snapshot says. At the end of the timeline the live
  world is the scene. *Why:* the user paused and scrubbed in the headset and saw the timeline move but the scene stay;
  a scrub that does not go back is not a scrub.
- **The ghost was removed.** The edit-while-paused replay of one module (a violet card, translucent shapes, a second
  value in the bus window) is gone, with its commands `ghost` and `adopt`. *Why:* the user tried it and found it not
  useful: a second, dimmer copy next to the real scene is harder to read than the scene itself going back, and it
  needed its own run, tolerances and a longer watchdog leash.
- **Continue from here keeps the code of now.** `resumeHere` takes only the world's data from the playhead (module
  state, variable values, devices) and keeps the cards, sources and wiring of now. *Why:* going back in time to fix a
  bug must not undo the fix; "fix the code live, rewind to before the bug, continue" is the whole use. The tape before
  the playhead is dropped (the new present has no other past), and Mod+P stays the way back to now.
- **Default code zoom** stays 32 columns at 29 px (zoom index 1 of 26/32/40 columns). "30 % larger" in the design means
  the floating line-font text, not the code.
- **Bus window inputs.** A click on a row never reaches `pointer_down` or starts a plug grab; while the window is open Esc
  belongs to it (filter, then section, then close), so the command line opens only after the window closes. Zoom-in
  takes `=` and `+`. While paused the sideways wheel scrubs (a card does not scroll sideways then; the keys still move
  its cursor).
- **Rates** in the bus window are worked out by the IDE (change of the message count over the last second of live
  snapshots) and are blank while paused. A variable that the tape has nothing for at the playhead (it is published
  later) has a blank value while paused, not its live one.
- **The selected input.** When the window opens on a card, the selected input is the first one with a problem
  (incompatible, then waiting), else the first that is not `time` (every demo card has it, and it cannot be assigned),
  else the first; once the person moves the selection it stays.
- **Mod+[ and Mod+]** stay the step keys (the design allowed Mod+Alt+, and Mod+Alt+. if the browser would not give them
  to the page): in Chromium the page gets a real Ctrl+[ and Ctrl+] key event and its `preventDefault` stands (browser
  test, headless Chromium on Linux; as far as we know Chrome has no accelerator of its own on them there). Not checked here: Cmd+[ on a
  Mac, where Chrome's Back is on that key, and Firefox (Ctrl+[ is Back there). If the headset test finds them taken,
  the bindings are two entries in `keymap.js` (`STEPS` and `STEP_CODES`), with the HUD line in `terminal.js`.

## D. What changed during implementation

- **The bus wires itself, and v1's wiring is gone.** The flip was done last: `Bus` defaults to the wired mode and
  `Runtime` has no other. The commands `dock`, `undock`, `addRail`, `rmRail`, `renameRail`, `kind`, `geometry.rails`, the
  lanes, pins, device cards and the lens (code, drawing and their tests) were deleted. The one thing kept of v1 is the
  manual bus, only for the replay of the past; on a wired bus the manual commands refuse with "the bus wires itself", and on
  the manual bus `use` and `plug` refuse.
- **New tape ops `rail` and `unrail`** (a variable made, a variable swept), and segments that carry the state inputs
  docked between steps. So the scrub (`railsAt`) equals the live bus, including which variables exist, and a card added
  on a segment boundary still gets its retained value in the replay.
- **Uses are preferences.** An entry for a variable that does not exist yet waits; there is no fallback to the same name.
  `use x x` is a reset when `x` exists, and refused (no such variable) when it does not.
- **Identity rules.** The IDE keeps the same object for `vars`, `uses`, `unplugged` and each card's `bindings` while they do
  not change, and the bus window keeps the same view and the same row objects, so drawing can skip. Nothing is
  allocated per frame when nothing changed.
- **Pulses on the bus (a fix after the first version flooded it).** A device (clock, gaze, pointer) never pulses. An
  event always pulses; events on one route less than 0.1 s apart merge into one longer, brighter pulse. A state variable
  pulses at most once per route per 0.3 s, and only if somebody takes it. The band is a neutral grey. *Why:* the first
  version had up to 60 pulses alive and 73 drawn nodes for the demo; now at most about 9 alive and 22 drawn.
- **Repaint caps.** The timeline strip repaints at most once a second live. The bus window repaints at most 4 times a
  second live (0.1 s paused); a change the person made (selection, filter, opening) is painted at once but at most 20
  times a second; a change of only the hovered row at most 10 times a second.
- **Cards.** The footer lists each port's binding, problem ones first (`+N` hides the calm ones); an unplugged card is
  dimmed to 0.85 times the idle or hover brightness unless focused; a card that publishes or takes the variable selected in the bus window gets a 5 mm
  outer frame; line-font text has opaque plates, except the stage's text, which has none.
  A focus change no longer moves a card's view: it moves only with its own cursor, an edit or a zoom. A zoom step is
  40 wheel units (a lone notch is one step at once); the part of a step is forgotten after 200 ms without a zoom event.
- **Demo and text.** The v2 demo layout is the committed one; `constant` publishes `center`; the card skeleton's comment
  says the bus wires by name, and its output is a variable named after the card (so two new cards never publish the same one); the laptop HUD lists the mouse and keyboard bindings and the plug gesture.
- **The browser test** (section F) found three things about v2 that the design did not say: an unplugged card also gets
  no `time`, so it does not run at all (the replay over a window in which a card was unplugged counts that card's steps
  from its replug); and a variable that only an unplugged card published and nobody takes is swept. (It also found
  that a refused `use` still said "the rail is …", the v1 word; it now says "the variable is …".)
- **A test hook:** `ide.test.view` (the last view the IDE core made), so the browser test can read the bus window and
  the plug in hand.

## E. Known limitations

What a user can meet:
- A `use` or `plug` that the Worker acked, in the same tick in which the Worker restarts (a hang), is lost; as is the one
  retained delivery of a card added just before the restart. Use the command again.
- A v1 layout on disk is converted when it is read, but written as v2 only after the first change of structure.
  Converting merges or splits v1 rails by the port names of their first publishers, and a rail with no publisher keeps
  its own name (its inputs wait). The committed v1 demo converts with `constant` unplugged.
- In the paused view only the pictures (`draw`) and the values on the bus are the past. A card's status, its error and
  its logs are the live ones (a card that is quarantined now shows its error while it draws the picture of then).
- The past is exact for what a module keeps in `state()`. A module that keeps memory outside `state()` (a top-level
  `let`) restarts that memory afresh when a replay starts from a snapshot, and so does `continue from here`. A
  variable removed and made again with another shape inside the window is not replayed exactly.
- Continuing from here loses the tape before the playhead (the window starts again at the playhead) and what a
  snapshot lacks: the memory outside `state()` and messages in flight at the playhead (only a feedback cycle has any).
  The live run after it equals a runtime restored from that snapshot, not necessarily the old timeline stepped on. A
  device port that is not docked keeps its value from the last snapshot.
- A backward seek restarts the replay from the snapshot before the playhead (up to 60 steps, a few milliseconds with
  four cards); a module whose step costs several milliseconds makes it slow, and the 500 ms watchdog catches one above
  about 8 ms a step.
- While the bus window is open the plugs under it cannot be grabbed (close it first), and Esc closes it before it opens
  the command line.
- The window lists at most 4 inputs of the focused card (`+N more`); `use` on the command line reaches the rest. It shows
  9 variables at a time (the wheel and the arrows scroll).
- A `use` queued while paused applies at the resume; the card says so, and the window shows it until the head does.
- Undoing the removal of a card sends each `use` once; one whose variable has gone meanwhile is refused.
- Only committed sources are saved; two-laptop-tab pairing, the plain-text relay, the sandbox that can be escaped and
  one pair at a time are as in doc/hw9-design.md.
- A `use` or `plug` queued while paused (acked, waiting for the resume) is lost if the Worker restarts before the resume,
  for instance when a hang makes the watchdog restart it. Use the command again.
- `rm` and `rename` are refused while paused (`paused: Mod+Shift+Enter continues from here, Mod+P returns to now`), like a new card, and so is `commit`
  (Mod+Enter: the IDE says the same without sending it). Return to now or continue from here first.
- The gaze that opens the bus window from the bus lands near the window's bottom edge: look up to the rows.
- Cmd+[ and Cmd+] on a Mac, and Firefox, were not tried (section C).

**Only a headset can check:** that the text is legible on the plates over the passthrough (the code font at 26, 32 and
40 columns, the 18 px binding lines, the 22 px bus window), the 2 cm bus band and 1 cm plugs at 1.25 m, the 3 degree
plug zone and the 1.5 degree bus zone with a real head, the 0.4 s gaze open, whether the plates z-fight at distance
(`PLATE_Z` in `glyphs.js`), the feel of 40 wheel units per pinch step (`ZOOM_UNITS` in `terminal.js`), the frame cost
on a Quest (the bus is one mesh, at most about 22 nodes in the demo, 7 textures), the Mac keyboard, and whether the
`PAST −3.2 s` label, its hint and the amber mat outline are legible and noticed over the passthrough.

## F. Tests

Node 18 (`source ~/.nvm/nvm.sh && nvm use 18`), from the repository root; each prints how many checks passed:

```sh
for t in rails rails-ui rails-link rails-view rails-ide doorways doorways-pair miniature echohunt; do
  node tests/$t.test.cjs || break; done
```

Counts now: rails 174, rails-ui 57, rails-link 149, rails-view 76, rails-ide 91, doorways 47, doorways-pair 18,
miniature 34, echohunt 16.

- `rails`: values, sandbox, the bus (wired and manual), lifecycle, recorder, the replay of the past (it equals the live run at every
  step through `use`, unplug, reloads, cards added and removed, cycles and variables made and swept inside the window) and
  `resumeHere`, the runtime (commands, the
  snapshot head, layout v2 and the v1 conversion, 64 variables), the demo by name.
- `rails-ui`: text buffer, keymap, gaze focus, layout hit tests (bus, plugs, bus window pixel), the command parser, the HUD key list.
- `rails-link`: wire, link and pairing, store, terminal (wheel, zoom, Shift+wheel), host and Worker (a real Worker thread
  for a hang).
- `rails-view`: cards, timeline, bus, bus window and the Clay-side parts, with fake contexts (node counts, repaint
  policy, seven canvases, and the bus against a real runtime).
- `rails-ide`: the IDE's state machine against a fake link and against a real `Runtime` (bindings, `use`, plug gesture,
  bus window, zoom, scroll, scrub, step keys, continue from here and its refusals, no ghost in the code).
- Browser: `tests/rails-browser.test.cjs`, one headless Chromium on a routed relay that works like the class's (the real
  server serves the files; `saveScene`, `/log` and `/set` are answered locally and any other POST fails the test, so
  nothing is written to the repository). It takes about two minutes. Phases: **A** a stray client that says hello (the
  pairing is not mutual) and talks; **B** pairing, a stray again, commands, saving a second after a commit and not
  before, a real hang that restarts the Worker and quarantines the module, the log lines, a reload that pairs again;
  **B2** typing 200 characters, commit, a syntax error, a typed `while (true) {}`, the plug grab (unplug, plug, a blur
  that cancels it), a stale key; **B2b** a waiting input, `use`, a retained value, a refusal, a dropped `use`; **B2c**
  seven canvases, the strip's repaint rate, full slots, pause, scrub and play; **B2g** the past (pause, seek back: the
  drawn ball is the recorded one; Mod+Shift+Enter: live again from that position, with the code of now); **B3** a Mac laptop (Cmd is Mod); **V** the
  repository's own demo: the ball follows the oscillator with no `uses`, `use target pointer_pos` and the real mouse,
  `gaze_hit`, `center`, reset, refusals, the oscillator unplugged (the flowers stop, `target` goes stale) and
  plugged back, the bus window (gaze open, Mod+B, rows, a gaze click and keys reassign, Esc in steps), Shift+wheel and
  Mod+[ / Mod+] on the paused playhead (and that a real Ctrl+[ is prevented), Ctrl+wheel and Mod+= / Mod+- / Mod+0 zoom,
  sideways scroll of a long line, at most 30 bus nodes drawn, seven canvases; **C** one page forced to `both` (the
  texture channels are the scene's own and all given back, the Worker is gone on leaving, a second visit works);
  **D** roles that are not forced.
  Safety: check `free -m` first (at least 3000 MB available), one browser at a time, start the server and stop it
  inside the same command, use 127.0.0.1, `timeout 400`, and finish with `pgrep -af "server/main.js"` and
  `pgrep -af chrom` showing nothing (kill exact PIDs, never `pkill -f`). Node-side times use `performance.now()`
  (the wall clock of WSL2 jumps). Playwright lives in `~/.cache/doorways-pw`:

```sh
P=~/.cache/doorways-pw
(node server/main.js 2026 2026 http > /dev/null 2>&1 & echo $! > /tmp/rails-server.pid); sleep 3
XR_TEST_URL=http://127.0.0.1:2026/ LD_LIBRARY_PATH=$(find $P/libs -type d | tr '\n' ':') \
  NODE_PATH=$P/pw/node_modules timeout 400 node tests/rails-browser.test.cjs
kill $(cat /tmp/rails-server.pid)
```
