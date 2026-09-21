// Run with Node 18+: node --experimental-vm-modules tests/solar-system.test.cjs
// Uses the real scene, math library and ControllerBeam; mocks only rendering and transport.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');

async function fixture() {
   let seconds = 10;
   const listeners = new Map(), queue = [], broadcasts = [], pulses = [];
   const context = vm.createContext({ console, performance: { now: () => seconds * 1000 } });
   context.window = context;
   context.addEventListener = (name, fn) => listeners.set(name, fn);
   context.removeEventListener = name => listeners.delete(name);
   context.document = { hidden: false, addEventListener: context.addEventListener, removeEventListener: context.removeEventListener };
   context.clients = [0,1];
   context.clientID = 0;
   context.isMasterClient = () => context.clientID === context.clients[0];
   context.isXR = () => true;
   context.vibrate = (...args) => pulses.push(args);
   const modules = new Map();
   async function load(filename) {
      if (modules.has(filename)) return modules.get(filename);
      const module = new vm.SourceTextModule(await fs.readFile(filename, 'utf8'), { context, identifier: filename });
      modules.set(filename, module);
      await module.link(async (specifier, parent) => {
         if (specifier.includes('corelink_sender'))
            return new vm.SyntheticModule(['corelink_event'], function() { this.setExport('corelink_event', () => {}); }, { context });
         return load(path.resolve(path.dirname(parent.identifier), specifier));
      });
      return module;
   }
   const sceneModule = await load(path.join(root, 'js/scenes/solarSystem.js'));
   await sceneModule.evaluate();
   const scene = sceneModule.namespace;
   const cg = modules.get(path.join(root, 'js/render/core/cg.js')).namespace;
   const controllers = modules.get(path.join(root, 'js/render/core/controllerInput.js')).namespace.controllerMatrix;
   const buttons = modules.get(path.join(root, 'js/render/core/controllerInput.js')).namespace.buttonState;
   class Node {
      constructor(form, parent = null) { this.form = form; this.parent = parent; this.children = []; this.matrix = cg.mIdentity(); }
      add(form) { const child = new Node(form, this); this.children.push(child); return child; }
      remove(node) { this.children.splice(this.children.indexOf(node), 1); return this; }
      child(i) { return this.children[i]; }
      identity() { this.matrix = cg.mIdentity(); return this; }
      setMatrix(matrix) { this.matrix = matrix; return this; }
      getGlobalMatrix() { return this.parent ? cg.mMultiply(this.parent.getGlobalMatrix(), this.matrix) : this.matrix; }
      transform(matrix) { this.matrix = cg.mMultiply(this.matrix, matrix); return this; }
      move(...args) { return this.transform(cg.mTranslate(...args)); }
      scale(...args) { return this.transform(cg.mScale(...args)); }
      turnX(angle) { return this.transform(cg.mRotateX(angle)); }
      turnY(angle) { return this.transform(cg.mRotateY(angle)); }
      turnZ(angle) { return this.transform(cg.mRotateZ(angle)); }
      color(...value) { this.rgb = value; return this; }
      dull() { return this; }
      opacity(value) { this.alpha = value; return this; }
      info(value) { this.text = value; return this; }
      animate(fn) { this.frame = fn; return this; }
   }
   const model = new Node();
   context.worldCoords = cg.mIdentity();
   context.clay = { inverseRootMatrix: cg.mIdentity(), wire: () => 'test-ring', animateWire: () => {} };
   context.inputEvents = { pos: hand => controllers[hand].slice(12,15), onPress: () => 'previous' };
   const previousPress = context.inputEvents.onPress;
   context.clientState = { head: () => cg.mIdentity() };
   context.server = {
      init: (name, initial) => { context[name] ??= initial; },
      send: (name, message) => queue.push({ id: context.clientID, message }),
      sync: (name, receive) => { for (const item of queue.splice(0)) receive([item.message], item.id); },
      broadcastGlobal: name => broadcasts.push(JSON.parse(JSON.stringify(context[name]))),
   };
   const persistent = {};
   await scene.init(model, {}, persistent);
   function step(dt = 1/72) { seconds += dt; model.deltaTime = dt; model.frame(); }
   function setRay(origin, direction, hand = 'right') {
      const beam = cg.mMultiply(cg.mTranslate(origin), cg.mAimZ(cg.scale(direction, -1)));
      controllers[hand] = cg.mMultiply(beam, cg.mMultiply(cg.mTranslate(0,-.02,0), cg.mRotateX(Math.PI/4)));
   }
   function point(index, angle, hand = 'right') {
      const p = scene.planets[index];
      const frame = cg.mMultiply(model.child(0).getGlobalMatrix(), scene.orbitFrame(index));
      const origin = cg.mTransform(frame, [0,.6,0]);
      const target = cg.mTransform(frame, [p.orbit*Math.cos(angle),0,-p.orbit*Math.sin(angle)]);
      setRay(origin, cg.normalize(cg.subtract(target, origin)), hand);
   }
   function aim(index, hand = 'right') {
      point(index, scene.orbitAngle(context.solarSystemState.timeDays, index), hand);
      step();
   }
   function sweep(index, angle, dt = .06, hand = 'right') {
      point(index, angle, hand);
      step(dt);
      context.inputEvents.onDrag(hand);
      step();
   }
   function grip(hand, position, pressed = true) {
      controllers[hand] = cg.mTranslate(position);
      buttons[hand][1] = { pressed };
   }
   function request(id, type, token, days = 0, speed = 0, planet = 2) {
      queue.push({ id, message: { type, token, days, speed, planet, hand: 'right' } });
   }
   return { scene, cg, model, context, controllers, buttons, listeners, broadcasts, pulses, step, aim, point, setRay, sweep, grip,
            request, previousPress, persistent,
            state: () => context.solarSystemState };
}

test('all eight planets obey one clock, with reversible mean-period ratios', async () => {
   const { scene } = await fixture();
   assert.equal(scene.planets.length, 8);
   for (let i = 0; i < 8; i++) {
      const delta = scene.orbitAngle(1, i) - scene.orbitAngle(0, i);
      assert.ok(Math.abs(delta * scene.planets[i].period - 2*Math.PI) < 1e-10);
      assert.ok(Math.abs(scene.orbitAngle(-1, i) + scene.orbitAngle(1, i) - 2*scene.orbitAngle(0,i)) < 1e-12);
      assert.ok(Math.abs(scene.orbitAngle(scene.planets[i].period, i) - scene.orbitAngle(0,i)) < 1e-12);
   }
});

test('inertia is frame-rate independent and supports reverse time', async () => {
   const { scene } = await fixture();
   for (const speed of [500,-500]) {
      const expected = scene.coast(10, speed, 2);
      for (const fps of [30,72,90,120]) {
         let result = [10,speed];
         for (let i = 0; i < fps*2; i++) result = scene.coast(...result, 1/fps);
         assert.ok(Math.abs(result[0] - expected[0]) < 1e-10);
         assert.ok(Math.abs(result[1] - expected[1]) < 1e-10);
      }
   }
});

test('ray picking rejects misses and targets behind the controller', async () => {
   const { scene } = await fixture();
   assert.equal(scene.raySphere([0,0,0],[0,0,-1],[0,0,-2],.5), 1.5);
   assert.equal(scene.raySphere([0,0,0],[0,0,-1],[0,0,2],.5), Infinity);
   assert.equal(scene.raySphere([0,0,0],[0,0,-1],[2,0,-2],.5), Infinity);
   assert.equal(scene.raySphere([0,0,0],[0,0,-1],[0,0,0],.5), .5);
});

test('real controller beam can select each of the eight planets', async () => {
   for (let i = 0; i < 8; i++) {
      const f = await fixture();
      f.aim(i);
      f.context.inputEvents.onPress('right');
      f.step();
      assert.equal(f.state().planet, i);
      assert.equal(f.state().owner.id, 0);
      await f.scene.deinit();
   }
});

test('drag moves the shared clock, stationary hold releases without stale inertia', async () => {
   const f = await fixture();
   f.aim(7);
   f.context.inputEvents.onPress('right');
   f.step();
   const angle = f.scene.orbitAngle(0, 7) + .12;
   f.sweep(7, angle);
   assert.ok(Math.abs(f.state().timeDays - .12*f.scene.planets[7].period/(2*Math.PI)) < 1e-9);
   f.sweep(7, angle);
   f.context.inputEvents.onRelease('right');
   f.step();
   assert.equal(f.state().owner, null);
   assert.equal(f.state().speed, 0);
   assert.ok(f.pulses.length >= 2);
});

test('only one client owns the clock; old or conflicting drag messages cannot overwrite it', async () => {
   const f = await fixture();
   f.request(1, 'press', 11);
   f.request(0, 'press', 12);
   f.step();
   assert.equal(f.state().owner.id, 1);
   f.request(0, 'drag', 12, 999);
   f.request(1, 'drag', 10, 999);
   f.request(1, 'drag', 11, 42);
   f.step();
   assert.equal(f.state().timeDays, 42);
   f.request(1, 'release', 11, 42, -10);
   f.step();
   assert.equal(f.state().owner, null);
   assert.ok(f.state().speed < 0);
   assert.ok(f.state().timeDays < 42);
});

test('stalled and disconnected owners are released; followers do not write authoritative state', async () => {
   const f = await fixture();
   f.request(1, 'press', 1);
   f.step();
   f.step(2);
   assert.equal(f.state().owner, null);
   f.request(1, 'press', 2);
   f.step();
   f.context.clients = [0];
   f.step();
   assert.equal(f.state().owner, null);
   f.context.clients = [0,1];
   f.context.clientID = 1;
   const before = f.broadcasts.length;
   f.request(1, 'press', 3);
   f.step();
   assert.equal(f.state().owner, null);
   assert.equal(f.broadcasts.length, before);
});

test('scene exit releases ownership and restores callbacks and listeners', async () => {
   const f = await fixture();
   f.aim(2);
   f.context.inputEvents.onPress('right');
   f.step();
   assert.ok(f.state().owner);
   await f.scene.deinit();
   assert.equal(f.state().owner, null);
   assert.equal(f.context.inputEvents.onPress, f.previousPress);
   assert.equal(f.listeners.size, 0);
});

test('moving release coasts, and head direction does not affect ray-based dragging', async () => {
   const f = await fixture();
   f.aim(2);
   f.context.inputEvents.onPress('right');
   f.step();
   f.context.clientState.head = () => f.cg.mRotateY(Math.PI/2);
   f.sweep(2, f.scene.orbitAngle(0, 2) + .1);
   f.context.inputEvents.onRelease('right');
   f.step();
   assert.ok(f.state().timeDays > .1*f.scene.planets[2].period/(2*Math.PI));
   assert.ok(f.state().speed > 0);
   const speed = f.state().speed, days = f.state().timeDays;
   f.step();
   assert.ok(f.state().timeDays > days);
   assert.ok(f.state().speed < speed);
});

test('lost XR mode and hidden page cancel the grab without a fling', async () => {
   for (const method of ['xr','hidden']) {
      const f = await fixture();
      f.aim(2);
      f.context.inputEvents.onPress('right');
      f.step();
      if (method === 'xr') { f.context.isXR = () => false; f.step(); }
      else { f.context.document.hidden = true; f.listeners.get('visibilitychange')(); }
      assert.equal(f.state().owner, null);
      assert.equal(f.state().speed, 0);
   }
});

test('Reload clears old callbacks; animation does not allocate scene nodes', async () => {
   const f = await fixture();
   const count = node => 1 + node.children.reduce((sum, child) => sum + count(child), 0);
   const before = count(f.model);
   for (let i = 0; i < 200; i++) f.step();
   assert.equal(count(f.model), before);
   f.model.children = []; // The framework clears geometry, but does not call deinit on Reload.
   await f.scene.init(f.model, {}, f.persistent);
   await f.scene.deinit();
   assert.equal(f.context.inputEvents.onPress, f.previousPress);
   assert.equal(f.listeners.size, 0);
   assert.equal(f.persistent.solarCleanup, undefined);
});

test('wrist-only ray sweeps continue through two full turns in either direction', async () => {
   for (const index of [0,2,7]) for (const direction of [1,-1]) {
      const f = await fixture();
      f.aim(index);
      f.context.inputEvents.onPress('right');
      f.step();
      const start = f.scene.orbitAngle(0, index);
      let previous = 0;
      for (let n = 1; n <= 144; n++) {
         f.sweep(index, start + direction*n*Math.PI/36, 1/72);
         assert.ok(f.state().owner, 'grip must survive the half-circle and wrap boundaries');
         assert.ok(direction * (f.state().timeDays - previous) >= -1e-9, 'no reversal near a projection limit');
         previous = f.state().timeDays;
      }
      f.sweep(index, start + direction*4*Math.PI); // Flush the final 20 Hz network update.
      assert.ok(Math.abs(f.state().timeDays - direction*2*f.scene.planets[index].period) < 1e-7);
   }
});

test('signed angles unwrap across +/-180 degrees without changing direction', async () => {
   const { scene, cg } = await fixture(), deg = Math.PI/180;
   assert.ok(Math.abs(scene.angleDelta(179*deg, -179*deg) - 2*deg) < 1e-12);
   assert.ok(Math.abs(scene.angleDelta(-179*deg, 179*deg) + 2*deg) < 1e-12);
   assert.equal(scene.rayOrbitAngle([0,1,0], [1,0,0], .3), null);
   assert.equal(scene.rayOrbitAngle([0,1,0], [0,1,0], .3), null);
   assert.equal(scene.rayOrbitAngle([0,1,0], [0,-1,0], .3), null);
   assert.equal(scene.rayOrbitAngle([0,0,0], [0,-1,0], .3), null);
   // At 20x scale, a hand 40 cm above the plane can still point to the outermost orbit.
   const radius = scene.planets[7].orbit;
   assert.equal(scene.rayOrbitAngle([0,.02,0], cg.normalize([radius,-.02,0]), radius), -0);
});

test('invalid rays and temporary tracking gaps retain ownership and resume without jumps', async () => {
   for (const gap of ['parallel','tracking','long-frame','angle-jump']) {
      const f = await fixture(), index = 2, start = f.scene.orbitAngle(0, index);
      f.aim(index);
      f.context.inputEvents.onPress('right');
      f.step();
      f.sweep(index, start + .1);
      const days = f.state().timeDays;
      if (gap === 'tracking') f.controllers.right = [];
      if (gap === 'parallel') f.setRay([0,1.5,-1.15], [1,0,0]);
      if (gap === 'angle-jump') f.point(index, start + Math.PI);
      f.step(gap === 'long-frame' ? .4 : .06);
      f.context.inputEvents.onDrag('right');
      f.step();
      assert.ok(f.state().owner);
      assert.ok(Math.abs(f.state().timeDays - days) < 1e-8);
      if (gap === 'tracking' || gap === 'parallel') {
         f.sweep(index, start + 1);
         assert.ok(Math.abs(f.state().timeDays - days) < 1e-8, 'first valid sample only rebases');
         f.sweep(index, start + 1.1);
      } else f.sweep(index, start + (gap === 'angle-jump' ? Math.PI : .1) + .1);
      assert.ok(Math.abs(f.state().timeDays - days - .1*f.scene.planets[index].period/(2*Math.PI)) < 1e-8);
   }
});

test('display-exaggerated J2000 planes contain both the rendered orbit and moving planet', async () => {
   const f = await fixture();
   const sandbox = f.model.child(0);
   assert.equal(sandbox.children.some(node => node.form === 'tubeY'), false, 'no base disc');
   for (let i = 0; i < 8; i++) {
      const frame = f.scene.orbitFrame(i), p = f.scene.planets[i];
      const normal = frame.slice(4,7);
      const ascending = f.cg.mTransform(frame, [1,0,0]);
      assert.ok(Math.abs(normal[1] - Math.cos(p.inclination*f.scene.DISPLAY.inclinationScale*Math.PI/180)) < 1e-12);
      assert.ok(Math.abs(ascending[0] - Math.cos(p.ascendingNode*Math.PI/180)) < 1e-12);
      assert.ok(Math.abs(ascending[1]) < 1e-12);
      const plane = sandbox.child(i+1), ring = plane.child(0), body = plane.child(1).child(0);
      const toPlane = f.cg.mInverse(plane.getGlobalMatrix());
      const position = f.cg.mTransform(toPlane, body.getGlobalMatrix().slice(12,15));
      assert.ok(Math.abs(position[1]) < 1e-12);
      assert.ok(Math.abs(Math.hypot(position[0], position[2]) - p.orbit) < 1e-12);
      assert.equal(ring.parent, plane);
   }
});

test('display spacing compresses real AU gaps while preserving data and a bounded, usable chart', async () => {
   const { scene } = await fixture(), { planets, DISPLAY } = scene;
   assert.equal(DISPLAY.inclinationScale, 4);
   assert.equal(planets[0].inclination, 7.00498, 'keep real inclinations in the data table');
   assert.equal(planets[0].distanceAU, .38709927);
   assert.equal(planets[7].distanceAU, 30.06992276);
   assert.equal(planets[0].orbit, DISPLAY.innerOrbit);
   assert.ok(Math.abs(planets[7].orbit - DISPLAY.outerOrbit) < 1e-12);
   const gaps = planets.slice(1).map((p,i) => ({
      actual: p.distanceAU - planets[i].distanceAU, display: p.orbit - planets[i].orbit,
   }));
   for (let i = 0; i < gaps.length; i++) {
      const gap = gaps[i];
      assert.ok(gap.display > DISPLAY.minGap);
      assert.ok(gap.display > planets[i].size + planets[i+1].size, 'adjacent planet bodies have radial clearance');
      assert.ok(Math.abs((gap.display-DISPLAY.minGap)/Math.sqrt(gap.actual)
         - (gaps[0].display-DISPLAY.minGap)/Math.sqrt(gaps[0].actual)) < 1e-12);
      for (const other of gaps)
         assert.equal(Math.sign(gap.display-other.display), Math.sign(gap.actual-other.actual));
   }
   const outerToInner = gaps[6].display / gaps[1].display;
   assert.ok(outerToInner > 2 && outerToInner < 4, 'visibly unequal, but not true-scale expanses');
   assert.ok(outerToInner < gaps[6].actual / gaps[1].actual);
   assert.ok(DISPLAY.outerOrbit*2 <= 2, 'tabletop chart remains about two metres across');
});

test('one grip moves in 3D; two grips scale around their midpoint without camera or clock changes', async () => {
   const f = await fixture(), view = f.persistent.solarView;
   const assertVector = (a,b) => a.forEach((value,i) => assert.ok(Math.abs(value-b[i]) < 1e-10));
   const initialWorld = Array.from(f.context.worldCoords);
   const initialState = JSON.stringify(f.state());
   f.grip('right', [.2,1,-.5]); f.step();
   f.grip('right', [.5,1.2,-.3]); f.step();
   assertVector(view.center, [.3,1.2,-.95]);
   assert.equal(view.scale, 1);
   f.grip('left', [-.5,1.2,-.3]); f.step();
   assertVector(view.center, [.3,1.2,-.95]); // No jump on switching from one to two grips.
   f.grip('left', [-1,1.2,-.3]); f.grip('right', [1,1.2,-.3]); f.step();
   assert.equal(view.scale, 2);
   assertVector(view.center, [.6,1.2,-1.6]);
   assertVector(f.model.child(0).getGlobalMatrix().slice(12,15), view.center);
   assert.equal(f.model.child(1).getGlobalMatrix()[0], 1, 'instruction panel is not scaled with the map');
   f.grip('left', [-1,1.2,-.3], false); f.step();
   assertVector(view.center, [.6,1.2,-1.6]); // No jump when one hand is released.
   f.grip('right', [1,1.5,-.3]); f.step();
   assertVector(view.center, [.6,1.5,-1.6]);
   f.grip('right', [1,1.5,-.3], false); f.step();
   assert.deepEqual(Array.from(f.context.worldCoords), initialWorld);
   assert.equal(JSON.stringify(f.state()), initialState);
});

test('all eight planets remain pickable and draggable after moving, scaling and recentering', async () => {
   for (let index = 0; index < 8; index++) {
      const f = await fixture();
      const rootTransform = f.cg.mMultiply(f.cg.mTranslate(.8,0,.4), f.cg.mRotateY(.7));
      f.model.setMatrix(rootTransform);
      f.context.worldCoords = rootTransform;
      f.context.clay.inverseRootMatrix = f.cg.mInverse(rootTransform);
      f.grip('left', [-.2,1,-.5]); f.grip('right', [.2,1,-.5]); f.step();
      f.grip('left', [-1,1.4,-.9]); f.grip('right', [1,1.4,-.9]); f.step();
      assert.ok(Math.abs(f.persistent.solarView.scale - 5) < 1e-12);
      f.grip('left', [-1,1.4,-.9], false); f.grip('right', [1,1.4,-.9], false); f.step();
      f.aim(index);
      f.context.inputEvents.onPress('right'); f.step();
      assert.equal(f.state().planet, index);
      f.sweep(index, f.scene.orbitAngle(0, index) + .2);
      assert.ok(Math.abs(f.state().timeDays - .2*f.scene.planets[index].period/(2*Math.PI)) < 1e-8);
   }
});

test('grips cancel planet dragging without inertia and block competing trigger presses', async () => {
   const f = await fixture();
   f.aim(2); f.context.inputEvents.onPress('right'); f.step();
   f.sweep(2, f.scene.orbitAngle(0,2) + .1);
   const days = f.state().timeDays;
   f.grip('left', [-.2,1,-.5]); f.step();
   assert.equal(f.state().owner, null);
   assert.equal(f.state().speed, 0);
   f.context.inputEvents.onPress('right'); f.step();
   assert.equal(f.state().owner, null);
   assert.equal(f.state().timeDays, days);
});

test('scale bounds and nearly touching hands never produce a zero or infinite transform', async () => {
   const f = await fixture();
   f.grip('left', [-.1,1,-.5]); f.grip('right', [.1,1,-.5]); f.step();
   f.grip('left', [-10,1,-.5]); f.grip('right', [10,1,-.5]); f.step();
   assert.equal(f.persistent.solarView.scale, 20);
   f.grip('left', [0,1,-.5]); f.grip('right', [0,1,-.5]); f.step();
   assert.equal(f.persistent.solarView.scale, 20);
   assert.ok(f.model.child(0).getGlobalMatrix().every(Number.isFinite));
   f.grip('left', [-10,1,-.5]); f.grip('right', [10,1,-.5]); f.step();
   f.grip('left', [-.05,1,-.5]); f.grip('right', [.05,1,-.5]); f.step();
   assert.equal(f.persistent.solarView.scale, .25);
});
