// A placeholder: a 10 cm cube on the table (a 10 ft block to the avatar).
// From the avatar's view, a hand that touches a face lights it, and the
// trigger while touching changes the cube's colour.
//
// Every table object has this shape (see index.js):
//   create(node) builds it under node, in its own coordinates: metres, base
//   at y = 0, centred on the origin. It returns
//   { bounds: { min, max },    the box a hand or a ray grabs it by in the player's view
//     colliders() -> [{ min, max }],   the boxes the avatar stands on and bumps
//                                      into, in the object's current state
//     update(ctx) }            every frame, with
//   ctx = { mode: 'player' | 'avatar', t, now, dt,
//           hands: [{ hand: 'left' | 'right', p, ray: { o, d }, trigger, pressed, grip, gripPressed }],
//           haptic(hand, strength, ms) }
//   where t is 0 in the player's view and 1 in the avatar's; p and ray are the
//   hand and its ray in the object's coordinates (the avatar's hand in the
//   avatar's view, so 1/12 the size there); trigger and grip are held, pressed
//   and gripPressed are the frame they went down. An object without colliders()
//   is its bounds.
const S = .1, COLOURS = [[.85, .3, .25], [.25, .6, .85], [.95, .8, .25], [.4, .75, .4]];

export function create(node) {
   const body = node.add('cube'), faces = [];
   // A thin plate over each face, lit while a hand touches it.
   for (let a = 0; a < 3; a++) for (const sign of [-1, 1]) faces.push({ a, sign, node: node.add('cube') });
   let colour = 0, touched = new Set();
   const bounds = { min: [-S / 2, 0, -S / 2], max: [S / 2, S, S / 2] };
   return {
      bounds,
      colliders: () => [bounds],
      update({ mode, hands, haptic }) {
         body.identity().move(0, S / 2, 0).scale(S / 2).color(COLOURS[colour]);
         // Touching only counts from the avatar's view: there the hand is small next to the cube.
         const touching = mode === 'avatar' ? hands.filter(h => Math.max(Math.abs(h.p[0]), Math.abs(h.p[1] - S / 2), Math.abs(h.p[2])) < S / 2 + .004) : [];
         // A hand that starts touching it feels it.
         for (const h of touching) if (!touched.has(h.hand)) haptic?.(h.hand, .3, 30);
         touched = new Set(touching.map(h => h.hand));
         if (touching.some(h => h.pressed)) colour = (colour + 1) % COLOURS.length;
         for (const f of faces) {
            const lit = touching.some(h => {
               const q = [h.p[0], h.p[1] - S / 2, h.p[2]];
               return Math.sign(q[f.a]) === f.sign && Math.abs(q[f.a]) >= Math.max(...q.map(Math.abs)) - 1e-9;
            });
            const scale = [S / 2 * .9, S / 2 * .9, S / 2 * .9];
            scale[f.a] = .0005;
            const at = [0, S / 2, 0];
            at[f.a] += f.sign * (S / 2 + .0005);
            f.node.identity().move(at).scale(lit ? scale : [0, 0, 0]).color(1, 1, .85);
         }
      },
   };
}
