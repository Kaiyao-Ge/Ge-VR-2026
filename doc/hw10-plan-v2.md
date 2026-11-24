# HW10 Revision 2 (the visual pass) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply the approved visual revision to the finished HW10 page: one type scale, two-column figures that fit one screen
with controls beside the drawing, one drawing language, a fixed scene bar, F1 at the opening, and lighter prose.

**Architecture:** Shared layout in `style.css` plus a small convention every figure follows: its `mount` puts the drawing (the
`<svg>`, or F7's list) in a `div.fig-draw` and everything else (controls, status line, panels) in a `div.fig-side`, both
children of `.fig-stage`. CSS makes `.fig-stage` a two-column grid on wide screens and a stack on narrow ones. The fixed bar
is a classic script `hw10/nav.js`.

**Tech Stack:** as before (HTML, CSS, classic scripts, inline SVG; Node 18 `vm` and Playwright tests).

**Spec:** `doc/hw10-design.md`, section 9 (Revision 2), on top of sections 1–8. The first plan, `doc/hw10-plan.md`, still
binds where this one is silent (its Global Constraints, ids, and the rulings in its ledger).

## Global Constraints

- Everything in `doc/hw10-plan.md`'s Global Constraints still holds (no network, classic scripts, tokens only, English,
  2,000–2,500 words, Ruling 3 text-only to the cloud, Ruling 4 ≥ 10 px real font size at 375 px).
- Laptop type scale (1280 px window): body text (`main p`, `main li`) 18 px; h1 40–46 px; h2 30 px; scene h3 24 px with a
  "Scene N" label above; figcaption 15 px; SVG text in figures 15–17.5 px real font size; HTML text inside figures ≥ 15 px.
- Wide layout (figure width ≥ 880 px): `.fig-draw` left, `.fig-side` right, tops within 24 px of each other. Narrow layout:
  `.fig-side` directly under `.fig-draw` (gap ≤ 24 px). Every figure ≤ 760 px tall at 1280 × 847.
- Buttons in figures and the bar: ≥ 40 px tall (the bar's links ≥ 36 px), 2 px border, the selected one solid accent;
  visible focus ring.
- Figure HTML parts: 2 px `var(--ink)` borders, 8 px radius.
- Keep every behaviour, state attribute and Node logic test of Tasks 1–9; change positions/sizes in browser tests only where
  the new layout moves things, and say which.
- Subagents do not commit; the controller snapshots each task.

## Review Focus

1. A 1280 × 847 reader: a figure taller than the screen, or a control whose effect is off screen → `layoutChecks` (Task V1)
   asserts the height and the side-by-side placement for every figure (Tasks V3, V4).
2. A 375 px reader: the bar wraps or covers headings when jumping to a scene → the bar is one line and `scroll-margin-top`
   keeps each scene title visible below it (Task V1).
3. Dark mode: new borders or the accent "selected" state invisible → a dark-mode check of the bar and of one selected
   button (Task V1).
4. Keyboard: the bar's links and every moved control still reachable and working → each figure's existing key test still
   passes after the move (Tasks V3, V4).
5. Word count drifting below 2,000 after the prose cuts → the existing word-count check (Task V2).

## File Structure

| File | Change |
|---|---|
| `hw10/style.css` | type scale, `.fig-stage` grid, `.fig-draw`/`.fig-side`, figure HTML style, buttons, the bar |
| `hw10/index.html` | the bar markup, F1 moved after the thesis, scene labels, the prose edits, the `nav.js` tag |
| `hw10/nav.js` (new) | highlights the current scene in the bar (IntersectionObserver); no DOM use at load in Node |
| `hw10/figures/f1-…f9-….js` | each `mount` wraps its parts in `.fig-draw` / `.fig-side`; F1 labels and switch; F7/F8 restyle |
| `tests/hw10-browser.test.cjs` | `layoutChecks(page, id)`, the bar checks, type-scale checks, moved-position updates |

---

### Task V1: The layout system, type scale, bar, buttons and opening

**Files:** Modify `hw10/style.css`, `hw10/index.html` (structure only: the bar, F1's container moved to right after the
thesis inside `#top`, the "Scene N" labels, the `nav.js` tag); create `hw10/nav.js`; modify `tests/hw10-browser.test.cjs`.

**Interfaces:** Produces the convention `.fig-stage > .fig-draw + .fig-side` (CSS only; figures adopt it in V3/V4 — until then a
figure without these wrappers must still render as today) and `layoutChecks(page, id)` exported from the browser test: at
1280 × 847 the figure is ≤ 760 px tall, its SVG text is 15–17.5 px real font size, `.fig-side` is right of `.fig-draw` with tops
within 24 px, and every button in it is ≥ 40 px tall; at 375 px `.fig-side` is directly under `.fig-draw` (gap ≤ 24 px).
The bar: `nav#afternoon` keeps its five links to `#scene-1…5`, becomes fixed at the top, and `nav.js` sets
`aria-current="true"` on the link of the scene being read (none before scene 1).

- [ ] **Step 1: Failing browser tests** — `type scale` (p 18 px, h2 30 px, a scene h3 24 px with its "Scene N" label, figcaption
  15 px); `the bar stays at the top after scrolling and marks scene 3 when #scene-3 is read` (scroll to it; the third link has
  `aria-current`); `the bar is one line at 375 px and a jumped-to scene title is not under it`; `F1 is the first figure, right
  after the thesis, its top within the first 700 px at 1280 × 847`; `layoutChecks` rejects a deliberately tall and a
  deliberately stacked test figure (as figureChecks' own self-test does); dark mode: the bar's current link and a selected
  button differ from the background.
- [ ] **Step 2: Run; they fail.**
- [ ] **Step 3: Implement** the CSS, the markup moves and `nav.js` (update the old tests that pinned F1 inside `#complement` or
  the strip's wrapping; say which).
- [ ] **Step 4: Run both suites; all pass.**
- [ ] **Step 5: Report.**

### Task V2: The prose

**Files:** Modify `hw10/index.html` (text only); `tests/hw10-browser.test.cjs`.

- [ ] **Step 1: Failing tests** — `#joining` has a list of exactly three rules; `#boundaries` holds its points as a list; no
  paragraph outside figures contains "In the figure" or starts with "Drag", "Click", "Slide", "Ask", "Play" (instructions live
  in captions); `#complement` refers to the figure above (contains "above" or "at the top").
- [ ] **Step 2: Run; they fail.**
- [ ] **Step 3: Edit** per spec section 9 item 7. Keep every idea and fact; keep the word count 2,000–2,500; keep captions
  saying what to try in one or two sentences, without repeating the status line.
- [ ] **Step 4: Run both suites; all pass.**
- [ ] **Step 5: Report.**

### Task V3: F1–F5 in the new layout; F1's labels and switch

**Files:** Modify `hw10/figures/f1-attention.js`, `f2-desk.js`, `f3-street.js`, `f4-board.js`, `f5-table.js`, `hw10/style.css`
(their blocks), `tests/hw10-browser.test.cjs`.

- [ ] **Step 1: Failing tests** — `layoutChecks` for f1…f5; F1: no two label boxes intersect, and no label box intersects the
  floor line, the desk top or the scale line (give those lines a class to find them); the switch is two buttons above the
  drawing, "My eye" and "What the glasses see", the selected one `aria-pressed="true"`, and they set `data-state` as the old
  toggle did.
- [ ] **Step 2: Run; they fail.**
- [ ] **Step 3: Implement** — each mount wraps its drawing in `.fig-draw` and its controls, status line and panels (F4's PDF
  list included) in `.fig-side`; size each drawing so its text lands at 15–17.5 px at 1280 (viewBox width × 16 / font units ≈
  the drawing's width); move F1's labels into clear space.
- [ ] **Step 4: Run both suites; all pass.**
- [ ] **Step 5: Report.**

### Task V4: F6–F9 in the new layout; F7 and F8 in the drawing language

**Files:** Modify `hw10/figures/f6-bus.js`, `f7-minutes.js`, `f8-tiers.js`, `f9-glasses.js`, `hw10/style.css` (their blocks),
`tests/hw10-browser.test.cjs`.

- [ ] **Step 1: Failing tests** — `layoutChecks` for f6…f9; F7: the evidence panel's top within 24 px of the list's top and to
  its right at 1280; F7/F8 HTML parts have 2 px ink borders, 8 px radius and ≥ 15 px text.
- [ ] **Step 2: Run; they fail.**
- [ ] **Step 3: Implement** the wrappers, sizes and restyle (F7: list in `.fig-draw`, evidence in `.fig-side`; F8: tiers in
  `.fig-draw`, the "why" panel and the chart in `.fig-side` or stacked so the figure stays ≤ 760 px).
- [ ] **Step 4: Run both suites; all pass.**
- [ ] **Step 5: Report.**
