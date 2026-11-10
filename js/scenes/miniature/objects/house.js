// A house on the table, 6 x 4.8 m (to the avatar) and so 50 x 40 cm to the
// player, with a porch and two steps in front. The avatar can open the door
// and walk in, switch the lamp on, and pluck the apple from the table inside.
// The player, who is a giant to the house, lifts the roof off to look in.
// Every state is the house's own, so both views see it: see doc/hw7-design.md
// and cube.js for the object API.
//
// The plan, in avatar metres (x across the front, z towards the front, y up
// from the table). The module divides by 12 as it builds, so the house stands
// in table metres, centred on the origin, its front towards +z:
//   walls 0.15 thick, 3 high round a floor at 0.4; the gable roof peaks at 4.5;
//   the door in the front wall, 1.0 x 2.1 above the floor, hinged on its left
//   and opening inwards; a window on the front and on each side.
// The avatar's physics sees boxes only, so the roof (stood on, if reached) is
// a flight of low boxes up its slope.
import { rayBox } from '../rays.js';

const U = 1 / 12;
const HX = 3, HZ = 2.4, T = .15, FLOOR = .4, WALL = 3, PEAK = 4.5, OVER = .3;   // half width and depth, wall thickness, floor, wall top, ridge, eaves
const DOOR = { x0: -1.5, x1: -.5, top: FLOOR + 2.1, seconds: .6 };
const SILL = 1.2, HEAD = 2.4, FRAME = .1;                                      // windows: sill and head heights, frame bar width
const PORCH = 1, STEP = .6;                                                    // depths of the porch and of the step below it
const ROOF = { seconds: 1.2, lift: 1.5, beside: 2 * (HZ + OVER) + .3 };        // time to move, how high it rises, how far behind it is set
const TABLE = [.9, -1, 2.1, -.2], TABLE_TOP = FLOOR + .75;                     // the table inside: x0, z0, x1, z1
const APPLE = { r: .1, at: [1.85, -.6] }, REACH = .6, POINT = 2.5;               // the apple; how near a hand, or how far along its ray, can use things
const SWITCH = [-.2, FLOOR + 1.3, HZ - T];
const SPOT = 'miniatureGable';
const DIM = .35, BRIGHT = 1.4;                                                 // how dark the inside is with the lamp off, how bright with it on (over 1, to light the sides the lights miss)

const WALLS = [.86, .72, .5], ROOFING = [.62, .17, .14], DOORING = [.12, .38, .7], WHITE = [.97, .97, .94], GOLD = [.95, .8, .3];
const HOT = [1.6, 1.5, .7];                                                    // what a hand can use now
const WALLPAPER = [.92, .88, .74], BOARDS = [.6, .4, .24], CEILING = [.95, .93, .88], STONE = [.58, .58, .62], STONES = [.72, .72, .76];

const smooth = v => v * v * (3 - 2 * v);
const approach = (v, goal, step) => Math.abs(goal - v) <= step ? goal : v + Math.sign(goal - v) * step;
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
// The box [x0, y0, z0, x1, y1, z1] in avatar metres as a collider in table metres.
const collider = b => ({ min: [b[0] * U, b[1] * U, b[2] * U], max: [b[3] * U, b[4] * U, b[5] * U] });
// A box across the plan: a0 to a1 along axis ax (0 = x, 2 = z), c0 to c1 across it.
const rect = (ax, a0, a1, y0, y1, c0, c1) => ax === 0 ? [a0, y0, c0, a1, y1, c1] : [c0, y0, a0, c1, y1, a1];
const shade = (c, k) => c.map(v => v * k);

// A gable roof as a triangular prism, ridge along x: x and z from -1 to 1, y
// from -1 (the base) to 1 (the ridge). Defined once, when there is a Clay to define it in.
const defineGable = () => {
   const clay = typeof window !== 'undefined' && window.clay;
   if (!clay || clay.formMesh(SPOT)) return;
   const A = [-1, -1, -1], B = [1, -1, -1], C = [1, -1, 1], D = [-1, -1, 1], E = [-1, 1, 0], F = [1, 1, 0];
   const tri = (n, ...p) => p.map(v => [...v, ...n]);
   clay.defineMesh(SPOT, clay.trianglesMesh([
      ...tri([0, -1, 0], A, B, C), ...tri([0, -1, 0], A, C, D),
      ...tri([0, 1, 2], D, C, F), ...tri([0, 1, 2], D, F, E),
      ...tri([0, 1, -2], B, A, E), ...tri([0, 1, -2], B, E, F),
      ...tri([1, 0, 0], B, F, C), ...tri([-1, 0, 0], A, D, E),
   ]));
};

export function create(node) {
   defineGable();
   // Put a node over the box b, in avatar metres.
   const fill = (n, b) => n.identity().move((b[0] + b[3]) / 2 * U, (b[1] + b[4]) / 2 * U, (b[2] + b[5]) / 2 * U)
      .scale((b[3] - b[0]) / 2 * U, (b[4] - b[1]) / 2 * U, (b[5] - b[2]) / 2 * U);
   const part = (form, colour, b) => fill(node.add(form), b).color(colour).dull();

   const st = { door: 0, doorOpen: false, lamp: false, roof: 0, roofOff: false, apple: [APPLE.at[0] * U, (TABLE_TOP + APPLE.r) * U, APPLE.at[1] * U], held: null };
   const lit = [], glass = [], solid = [];   // the inside surfaces that follow the lamp; the panes; the colliders that never change
   const addSolid = b => { solid.push(collider(b)); return b; };

   // The base: the floor inside, the porch deck and the step down from it.
   const floor = part('cube', BOARDS, addSolid([-HX + T / 2, 0, -HZ + T / 2, HX - T / 2, FLOOR, HZ - T / 2]));
   const deck = addSolid([-2.5, 0, HZ - T / 2, .5, FLOOR, HZ + PORCH]);
   part('cube', STONE, deck);
   part('cube', STONES, addSolid([-2, 0, HZ + PORCH, 0, FLOOR / 2, HZ + PORCH + STEP]));

   // Walls: each piece with a lining on its inner face, which the lamp lights.
   // A hole for a window gets a frame and a pane.
   const wall = (ax, c0, c1, inward, pieces) => {
      for (const [a0, a1, y0, y1] of pieces) {
         part('cube', WALLS, rect(ax, a0, a1, y0, y1, c0, c1));
         const face = inward > 0 ? c1 : c0, skin = rect(ax, a0, a1, Math.max(y0, FLOOR), y1, Math.min(face, face + inward * .02), Math.max(face, face + inward * .02));
         lit.push({ n: part('cube', WALLPAPER, skin), colour: WALLPAPER });
      }
   };
   const around = (a0, a1, w0, w1) => [[a0, w0, 0, WALL], [w1, a1, 0, WALL], [w0, w1, 0, SILL], [w0, w1, HEAD, WALL]];
   const hole = (ax, c0, c1, w0, w1) => {
      const c = (c0 + c1) / 2, d = T / 2 + .04, bar = (a0, a1, y0, y1) => part('cube', WHITE, rect(ax, a0, a1, y0, y1, c - d, c + d));
      bar(w0, w1, HEAD - FRAME, HEAD); bar(w0, w1, SILL, SILL + FRAME);
      bar(w0, w0 + FRAME, SILL + FRAME, HEAD - FRAME); bar(w1 - FRAME, w1, SILL + FRAME, HEAD - FRAME);
      // The panes come last: they are see-through, so what is behind is drawn first.
      glass.push(rect(ax, w0, w1, SILL, HEAD, c - .01, c + .01));
   };
   wall(0, HZ - T, HZ, -1, [[-HX, DOOR.x0, 0, WALL], [DOOR.x0, DOOR.x1, DOOR.top, WALL], ...around(DOOR.x1, HX, .7, 2.3)]);
   wall(0, -HZ, -HZ + T, 1, [[-HX, HX, 0, WALL]]);
   wall(2, -HX, -HX + T, 1, around(-HZ + T, HZ - T, -.8, .8));
   wall(2, HX - T, HX, -1, around(-HZ + T, HZ - T, -.8, .8));
   hole(0, HZ - T, HZ, .7, 2.3); hole(2, -HX, -HX + T, -.8, .8); hole(2, HX - T, HX, -.8, .8);
   // The walls as the avatar meets them: whole, windows and all.
   addSolid([-HX, 0, HZ - T, DOOR.x0, WALL, HZ]); addSolid([DOOR.x0, DOOR.top, HZ - T, DOOR.x1, WALL, HZ]); addSolid([DOOR.x1, 0, HZ - T, HX, WALL, HZ]);
   addSolid([-HX, 0, -HZ, HX, WALL, -HZ + T]);
   addSolid([-HX, 0, -HZ + T, -HX + T, WALL, HZ - T]); addSolid([HX - T, 0, -HZ + T, HX, WALL, HZ - T]);

   // The table inside, the lamp on it, and the light switch by the door.
   const [tx0, tz0, tx1, tz1] = TABLE;
   part('cube', BOARDS, [tx0, TABLE_TOP - .06, tz0, tx1, TABLE_TOP, tz1]);
   for (const x of [tx0 + .08, tx1 - .08]) for (const z of [tz0 + .08, tz1 - .08]) part('cube', BOARDS, [x - .04, FLOOR, z - .04, x + .04, TABLE_TOP - .06, z + .04]);
   addSolid([tx0, FLOOR, tz0, tx1, TABLE_TOP, tz1]);
   const lampAt = [1.2, -.6];
   part('tubeY', STONE, [lampAt[0] - .15, TABLE_TOP, lampAt[1] - .15, lampAt[0] + .15, TABLE_TOP + .05, lampAt[1] + .15]);
   part('tubeY', STONE, [lampAt[0] - .02, TABLE_TOP, lampAt[1] - .02, lampAt[0] + .02, TABLE_TOP + .32, lampAt[1] + .02]);
   const lampshade = part('tubeY', CEILING, [lampAt[0] - .17, TABLE_TOP + .32, lampAt[1] - .17, lampAt[0] + .17, TABLE_TOP + .55, lampAt[1] + .17]);
   const plate = part('cube', WHITE, [SWITCH[0] - .07, SWITCH[1] - .11, SWITCH[2] - .035, SWITCH[0] + .07, SWITCH[1] + .11, SWITCH[2] - .02]);
   const flick = node.add('cube');

   // The apple.
   const apple = node.add('sphere').color(.85, .1, .1), leaf = node.add('sphere').color(.2, .65, .2);
   const placeApple = () => {
      const [x, y, z] = st.apple, r = APPLE.r * U;
      apple.identity().move(x, y, z).scale(r);
      leaf.identity().move(x, y + r * 1.05, z).scale(r * .22, r * .3, r * .22);
   };

   // The door, hinged at its left. It swings 90 degrees inwards.
   const hinge = [DOOR.x0, 0, HZ - T / 2], leaf0 = node.add('cube').color(DOORING), knobs = [-1, 1].map(() => node.add('sphere').color(GOLD));
   const swing = () => smooth(st.door) * Math.PI / 2;
   const placeDoor = () => {
      const a = swing();
      leaf0.identity().move(hinge[0] * U, (FLOOR + 1.05) * U, hinge[2] * U).turnY(a).move(.5 * U, 0, 0).scale(.5 * U, 1.05 * U, .04 * U);
      knobs.forEach((k, i) => k.identity().move(hinge[0] * U, (FLOOR + 1) * U, hinge[2] * U).turnY(a).move(.85 * U, 0, (i ? .08 : -.08) * U).scale(.045 * U));
   };
   // Where the handle is now, in table metres.
   const handle = () => { const a = swing(); return [(hinge[0] + .85 * Math.cos(a)) * U, (FLOOR + 1) * U, (hinge[2] - .85 * Math.sin(a)) * U]; };
   const doorBox = collider([DOOR.x0, FLOOR, HZ - T, DOOR.x1, DOOR.top, HZ]);

   // The roof, with the ceiling under it. It lifts, moves behind the house and sets down on the table.
   const ceiling = part('cube', CEILING, [-HX + T, WALL - .02, -HZ + T, HX - T, WALL, HZ - T]);
   const roof = node.add(SPOT).color(ROOFING);
   // It slides clear of the walls before it comes down, so it never passes through them.
   const roofAt = () => {
      const e = smooth(st.roof), down = smooth(Math.min(1, Math.max(0, (e - .9) / .1)));
      return [0, ROOF.lift * Math.sin(Math.PI * e) - WALL * down, -ROOF.beside * e];
   };
   const placeRoof = () => {
      const [x, y, z] = roofAt();
      roof.identity().move(x * U, (WALL + (PEAK - WALL) / 2 + y) * U, z * U).scale((HX + OVER) * U, (PEAK - WALL) / 2 * U, (HZ + OVER) * U);
      ceiling.identity().move(x * U, (WALL - .01 + y) * U, z * U).scale((HX - T) * U, .01 * U, (HZ - T) * U);
   };
   // The roof's box, for pointing at, where it is now.
   const roofBox = () => {
      const [, y, z] = roofAt();
      return { min: [-(HX + OVER) * U, (WALL + y) * U, (-HZ - OVER + z) * U], max: [(HX + OVER) * U, (PEAK + y) * U, (HZ + OVER + z) * U] };
   };
   // The roof as the avatar meets it: four bands of boxes up the slope, each a little under 0.45 m higher.
   const slope = [];
   for (let i = 0; i < 4; i++) {
      const z0 = i * (HZ + OVER) / 4, z1 = z0 + (HZ + OVER) / 4, top = WALL + (PEAK - WALL) * (1 - (z0 + z1) / 2 / (HZ + OVER));
      slope.push(collider([-(HX + OVER), WALL, i ? z0 : -z1, HX + OVER, top, z1]));
      if (i) slope.push(collider([-(HX + OVER), WALL, -z1, HX + OVER, top, -z0]));
   }

   // Panes, the switch and the lamp, in the colours of the lamp being off or on. The see-through panes come last.
   const glassNodes = glass.map(b => fill(node.add('cube'), b));
   const paint = () => {
      const k = st.lamp ? BRIGHT : DIM;
      for (const l of lit) l.n.color(shade(l.colour, k));
      floor.color(shade(BOARDS, k));
      ceiling.color(shade(CEILING, k));
      glassNodes.forEach(g => g.color(st.lamp ? [1, .88, .5] : [.55, .75, .9]).opacity(st.lamp ? .55 : .3));
      lampshade.color(st.lamp ? [2.4, 2.1, 1.1] : [.85, .82, .7]);
      const y = SWITCH[1] + (st.lamp ? .05 : -.05);
      fill(flick, [SWITCH[0] - .025, y - .04, SWITCH[2] - .05, SWITCH[0] + .025, y + .04, SWITCH[2] - .035]).color(st.lamp ? [1, .85, .2] : [.45, .45, .45]);
   };

   // The boxes now: kept until the door or the roof changes them.
   let cache = null;
   const colliders = () => cache ||= [...solid, ...(st.door < .5 ? [doorBox] : []), ...(st.roof === 0 ? slope : [])];

   // The nearest top under the apple: a collider's, if it is over it, else the table.
   const settle = () => {
      const [x, y, z] = st.apple, r = APPLE.r * U;
      let top = 0;
      for (const b of colliders())
         if (b.max[1] <= y + r && b.max[1] > top && x >= b.min[0] && x <= b.max[0] && z >= b.min[2] && z <= b.max[2]) top = b.max[1];
      st.apple = [x, top + r, z];
   };

   // What the avatar's hand can use: the nearest thing within reach of it, else the
   // first its ray meets, not too far. things: [{ what, at, size }], size the half
   // width (avatar metres) of the box round at that the ray must meet.
   const choose = (h, things) => {
      let best = null, near = REACH * U;
      for (const t of things) { const d = dist(h.p, t.at); if (d < near) { near = d; best = t.what; } }
      if (best) return best;
      let first = POINT * U;
      for (const t of things) {
         const r = rayBox(h.ray, { min: t.at.map(v => v - t.size * U), max: t.at.map(v => v + t.size * U) });
         if (r !== null && r < first) { first = r; best = t.what; }
      }
      return best;
   };
   const usable = h => choose(h, [{ what: 'door', at: handle(), size: .2 }, { what: 'switch', at: SWITCH.map(v => v * U), size: .15 }]);
   // Does the hand, or its ray, meet the roof?
   const reachesRoof = h => {
      const b = roofBox(), r = rayBox(h.ray, b);
      return h.p.every((v, a) => v > b.min[a] - .03 && v < b.max[a] + .03) || r !== null && r <= 3;
   };

   const bounds = { min: [-(HX + OVER) * U, 0, -(HZ + OVER) * U], max: [(HX + OVER) * U, PEAK * U, (HZ + PORCH + STEP) * U] };
   let touching = new Set();
   paint(); placeDoor(); placeRoof(); placeApple();

   return {
      bounds,
      colliders,
      state: st,
      update({ mode, dt = 0, hands, haptic }) {
         const inside = mode === 'avatar', now = new Set();
         for (const h of hands) {
            // The avatar's hand uses the door and the switch and picks the apple up; the giant's hand lifts the roof.
            const use = inside ? usable(h) : reachesRoof(h) ? 'roof' : null;
            const fruit = inside && !st.held && choose(h, [{ what: 'apple', at: st.apple, size: .2 }]) === 'apple';
            for (const what of [use, fruit && 'apple']) {
               if (!what) continue;
               now.add(h.hand + what);
               if (!touching.has(h.hand + what)) haptic?.(h.hand, .3, 30);
            }
            if (h.pressed && use === 'door') st.doorOpen = !st.doorOpen;
            if (h.pressed && use === 'switch') { st.lamp = !st.lamp; paint(); }
            if (h.pressed && use === 'roof') st.roofOff = !st.roofOff;
            if (h.gripPressed && fruit) {
               // Picked from near by, it stays where it was in the hand; pointed at, it comes to the hand.
               const near = dist(h.p, st.apple) < REACH * U;
               st.held = { hand: h.hand, offset: near ? st.apple.map((v, a) => v - h.p[a]) : [0, 0, 0] };
               haptic?.(h.hand, .6, 40);
            }
         }
         touching = now;
         // What a hand can use lights up.
         const hot = what => [...now].some(k => k.endsWith(what));
         knobs.forEach(k => k.color(hot('door') ? HOT : GOLD));
         plate.color(hot('switch') ? HOT : WHITE);
         apple.color(hot('apple') ? [1.5, .35, .3] : [.85, .1, .1]);

         // The apple follows the hand that holds it, else rests on what is under it.
         const grip = st.held && inside && hands.find(h => h.hand === st.held.hand && h.grip);
         if (grip) st.apple = grip.p.map((v, a) => v + st.held.offset[a]);
         else { st.held = null; settle(); }
         placeApple();

         // The door and the roof, on their way.
         const door = approach(st.door, st.doorOpen ? 1 : 0, dt / DOOR.seconds), roofed = approach(st.roof, st.roofOff ? 1 : 0, dt / ROOF.seconds);
         if (door !== st.door) { if ((door < .5) !== (st.door < .5)) cache = null; st.door = door; placeDoor(); }
         if (roofed !== st.roof) { if (!roofed || !st.roof) cache = null; st.roof = roofed; placeRoof(); }
      },
   };
}
