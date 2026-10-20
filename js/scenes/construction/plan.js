// Runs a compiled plan on the arms: each arm takes its steps in order, each
// step also waits for its `after` steps. The same runner drives the scene and
// simulate(), so what the simulation reports is what the player will see.
import * as cg from '../../render/core/cg.js';
import { Arm } from './arm.js';
import { LIMITS, MAX_JAW, corners, gripPoint, gripWidth, hingeYaw, span } from './design.js';
import { capsules, clearance, jawAngle, reach, where } from './kinematics.js';
import { placementErrors, stabilityErrors } from './physics.js';

const CLEAR = .03;          // m: approach and carry height above the higher grip point
const RETREAT = .03;        // m: up after releasing
const LIFT_SPEED = .05;     // m/s
const MIN_GAP = .01;        // m: least clearance between arms, and from arms to modules
const SNAP = .01;           // m: a manual release this close to the target places the module
const LOAD_LIMIT = .8;      // of stall torque
const PARK = [.09, .06];    // m: where a waiting arm holds its tip, out from its pan axis and above its base

export class Builder {
   constructor(design, arms) {
      this.design = design; this.arms = arms;
      this.table = design.site.table;
      this.trays = Object.fromEntries(design.site.trays.map(t => [t.arm, t]));
      this.steps = design.plan.map(s => ({ ...s, state: 'waiting' }));
      for (const m of design.modules) Object.assign(m, { state: 'waiting', pos: null, carriedBy: null });
      this.placed = []; this.failures = []; this.reported = new Set(); this.time = 0;
   }
   get done() { return this.steps.every(s => s.state === 'done' || s.state === 'failed'); }
   fail(kind, text, step, key = text) {
      if (this.reported.has(key)) return;
      this.reported.add(key);
      this.failures.push({ t: this.time, kind, text, step: step?.step, arm: step?.arm });
   }
   // The surface under a point: the highest placed module there, else the table.
   surface([x, z]) {
      let top = 0;
      for (const p of this.placed) if (inPoly(corners(p.m, p.at), [x, z])) top = Math.max(top, span(p.m, p.at)[1]);
      return top;
   }
   trayOrigin(m, arm) {
      const t = this.trays[arm.id], g = gripPoint(m);
      // The box centre over the tray, its bottom on the tray (at the lift's top).
      return [t.pos[0] - g[0], arm.lift - span(m, [0, 0, 0])[0], t.pos[1] - g[2]];
   }

   update(dt, manual = null) {
      if (manual) { manual.update(dt); this.carry(); return; } // everything else pauses
      this.time += dt;
      for (const arm of this.arms) {
         const active = this.steps.find(s => s.arm === arm.id && s.state === 'active');
         if (active) this.progress(active, arm, dt);
         else this.next(arm);
         arm.update(dt);
      }
      this.carry();
      this.monitor();
      if (this.time > LIMITS.time) this.fail('time', `construction takes longer than ${LIMITS.time / 60} minutes`);
   }
   carry() { for (const m of this.design.modules) if (m.carriedBy) m.pos = cg.add(m.carriedBy.tip, m.offset); }

   // Start the arm's next step once everything it waits for has finished.
   next(arm) {
      const s = this.steps.find(s => s.arm === arm.id && s.state === 'waiting');
      const waiting = s ? s.after.filter(a => !['done', 'failed'].includes(this.steps.find(t => t.step === a).state)) : [];
      if (!s || waiting.length) {
         // Pull back out of the others' way while waiting.
         if (!arm.queue.length && !arm.parked) { arm.go([{ pos: parkPoint(arm), label: arm.task, then: () => arm.parked = true }]); }
         arm.task = s ? `step ${s.step} waits for ${waiting.join(', ')}` : 'finished';
         return;
      }
      if (arm.queue.length) return; // finish parking first
      arm.parked = false;
      s.state = 'active';
      if (s.lift !== undefined) { arm.task = `step ${s.step}: lift to ${(s.lift * 100).toFixed(0)} cm`; return; }
      this.start(s, arm);
   }
   progress(s, arm, dt) {
      if (s.lift !== undefined) {
         arm.lift += cg.clamp(s.lift - arm.lift, -LIFT_SPEED * dt, LIFT_SPEED * dt);
         if (Math.abs(s.lift - arm.lift) < 1e-6) { arm.lift = s.lift; s.state = 'done'; }
      } else if (!arm.queue.length && s.state === 'active') {
         this.fail('reach', `step ${s.step} (${s.module.id}): arm ${arm.id} stopped, ${arm.task}`, s);
         this.abandon(s, arm);
      }
   }

   // A module step: put the module on the tray, check grip and reach, then queue the motion.
   start(s, arm, fromTip = false) {
      const m = s.module, yaw = hingeYaw(m, s.grasp), g = gripPoint(m);
      if (!fromTip) { m.pos = this.trayOrigin(m, arm); m.state = 'tray'; }
      const width = gripWidth(m, s.grasp);
      if (width > MAX_JAW) {
         this.fail('grip', `step ${s.step} (${m.id}): ${Math.round(width * 1000)} mm across the jaws > ${Math.round(MAX_JAW * 1000)} mm; change grasp or split the module`, s);
         return this.abandon(s, arm);
      }
      const pick = cg.add(m.pos, g), place = cg.add(m.target, g);
      const start = fromTip ? arm.tip : pick, high = Math.max(start[1], place[1]) + CLEAR;
      const up = (p, y = high) => [p[0], y, p[2]];
      const way = [
         ...(fromTip ? [] : [{ pos: up(pick, pick[1] + CLEAR), label: 'over the tray' }, { pos: pick, label: 'down to grip' }]),
         { pos: up(start), label: 'lift' }, { pos: up(place), label: 'carry' },
         { pos: place, label: 'place' }, { pos: up(place, place[1] + RETREAT), label: 'retreat' }];
      // Every waypoint must be reachable before the arm moves at all.
      for (const w of way) {
         const r = reach(arm.base, arm.q, w.pos, yaw);
         if (!r.ok) {
            const p = where(arm.base, w.pos), deg = v => Math.round(v * 180 / Math.PI);
            this.fail('reach', `step ${s.step} (${m.id}): arm ${arm.id} cannot reach '${w.label}': ${(p.distance * 100).toFixed(1)} cm out, ` +
               `${(p.height * 100).toFixed(1)} cm above its base (lift ${(arm.lift * 100).toFixed(0)} cm), pan ${deg(p.pan)}° ` +
               `(limit ±${deg(p.panLimit)}°); the tip misses by ${(r.position * 100).toFixed(1)} cm`, s);
            return this.abandon(s, arm);
         }
         w.q = r.q;
      }
      const label = l => `step ${s.step} ${m.id}: ${l}`, steps = way.map(w => ({ ...w, yaw, label: label(w.label) }));
      const placeAt = steps.findIndex(w => w.pos === place);
      steps.splice(placeAt + 1, 0, { grip: 'open', label: label('release'), then: () => this.release(arm) });
      if (!fromTip) steps.splice(2, 0, { grip: 'close', width: gripWidth(m, s.grasp), label: label('grip'), then: () => this.attach(arm, m) });
      steps.at(-1).then = () => { if (s.state === 'active') s.state = m.state === 'placed' ? 'done' : 'failed'; };
      arm.go(steps);
   }
   abandon(s, arm) {
      s.state = 'failed'; arm.clear();
      if (s.module) { if (arm.carrying === s.module) this.drop(arm); s.module.state = 'failed'; s.module.pos = null; }
   }
   attach(arm, m) {
      m.carriedBy = arm; arm.carrying = m; m.state = 'carried';
      // Held where the plan grips it, so the tip's IK error shows up in where it is put.
      m.offset = cg.scale(gripPoint(m), -1);
   }
   drop(arm) { const m = arm.carrying; if (m) { m.carriedBy = null; arm.carrying = null; } return m; }
   // Release: a module within SNAP of its target is placed there, and checked.
   release(arm) {
      const m = this.drop(arm);
      if (!m) return;
      const s = this.steps.find(s => s.module === m);
      if (cg.distance(m.pos, m.target) > SNAP) { m.pos = this.trayOrigin(m, arm); m.state = 'tray'; return; }
      const errors = placementErrors(m, m.target, this.placed, this.table);
      for (const e of errors) this.fail(e.kind, e.text, s);
      // Unsupported, it falls: the module is lost and the step fails.
      if (errors.some(e => e.kind === 'support')) { m.state = 'failed'; m.pos = null; return; }
      m.pos = m.target.slice(); m.state = 'placed';
      this.placed.push({ m, at: m.pos });
      for (const e of stabilityErrors(this.placed, this.table)) this.fail(e.kind, `after step ${s.step}: ${e.text}`, s, e.text);
   }

   // Clearance and load, every frame.
   monitor() {
      const caps = new Map(this.arms.map(a => [a, capsules(a.frames).slice(0, -1)])); // the jaws may touch modules
      const stepOf = arm => this.steps.find(s => s.arm === arm.id && s.state === 'active');
      for (let i = 0; i < this.arms.length; i++) for (let j = i + 1; j < this.arms.length; j++) {
         const a = this.arms[i], b = this.arms[j], c = clearance(a.frames, b.frames);
         if (c.distance < MIN_GAP) this.fail('clearance', `arms ${a.id} and ${b.id} come within ${Math.round(c.distance * 1000)} mm ` +
            `(steps ${stepOf(a)?.step ?? '-'} and ${stepOf(b)?.step ?? '-'})`, stepOf(a), `arms ${a.id}-${b.id}`);
      }
      for (const arm of this.arms) {
         const s = stepOf(arm);
         for (const p of this.placed) {
            const d = Math.min(...caps.get(arm).map(c => capsuleBox(c, p)));
            if (d < MIN_GAP) this.fail('clearance', `arm ${arm.id} comes within ${Math.round(d * 1000)} mm of ${p.m.id}` +
               (s?.module ? ` while placing ${s.module.id}` : ''), s, `arm ${arm.id}-${p.m.id}`);
         }
         const m = arm.carrying;
         if (!m) continue;
         const worst = Math.max(...arm.load().map(l => l.ratio));
         if (worst > LOAD_LIMIT) this.fail('load', `step ${s?.step} (${m.id}, ${Math.round(m.mass * 1000)} g): arm ${arm.id} at ` +
            `${Math.round(worst * 100)}% of stall torque; carry it closer or make it lighter`, s, `load ${m.id}`);
         const [b, t] = span(m, m.pos), foot = corners(m, m.pos);
         for (const p of this.placed) {
            const [pb, pt] = span(p.m, p.at);
            if (Math.min(t, pt) - Math.max(b, pb) > .003 && overlaps(foot, corners(p.m, p.at)))
               this.fail('collision', `step ${s?.step}: carried ${m.id} hits ${p.m.id}`, s, `hit ${m.id}-${p.m.id}`);
         }
      }
   }

   // Take-over. Grip takes this arm's module from around the jaws; release
   // places it if it is near its target, otherwise it goes back to the tray.
   toggleGrip(arm) {
      if (arm.carrying) { arm.gripGoal = 1.1; this.release(arm); return; }
      const s = this.steps.find(s => s.arm === arm.id && s.state === 'active' && s.module);
      const m = s?.module;
      const near = m && m.state === 'tray' && cg.distance(cg.add(m.pos, gripPoint(m)), arm.tip) < .015;
      arm.gripGoal = near ? jawAngle(gripWidth(m, s.grasp)) : 0;
      if (near) this.attach(arm, m);
   }
   // Hand back: finish the step from where the player left it.
   handBack(arm) {
      arm.clear();
      const s = this.steps.find(s => s.arm === arm.id && s.state === 'active');
      if (!s?.module) return;
      if (s.module.state === 'placed') s.state = 'done';
      else this.start(s, arm, s.module.state === 'carried');
   }
}

// Runs a design without rendering, one frame per iteration, so a caller can
// spread it over several frames. Returns failures in time order and the duration.
export function* run(design, dt = 1 / 30) {
   const arms = design.site.arms.map(a => new Arm(null, a));
   const b = new Builder(design, arms);
   while (!b.done && b.time <= LIMITS.time + 1) { b.update(dt); yield b; }
   return { failures: b.failures, time: b.time, placed: b.placed.length, total: design.modules.length };
}
export function simulate(design, dt) {
   const it = run(design, dt);
   for (;;) { const r = it.next(); if (r.done) return r.value; }
}

function parkPoint(arm) {
   const p = where(arm.base, [0, 0, 0]), axis = p.axis, out = [Math.cos(arm.yaw), 0, -Math.sin(arm.yaw)];
   return [axis[0] + out[0] * PARK[0], arm.lift + PARK[1], axis[2] + out[2] * PARK[0]];
}
const inPoly = (poly, p) => poly.every((a, i) => {
   const b = poly[(i + 1) % poly.length];
   return (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]) >= 0;
}) || poly.every((a, i) => {
   const b = poly[(i + 1) % poly.length];
   return (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]) <= 0;
});
// Separating axis test for two convex footprints.
function overlaps(a, b) {
   for (const poly of [a, b]) for (let i = 0; i < poly.length; i++) {
      const p = poly[i], q = poly[(i + 1) % poly.length], n = [q[1] - p[1], p[0] - q[0]];
      const proj = s => s.map(v => v[0] * n[0] + v[1] * n[1]);
      const pa = proj(a), pb = proj(b), eps = .003 * Math.hypot(...n); // within positioning error
      if (Math.max(...pa) <= Math.min(...pb) + eps || Math.max(...pb) <= Math.min(...pa) + eps) return false;
   }
   return true;
}
// Surface distance from a capsule to a placed module's box, sampled along the capsule.
function capsuleBox(c, p) {
   const { min, max } = p.m.box, inv = cg.mRotateY(-p.m.yaw);
   let best = Infinity;
   for (let k = 0; k <= 4; k++) {
      const q = cg.mTransform(inv, cg.subtract(cg.mix(c.a, c.b, k / 4), p.at));
      best = Math.min(best, Math.hypot(...q.map((v, i) => Math.max(min[i] - v, 0, v - max[i]))));
   }
   return best - c.radius;
}
