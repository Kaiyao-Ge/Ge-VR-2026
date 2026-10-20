// One SO101 arm in the scene: rendering, motion queue and take-over.
// Every arm, including the ghost that previews a pose, is an instance of Arm.
import * as cg from '../../render/core/cg.js';
import { stl } from '../../render/core/stl.js';
import { ESTIMATE, JOINTS, LINKS, READY, baseMatrix, forward, jawAngle, jointRest, load, reach, solve, tool } from './kinematics.js';

// Decimated copies of media/stl/SO101 (tools/decimate-stl.cjs, 1.5 mm cells).
const FOLDER = 'SO101_low/';
const requested = new Set();
const OPEN = 1.1;                 // gripper angle when open
const SPEED = .12;                // m/s along a straight segment

export class Arm {
   // site: parent node in site coordinates, or null for an arm that is only
   // simulated. options: id, position [x, z], yaw (radians), lift (m).
   constructor(site, { id, position, yaw = 0, lift = 0, ghost = false }) {
      Object.assign(this, { id, position, yaw, lift, ghost });
      this.q = READY.slice(); this.q[5] = OPEN;
      this.queue = []; this.goal = null; this.goalYaw = undefined; this.wait = 0;
      this.carrying = null; this.task = 'idle'; this.trail = []; this.reachable = true;
      this.parts = [];
      if (site) this.build(site);
      this.update(0);
   }
   build(site) {
      this.root = site.add();
      if (!this.ghost) this.column = site.add('cube').color(.22, .24, .27).dull();
      this.nodes = { base: this.root.add() };
      for (const j of JOINTS) {
         const rest = this.nodes[j.parent].add().setMatrix(jointRest(j));
         this.nodes[j.name] = j.fixed ? rest : rest.add();
      }
      for (const [link, parts] of Object.entries(LINKS)) for (const p of parts) {
         const name = FOLDER + p.stl;
         if (!requested.has(name)) { requested.add(name); stl(name); }
         const joint = JOINTS.find(j => j.link === link);
         this.parts.push({ ...p, name, node: null, parent: this.nodes[joint ? joint.name : 'base'] });
      }
   }
   get base() { return baseMatrix([this.position[0], this.lift, this.position[1]], this.yaw); }
   get tip() { return tool(this.frames).tip; }
   get jaw() { return this.q[5]; }

   // Commands. A step is { pos, yaw, grip: 'open' | 'close', then: fn, label }.
   go(steps) { this.queue.push(...steps); }
   clear() { this.queue = []; this.goal = null; }
   // Take-over: the controller sets the goal directly.
   aim(pos, yaw) { this.queue = []; this.goal = pos.slice(); this.goalYaw = yaw; }

   update(dt) {
      if (!this.ghost) this.step(dt);
      this.frames = forward(this.base, this.q);
      this.render();
      if (!this.ghost && dt > 0) {
         this.trail.push({ p: this.tip, t: 0 });
         for (const s of this.trail) s.t += dt;
         while (this.trail.length && this.trail[0].t > 3) this.trail.shift();
      }
   }
   step(dt) {
      if (!dt) return;
      const next = this.queue[0];
      if (this.wait > 0) { this.wait -= dt; return; }
      if (next) {
         if (next.label) this.task = next.label;
         if (next.grip) {
            // Close on a carried block's width, or fully; opening is immediate.
            this.gripGoal = next.grip === 'open' ? OPEN : next.width ? jawAngle(next.width) : 0;
            next.then?.(this); this.queue.shift(); this.wait = .35;
            return;
         }
         if (!this.goal) this.goal = this.tip;
         this.task = next.label || this.task;
         this.goalYaw = next.yaw;
         const d = cg.subtract(next.pos, this.goal), length = cg.norm(d), move = SPEED * dt;
         this.goal = length <= move ? next.pos.slice() : cg.add(this.goal, cg.scale(d, move / length));
      }
      if (this.gripGoal !== undefined)
         this.q[5] += cg.clamp(this.gripGoal - this.q[5], -ESTIMATE.speed * dt, ESTIMATE.speed * dt);
      if (!this.goal) return;
      // Warm-started IK, then joint motion limited to the servo speed.
      let s = solve(this.base, this.q, this.goal, this.goalYaw, 8);
      if (!s.ok) s = reach(this.base, this.q, this.goal, this.goalYaw);
      this.reachable = s.ok; this.error = s.position;
      // A real controller refuses an unreachable target instead of straining toward it.
      let settled = true;
      if (s.ok) for (let i = 0; i < 5; i++) {
         const d = s.q[i] - this.q[i], limit = ESTIMATE.speed * dt;
         if (Math.abs(d) > .01) settled = false;
         this.q[i] += cg.clamp(d, -limit, limit);
      }
      if (next && s.ok && settled && cg.distance(this.goal, next.pos) < 1e-4) { next.then?.(this); this.queue.shift(); }
      if (next && !s.ok && cg.distance(this.goal, next.pos) < 1e-4) { this.task = 'blocked: ' + (next.label || 'target'); this.queue.shift(); }
   }
   render() {
      if (!this.root) return;
      this.root.setMatrix(this.base);
      if (this.column) this.column.identity().move(this.position[0], this.lift / 2 - .001, this.position[1])
         .scale(.03, Math.max(.001, this.lift / 2), .03).opacity(this.lift > .002 ? 1 : .0001);
      JOINTS.forEach((j, i) => { if (!j.fixed) this.nodes[j.name].identity().turnZ(this.q[i]); });
      for (const p of this.parts) {
         if (p.node || !window.clay.formMesh(p.name)) continue;
         p.node = p.parent.add(p.name).move(p.xyz).turnZ(p.rpy[2]).turnY(p.rpy[1]).turnX(p.rpy[0])
            .color(this.ghost ? [.3, .9, 1] : p.color).opacity(this.hidden ? .0001 : this.ghost ? .25 : 1);
      }
   }
   // Static load with the carried block.
   load() { return load(this.frames, this.carrying?.mass || 0); }
   pose(q) { this.q = q.slice(); this.frames = forward(this.base, this.q); this.render(); }
   hide(hidden) {
      if (this.hidden === hidden) return;
      this.hidden = hidden;
      for (const p of this.parts) p.node?.opacity(hidden ? .0001 : this.ghost ? .25 : 1);
   }
}
