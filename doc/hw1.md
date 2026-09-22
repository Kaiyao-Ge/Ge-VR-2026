# HW1: A Handful of Time

By Kaiyao Ge · [hw1 branch](https://github.com/Kaiyao-Ge/Ge-VR-2026/tree/hw1)

A Handful of Time is a solar-system sandbox controlled with VR controllers. Point at any of the eight planets, hold the trigger, and sweep along its orbit to move time forward or backward. Every planet follows the same clock using its mean orbital period. Turning an outer planet makes the inner planets race, while turning an inner planet allows finer control.

The scene starts as a floating tabletop model. Move it with one hand or stretch it with both hands until the orbits surround you. Release a planet while moving to let time coast, or stop before releasing to leave it at rest.

## Controls

Follow the [launch instructions](../README.md#run-hw1), select `solarSystem`, and enter an immersive session with Touch controllers. The desktop browser provides a preview; interaction requires controllers.

| Action | Control |
| --- | --- |
| Select a planet | Point either controller beam at it. The orbit highlights and its name and period appear. |
| Turn the shared clock | Hold the index-finger trigger and sweep the beam around the selected orbit. Reverse the sweep to reverse time. |
| Let time coast | Release the trigger while moving. Motion gradually slows down. |
| Stop without coasting | Hold still before releasing. Grabbing a planet also stops existing coasting. |
| Move the whole chart | Hold either side grip button and move that controller. No aiming is required. |
| Scale the chart | Hold both side grips and spread your hands apart or bring them together. Move both hands to reposition it at the same time. |

After grabbing, you do not need to keep aiming at the planet's sphere. Sweep around the Sun in the selected orbital plane; you can continue through multiple turns without releasing. If the beam approaches the plane edge-on or passes close to the Sun, rotation pauses. Re-aim along the orbit to resume.

Scaling ranges from 0.25× to 20× the initial size, centered between your hands. Starting a grip gesture ends planet dragging without a fling. Your chart position and scale remain when you leave and re-enter the scene on the same page; refreshing the page resets them.

## Class features

| Class capability | Use in this scene |
| --- | --- |
| Multiplayer press / drag / release | Press claims the shared clock, drag updates time, and release lets another visitor take over. |
| Controller vibration | Short pulses mark an accepted grab, roughly every 15 degrees of accumulated rotation, and release. |
| Controller beams | A ray selects a planet and its intersection with the orbital plane determines how far to turn it. |
| Animated object hierarchies | The Moon orbits Earth while Earth orbits the Sun. Saturn's rings move with Saturn. |

For multiplayer, all participants must enter `solarSystem`, including the first connected browser, which acts as the framework's master client. One controller turns time at a time. Each visitor can move and scale their own chart independently. If the first browser is in another scene, switch it to `solarSystem` or disconnect it.

## Design choices

The real orbital inclinations were difficult to see at tabletop size, so the scene displays them at four times their actual angles. Mercury's orbit tilts by about 28 degrees, for example. The ascending-node directions remain unchanged.

Orbital spacing is also compressed to keep the inner planets selectable and the outer planets within reach. Each gap uses the square root of the corresponding difference in semimajor axes, normalized to fit the chart, plus 4 cm of clearance. Initial orbital radii range from 15 cm for Mercury to 95 cm for Neptune. Planet sizes are chosen for visibility.

All planets use one `timeDays` value and their mean orbital periods. Dragging changes that value, so the relative speeds stay the same when turning time forward or backward. Orbits are circular, and their starting positions are chosen for the scene rather than a particular date.

The drag calculation measures changes in the beam's angle around the Sun and handles the wrap at ±180 degrees. This replaced a fixed left–right displacement mapping that stopped responding properly after part of a turn. Brief tracking gaps pause the movement and establish a new angle when tracking returns.

The [scene code](../js/scenes/solarSystem.js) uses the course framework's transforms, controller beams, and networking. The chart floats in the scene; it does not detect or attach to surfaces in the room. It uses the framework's existing `immersive-ar` entry.

## Data sources

- [NASA Planetary Fact Sheet](https://nssdc.gsfc.nasa.gov/planetary/factsheet/): mean orbital periods.
- [JPL approximate planetary positions, Table 1](https://ssd.jpl.nasa.gov/planets/approx_pos.html): J2000 inclinations, ascending nodes, and semimajor axes. Earth's orbital elements use the Earth–Moon barycenter entry.
