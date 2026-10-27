// Off the main thread: depth frames fuse into the volume, and on request the
// volume becomes a mesh and a room. Messages in: { t: 'reset', centre },
// { t: 'frame', points, origin }, { t: 'clear', p }, { t: 'mesh' }. Out: { t: 'ack' } per frame,
// { t: 'room', room (with its mesh and grid), stats, sample } per mesh.
import { Volume } from './tsdf.js';
import { meshRoom } from './scan.js';
import { gridFromVolume } from './paths.js';

let volume = null, fuseMs = 0, frames = 0, clear = [];
onmessage = ({ data: m }) => {
   if (m.t === 'reset') { volume = new Volume(m.centre); fuseMs = frames = 0; clear = []; return; }
   if (m.t === 'clear') { clear.push(m.p); return; }   // where the player stood: no furniture there
   if (m.t === 'frame') {
      const t0 = performance.now();
      volume?.integrate(m.points, m.origin);
      fuseMs += performance.now() - t0; frames++;
      postMessage({ t: 'ack' });
      return;
   }
   if (m.t === 'mesh' && volume) {
      const t0 = performance.now(), mesh = volume.mesh(), t1 = performance.now();
      const room = mesh.indices.length ? meshRoom(mesh, clear) : null;
      if (room) room.grid = gridFromVolume(volume, room);   // the room's shape, for the sound's ways round and the moths
      const stats = { points: volume.points, tris: mesh.indices.length / 3, fuseMs: +(fuseMs / Math.max(1, frames)).toFixed(1), meshMs: Math.round(t1 - t0), roomMs: Math.round(performance.now() - t1) };
      // A sample of the surface, for the test build's log.
      const sample = [], P = mesh.positions, N = mesh.normals, step = Math.max(1, Math.floor(P.length / 3 / 30000));
      for (let v = 0; v < P.length / 3; v += step) sample.push(P[3 * v], P[3 * v + 1], P[3 * v + 2], N[3 * v], N[3 * v + 1], N[3 * v + 2]);
      postMessage({ t: 'room', room, stats, sample }, room ? [room.mesh.vertices.buffer, room.mesh.indices.buffer] : []);
   }
};
