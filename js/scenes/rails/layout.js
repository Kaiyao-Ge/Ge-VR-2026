// Where things are, as pure geometry: the cylinder of cards around the seated head, the bus and the plugs
// below them, the bus window, the stage mat on the desk, and what the head-gaze ray hits. Model frame:
// metres, y up, the user faces -z at yaw 0; angles in the API are radians and yaw is positive to the right.
// Slots are given in degrees (as in the plan) and kept that way in SLOTS. All heights that leave this module
// are relative to the eye, so a `height` of -0.40 is the bus whatever the person's height. Nothing reads a clock.
//
// The workspace is frozen when it is made (and again on re-centre): `workspace(head)` copies
// what it needs, so a head that walks away cannot drag the cards or the stage mat with it.

import { subtract, dot } from '../../render/core/cg.js';
import { rad, wrap, yawOf } from './geom.js';

export const RADIUS = 1.25;
export const SLOTS = [-50, -25, 0, 25, 50];
export const CARD = { w: 0.5, h: 0.5, px: 640, cols: 32, rows: 12 };

export const CARD_DROP = 0.02;                // the card centre sits this far below the eye
const FOCUS_MARGIN = rad(4);                  // a focused card's hit rect grows this much all round
export const MAT_SIZE = 0.40;                 // the stage mat's side, metres: the stage, the pointer's range and the gaze's landing all use it
const MAT = { half: MAT_SIZE / 2, right: 0.45, ahead: 0.10 };

// The text canvas, in pixels of the 640 px card (1280 px per metre).
export const GRID = { ppm: CARD.px / CARD.w, header: 64, footer: 96, adv: 17.4, line: 40 };
GRID.padX = (CARD.px - CARD.cols * GRID.adv) / 2;

// The three text sizes of a card (spec 4), from the nearest (26 columns) to the farthest (40). The advance is 0.6 of the font; the left margin
// (GRID.padX) is the same for all, and the rows are what fit the 480 px of the code area (between the 64 px header and the 96 px footer).
// Index 1 is the grid above, and the one a card starts with. The code area is 480 px high: line * rows = 480 for each.
export const ZOOMS = [
   { cols: 26, font: 36, adv: 21.6, line: 48, rows: 10 },
   { cols: 32, font: 29, adv: 17.4, line: 40, rows: 12 },
   { cols: 40, font: 23, adv: 13.8, line: 32, rows: 15 },
];
export const ZOOM_DEFAULT = 1;

// ---- workspace ----

// Position, yaw and eye height of a head matrix (column-major, model frame). The yaw comes from
// the forward (-z) axis flattened onto the floor; when the head looks nearly straight up or down
// that is meaningless, so the up axis (which then points along the old forward) is used instead.
export function workspace(head) {
   let fx = -head[8], fz = -head[10];
   if (Math.hypot(fx, fz) < 1e-3) {
      const s = head[9] > 0 ? 1 : -1;                                       // looking down (forward.y < 0): the up axis points ahead; looking up: behind
      fx = s * head[4]; fz = s * head[6];
   }
   return { origin: [head[12], head[13], head[14]], yaw: yawOf(fx, fz), eyeY: head[13] };
}

const finiteRay = ray => !!ray && ray.o.every(Number.isFinite) && ray.d.every(Number.isFinite);

// Where a ray meets the cylinder (the far intersection, in front of the ray). Returns the yaw
// relative to the workspace, the pitch seen from the eye, the height above the eye, and `t`, the distance along the ray.
export function yawPitchOf(ws, ray) {
   if (!finiteRay(ray)) return null;                                        // tracking loss gives NaN, which must hit nothing
   const ox = ray.o[0] - ws.origin[0], oz = ray.o[2] - ws.origin[2];
   const a = ray.d[0] * ray.d[0] + ray.d[2] * ray.d[2];
   if (a < 1e-12) return null;                                              // parallel to the axis
   const b = ox * ray.d[0] + oz * ray.d[2], c = ox * ox + oz * oz - RADIUS * RADIUS;
   const disc = b * b - a * c;
   if (disc < 0) return null;
   const t = (-b + Math.sqrt(disc)) / a;
   if (t < 0) return null;                                                  // the cylinder is behind the ray
   const height = ray.o[1] + t * ray.d[1] - ws.eyeY;
   return { yaw: wrap(yawOf(ox + t * ray.d[0], oz + t * ray.d[2]) - ws.yaw), pitch: Math.atan2(height, RADIUS), height, t };
}

// The point on the cylinder at `yaw` (radians relative to the workspace) and `height` metres above the eye (below it is negative).
export function cylPoint(ws, yaw, height, radius = RADIUS) {
   const a = ws.yaw + yaw;
   return [ws.origin[0] + radius * Math.sin(a), ws.eyeY + height, ws.origin[2] - radius * Math.cos(a)];
}

// A frame (x right, y up, z towards the centre of the cylinder) at yaw and height, for text and flat things; column-major.
export function frameMatrix(ws, yaw, height, radius = RADIUS) {
   const a = ws.yaw + yaw, p = cylPoint(ws, yaw, height, radius);
   return [Math.cos(a), 0, Math.sin(a), 0, 0, 1, 0, 0, -Math.sin(a), 0, Math.cos(a), 0, p[0], p[1], p[2], 1];
}

// The rectangle on the cylinder, in (yaw, pitch) radians relative to the workspace, of a flat quad `w` wide tangent at the centre line `yaw`,
// from the height `bottom` to `top` (metres above the eye): its half width in yaw is atan(w / 2R).
function rectOf(yaw, w, top, bottom) {
   const half = Math.atan2(w / 2, RADIUS);
   return { yaw, yaw0: yaw - half, yaw1: yaw + half, pitch0: Math.atan2(bottom, RADIUS), pitch1: Math.atan2(top, RADIUS) };
}

// ---- cards ----

// A card's rectangle on the cylinder (rectOf), and `pitch` of its centre.
export function cardRect(slot) {
   const mid = -CARD_DROP;
   return { slot, pitch: Math.atan2(mid, RADIUS), ...rectOf(rad(SLOTS[slot]), CARD.w, mid + CARD.h / 2, mid - CARD.h / 2) };
}

const inRect = (h, r, m) => Math.abs(wrap(h.yaw - (r.yaw0 + r.yaw1) / 2)) <= (r.yaw1 - r.yaw0) / 2 + m &&
                            h.pitch >= r.pitch0 - m && h.pitch <= r.pitch1 + m;

// The occupied slot the gaze is on, or null. The focused card's rect is 4 degrees bigger, and
// it wins where it overlaps a neighbour, so a gaze that wanders off its edge does not steal focus.
export function hitCard(ws, ray, slots, focused) {
   const h = yawPitchOf(ws, ray);
   if (!h) return null;
   if (focused != null && slots.includes(focused) && inRect(h, cardRect(focused), FOCUS_MARGIN)) return focused;
   for (const s of slots) if (inRect(h, cardRect(s), 0)) return s;
   return null;
}

// Centre of text cell (col, row) in card-local metres (origin at the card centre, x right, y up).
// The cursor quad is drawn at the cell's left edge, x - GRID.adv / 2 / GRID.ppm.
export function cell(col, row) {
   return { x: (GRID.padX + (col + 0.5) * GRID.adv - CARD.px / 2) / GRID.ppm,
            y: (CARD.px / 2 - (GRID.header + (row + 0.5) * GRID.line)) / GRID.ppm };
}

// The same for a card at the zoom z (one of ZOOMS): col counts from the first visible column.
export function cellAt(z, col, row) {
   return { x: (GRID.padX + (col + 0.5) * z.adv - CARD.px / 2) / GRID.ppm,
            y: (CARD.px / 2 - (GRID.header + (row + 0.5) * z.line)) / GRID.ppm };
}

// The frame of a slot (as frameMatrix), and the world position of the point (x, y) in card-local metres on a frame.
const slotFrame = (ws, slot) => frameMatrix(ws, rad(SLOTS[slot]), -CARD_DROP);
const onFrame = (m, p) => [m[12] + m[0] * p.x, m[13] + p.y, m[14] + m[2] * p.x];

// ---- the bus, the plugs and the bus window ----

// The bus is one horizontal band under the cards: `y` metres below the eye, across `from` to `to` degrees of yaw (at the cards' radius).
export const BUS = { y: -0.40, from: -62, to: 62 };
// The bus window: a flat panel `radius` out, its centre `drop` below the eye, `px` pixels for its canvas.
export const BUS_WINDOW = { w: 0.90, h: 0.56, radius: 1.0, drop: 0.05, px: [1024, 640] };
const PLUG_BELOW = 0.03;                      // the plug hangs this far below the card's bottom edge
export const PLUG_TOL = rad(5);               // the gaze gets onto a plug within this, in yaw and in pitch
export const PLUG_LEAVE = rad(7);             // and, once on it, stays on it until it is beyond this (the IDE keeps that state)
const BUS_TOL = rad(1.5);                     // and on the bus within this of its height

// The plug of a slot: in card-local metres (x right, y up from the card centre) and as the gaze sees it ({ yaw, pitch } in radians).
export function plugCell(slot) {
   if (!Number.isInteger(slot) || slot < 0 || slot >= SLOTS.length) return null;
   const y = -CARD.h / 2 - PLUG_BELOW;
   return { x: 0, y, yaw: rad(SLOTS[slot]), pitch: Math.atan2(y - CARD_DROP, RADIUS) };
}
export const plugWorld = (ws, slot) => onFrame(slotFrame(ws, slot), plugCell(slot));

// Whether the gaze is on the plug of `slot`: within `tol` (5 degrees unless told) in yaw and in pitch.
export function plugAt(ws, ray, slot, tol = PLUG_TOL) {
   const c = plugCell(slot), h = c && yawPitchOf(ws, ray);
   return !!h && Math.abs(wrap(h.yaw - c.yaw)) <= tol && Math.abs(h.pitch - c.pitch) <= tol;
}

// Whether the gaze is on the bus: within 1.5 degrees of its height, and inside its yaw range.
export function onBus(ws, ray) {
   const h = yawPitchOf(ws, ray);
   if (!h) return false;
   const yaw = h.yaw * 180 / Math.PI;
   return Math.abs(h.pitch - Math.atan2(BUS.y, RADIUS)) <= BUS_TOL && yaw >= BUS.from && yaw <= BUS.to;
}

// The bus window's frame (as frameMatrix) centred at `yaw`, and where a ray meets it in canvas pixels [x, y] (y down), or null when it
// misses the panel (or looks away from it). `m` is the frame when the caller has it already.
export const busWindowFrame = (ws, yaw) => frameMatrix(ws, yaw, -BUS_WINDOW.drop, BUS_WINDOW.radius);
// Where a ray meets the panel: { t, point, px } (the distance along the ray, the world point and the canvas pixel), or null as above.
export function busWindowHit(ws, yaw, ray, m = busWindowFrame(ws, yaw)) {
   if (!finiteRay(ray)) return null;
   const z = [m[8], m[9], m[10]], d = ray.d[0] * z[0] + ray.d[1] * z[1] + ray.d[2] * z[2];
   if (d > -1e-9) return null;                                              // z points at the user: a ray that goes away from the user has d < 0
   const t = ((m[12] - ray.o[0]) * z[0] + (m[13] - ray.o[1]) * z[1] + (m[14] - ray.o[2]) * z[2]) / d;
   if (t <= 0) return null;
   const point = [ray.o[0] + t * ray.d[0], ray.o[1] + t * ray.d[1], ray.o[2] + t * ray.d[2]];
   const q = [point[0] - m[12], point[1] - m[13], point[2] - m[14]];
   const x = q[0] * m[0] + q[1] * m[1] + q[2] * m[2], y = q[0] * m[4] + q[1] * m[5] + q[2] * m[6];
   const [w, h] = BUS_WINDOW.px, px = (x / BUS_WINDOW.w + 0.5) * w, py = (0.5 - y / BUS_WINDOW.h) * h;
   return px >= 0 && px < w && py >= 0 && py < h ? { t, point, px: [px, py] } : null;
}
export function busWindowPixel(ws, yaw, ray, m) {
   const hit = busWindowHit(ws, yaw, ray, m);
   return hit && hit.px;
}

// ---- stage mat ----

// The mat's frame (column-major): x right, y up, z towards the user. Its centre is 0.45 m to the
// right and 0.10 m ahead of the workspace origin's floor point, at desk height. Only the frozen
// workspace goes in, so it does not follow the head.
export function stageFrame(ws, deskY) {
   const s = Math.sin(ws.yaw), c = Math.cos(ws.yaw);
   const right = [c, 0, s], ahead = [s, 0, -c];
   return [right[0], 0, right[2], 0,  0, 1, 0, 0,  -ahead[0], 0, -ahead[2], 0,
           ws.origin[0] + MAT.right * right[0] + MAT.ahead * ahead[0], deskY, ws.origin[2] + MAT.right * right[2] + MAT.ahead * ahead[2], 1];
}

// Where the ray meets the mat: { t, point, local } (the distance along the ray, the world point, and the mat coordinates [x, 0, z]
// in metres), or null when it misses the desk or lands off the 0.40 m mat.
export function deskTrace(ray, stage) {
   if (!finiteRay(ray)) return null;
   const y = stage[13];
   if (Math.abs(ray.d[1]) < 1e-9) return null;
   const t = (y - ray.o[1]) / ray.d[1];
   if (t <= 0) return null;
   const point = [ray.o[0] + t * ray.d[0], y, ray.o[2] + t * ray.d[2]];
   const d = subtract(point, [stage[12], stage[13], stage[14]]);
   const x = dot(d, [stage[0], stage[1], stage[2]]), z = dot(d, [stage[8], stage[9], stage[10]]);
   return Math.abs(x) <= MAT.half + 1e-12 && Math.abs(z) <= MAT.half + 1e-12 ? { t, point, local: [x, 0, z] } : null;
}
export function deskHit(ray, stage) {
   const hit = deskTrace(ray, stage);
   return hit && hit.local;
}
