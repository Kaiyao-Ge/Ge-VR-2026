// SO101 kinematics, inverse kinematics and static load, without rendering.
// Link and joint tables are copied from js/scenes/SO101.js (URDF values, metres
// and radians, z up). Every revolute joint turns about its own z axis.
import * as cg from '../../render/core/cg.js';

const printed = [1, .82, .12], motor = [.1, .1, .1];
export const LINKS = {
   base_link: [
      { stl: 'base_motor_holder_so101_v1', xyz: [-0.00636471, -0.0000994414, -0.0024], rpy: [1.5708, 0, 1.5708], color: printed },
      { stl: 'base_so101_v2', xyz: [-0.00636471, 0, -0.0024], rpy: [1.5708, 0, 1.5708], color: printed },
      { stl: 'sts3215_03a_v1', xyz: [0.0263353, 0, 0.0437], rpy: [0, 0, 0], color: motor },
      { stl: 'waveshare_mounting_plate_so101_v2', xyz: [-0.0309827, -0.000199441, 0.0474], rpy: [1.5708, 0, 1.5708], color: printed },
   ],
   shoulder_link: [
      { stl: 'sts3215_03a_v1', xyz: [-0.0303992, 0.000422241, -0.0417], rpy: [1.5708, 1.5708, 0], color: motor },
      { stl: 'motor_holder_so101_base_v1', xyz: [-0.0675992, -0.000177759, 0.0158499], rpy: [1.5708, -1.5708, 0], color: printed },
      { stl: 'rotation_pitch_so101_v1', xyz: [0.0122008, 0.0000222413, 0.0464], rpy: [-1.5708, 0, 0], color: printed },
   ],
   upper_arm_link: [
      { stl: 'sts3215_03a_v1', xyz: [-0.11257, -0.0155, 0.0187], rpy: [-3.14159, 0, -1.5708], color: motor },
      { stl: 'upper_arm_s0101_v1', xyz: [-0.065085, 0.012, 0.0182], rpy: [3.14159, 0, 0], color: printed },
   ],
   lower_arm_link: [
      { stl: 'under_arm_so101_v1', xyz: [-0.0648499, -0.032, 0.0182], rpy: [3.14159, 0, 0], color: printed },
      { stl: 'motor_holder_so101_wrist_v1', xyz: [-0.0648499, -0.032, 0.018], rpy: [-3.14159, 0, 0], color: printed },
      { stl: 'sts3215_03a_v1', xyz: [-0.1224, 0.0052, 0.0187], rpy: [-3.14159, 0, -3.14159], color: motor },
   ],
   wrist_link: [
      { stl: 'sts3215_03a_no_horn_v1', xyz: [0, -0.0424, 0.0306], rpy: [1.5708, 1.5708, 0], color: motor },
      { stl: 'wrist_roll_pitch_so101_v2', xyz: [0, -0.028, 0.0181], rpy: [-1.5708, -1.5708, 0], color: printed },
   ],
   gripper_link: [
      { stl: 'sts3215_03a_v1', xyz: [0.0077, 0.0001, -0.0234], rpy: [-1.5708, 0, 0], color: motor },
      { stl: 'wrist_roll_follower_so101_v1', xyz: [0, -0.000218214, 0.000949706], rpy: [-3.14159, 0, 0], color: printed },
   ],
   gripper_frame_link: [],
   moving_jaw_so101_v1_link: [
      { stl: 'moving_jaw_so101_v1', xyz: [0, 0, 0.0189], rpy: [0, 0, 0], color: printed },
   ],
};

export const JOINTS = [
   { name: 'shoulder_pan', parent: 'base', xyz: [0.0388353, 0, 0.0624], rpy: [3.14159, 0, -3.14159], lo: -1.91986, hi: 1.91986, link: 'shoulder_link' },
   { name: 'shoulder_lift', parent: 'shoulder_pan', xyz: [-0.0303992, -0.0182778, -0.0542], rpy: [-1.5708, -1.5708, 0], lo: -1.74533, hi: 1.74533, link: 'upper_arm_link' },
   { name: 'elbow_flex', parent: 'shoulder_lift', xyz: [-0.11257, -0.028, 0], rpy: [0, 0, 1.5708], lo: -1.69, hi: 1.69, link: 'lower_arm_link' },
   { name: 'wrist_flex', parent: 'elbow_flex', xyz: [-0.1349, 0.0052, 0], rpy: [0, 0, -1.5708], lo: -1.65806, hi: 1.65806, link: 'wrist_link' },
   { name: 'wrist_roll', parent: 'wrist_flex', xyz: [0, -0.0611, 0.0181], rpy: [1.5708, 0.0486795, 3.14159], lo: -2.74385, hi: 2.84121, link: 'gripper_link' },
   { name: 'gripper', parent: 'wrist_roll', xyz: [0.0202, 0.0188, -0.0234], rpy: [1.5708, 0, 0], lo: -0.174533, hi: 1.74533, link: 'moving_jaw_so101_v1_link' },
   { name: 'gripper_frame', parent: 'wrist_roll', xyz: [-0.0079, -0.000218121, -0.0981274], rpy: [0, 3.14159, 0], fixed: true, link: 'gripper_frame_link' },
];
export const ARM_JOINTS = 5;            // pan, lift, elbow, wrist flex, wrist roll
export const PITCH = [1, 2, 3];         // joints that hold the arm up against gravity

// Physical estimates, shown as estimates in the annotations.
export const ESTIMATE = {
   servo: .055,                          // kg per STS3215 (estimate)
   links: { upper_arm_link: .030, lower_arm_link: .040, wrist_link: .025, gripper_link: .020, moving_jaw_so101_v1_link: .012 },
   stallTorque: 19.5 * .0980665,         // N·m: 19.5 kg·cm, STS3215 7.4 V datasheet value (to verify)
   jawLength: .07,                       // m from hinge to jaw tip (estimate)
   speed: 2,                             // rad/s per joint (estimate)
};
const G = 9.81;

// Joint frame relative to its parent before the joint turns, as in Clay:
// move(xyz).turnZ(yaw).turnY(pitch).turnX(roll).
export const jointRest = j => cg.mMultiply(cg.mTranslate(j.xyz),
   cg.mMultiply(cg.mRotateZ(j.rpy[2]), cg.mMultiply(cg.mRotateY(j.rpy[1]), cg.mRotateX(j.rpy[0]))));
const REST = JOINTS.map(jointRest);

// World matrices of every joint for angles q (length 6; q[5] is the gripper).
// base is the matrix of the URDF base frame in site coordinates.
export function forward(base, q) {
   const frames = { base };
   JOINTS.forEach((j, i) => {
      const m = cg.mMultiply(frames[j.parent], REST[i]);
      frames[j.name + ':rest'] = m;
      frames[j.name] = j.fixed ? m : cg.mMultiply(m, cg.mRotateZ(q[i] || 0));
   });
   return frames;
}
export const origin = m => m.slice(12, 15);
export const zAxis = m => m.slice(8, 11);

// Gripper pose summary: tip position, approach direction (from the wrist roll
// joint toward the tip) and the jaw hinge axis.
export function tool(frames) {
   const tip = origin(frames.gripper_frame), roll = frames.wrist_roll;
   let approach = zAxis(roll);
   if (cg.dot(cg.subtract(tip, origin(roll)), approach) < 0) approach = cg.scale(approach, -1);
   return { tip, approach, hinge: zAxis(frames.gripper) };
}

// Base frame of an arm standing at [x, height, z] on the site, facing yaw (radians about +y).
export const baseMatrix = (position, yaw) =>
   cg.mMultiply(cg.mTranslate(position), cg.mMultiply(cg.mRotateY(yaw), cg.mRotateX(-Math.PI / 2)));

const DOWN = [0, -1, 0];
const clampJoint = (q, i) => Math.max(JOINTS[i].lo, Math.min(JOINTS[i].hi, q));

// Residual for a top-down grasp: tip at target, approach straight down, and
// (when yaw is given) the hinge axis along the horizontal direction yaw.
function residual(base, q, target, yaw) {
   const t = tool(forward(base, q));
   const r = [...cg.subtract(t.tip, target), ...cg.scale(cg.subtract(t.approach, DOWN), .05)];
   if (yaw !== undefined) {
      const want = [Math.cos(yaw), 0, -Math.sin(yaw)];
      const sign = cg.dot(t.hinge, want) < 0 ? -1 : 1;
      r.push(...cg.scale(cg.subtract(t.hinge, cg.scale(want, sign)), .02));
   }
   return { r, t };
}

// Damped least squares from the start angles. Returns the closest pose found,
// its position error in metres, approach error in radians, and reachability.
export function solve(base, start, target, yaw, iterations = 40) {
   const q = start.slice();
   let { r, t } = residual(base, q, target, yaw);
   for (let k = 0; k < iterations; k++) {
      const error = Math.hypot(...r);
      if (error < 1e-4) break;
      const J = [];
      for (let i = 0; i < ARM_JOINTS; i++) {
         const dq = q.slice(); dq[i] += 1e-4;
         J.push(residual(base, dq, target, yaw).r.map((v, n) => (v - r[n]) / 1e-4));
      }
      // (JᵀJ + λ²I) Δq = -Jᵀr, a 5×5 system.
      const A = J.map(a => J.map(b => a.reduce((s, v, n) => s + v * b[n], 0)));
      const b = J.map(a => -a.reduce((s, v, n) => s + v * r[n], 0));
      A.forEach((row, i) => row[i] += 1e-4 + error * error);
      const dq = gauss(A, b);
      const step = Math.max(...dq.map(Math.abs)) > .3 ? .3 / Math.max(...dq.map(Math.abs)) : 1;
      const next = q.map((v, i) => i < ARM_JOINTS ? clampJoint(v + dq[i] * step, i) : v);
      const trial = residual(base, next, target, yaw);
      if (Math.hypot(...trial.r) > error) break;
      q.splice(0, q.length, ...next); ({ r, t } = trial);
   }
   const position = cg.distance(t.tip, target), angle = Math.acos(Math.min(1, -t.approach[1]));
   return { q, position, angle, ok: position < .002 && angle < .09 };
}
function gauss(A, b) {
   const n = b.length, M = A.map((row, i) => [...row, b[i]]);
   for (let c = 0; c < n; c++) {
      let p = c;
      for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
      [M[c], M[p]] = [M[p], M[c]];
      for (let r = c + 1; r < n; r++) {
         const f = M[r][c] / M[c][c];
         for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
      }
   }
   const x = new Array(n).fill(0);
   for (let r = n - 1; r >= 0; r--) x[r] = (M[r][n] - M[r].slice(r + 1, n).reduce((s, v, k) => s + v * x[r + 1 + k], 0)) / M[r][r];
   return x;
}

// A pose that reaches the table in front of the arm; IK starts here when cold.
export const READY = [0, -.6, .9, 1.1, 0, .2];
// Cold starts: near reach, mid reach, far reach, all with the pan aimed at the target.
const SEEDS = [READY, [0, -1.2, 1.3, 1.5, 0, .2], [0, .4, -.2, 1.4, 0, .2], [0, -.2, .2, 1.5, 0, .2]];
const panRest = base => cg.mMultiply(base, REST[0]);
// At q = 0 the arm points along -x of the pan joint's rest frame.
export function panToward(base, target) {
   const p = cg.mTransform(cg.mInverse(panRest(base)), target);
   const q = Math.atan2(p[1], p[0]) - Math.PI;
   return q < -Math.PI ? q + 2 * Math.PI : q;
}
// Where a target lies for an arm: horizontal distance from the pan axis,
// height above the base, and the pan angle needed, all for failure messages.
export function where(base, target) {
   const axis = cg.mTransform(panRest(base), [0, 0, 0]);
   return { axis, distance: Math.hypot(target[0] - axis[0], target[2] - axis[2]), height: target[1] - base[13],
      pan: panToward(base, target), panLimit: JOINTS[0].hi };
}
const cost = s => s.position + s.angle * .05;

// Solve from the current pose, then from the cold starts; keep the best answer.
export function reach(base, current, target, yaw) {
   let best = solve(base, current, target, yaw);
   const pan = clampJoint(panToward(base, target), 0);
   for (const seed of SEEDS) {
      if (best.ok) break;
      const s = solve(base, [pan, ...seed.slice(1, 4), current[4], current[5]], target, yaw);
      if (cost(s) < cost(best)) best = s;
   }
   return best;
}

// Reach band of a top-down grasp at a height relative to the arm's base:
// horizontal distances { inner, outer } from the pan axis, or null. It is the
// same for every arm, lift and yaw, so it is cached per centimetre of height.
const bands = new Map(), BAND_BASE = baseMatrix([0, 0, 0], 0); // faces +x
export function reachBand(height) {
   const key = Math.round(height * 100);
   if (!bands.has(key)) bands.set(key, findBand(key / 100));
   return bands.get(key);
}
// Computes one missing band from 24 cm below the base to 12 cm above it per
// call; the scene calls it once a frame so selecting an arm never waits.
export function warmReachBands() {
   for (let key = -24; key <= 12; key++) if (!bands.has(key)) { bands.set(key, findBand(key / 100)); return; }
}
function findBand(y) {
   const axis = origin(forward(BAND_BASE, [0, 0, 0, 0, 0, 0]).shoulder_pan);
   let q = READY; // warm start from the last pose found, as an arm moving outward would
   const ok = r => { const s = reach(BAND_BASE, q, [axis[0] + r, y, axis[2]]); if (s.ok) q = s.q; return s.ok; };
   let start = null;
   for (let r = .06; r <= .32 && start === null; r += .02) if (ok(r)) start = r;
   if (start === null) return null;
   // Bisect each edge to about 5 mm.
   const edge = (inside, outside) => {
      for (let k = 0; k < 6; k++) { const m = (inside + outside) / 2; if (ok(m)) inside = m; else outside = m; }
      return inside;
   };
   return { inner: edge(start, .02), outer: edge(start, .5) };
}
// Static gravity torque on each pitch joint (N·m) with a payload at the tip.
export function load(frames, payload = 0) {
   const masses = [];
   for (const [name, parts] of Object.entries(LINKS)) {
      const joint = JOINTS.find(j => j.link === name);
      if (!joint) continue;
      const frame = frames[joint.name];
      for (const p of parts) if (p.stl.startsWith('sts3215')) masses.push({ joint: joint.name, m: ESTIMATE.servo, p: cg.mTransform(frame, p.xyz) });
      if (ESTIMATE.links[name]) {
         const next = JOINTS.find(j => j.parent === joint.name && !j.fixed);
         const end = next ? origin(frames[next.name]) : origin(frames.gripper_frame);
         masses.push({ joint: joint.name, m: ESTIMATE.links[name], p: cg.mix(origin(frame), end, .5) });
      }
   }
   masses.push({ joint: 'gripper_frame', m: payload, p: origin(frames.gripper_frame) });
   const order = JOINTS.map(j => j.name);
   return PITCH.map(i => {
      const j = JOINTS[i], o = origin(frames[j.name]), axis = zAxis(frames[j.name]);
      // Every mass carried by this joint: on its own link or any link after it.
      const torque = masses.filter(m => order.indexOf(m.joint) >= i)
         .reduce((s, m) => s + cg.dot(axis, cg.cross(cg.subtract(m.p, o), [0, -m.m * G, 0])), 0);
      return { joint: j.name, torque, ratio: Math.abs(torque) / ESTIMATE.stallTorque };
   });
}

// Capsules along the arm (joint origin to joint origin), for clearance checks.
export function capsules(frames) {
   const points = ['shoulder_pan', 'shoulder_lift', 'elbow_flex', 'wrist_flex', 'wrist_roll', 'gripper_frame']
      .map(n => origin(frames[n]));
   return points.slice(1).map((b, i) => ({ a: points[i], b, radius: .03 })); // servo bodies are about 45 × 35 mm
}
// Closest distance between two segments, and the closest points.
export function segmentDistance(p1, q1, p2, q2) {
   const d1 = cg.subtract(q1, p1), d2 = cg.subtract(q2, p2), r = cg.subtract(p1, p2);
   const a = cg.dot(d1, d1), e = cg.dot(d2, d2), f = cg.dot(d2, r);
   let s, t;
   if (a < 1e-12 && e < 1e-12) { s = t = 0; }
   else if (a < 1e-12) { s = 0; t = cg.clamp(f / e, 0, 1); }
   else {
      const c = cg.dot(d1, r);
      if (e < 1e-12) { t = 0; s = cg.clamp(-c / a, 0, 1); }
      else {
         const b = cg.dot(d1, d2), denom = a * e - b * b;
         s = denom > 1e-12 ? cg.clamp((b * f - c * e) / denom, 0, 1) : 0;
         t = (b * s + f) / e;
         if (t < 0) { t = 0; s = cg.clamp(-c / a, 0, 1); }
         else if (t > 1) { t = 1; s = cg.clamp((b - c) / a, 0, 1); }
      }
   }
   const a1 = cg.add(p1, cg.scale(d1, s)), a2 = cg.add(p2, cg.scale(d2, t));
   return { distance: cg.distance(a1, a2), a: a1, b: a2 };
}
// Clearance between two arms: surface distance between their closest capsules.
export function clearance(framesA, framesB) {
   let best = { distance: Infinity };
   for (const x of capsules(framesA)) for (const y of capsules(framesB)) {
      const d = segmentDistance(x.a, x.b, y.a, y.b);
      if (d.distance - x.radius - y.radius < best.distance) best = { ...d, distance: d.distance - x.radius - y.radius };
   }
   return best;
}
// Jaw opening in metres for a gripper angle (estimate from jaw length).
export const jawOpening = angle => Math.max(0, ESTIMATE.jawLength * Math.sin(angle));
export const jawAngle = width => Math.asin(Math.min(1, width / ESTIMATE.jawLength));
