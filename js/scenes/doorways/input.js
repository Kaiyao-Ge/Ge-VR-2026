// Input of Doorways, headset and desktop, as one set of numbers for the scene to read
// each frame, so that the scene does not care which one it has.
//
// Headset: the hands (matrix, beam, grip, trigger), the left stick walks, the right
// stick turns and, pushed forward, aims; A switches role, B starts a new round,
// Y swaps roles, X calibrates the table.
// Desktop: W/A/S/D walk, Q/E turn (the mini, or the room the giant holds), T held
// aims a teleport, G grips and F triggers with a hand at the eye, V switches role,
// N starts a new round, M swaps roles, and the mouse: a left press on a room holds it
// (the scene says by `hits` whether the ray meets one).
//
// The desktop viewer moves its own camera on W/A/S/D/F/C from `document` listeners, and
// turns the view when the left button drags on the canvas. So the keys the scene uses (it
// says which, by `uses(code)`: the giant leaves the camera W/A/S/D/F) and a mouse drag that
// holds a room are caught on `window` in the capture phase and stopped before they get that
// far. A key stopped going down is stopped coming up, and one let through is let through, so
// that no key stays down in the viewer.
import * as cg from '../../render/core/cg.js';
import { buttonState, joyStickState, controllerMatrix } from '../../render/core/controllerInput.js';
import { lcb, rcb } from '../../handle_scenes.js';

const KEYS = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'KeyT', 'KeyG', 'KeyF', 'KeyV', 'KeyN', 'KeyM'];

// A controller that is not tracked has no usable matrix: it is not a hand.
const valid = m => m?.length === 16 && Array.prototype.every.call(m, Number.isFinite);

// A hand's ray, along its beam (in the model's frame).
const beam = (hand, m) => {
   const cb = hand === 'left' ? lcb : rcb, B = cb?.m ? cg.mMultiply(cg.mInverse(window.worldCoords), cb.beamMatrix()) : m;
   return { o: B.slice(12, 15), d: cg.normalize(B.slice(8, 11).map(v => -v)) };
};

// listen(target, event, handler): add a capture-phase listener that goes away with the scene.
// xr(): are we in the headset. hits(ray): does a mouse press along this ray (model frame) take a room.
// uses(code): does the scene use this key now.
export function createInput({ listen, xr, hits = () => false, uses = () => true }) {
   const keys = {}, taps = [], was = {}, caught = new Set(), mouse = { x: 0, y: 0, held: false, pressed: false, released: false };
   const typing = e => /INPUT|TEXTAREA/.test(e.target?.tagName);
   // Keys with ctrl, alt or the meta key are the browser's.
   const ours = e => !xr() && !typing(e) && KEYS.includes(e.code) && !e.ctrlKey && !e.metaKey && !e.altKey;

   listen(window, 'keydown', e => {
      if (!caught.has(e.code) && !(ours(e) && uses(e.code))) return;
      e.stopImmediatePropagation();
      caught.add(e.code);
      keys[e.code] = true;
      if (!e.repeat) taps.push(e.code);
   });
   listen(window, 'keyup', e => {
      if (!caught.delete(e.code)) return;
      e.stopImmediatePropagation();
      keys[e.code] = false;
   });
   // A window that loses focus gets no key-up: let go of everything, or a held key would walk the mini on its own.
   listen(window, 'blur', () => {
      for (const code of Object.keys(keys)) keys[code] = false;
      caught.clear();
   });

   // The ray (model frame) from the camera through the cursor at client position (cx, cy).
   const rayAt = (cx, cy) => {
      const v = window.clay.views?.[0], canvas = window.clay.gl.canvas;
      if (!v) return null;
      const r = canvas.getBoundingClientRect(), x = (cx - r.left) / r.width * 2 - 1, y = 1 - (cy - r.top) / r.height * 2;
      const I = cg.mInverse(cg.mMultiply(v.projectionMatrix, v.viewMatrix)), toModel = p => cg.mTransform(window.clay.inverseRootMatrix, cg.mTransform(I, p));
      const near = toModel([x, y, -1]), far = toModel([x, y, 1]);
      const ray = { o: near, d: cg.normalize(cg.subtract(far, near)) };
      return [...ray.o, ...ray.d].every(Number.isFinite) ? ray : null;
   };
   listen(window, 'mousedown', e => {
      if (xr() || e.button !== 0 || e.target !== window.clay.gl.canvas) return;
      mouse.x = e.clientX; mouse.y = e.clientY;
      const ray = rayAt(e.clientX, e.clientY);
      if (!ray || !hits(ray)) return;
      e.stopPropagation();
      mouse.held = mouse.pressed = true;
   });
   // While a room is held the drag belongs to it, wherever the cursor goes.
   listen(window, 'mousemove', e => {
      mouse.x = e.clientX; mouse.y = e.clientY;
      if (mouse.held) e.stopPropagation();
   });
   listen(window, 'mouseup', e => {
      if (!mouse.held || e.button !== 0) return;
      e.stopPropagation();
      mouse.held = false; mouse.released = true;
   });

   // Buttons: down now, and newly pressed.
   const button = (hand, i) => xr() && !!buttonState[hand]?.[i]?.pressed;
   const edge = (hand, i) => { const k = hand + i, d = button(hand, i), p = d && !was[k]; was[k] = d; return p; };

   return {
      // head: my head's matrix (model frame). Returns what the scene reads this frame.
      frame(head) {
         const tapped = new Set(taps);
         taps.length = 0;
         const grip = { left: edge('left', 1), right: edge('right', 1) }, trigger = { left: edge('left', 0), right: edge('right', 0) };
         // The desktop has one hand, at the eye, looking where the view looks; the scene takes it for the mini.
         const hands = xr() ? ['left', 'right'].filter(hand => valid(controllerMatrix[hand])).map(hand => {
            const m = cg.mMultiply(window.clay.inverseRootMatrix, controllerMatrix[hand]);
            return { hand, m, ray: beam(hand, m), grip: button(hand, 1), gripPressed: grip[hand], trigger: button(hand, 0), pressed: trigger[hand] };
         }).filter(({ m, ray }) => valid(m) && [...ray.o, ...ray.d].every(Number.isFinite))
            : [{ hand: 'desktop', m: head, ray: { o: head.slice(12, 15), d: cg.normalize(head.slice(8, 11).map(v => -v)) },
                 grip: !!keys.KeyG, gripPressed: tapped.has('KeyG'), trigger: !!keys.KeyF, pressed: tapped.has('KeyF') }];
         const key = (plus, minus) => (keys[plus] ? 1 : 0) - (keys[minus] ? 1 : 0);
         const out = {
            hands,
            walk: xr() ? joyStickState.left : { x: key('KeyD', 'KeyA'), y: key('KeyS', 'KeyW') },
            turn: xr() ? joyStickState.right : { x: key('KeyE', 'KeyQ'), y: keys.KeyT ? -1 : 0 },
            buttons: {
               switchRole: edge('right', 4) || tapped.has('KeyV'), newRound: edge('right', 5) || tapped.has('KeyN'),
               swap: edge('left', 5) || tapped.has('KeyM'), calibrate: edge('left', 4),
            },
            mouse: xr() ? null : { ray: rayAt(mouse.x, mouse.y), down: mouse.held, pressed: mouse.pressed, released: mouse.released,
                                   rotate: tapped.has('KeyE') ? 1 : tapped.has('KeyQ') ? -1 : 0 },
         };
         mouse.pressed = mouse.released = false;
         return out;
      },
   };
}
