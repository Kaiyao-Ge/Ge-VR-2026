// The controls: the sonar on the left wrist, which shows where the sound has
// found the moths, and the round on the clock in the middle of the room.
import * as cg from '../../render/core/cg.js';
import { G2 } from '../../util/g2.js';

// Unlit: the ambient term cancels Clay's two default lights.
const UNLIT = [1 / 2, 1 / 2.1, 1 / 2.2, 0, 0, 0, 0, 0, 0, 1];
// A button measures its label in the font last set: end each render in the widgets' font.
const SIZE = 2.6, WIDGET_FONT = .045 * SIZE;
const BG = '#060e16', INK = '#cfe3ff', DIM = '#7f93a8', KEY = '#9fdcff';
// The sonar's disc: centre and radius on the panel, and the metres it shows.
export const SONAR = { y: .2, r: .6, range: 4 };

function billboard(node, pos, eye, s) {
   const z = cg.normalize(cg.subtract(eye, pos)), x = cg.normalize(cg.cross([0, 1, 0], z)), y = cg.cross(z, x);
   node.setMatrix([...x.map(v => v * s), 0, ...y.map(v => v * s), 0, ...z, 0, ...pos, 1]);
}

export class Panels {
   constructor(model, { onStart }) {
      const panel = (size = 512) => {
         const g2 = new G2(false, size, size);
         const node = model.add('square').color(UNLIT).setTxtr(g2.getCanvas());
         return { g2, node };
      };
      this.state = {};
      const s = this.state;

      // Wrist: the sonar, fixed to the room. Rings a metre apart, you at the middle
      // turning as you turn, the room's walls, and a blip where each moth was last found, fading.
      this.wrist = panel();
      this.wrist.g2.render = function () {
         const { y, r } = SONAR;
         this.setColor(BG).fillRect(-1, -1, 2, 2);
         this.lineWidth(.006);
         // drawOval takes the centre (fillOval the lower left corner).
         for (let k = 1; k <= 4; k++) this.setColor(k === 4 ? DIM : '#1d3a50').drawOval(0, y, r * k / 2, r * k / 2);
         this.setColor('#1d3a50').line([0, y - r], [0, y + r]).line([-r, y], [r, y]);
         if (s.outline?.length) this.setColor(DIM).lineWidth(.01).drawPath([...s.outline, s.outline[0]]);
         // You, a triangle pointing where you face.
         const [hx, hy] = s.heading || [0, 1], at = (f, l) => [hx * f + hy * l, y + hy * f - hx * l];
         this.setColor(INK).fillPath([at(.06, 0), at(-.03, -.035), at(-.03, .035)]);
         for (const b of s.blips || []) this.setColor(`rgba(159,220,255,${b.a.toFixed(2)})`).fillOval(b.x - .03, y + b.y - .03, .06, .06);
         this.setColor(INK).textHeight(.07).text('hits ' + (s.hits || 0), 0, .92, 'center');
         this.setColor(DIM).textHeight(.055).text((s.scanning ? 'scanning ' + s.scanning + ' s' : s.running ? Math.ceil(s.remaining) + ' s left' : 'press start')
            + (s.micOn ? '    mic on' : '    mic off'), 0, .84, 'center');
         this.setColor(DIM).textHeight(.05).text('L trigger: click   R trigger: shoot', 0, -.47, 'center').text('L grip: mic   A: scan', 0, -.55, 'center');
         this.textHeight(WIDGET_FONT);
      };

      // Clock: the time left as a shrinking disc, the hits, and the start button.
      this.clock = panel();
      const c = this.clock.g2;
      c.render = function () {
         this.setColor(BG).fillRect(-1, -1, 2, 2);
         const f = s.running ? s.remaining / s.round : 0, path = [[0, .45]];
         for (let i = 0; i <= 48; i++) {
            const a = 2 * Math.PI * f * i / 48;
            path.push([.4 * Math.sin(a), .45 + .4 * Math.cos(a)]);
         }
         this.setColor('#1d3a50').fillOval(-.42, .03, .84, .84);
         if (f > 0) this.setColor(KEY).fillPath(path);
         this.setColor(INK).textHeight(.16).text(s.running ? '' + Math.ceil(s.remaining) : '60', 0, .45, 'center');
         this.setColor(INK).textHeight(.12).text('hits ' + (s.hits || 0), 0, -.3, 'center');
         this.textHeight(WIDGET_FONT);
      };
      this.startButton = c.addWidget(this.clock.node, 'button', 0, -.72, '#ffffff', ['start'], () => onStart(), SIZE);

      this.all = [this.wrist, this.clock];
      this.frame = 0;
      this.active = false;
   }

   // state: { hits, played, running, remaining, round, scanning, micOn, heading, blips, outline }
   // eye: my eye; wrist: where my wrist panel goes; clock: where the clock hangs.
   update(state, eye, wrist, clock) {
      const s = Object.assign(this.state, state);
      // Labels as arrays: a button measures label[0].
      this.startButton.setLabel([s.scanning ? 'scanning' : s.running ? 'playing' : s.played ? 'again' : 'start']);
      billboard(this.wrist.node, wrist, eye, .075);
      billboard(this.clock.node, clock, eye, .2);
      // Redraw and upload the canvases 10 times a second, or every frame while a
      // widget is held: uploading every canvas every frame is slow on a headset.
      const refresh = this.frame++ % 7 === 0 || this.active;
      let active = false;
      for (const p of this.all) {
         p.g2.setAnimate(refresh);
         const t = window._canvas_txtr[p.node._txtr];
         if (t) t.counter = refresh ? 1 : 0;
         active = p.g2.update() || active;
      }
      return this.active = active;
   }
}
