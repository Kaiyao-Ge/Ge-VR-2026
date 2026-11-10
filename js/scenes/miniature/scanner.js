// A scan of the real room with the headset's depth, as Echo Hunt does it (see
// startSweep and depthFrame in echohunt.js): for SCAN_TIME seconds the depth is
// read back every frame and its points go to the fuse worker, which builds a
// volume; afterwards one mesh is asked for, and the room comes back with its
// walls, tables and mesh. Echo Hunt's modules are used as they are.
//
// state: 'idle' (not started), 'scanning', 'meshing' (waiting for the room),
// 'done', or 'failed' (no depth, or nothing was found: note says which).
import { DepthReader } from '../echohunt/depth.js';

export const SCAN_TIME = 12;
const MAX_INFLIGHT = 40;   // frames waiting in the worker (3 MB)

export class Scanner {
   constructor(gl) {
      this.gl = gl;
      this.state = 'idle';
      this.note = '';
      this.reader = null;
      this.worker = null;
      this.room = null;      // the latest room found
      this.fresh = false;    // a room has come that nobody has taken
      this.inflight = 0;     // frames sent to the worker that it has not acknowledged
   }
   // Is the scan under way: the views should wait.
   get busy() { return this.state === 'scanning' || this.state === 'meshing'; }
   // Seconds of scanning left.
   left(now) { return this.state === 'scanning' ? Math.max(0, Math.ceil(this.end - now)) : 0; }

   // Start (or start again) from eye, a point in the model's frame. A scan of another
   // session (one that has ended) is replaced; one of this session is left to finish.
   start(session, eye, now) {
      if (!session || this.busy && this.reader?.session === session) return;
      try {
         if (this.reader?.session !== session) {
            this.reader?.dispose();
            this.reader = new DepthReader(this.gl, session);
            this.reader.session = session;
         }
         this.worker ||= this.startWorker();
      } catch (e) { return this.fail('no depth: ' + e.message); }
      // The volume reaches 2 m below the eye and 1.2 m above it.
      this.worker.postMessage({ t: 'reset', centre: [eye[0], eye[1] - 2, eye[2]] });
      // inflight goes on counting: the worker acknowledges every frame it was sent, this scan's or an earlier one's.
      Object.assign(this, { state: 'scanning', note: '', end: now + SCAN_TIME, frames: 0, tick: 0, asked: false });
   }

   // The session has ended: a scan under way is given up.
   cancel() {
      if (this.busy) this.state = 'idle';
   }

   // The room, once: null if none has come since the last call.
   take() {
      const room = this.fresh ? this.room : null;
      this.fresh = false;
      return room;
   }

   // Every frame in the headset. frame, space: the XR frame and its reference space;
   // eye: where I am in the model's frame; inverse: the model's inverse root matrix.
   update(frame, space, eye, inverse, now) {
      if (!this.busy) return;
      const scanning = now < this.end;
      // Where I stand stays clear of furniture.
      if (this.tick++ % 15 === 0) this.worker.postMessage({ t: 'clear', p: [...eye] });
      if (scanning && this.inflight < MAX_INFLIGHT) {
         try {
            const view = frame?.getViewerPose(space)?.views[0];
            if (view) this.reader.capture(view);
         } catch (e) { return this.fail('no depth: ' + e.message); }
      }
      const M = inverse;
      for (const { points: p, origin } of this.reader.poll()) {
         if (this.inflight >= MAX_INFLIGHT) continue;
         const points = new Float32Array(p.length);
         for (let i = 0; i < p.length; i += 3)
            for (let r = 0; r < 3; r++) points[i + r] = M[r] * p[i] + M[4 + r] * p[i + 1] + M[8 + r] * p[i + 2] + M[12 + r];
         const o = [0, 1, 2].map(r => M[r] * origin[0] + M[4 + r] * origin[1] + M[8 + r] * origin[2] + M[12 + r]);
         this.worker.postMessage({ t: 'frame', points, origin: o }, [points.buffer]);
         this.inflight++;
         this.frames++;
      }
      // One mesh, after the scan: the worker has all the frames before it.
      if (!scanning && !this.asked) {
         this.asked = true;
         this.state = 'meshing';
         this.worker.postMessage({ t: 'mesh' });
      }
   }

   startWorker() {
      const w = new Worker(new URL('../echohunt/fuse.worker.js', import.meta.url), { type: 'module' });
      w.onmessage = ({ data: m }) => {
         if (m.t === 'ack') { this.inflight--; return; }
         if (this.state !== 'meshing') return;
         if (!m.room) return this.fail(this.frames ? 'no room found' : 'no depth');
         this.room = m.room; this.fresh = true; this.state = 'done';
      };
      w.onerror = e => { w.terminate(); this.worker = null; this.inflight = 0; this.fail('scan failed: ' + e.message); };
      return w;
   }

   fail(note) {
      this.state = 'failed';
      this.note = note;
   }

   dispose() {
      this.worker?.terminate();
      this.worker = null;
      this.reader?.dispose();
      this.reader = null;
   }
}
