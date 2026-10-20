// The design format (components, building, site, plan): validation and
// expansion into modules made of Clay primitives. No rendering, so the same
// code runs in the browser, in tests, and behind the AI's tools.
// Format: doc/hw5-design.md. Metres; origin at the table top centre; +y up.
import * as cg from '../../render/core/cg.js';
import { jawOpening } from './kinematics.js';

export const FORMS = ['cube', 'sphere', 'octahedron', 'coneX', 'coneY', 'coneZ', 'pyramidX', 'pyramidY',
   'pyramidZ', 'torusX', 'torusY', 'torusZ', 'tubeX', 'tubeY', 'tubeZ', 'diskX', 'diskY', 'diskZ'];
export const PALETTE = {
   concrete: [.62, .62, .6], glass: [.45, .75, .95], steel: [.55, .58, .62], accent: [.9, .35, .2],
   green: [.35, .7, .3], light: [.95, .92, .85], dark: [.18, .2, .22], gold: [.95, .75, .25],
};
export const LIMITS = {
   width: [.8, 2], depth: [.6, 1.5], arms: [1, 6], lift: [0, .6], height: 1,
   modules: 120, primitives: 800, components: 16, time: 240,
};
export const DENSITY = 400;               // kg/m³, hollow print (estimate)
export const MAX_JAW = jawOpening(1.1);   // widest grip, m (estimate from jaw length)
// Volume of each form as a fraction of its bounding box (8 × half-extents).
const FILL = { cube: 1, sphere: Math.PI / 6, octahedron: 1 / 6, cone: Math.PI / 12, pyramid: 1 / 3, torus: .3, tube: Math.PI / 4, disk: 0 };
const RAD = Math.PI / 180;

const isNum = v => typeof v === 'number' && isFinite(v);
const isVec = (v, n) => Array.isArray(v) && v.length === n && v.every(isNum);
// Rotation by degrees about X, then Y, then Z.
const rotation = r => cg.mMultiply(cg.mRotateZ(r[2] * RAD), cg.mMultiply(cg.mRotateY(r[1] * RAD), cg.mRotateX(r[0] * RAD)));
const det3 = m => m[0] * (m[5] * m[10] - m[6] * m[9]) - m[4] * (m[1] * m[10] - m[2] * m[9]) + m[8] * (m[1] * m[6] - m[2] * m[5]);
// Replace "$name" strings with parameter values, anywhere inside v.
const substitute = (v, params) => typeof v === 'string' && v[0] === '$' ? params[v.slice(1)]
   : Array.isArray(v) ? v.map(x => substitute(x, params))
   : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, substitute(x, params)])) : v;

// Returns { errors, modules, site, plan, name }. Errors are short strings
// with a path, e.g. "components.wall.parts[1].form: unknown form 'cubo'".
export function compile(design) {
   const errors = [], err = s => { if (errors.length < 30 && !errors.includes(s)) errors.push(s); };
   const { components = {}, building, site, plan } = design || {};
   const names = Object.keys(components);
   if (names.length > LIMITS.components) err(`components: ${names.length} > ${LIMITS.components}`);

   // Expand a component into primitives, each with its matrix in the
   // component's frame. A component may only use components defined before it.
   function expand(name, args, matrix, out) {
      const c = components[name], params = { ...c.params, ...args };
      (Array.isArray(c.parts) ? c.parts : []).forEach((raw, i) => {
         const p = substitute(raw, params), at = `components.${name}.parts[${i}]`;
         const pos = p.pos ?? [0, 0, 0], rot = p.rot ?? [0, 0, 0];
         if (!isVec(pos, 3) || !isVec(rot, 3)) return err(`${at}: pos and rot must be 3 numbers`);
         const m = cg.mMultiply(matrix, cg.mMultiply(cg.mTranslate(pos), rotation(rot)));
         if (p.use !== undefined) {
            if (names.indexOf(p.use) < 0 || names.indexOf(p.use) >= names.indexOf(name))
               return err(`${at}.use: '${p.use}' must be a component defined before '${name}'`);
            return expand(p.use, p.args, m, out);
         }
         if (!FORMS.includes(p.form)) return err(`${at}.form: unknown form '${p.form}'`);
         if (!isVec(p.scale, 3) || p.scale.some(s => s < 0 || s > .5)) return err(`${at}.scale: 3 numbers in 0..0.5`);
         const color = PALETTE[p.color] || (isVec(p.color, 3) ? p.color : null);
         if (!color) return err(`${at}.color: a palette name (${Object.keys(PALETTE).join(', ')}) or [r,g,b]`);
         out.push({ form: p.form, color, matrix: cg.mMultiply(m, cg.mScale(p.scale)) });
      });
      return out;
   }
   // Every component is checked once with its default parameters, used or not.
   for (const name of names) if (!Array.isArray(components[name]?.parts)) err(`components.${name}.parts: expected a list`);
      else expand(name, {}, cg.mIdentity(), []);

   // Building: floors stack; modules sit relative to the floor centre.
   const modules = [], ids = new Set();
   if (!building || !Array.isArray(building.floors)) err('building.floors: expected a list');
   else {
      const origin = building.origin ?? [0, 0];
      if (!isVec(origin, 2)) err('building.origin: expected [x, z]');
      let base = 0;
      building.floors.forEach((f, fi) => {
         const at = `building.floors[${fi}]`;
         if (!isNum(f.height) || f.height <= 0) err(`${at}.height: a positive number`);
         (Array.isArray(f.modules) ? f.modules : []).forEach((raw, mi) => {
            const id = raw.id ?? `${at}.modules[${mi}]`;
            if (typeof raw.id !== 'string' || ids.has(raw.id)) return err(`${id}: needs a unique string id`);
            ids.add(raw.id);
            if (!components[raw.use]) return err(`${id}.use: unknown component '${raw.use}'`);
            if (!isVec(raw.pos, 3)) return err(`${id}.pos: expected 3 numbers`);
            const yaw = ((f.turn ?? 0) + (raw.turn ?? 0)) * RAD;
            const local = expand(raw.use, raw.args, cg.mIdentity(), []);
            if (!local.length) return err(`${id}: no primitives`);
            modules.push(module(raw.id, fi, yaw, local,
               cg.add([origin[0], base, origin[1]], cg.mTransform(cg.mRotateY((f.turn ?? 0) * RAD), raw.pos))));
         });
         base += isNum(f.height) ? f.height : 0;
      });
   }
   const primitives = modules.reduce((n, m) => n + m.prims.length, 0);
   if (modules.length > LIMITS.modules) err(`building: ${modules.length} modules > ${LIMITS.modules}`);
   if (primitives > LIMITS.primitives) err(`building: ${primitives} primitives > ${LIMITS.primitives}`);

   // Site: table, arms and their supply trays.
   const arms = [], trays = {};
   const [tw, td] = isVec(site?.table, 2) ? site.table : [0, 0];
   if (!(tw >= LIMITS.width[0] && tw <= LIMITS.width[1] && td >= LIMITS.depth[0] && td <= LIMITS.depth[1]))
      err(`site.table: [width ${LIMITS.width.join('..')}, depth ${LIMITS.depth.join('..')}]`);
   const onTable = ([x, z], margin = 0) => Math.abs(x) <= tw / 2 - margin && Math.abs(z) <= td / 2 - margin;
   (Array.isArray(site?.arms) ? site.arms : []).forEach((a, i) => {
      const at = `site.arms[${i}]`;
      if (!isNum(a.id) || arms.some(b => b.id === a.id)) return err(`${at}.id: a unique number`);
      if (!isVec(a.base, 2) || !onTable(a.base, .03)) return err(`${at}.base: [x, z] on the table`);
      const lift = a.lift ?? 0;
      if (!isNum(lift) || lift < LIMITS.lift[0] || lift > LIMITS.lift[1]) return err(`${at}.lift: ${LIMITS.lift.join('..')} m`);
      arms.push({ id: a.id, position: a.base, yaw: (a.yaw ?? 0) * RAD, lift });
   });
   if (arms.length < LIMITS.arms[0] || arms.length > LIMITS.arms[1]) err(`site.arms: ${LIMITS.arms.join('..')} arms`);
   (Array.isArray(site?.trays) ? site.trays : []).forEach((t, i) => {
      if (!arms.some(a => a.id === t.arm)) return err(`site.trays[${i}].arm: unknown arm ${t.arm}`);
      if (!isVec(t.pos, 2) || !onTable(t.pos, .03)) return err(`site.trays[${i}].pos: [x, z] on the table`);
      trays[t.arm] = { arm: t.arm, pos: t.pos };
   });

   // Building limits, now that the table is known.
   for (const m of modules) {
      if (tw && corners(m, m.target).some(c => !onTable(c))) err(`${m.id}: outside the table`);
      if (m.target[1] + m.box.max[1] > LIMITS.height) err(`${m.id}: above ${LIMITS.height} m`);
   }

   // Plan: one step per module, plus lift moves.
   const steps = [], placedBy = {};
   (Array.isArray(plan) ? plan : []).forEach((s, i) => {
      const at = `plan[${i}]`;
      if (!isNum(s.step) || steps.some(t => t.step === s.step)) return err(`${at}.step: a unique number`);
      if (!arms.some(a => a.id === s.arm)) return err(`${at}.arm: unknown arm ${s.arm}`);
      const after = s.after ?? [];
      if (!Array.isArray(after)) return err(`${at}.after: a list of step numbers`);
      if (s.lift !== undefined) {
         if (!isNum(s.lift) || s.lift < LIMITS.lift[0] || s.lift > LIMITS.lift[1]) return err(`${at}.lift: ${LIMITS.lift.join('..')} m`);
         return steps.push({ step: s.step, arm: s.arm, lift: s.lift, after });
      }
      const m = modules.find(m => m.id === s.module);
      if (!m) return err(`${at}.module: unknown module '${s.module}'`);
      if (placedBy[m.id]) return err(`${at}: ${m.id} is already placed by step ${placedBy[m.id]}`);
      if (!trays[s.arm]) return err(`${at}: arm ${s.arm} has no tray`);
      placedBy[m.id] = s.step;
      steps.push({ step: s.step, arm: s.arm, module: m, grasp: (s.grasp ?? 0) * RAD, after });
   });
   for (const s of steps) for (const a of s.after)
      if (!steps.some(t => t.step === a)) err(`step ${s.step}.after: unknown step ${a}`);
   for (const m of modules) if (!placedBy[m.id]) err(`plan: no step places ${m.id}`);

   return { errors, name: building?.name || 'UNTITLED', modules, plan: steps,
      site: { table: [tw, td], arms, trays: Object.values(trays) } };
}

// A module: primitives relative to its origin (already turned by yaw), the
// unturned bounding box, mass and centre of mass. target: where it belongs.
function module(id, floor, yaw, local, target) {
   const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
   let mass = 0, com = [0, 0, 0];
   for (const p of local) {
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
         const c = cg.mTransform(p.matrix, [sx, sy, sz]);
         for (let i = 0; i < 3; i++) { min[i] = Math.min(min[i], c[i]); max[i] = Math.max(max[i], c[i]); }
      }
      const m = 8 * Math.abs(det3(p.matrix)) * FILL[p.form.replace(/[XYZ]$/, '')] * DENSITY;
      mass += m; com = cg.add(com, cg.scale(p.matrix.slice(12, 15), m));
   }
   const turn = cg.mRotateY(yaw);
   return {
      id, floor, yaw, target, mass, box: { min, max },
      com: cg.mTransform(turn, mass ? cg.scale(com, 1 / mass) : cg.mix(min, max, .5)),
      prims: local.map(p => ({ ...p, matrix: cg.mMultiply(turn, p.matrix) })),
   };
}

// Footprint corners [x, z] of a module whose origin is at `at`, counter-clockwise.
export function corners(m, at) {
   const { min, max } = m.box, c = Math.cos(m.yaw), s = Math.sin(m.yaw);
   return [[min[0], min[2]], [min[0], max[2]], [max[0], max[2]], [max[0], min[2]]]
      .map(([x, z]) => [at[0] + c * x + s * z, at[2] - s * x + c * z]);
}
// Bottom and top heights of a module at `at`.
export const span = (m, at) => [at[1] + m.box.min[1], at[1] + m.box.max[1]];
// Where the jaws hold a module, relative to its origin: the box's top, up to 15 mm deep.
export function gripPoint(m) {
   const { min, max } = m.box, depth = Math.min(.015, (max[1] - min[1]) / 2);
   return cg.mTransform(cg.mRotateY(m.yaw), [(min[0] + max[0]) / 2, max[1] - depth, (min[2] + max[2]) / 2]);
}
// Width between the jaws when they close along the module's local direction `grasp` (radians).
export const gripWidth = (m, grasp) =>
   Math.abs(Math.cos(grasp)) * (m.box.max[0] - m.box.min[0]) + Math.abs(Math.sin(grasp)) * (m.box.max[2] - m.box.min[2]);
// Hinge yaw for the IK: the hinge is perpendicular to the closing direction.
export const hingeYaw = (m, grasp) => m.yaw + grasp + Math.PI / 2;
