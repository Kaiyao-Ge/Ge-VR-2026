# HW10: AI attends where you don't — a future mixed reality workspace (design)

## 1. Intent

The assignment (not a programming assignment) asks for a vision, in words and pictures, of an ideal future mixed reality
workspace and workflow, single-user or collaborative, with much better XR wearables and reasonable future AI, walked through at
least one specific use case. As inspiration it points to *The Way Things Work* (Simon and Schuster, 1967, credited to "various"
authors; an illustrated encyclopedia of technology; https://archive.org/details/waythingswork0000vari_j3y5/). The item is
access-restricted (a free Internet Archive account is needed), so its chapters were not checked: the page names no chapter
or page of the book.

The author's vision, in one line: **where you are looking you need no help; the AI attends to everything you are not looking at.**
The glasses are senses and a display, kept light; the thinking happens elsewhere. The deliverable is a simple web page: an
illustrated essay with small interactive figures. Readers are the instructor and classmates; success is a reader who finishes the
page convinced the idea is coherent, useful, and buildable, and who remembers the one line above.

## 2. The ideas (decided with the author)

**2.1 The attention complement.** The human visual field is about 200° wide, but sharp vision (the fovea) covers about 2°; the
rest is low in detail and colour and good mainly at motion. Attention is narrower still: in Simons and Chabris's "gorilla"
study (1999) about half of the viewers missed a person in a gorilla suit walking through the scene. The glasses' cameras see the
whole field (and more, to the sides and behind); eye tracking says where the 2° is; the AI works on the rest, the complement.
It never comments on what you are looking at unless you ask.

**2.2 Senses on the head, thinking elsewhere: reflexes only on the glasses.** The author's starting point was "no computation
on the glasses at all". Refined, with the author's agreement: the glasses do only reflexes, sorted by how long a task can wait.

| Tier | Like | Waits at most | Runs |
|---|---|---|---|
| Glasses | the spinal reflex | milliseconds | keeping the picture stable as the head turns (~20 ms), eye tracking, "something is approaching fast" |
| Pocket device (phone or puck) | the cerebellum | ~100 ms | small models: OCR, object detection and search, speech to text, a small video model (V-JEPA-like) |
| Cloud | the cortex | seconds | the LLM: summaries, minutes, turning the board's text into a clean PDF |

Raw video and audio never leave the pocket device; only semantic events go further ("the scissors are at the top left of the
desk"), which saves bandwidth, battery and privacy at once. Danger warnings must work with the link down, so they run on the
glasses and the pocket device. First-hand evidence from HW9: in a Quest headset the frame rate fell from 82 to 29 fps in about
six minutes while the scene's own code stayed under 1 ms a frame and its memory flat; the limit on the head was heat, not code.

**2.3 The display: a quiet fovea.** The AI never draws inside the 2° you are looking at (unless asked). Cues come from the
edge of the field, where vision is most sensitive to motion and light, to pull attention. An escalation ladder, from least to
most intrusive: a glow at the edge → a directional sound → a line of text → a haptic tap → a forced overlay (real danger only).
Gaze is also input: look at a cue and it opens; look away and it goes.

**2.4 External memory.** The AI has seen what you did not, so you can ask later: "where did I put my keys", "what was on the
third line of the board", "who said the deadline". It keeps semantic events (what, where, when), not video. (The same idea as
the HW9 tape and replay, moved into the real world.)

**2.5 Senses beyond the eye.** Wider-than-human binocular cameras, a thermal camera (a soldering iron left on, a hot cup), depth
(a step, an obstacle), a microphone array (where a sound comes from; someone saying your name), a bone-conduction microphone
(this voice is the wearer's). These rest on the kind of principle *The Way Things Work* illustrates — lenses and cameras,
echo ranging as in sonar (the author's HW6 Echo Hunt was echolocation), infrared, telling direction from the time difference
between two microphones (as between two ears), radio links — which is how the page ties to the book.

**2.6 Removed by the author:** reading other people's screens. It is not mentioned anywhere.

## 3. The scenario (decided): a project group discussion, one afternoon

The author, a student, meets four teammates in a discussion room. **Everyone in the group wears the glasses.** Five scenes, each
told the same way: what you are looking at, what the AI is looking at, and which idea from section 2 it shows. (My calls: the
group is planning its final project for this VR course, which gives the board and the dialogue real content; four teammates
with plain first names.)

1. **Before leaving: the USB drive and the keys.** Last night you put the USB drive down without looking at it; the wide camera
   saw it. You ask "where's my USB drive?"; the AI finds the last sighting in its memory and lights a direction cue at the edge of
   your view; you turn, and its corner, poking out under a pile of books, is highlighted. Then the keys. (2.1, 2.4)
2. **Apartment to the discussion room: navigation and danger.** The route is a thin line on the ground at the bottom of the view,
   never across the centre. You look down to answer a message; a bicycle comes from behind on your side, inside the cameras'
   view and outside yours; the ladder goes from a directional sound up to a forced overlay as it gets close. This runs locally
   and works with the link down. (2.2, 2.3, 2.5)
3. **In the room: the whiteboard.** You watch the teammate who is talking while another writes on the other side of the board.
   The AI reads the board while you are not looking, keeps every version (also the ones erased later), and exports them all as a
   PDF at the end. (2.1, 2.4, and section 4's relay)
4. **In the room: the spoken discussion.** Who is speaking and from where; when someone says your name or "your part", even while
   you are looking at your laptop, a cue at the edge and the last sentence as text. (2.3, 2.5, section 4's own-voice rule)
5. **The AI summary.** The LLM merges the board PDF and the transcript into minutes: decisions, action items (who, by when), open
   questions; every item links back to the sentences and the board version it came from. Each member also gets "what you missed":
   the shared record minus what that member was attending to, the attention complement again. (section 4)

## 4. How the devices coordinate (decided)

**Three rules.**
1. *Each device is the authority on its own wearer.* My glasses know best what I say (closest microphone, bone conduction),
   where I look, and my private notes. So each device transcribes only its wearer's voice: no duplicates, no misattribution.
2. *The device with the best view does the work.* The board is not read five times: the room picks, per board region, the device
   with the most frontal, closest, unblocked view; when that wearer turns away the job passes to the next best (a relay). Together
   the five devices are one camera array and one microphone array spread over the room: less power, fewer blind spots (what one
   person blocks, another angle sees).
3. *Events are shared, never pictures or sound.* Raw video and audio stay in each pocket device; the room sees only events:
   board version 3's text, "A said this at 14:05", "someone is looking at the left half of the board".

**One bus in the room** (the HW9 idea): every pocket device publishes events by name and subscribes to what it needs, without
knowing who the others are. The bus runs on a small hub in the room, or on one phone the group elects; it gives a shared clock
(all events on one timeline, which can be scrubbed afterwards) and shared coordinates (on entering, every pair of glasses
anchors to the same whiteboard, so "top right of the board" means one place for all). Only text goes to the cloud LLM.

```
each member:  glasses (reflexes) → pocket device (small models) ──events──┐
each member:  glasses (reflexes) → pocket device (small models) ──events──┼→ room bus (room hub, or an elected phone)
                                                                          │   shared clock, shared coordinates (the board)
                                                                          │   merges: board versions, speech timeline,
                                                                          │   attention heat (group level only)
                                                                          └→ cloud LLM (text only) → minutes
```

**Integration.** Shared: the board PDF with every version, the transcript with speakers, decisions, action items and open
questions, each linked to its source. Personal: "what you missed" (above). Group attention is shown only as a whole — "nobody
has looked at the right half of the board", "question 3 got no answer" — never per person ("X has been distracted").

**Boundaries and failures.** On entering, the glasses ask "join the group session?"; only then do they join; leaving the room
leaves it. Scenes 1 and 2 (the USB drive, the walk) are private and never reach the group bus. A device that drops out is
covered by the others' views and microphones; if the hub fails, each device keeps events locally and merges them when it is back.
When two devices read a word differently, the clearer view wins, and a word nobody is sure of is marked in the minutes for a
person to confirm.

**People who are not in the session** (my call): passers-by on the street, anyone in the room who did not join. They are seen
only as anonymous objects ("a person", "a bicycle") for safety and navigation: never identified, never transcribed, never stored.
The pocket device drops raw frames as soon as it has made its events. F3's cyclist is such an object.

## 5. Goals, non-goals, anti-goals

- **Goals:** a page that states the thesis in one line, makes it felt in the first figure, walks the five scenes with a figure
  each, explains the three tiers and the room bus, ties to the book, and is honest about privacy and failure.
- **Non-goals:** a working system; anything in VR or in the Clay framework; hardware specifications beyond plausible assumptions;
  business models.
- **Anti-goals (a failure even if it technically works):** an AI that narrates what you are already looking at; anything that
  reads as surveillance (per-person attention scores, recording people who did not join); a feature list without a story;
  speculation stated as fact (future assumptions are marked as assumptions); illustrations copied from the book.

## 6. Approaches for the page

| | Approach | Trade-off |
|---|---|---|
| **A (picked)** | An illustrated essay: read top to bottom, each small interactive figure next to the paragraph it explains, each independent. | Fits "words and pictures" best, reads easily, easiest to build and fix (one broken figure breaks nothing else); no single big set piece. |
| B | One map (apartment → street → room) and a timeline: scrub through the afternoon, two fields of view and the bus events in a side panel. | Striking, echoes the HW9 replay; much more work, and the argument (ideas, architecture, privacy) is squeezed into a side panel. |
| C | Slides, one idea or scene per slide, arrow keys. | Good for presenting in class; figures are cramped and it reads as an outline, not an essay. |
| (dropped) | A VR scene in Clay. | The assignment is explicitly not programming; heavy, and harder for a reader to open. |

The author picked A. From B, one cheap piece is kept (my call): a small "one afternoon" strip near the top, the five scenes on a
timeline, each a link to its section.

## 7. The page (decided parts)

**Order.**
1. Title, the one-line thesis, a short paragraph, the "one afternoon" strip.
2. *Where you look, you need no help* — the attention complement (F1).
3. *Senses on the head, thinking elsewhere* — the three tiers with the HW9 evidence (F8); senses beyond the eye and the book
   (F9); the quiet fovea and the escalation ladder (introduced here, shown in F3).
4. *One afternoon* — scene 1 (F2), scene 2 (F3), entering the room and joining the session: the room bus (F6), scene 3 (F4),
   scene 4 (F5), scene 5 (F7).
5. *Boundaries* — consent, private versus shared, failures, what the AI never does.
6. *Closing* — the line restated; a short note on where the ideas came from in the author's earlier work (HW6 echolocation,
   HW9 one bus and replay).

**Figures.** Each has a caption that says what it shows, so the essay reads without touching anything, and its first state
already shows the point.

| | Figure | The reader does | The reader learns |
|---|---|---|---|
| F1 | A room seen through the eye: drag the gaze point; a 2° sharp spot, the rest blurred and pale; toggle "what the glasses see": all sharp, with what the AI found in the complement marked. | drag, toggle | how small the 2° is, how big the rest |
| F2 | A messy desk from above, last night's gaze trail (never on the USB drive), the camera's wide view; ask "USB drive" or "keys": an edge cue, then the highlight. | click a question | memory of what you did not attend to |
| F3 | A street from above: your field of view while looking at the phone, the cameras' wider field; drag the bicycle along its path; the ladder step lights by time to contact; toggle "link down": the warning still works. | drag, toggle | the escalation ladder; reflexes stay local |
| F4 | The whiteboard over time: a slider through its versions, also after an erase; per region, whose device is reading it, passing on when someone turns. | slide | capture while you look elsewhere; the relay |
| F5 | The table from above, five members: who is speaking, from where; each device transcribes its wearer; play "someone says your name while you look at the laptop": the edge cue and the last sentence. | play | own-voice rule; the name alert |
| F6 | The room bus: each member's glasses → pocket → room bus → cloud; click an event kind (board text, an utterance, attention, raw video) to see how far it travels (raw video stops at the pocket); toggle "a device drops", "the hub fails". | click, toggle | what is shared; local first; failure |
| F7 | The minutes: decisions, action items, open questions; click an item to see its sentences and board version; toggle "everyone" / "what you missed". | click, toggle | integration; the personal complement |
| F8 | The three tiers: tasks placed by how long they can wait; click one for why it sits there (latency, power, privacy); a small chart of the HW9 frame rate over minutes. | click | why thinking leaves the head |
| F9 | The glasses taken apart (an original line drawing): each part (wide cameras, eye cameras, thermal, depth, microphone array, bone-conduction microphone, speakers) with the principle behind it and what it adds. | hover or tap | senses beyond the eye; the book |

**How interactive** (my call). Every figure is a scripted illustration with hand-made states, never a simulation. F1, F2, F3,
F6 and F7 carry the argument and are fully interactive. F4 and F5 are playback through prepared states (a slider or a play
button). F8 and F9 only reveal on click, hover or focus. If time runs short, simplify in this order, to a static figure with its
caption: F9, F8, F5, F4. F1, F2, F3, F6 and F7 are never cut.

**Sources and numbers** (my call). The physiology figures (about 200° of field, about 2° of sharp vision) and the gorilla study
(Simons and Chabris, 1999, "Gorillas in our midst") are cited in a short Notes list at the end of the page. The tier latencies
(~20 ms, ~100 ms, seconds) are labelled as design targets, not measurements. The HW9 numbers are real, from the headset log of the
test on 2026-11-17 (one report every 5 s, in VR, laptop and headset paired). F8 plots these, sampled every 20 s:

| time (s) | 5 | 25 | 45 | 65 | 85 | 105 | 125 | 145 | 165 | 185 | 205 | 225 | 245 | 265 | 285 | 305 | 325 | 345 | 365 | 385 | 405 | 425 | 445 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| fps | 82.5 | 60 | 48.9 | 44.2 | 42.5 | 40.7 | 43.1 | 37.8 | 36.3 | 34.9 | 34.4 | 32.7 | 31.9 | 30.2 | 30.8 | 30 | 30 | 29.2 | 28.7 | 28.2 | 27.6 | 27 | 29.2 |

Over the same span the scene's own code took 0.26–0.89 ms a frame (mostly 0.6–0.9 ms), and the JavaScript heap stayed at 42.1 MB.

**Accessibility** (my call). Every drag has a keyboard alternative: arrow keys on a focused handle, or a range slider. Controls are
real buttons. What opens on hover also opens on focus and on tap.

**Constraints.**
- Plain HTML, CSS and a little plain JavaScript; figures in inline SVG; no framework, no build step, no network requests or
  external files (system fonts), so the page opens by double-click (`file://`) and from the class server alike. Hence classic
  `<script src>` files, not ES modules (Chrome refuses modules from `file://`).
- Files (my call): `hw10/index.html`, `hw10/style.css`, one `hw10/figures/<name>.js` per figure; on a new branch `hw10` made from
  `hw9` when building starts. The class server serves files as they are, so the page is at `/hw10/` with no index link or
  manifest.
- English, plain words, short sentences; about 2,000–2,500 words, about ten minutes to read (my call).
- Laptop browsers first (Chrome, Safari); readable down to a phone's width; light and dark themes; motion respects
  `prefers-reduced-motion`.
- All drawings original; nothing copied from the book.

## 8. Left to the builder

The visual style and colours, the exact prose within the decided ideas, each figure's internals and animation, the sample content
(desk objects, the board's text, the dialogue lines, the minutes) within the scenario, and the exact word count within the range.

## 9. Revision 2: the visual pass (approved 2026-11-24)

A full read-through of the built page found: text from 12 to 34 px (figure labels larger than h2), scene titles smaller than
body text, the scene strip scrolling away and wrapping, F7 and F8 looking like another product's UI, F1 labels sitting on
lines, four figures taller than one 847 px screen (F4 1307, F7 1280, F6 1151, F5 1086), controls far below the drawing they
change, F7's evidence card floating under the list, F1's key toggle a small button, dense paragraphs, each interaction told
three times, and no picture at the opening. The cause of most of it: figures stretch to about 1050 px, so their SVG text
scales up and their height grows, and the controls sit under the drawing. Decided (the author approved all of it):

1. **Type scale (laptop).** Body text 18 px; h1 about 44 px; h2 30 px; scene titles (h3) 24 px with a small "Scene N" label
   above them; captions 15 px; SVG text inside figures renders 15–17 px at a 1280 px window; HTML text inside figures at least
   15 px. On a phone the old rule stays: every SVG text at least 10 px real font size at 375 px (Ruling 4).
2. **Figures in two columns.** On a wide screen a figure is the drawing on the left (its width chosen so its SVG text lands
   at 15–17 px, about 460–520 px) and a side column on the right with the controls, the status line and any panel, top-aligned
   with the drawing. On a narrow screen they stack: the drawing, the controls right under it, then the caption under both.
   Every figure is at most 760 px tall in a 1280 × 847 window.
3. **One drawing language.** The HTML parts of figures (F7's list and evidence, F8's tiers and "why" panel, F9's panel,
   F4's PDF list, the status lines) take the drawings' style: 2 px ink borders, the same 8 px radius, text at least 15 px.
   F7 puts the list on the left and the evidence on the right, top-aligned.
4. **F1.** No label sits on a line (mug, laptop, phone, keys, bag, "the whole field: about 200°" move into clear space). The
   toggle becomes a two-option switch above the drawing: "My eye" / "What the glasses see".
5. **Navigation.** The strip becomes a bar fixed at the top with short labels — "1 USB", "2 Walk", "3 Board", "4 Talk",
   "5 Minutes" — one line on a phone; the scene being read is highlighted as you scroll; the links still jump to #scene-N.
6. **Opening.** F1 moves up to right after the thesis line, before the introduction, so the first thing a reader sees is the
   2° dot in the blurred room. #complement keeps its text and refers to the figure above.
7. **Density.** #joining's three rules become a three-item list; #boundaries becomes a list; each interaction is told once:
   the caption says what to try, the status line says what is shown now, and the prose drops its "In the figure, …"
   sentences. The word count stays within 2,000–2,500.
8. **Buttons.** At least 40 px tall, ink text with a 2 px border; the selected one solid accent; a visible focus ring.

## 10. Revision 3: one idea, four scenes (the author's spec, 2026-11-24)

The author rewrote the page's content and order for a live, figure-led presentation: about 400 words of body text (about
1,000 on the page by default), one idea stated twice (hero and closing), a hero with F1 in the first screen, a Glasses
section (F9; F8 folded), four scenes — 1 Desk (F2), 2 Street (F3), 3 Table (F5), 4 Record (F7; whiteboard and minutes merged)
— each as three lines (I look at / The AI sees / Idea) left of its figure, four Rules, a one-sentence closing, and the Notes.
Engineering detail is folded into closed "More" sections (F8 and the tiers under Glasses; "Joining the room" and F6 under
Table; F4 under Record). Type: body 20 px, scene titles 26 px, figure labels about 22 px, captions and buttons ≥ 16 px,
buttons ≥ 44 px tall; every main figure ≤ 760 px tall with its controls at 1280 × 847; one-sentence captions. The full text
of this revision, with the exact copy, is kept with the build notes (rev3-spec.md); where it differs from section 9, it wins.

## 11. Revision 4 (2026-11-24)

The author removed the three folded "More" sections (F4, the whiteboard versions; F6, the room bus with "Joining the room";
F8, the three tiers) together with their text, because they do not help the live talk. The page now has six figures: F1, F2,
F3, F5, F7 and F9. The HW9 numbers (82 to 29 fps in about six minutes, under 1 ms a frame) stay in the Glasses line, and the
Notes still point to the headset log. Where this section differs from sections 4, 7, 9 and 10, it wins.

Later the same day the author also removed the Glasses line about the HW9 test and headset heat ("not needed"), and the notes line pointing to the HW9 headset log; no HW9 data remains on the page.

Also removed: F3's link up / link down toggle (and its line). Added: a Forza Horizon 5 screenshot under F3 in the Street scene as an example of in-world navigation (hw10/img/forza-navigation.jpg; the GPU overlay cropped off), credited in its caption and in the Notes.

Also removed at the author's request: the Rules and Closing sections; the page now ends with scene 4 and the Notes.
