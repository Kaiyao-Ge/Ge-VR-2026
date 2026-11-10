// Miniature: a small object on the table and a 1/12 scale avatar of you
// beside it. Two views, which you fly between in 1.5 s:
//   player: you, at your size, see the table, the object and your avatar,
//           and can pick the object up and move it (grip, in reach or by ray);
//   avatar: you see through your avatar's eyes, the room 12 times bigger,
//           and can touch the object at the avatar's size. Your own body
//           stands there as a giant.
// Your avatar moves as you move, 1/12 as far. You stand still: the left stick
// walks it, the right stick turns it and, pushed forward, aims a teleport,
// in either view. It climbs low steps and is stopped by walls.
//
// In a headset the first thing is a 12 s scan of the real room with the depth
// sensor (as Echo Hunt does it): it is drawn in the avatar's view in place of the
// box room, and the table in front of you becomes the miniature's table.
//
// Controls: A switches views, B puts the avatar back at its start, X with the
// left controller lying on the table moves the table there, Y scans the room
// again. Desktop: V switches views, R resets, I/J/K/L walk, U/O turn, T (held)
// aims a teleport along the view, a little down; no scan. Design: doc/hw7-design.md.
//
// The parts: mapping.js (body to avatar and back), physics.js (the avatar on
// the object), rays.js, world.js (room and table), avatar.js, panel.js (the
// wrist panel), camera.js (its live picture), scanner.js (the depth scan), scanned.js (the scan's mesh and
// table), scandraw.js (draws that mesh), and the object, any module in miniature/objects/.
import * as cg from '../render/core/cg.js';
import { buttonState, joyStickState, controllerMatrix } from '../render/core/controllerInput.js';
import { lcb, rcb } from '../handle_scenes.js';
import { Mapping, flight, frame, yawOf } from './miniature/mapping.js';
import { move, blocked } from './miniature/physics.js';
import { mapRay, rayBox, pickTop } from './miniature/rays.js';
import { World } from './miniature/world.js';
import { Avatar } from './miniature/avatar.js';
import { WristPanel } from './miniature/panel.js';
import { Scanner } from './miniature/scanner.js';
import { ScanDraw } from './miniature/scandraw.js';
import { Camera } from './miniature/camera.js';
import { MAX_TRIS, roomMesh, pickTable, tableTop } from './miniature/scanned.js';
import { OBJECTS } from './miniature/objects/index.js';

const OBJECT = 'house';
// Where things start, on the table (x along it, z across, metres): the object
// in the middle, its front turned to the near end, and the avatar there, facing
// the front door (the house's door is 1/12 m of table left of its middle).
const OBJECT_AT = [0, 0], OBJECT_YAW = -Math.PI / 2, AVATAR_AT = [-.55, -1 / 12], AVATAR_YAW = -Math.PI / 2;
const WALK = .12, TURN = Math.PI / 6, REACH = .03;   // metres of table a second; a snap turn; grab margin
const CENTRE = .25;                                  // how near the centre the right stick must come back before it turns again
const FLIGHT = 1.5, PUSH = .6, RAY_REACH = 3;        // seconds between the views; the stick's push that aims; metres a ray grabs from
const PREVIEW = 3;                                   // seconds the scan shows in my view when it is done, before it fades

let cleanup;
export const init = async (model, ctx = {}, ctxForever = {}) => {
   ctxForever.miniatureCleanup?.();
   const disposers = [], xr = () => !!window.isXR?.();
   const listen = (target, event, handler) => {
      target.addEventListener(event, handler, true);
      disposers.push(() => target.removeEventListener(event, handler, true));
   };

   // The camera behind the wrist panel's picture sees its own copies of some things (see camera.js):
   // the room and table always solid, my avatar whole, and me at my size, whom I never see myself.
   const worldNode = model.add();
   const world = new World(worldNode).view('main'), seenWorld = new World(worldNode).view('offscreen');
   // The avatars before the object: drawn first, they show through the object's see-through parts.
   const avatar = new Avatar(worldNode), seenAvatar = new Avatar(worldNode), me = new Avatar(worldNode), giant = new Avatar(worldNode);
   avatar.root.view('main'); seenAvatar.root.view('offscreen'); me.root.view('offscreen');
   giant.head.view('main'); giant.body.view('main');   // the camera looks out of the giant's head
   const holder = worldNode.add(), object = OBJECTS[OBJECT].create(holder.add());
   const marker = worldNode.add('torusY').color(.3, 1, .5);
   const camera = new Camera(window.clay.gl), panel = new WristPanel(model, camera);
   const mapping = new Mapping(), scanner = new Scanner(window.clay.gl), scanDraw = new ScanDraw(window.clay.gl);
   const boxes = () => object.colliders?.() || [object.bounds];

   // mode is the view I am in or flying to, t how far along the flight (0 mine, 1 the avatar's).
   let mode = 'player', phase = 0, t = 0, pose = null, held = null, started = false, head = null;
   let rides = false, aiming = false, target = null, giantAt = null, blockedAt = 0, turnWas = 0, aimed = false;
   const placeObject = () => { pose = frame(world.onTable(OBJECT_AT), world.table.yaw + OBJECT_YAW); rides = false; };
   const placeAvatar = head => { mapping.setBody(head).setStand(world.clamp(world.onTable(AVATAR_AT), .03), world.table.yaw + AVATAR_YAW); rides = false; };
   // Put the object down upright on the table, where it is.
   const drop = () => {
      if (!held) return;
      pose = frame(world.clamp(pose.slice(12, 15), .03), yawOf(pose));
      held = null;
   };
   // The avatar standing on the object goes where the object went. While the object
   // is in my hand it is held fast to it, tilting as it tilts; it is carried
   // there once the object is put down, upright.
   let carried = null;
   const carry = () => { if (held) return; if (rides && pose !== carried) mapping.carry(carried, pose); carried = pose; };
   // The table is somewhere else: the object and the avatar start again on it.
   const moveTable = (p, yaw, size) => { world.setTable(p, yaw, size); held = null; placeObject(); placeAvatar(head); carried = pose; };
   // A scanned room: drawn in the avatar's view, and the table in front of me is the table.
   const takeRoom = (room, eye, fwd) => {
      const table = pickTable(room, eye, fwd);
      world.setScan(roomMesh(room, MAX_TRIS, table && tableTop(room, table.box)));
      if (table) moveTable(table.p, table.yaw, table.size);
      return table;
   };
   let scanSession = null, scanNote = '', scannedAt = -1e9, scanFound = false;
   const haptic = (hand, strength, ms) => { if (xr()) try { window.vibrate?.(hand, strength, ms); } catch (_) { /* No actuator. */ } };

   // Buttons: down this frame, and newly pressed.
   const was = {};
   const button = (hand, i) => xr() && !!buttonState[hand]?.[i]?.pressed;
   const pressed = (hand, i) => { const k = hand + i, d = button(hand, i), p = d && !was[k]; was[k] = d; return p; };
   // A controller that is not tracked has no usable matrix: it is not a hand.
   const valid = m => m?.length === 16 && Array.prototype.every.call(m, Number.isFinite);
   // A hand's ray, along its beam.
   const beam = (hand, m) => {
      const cb = hand === 'left' ? lcb : rcb, B = cb?.m ? cg.mMultiply(cg.mInverse(window.worldCoords), cb.beamMatrix()) : m;
      return { o: B.slice(12, 15), d: cg.normalize(B.slice(8, 11).map(v => -v)) };
   };

   // Desktop.
   const keys = {}, taps = [];
   listen(window, 'keydown', e => {
      if (xr() || /INPUT|TEXTAREA/.test(e.target?.tagName)) return;
      keys[e.code] = true;
      if (!e.repeat) taps.push(e.code);
   });
   listen(window, 'keyup', e => { keys[e.code] = false; });

   // Where a ray (mine) meets the table or the object's tops that the avatar can stand on.
   const pick = ray => {
      const inv = cg.mInverse(pose), hit = pickTop(mapRay(mode === 'avatar' ? cg.mMultiply(inv, mapping.toMini) : inv, ray), boxes(),
         p => world.contains(cg.mTransform(pose, p), .01));
      return hit && !blocked(boxes(), hit.p) ? { p: cg.mTransform(pose, hit.p), onObject: hit.onObject } : null;
   };

   // A camera at p looking along f, upright.
   const look = (p, f) => {
      const z = cg.normalize(f.map(v => -v)), x = cg.normalize(cg.cross([0, 1, 0], Math.abs(z[1]) > .999 ? [0, 0, 1] : z)), y = cg.cross(z, x);
      return [...x, 0, ...y, 0, ...z, 0, ...p, 1];
   };
   let frames = 0;

   let last = performance.now();
   model.animate(() => {
      const now = performance.now(), dt = Math.min(.05, (now - last) / 1000);
      last = now;
      const views = window.clay.views;
      if (!views?.length) return;
      // My head, between the eyes; my hands, in the headset.
      const inv = v => cg.mInverse(v.viewMatrix);
      head = cg.mMultiply(window.clay.inverseRootMatrix, views.length > 1 ? cg.mix(inv(views[0]), inv(views[1]), .5) : inv(views[0]));
      const eye = head.slice(12, 15);
      const hands = xr() ? ['left', 'right'].filter(hand => valid(controllerMatrix[hand])).map(hand => {
         const m = cg.mMultiply(window.clay.inverseRootMatrix, controllerMatrix[hand]);
         return { hand, m, ray: beam(hand, m) };
      }).filter(({ m, ray }) => valid(m) && [...ray.o, ...ray.d].every(Number.isFinite)) : [];
      const left = hands.find(h => h.hand === 'left'), right = hands.find(h => h.hand === 'right');

      if (!started) { started = true; placeObject(); placeAvatar(head); carried = pose; }
      const tap = code => { const i = taps.indexOf(code); if (i >= 0) taps.splice(i, 1); return i >= 0; };
      const rescan = pressed('left', 5);
      const toggle = (pressed('right', 4) || tap('KeyV')) && !scanner.busy, reset = pressed('right', 5) || tap('KeyR'), setTable = pressed('left', 4);
      const grip = { left: pressed('left', 1), right: pressed('right', 1) }, trigger = { left: pressed('left', 0), right: pressed('right', 0) };
      taps.length = 0;

      // The scan: it starts when I first am in the headset, and again on Y (from my own view).
      const session = xr() ? window.xrFrame?.session : null;
      if (session && (session !== scanSession || rescan && mode === 'player' && phase === 0)) {
         scanSession = session;
         if (mode === 'avatar') { mode = 'player'; drop(); carry(); }
         scanner.start(session, eye, now / 1000);
      }
      if (session) scanner.update(window.xrFrame, window.xrFrameRefSpace, eye, window.clay.inverseRootMatrix, now / 1000);
      else scanner.cancel();
      const scanned = scanner.take();
      if (scanned) { scanFound = !!takeRoom(scanned, eye, [-head[8], -head[10]]); scannedAt = now / 1000; }
      const since = now / 1000 - scannedAt;
      scanNote = scanner.busy ? (scanner.state === 'meshing' ? 'building the room...' : 'look around: scanning ' + scanner.left(now / 1000) + ' s')
         : scanner.state === 'failed' ? scanner.note + ' (Y: scan again)'
         : since < PREVIEW + 1 ? (scanFound ? 'room scanned, table found' : 'room scanned, no table: X to set it') : '';

      // Flying between the views. I leave a giant of myself where I stand.
      if (toggle) {
         mode = mode === 'player' ? 'avatar' : 'player';
         drop(); carry();
         if (mode === 'avatar') giantAt = { poses: { head, left: left?.m, right: right?.m }, feet: [head[12], 0, head[14]] };
      }
      const goal = mode === 'avatar' ? 1 : 0, step = dt / FLIGHT;
      phase = Math.abs(goal - phase) <= step ? goal : phase + Math.sign(goal - phase) * step;
      t = phase * phase * (3 - 2 * phase);
      const flying = phase !== goal;

      let message = flying ? 'flying...' : '';
      if (!flying) {
         if (reset) placeAvatar(head);
         if (setTable && left) moveTable(left.m.slice(12, 15), yawOf(left.m));

         // Picking the object up, in my own view: the grip near it, or along its ray.
         if (held && !hands.some(h => h.hand === held.hand)) drop();
         for (const { hand, m, ray } of hands) {
            if (mode === 'player' && !held && grip[hand]) {
               const b = object.bounds, q = cg.mTransform(cg.mInverse(pose), m.slice(12, 15)), hit = rayBox(mapRay(cg.mInverse(pose), ray), b);
               if (q.every((v, a) => v > b.min[a] - REACH && v < b.max[a] + REACH) || hit !== null && hit <= RAY_REACH) {
                  held = { hand, offset: cg.mMultiply(cg.mInverse(m), pose) };
                  haptic(hand, .6, 40);
               }
            }
            if (held?.hand === hand) {
               if (button(hand, 1)) pose = cg.mMultiply(m, held.offset);
               else drop();
            }
         }
         carry();

         // Walking, turning and teleporting the avatar. The right stick pushed forward aims.
         const turnStick = xr() ? joyStickState.right : { x: (keys.KeyO ? 1 : 0) - (keys.KeyU ? 1 : 0), y: keys.KeyT ? -1 : 0 };
         const stick = xr() ? joyStickState.left : { x: (keys.KeyL ? 1 : 0) - (keys.KeyJ ? 1 : 0), y: (keys.KeyK ? 1 : 0) - (keys.KeyI ? 1 : 0) };
         const pushed = turnStick.y < -PUSH, aim = pushed && !held;
         // After aiming, the stick must come back to the centre before it turns: letting go of it sways it sideways.
         if (pushed) aimed = true;
         else if (Math.abs(turnStick.x) < CENTRE && Math.abs(turnStick.y) < CENTRE) aimed = false;
         const turn = pushed || aimed ? 0 : Math.round(turnStick.x * 1.4);
         if (turn && turn !== turnWas) mapping.turn(-turn * TURN);
         turnWas = turn;
         const walk = Math.hypot(stick.x, stick.y) > .15 ? mapping.direction(head, -stick.y * WALK * dt, stick.x * WALK * dt) : [0, 0, 0];

         if (aim) {
            const ray = xr() ? right?.ray : { o: eye, d: cg.normalize(head.slice(8, 11).map((v, i) => i === 1 ? -v - .6 : -v)) };
            target = ray ? pick(ray) : null;
            message = target ? 'release to go there' : 'point at the table';
         } else {
            if (aiming && target) {
               mapping.setStand(target.p, mapping.stand.yaw);
               rides = target.onObject;
               haptic('right', .5, 30);
            }
            target = null;
         }
         aiming = aim;

         // Stepping, climbing and falling, in the object's frame; the table's edge stops the rest.
         if (!held) {
            const toLocal = cg.mInverse(pose), d = cg.mTransform(toLocal, [...walk, 0]);
            const r = move(boxes(), cg.mTransform(toLocal, mapping.stand.p), d[0], d[2]);
            rides = r.feet[1] > 1e-9;
            const p = cg.mTransform(pose, r.feet);
            mapping.setStand(rides ? p : world.clamp(p, .01), mapping.stand.yaw);
            if (r.blocked && now / 1000 - blockedAt > .3) { blockedAt = now / 1000; haptic('left', .4, 30); }
         }
         if (!message) message = held ? 'carrying the ' + OBJECT : mode === 'player' ? 'grip: pick up the ' + OBJECT : 'trigger: touch the ' + OBJECT;
      } else { aiming = false; target = null; }

      // The object, told where the hands are: mine in my view, my avatar's in its view.
      const toObject = mode === 'avatar' ? cg.mMultiply(cg.mInverse(pose), mapping.toMini) : cg.mInverse(pose);
      object.update({ mode, t, now: now / 1000, dt, haptic, hands: flying ? [] : hands.map(({ hand, m, ray }) => ({
         hand, p: cg.mTransform(toObject, m.slice(12, 15)), ray: mapRay(toObject, ray),
         trigger: button(hand, 0), pressed: trigger[hand], grip: button(hand, 1), gripPressed: grip[hand],
      })) });

      // Draw: the world as it is, or, from the avatar's eyes, 12 times bigger round me.
      worldNode.setMatrix(t ? flight(eye, cg.mTransform(mapping.toMini, eye), mapping.body.yaw - mapping.stand.yaw, t) : cg.mIdentity());
      holder.setMatrix(pose);
      world.update(xr() ? Math.min(1, t / .3) : 1);
      // The scanned room goes in first, under whatever Clay draws next. Just scanned,
      // it shows over the real room in my view too, and fades.
      const W = worldNode.getGlobalMatrix();
      const shown = Math.max(world.solid, .6 * Math.min(1, Math.max(0, PREVIEW + 1 - since)));
      scanDraw.draw(views, W, shown > 0 ? world.scan : null, shown);
      // The panel's picture, every other frame in the headset: in my view from the avatar's eye, level, the
      // way it faces; in the avatar's from mine, where the giant stands.
      if (frames++ % 2 === 0 || !xr()) {
         let at = null;
         if (mode === 'player') { const a = mapping.facing(head); at = look(cg.mTransform(mapping.toMini, eye), [-Math.sin(a), 0, -Math.cos(a)]); }
         else if (giantAt) { const g = giantAt.poses.head; at = look(g.slice(12, 15), g.slice(8, 11).map(v => -v)); }
         if (at) scanDraw.draw([camera.on(cg.mMultiply(W, at))], W, world.scan, 1);
         else camera.off();
      } else camera.off();
      Object.assign(seenWorld, { table: world.table, scan: world.scan });
      seenWorld.update(1);
      marker.setMatrix(target ? cg.mMultiply(cg.mTranslate(target.p[0], target.p[1] + .001, target.p[2]), cg.mScale(.02, .004, .02)) : cg.mScale(0));
      // Held fast to the object in my hand: turned as it has turned since I took it.
      const tilt = held && rides ? cg.mMultiply(pose, cg.mInverse(carried)) : cg.mIdentity();
      const mini = { head: mapping.mini(head), left: left && mapping.mini(left.m), right: right && mapping.mini(right.m) };
      avatar.root.setMatrix(tilt);
      avatar.update(mini, mapping.feet(head), { head: t < .9, body: t < .9, hands: true });
      // To the camera: the avatar whole, seen from the giant; only its hands, seen from its own eye.
      seenAvatar.root.setMatrix(tilt);
      seenAvatar.update(mini, mapping.feet(head), { head: mode === 'avatar', body: mode === 'avatar', hands: true });
      // And me as I am now, for the avatar to see, in my view.
      me.root.setMatrix(mode === 'player' ? cg.mIdentity() : cg.mScale(0));
      if (mode === 'player') me.update({ head, left: left?.m, right: right?.m }, [head[12], 0, head[14]], { head: true, body: true, hands: true });
      // The giant is still: it shows from the start of the flight, its head only once I am clear of it.
      giant.root.setMatrix(giantAt && t ? cg.mIdentity() : cg.mScale(0));
      if (giantAt) giant.update(giantAt.poses, giantAt.feet, { head: t > .3, body: true, hands: true });

      // The wrist panel, above the left controller (on the desktop, low in front).
      const lm = left?.m, f = head.slice(8, 11), x = head.slice(0, 3), y = head.slice(4, 7);
      panel.update({ view: mode, message: scanNote || message }, lm ? [lm[12], lm[13] + .1, lm[14]] : eye.map((v, i) => v - f[i] * .5 - x[i] * .14 - y[i] * .1), eye);
   });

   // Test hooks.
   window.miniatureDebug = { mapping, world, object, moveTable, scanner, scanDraw, takeRoom: room => takeRoom(room, head.slice(12, 15), [-head[8], -head[10]]), get mode() { return mode; }, get t() { return t; }, get pose() { return pose; },
      get stand() { return mapping.stand; }, get feet() { return head && mapping.feet(head); }, get rides() { return rides; }, get target() { return target; } };

   cleanup = ctxForever.miniatureCleanup = () => {
      disposers.forEach(d => d());
      scanner.dispose();
      scanDraw.dispose();
      camera.dispose();
      world.setScan(null);
      delete window.miniatureDebug;
      delete ctxForever.miniatureCleanup;
   };
};

export const deinit = () => { cleanup?.(); cleanup = null; };
