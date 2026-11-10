// One room of Doorways as Clay parts and boxes, in the room's own frame: table
// metres, y = 0 the table top, centred on its cell, north (-z) the side 0 (see
// rules.js). The same room is seen from above by the giant and from inside by the
// mini, so it is drawn whole: floor, rug, four walls with a doorway in the middle
// of each side that has one, a roof, and what the room holds. The module is pure
// apart from the nodes it is given, so it loads in Node: the rug's picture comes
// from the scene through a callback.
//
// The mini's physics sees boxes only: the floor slab, the walls broken by their
// doorways, a lintel over each doorway, and the gate while it is locked. The
// mini's hands see things(): the key, switch, chest and gate that can still be used.
import { rayBox } from '../miniature/rays.js';
import { U, CELL, ROOM, SPOTS } from './rules.js';

export const PALETTE = {
   wall: [.93, .88, .72], floor: [.7, .6, .45], rug: [.48, .32, .22], roof: [.45, .1, .1], stone: [.55, .55, .6], wood: [.5, .32, .18],
   red: [.85, .2, .2], blue: [.2, .4, .9], grey: [.5, .5, .52], gold: [.95, .8, .3],
};
const { FLOOR, WALL, T, DOOR_W, DOOR_H } = ROOM;
const H = CELL / 2, ROOF_T = .2 * U, GATE_T = .1 * U, REACH = .6 * U, POINT = 2.5 * U;
const RUG = .2 * CELL, RUG_UP = .0004;                 // the rug's half width; how far above the floor it lies, against flicker
const SPOT = {                                          // where each thing is picked, and the half width of the box a ray must meet
   key: { y: .9 * U, size: .25 * U }, switch: { y: 1.2 * U, size: .25 * U }, chest: { y: .4 * U, size: .4 * U }, gate: { size: .5 * U },
};
// Which way an open gate folds along its wall, by side: away from the corner where the key, the switch or the chest stands.
const HINGE = [-1, -1, -1, 1];
const PEDESTAL = 1 * U, BODY = .45 * U, LID = .6 * U;  // top of the switch's pedestal; tops of the chest's body and closed lid

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const collider = b => ({ min: b.slice(0, 3), max: b.slice(3) });
const [KX, KZ] = SPOTS.key, [SX, SZ] = SPOTS.switch, [CX, CZ] = SPOTS.chest;

// The box [x0, y0, z0, x1, y1, z1] of a wall piece of side s: u along the wall, w outwards from the room's middle.
const sideBox = (side, u0, u1, y0, y1, w0, w1) => {
   const sign = side === 0 || side === 3 ? -1 : 1, [a, b] = sign > 0 ? [w0, w1] : [-w1, -w0];
   return side % 2 ? [a, y0, u0, b, y1, u1] : [u0, y0, a, u1, y1, b];
};

// The hand's choice among things: the nearest within reach of it, else the first
// its ray meets, not too far. things: [{ what, at, size }], size the half width of the
// box round at that the ray must meet; h: { p, ray: { o, d } } in the room's frame.
export const choose = (h, things) => {
   let best = null, near = REACH;
   for (const t of things) { const d = dist(h.p, t.at); if (d < near) { near = d; best = t.what; } }
   if (best) return best;
   let first = POINT;
   for (const t of things) {
      const r = rayBox(h.ray, { min: t.at.map(v => v - t.size), max: t.at.map(v => v + t.size) });
      if (r !== null && r < first) { first = r; best = t.what; }
   }
   return best;
};

// node: where to add the room's parts. room: the room's data (see rules.js and generate.js).
// goal: the treasure is in its chest. rug(node, symbol): the scene's way to put the room's symbol on the rug.
export function createRoom(node, room, { goal = false, rug } = {}) {
   const fill = (n, b) => n.identity().move((b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2).scale((b[3] - b[0]) / 2, (b[4] - b[1]) / 2, (b[5] - b[2]) / 2);
   const part = (form, colour, b) => fill(node.add(form), b).color(colour).dull();
   // A part that can come and go: placed at b while on, collapsed to nothing while off.
   const place = (n, b, on = true) => on ? fill(n, b) : n.identity().scale(0);

   // The floor, the walls with their doorways and the lintels over them, as parts and as boxes.
   const solid = [];
   const slab = (colour, b) => { part('cube', colour, b); solid.push(collider(b)); };
   const floor = [-H, 0, -H, H, FLOOR, H];
   slab(PALETTE.floor, floor);
   for (let s = 0; s < 4; s++) {
      const span = s % 2 ? H - T : H, door = !!(room.doors >> s & 1), d = DOOR_W / 2;
      const pieces = door ? [[-span, -d, FLOOR, WALL], [d, span, FLOOR, WALL], [-d, d, FLOOR + DOOR_H, WALL]] : [[-span, span, FLOOR, WALL]];
      for (const [u0, u1, y0, y1] of pieces) slab(PALETTE.wall, sideBox(s, u0, u1, y0, y1, H - T, H));
   }

   // The rug: a square on the floor, the scene's picture on it, or plain brown without a scene.
   const mat = node.add('square').color(PALETTE.rug).dull();
   mat.identity().move(0, FLOOR + RUG_UP, 0).turnX(-Math.PI / 2).scale(RUG, RUG, 1);
   if (rug) rug(mat, room.symbol);

   // The roof, one slab over the walls, and the stake of the anchor colour standing out of it.
   const roof = part('cube', PALETTE.roof, [-H, WALL, -H, H, WALL + ROOF_T, H]);
   const stake = !room.anchor ? [] : [node.add('tubeY'), node.add('cube')].map(n => n.color(PALETTE[room.anchor]).dull());
   const stakeBoxes = [[-.07 * U, WALL, -.07 * U, .07 * U, WALL + 1.8 * U, .07 * U], [.07 * U, WALL + 1.35 * U, -.02 * U, .5 * U, WALL + 1.8 * U, .02 * U]];

   // The key (a ring, a shaft and a tooth), the switch on its pedestal, and the chest.
   const keyNodes = !room.key ? [] : [node.add('sphere'), node.add('cube'), node.add('cube')].map(n => n.color(PALETTE[room.key]).dull());
   const keyBoxes = () => {
      const y = SPOT.key.y;
      return [[KX - .27 * U, y - .1 * U, KZ - .1 * U, KX - .07 * U, y + .1 * U, KZ + .1 * U], [KX - .07 * U, y - .02 * U, KZ - .02 * U, KX + .25 * U, y + .02 * U, KZ + .02 * U],
              [KX + .17 * U, y - .1 * U, KZ - .02 * U, KX + .21 * U, y, KZ + .02 * U]];
   };
   const button = room.switch ? node.add('tubeY').color(PALETTE[room.switch]).dull() : null;
   if (room.switch) part('cube', PALETTE.stone, [SX - .15 * U, FLOOR, SZ - .15 * U, SX + .15 * U, PEDESTAL, SZ + .15 * U]);
   const buttonBox = down => [SX - .1 * U, PEDESTAL, SZ - .1 * U, SX + .1 * U, PEDESTAL + (down ? .04 : .16) * U, SZ + .1 * U];
   const lid = room.chest ? node.add('cube').color(PALETTE.wood).dull() : null, gold = room.chest ? node.add('cube').color(PALETTE.gold).dull() : null;
   if (room.chest) part('cube', PALETTE.wood, [CX - .3 * U, FLOOR, CZ - .2 * U, CX + .3 * U, BODY, CZ + .2 * U]);
   const back = Math.sign(CZ);                         // the lid hinges on the side towards the nearer wall, and stands up there when open
   const hinge = back > 0 ? CZ + .16 * U : CZ - .2 * U;   // the z where a lid stands, .04 U thick against that wall
   const lidBox = open => open ? [CX - .3 * U, BODY, hinge, CX + .3 * U, BODY + .3 * U, hinge + .04 * U] : [CX - .3 * U, BODY, CZ - .2 * U, CX + .3 * U, LID, CZ + .2 * U];
   const goldBox = [CX - .25 * U, BODY, CZ - .15 * U, CX + .25 * U, BODY + .05 * U, CZ + .15 * U];

   // The gate, in two leaves: the colour on the side facing the room, grey on the other. Closed it fills the doorway
   // on the wall's middle line; open it is folded flat against the room's inner face of the wall beside the doorway,
   // on the side HINGE says (the one where no key, pedestal or chest stands), short enough not to reach the next wall.
   const side = room.gate ? room.gate.side : 0, c = H - T / 2, d = DOOR_W / 2, fold = HINGE[side], span = H - T;
   const leaves = room.gate ? [node.add('cube').color(PALETTE[room.gate.colour]).dull(), node.add('cube').color(PALETTE.grey).dull()] : [];
   const [f0, f1] = fold > 0 ? [d, span] : [-span, -d], inner = H - T;
   const shut = [sideBox(side, -d, d, FLOOR, FLOOR + DOOR_H, c - GATE_T / 2, c), sideBox(side, -d, d, FLOOR, FLOOR + DOOR_H, c, c + GATE_T / 2)];
   const ajar = [sideBox(side, f0, f1, FLOOR, FLOOR + DOOR_H, inner - GATE_T, inner - GATE_T / 2), sideBox(side, f0, f1, FLOOR, FLOOR + DOOR_H, inner - GATE_T / 2, inner)];
   const gateBox = collider(sideBox(side, -d, d, FLOOR, FLOOR + DOOR_H, H - T, H));
   const gatePos = [[0, 0, -c], [c, 0, 0], [0, 0, c], [-c, 0, 0]][side].map((v, i) => i === 1 ? FLOOR + DOOR_H / 2 : v);

   const has = (list, id) => !!list && list.includes(id);
   const locked = st => !!room.gate && !has(st.unlocked, room.id);
   const keyHere = st => !!room.key && !has(st.taken, room.id);
   const switchHere = st => !!room.switch && !has(st.pressed, room.switch);
   const chestShut = st => !!room.chest && !has(st.opened, room.id);

   let drawn = null;
   const view = {
      floor: { min: floor.slice(0, 3), max: floor.slice(3) },
      colliders: st => locked(st) ? [...solid, gateBox] : solid,
      // What the mini can still use here: a taken key, a pressed switch, an opened chest and an unlocked gate are gone.
      things: st => [
         keyHere(st) && { what: 'key', at: [KX, SPOT.key.y, KZ], size: SPOT.key.size },
         switchHere(st) && { what: 'switch', at: [SX, SPOT.switch.y, SZ], size: SPOT.switch.size },
         chestShut(st) && { what: 'chest', at: [CX, SPOT.chest.y, CZ], size: SPOT.chest.size },
         locked(st) && { what: 'gate', at: gatePos, size: SPOT.gate.size },
      ].filter(Boolean),
      // Show the state. The parts are only placed again when something they show has changed.
      update(st, { roofed = true } = {}) {
         const pressed = (room.switch && has(st.pressed, room.switch)) || false, staked = !!room.anchor && !has(st.pressed, room.anchor);
         const sig = [roofed, keyHere(st), pressed, chestShut(st), locked(st), staked].join();
         if (sig === drawn) return;
         drawn = sig;
         place(roof, [-H, WALL, -H, H, WALL + ROOF_T, H], roofed);
         stake.forEach((n, i) => place(n, stakeBoxes[i], staked && roofed));   // planted in the roof, so it goes when the roof does
         keyNodes.forEach((n, i) => place(n, keyBoxes()[i], keyHere(st)));
         if (button) place(button, buttonBox(pressed));
         if (lid) { place(lid, lidBox(!chestShut(st))); place(gold, goldBox, goal && !chestShut(st)); }
         leaves.forEach((n, i) => place(n, (locked(st) ? shut : ajar)[i]));
      },
   };
   return view;
}
