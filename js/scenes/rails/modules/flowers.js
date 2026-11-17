// flowers: plants a flower at the target twice a second, while the target has moved since the last one, and publishes each one as the event `planted`.
// testing the fps problem
const time = input('time', 'state', 'time');
const target = input('target', 'state', 'vec3');
const planted = output('planted', 'event', 'num');
const S = state({ flowers: [], next: 0, count: 0, at: null });
const COLOURS = ['#ff66aa', '#ffdd55', '#99ccff'];

time.on(({ t }) => {
   const spot = target.value;
   if (spot && t >= S.next && (!S.at || Math.hypot(spot[0] - S.at[0], spot[2] - S.at[1]) > .01)) {
      S.next = t + 0.2; S.at = [spot[0], spot[2]];
      S.flowers.push({ p: [spot[0], 0, spot[2]], born: t, c: COLOURS[Math.floor(random() * 3)] });
      if (S.flowers.length > 40) S.flowers.shift();
      S.count++;
      planted.emit(S.count);
   }
   // A flower grows for 1.5 s; its centre rises with its radius so it sits on the mat.
   draw(S.flowers.map(f => {
      const s = .02 * Math.min(1, (t - f.born) / 1.5);
      return { shape: 'sphere', p: [f.p[0], s, f.p[2]], s, color: f.c };
   }));
});
