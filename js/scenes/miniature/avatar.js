// The player's avatar: a head that looks where they look, two controllers in
// their hands, and a body standing under the head. Built at the player's real
// size; the scene hands it poses already mapped onto the table (so 1/12 of it).
// Replace this module to change how the avatar looks: the scene only calls
// update(poses, { body }).
import * as cg from '../../render/core/cg.js';

const SKIN = [.95, .78, .62], SHIRT = [.25, .45, .75], DARK = [.15, .15, .18];

export class Avatar {
   constructor(parent) {
      this.root = parent.add();
      this.head = this.root.add();
      this.head.add('sphere').color(SKIN);                  // the head
      this.head.add('cube').color(DARK);                    // a visor: which way it looks
      this.head.add('sphere').color(SKIN);                  // a nose
      this.body = this.root.add();
      this.body.add('tubeY').color(SHIRT);                  // torso
      this.body.add('tubeY').color(DARK);                   // legs
      this.hands = ['left', 'right'].map(() => {
         const h = this.root.add();
         h.add('cube').color(DARK);                         // the controller's grip
         h.add('tubeZ').color([.8, .8, .85]);               // its ring
         return h;
      });
   }
   // poses: { head, left, right } as matrices (mapped); feet: the point under the head, mapped;
   // show: { head, body, hands } which parts to draw.
   update({ head, left, right }, feet, show) {
      const s = cg.norm(head.slice(0, 3));   // the mapping's scale
      this.head.setMatrix(show.head ? head : cg.mScale(0));
      this.head.child(0).identity().scale(.09, .11, .1);
      this.head.child(1).identity().move(0, .015, -.085).scale(.07, .025, .03);
      this.head.child(2).identity().move(0, -.02, -.1).scale(.015);
      // The body stands upright under the head, turned the way the head faces.
      if (show.body) {
         const top = cg.mTransform(head, [0, -.15, 0]), h = Math.max(.01, top[1] - feet[1]);
         const yaw = Math.atan2(head[8], head[10]);
         this.body.setMatrix(cg.mMultiply(cg.mTranslate(feet), cg.mRotateY(yaw)));
         this.body.child(0).identity().move(0, h * .72, 0).scale(.16 * s, h * .28, .1 * s);
         this.body.child(1).identity().move(0, h * .22, 0).scale(.1 * s, h * .22, .07 * s);
      } else this.body.setMatrix(cg.mScale(0));
      [left, right].forEach((m, i) => {
         const h = this.hands[i];
         h.setMatrix(show.hands && m ? m : cg.mScale(0));
         h.child(0).identity().move(0, -.03, .02).scale(.017, .035, .02);
         h.child(1).identity().move(0, .005, -.02).scale(.035, .035, .008);
      });
   }
}
