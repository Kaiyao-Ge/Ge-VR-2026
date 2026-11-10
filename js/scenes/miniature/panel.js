// The wrist panel, above the left controller, at your real size in both views:
// a live picture from the camera (camera.js), through the avatar's eyes in my
// view and through my own eyes (the giant's) in the avatar's, and under it what
// view I am in, what the controls are and what I can do right now.
import * as cg from '../../render/core/cg.js';
import { G2 } from '../../util/g2.js';

// Unlit: the ambient term cancels Clay's two default lights.
const UNLIT = [1 / 2, 1 / 2.1, 1 / 2.2, 0, 0, 0, 0, 0, 0, 1];
const BG = '#060e16', INK = '#cfe3ff', DIM = '#7f93a8', KEY = '#9fdcff';
const TEXT = .045, SCREEN = [.08, .06];   // half the text's width; half the picture's width and height, metres

// The panel at pos, turned to face the eye, its half sizes sx and sy.
function billboard(node, pos, eye, sx, sy = sx) {
   const z = cg.normalize(cg.subtract(eye, pos)), x = cg.normalize(cg.cross([0, 1, 0], z)), y = cg.cross(z, x);
   node.setMatrix([...x.map(v => v * sx), 0, ...y.map(v => v * sy), 0, ...z, 0, ...pos, 1]);
}

export class WristPanel {
   // camera: whose picture the screen shows.
   constructor(model, camera) {
      this.g2 = new G2(false, 512, 512);
      // Neither is seen by the camera: it would draw them into the picture they show.
      this.node = model.add('square').color(UNLIT).setTxtr(this.g2.getCanvas()).view('main');
      this.screen = camera.show(model.add('square').color(UNLIT).view('main'));
      this.state = {};
      const s = this.state;
      this.g2.render = function () {
         this.setColor(BG).fillRect(-1, -1, 2, 2);
         this.setColor(KEY).textHeight(.13).text(s.view === 'avatar' ? 'avatar view' : 'my view', 0, .8, 'center');
         this.setColor(DIM).textHeight(.075).text(s.view === 'avatar' ? 'above: through my own eyes' : 'above: through the avatar\'s eyes', 0, .62, 'center');
         this.setColor(INK).textHeight(.085).text(s.message || '', 0, .42, 'center');
         this.setColor(DIM).textHeight(.07);
         ['A view     B reset     X table', 'Y scan the room again', 'left stick: walk', 'right stick: turn / teleport', 'grip: grab', 'trigger: use']
            .forEach((line, i) => this.text(line, 0, .15 - i * .17, 'center'));
      };
      this.frame = 0;
   }

   // state: { view, message }; pos: where the text hangs; eye: my eye.
   update(state, pos, eye) {
      Object.assign(this.state, state);
      // The picture above the text.
      billboard(this.screen, [pos[0], pos[1] + SCREEN[1] + TEXT + .005, pos[2]], eye, ...SCREEN);
      billboard(this.node, pos, eye, TEXT);
      // Redraw and upload the canvas 10 times a second: uploading it every frame is slow on a headset.
      const refresh = this.frame++ % 7 === 0;
      this.g2.setAnimate(refresh);
      const t = window._canvas_txtr[this.node._txtr];
      if (t) t.counter = refresh ? 1 : 0;
      this.g2.update();
   }
}
