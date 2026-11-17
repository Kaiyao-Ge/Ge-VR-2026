// constant: a fixed point (the centre of the mat), set once on the first tick of the clock. It is `center`, not `target`, so that
// nothing else publishes the variable the ball follows.
const time = input('time', 'state', 'time');
const center = output('center', 'state', 'vec3');
const S = state({ done: false });

time.on(() => {
   if (S.done) return;
   S.done = true;
   center.set([0, 0, 0]);
});
