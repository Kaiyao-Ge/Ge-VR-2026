// oscillator: a target that sweeps over the stage mat (state out; point an input at `gaze_hit` to swap it for the gaze).
const time = input('time', 'state', 'time');
const target = output('target', 'state', 'vec3');
const S = state({ phase: 0 });

time.on(({ dt }) => {
   S.phase += dt * 1.;
   target.set([Math.sin(S.phase) * .15, 0, Math.cos(S.phase * .7) * .12]);
});
