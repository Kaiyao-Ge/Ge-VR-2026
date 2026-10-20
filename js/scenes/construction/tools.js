// The AI's tools (doc/hw5-design.md, Tools): a draft design held on the
// client, edited in parts, and the checks the AI runs on it. Every result is
// short text with measured numbers; the tools never change the AI's design.
import { LIMITS, MAX_JAW, compile, corners, gripPoint, gripWidth, span } from './design.js';
import { baseMatrix, reachBand, where } from './kinematics.js';
import { checkStructure, inside } from './physics.js';
import { run } from './plan.js';

const CLEAR = .03;           // m: carry height above the higher grip point, as in plan.js
const ARM_RADIUS = .06;      // m: footprint of an arm's base and lift column around its position
const TRAY = .05;            // m: half-width of a tray plate
const LIFTS = Array.from({ length: Math.round(LIMITS.lift[1] * 100) + 1 }, (_, k) => k / 100);
const cm = v => (v * 100).toFixed(1);
const deg = v => Math.round(v * 180 / Math.PI);

// Which part of the draft an error is about, from its path.
const section = e => e.startsWith('components') ? 'components' : e.startsWith('site') ? 'site'
   : /^(plan|step )/.test(e) ? 'plan' : 'building';
const lines = (list, max = 20) => list.slice(0, max).join('\n') + (list.length > max ? `\n... and ${list.length - max} more` : '');

// Reach band at a height above the base; none outside the measured range.
const band = h => h > .12 || h < -.26 ? null : reachBand(h);
const within = (b, d) => b ? Math.min(d - b.inner, b.outer - d) : -Infinity;
// How an arm meets a point: horizontal distance and pan are the same at every lift.
const meet = (arm, p) => where(baseMatrix([arm.position[0], 0, arm.position[1]], arm.yaw), p);
// Margin (m) by which an arm at `lift` reaches a grip point at height y and
// the carry height above it; negative when it does not. trayH: the grip point
// above the tray, which rides at the base height.
function margin(w, y, lift, trayH = 0) {
   if (Math.abs(w.pan) > w.panLimit) return -Infinity;
   const h = y - lift;
   return Math.min(within(band(h), w.distance), within(band(Math.max(h, trayH) + CLEAR), w.distance));
}
const gripAboveBottom = m => gripPoint(m)[1] - m.box.min[1];

// Lifts at which an arm reaches a module's place pose: { lo, hi, best } or null.
function liftRange(arm, m) {
   const p = m.target.map((v, i) => v + gripPoint(m)[i]), w = meet(arm, p);
   let lo = null, hi = null, best = -Infinity;
   for (const lift of LIFTS) {
      const g = margin(w, p[1], lift, gripAboveBottom(m));
      if (g >= 0) { lo ??= lift; hi = lift; best = Math.max(best, g); }
   }
   return { w, p, range: lo === null ? null : { lo, hi, best } };
}
// Why an arm cannot reach a point at any lift, for the report.
function why(w, p) {
   if (Math.abs(w.pan) > w.panLimit) return `pan ${deg(w.pan)}° is past ±${deg(w.panLimit)}°`;
   const widest = band(0);
   if (w.distance > widest.outer) return `${cm(w.distance)} cm from its pan axis; it reaches at most ${cm(widest.outer)} cm, at its base height`;
   return `${cm(w.distance)} cm from its pan axis at ${cm(p[1])} cm high: no lift from 0 to ${cm(LIMITS.lift[1])} cm puts it in the band`;
}

export const TOOLS = [
   ['set_components', 'Define all components (replaces earlier ones).', { components: { type: 'object', description: 'name -> { params?, parts: [...] }' } }],
   ['set_building', 'Set the whole building (replaces the earlier one).', { building: { type: 'object', description: '{ name, origin, floors: [...] }' } }],
   ['patch_floor', 'Replace floor `index`, or append it when index equals the number of floors.', { index: { type: 'integer' }, floor: { type: 'object' } }],
   ['check_structure', 'Static physics of the finished building: support, overlap, tipping.', {}],
   ['set_site', 'Set the table, arms and trays.', { site: { type: 'object', description: '{ table, arms: [...], trays: [...] }' } }],
   ['reach_report', 'For each module: which arms reach its place pose and at which lift heights.', { arm: { type: 'integer', description: 'only this arm (optional)' } }],
   ['check_site', 'Arms too close to each other or to the building, trays in the way or out of reach, modules no arm reaches.', {}],
   ['set_plan', 'Set the whole build plan (replaces the earlier one).', { plan: { type: 'array', items: { type: 'object' } } }],
   ['patch_plan', 'Replace steps with the same step number, append new ones, and remove steps.', { steps: { type: 'array', items: { type: 'object' } }, remove: { type: 'array', items: { type: 'number' } } }],
   ['simulate_plan', 'Run the plan on the arms: the first 10 failures in time order, and the duration.', {}],
   ['submit', 'Run every check. Only a design that passes is built.', {}],
].map(([name, description, properties]) => ({ type: 'function', function: { name, description, parameters: { type: 'object', properties } } }));

export class Draft {
   constructor() { this.design = {}; this.compiled = compile({}); this.passed = false; this.failures = []; }
   // Compile errors of the parts that have been set.
   errors() { return this.compiled.errors.filter(e => this.design[section(e)] !== undefined); }
   // Sets one part, then runs the check that part affects, so a fix and its
   // measurement take one turn.
   async set(key, value) {
      this.design[key] = value;
      this.compiled = compile(this.design);
      const errors = this.errors();
      if (errors.length) return `${errors.length} error${errors.length > 1 ? 's' : ''}:\n${lines(errors)}`;
      const ok = `ok: ${this.summary(key)}`;
      const [name, check, parts] = key === 'site' ? ['check_site', () => this.checkSite(), ['components', 'building', 'site']]
         : key === 'plan' ? ['simulate_plan', () => this.simulate(), ['components', 'building', 'site', 'plan']]
         : ['check_structure', () => this.structure(), ['components', 'building']];
      return this.needs(...parts) ? ok : `${ok}\n${name}: ${await check()}`;
   }
   summary(key) {
      const c = this.compiled, mods = c.modules;
      if (key === 'components') return `${Object.keys(this.design.components).length} components`;
      if (key === 'building') {
         if (!mods.length) return 'no modules';
         const heavy = mods.reduce((a, b) => b.mass > a.mass ? b : a);
         // A module wider than the jaws both ways cannot be gripped with any grasp.
         const wide = mods.filter(m => Math.min(gripWidth(m, 0), gripWidth(m, Math.PI / 2)) > MAX_JAW);
         return (wide.length ? `WARNING: no grasp fits ${wide.length} module${wide.length > 1 ? 's' : ''} (narrowest side over ${Math.round(MAX_JAW * 1000)} mm): ` +
            `${wide.slice(0, 6).map(m => `${m.id} ${Math.round(gripWidth(m, 0) * 1000)}x${Math.round(gripWidth(m, Math.PI / 2) * 1000)} mm`).join(', ')}; split them. ` : '') +
            `${this.design.building.floors.length} floors, ${mods.length} modules, ${mods.reduce((n, m) => n + m.prims.length, 0)} primitives, ` +
            `top at ${cm(Math.max(...mods.map(m => span(m, m.target)[1])))} cm, mass ${Math.round(mods.reduce((s, m) => s + m.mass, 0) * 1000)} g ` +
            `(heaviest ${heavy.id} ${Math.round(heavy.mass * 1000)} g)`;
      }
      if (key === 'site') return `${c.site.arms.length} arms, ${c.site.trays.length} trays`;
      return `${c.plan.length} steps (${c.plan.filter(s => s.module).length} modules, ${c.plan.filter(s => s.lift !== undefined).length} lift moves)`;
   }
   needs(...keys) {
      const missing = keys.filter(k => !this.design[k]);
      if (missing.length) return `set ${missing.join(' and ')} first`;
      const errors = this.errors();
      return errors.length ? `fix the format errors first:\n${lines(errors, 10)}` : null;
   }

   // Runs one tool call; returns its text result.
   async call(name, args) {
      this.passed = false;
      switch (name) {
         case 'set_components': return this.set('components', args.components);
         case 'set_building': return this.set('building', args.building);
         case 'patch_floor': {
            const floors = this.design.building?.floors;
            if (!floors) return 'set_building first';
            if (!(args.index >= 0 && args.index <= floors.length)) return `index: 0..${floors.length}`;
            floors[args.index] = args.floor;
            return this.set('building', this.design.building);
         }
         case 'check_structure': return this.needs('components', 'building') ?? this.structure();
         case 'set_site': return this.set('site', args.site);
         case 'reach_report': return this.needs('components', 'building', 'site') ?? this.reachReport(args.arm);
         case 'check_site': return this.needs('components', 'building', 'site') ?? this.checkSite();
         case 'set_plan': return this.set('plan', args.plan);
         case 'patch_plan': {
            if (!this.design.plan) return 'set_plan first';
            const plan = this.design.plan.filter(s => !(args.remove ?? []).includes(s.step));
            for (const s of args.steps ?? []) { const i = plan.findIndex(t => t.step === s.step); if (i < 0) plan.push(s); else plan[i] = s; }
            return this.set('plan', plan);
         }
         case 'simulate_plan': return this.needs('components', 'building', 'site', 'plan') ?? this.simulate();
         case 'submit': {
            const blocked = this.needs('components', 'building', 'site', 'plan');
            if (blocked) return blocked;
            const structure = this.structure(), site = this.checkSite(), sim = await this.simulate();
            this.passed = [structure, site, sim].every(r => r.startsWith('ok'));
            return this.passed ? `ok: accepted. ${sim.slice(4)}` : `not accepted.\nstructure: ${structure}\nsite: ${site}\nplan: ${sim}`;
         }
         default: return `unknown tool ${name}`;
      }
   }

   structure() {
      const c = this.compiled, errors = checkStructure(c.modules, c.site.table[0] ? c.site.table : [LIMITS.width[1], LIMITS.depth[1]]);
      return errors.length ? lines(errors.map(e => e.text)) : `ok: all ${c.modules.length} modules are supported and stable`;
   }
   reachReport(only) {
      const { modules, site } = this.compiled, arms = site.arms.filter(a => only === undefined || a.id === only);
      return modules.map(m => {
         const found = arms.map(a => ({ a, ...liftRange(a, m) }));
         const ok = found.filter(f => f.range).map(f => `arm ${f.a.id} at lift ${cm(f.range.lo)}–${cm(f.range.hi)} cm (margin ${cm(f.range.best)} cm)`);
         if (ok.length) return `${m.id}: ${ok.join('; ')}`;
         return `${m.id}: NO ARM reaches it. ` + found.map(f => `arm ${f.a.id}: ${why(f.w, f.p)}`).join('; ');
      }).join('\n');
   }
   checkSite() {
      const { modules, site, plan } = this.compiled, out = [];
      const near = (m, [x, z], r) => -inside(corners(m, m.target), [x, z]) < r;
      site.arms.forEach((a, i) => site.arms.slice(i + 1).forEach(b => {
         const d = Math.hypot(a.position[0] - b.position[0], a.position[1] - b.position[1]);
         if (d < 2 * ARM_RADIUS) out.push(`arms ${a.id} and ${b.id} stand ${cm(d)} cm apart (bases need ${cm(2 * ARM_RADIUS)} cm)`);
      }));
      for (const a of site.arms) {
         const hit = modules.filter(m => near(m, a.position, ARM_RADIUS) && span(m, m.target)[0] < a.lift + .1);
         if (hit.length) out.push(`arm ${a.id} stands inside the building: its base is within ${cm(ARM_RADIUS)} cm of ${hit.slice(0, 4).map(m => m.id).join(', ')}`);
      }
      for (const t of site.trays) {
         const arm = site.arms.find(a => a.id === t.arm);
         const hit = modules.filter(m => near(m, t.pos, TRAY));
         if (hit.length) out.push(`tray of arm ${t.arm} overlaps ${hit.slice(0, 4).map(m => m.id).join(', ')}`);
         for (const b of site.arms) if (Math.hypot(b.position[0] - t.pos[0], b.position[1] - t.pos[1]) < ARM_RADIUS + TRAY)
            out.push(`tray of arm ${t.arm} overlaps the base of arm ${b.id}`);
         // The tray rides at the base height, so only the grip height above it matters.
         const own = plan.filter(s => s.module && s.arm === t.arm).map(s => s.module);
         const w = meet(arm, [t.pos[0], 0, t.pos[1]]);
         const bad = (own.length ? own : modules).filter(m => margin(w, gripAboveBottom(m), 0) < 0);
         if (bad.length) out.push(`arm ${t.arm} cannot pick ${bad.slice(0, 4).map(m => m.id).join(', ')}${bad.length > 4 ? ` and ${bad.length - 4} more` : ''} from its tray: ` +
            `the tray is ${cm(w.distance)} cm from its pan axis at pan ${deg(w.pan)}°, and the band at the tray is ` +
            `${(b => b ? `${cm(b.inner)}–${cm(b.outer)}` : 'empty')(band(gripAboveBottom(bad[0])))} cm`);
      }
      for (const a of site.arms) if (!site.trays.some(t => t.arm === a.id)) out.push(`arm ${a.id} has no tray`);
      const lost = modules.filter(m => site.arms.every(a => !liftRange(a, m).range));
      if (lost.length) out.push(`no arm reaches ${lost.slice(0, 8).map(m => m.id).join(', ')}${lost.length > 8 ? ` and ${lost.length - 8} more` : ''} at any lift`);
      return out.length ? lines(out) : 'ok: arms, trays and building are clear of each other, and every module is in some arm\'s reach';
   }
   // The plan runs on headless arms, a few milliseconds at a time so the scene keeps rendering.
   async simulate() {
      const it = run(compile(this.design));
      let r, t = performance.now();
      while (!(r = it.next()).done) if (performance.now() - t > 12) { await new Promise(res => setTimeout(res)); t = performance.now(); }
      const { failures, time, placed, total } = r.value;
      this.failures = failures;
      const head = `placed ${placed}/${total} modules in ${time.toFixed(1)} s`;
      if (!failures.length) return `ok: ${head}`;
      return `${failures.length} failure${failures.length > 1 ? 's' : ''}, ${head}:\n` +
         lines(failures.map(f => `${f.t.toFixed(1)} s, step ${f.step ?? '-'}, arm ${f.arm ?? '-'}, ${f.kind}: ${f.text}`), 10);
   }
}
