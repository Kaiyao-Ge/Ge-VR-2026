import * as cg from '../render/core/cg.js';
import { ControllerBeam, controllerMatrix, buttonState } from '../render/core/controllerInput.js';

const TAU = 2 * Math.PI;
const STATE = 'solarSystemState';
const DRAG = 1.8; // Exponential friction, per real second.
const DEG = Math.PI / 180;

// Presentation choices, separate from the astronomical data below.
export const DISPLAY = { inclinationScale: 4, innerOrbit: .15, outerOrbit: .95, minGap: .04 };

// Mean orbital periods in days: NASA Planetary Fact Sheet (see doc/hw1.md).
// distanceAU, inclination and ascendingNode: JPL J2000 elements. Sizes are display metres.
export const planets = [
   { name: 'Mercury', period: 88,    distanceAU: .38709927,  size: .019, color: [.60,.56,.51], inclination: 7.00498, ascendingNode: 48.33077 },
   { name: 'Venus',   period: 224.7, distanceAU: .72333566,  size: .028, color: [.95,.70,.32], inclination: 3.39468, ascendingNode: 76.67984 },
   { name: 'Earth',   period: 365.2, distanceAU: 1.00000261, size: .030, color: [.12,.44,1],   inclination: -.00001531, ascendingNode: 0 },
   { name: 'Mars',    period: 687,   distanceAU: 1.52371034, size: .023, color: [.95,.26,.12], inclination: 1.84969, ascendingNode: 49.55954 },
   { name: 'Jupiter', period: 4331,  distanceAU: 5.20288700, size: .053, color: [.85,.61,.39], inclination: 1.30440, ascendingNode: 100.47391 },
   { name: 'Saturn',  period: 10747, distanceAU: 9.53667594, size: .044, color: [.95,.80,.48], inclination: 2.48599, ascendingNode: 113.66242 },
   { name: 'Uranus',  period: 30589, distanceAU: 19.18916464, size: .035, color: [.36,.85,.88], inclination: .77264, ascendingNode: 74.01693 },
   { name: 'Neptune', period: 59800, distanceAU: 30.06992276, size: .034, color: [.20,.30,.95], inclination: 1.77004, ascendingNode: 131.78423 },
];

// Compress adjacent AU gaps, retaining their ordering, then add room for grabbing small planets.
const gapWeights = planets.slice(1).map((planet, i) => Math.sqrt(planet.distanceAU - planets[i].distanceAU));
const totalWeight = gapWeights.reduce((sum, weight) => sum + weight, 0);
const spacingBudget = DISPLAY.outerOrbit - DISPLAY.innerOrbit - DISPLAY.minGap * gapWeights.length;
let orbit = DISPLAY.innerOrbit;
planets.forEach((planet, i) => {
   if (i > 0) orbit += DISPLAY.minGap + spacingBudget * gapWeights[i-1] / totalWeight;
   planet.orbit = orbit;
});

export const orbitAngle = (days, index) =>
   index * 2.4 + TAU * ((days / planets[index].period) % 1);

// JPL J2000 ecliptic elements. Astronomical (x,y,z) maps to scene (x,z,-y).
export const orbitFrame = index => cg.mMultiply(
   cg.mRotateY(planets[index].ascendingNode * DEG),
   cg.mRotateX(planets[index].inclination * DISPLAY.inclinationScale * DEG));

export const angleDelta = (previous, next) => Math.atan2(Math.sin(next - previous), Math.cos(next - previous));

// Ray is in the selected orbital plane's coordinates; +Y is the plane normal.
export function rayOrbitAngle(origin, direction, orbitRadius) {
   if (Math.abs(direction[1]) < .01) return null; // Within about 0.6 degrees of the plane.
   const distance = -origin[1] / direction[1];
   if (distance <= 0) return null;
   const point = cg.add(origin, cg.scale(direction, distance));
   if (Math.hypot(point[0], point[2]) < orbitRadius * .25) return null;
   return Math.atan2(-point[2], point[0]);
}

export function coast(days, speed, seconds) {
   const decay = Math.exp(-DRAG * seconds);
   return [days + speed * (1 - decay) / DRAG, speed * decay];
}

// Direction must be normalized. Return the first intersection in front of the ray.
export function raySphere(origin, direction, center, radius) {
   const offset = cg.subtract(origin, center);
   const b = cg.dot(offset, direction);
   const discriminant = b * b - cg.dot(offset, offset) + radius * radius;
   if (discriminant < 0) return Infinity;
   const near = -b - Math.sqrt(discriminant), far = -b + Math.sqrt(discriminant);
   return near >= 0 ? near : far >= 0 ? far : Infinity;
}

let cleanup;

export const init = async (model, _ctx, ctxForever = {}) => {
   ctxForever.solarCleanup?.(); // The framework's Reload path does not call deinit.
   server.init(STATE, { timeDays: 0, speed: 0, owner: null, planet: -1, baseDays: 0 });
   const now = () => performance.now() / 1000;
   // View transforms are local; only astronomical time is shared with other visitors.
   const view = ctxForever.solarView ||= { center: [0,1,-1.15], scale: 1 };
   const sandbox = model.add().move(view.center).scale(view.scale);
   sandbox.add('sphere').scale(.075).color(3,1.4,.2).dull();

   // One reusable ring mesh; no geometry allocation during animation.
   const ringForm = clay.wire(96, 6, 'solar-orbit');
   const template = sandbox.add(ringForm);
   clay.animateWire(template, .004, u => [Math.cos(TAU*u),0,Math.sin(TAU*u)]);
   sandbox.remove(template);
   const planes = [], orbitNodes = [], pivots = [], bodies = [], halos = [];
   for (const [index, planet] of planets.entries()) {
      const plane = sandbox.add().setMatrix(orbitFrame(index));
      planes.push(plane);
      orbitNodes.push(plane.add(ringForm).scale(planet.orbit).color(.15,.23,.34).dull());
      const pivot = plane.add();
      const body = pivot.add().move(planet.orbit,0,0);
      body.add('sphere').scale(planet.size).color(planet.color);
      halos.push(body.add(ringForm).scale(planet.size * 1.5).color(2,1.6,.5).dull());
      pivots.push(pivot);
      bodies.push(body);
   }
   // Nested hierarchy: the Moon moves around Earth while Earth moves around the Sun.
   const moonPivot = bodies[2].add();
   moonPivot.add('sphere').move(.052,0,0).scale(.009).color(.8,.83,.9);
   bodies[2].add('sphere').move(.012,.017,.015).scale(.017,.008,.012).color(.2,.7,.35);
   bodies[5].add('torusY').turnZ(.45).scale(.055,.006,.055).color(.8,.68,.42).dull();

   // Readable at every chart scale; this panel is not a child of the star map.
   const panel = model.add().move(0,1.35,-1.05);
   panel.add('label').move(0,.12,0).scale(.016).info('A HANDFUL OF TIME').color(1,.85,.5);
   const info = panel.add('label').move(0,.06,0).scale(.011).color(1,.87,.6);
   const hint = panel.add('label').scale(.009).color(.7,.82,1);
   const status = panel.add('label').move(0,-.05,0).scale(.008).color(.6,.75,.85);
   panel.add('label').move(0,-.10,0).scale(.009).info('One grip: move chart | Two grips: stretch / shrink').color(.7,.82,1);
   panel.add('label').move(0,-.15,0).scale(.008).info(`Display: tilt x${DISPLAY.inclinationScale} | compressed orbit spacing`).color(.6,.75,.85);

   const beams = {}, hover = { left: -1, right: -1 };
   for (const hand of ['left','right']) beams[hand] = new ControllerBeam(model, hand);
   let grab = null, lastSend = 0, lastBroadcast = 0, ownerSeen = 0;
   let viewGesture = null;
   let shownDays = window[STATE].timeDays;

   const tracked = hand => window.isXR() && !window.handtracking &&
                          controllerMatrix[hand].length === 16 && inputEvents.pos(hand);
   const gripMask = () => (tracked('left') && buttonState.left[1]?.pressed ? 1 : 0) |
                          (tracked('right') && buttonState.right[1]?.pressed ? 2 : 0);
   const pulse = (hand, strength, duration) => {
      // Feedback is optional on browsers/controllers without a haptic actuator.
      try { window.vibrate?.(hand, strength, duration); } catch (_) { /* no actuator */ }
   };
   const owns = (state, id, hand, token) => state.owner &&
      state.owner.id === id && state.owner.hand === hand && state.owner.token === token;

   function receive(messages, id) {
      if (!isMasterClient()) return;
      const state = window[STATE];
      for (const message of Object.values(messages)) {
         if (message.type === 'press') {
            if (state.owner || !planets[message.planet]) continue;
            state.owner = { id, hand: message.hand, token: message.token };
            state.planet = message.planet;
            state.baseDays = state.timeDays;
            state.speed = 0;
         } else if (owns(state, id, message.hand, message.token)) {
            state.timeDays = state.baseDays + message.days;
            state.speed = message.type === 'release' ? message.speed : 0;
            if (message.type === 'release') state.owner = null;
         } else continue;
         ownerSeen = now();
         lastBroadcast = -Infinity; // Claims and releases are visible immediately.
      }
   }

   function beamMatrix(hand) {
      const beam = beams[hand];
      beam.isEnabled = !!tracked(hand);
      beam.update();
      return beam.isEnabled ? beam.beamMatrix() : null;
   }

   function localRay(matrix, plane) {
      const local = cg.mMultiply(cg.mInverse(plane.getGlobalMatrix()), matrix);
      return [local.slice(12,15), cg.normalize(cg.scale(local.slice(8,11), -1))];
   }

   function pick(hand) {
      const matrix = beamMatrix(hand);
      if (!matrix) return -1;
      let nearest = Infinity, index = -1;
      for (let i = 0; i < planets.length; i++) {
         const angle = orbitAngle(shownDays, i), radius = planets[i].orbit;
         const distance = raySphere(...localRay(matrix, planes[i]),
            [radius*Math.cos(angle),0,-radius*Math.sin(angle)], Math.max(.033, planets[i].size * 1.3));
         if (distance < nearest) { nearest = distance; index = i; }
      }
      return index;
   }

   function pointerAngle(hand, planet) {
      const matrix = beamMatrix(hand);
      return matrix ? rayOrbitAngle(...localRay(matrix, planes[planet]), planets[planet].orbit) : null;
   }

   function sample() {
      const time = now(), elapsed = time - grab.sampleTime;
      if (elapsed <= 0) return;
      const angle = pointerAngle(grab.hand, grab.planet);
      const delta = angle === null || grab.angle === null ? 0 : angleDelta(grab.angle, angle);
      grab.angle = angle; // Rebase after crossing the centre, tracking gaps, or grazing rays.
      // A >90-degree jump in one sample is a discontinuity, not a useful fling.
      const radians = elapsed > .2 || Math.abs(delta) > Math.PI/2 ? 0 : delta;
      const days = radians * planets[grab.planet].period / TAU;
      grab.radians += radians;
      grab.days += days;
      grab.speed = days / elapsed;
      grab.sampleTime = time;
      // One tactile notch per 15 degrees, independent of scale and real orbital period.
      const notch = Math.trunc(grab.radians / (15 * DEG));
      if (grab.accepted && notch !== grab.notch && time - grab.pulseTime > .09) {
         pulse(grab.hand, .18, 15);
         grab.notch = notch;
         grab.pulseTime = time;
      }
   }

   function send(type, speed = 0) {
      server.send(STATE, { type, hand: grab.hand, token: grab.token,
                          planet: grab.planet, days: grab.days, speed });
      lastSend = now();
   }

   function release(cancel = false) {
      if (!grab) return;
      // onDrag samples every frame, including stationary frames: no stale fling after a hold.
      const speed = !cancel && now() - grab.sampleTime < .1 ? grab.speed : 0;
      send('release', speed);
      pulse(grab.hand, .25, 25);
      grab = null;
   }

   function moveView() {
      const mask = gripMask();
      if (!mask) { viewGesture = null; return; }
      release(true); // Moving the map must not accidentally advance astronomical time.
      const inverse = cg.mInverse(model.getGlobalMatrix());
      const points = ['left','right'].filter((_, i) => mask & (1 << i))
         .map(hand => cg.mTransform(inverse, controllerMatrix[hand].slice(12,15)));
      const anchor = points.length === 2 ? cg.mix(points[0], points[1], .5) : points[0];
      const distance = points.length === 2 ? cg.distance(points[0], points[1]) : 1;
      if (distance < .08) { viewGesture = null; return; }
      if (viewGesture?.mask !== mask) {
         viewGesture = { mask, anchor, distance, center: view.center.slice(), scale: view.scale };
         return; // Adding/removing a hand establishes a new baseline without jumping.
      }
      view.scale = cg.clamp(viewGesture.scale * distance / viewGesture.distance, .25, 20);
      view.center = cg.add(anchor, cg.scale(cg.subtract(viewGesture.center, viewGesture.anchor), view.scale / viewGesture.scale));
      sandbox.identity().move(view.center).scale(view.scale);
   }

   const callbacks = {
      onPress: hand => {
         if (grab || window[STATE].owner || gripMask()) return;
         const planet = pick(hand);
         if (planet < 0) return;
         grab = { hand, planet, angle: pointerAngle(hand, planet), token: now(), radians: 0,
                  days: 0, speed: 0, sampleTime: now(), notch: 0, pulseTime: 0, accepted: false };
         send('press');
      },
      onDrag: hand => {
         if (!grab || grab.hand !== hand) return;
         if (!window.isXR() || window.handtracking || gripMask()) { release(true); return; }
         sample();
         if (now() - lastSend >= .05) send(grab.accepted ? 'drag' : 'press');
      },
      onRelease: hand => { if (grab?.hand === hand) release(); },
      onMove: () => {}, onClick: () => {}, onDoublePress: () => {},
   };
   const previous = {};
   for (const key in callbacks) {
      previous[key] = inputEvents[key];
      inputEvents[key] = callbacks[key];
   }

   const cancel = () => {
      release(true);
      viewGesture = null;
      server.sync(STATE, receive); // Flush release even when there will be no next frame.
      if (isMasterClient()) server.broadcastGlobal(STATE);
   };
   const visibility = () => { if (document.hidden) cancel(); };
   document.addEventListener('visibilitychange', visibility);
   window.addEventListener('pagehide', cancel);
   cleanup = ctxForever.solarCleanup = () => {
      cancel();
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('pagehide', cancel);
      for (const key in callbacks)
         if (inputEvents[key] === callbacks[key]) inputEvents[key] = previous[key];
      delete ctxForever.solarCleanup;
   };

   model.animate(() => {
      if (grab && (!window.isXR() || window.handtracking)) release(true);
      moveView();
      server.sync(STATE, receive); // Framework persistence remains at its default 3 seconds.
      const state = window[STATE], dt = Math.min(model.deltaTime, .1), time = now();
      if (isMasterClient()) {
         // A disconnected / suspended controller must not leave the shared clock locked.
         if (state.owner && (!clients.includes(state.owner.id) || time - ownerSeen > 1.5)) {
            state.owner = null;
            state.speed = 0;
         }
         if (!state.owner) {
            [state.timeDays, state.speed] = coast(state.timeDays, state.speed, dt);
            if (Math.abs(state.speed) < .001) state.speed = 0;
         }
         if (time - lastBroadcast >= .05) {
            server.broadcastGlobal(STATE);
            lastBroadcast = time;
         }
      }
      if (grab) {
         if (owns(state, clientID, grab.hand, grab.token)) {
            if (!grab.accepted) { pulse(grab.hand, .4, 35); grab.accepted = true; }
         } else if (state.owner || grab.accepted || time - grab.token > 1.5) grab = null;
      }
      const localDrag = grab && owns(state, clientID, grab.hand, grab.token);
      if (localDrag) shownDays = state.baseDays + grab.days;
      else if (isMasterClient()) shownDays = state.timeDays;
      else shownDays += (state.timeDays - shownDays) * (1 - Math.exp(-20 * dt));

      for (let i = 0; i < planets.length; i++) pivots[i].identity().turnY(orbitAngle(shownDays, i));
      // Cancel Earth's orbital frame rotation so the Moon's period is relative to fixed axes.
      moonPivot.identity().turnY(TAU * ((shownDays / 27.3) % 1) - orbitAngle(shownDays, 2));
      const head = clientState.head(clientID);
      if (window.isXR() && head?.length === 16) panel.setMatrix(head).move(0,-.32,-.9).turnX(-.3);
      for (const hand of ['left','right']) hover[hand] = pick(hand);
      const selected = state.owner ? state.planet : hover.right >= 0 ? hover.right : hover.left;
      for (let i = 0; i < planets.length; i++) {
         halos[i].opacity(selected === i ? 1 : 0);
         orbitNodes[i].color(selected === i ? [.8,.55,.15] : [.15,.23,.34]);
      }
      // Use a finite set of strings: the renderer caches a separate mesh for each label text.
      info.info(selected < 0 ? 'Point at any planet' : `${planets[selected].name}  |  ${planets[selected].period} Earth days / orbit`);
      let instruction = 'Aim + hold trigger. Sweep along the orbit.';
      if (viewGesture) instruction = 'One grip moves the chart. Two grips stretch / shrink.';
      else if (state.owner) instruction = !localDrag ? 'Someone is turning time. Your turn is next.'
         : grab.angle === null ? 'Aim back along the orbit to resume.' : 'Sweep the beam along the orbit. Release to coast.';
      hint.info(instruction);
      status.info(state.owner ? 'ONE SHARED CLOCK  |  HELD' : state.speed > .001 ? 'TIME FORWARD  |  COASTING'
                  : state.speed < -.001 ? 'TIME REVERSED  |  COASTING' : 'TIME AT REST  |  REAL PERIOD RATIOS, DISPLAY-SCALED WORLDS');
   });
};

export const deinit = () => { cleanup?.(); cleanup = null; };
