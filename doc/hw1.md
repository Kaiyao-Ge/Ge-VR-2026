# HW1 — A Handful of Time

**Author:** Kaiyao Ge  
**Repository:** [Ge-VR-2026](https://github.com/Kaiyao-Ge/Ge-VR-2026)  
**Assignment branch:** [hw1](https://github.com/Kaiyao-Ge/Ge-VR-2026/tree/hw1)  
**Scene:** `solarSystem`

## Concept

A Handful of Time turns the solar system into something you can hold and play with. Point at any of the eight planets, hold the trigger, and sweep along its orbit to move time forward or backward for the entire system. Every planet follows the same clock using its mean orbital period. Release while moving to let time coast, or stop before releasing to leave it at rest.

The scene starts as a floating tabletop model. Move it with one hand or stretch it with both hands until the orbits surround you. The central idea is not eight separate draggable objects: touching one planet changes your experience of the whole system. Turning an outer planet makes the inner planets race, while turning an inner planet allows finer control.

## Connection to the assignment

| Class capability | Use in this scene |
| --- | --- |
| Multiplayer press / drag / release | Visitors take turns controlling one shared clock. Press claims control, drag updates time, and release lets another visitor take over. |
| Vibrational controller feedback | Short pulses mark an accepted grab, approximately every 15 degrees of accumulated rotation, and release. |
| Controller beams | Rays select planets; sweeping a ray along the selected orbital plane drives rotation. Highlighted orbits and labels identify the target. |
| Animated object hierarchies | Planets orbit the Sun through nested transforms. The Moon orbits Earth while Earth orbits the Sun, and Saturn carries its rings. |

## Running the scene

Use the course repository's [dependency setup](../README.md#how-to-setup-the-environment) with Node 18. With dependencies installed, the Node service alone is sufficient for this scene. From the repository root:

```sh
source "${NVM_DIR:-$HOME/.nvm}/nvm.sh"
nvm use 18
node server/main.js 2026 2026 http
```

Open `http://localhost:2026` for a desktop preview and select **solarSystem**. For headset interaction, use your working WebXR access configuration and enter the immersive session with Touch controllers. Opening the webpage alone does not enter immersive mode. Bare-hand tracking and desktop mouse dragging are not implemented for this scene.

The existing `./startserver` launcher is also available in an already configured environment. It starts both Node and the Python anchor service using `.venv`; it also terminates processes named `node` and `python` before starting them. Use the Node-only command above if you need to leave other services running. HW1 does not require the anchor service or any new Python packages; keep any Python setup inside the uv-managed `.venv`.

## Controls

| Action | Control |
| --- | --- |
| Select a planet | Point either controller beam at it. The orbit highlights and its name and period appear. |
| Turn the shared clock | Hold the index-finger trigger and sweep the beam around the selected orbit. Reverse the sweep to reverse time. |
| Let time coast | Release the trigger while moving. Motion gradually slows down. |
| Stop without coasting | Hold still before releasing. Grabbing a planet also stops existing coasting. |
| Move the whole chart | Hold either side grip button and move that controller. No aiming is required. |
| Scale the chart | Hold both side grips and spread your hands apart or bring them together. Move both hands to reposition it at the same time. |

After grabbing, you do not need to keep aiming at the planet's sphere. Sweep around the Sun in the selected orbital plane; the angle accumulates across full turns. Scaling ranges from 0.25× to 20× the initial size, with the midpoint between your hands acting as the anchor. Grip gestures take priority over planet dragging and cancel it without a fling. Switching between one and two hands establishes a new baseline to avoid a jump.

If the beam approaches the orbital plane edge-on, passes close to the Sun, or briefly loses tracking, rotation pauses. Re-aim along the orbit to resume. The first valid sample after a tracking or invalid-ray gap re-establishes the angle rather than jumping to it. Instruction text remains independent of chart scale. Your chart position and scale persist across scene re-entry and Reload within the same page, but reset on a page refresh.

### Multiplayer

All participants, including the earliest connected browser that acts as the framework's master client, must enter `solarSystem`. Only one controller owns the clock at a time; others can watch and take over after release. Each visitor moves and scales their own chart independently. If the earliest connected page is in another scene, switch it to `solarSystem` or disconnect it.

## Implementation and display choices

The [scene module](../js/scenes/solarSystem.js) contains the planet data, geometry, interaction, inertia, and synchronization. It uses the course framework without additional runtime dependencies and is registered in [scenes.js](../js/scenes/scenes.js).

- One `timeDays` value drives all orbital angles: `initial phase + 2π × timeDays / period`.
- A controller ray is transformed into the selected orbital plane. Wrapped angular differences are accumulated and converted into elapsed simulation days, allowing continuous turns in either direction.
- The master client handles ownership and clock updates. Drag messages contain cumulative time offsets, state is broadcast at approximately 20 Hz, and observers interpolate the displayed time. Network latency can cause temporary differences between views.
- Translation and uniform scaling apply to the chart rather than the camera. Rendering, picking, and dragging use the same orbital transforms.
- `solarSystemState.json` is generated runtime state and is ignored by Git, along with local dependencies and the Python environment.

This is an interactive visualization, not a true-scale astronomical simulation. The data table retains the source orbital parameters, while `DISPLAY` controls readability:

- Inclinations are exaggerated **4×**, keeping the ascending-node directions unchanged.
- Adjacent orbital gaps follow `0.04 + 0.52 × sqrt(ΔAU) / Σsqrt(ΔAU)` metres. This preserves their relative ordering while compressing the enormous real distances and adding room to grab planets.
- Initial orbital radii range from **0.15 m** for Mercury to **0.95 m** for Neptune. Planet sizes are also chosen for visibility, not physical scale.
- Orbits are circular and initial phases are chosen visually. There is no gravity solver, ephemeris, eclipse simulation, environmental plane detection, or automatic placement on room surfaces. The scene inherits the framework's `immersive-ar` session entry without adding AR anchors.

| Planet | Display inclination, approximately | Display orbit radius, approximately |
| --- | ---: | ---: |
| Mercury | 28.0° | 15.0 cm |
| Venus | 13.6° | 21.5 cm |
| Earth | 0° | 27.7 cm |
| Mars | 7.4° | 34.8 cm |
| Jupiter | 5.2° | 46.9 cm |
| Saturn | 9.9° | 59.8 cm |
| Uranus | 3.1° | 77.0 cm |
| Neptune | 7.1° | 95.0 cm |

Data references retained from the implementation: [NASA Planetary Fact Sheet](https://nssdc.gsfc.nasa.gov/planetary/factsheet/) for mean orbital periods and [JPL approximate planetary positions, Table 1](https://ssd.jpl.nasa.gov/planets/approx_pos.html) for J2000 inclinations, ascending nodes, and semimajor axes. Earth's orbital elements use the Earth–Moon barycenter entry.

## Verification

Run the regression checks from the repository root with Node 18; no additional test dependencies are needed:

```sh
node --experimental-vm-modules tests/solar-system.test.cjs
```

The 20 automated tests load the real scene, math library, and controller beam code while substituting rendering and transport. They cover shared orbital ratios, reversible inertia, picking all eight planets, continuous multi-turn dragging, invalid-ray recovery, ownership and cleanup, inclined and compressed orbits, and one- and two-hand chart transforms. These checks do not replace headset or real-network testing.

Before submission, confirm on the headset:

- Enter immersive mode, select planets with either controller, and sweep through multiple turns without releasing.
- Reverse direction, compare moving and stationary releases, and feel the grab, rotation, and release feedback.
- Move and scale the chart, switch between one and two grips, and check picking at immersive scale.
- Check the latest exaggerated inclinations and compressed spacing for readability.
- With two clients in this scene, take turns controlling time and confirm that disconnecting the controller does not leave it locked.

## BrightSpace submission

**Branch link:** [HW1 on GitHub](https://github.com/Kaiyao-Ge/Ge-VR-2026/tree/hw1)

**Description:**

A Handful of Time is my interactive solar-system sandbox. Grab any of the eight planets with a controller beam and sweep along its inclined orbit to turn a shared simulation clock. Every planet responds using its mean orbital-period ratio. Release while moving to let time coast, or reverse your motion to rewind the system. Use one grip to move the floating star map and two grips to stretch it from tabletop size to an immersive scale. Short haptic pulses mark grabbing, angular notches, and release. The Earth–Moon hierarchy demonstrates nested animation, and multiple visitors can take turns controlling the same clock while choosing their own viewing scale. For readability, orbital inclinations are exaggerated fourfold and orbital spacing is compressed from real semimajor-axis differences; orbital-period ratios remain unchanged.

**Optional supporting media:** A short headset recording can show selecting Earth, turning time forward and backward, releasing into a coast, and enlarging the chart until the orbits surround the viewer. Add your actual screenshot or recording if needed; no media is included here yet.

Before submitting, commit and push the HW1 files to this branch and confirm that the branch page displays the updated scene and documentation. Submit the branch link and description on BrightSpace; screenshots or video are optional supporting material.
