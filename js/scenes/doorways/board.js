// The board of Doorways in the table's frame (the scene puts this node at the table's
// frame, origin at the middle of the top): the water the rooms float on, the grid
// lines of the 3 x 3 cells, the pads of the two depot slots, and the entrance hall,
// the one fixed room: a half cell of floor with walls on its north, south and west
// and no roof, open on the east towards cell c3, where the mini starts.
import { CELL, GRID, ROOM, DEPOT, ENTRANCE, slotCentre } from './rules.js';
import { PALETTE } from './rooms.js';

const { FLOOR, WALL, T } = ROOM;
const WATER = [.12, .35, .55], LINES = [.7, .85, .95], PAD = [.35, .4, .45];
const DEPTH = .004, GROOVE = .003, MARGIN = .02;   // how thick the water is, how wide a grid line is, how far the water reaches past the cells

export function createBoard(node) {
   const fill = (n, b) => n.identity().move((b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2).scale((b[3] - b[0]) / 2, (b[4] - b[1]) / 2, (b[5] - b[2]) / 2);
   const part = (colour, b) => fill(node.add('cube'), b).color(colour).dull();

   // The water under the 3 x 3 cells, with a line along each cell border.
   const R = GRID * CELL / 2;
   part(WATER, [-R - MARGIN, 0, -R - MARGIN, R + MARGIN, DEPTH, R + MARGIN]);
   for (let i = 0; i <= GRID; i++) {
      const at = -R + i * CELL;
      part(LINES, [at - GROOVE / 2, DEPTH, -R, at + GROOVE / 2, DEPTH + .0005, R]);
      part(LINES, [-R, DEPTH, at - GROOVE / 2, R, DEPTH + .0005, at + GROOVE / 2]);
   }

   // A pad on the table for each depot slot: where a spare room is set down.
   for (const slot of DEPOT) {
      const [x, , z] = slotCentre(slot);
      part(PAD, [x - CELL / 2, 0, z - CELL / 2, x + CELL / 2, DEPTH, z + CELL / 2]);
   }

   // The entrance hall: floor and three walls, as parts and as boxes in the table frame.
   const [cx] = slotCentre(ENTRANCE), x0 = cx - CELL / 4, x1 = cx + CELL / 4, z0 = -CELL / 2, z1 = CELL / 2;
   const floor = [x0, 0, z0, x1, FLOOR, z1];
   const walls = [[x0, FLOOR, z0, x1, WALL, z0 + T], [x0, FLOOR, z1 - T, x1, WALL, z1], [x0, FLOOR, z0 + T, x0 + T, WALL, z1 - T]];
   const boxes = [floor, ...walls];
   part(PALETTE.floor, floor);
   walls.forEach(b => part(PALETTE.wall, b));

   return {
      // Nothing on the board changes while it is played.
      update() {},
      entrance: {
         colliders: boxes.map(b => ({ min: b.slice(0, 3), max: b.slice(3) })),
         floor: { min: floor.slice(0, 3), max: floor.slice(3) },
      },
   };
}
