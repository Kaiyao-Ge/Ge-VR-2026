// How the player's body maps onto the miniature avatar, and back.
//
// Two frames on the ground, each a point and a turn about the vertical:
//   body:  where the player stands on the room's floor, and which way they face;
//   stand: where the avatar stands on the table top, and which way it faces.
// toMini = stand * scale(1/12) * body⁻¹ takes anything about the player (head,
// hands) to the avatar on the table: the player's eye 1.6 m above the floor
// becomes the avatar's eye 13 cm above the table, and walking a metre walks
// the avatar 8 cm. Its inverse, drawn as the whole world's matrix, puts the
// player's eye where the avatar's eye is: the room seen at 12 times its size.
// flight(...) is that matrix on its way, while the views are switched.
import * as cg from '../../render/core/cg.js';

export const SCALE = 1 / 12;

export const frame = (p, yaw) => cg.mMultiply(cg.mTranslate(p), cg.mRotateY(yaw));
// The turn about the vertical of a matrix's facing (its -z axis).
export const yawOf = m => Math.atan2(m[8], m[10]);
const wrap = a => a - 2 * Math.PI * Math.round(a / (2 * Math.PI));

// The world's matrix t of the way from my view (t = 0, the identity) to the
// avatar's (t = 1, toWorld). eye: my eye; mini: the avatar's eye, toMini(eye);
// theta: the turn of toWorld. The world grows 12^t about a point that moves
// from my eye to the avatar's, evenly in the log of the scale, so the approach
// feels steady. The turn is taken the short way round, however many snap
// turns the avatar has made.
export const flight = (eye, mini, theta, t) => {
   theta = wrap(theta);
   const about = cg.add(eye, cg.scale(cg.subtract(mini, eye), (1 - SCALE ** t) / (1 - SCALE)));
   return cg.mMultiply(cg.mTranslate(eye), cg.mMultiply(cg.mRotateY(theta * t),
      cg.mMultiply(cg.mScale(1 / SCALE ** t), cg.mTranslate(cg.scale(about, -1)))));
};

export class Mapping {
   constructor() {
      this.body = { p: [0, 0, 0], yaw: 0 };
      this.stand = { p: [0, 0, 0], yaw: 0 };
      this.update();
   }
   update() {
      const B = frame(this.body.p, this.body.yaw), S = frame(this.stand.p, this.stand.yaw);
      this.toMini = cg.mMultiply(S, cg.mMultiply(cg.mScale(SCALE), cg.mInverse(B)));
      this.toWorld = cg.mInverse(this.toMini);
      return this;
   }
   // The player stands here now: the avatar stays where it stands.
   setBody(head) {
      this.body = { p: [head[12], 0, head[14]], yaw: yawOf(head) };
      return this.update();
   }
   setStand(p, yaw) {
      this.stand = { p: [...p], yaw };
      return this.update();
   }
   mini(m) { return cg.mMultiply(this.toMini, m); }
   // Where the avatar's feet are: under its eye, on the table.
   feet(head) { return cg.mTransform(this.toMini, [head[12], 0, head[14]]); }
   // Which way the avatar faces.
   facing(head) { return this.stand.yaw + yawOf(head) - this.body.yaw; }
   // A step of the avatar: forward and right in metres of table, in the way it faces.
   direction(head, forward, right) {
      const a = this.facing(head), f = [-Math.sin(a), 0, -Math.cos(a)], r = [Math.cos(a), 0, -Math.sin(a)];
      return cg.add(cg.scale(f, forward), cg.scale(r, right));
   }
   walk(head, forward, right) {
      this.stand.p = cg.add(this.stand.p, this.direction(head, forward, right));
      return this.update();
   }
   // The avatar rides the object that moved from pose was to pose now: carried
   // with it, and turned by the object's turn about the vertical.
   carry(was, now) {
      this.stand.p = cg.mTransform(cg.mMultiply(now, cg.mInverse(was)), this.stand.p);
      this.stand.yaw += wrap(yawOf(now) - yawOf(was));
      return this.update();
   }
   // Turn the avatar in place: the stand point, which the physics tracks, stays
   // where it is, so a turn cannot swing it into a wall. The avatar's body, under
   // its head, swings round that point.
   turn(angle) {
      this.stand.yaw += angle;
      return this.update();
   }
}
