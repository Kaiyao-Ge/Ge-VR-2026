// Annotations for the selected arm: joint arcs, reach, tip, trail, plan
// preview, load, clearance and task. All geometry is in site coordinates.
import * as cg from '../../render/core/cg.js';
import { ESTIMATE, JOINTS, clearance, jawOpening, origin, reachBand, where } from './kinematics.js';

const GREEN = [.3, 1, .55], YELLOW = [1, .85, .2], RED = [1, .25, .2], CYAN = [.3, .9, 1], WHITE = [1, 1, 1];
const LIMIT_WARN = 15 * Math.PI / 180;
const ARC_RADIUS = [.05, .035, .035, .03, .025];
const H_OVER_W = 704 / 1024;   // readout canvas
const JOINT_LABELS = ['pan', 'shoulder', 'elbow', 'wrist', 'roll'];
// Growth with distance beyond `near` metres, so the panel stays legible from afar.
const zoom = (head, pos, near) => Math.min(2.5, Math.max(1, cg.distance(head, pos) / near));
const deg = r => Math.round(r * 180 / Math.PI);
export const limitColor = (q, j) => {
   const margin = Math.min(q - j.lo, j.hi - q);
   return margin <= .01 ? RED : margin < LIMIT_WARN ? YELLOW : GREEN;
};


export class Annotations {
   constructor(site, panel) {
      this.site = site; this.panel = panel;
      this.group = site.add();
      const mesh = (form, color) => this.group.add(form).color(color).dull();
      this.arcs = JOINTS.slice(0, 5).map(j => ({
         joint: j, arc: this.group.add(), needle: mesh('tubeZ', WHITE) }));
      this.marker = { ring: mesh('torusY', CYAN), stem: mesh('tubeY', CYAN) };
      this.trail = Array.from({ length: 40 }, () => mesh('tubeZ', CYAN));
      this.dots = Array.from({ length: 36 }, () => mesh('sphere', YELLOW));
      this.clear = mesh('tubeZ', GREEN);
      if (!window.clay.formMesh('selectRing')) {
         const ring = [];
         for (let k = 0; k <= 48; k++) ring.push([Math.cos(k * Math.PI / 24), 0, Math.sin(k * Math.PI / 24)]);
         window.clay.definePathsMesh('selectRing', .04, [ring]);
      }
      this.select = mesh('selectRing', CYAN);
      this.reach = { node: this.group.add(), key: null };
      this.ghostPose = null;
      this.hide();
   }
   hide() { this.group.identity().scale(0); this.visible = false; }

   // arm: selected Arm. others: the other arms. ghost: Arm used as the preview.
   show(arm, { head, up, others, ghost, takeover, goalPos, paint }) {
      UP = up;
      if (!this.visible) { this.group.identity(); this.visible = true; }
      const f = arm.frames;
      // Selection ring around the base.
      this.select.identity().move(arm.position[0], arm.lift + .003, arm.position[1]).scale(.07);

      // Joint arcs: range from lo to hi in the joint's rest frame, needle at q.
      this.arcs.forEach((a, i) => {
         const j = a.joint, rest = f[j.name + ':rest'];
         const name = 'arc_' + j.name;
         if (!a.arc.nChildren()) {
            const points = [];
            for (let k = 0; k <= 48; k++) {
               const t = j.lo + (j.hi - j.lo) * k / 48;
               points.push([Math.cos(t), Math.sin(t), 0]);
            }
            window.clay.definePathsMesh(name, .08, [points]);
            a.arc.add(name).dull();
         }
         const color = limitColor(arm.q[i], j), r = ARC_RADIUS[i], m = rest;
         a.arc.setMatrix(cg.mMultiply(m, cg.mScale(r, r, r))).color(color);
         a.arc.child(0)?.color(color);
         const o = origin(m), tipPoint = cg.mTransform(f[j.name], [r * 1.25, 0, 0]);
         line(a.needle, o, tipPoint, .0012);
         a.needle.color(color);
      });

      // Reach at the working height: the goal's during take-over, else the tip's.
      this.drawReach(arm, (takeover && goalPos || arm.tip)[1]);

      // Target marker during take-over or motion.
      const goal = goalPos || arm.goal;
      if (goal) {
         const out = !arm.reachable;
         this.marker.ring.identity().move(goal).scale(.012, .004, .012).color(out ? RED : CYAN);
         line(this.marker.stem, [goal[0], arm.lift, goal[2]], goal, .0008);
         this.marker.stem.color(out ? RED : CYAN);
      } else { this.marker.ring.identity().scale(0); this.marker.stem.identity().scale(0); }

      // Trail of the last three seconds.
      const pts = arm.trail.filter((_, i) => i % 3 === 0);
      this.trail.forEach((seg, i) => {
         const a = pts[i], b = pts[i + 1];
         if (!a || !b || cg.distance(a.p, b.p) < 1e-4) { seg.identity().scale(0); return; }
         line(seg, a.p, b.p, .0015);
         seg.opacity(Math.max(.05, 1 - b.t / 3));
      });

      // Plan preview: dots along the remaining path, ghost arm at its end.
      const path = [arm.tip, ...arm.queue.filter(s => s.pos).map(s => s.pos)];
      let budget = this.dots.length, used = 0;
      for (let k = 0; k + 1 < path.length && used < budget; k++) {
         const n = Math.max(1, Math.round(cg.distance(path[k], path[k + 1]) / .015));
         for (let s = 1; s <= n && used < budget; s++)
            this.dots[used++].identity().move(cg.mix(path[k], path[k + 1], s / n)).scale(.0025);
      }
      for (; used < budget; used++) this.dots[used].identity().scale(0);
      const end = arm.queue.filter(s => s.pos).at(-1);
      if (ghost) {
         if (end && !takeover) {
            if (this.ghostFor !== end) { this.ghostFor = end; this.ghostPose = end.q || null; }
            ghost.position = arm.position; ghost.yaw = arm.yaw; ghost.lift = arm.lift;
            if (this.ghostPose) { ghost.pose(this.ghostPose); ghost.hide(false); } else ghost.hide(true);
         } else ghost.hide(true);
      }

      // Clearance to the nearest other arm.
      let near = null;
      for (const o of others) {
         const c = clearance(f, o.frames);
         if (!near || c.distance < near.distance) near = { ...c, arm: o };
      }
      if (near) {
         const color = near.distance < .01 ? RED : near.distance < .04 ? YELLOW : GREEN;
         line(this.clear, near.a, near.b, .0008);
         this.clear.color(color);
      }

      // Text panel beside the arm as seen from the head, on the side away from
      // the site's centre, and 15 cm nearer the head than the arm so that the
      // neighbouring arms stay behind it; it keeps its apparent size from afar.
      if (paint) this.drawPanel(arm, near, takeover, goal && !arm.reachable);
      const base = [arm.position[0], arm.lift + .1, arm.position[1]], toHead = cg.normalize(cg.subtract(head, base));
      const near15 = cg.add(base, cg.scale(toHead, .15));
      const sx = .13 * zoom(head, near15, .6), sy = sx * H_OVER_W;
      const right = cg.normalize(cg.cross(UP, toHead));
      const side = Math.sign(right[0] * base[0] + right[2] * base[2]) || 1;
      billboard(this.panel.node, cg.add(near15, cg.add(cg.scale(right, side * (.07 + sx)), cg.scale(UP, sy))), head, sx, sy);
   }
   // Annulus swept by the pan joint at the working height, rounded to 1 cm.
   // The mesh is in the arm's pan frame, so it is only rebuilt when the
   // height above the base changes, not when the lift moves.
   drawReach(arm, y) {
      const height = Math.round((y - arm.lift) * 100) / 100, axis = where(arm.base, [0, 0, 0]).axis;
      this.reach.node.setMatrix(cg.mMultiply(cg.mTranslate(axis[0], arm.lift + height, axis[2]), cg.mRotateY(arm.yaw)));
      if (this.reach.key === height) return;
      this.reach.key = height;
      const r = reachBand(height), pan = JOINTS[0], paths = [];
      if (r) {
         // A positive pan angle turns the arm clockwise seen from above.
         const arc = radius => Array.from({ length: 41 }, (_, k) => {
            const t = pan.lo + (pan.hi - pan.lo) * k / 40;
            return [Math.cos(t) * radius, 0, Math.sin(t) * radius];
         });
         const outer = arc(r.outer), inner = arc(r.inner);
         paths.push(outer, inner, [inner[0], outer[0]], [inner.at(-1), outer.at(-1)]);
      }
      window.clay.definePathsMesh('reachBand', .0025, paths.length ? paths : [[[0, 0, 0], [0, 0, 0]]]);
      if (!this.reach.node.nChildren()) this.reach.node.add('reachBand').color(CYAN).dull();
   }
   drawPanel(arm, near, takeover, out) {
      const { ctx, canvas } = this.panel, W = canvas.width, H = canvas.height;
      ctx.fillStyle = '#060e16'; ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = '#4de6ff'; ctx.lineWidth = 8; ctx.strokeRect(4, 4, W - 8, H - 8);
      const text = (s, x, y, size = 44, color = '#ffffff', align = 'left') => {
         ctx.font = `bold ${size}px sans-serif`; ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = 'middle'; ctx.fillText(s, x, y);
      };
      const css = c => `rgb(${c.map(v => Math.round(v * 255))})`;
      text(`ARM ${arm.id}${takeover ? ' · MANUAL' : ''}`, 32, 56, 60, takeover ? '#ffd84d' : '#4de6ff');
      text(`lift ${(arm.lift * 100).toFixed(1)} cm`, W - 32, 56, 40, '#b8c8d8', 'right');
      // Joint angles in degrees, coloured like their arcs.
      JOINTS.slice(0, 5).forEach((j, i) => {
         const x = 32 + 98 + i * 196;
         text(JOINT_LABELS[i], x, 122, 32, '#b8c8d8', 'center');
         text(`${deg(arm.q[i])}°`, x, 170, 54, css(limitColor(arm.q[i], j)), 'center');
      });
      const tip = arm.tip.map(v => (v * 100).toFixed(1));
      text(`tip ${tip.join(', ')} cm   jaw ${Math.round(jawOpening(arm.jaw) * 1000)} mm*`, 32, 236);
      const mass = arm.carrying ? `${Math.round(arm.carrying.mass * 1000)} g ${arm.carrying.id}` : 'nothing';
      if (out) text(`OUT OF REACH +${(arm.error * 100).toFixed(1)} cm`, 32, 292, 44, '#ff5544');
      else text(`carrying ${mass}`, 32, 292);
      // Load bars: share of the estimated stall torque, mark at 80%.
      arm.load().forEach((l, i) => {
         const y = 356 + i * 58;
         text(['shoulder', 'elbow', 'wrist'][i], 32, y, 40, '#b8c8d8');
         ctx.fillStyle = '#24384a'; ctx.fillRect(230, y - 20, 380, 40);
         ctx.fillStyle = l.ratio > .8 ? '#ff4433' : l.ratio > .5 ? '#ffd84d' : '#4dff8c';
         ctx.fillRect(230, y - 20, Math.min(380, 380 * l.ratio), 40);
         ctx.fillStyle = '#ffffff'; ctx.fillRect(230 + 380 * .8, y - 26, 5, 52);
         text(`${Math.round(l.ratio * 100)}%  ${Math.abs(l.torque).toFixed(2)} N·m`, 632, y, 40);
      });
      text(`clearance ${near ? Math.round(near.distance * 1000) + ' mm to arm ' + near.arm.id : '—'}`, 32, 540, 44,
         near && near.distance < .01 ? '#ff5544' : '#ffffff');
      text(`${arm.task}`, 32, 600, 44, '#ffd84d');
      text(`* estimates: stall ${ESTIMATE.stallTorque.toFixed(2)} N·m, servo ${ESTIMATE.servo * 1000} g`, 32, 664, 30, '#9fb3c8');
      this.panel.dirty = true;
   }
}

// Facing the head, upright along the world's up direction in site coordinates.
let UP = [0, 1, 0];
export function billboard(node, pos, head, sx, sy) {
   const z = cg.normalize(cg.subtract(head, pos)), x = cg.normalize(cg.cross(UP, z)), y = cg.cross(z, x);
   node.setMatrix([x[0] * sx, x[1] * sx, x[2] * sx, 0, y[0] * sy, y[1] * sy, y[2] * sy, 0, ...z, 0, ...pos, 1]);
}
export function line(node, a, b, width) {
   node.identity().move(cg.mix(a, b, .5)).aimZ(cg.subtract(a, b)).scale(width, width, Math.max(.0005, cg.distance(a, b) / 2));
}
