# Ge-VR-2026

Coursework for CSCI-GA.3033-097 Virtual Reality, Fall 2026, based on the [class repository](https://github.com/futurerealitylab/VR-2026-Fall).

## HW2: Spellcode

Spellcode is a cooperative VR game. One player defends a core with two guns;
the other collects code blocks and uses loops and weapon modifiers to change
how the guns fire. In-game text explains the controls, shows status and score,
and announces victory or defeat. Select **spellcode** to play, or choose
**SOLO DEBUG** to test both roles with one headset or a mouse.
See the [game instructions and checks](doc/spellcode.md).

## Set up the environment

Install Node.js and npm. This project uses Node v18.20.8. From the repository root, run:

```sh
npm install
cd server
npm install
source patch
```

If `source patch` fails, try:

```sh
sh patch_fixed.sh
```

## Run on your computer

1. From the repository root, run `./startserver`.
2. Open chrome://flags/ in Chrome.
3. Enable `Insecure origins treated as secure`.
4. Add your server address, such as `http://10.19.127.1:2026`, to the flag's text box.
5. Relaunch Chrome and open http://localhost:2026.

## Run in VR

1. Start the server on your computer.
2. Open the browser on your VR headset.
3. Go to chrome://flags/.
4. Enable `Insecure origins treated as secure`.
5. Add your computer's server address, such as `http://10.19.127.1:2026`, to the flag's text box.
6. Relaunch the headset browser and open that address.

## Debug in VR

1. On your Oculus app, go to *Devices*, select your headset from the device list, and wait for it to connect. Then select *Developer Mode* and turn on *Developer Mode*.
2. Connect your Quest to your computer with a USB cable.
3. Open chrome://inspect#devices on your computer.
4. Accept *Allow USB Debugging* when prompted on the headset.
5. Find the headset's active page under *Remote Target* on chrome://inspect#devices and select *Inspect*.

## Create a demo

1. Create a JavaScript file in [js/scenes](js/scenes/), using [shapes.js](js/scenes/shapes.js) as a template.
2. Add the scene's name and path to the list in [scenes.js](js/scenes/scenes.js).
3. With `enableSceneReloading` enabled, you can reload changes while developing the scene.

## Enable hand tracking

1. Enable the experimental feature in the browser (Oculus Browser 11)
2. Visit chrome://flags/
3. Enable WebXR experiences with joint tracking (#webxr-hands)
4. Enable WebXR Layers depth sorting (#webxr-depth-sorting)
5. Enable WebXR Layers (#webxr-layers)
6. Enable phase sync support (#webxr-phase-sync)
7. Enable "Auto Enable Hands or Controllers" (Quest Settings (Gear Icon) -> Device -> Hands and Controllers)
8. Enter the VR experience
