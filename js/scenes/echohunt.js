// Echo Hunt: a bat in a dark room. Entering, you look round for a few seconds
// while the headset scans the room. Press start and moths flutter unseen for
// 60 seconds, tapping when they hit something; every sound lights the surfaces
// it reaches, and the sonar on your left wrist shows where it found a moth.
// Light the room with your voice or with clicks (held, the left trigger keeps
// clicking), and shoot with the right trigger. Design: doc/hw6-design.md.
import * as cg from '../render/core/cg.js';
import { virtualRoom, roomFromMeshes, buildGeometry, shareable, toWorld } from './echohunt/room.js';
import { Field, listen as hear } from './echohunt/field.js';
import { EchoRenderer, LOOK } from './echohunt/render.js';
import { Audio, clickSound } from './echohunt/audio.js';
import { Game, ROUND, aim } from './echohunt/game.js';
import { Panels, SONAR } from './echohunt/panels.js';
import { Sweep, SCAN_TIME, startHitTests } from './echohunt/scan.js';
import { DepthReader } from './echohunt/depth.js';
import { Paths } from './echohunt/paths.js';
import { buttonState } from '../render/core/controllerInput.js';
import { lcb, rcb } from '../handle_scenes.js';

// Chladni modes (n, m), two semitones apart from 110 Hz.
const MODES = [[1, 2], [1, 3], [2, 3], [1, 4], [3, 4], [2, 5], [3, 5], [1, 5], [4, 5], [2, 7], [3, 7], [5, 6]];
// Desktop test sounds, one frame per 20 ms slot: [low, mid, high, transient].
const ramp = (n, peak) => Array.from({ length: n }, (_, i) => {
   const g = Math.min(1, i / 3, (n - i) / 5);
   return [...peak.map(v => v * g), i === 0 ? .4 : 0];
});
const SYNTH = { Digit2: ramp(35, [.85, .35, .05]), Digit3: [...ramp(11, [.6, .75, .3]), ...ramp(4, [0, 0, 0]), ...ramp(15, [.7, .6, .2])] };

// Held, the left trigger clicks this often (s); a click is drawn this long, the newest three at a time.
const CLICK_EVERY = .35, CLICK_LIFE = 1.2, CLICK_PITCH = .5;

// Window depth of a point the distance d ahead.
const depthAt = (P, d) => .5 + .5 * (P[14] - P[10] * d) / d;


let cleanup;
export const init = async (model, ctx = {}, ctxForever = {}) => {
   ctxForever.echohuntCleanup?.();
   const gl = window.clay.gl, canvas = gl.canvas, disposers = [];
   let live = true;
   const t0 = performance.now(), time = () => (performance.now() - t0) / 1000;
   const xr = () => !!window.isXR?.();
   function listen(target, event, handler) {
      target.addEventListener(event, handler, true);
      disposers.push(() => target.removeEventListener(event, handler, true));
   }

   // The room: a virtual one until the headset's is scanned.
   let room = virtualRoom(), scanned = false, scanKey = '', scanAt = -10, drawn = null;
   const renderer = new EchoRenderer(gl);
   // The ways sound takes round the room's shape; the moths bounce off that shape too.
   const paths = new Paths(g => renderer.setPathGrid(g));
   disposers.push(() => paths.dispose());
   const draw = r => { if (r !== drawn) { drawn = r; renderer.setGeometry(buildGeometry(r)); paths.setRoom(r); } };
   draw(room);
   const game = new Game(room);
   game.solid = p => paths.solid(toWorld(game.room, p));
   window.echohuntDebug = { renderer, paths, gl };   // test build: inspect from the console
   const field = new Field();
   const audio = new Audio(p => cg.mTransform(cg.mInverse(window.clay.inverseRootMatrix), p));
   let micError = '';
   audio.startMic().catch(e => { micError = e.name; console.log('echohunt: no microphone', e.name); });

   const mouthOf = (head, fwd) => {
      const f = cg.normalize([fwd[0], 0, fwd[2]]);
      return [head[0] + f[0] * .08, head[1] - .08, head[2] + f[2] * .08];
   };

   // What every sound looks like.
   let clockPos = [0, 1.95, 0], now = 0;
   function react(ev) {
      if (ev.k === 'tap') {
         // Heard always; drawn for the two nearest at a time.
         field.capped(now, { pos: ev.p, bands: [.3, .8, .5], strength: .6, dur: .02, fall: 6, wrap: 1, life: .6 }, 'tap', 2, p => -cg.distance(p, eye));
         audio.play('tap', ev.p, .4);
      } else if (ev.k === 'catch') {
         field.pulse(now, { pos: ev.p, bands: [.2, .6, 1], strength: .9, dur: .05, fall: 3, wrap: 1, life: 1 });
         audio.play('catch', ev.p);
      } else if (ev.k === 'start') {
         field.pulse(now, { pos: clockPos, bands: [.5, .8, .6], strength: .7, dur: .1, fall: 1.5, wrap: 1, life: 1.5 });
         audio.play('ding', clockPos);
      } else if (ev.k === 'end') {
         field.pulse(now, { pos: clockPos, bands: [1, .7, .4], strength: 1.2, dur: .25, fall: .4, wrap: 1 });
         audio.play('bell', clockPos);
      }
   }

   const emit = ev => { if (ev) react(ev); };
   let head = null, eye = [0, 1.6, 0], fwd = [0, 0, -1], mapUp = null;

   // Actions.
   const asked = new Map();
   function tryCatch(i) {
      if (now - (asked.get(i) ?? -1) < .5) return;
      asked.set(i, now);
      emit(game.catch(i, now));
   }
   // A click from pos towards dir: low carries far and blurs, high shows fine detail close by.
   function click(pos, dir, p = CLICK_PITCH) {
      audio.unlock();
      field.capped(now, { pos, dir, bands: [1 - .9 * p, .5, .1 + .9 * p], fall: .35 * 9 ** p, life: CLICK_LIFE }, 'click', 3, (q, t) => t);
      audio.play(clickSound(p), pos);
   }
   // A round, once the room is scanned.
   let played = false;
   function start() {
      audio.unlock();
      if (sweeping() || game.running) return;
      played = true; mapUp = null;   // the sonar's up: the way I face now
      emit(game.start(now, [eye]));
   }
   const panels = new Panels(model, { onStart: start });

   // Moths: a body and two wings, seen only while a sound passes them; and the
   // last place and time the sound found each, for the sonar.
   const moths = game.moths.map(() => {
      const node = model.add(), body = node.add('sphere').scale(.018, .015, .04);
      const wings = [-1, 1].map(s => node.add().add('sphere').move(s * .042, 0, 0).scale(.045, .004, .03)._parent);
      return { node, body, wings, vis: 0, dir: [0, 0, -1], last: null, found: null };
   });

   // Desktop: K clicks, M turns the microphone on and off, 2/3 are test voices,
   // G shows the room; click a moth to shoot it.
   let micOn = false, gripWas = false, triggerWas = false, nextClick = 0, reveal = 0, mouse = null, downAt = null, widgetActive = false;
   listen(window, 'keydown', e => {
      if (xr() || /INPUT|TEXTAREA/.test(e.target?.tagName) || e.repeat) return;
      audio.unlock();
      if (e.code === 'KeyK') click(mouthOf(eye, fwd), fwd);
      if (e.code === 'KeyG') reveal = 1 - reveal;
      if (e.code === 'KeyM') micOn = !micOn;
      if (SYNTH[e.code]) field.queues[0].push(...SYNTH[e.code].map(f => [...f]));
   });
   const toNDC = e => { const r = canvas.getBoundingClientRect(); return [(e.clientX - r.left) / r.width * 2 - 1, 1 - (e.clientY - r.top) / r.height * 2]; };
   listen(canvas, 'mousedown', e => { audio.unlock(); downAt = [e.clientX, e.clientY]; });
   listen(canvas, 'mouseup', e => {
      if (downAt && !widgetActive && Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) < 6) mouse = toNDC(e);
      downAt = null;
   });
   // Dragging a slider should not turn the view.
   listen(canvas, 'mousemove', e => {
      if (!xr() && widgetActive) { window.mouseX = e.x; window.mouseY = e.y; e.stopImmediatePropagation(); }
   });

   // The scanned room: rebuilt when the headset's meshes change, at most every 2 s.
   function scan() {
      const set = window.detectedMeshes, frame = window.xrFrame;
      if (!set?.size || !frame || now - scanAt < 2) return;
      let key = '' + set.size;
      for (const m of set) key += ',' + m.lastChangedTime;
      if (key === scanKey) return;
      const meshes = [];
      for (const m of set) {
         const pose = frame.getPose(m.meshSpace, window.xrFrameRefSpace);
         if (!pose) continue;
         const M = cg.mMultiply(window.clay.inverseRootMatrix, Array.from(pose.transform.matrix)), P = new Float32Array(m.vertices.length);
         for (let i = 0; i < P.length; i += 3) P.set(cg.mTransform(M, [m.vertices[i], m.vertices[i + 1], m.vertices[i + 2]]), i);
         meshes.push({ label: m.semanticLabel || '', positions: P, indices: m.indices });
      }
      if (!meshes.length) return;
      scanKey = key; scanAt = now;
      takeRoom(roomFromMeshes(meshes));
      console.log('echohunt: scanned room', meshes.map(m => m.label).join(', '), room.scan.mats.length, 'triangles');
   }

   // Without Space Setup, a quick scan. With the headset's depth: 80 x 80 depth
   // samples a frame fuse in a worker into a mesh, redrawn every 1.5 s while
   // scanning for DEPTH_TIME seconds; A scans on, adding to it. Without depth,
   // the sweep: hit tests from the eye for SCAN_TIME seconds; A starts over.
   // It starts by itself in a headset with no meshes. The moths wait for it.
   const DEPTH_TIME = 12;
   let sweep = null, rays = null, sweepEnd = 0, sweepAt = 0, xrAt = -1, aWas = false, frameNo = 0;
   let depth = null, depthFailed = false, fuser = null, inflight = 0, meshing = false, meshAt = 0, depthMode = false, handed = true, scanStats = null;
   // Test build: points (cm, normals x100) and the room to the server log, 8000 characters a message (the console cuts long lines).
   function logPoints(pts) {
      const cm = v => Math.round(v * 100), id = Date.now() % 1e6, text = JSON.stringify({ eye: eye.map(cm), room: shareable(room), pts: pts.map(cm) });
      (async () => { for (let i = 0, n = Math.ceil(text.length / 8000); i < n; i++) {
         const form = new FormData();
         form.append('log', `echohunt-sweep ${id} ${i}/${n} ` + text.slice(i * 8000, (i + 1) * 8000));
         await fetch('/log', { method: 'POST', body: form }).catch(() => {});
      } })();
   }
   // A new room; moths in a round start again in it (the old room's places may be inside its walls).
   function takeRoom(r) {
      room = game.room = r; scanned = true;
      if (game.running) for (const m of game.moths) game.spawn(m, [], now);
   }
   function startFuser() {
      const w = new Worker(new URL('./echohunt/fuse.worker.js', import.meta.url), { type: 'module' });
      w.onmessage = ({ data: m }) => {
         if (!live) return;
         if (m.t === 'ack') { inflight--; return; }
         meshing = false; scanStats = m.stats;
         if (!m.room) { if (now >= sweepEnd) handed = true; return; }
         // While scanning only the drawn room changes; the game takes it when the scan ends.
         if (handed) return;
         if (now < sweepEnd) { takeRoom(m.room); return; }
         handed = true;
         takeRoom(m.room);
         console.log('echohunt: fused room', JSON.stringify(m.stats));
         logPoints(m.sample);
      };
      w.onerror = e => { console.log('echohunt: fuse worker', e.message); depthFailed = true; depthMode = false; };
      disposers.push(() => w.terminate());
      return w;
   }
   function startSweep() {
      const session = window.xrFrame?.session;
      if (!session) return;
      if (!depthFailed && depth?.session !== session) {
         depth?.dispose(); depth = null;
         try { depth = new DepthReader(gl, session); depth.session = session; } catch (e) { depthFailed = true; console.log('echohunt: no depth', e); }
      }
      if (depth && !depthFailed) {
         if (!fuser) { fuser = startFuser(); fuser.postMessage({ t: 'reset', centre: [eye[0], eye[1] - 2, eye[2]] }); }
         depthMode = true; handed = false; sweepEnd = now + DEPTH_TIME; meshAt = now;
         return;
      }
      if (!session.requestHitTestSource || rays === 'starting') return;
      rays?.forEach?.(r => r.cancel());
      rays = 'starting';
      startHitTests(session).then(r => { rays = r; if (r.length) { sweep = new Sweep(); sweepEnd = now + SCAN_TIME; sweepAt = now; } },
         e => { rays = []; console.log('echohunt: no hit test', e); });
   }
   function depthFrame() {
      const scanning = now < sweepEnd, frame = window.xrFrame;
      if (!scanning && handed) return;
      // Every frame while scanning; frames wait in the worker while it meshes, up to 40 (3 MB). Where I stand stays clear.
      if (frameNo % 15 === 0) fuser.postMessage({ t: 'clear', p: [...eye] });
      if (scanning && inflight < 40) {
         const view = frame.getViewerPose(window.xrFrameRefSpace)?.views[0];
         try { if (view) depth.capture(view); } catch (e) { console.log('echohunt: depth', e); depthFailed = true; depthMode = false; return; }
      }
      const M = window.clay.inverseRootMatrix;
      for (const { points: p, origin } of depth.poll()) {
         if (inflight >= 40) continue;
         const points = new Float32Array(p.length);
         for (let i = 0; i < p.length; i += 3)
            for (let r = 0; r < 3; r++) points[i + r] = M[r] * p[i] + M[4 + r] * p[i + 1] + M[8 + r] * p[i + 2] + M[12 + r];
         fuser.postMessage({ t: 'frame', points, origin: cg.mTransform(M, origin) }, [points.buffer]);
         inflight++;
      }
      // One more mesh after the scan ends: the one the game takes.
      if (!meshing && (now - meshAt > 1.5 || !scanning)) { meshing = true; meshAt = now; fuser.postMessage({ t: 'mesh' }); }
   }
   function sweepFrame() {
      frameNo++;
      const a = !!buttonState.right[4]?.pressed;
      if (a && !aWas) startSweep();
      aWas = a;
      if (xrAt < 0) xrAt = now;
      if (!sweep && !rays && !depthMode && !window.detectedMeshes?.size && now - xrAt > 1.5) startSweep();
      if (depthMode) return depthFrame();
      if (!sweeping()) return;
      const frame = window.xrFrame;
      for (const r of rays) {
         const pose = frame.getHitTestResults(r)[0]?.getPose(window.xrFrameRefSpace);
         if (!pose) continue;
         const M = cg.mMultiply(window.clay.inverseRootMatrix, Array.from(pose.transform.matrix)), p = M.slice(12, 15);
         if (cg.distance(p, eye) > .3) sweep.add(p, cg.normalize(M.slice(4, 7)));   // not my own hands
      }
      const done = now >= sweepEnd;
      if (now - sweepAt < 1 && !done) return;
      sweepAt = now;
      const r = sweep.room();
      if (r) takeRoom(r);
      if (done) {
         rays.forEach(r => r.cancel()); rays = [];   // stays an empty list: no second sweep by itself
         console.log('echohunt: swept room', sweep.size, 'points', room.boxes.length, 'boxes');
         logPoints([...sweep.points.values()].flatMap(({ p, n }) => [...p, ...n]));
      }
   }
   const sweeping = () => depthMode ? now < sweepEnd : Array.isArray(rays) && rays.length > 0;
   disposers.push(() => depth?.dispose());

   // In a headset the room is drawn on its own layer with no alpha and no depth:
   // the compositor then can neither blend in the camera nor, when it warps a
   // late frame by depth, tear the room open at its edges.
   let layerSwap = null, layerFailed = false;
   function opaque() {
      const session = window.xrFrame?.session, layers = session?.renderState.layers;
      if (layerFailed || !layers?.length || layers[0] === layerSwap?.layer) return;
      // Again if the framework put its own layer back (as adding an image layer does).
      if (layerSwap?.session !== session) {
         layerSwap = { session, layer: new XRWebGLLayer(session, gl, { alpha: false, ignoreDepthValues: true, framebufferScaleFactor: .8 }), old: layers[0] };
         // Fewer pixels: each costs a march through the sound; 0.8 a side is 64% of them. And fewer towards
         // the edges of the view, where the lenses blur anyway.
         layerSwap.layer.fixedFoveation = 1;
      }
      session.updateRenderState({ layers: [layerSwap.layer, ...layers.slice(1)] });
   }
   disposers.push(() => { if (Array.isArray(rays)) rays.forEach(r => r.cancel()); });
   disposers.push(() => {
      const s = layerSwap?.session, layers = s?.renderState.layers;
      if (layers?.[0] === layerSwap.layer) try { s.updateRenderState({ layers: [layerSwap.old, ...layers.slice(1)] }); } catch (e) {}
   });

   // Test build: can the page read the headset's depth? What it is, and a read of it, once a session.
   let depthProbed = null, binding = null;
   function depthProbe() {
      const frame = window.xrFrame, session = frame.session;
      if (depthProbed === session) return;
      depthProbed = session;
      const out = { usage: session.depthUsage ?? null, format: session.depthDataFormat ?? null, type: session.depthType ?? null };
      const describe = d => d && { w: d.width, h: d.height, toM: d.rawValueToMeters, texType: d.textureType ?? null, index: d.imageIndex ?? null,
         hasData: !!d.data, near: d.depthNear ?? null, far: d.depthFar ?? null, proj: !!d.projectionMatrix, pose: !!d.transform,
         norm: d.normDepthBufferFromNormView ? Array.from(d.normDepthBufferFromNormView.matrix).map(v => +v.toFixed(3)) : null };
      try {
         const view = frame.getViewerPose(window.xrFrameRefSpace)?.views[0];
         out.views = frame.getViewerPose(window.xrFrameRefSpace)?.views.length;
         try { const d = frame.getDepthInformation?.(view); out.cpu = describe(d); if (d?.data) out.cpuMid = d.getDepthInMeters(.5, .5); } catch (e) { out.cpuErr = e.name + ' ' + e.message; }
         try {
            binding ??= new XRWebGLBinding(session, gl);
            const d = binding.getDepthInformation?.(view);
            out.gpu = describe(d);
            if (d?.texture) {
               // Read the depth image itself: attach it to a framebuffer and try each readable format.
               const fb = gl.createFramebuffer(), old = gl.getParameter(gl.FRAMEBUFFER_BINDING);
               gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
               if (d.textureType === 'texture-array' || d.imageIndex != null) gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, d.texture, 0, d.imageIndex ?? 0);
               else gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, d.texture, 0);
               out.fbStatus = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
               out.readFormat = [gl.getParameter(gl.IMPLEMENTATION_COLOR_READ_FORMAT), gl.getParameter(gl.IMPLEMENTATION_COLOR_READ_TYPE)];
               gl.getError();
               for (const [name, fmt, type, Arr] of [['uint', gl.RGBA_INTEGER, gl.UNSIGNED_INT, Uint32Array], ['float', gl.RGBA, gl.FLOAT, Float32Array], ['byte', gl.RGBA, gl.UNSIGNED_BYTE, Uint8Array]]) {
                  const px = new Arr(d.width * d.height * 4);
                  gl.readPixels(0, 0, d.width, d.height, fmt, type, px);
                  if (gl.getError() === 0) {
                     const vals = []; for (let i = 0; i < px.length; i += 4 * 97) vals.push(px[i], px[i + 1]);
                     out.read = { name, sample: vals.slice(0, 24) };
                     break;
                  }
               }
               gl.bindFramebuffer(gl.FRAMEBUFFER, old);
               gl.deleteFramebuffer(fb);
            }
         } catch (e) { out.gpuErr = e.name + ' ' + e.message; }
      } catch (e) { out.err = e.name + ' ' + e.message; }
      out.foveation = session.renderState.layers?.[0]?.fixedFoveation ?? null;
      const form = new FormData();
      form.append('log', 'echohunt-depth ' + JSON.stringify(out));
      fetch('/log', { method: 'POST', body: form }).catch(() => {});
   }

   // Test build: every 5 s, read back the finished frame and log to the server
   // what the compositor gets: how many pixels are not opaque, the layer, fps.
   let reportAt = 0, frames = 0, srcSum = 0;
   function report(sources) {
      frames++; srcSum += sources;
      if (now - reportAt < 5) return;
      const session = window.xrFrame.session, fps = frames / (now - reportAt), srcs = +(srcSum / frames).toFixed(1);
      reportAt = now; frames = 0; srcSum = 0;
      session.requestAnimationFrame(() => {   // runs after this frame's drawing
         const layer = session.renderState.layers?.[0] ?? session.renderState.baseLayer;
         if (!layer?.framebuffer) return;
         const w = layer.framebufferWidth, h = layer.framebufferHeight, px = new Uint8Array(w * h * 4);
         gl.bindFramebuffer(gl.FRAMEBUFFER, layer.framebuffer);
         gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
         let clear = 0, part = 0;
         for (let i = 3; i < px.length; i += 4) if (px[i] === 0) clear++; else if (px[i] < 255) part++;
         const form = new FormData();
         form.append('log', 'echohunt ' + JSON.stringify({ v: 29, srcs, errors, lastError, mic: audio.mic ? 'ok' : 'none ' + micError, scan: scanStats, depthFailed, sweep: sweep?.size ?? null, boxes: room.boxes.length, rays: Array.isArray(rays) ? rays.length : rays, w, h, alpha0: clear, alphaPart: part, fps: +fps.toFixed(1),
            swapped: layer === layerSwap?.layer, layerFailed, layerAlpha: layer.alpha ?? null, ignoreDepth: layer.ignoreDepthValues,
            blend: session.environmentBlendMode, foveation: layer.fixedFoveation ?? null, features: session.enabledFeatures, ctx: gl.getContextAttributes() }));
         fetch('/log', { method: 'POST', body: form }).catch(() => {});
      });
   }

   const chladni = { mode: MODES[0], amount: 0 };
   let errors = 0, lastError = '';
   model.animate(() => {
      if (!live) return;
      now = time();
      const dt = Math.max(0, Math.min(model.deltaTime || 0, .05));
      const view = window.clay.views?.[0];
      if (!view) return;
      head = cg.mMultiply(window.clay.inverseRootMatrix, cg.mInverse(view.viewMatrix));
      eye = head.slice(12, 15); fwd = cg.normalize(head.slice(8, 11).map(v => -v));
      // A frame Clay runs without our drawing shows the camera through: whatever
      // goes wrong in the game, the room is still drawn, and the error logged.
      let sources = [];
      try {
         if (xr()) { scan(); sweepFrame(); }
         draw(room);

         // My voice, from the microphone.
         // Test build: what the microphone hears, shown on the wrist; a sleeping audio context is woken once a second.
         if (audio.state !== 'running' && Math.floor(now) !== Math.floor(now - dt)) audio.unlock();
         // The left grip turns the microphone on and off; it starts off.
         const grip = !!buttonState.left[1]?.pressed;
         if (grip && !gripWas) micOn = !micOn;
         gripWas = grip;
         const mic = micOn && audio.mic ? hear(audio.mic.an, audio.mic.state) : { bands: [0, 0, 0, 0], pitch: 0 };
         field.record(now, mic.bands);
         field.track(0, now, mouthOf(eye, fwd), fwd);
         if (mic.pitch > 0) {
            chladni.mode = MODES[Math.min(MODES.length - 1, Math.max(0, Math.round(6 * Math.log2(mic.pitch / 110))))];
            chladni.amount += (1 - chladni.amount) * .2;
         } else chladni.amount *= .97;

         // The moths.
         // The moths wait while the room is scanned: the old room's moths would be inside the new one's walls.
         if (!sweeping()) game.step(now, dt, [eye]).forEach(emit);
         sources = field.live(now);
         const excess = (a, p) => paths.excess(a, p);
         game.moths.forEach((m, i) => {
            const n = moths[i];
            if (!n) return;
            if (!m.alive || !m.p || sweeping()) { n.vis = 0; n.last = null; n.node.identity().scale(0); return; }
            const pos = game.where(i);
            if (n.last) {
               const d = cg.subtract(pos, n.last);
               if (cg.norm(d) > 1e-4) n.dir = cg.normalize(cg.mix(n.dir, cg.normalize(d), .2));
            }
            n.last = pos;
            const I = field.intensityAt(pos, now, sources, excess, LOOK.falloff);
            n.vis = Math.max(Math.min(1, I * 2.5), n.vis * Math.exp(-dt / 1));   // stays seen for a moment, to reach for it
            if (I * 2.5 > .1) n.found = { p: pos, t: now };
            if (n.vis < .03) n.node.identity().scale(0);
            else {
               const b = n.vis * n.vis;
               n.node.identity().move(pos).aimZ(n.dir);
               for (const part of [n.body, ...n.wings]) part.color([b / 2, b / 2.1, b / 2.2, 0, 0, 0, 0, 0, 0, 1]);
               n.wings.forEach((w, s) => w.identity().turnZ((s ? 1 : -1) * .6 * Math.sin(now * 2 * Math.PI * 22)));
            }
         });

         // The controls.
         const c = cg.mix(room.min, room.max, .5);
         // Above the middle of the room, facing whoever looks at it, so a finger held up to it reaches it.
         clockPos = toWorld(room, [c[0], Math.min(room.max[1] - .3, room.min[1] + 1.95), c[2]]);
         const left = xr() && clientState.hand(window.clientID, 'left');
         const wrist = left ? cg.add(left.slice(12, 15), [0, .09, 0]) : cg.mTransform(head, [-.22, -.14, -.5]);
         // The sonar, fixed to the room: up is the way I faced when the round began
         // (or when I came in), and my triangle turns as I do.
         const f = cg.normalize([fwd[0], 0, fwd[2]]);
         mapUp ||= f;
         const up = mapUp, side = [-up[2], 0, up[0]], k = SONAR.r / SONAR.range;
         const onSonar = p => { const d = cg.subtract(p, eye); return { x: cg.dot(d, side) * k, y: cg.dot(d, up) * k }; };
         const heading = [cg.dot(f, side), cg.dot(f, up)];
         const blips = [];
         game.moths.forEach((m, i) => {
            const fd = moths[i]?.found;
            if (!m.alive || !fd || now - fd.t > 3) return;
            const b = onSonar(fd.p);
            if (Math.hypot(b.x, b.y) < SONAR.r) blips.push({ ...b, a: 1 - (now - fd.t) / 3 });
         });
         const outline = [[room.min[0], room.min[2]], [room.max[0], room.min[2]], [room.max[0], room.max[2]], [room.min[0], room.max[2]]]
            .map(([x, z]) => onSonar(toWorld(room, [x, 0, z]))).map(({ x, y }) => [x, SONAR.y + y])
            .map(([x, y]) => { const r = Math.hypot(x, y - SONAR.y), c = Math.min(1, SONAR.r / r); return [x * c, SONAR.y + (y - SONAR.y) * c]; });
         widgetActive = panels.update({ hits: game.hits, played, micOn, heading, scanning: sweeping() ? Math.ceil(sweepEnd - now) : 0,
            running: game.running, remaining: game.remaining(now), round: ROUND, blips, outline }, eye, wrist, clockPos);

         // Held, the left trigger clicks from the left controller along its beam.
         const leftTrigger = xr() && !!buttonState.left[0]?.pressed;
         if (leftTrigger && now >= nextClick && lcb?.m) {
            const B = cg.mMultiply(cg.mInverse(window.worldCoords), lcb.beamMatrix());
            click(B.slice(12, 15), cg.normalize(B.slice(8, 11).map(v => -v)));
            nextClick = now + CLICK_EVERY;
         }
         if (!leftTrigger) nextClick = 0;

         // Shooting is silent: the right trigger along the controller's beam, or a
         // click on the desktop, hits the nearest seen moth near the ray.
         let ray = null;
         const trigger = xr() && !!buttonState.right[0]?.pressed;
         if (trigger && !triggerWas && !widgetActive && rcb?.m) {
            const B = cg.mMultiply(cg.mInverse(window.worldCoords), rcb.beamMatrix());
            ray = { o: B.slice(12, 15), d: cg.normalize(B.slice(8, 11).map(v => -v)) };
         }
         triggerWas = trigger;
         if (mouse) {
            const p = cg.mTransform(cg.mInverse(view.projectionMatrix), [mouse[0], mouse[1], -1, 1]);
            ray = { o: eye, d: cg.normalize(cg.mTransform(head, [...p.slice(0, 3).map(v => v / p[3]), 0]).slice(0, 3)) };
            mouse = null;
         }
         const hit = ray ? aim(ray, game.moths.map((m, i) => moths[i]?.vis > .1 ? game.where(i) : null)) : null;
         if (hit !== null) tryCatch(hit);

      } catch (e) {
         errors++; lastError = e.message + ' ' + (e.stack?.split('\n')[1]?.trim() || '');
         if (errors === 1) console.error('echohunt:', e);
         sources = field.live(now);
      }

      // The room, as the sound sees it, under everything Clay draws next.
      const R = cg.mInverse(window.clay.inverseRootMatrix);
      const views = window.clay.views.map(v => ({
         viewProj: cg.mMultiply(v.projectionMatrix, cg.mMultiply(v.viewMatrix, R)),
         eye: cg.mMultiply(window.clay.inverseRootMatrix, cg.mInverse(v.viewMatrix)).slice(12, 15),
         viewport: window.clay.views.length > 1 ? [v.viewport.x, v.viewport.y, v.viewport.width, v.viewport.height] : null,
      }));
      renderer.draw(views, { now, field, sources, paths: sources.map(s => paths.field(s.a)), chladni, reveal: sweeping() ? 3 : reveal, maxSteps: xr() ? 12 : 40, lockAlpha: xr(), gapDepth: Math.min(.9999, depthAt(window.clay.views[0].projectionMatrix, 30)) });
      if (xr()) try { opaque(); report(sources.length); depthProbe(); } catch (e) { if (!layerFailed) console.log('echohunt: layer', e); layerFailed = true; }
   });

   cleanup = ctxForever.echohuntCleanup = () => {
      if (!live) return;
      live = false;
      disposers.forEach(d => d());
      renderer.dispose();
      gl.colorMask(true, true, true, true);
      audio.dispose();
      delete ctxForever.echohuntCleanup;
   };
};

export const deinit = () => { cleanup?.(); cleanup = null; };
