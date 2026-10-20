// Construction site checks without a browser: kinematics, IK, load, the
// design format, static physics, and building the hand-written tower.
// Run: node tests/construction.test.cjs
const assert = require('node:assert/strict');
const load = require('./esm.cjs');

// Minimal stand-in for Clay nodes: every method chains, add() makes a child.
function fakeNode() {
   const node = new Proxy({}, { get: (_, k) => k === 'add' ? () => fakeNode() : k === 'nChildren' ? () => 0 : () => node });
   return node;
}
globalThis.window = { clay: { formMesh: () => false, definePathsMesh() {} } };
const noSTL = { '../../render/core/stl.js': 'data:text/javascript,export const stl = () => {};' };

let passed = 0;
const check = async (name, fn) => { await fn(); passed++; console.log('ok -', name); };

(async () => {
   const k = await load('js/scenes/construction/kinematics.js');
   const cg = await load('js/render/core/cg.js');
   const { Arm } = await load('js/scenes/construction/arm.js', noSTL);
   const { compile, hingeYaw, gripPoint } = await load('js/scenes/construction/design.js');
   const { checkStructure } = await load('js/scenes/construction/physics.js');
   const { Builder, simulate } = await load('js/scenes/construction/plan.js', noSTL);
   const { TOWER } = await load('js/scenes/construction/designs/tower.js');
   const { Draft } = await load('js/scenes/construction/tools.js', noSTL);
   const variant = f => { const d = structuredClone(TOWER); f(d); return compile(d); };
   const kinds = r => r.failures.map(f => f.kind);

   await check('pan axis is vertical and the pitch axes are parallel and horizontal', () => {
      const f = k.forward(k.baseMatrix([0, 0, 0], .3), [0, 0, 0, 0, 0, 0]);
      assert.ok(Math.abs(Math.abs(k.zAxis(f.shoulder_pan)[1]) - 1) < 1e-4); // URDF angles are rounded
      for (const j of ['shoulder_lift', 'elbow_flex', 'wrist_flex']) {
         assert.ok(Math.abs(k.zAxis(f[j])[1]) < 1e-4);
         assert.ok(Math.abs(cg.dot(k.zAxis(f[j]), k.zAxis(f.shoulder_lift))) > .999);
      }
   });

   await check('IK finds almost every reachable top-down target', () => {
      const base = k.baseMatrix([0, 0, 0], .7);
      let seed = 1, n = 0, found = 0;
      const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
      while (n < 200) {
         const q = k.JOINTS.slice(0, 5).map(j => j.lo + rnd() * (j.hi - j.lo)); q.push(.2);
         const t = k.tool(k.forward(base, q));
         if (Math.acos(Math.min(1, -t.approach[1])) > .05 || t.tip[1] < 0) continue;
         n++;
         if (k.reach(base, k.READY, t.tip).ok) found++;
      }
      assert.ok(found / n >= .97, `${found}/${n}`);
   });

   await check('panToward inverts the pan sweep', () => {
      const base = k.baseMatrix([.1, .05, -.2], 1.1);
      const axis = k.origin(k.forward(base, [0, 0, 0, 0, 0, 0]).shoulder_pan);
      for (const t of [-1.5, -.4, 0, .5, 1.8]) {
         const a = 1.1 - t, p = [axis[0] + Math.cos(a) * .2, .02, axis[2] - Math.sin(a) * .2];
         assert.ok(Math.abs(k.panToward(base, p) - t) < 1e-4, `${t}`);
      }
   });

   await check('load grows with payload and reach; a vertical gripper loads the wrist least', () => {
      const base = k.baseMatrix([0, 0, 0], 0);
      const near = k.reach(base, k.READY, [.12, .03, 0]), far = k.reach(base, k.READY, [.27, .03, 0]);
      const ln = k.load(k.forward(base, near.q)), lf = k.load(k.forward(base, far.q));
      const heavy = k.load(k.forward(base, far.q), .2);
      assert.ok(Math.abs(lf[0].torque) > Math.abs(ln[0].torque));
      assert.ok(Math.abs(heavy[0].torque) > Math.abs(lf[0].torque));
      assert.ok(Math.abs(lf[2].torque) < Math.abs(lf[1].torque));
   });

   await check('segment distance', () => {
      assert.equal(k.segmentDistance([0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0]).distance, 1);
      assert.ok(k.segmentDistance([0, 0, 0], [1, 0, 0], [.5, -1, 1], [.5, 1, 1]).distance - 1 < 1e-9);
   });

   await check('the tower compiles and its finished structure stands', () => {
      const d = compile(TOWER);
      assert.deepEqual(d.errors, []);
      assert.equal(d.modules.length, 21);
      assert.deepEqual(checkStructure(d.modules, d.site.table), []);
   });

   await check('format errors name the place', () => {
      const d = variant(d => {
         d.components.wall_long.parts[0].form = 'cubo';
         d.components.window.parts[1].use = 'crown';      // used before it is defined
         d.site.arms[1].lift = 2;
         d.plan.pop();
      });
      for (const e of ["components.wall_long.parts[0].form: unknown form 'cubo'",
         "components.window.parts[1].use: 'crown' must be a component defined before 'window'",
         'site.arms[1].lift: 0..0.6 m', 'plan: no step places crown']) assert.ok(d.errors.includes(e), e);
   });

   await check('physics: floating, overlapping and tipping modules', () => {
      const floating = variant(d => { d.building.floors[0].modules[0].pos = [0, .01, .07]; });
      assert.ok(checkStructure(floating.modules, floating.site.table).some(e => e.kind === 'support' && /^f0\.n \(.*\) rests on nothing: its bottom is at 1\.0 cm and the highest surface under it is at 0\.0 cm/.test(e.text)));
      const overlap = variant(d => { d.building.floors[0].modules[1].pos = [.07, 0, .05]; });
      assert.ok(checkStructure(overlap.modules, overlap.site.table).some(e => e.kind === 'overlap'));
      const tipping = variant(d => { d.building.floors[5].modules[0].pos = [0, 0, .09]; });
      assert.ok(checkStructure(tipping.modules, tipping.site.table).some(e => e.kind === 'stability' && /crown would tip/.test(e.text)));
   });

   await check('the four arms build the tower with no failures', () => {
      const r = simulate(compile(TOWER));
      assert.deepEqual(r.failures.map(f => f.text), []);
      assert.equal(r.placed, 21);
      assert.ok(r.time < 240);
      console.log(`   built in ${r.time.toFixed(1)} s of simulated time`);
   });

   await check('the simulation reports reach, grip and clearance failures', () => {
      const wrongArm = simulate(variant(d => { d.plan.find(s => s.module === 'f0.n').arm = 2; }));
      assert.equal(kinds(wrongArm)[0], 'reach');
      assert.ok(kinds(wrongArm).includes('support')); // the walls above it fall
      const grip = simulate(variant(d => { d.plan.find(s => s.module === 'f0.n').grasp = 0; }));
      assert.match(grip.failures[0].text, /160 mm across the jaws/);
      const together = simulate(variant(d => { delete d.plan.find(s => s.step === 412).after; }));
      assert.match(together.failures[0].text, /arms 0 and 2 come within/);
   });

   await check('take-over: the player places a module by hand, then the plan finishes', () => {
      const d = compile(TOWER), arms = d.site.arms.map(a => new Arm(fakeNode(), a)), b = new Builder(d, arms);
      b.update(1 / 30);
      const arm = arms[3], step = b.steps.find(s => s.arm === 3 && s.state === 'active'), m = step.module;
      const yaw = hingeYaw(m, step.grasp), at = p => cg.add(p, gripPoint(m)), up = p => cg.add(p, [0, .03, 0]);
      const steer = (pos, seconds) => { for (let t = 0; t < seconds; t += 1 / 30) { arm.aim(pos, yaw); b.update(1 / 30, arm); } };
      arm.clear();
      steer(up(at(m.pos)), 2); steer(at(m.pos), 2);
      b.toggleGrip(arm);
      assert.equal(m.carriedBy, arm);
      steer(up(at(m.pos)), 2); steer(up(at(m.target)), 3); steer(at(m.target), 2);
      b.toggleGrip(arm);
      assert.equal(m.state, 'placed');
      b.handBack(arm);
      assert.equal(step.state, 'done');
      while (!b.done && b.time < 240) b.update(1 / 30);
      assert.equal(b.placed.length, 21);
      assert.ok(!kinds(b).some(k => ['support', 'stability', 'reach'].includes(k)), kinds(b).join());
   });

   await check('AI tools: the tower passes submit; broken drafts get measured failures', async () => {
      const draft = new Draft(), T = structuredClone(TOWER);
      assert.equal(await draft.call('check_structure', {}), 'set components and building first');
      assert.match(await draft.call('set_components', { components: T.components }), /^ok: 5 components$/);
      assert.match(await draft.call('set_building', { building: T.building }), /check_structure: ok: all 21 modules/);
      assert.match(await draft.call('set_site', { site: T.site }), /check_site: ok/);
      assert.match(await draft.call('set_plan', { plan: T.plan }), /simulate_plan: ok: placed 21\/21/);
      assert.match(await draft.call('submit', {}), /^ok: accepted/);
      assert.ok(draft.passed);
      // A floating crown, a wall too wide for the jaws, an arm moved out of reach.
      assert.match(await draft.call('patch_floor', { index: 5, floor: { height: .065, modules: [{ id: 'crown', use: 'crown', pos: [0, .02, 0] }] } }),
         /crown \(x -2\.0\.\.2\.0 z -2\.0\.\.2\.0 y 24\.0\.\.30\.5\) rests on nothing: its bottom is at 24\.0 cm and the highest surface under it is at 22\.1 cm/);
      assert.ok(!draft.passed);
      const W = structuredClone(T), fresh = new Draft();
      W.components.slab = { parts: [{ form: 'cube', pos: [0, .005, 0], scale: [.05, .005, .05], color: 'concrete' }] };
      W.building.floors.push({ height: .01, modules: [{ id: 'slab', use: 'slab', pos: [0, 0, 0] }] });
      await fresh.call('set_components', { components: W.components });
      assert.match(await fresh.call('set_building', { building: W.building }), /^ok: WARNING: no grasp fits 1 module .*slab 100x100 mm/);
      const site = { ...T.site, arms: T.site.arms.map(a => a.id === 1 ? { ...a, base: [.45, 0] } : a) };
      assert.match(await draft.call('set_site', { site }), /arm 1 cannot pick f0\.e.* from its tray: the tray is 27\.4 cm from its pan axis/);
      assert.match(await draft.call('submit', {}), /^not accepted/);
      assert.equal(await draft.call('nope', {}), 'unknown tool nope');
   });

   await check('the saved AI designs of the four presets still pass submit', async () => {
      for (let n = 1; n <= 4; n++) {
         const d = JSON.parse(require('node:fs').readFileSync(`${__dirname}/../js/scenes/construction/designs/preset-${n}.json`)), draft = new Draft();
         for (const k of ['components', 'building', 'site', 'plan']) await draft.call(`set_${k}`, { [k]: d[k] });
         assert.match(await draft.call('submit', {}), /^ok: accepted/, `preset ${n}`);
      }
   });

   console.log(`${passed} construction checks passed.`);
})().catch(e => { console.error(e); process.exit(1); });
