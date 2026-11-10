// The wrist panel of Doorways, above the left controller (on the desktop, low in
// front), at your real size in both views. It shows the role, the round time with
// its penalties, and what the role needs: the giant's task card (which symbol marks
// the treasure room), the mini's keys carried. It also shows the message of the
// moment, "waiting for your partner" when the partner has gone, and, when the
// treasure is found, the win. It shows no live picture: that would show the giant
// the insides of the rooms.
import * as cg from '../../render/core/cg.js';
import { G2 } from '../../util/g2.js';
import { drawSymbol, ownTexture } from './symbols.js';

// Unlit: the ambient term cancels Clay's two default lights.
const UNLIT = [1 / 2, 1 / 2.1, 1 / 2.2, 0, 0, 0, 0, 0, 0, 1];
const BG = '#060e16', INK = '#cfe3ff', DIM = '#7f93a8', GOLD = '#ffd23f', WARN = '#ff9f6b';
const KEYS = { red: '#e04040', blue: '#3a66e6' };
const HALF = .08;   // half the panel's width in metres

// A key of this colour, its ring at x: a disc with a hole and a shaft.
const key = (g, colour, x) => {
   g.setColor(KEYS[colour] || INK).fillOval(x - .1, .02, .2, .2).fillRect(x - .02, -.2, .04, .24).fillRect(x, -.2, .07, .04).fillRect(x, -.12, .05, .04);
   g.setColor(BG).fillOval(x - .035, .085, .07, .07);
};

// The hint lines under the message, for the headset's controllers or for the keyboard: the same actions, named as the
// scene reads them (input.js). A page alone can also switch its role (A, V); with a partner that is disabled.
const hints = (s, xr) => {
   const role = s.role === 'giant';
   if (xr) {
      if (s.won) return ['B: new round', 'Y: swap roles'];
      const last = role ? 'let go: set down' : 'trigger: use';
      return [...(role ? ['grip: hold a room', 'R stick: turn it'] : ['L stick: walk  R stick: turn', 'R forward: aim  grip: take']),
              last + (s.solo ? '  A: role' : '') + '  X: table'];
   }
   if (s.won) return ['N: new round', 'M: swap roles'];
   return role ? ['grip or drag: hold a room', 'Q E: turn it, let go: set down'] : ['stick, WASD: walk  Q E: turn', 'grip: take  trigger: use'];
};

const clock = s => Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0');

// The panel at pos, turned to face the eye, half its size h.
function billboard(node, pos, eye, h) {
   const z = cg.normalize(cg.subtract(eye, pos)), x = cg.normalize(cg.cross([0, 1, 0], z)), y = cg.cross(z, x);
   node.setMatrix([...x.map(v => v * h), 0, ...y.map(v => v * h), 0, ...z, 0, ...pos, 1]);
}

export class Panel {
   // owned: an array for the texture the panel takes (see ownTexture), to be released by the owner.
   constructor(model, owned) {
      this.g2 = new G2(false, 512, 512);
      this.node = model.add('square').color(UNLIT).setTxtr(this.g2.getCanvas());
      ownTexture(owned, this.node._txtr, this.g2.getCanvas());
      // The state is read when the canvas is drawn, so it is kept where the drawing finds it.
      this.state = { role: 'giant', time: 0, penalty: 0, keys: [], message: '' };
      const s = this.state;
      this.g2.render = function () {
         this.setColor(BG).fillRect(-1, -1, 2, 2);
         this.setColor(s.role === 'giant' ? GOLD : '#9fdcff').textHeight(.13).text(s.role === 'giant' ? 'GIANT' : 'MINI', 0, .84, 'center');
         this.setColor(INK).textHeight(.1).text(clock(s.time + s.penalty) + (s.penalty ? '   (+' + s.penalty + ' s)' : ''), 0, .56, 'center');
         if (s.won) this.setColor(GOLD).textHeight(.11).text(s.message, 0, .2, 'center');
         else if (s.role === 'giant' && s.goalSymbol) {
            this.setColor(DIM).textHeight(.075).text('treasure room:', 0, .36, 'center');
            this.setColor('#7a5238').fillRect(-.26, -.42, .52, .52).setColor('#e8d9a8').lineWidth(.02).drawRect(-.26, -.42, .52, .52);
            drawSymbol(this, s.goalSymbol, 0, -.16, .2);
         } else if (s.role === 'mini') {
            this.setColor(DIM).textHeight(.075).text(s.keys.length ? 'keys' : 'no keys', 0, .36, 'center');
            s.keys.forEach((c, i) => key(this, c, (i - (s.keys.length - 1) / 2) * .3));
         }
         // After a win the message is already the big line above; the bottom line is for the hints of the moment.
         if (s.waiting || !s.won) this.setColor(s.waiting ? WARN : INK).textHeight(.075).text(s.waiting ? 'waiting for your partner' : s.message || '', 0, -.57, 'center');
         this.setColor(DIM).textHeight(.054);
         hints(s, !!window.isXR?.()).forEach((line, i) => this.text(line, 0, -.71 - i * .095, 'center'));
      };
      this.frame = 0;
   }

   // state: { role, time, penalty, goalSymbol (giant), keys (mini), message, waiting, won }; pos: where the panel hangs; eye: my eye.
   update(state, pos, eye) {
      Object.assign(this.state, state);
      billboard(this.node, pos, eye, HALF);
      // Redraw and upload the canvas 10 times a second: uploading it every frame is slow on a headset.
      const refresh = this.frame++ % 7 === 0;
      this.g2.setAnimate(refresh);
      const t = window._canvas_txtr[this.node._txtr];
      if (t) t.counter = refresh ? 1 : 0;
      this.g2.update();
   }
}
