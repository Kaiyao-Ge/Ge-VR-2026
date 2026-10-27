// Off the main thread: the room's grid (made here from its boxes, or given,
// fused from depth), and a path field per source asked for.
// In: { t: 'room', gen, room, grid }, { t: 'field', gen, key, src }.
// Out: { t: 'grid', gen, grid }, { t: 'field', gen, key, data }.
import { gridFromBoxes, pathField } from './paths.js';

let grid = null, gen = -1;
onmessage = ({ data: m }) => {
   if (m.t === 'room') {
      gen = m.gen; grid = m.grid || gridFromBoxes(m.room);
      postMessage({ t: 'grid', gen, grid });
   } else if (m.t === 'field' && m.gen === gen && grid) {
      const data = pathField(grid, m.src);
      postMessage({ t: 'field', gen, key: m.key, data }, [data.buffer]);
   }
};
