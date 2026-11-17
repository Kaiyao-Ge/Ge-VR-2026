// The bus of Rails in Clay: the band under the cards, a plug at the bottom edge of each card with its drop line and connector dot, and the
// pulses that run along the bus when a card publishes. All the numbers are in busView.js (pure, tested in Node); this file puts them in
// nodes. No canvas and no text: the scene's seven textures are untouched.
//
// Clay pays for every drawn node every frame and uploads a mesh's vertices again whenever the mesh drawn is not the one drawn just before.
// So the drawn nodes are few and grouped by mesh, under holders in this order: the bus (ONE mesh, made when the workspace changes), the
// plugs (one small mesh, a node each), the drop lines and the pulses (the same 8-sided tube, one node each), the solid dots, the rings.
// A card's nodes are made the first time a card needs them and then reused (a card that goes is hidden, not removed); the pulses
// likewise, at most 60. What does not move is not touched: a card's nodes are placed again only when its card, its plug state or the
// workspace changes (while its plug is held, each frame the gaze moves), and a frame with no pulse and no change does no node work.
//
// createBus(node) -> {update(ws, view, t), stats, dispose()}:
//   ws    the workspace (a new object makes the meshes and places everything again);
//   view  the IDE's view: `slots` ([{slot, id, state: {unplugged}} | null], a slot without an id has no plug), `rails` (variable -> {seq,
//         tail, pubs, subs}), `plugGrab` ({card, over} or null), `ray` (the gaze) and `gaze.plug` (the slot of the plug under the gaze or in
//         hand: that plug is drawn bigger and bright, "press now to grab");
//   t     seconds, any clock that does not go back;
//   stats counts for the tests: nodes made, `drawn`, plugged, unplugged, the card in hand, the card whose plug is highlighted and the pulses.
import { SLOTS, BUS, frameMatrix, cylPoint } from './layout.js';
import { NodePool } from './pool.js';
import { rad } from './geom.js';
import { unlit } from './glyphs.js';
import { mix } from '../../render/core/cg.js';
import { DROP_R, PLUG_FRONT, DOT_FRONT, DOT_R, RING_R, PULSE_R, PULSE_FRONT, PULSE_MIN, PULSE_MAX, Pulses,
   busRibbon, plugTriangles, discTriangles, ringTriangles, connectorOf, heldEnd, hueRgb } from './busView.js';

const TUBE = 'tubeZ8';
const RADIUS = 1.25;
const WHITE = [1, 1, 1];
const BUS_LOOK = [[[0.5, 0.5, 0.5], 0.5], [[0.72, 0.72, 0.72], 0.8], [[1, 1, 1], 1]];     // grey; lighter while a plug is held; white when the gaze is on the bus
const PLUG = [0.84, 0.89, 0.96], PLUG_HI = [1, 0.86, 0.3], PLUG_GROW = 1.6, LINE = [0.55, 0.75, 0.95], DOT = [0.5, 0.85, 1], RED = [1, 0.33, 0.28], HANGING = [0.62, 0.5, 0.52];

const clay = () => globalThis.clay ?? globalThis.window?.clay;
let counter = 0;
// A triangle mesh of [x, y, z, nx, ny, nz] vertices made in Clay under a name of its own (nothing without Clay: Node has none).
export function defineTriangles(name, vertices) {
   const c = clay();
   if (!c || !c.defineMesh) return;
   const mesh = new Float32Array(vertices.flatMap(v => c.vertexArray(v.slice(0, 3), v.slice(3, 6))));
   mesh.isTriangles = true;
   c.defineMesh(name, mesh);
}
export const freeMesh = name => { const c = clay(); if (c && c.formMesh) delete c.formMesh()[name]; };
const kids = n => n.children || n._children || [];
// The nodes below n that are drawn: not hidden, nor below a hidden one, and with a mesh of their own.
export const drawn = n => (n.ignore ? 0 : ((n.form || n._form) ? 1 : 0) + kids(n).reduce((a, c) => a + drawn(c), 0));

export function createBus(node) {
   const root = node.add();
   root.ignore = true;                                       // until there is a workspace
   const id = counter++, meshes = [];
   let created = 0;
   const named = key => { const n = `railsBus${key}_${id}`; meshes.push(n); return n; };
   const make = (parent, form) => { created++; return parent.add(form).dull(); };
   const ribbonMesh = named('Ribbon'), plugMesh = named('Plug'), dotMesh = named('Dot'), ringMesh = named('Ring');
   defineTriangles(plugMesh, plugTriangles()); defineTriangles(dotMesh, discTriangles(DOT_R)); defineTriangles(ringMesh, ringTriangles(RING_R[0], RING_R[1]));

   const holder = () => { created++; return root.add(); };
   const ribbonH = holder(), plugH = holder(), lineH = holder(), pulseH = holder(), dotH = holder(), ringH = holder();
   const ribbon = make(ribbonH, ribbonMesh);
   const plugs = new NodePool(plugH, p => make(p, plugMesh).color(unlit(PLUG)).opacity(1));
   const lines = new NodePool(lineH, p => make(p, TUBE));
   const pulses = new NodePool(pulseH, p => make(p, TUBE));
   const dots = new NodePool(dotH, p => make(p, dotMesh));
   const rings = new NodePool(ringH, p => make(p, ringMesh).color(unlit(RED)).opacity(1));

   const trail = new Pulses();
   // What is drawn for each slot now (to touch a node only when this changes): the card, whether it is plugged, and the held end's place.
   const shown = SLOTS.map(() => ({ id: null, dirty: false, plugged: true, held: false, over: null, yaw: NaN, height: NaN, targeted: false }));
   const plugLook = [unlit(PLUG), unlit(PLUG_HI)];             // the plug's colour, normal and under the gaze
   const ids = SLOTS.map(() => null);                        // the plugged card of each slot (the connectors the pulses may use)
   const tinted = trail.slots.map(() => 0);                  // the serial of the pulse each pooled node is coloured for
   let placed = null, busLook = -1, held = null, targeted = null, plugged = 0, unplugged = 0, pulsesShown = 0;
   const yawOf = card => { for (let i = 0; i < ids.length; i++) if (ids[i] === card) return rad(SLOTS[i]); return null; };

   // The card of slot i in its look: the plug, the line and the dot or ring; the held plug's line ends at the gaze.
   function paintCard(ws, i, card, grab, ray, isTarget) {
      const s = shown[i], isPlugged = !card.state.unplugged, isHeld = !!grab && grab.card === card.id;
      const over = isHeld ? !!grab.over : null, h = isHeld ? heldEnd(ws, ray) : null;
      const yaw = h ? h.yaw : NaN, height = h ? h.height : NaN;
      if (!s.dirty && s.id === card.id && s.plugged === isPlugged && s.held === isHeld && s.over === over && Object.is(s.yaw, yaw) && Object.is(s.height, height) && s.targeted === isTarget) return;
      s.id = card.id; s.dirty = false; s.plugged = isPlugged; s.held = isHeld; s.over = over; s.yaw = yaw; s.height = height; s.targeted = isTarget;
      const c = connectorOf(ws, i, isPlugged && !isHeld), slotYaw = rad(SLOTS[i]);      // (a held plug with no gaze hangs)
      const plugM = frameMatrix(ws, slotYaw, c.plug[1] - ws.eyeY, RADIUS - PLUG_FRONT);
      if (isTarget) for (let k = 0; k < 11; k++) if (k % 4 !== 3) plugM[k] *= PLUG_GROW;                  // (the plug under the gaze is bigger: its three axes)
      plugs.take(i).setMatrix(plugM).color(plugLook[isTarget ? 1 : 0]);
      // Where the line ends, and whether the dot there is solid: held, at the gaze, solid over the bus and a ring elsewhere.
      const end = h ? h.end : c.line[1], solid = isHeld ? over : isPlugged;
      const endYaw = h ? h.yaw : slotYaw, endHeight = end[1] - ws.eyeY;
      const colour = isHeld ? (over ? WHITE : mix(RED, WHITE, 0.35)) : isPlugged ? LINE : HANGING;
      lines.take(i).placeLimb(c.line[0], end, isHeld ? DROP_R * (over ? 1.8 : 1.4) : DROP_R).color(unlit(colour)).opacity(isHeld ? 1 : 0.9);
      const at = frameMatrix(ws, endYaw, endHeight, RADIUS - DOT_FRONT);
      if (solid) { dots.take(i).setMatrix(at).color(unlit(isHeld ? WHITE : DOT)).opacity(1); rings.hide(i); }
      else { rings.take(i).setMatrix(at); dots.hide(i); }
   }

   function hideCard(i) {
      const s = shown[i];
      if (s.id === null) return;
      s.id = null; plugs.hide(i); lines.hide(i); dots.hide(i); rings.hide(i);
   }

   function paintPulses(ws) {
      let n = 0;
      trail.slots.forEach((p, i) => {
         if (!p.alive) { pulses.hide(i); return; }
         const dir = p.to >= p.from ? 1 : -1, len = Math.min(Math.max(Math.abs(p.head - p.tail), PULSE_MIN / RADIUS), PULSE_MAX);
         const node = pulses.take(i).placeLimb(cylPoint(ws, p.head - dir * len, BUS.y, RADIUS - PULSE_FRONT), cylPoint(ws, p.head, BUS.y, RADIUS - PULSE_FRONT), PULSE_R);
         if (tinted[i] !== p.serial) { tinted[i] = p.serial; node.color(unlit(mix(hueRgb(p.variable), WHITE, 0.35))); }      // (the hue is set when the pulse is new; only the fade changes after)
         node.opacity(p.alpha);
         n++;
      });
      pulsesShown = n;
   }

   return {
      update(ws, view, t) {
         const ok = !!ws && Number.isFinite(t);
         if (root.ignore === ok) root.ignore = !ok;
         if (!ok) return;
         const v = view && typeof view === 'object' ? view : {}, slots = Array.isArray(v.slots) ? v.slots : [], rails = v.rails && typeof v.rails === 'object' ? v.rails : null;
         const grab = v.plugGrab && typeof v.plugGrab === 'object' ? v.plugGrab : null;
         if (ws !== placed) {
            placed = ws;
            defineTriangles(ribbonMesh, busRibbon(ws));
            for (const s of shown) s.dirty = true;
         }
         const look = grab ? (grab.over ? 2 : 1) : 0;
         if (look !== busLook) { busLook = look; ribbon.color(unlit(BUS_LOOK[look][0])).opacity(BUS_LOOK[look][1]); }
         held = null; targeted = null; plugged = 0; unplugged = 0;
         const aimed = v.gaze && Number.isInteger(v.gaze.plug) ? v.gaze.plug : -1;
         for (let i = 0; i < SLOTS.length; i++) {
            const card = slots[i];
            if (!card || typeof card.id !== 'string' || !card.state) { ids[i] = null; hideCard(i); continue; }
            paintCard(ws, i, card, grab, v.ray, i === aimed);
            if (i === aimed) targeted = card.id;
            ids[i] = card.state.unplugged ? null : card.id;
            if (card.state.unplugged) unplugged++; else plugged++;
            if (grab && grab.card === card.id) held = card.id;
         }
         if (rails) for (const k in rails) trail.observe(k, rails[k], yawOf, t);
         else if (trail.seen.size) trail.seen.clear();
         if (pulsesShown || trail.alive) { trail.step(t); paintPulses(ws); }
      },
      get stats() {
         return { nodes: created, drawn: root.ignore ? 0 : drawn(root), plugged, unplugged, held, targeted, pulses: { pooled: pulses.size, shown: pulsesShown } };
      },
      dispose() {
         for (const n of meshes) freeMesh(n);
         node.remove(root);
      },
   };
}
