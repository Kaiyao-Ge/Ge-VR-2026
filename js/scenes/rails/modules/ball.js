// ball: follows the target with an eased chase and knows nothing about who publishes it.
// It rests on the mat (y = its radius), so only x and z chase.
const time = input('time', 'state', 'time');
const target = input('target', 'state', 'vec3');
const S = state({ p: [0, .015, 0] });

time.on(({ dt }) => {
   const goal = target.value;
   if (goal) {                                    // unplugged or no value yet: stay where we are
      const k = 1 - Math.exp(-6 * dt);
      S.p = [S.p[0] + (goal[0] - S.p[0]) * k, .015, S.p[2] + (goal[2] - S.p[2]) * k];
   }
   draw([{ shape: 'sphere', p: S.p, s: .015, color: '#ffb000' }]);
});
