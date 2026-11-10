// The physical room and table, drawn at their real size. In the player's own
// view they are there for real (passthrough), so only a faint outline of the
// table shows, to check that it lies on the real one. From the avatar's view
// the whole world is 12 times bigger, and they are drawn solid: the table is
// then a 60 x 24 ft field, the room a hall around it.
import * as cg from '../../render/core/cg.js';
import { frame } from './mapping.js';

const IN = .0254;
// The classroom's wooden tables: 60 x 24 inches, 29 inches high. A scanned table has its own size.
export const TABLE = { size: [60 * IN, 24 * IN], height: 29 * IN };
// The room around the table, when nothing better is known.
export const ROOM = { size: [6, 2.7, 6] };

export class World {
   constructor(parent) {
      this.table = { p: [0, TABLE.height, -.7], yaw: 0, size: [...TABLE.size] };
      this.room = parent.add();
      this.room.add('cube').color(.55, .55, .6);   // walls and ceiling, seen from inside
      this.room.add('cube').color(.35, .3, .25);   // floor
      this.scan = null;   // the scanned room's triangles (scanned.js), when there is one, in place of the box room
      this.solid = 0;
      this.tableNode = parent.add();
      this.top = this.tableNode.add('cube').color(.6, .42, .25);
      this.legs = [0, 1, 2, 3].map(() => this.tableNode.add('cube').color(.45, .3, .18));
   }
   // Which views draw it: 'main', 'offscreen' (see camera.js) or both (null).
   view(v) { this.room.view(v); this.tableNode.view(v); return this; }
   // The table's top, centre, turn and size (kept if not given): from a controller laid flat on it, or from the scan.
   setTable(p, yaw, size = this.table.size) { this.table = { p: [...p], yaw, size: [...size] }; }
   // The scanned room, the triangles in Clay's layout (see scanned.js), in place of the
   // box room; null (or none) goes back to the box room. The scene draws it (see scandraw.js).
   setScan(triangles) { this.scan = triangles?.length ? triangles : null; }
   // The table's frame: origin at the middle of the top, x along its length.
   get frame() { return frame(this.table.p, this.table.yaw); }
   // A point on the table top, in table coordinates (x along, z across).
   onTable([x, z]) { return cg.mTransform(this.frame, [x, 0, z]); }
   // The nearest point on the table top, inset by margin.
   clamp(p, margin = 0) {
      const local = cg.mTransform(cg.mInverse(this.frame), p), [w, d] = this.table.size;
      const x = Math.max(-w / 2 + margin, Math.min(w / 2 - margin, local[0]));
      const z = Math.max(-d / 2 + margin, Math.min(d / 2 - margin, local[2]));
      return cg.mTransform(this.frame, [x, 0, z]);
   }
   // Is the point (any height) over the table top, inset by margin?
   contains(p, margin = 0) {
      const local = cg.mTransform(cg.mInverse(this.frame), p), [w, d] = this.table.size;
      return Math.abs(local[0]) <= w / 2 - margin && Math.abs(local[2]) <= d / 2 - margin;
   }
   // solid, from 0 to 1: how much the things are drawn (the avatar's view, or no
   // passthrough); at 0 only the table's outline.
   update(solid) {
      const [w, d] = this.table.size, h = this.table.p[1], t = .03;
      const F = this.frame;
      this.tableNode.setMatrix(F);
      this.top.identity().move(0, -t / 2, 0).scale(w / 2, t / 2, d / 2).opacity(.25 + .75 * solid);
      this.legs.forEach((leg, i) => leg.identity().move((i & 1 ? 1 : -1) * (w / 2 - .05), -h / 2, (i & 2 ? 1 : -1) * (d / 2 - .05))
         .scale(solid ? .025 : 0, h / 2, .025).opacity(solid));
      // The room: centred on the table, the floor at 0.
      const [rx, ry, rz] = ROOM.size;
      this.solid = solid;
      this.room.setMatrix(solid > 0 && !this.scan ? frame([this.table.p[0], 0, this.table.p[2]], this.table.yaw) : cg.mScale(0));
      this.room.child(0).identity().move(0, ry / 2, 0).scale(-rx / 2, ry / 2, rz / 2).opacity(solid);   // turned inside out: its faces face in
      this.room.child(1).identity().move(0, .005, 0).scale(rx / 2 - .01, .005, rz / 2 - .01).opacity(solid);
   }
}
