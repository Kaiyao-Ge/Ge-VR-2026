// A few angle and matrix helpers shared by the pure spatial modules (layout, the IDE core, the views); the vector ones come from cg.js. Model frame:
// metres, y up, the user faces -z at yaw 0. Yaw is positive to the user's right (clockwise
// seen from above), so a direction (x, z) has yaw atan2(x, -z). This file imports nothing.

export const rad = d => d * Math.PI / 180;
// Sixteen finite numbers: a 4x4 matrix (an Array or a Float32Array) from the headset or a controller.
export const isMatrix = m => m?.length === 16 && Array.prototype.every.call(m, Number.isFinite);

// Wraps an angle into (-PI, PI] so differences of yaws are the short way round.
export function wrap(a) {
   const t = 2 * Math.PI;
   a = a % t;
   if (a > Math.PI) a -= t;
   else if (a <= -Math.PI) a += t;
   return a;
}

// A hue per rail name, in degrees: a card's bindings (cardDraw) and a variable's pulses (bus3d) take their colour from it.
export const railHue = id => { let h = 0; for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };
export const yawOf = (x, z) => Math.atan2(x, -z);
