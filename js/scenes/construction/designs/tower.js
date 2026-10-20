// Hand-written design for step 2: a four-storey tower with a roof and a gold
// crown, built by four arms whose lifts climb one storey at a time. It is in
// the same format the AI will write (doc/hw5-design.md).
const floors = [0, 1, 2, 3].map(k => ({
   height: .05,
   modules: [
      { id: `f${k}.n`, use: 'wall_long', pos: [0, 0, .07] },
      { id: `f${k}.e`, use: 'wall_short', pos: [.07, 0, 0], turn: 90 },
      { id: `f${k}.s`, use: 'wall_long', pos: [0, 0, -.07], turn: 180 },
      { id: `f${k}.w`, use: 'wall_short', pos: [-.07, 0, 0], turn: -90 },
   ],
}));
// Arms 0..3 stand north, east, south and west; each builds its own wall.
const sides = ['n', 'e', 's', 'w'];
const plan = [];
for (let k = 0; k < 4; k++) for (let a = 0; a < 4; a++) {
   if (k) plan.push({ step: 100 * k + a, arm: a, lift: .05 * k });
   plan.push({ step: 100 * k + 10 + a, arm: a, module: `f${k}.${sides[a]}`, grasp: 90 });
}
const walls = [310, 311, 312, 313];
plan.push(
   { step: 400, arm: 0, lift: .2 }, { step: 402, arm: 2, lift: .2 }, { step: 401, arm: 1, lift: .22 },
   { step: 410, arm: 0, module: 'r.0', grasp: 90, after: walls }, { step: 411, arm: 0, module: 'r.1', grasp: 90 },
   { step: 412, arm: 2, module: 'r.3', grasp: 90, after: [411] }, { step: 413, arm: 2, module: 'r.2', grasp: 90 },
   { step: 420, arm: 1, module: 'crown', after: [413] });

export const TOWER = {
   components: {
      window: {
         params: { w: .03, tint: 'glass' },
         parts: [
            { form: 'cube', pos: [0, 0, 0], scale: ['$w', .012, .0008], color: '$tint' },
            { form: 'cube', pos: [0, .0135, .0005], scale: ['$w', .0015, .0012], color: 'steel' },
         ],
      },
      wall_long: {
         parts: [
            { form: 'cube', pos: [0, .025, 0], scale: [.08, .025, .01], color: 'concrete' },
            { use: 'window', pos: [-.04, .025, .0105] },
            { use: 'window', pos: [.04, .025, .0105] },
         ],
      },
      wall_short: {
         parts: [
            { form: 'cube', pos: [0, .025, 0], scale: [.06, .025, .01], color: 'concrete' },
            { use: 'window', pos: [-.03, .025, .0105], args: { w: .022 } },
            { use: 'window', pos: [.03, .025, .0105], args: { w: .022, tint: 'accent' } },
         ],
      },
      roof_strip: {
         parts: [
            { form: 'cube', pos: [0, .01, 0], scale: [.08, .01, .02], color: 'dark' },
            { form: 'cube', pos: [0, .0205, 0], scale: [.07, .0005, .015], color: 'green' },
         ],
      },
      crown: {
         parts: [
            { form: 'cube', pos: [0, .008, 0], scale: [.02, .008, .02], color: 'gold' },
            { form: 'coneY', pos: [0, .036, 0], scale: [.012, .02, .012], color: 'gold' },
            { form: 'sphere', pos: [0, .06, 0], scale: [.005, .005, .005], color: 'light' },
         ],
      },
   },
   building: {
      name: 'TOWER',
      origin: [0, 0],
      floors: [
         ...floors,
         { height: .02, modules: [.06, .02, -.02, -.06].map((z, i) => ({ id: `r.${i}`, use: 'roof_strip', pos: [0, 0, z] })) },
         { height: .065, modules: [{ id: 'crown', use: 'crown', pos: [0, 0, 0] }] },
      ],
   },
   site: {
      table: [1.4, .9],
      arms: [
         { id: 0, base: [0, .24], yaw: 90 },
         { id: 1, base: [.24, 0], yaw: 180 },
         { id: 2, base: [0, -.24], yaw: -90 },
         { id: 3, base: [-.24, 0], yaw: 0 },
      ],
      trays: [
         { arm: 0, pos: [.13, .17] }, { arm: 1, pos: [.17, -.13] },
         { arm: 2, pos: [-.13, -.17] }, { arm: 3, pos: [-.17, .13] },
      ],
   },
   plan,
};
