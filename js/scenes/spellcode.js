import * as cg from '../render/core/cg.js';
import { controllerMatrix, buttonState, joyStickState } from '../render/core/controllerInput.js';
import { BLOCKS, COLLECTOR, Game, nearestEnemy, raySphere } from './spellcode/game.js';
import { Session } from './spellcode/session.js';
import { GameAudio } from './spellcode/audio.js';
import { makePanel, drawIDE, drawHUD, buttonAt, pickButtonHit } from './spellcode/panels.js';

let cleanup;
export const init = async (model, ctx = {}, ctxForever = {}) => {
   ctxForever.spellcodeCleanup?.();
   const game = new Game();
   const params = new URLSearchParams(location.search);
   const room = (params.get('spellcodeRoom') || '').trim().slice(0, 24).toUpperCase();
   const channel = 'spellcode_' + encodeURIComponent(room);
   const ui = { room, mode: 'select', role: 'select', editorOpen: false,
      selectedSlot: { parent: 0, index: 1 },
      selectedNode: null, moving: false, scroll: 0, hover: null,
      paused: false, pauseReason: '', xr: false, waiting: false };
   let session = null;
   const arena = model.add();
   const sound = new GameAudio(position => cg.mTransform(arena.getGlobalMatrix(), position));
   const effects = [], enemies = new Map(), drops = new Map(), textures = [];
   const ide = makePanel(1024, 1024), hud = makePanel(1024, 512);
   const editor = arena.add(), dashboard = arena.add().move(0, 2.65, -3.5);
   const gl = window.clay.gl, canvas = gl.canvas;
   const disposers = [];
   let anchor = null, wasXR = null, wasGrip = false, editorPose = null;
   const wasHeld = { left: false, right: false }, captured = { left: false, right: false };
   let mouse = null, mouseHeld = false, mouseTap = false, paintIn = 0, live = true;
   let dragging = null, dragIn = 0, wheelPull = 0;
   let audioFocused = true;

   const mesh = (parent, form, position, size, color) =>
      parent.add(form).move(position).scale(size).color(color).dull();
   const cyan = [.24, .9, .84], dark = [.018, .03, .045], gold = [1, .69, .29];
   // Narrow the framework's thick torus without adding a shader or extra draws.
   if (!window.clay.formMesh('spellcodeRing')) {
      const ring = window.clay.formMesh('torusZ').slice();
      for (let i = 0; i < ring.length; i += 16) {
         const radius = Math.hypot(ring[i], ring[i + 1]);
         const scale = (1 + (radius - 1) * .1) / radius;
         ring[i] *= scale; ring[i + 1] *= scale; ring[i + 2] *= .1;
      }
      window.clay.defineMesh('spellcodeRing', ring);
   }
   // Opaque low-poly architecture: no full-screen bloom or moving camera effects.
   mesh(arena, 'cube', [0, -.16, -4], [6, .14, 8], dark);
   mesh(arena, 'cube', [0, -.012, -4], [2.45, .012, 6.8], [.035, .057, .076]);
   for (let i = 0; i < 12; i++) {
      const z = 2 - i * 1.1;
      mesh(arena, 'cube', [0, .005, z], [5.8, .003, .008], [.075, .12, .15]);
      for (const side of [-1, 1]) {
         mesh(arena, 'cube', [side * 2.5, .012, z], [.018, .008, .36], [.10, .42, .43]);
         if (i > 2) mesh(arena, 'cube', [side * .26, .018, z], [.18, .005, .025], [.10, .28, .30])
            .turnY(side * -.55);
      }
   }
   for (const side of [-1, 1]) {
      mesh(arena, 'cube', [side * 5.7, .12, -4], [.18, .25, 7.7], [.055, .09, .12]);
      mesh(arena, 'cube', [side * 5.48, .35, -4], [.025, .012, 7.7], [.16, .57, .57]);
      for (let i = 0; i < 5; i++) {
         const z = -1 - i * 2.6, height = 1.7 + (i % 3) * .6;
         mesh(arena, 'cube', [side * 6.2, height, z], [.55, height, .5], [.035, .06, .09]);
         mesh(arena, 'cube', [side * 5.63, height, z + .3], [.018, height * .65, .06], [.09, .30, .36]);
         mesh(arena, 'cube', [side * 6.2, height * 2, z], [.65, .08, .6], [.08, .13, .18]);
      }
   }
   // The back wall and repeated portals give the arena a readable vanishing point.
   mesh(arena, 'cube', [0, 4, -14], [10, 5, .2], [.016, .025, .045]);
   for (let i = 0; i < 3; i++) {
      const z = -8 - i * 2.3, tint = [.10 - i * .02, .34 - i * .06, .39 - i * .06];
      for (const side of [-1, 1]) {
         mesh(arena, 'cube', [side * 4.3, 2.8, z], [.20, 2.8, .24], [.06, .085, .12]);
         mesh(arena, 'cube', [side * 4.07, 2.8, z + .25], [.035, 2.7, .025], tint);
      }
      mesh(arena, 'cube', [0, 5.5, z], [4.5, .20, .24], [.06, .085, .12]);
      mesh(arena, 'cube', [0, 5.27, z + .25], [4.1, .025, .025], tint);
   }
   const gate = arena.add().move(0, 2.3, -13.7);
   mesh(gate, 'spellcodeRing', [0, 0, 0], [1.45, 1.45, 1], [.12, .25, .30]);
   const gateRing = mesh(gate, 'spellcodeRing', [0, 0, .12], [1.23, 1.23, .6], [.24, .65, .65]);
   mesh(gate, 'octahedron', [0, 0, .1], [.48, .7, .18], [.14, .33, .38]);
   mesh(arena, 'torusY', [0, .025, 0], [1, .025, 1], [.10, .25, .28]);
   const coreLights = [];
   for (let i = 0; i < 5; i++) {
      const a = (i - 2) * .48, x = Math.sin(a) * 1.18, z = -.1 + Math.cos(a) * .75;
      mesh(arena, 'cube', [x, .08, z], [.14, .08, .18], [.07, .11, .14]);
      coreLights.push(mesh(arena, 'cube', [x, .165, z], [.10, .008, .13], cyan));
   }
   const collector = mesh(arena, 'spellcodeRing', COLLECTOR.position,
      [COLLECTOR.radius, COLLECTOR.radius, .6], cyan);
   mesh(arena, 'spellcodeRing', COLLECTOR.position, [.51, .51, .8], [.07, .18, .22]);
   mesh(arena, 'cube', [-.8, .25, -1.86], [.025, .25, .025], [.12, .27, .30]);
   mesh(arena, 'cube', [-.8, .035, -1.86], [.33, .025, .22], [.07, .15, .18]);
   for (let i = 0; i < 16; i++)
      mesh(arena, 'octahedron', [Math.sin(i * 13.7) * 7, 2 + (i % 7) * .42, -9 - i % 3],
         .015, [.12, .24, .29]);

   function surface(parent, panel, w, h) {
      mesh(parent, 'cube', [0, 0, -.013], [w + .012, h + .012, .012], [.025, .065, .095]);
      for (const side of [-1, 1])
         mesh(parent, 'cube', [side * (w + .016), h - .06, 0], [.003, .06, .004], cyan);
      const node = parent.add('square').scale(w, h, 1).dull().setTxtr(panel.canvas);
      const channel = node._txtr;
      gl.activeTexture(gl.TEXTURE0 + channel);
      const texture = gl.getParameter(gl.TEXTURE_BINDING_2D);
      textures.push({ channel, texture, canvas: panel.canvas });
      return node;
   }
   const editorFace = surface(editor, ide, .34, .34);
   const hudFace = surface(dashboard, hud, 1.65, .825);
   const dockLabel = makePanel(512, 96);
   dockLabel.ctx.fillStyle = '#101e29'; dockLabel.ctx.fillRect(0, 0, 512, 96);
   dockLabel.ctx.fillStyle = '#83e9d9'; dockLabel.ctx.font = '500 29px sans-serif';
   dockLabel.ctx.textAlign = 'center';
   dockLabel.ctx.fillText('CODE INTAKE', 256, 38);
   dockLabel.ctx.font = '22px sans-serif'; dockLabel.ctx.fillStyle = '#cedbe4';
   dockLabel.ctx.fillText('RELEASE BLOCK INSIDE', 256, 73);
   surface(arena.add().move(-.8, .56, -1.8), dockLabel, .39, .073);
   const guns = {};
   for (const hand of ['left', 'right']) {
      const color = hand === 'left' ? [.66, .48, 1] : cyan;
      const gun = arena.add();
      mesh(gun, 'cube', [0, -.035, .01], [.03, .04, .10], [.045, .075, .12]);
      mesh(gun, 'cube', [0, -.095, .045], [.025, .055, .033], [.075, .095, .13]).turnX(-.2);
      mesh(gun, 'cube', [0, .012, -.065], [.045, .032, .12], [.17, .23, .28]);
      mesh(gun, 'cube', [0, .05, -.055], [.016, .006, .075], color);
      for (const side of [-1, 1]) {
         mesh(gun, 'cube', [side * .047, .012, -.08], [.004, .012, .075], color);
         mesh(gun, 'cube', [side * .04, -.025, -.16], [.012, .02, .06], [.08, .12, .16]);
      }
      mesh(gun, 'tubeZ', [0, 0, -.1], [.018, .018, .12], [.10, .26, .32]);
      const muzzle = mesh(gun, 'torusZ', [0, 0, -.23], [.03, .03, .014], color);
      const charge = mesh(gun, 'cube', [0, .049, .045], [.028, .006, .009], cyan);
      guns[hand] = { gun, muzzle, charge, color,
         pointer: mesh(arena, 'sphere', [0, 0, 0], .008, color),
         beam: mesh(arena, 'tubeZ', [0, 0, 0], .001, color) };
   }

   function listen(target, event, handler) {
      target.addEventListener(event, handler, true);
      disposers.push(() => target.removeEventListener(event, handler, true));
   }
   function drag(action, ray, pull = 0) {
      if (dragging === null) return;
      if (session) session.command({ kind: 'drag', action, id: dragging, ray, pull });
      else game.drag(action, dragging, ray, pull, 'editor');
      if (action === 'release' || action === 'cancel') { dragging = null; wheelPull = 0; }
   }
   function cancel() {
      sound.stop();
      drag('cancel');
      game.cancel();
      mouseHeld = false;
      mouseTap = false;
      captured.left = captured.right = true;
   }
   function toggleEditor() {
      ui.editorOpen = !ui.editorOpen;
      editorPose = null;
      cancel(); // Never fire while entering/leaving the editor.
      paintIn = 0;
   }
   function pause(reason = 'Take your time. Resume when ready.') {
      if (ui.mode === 'coop' && ui.role === 'editor' || game.phase !== 'playing') return;
      ui.paused = true;
      ui.pauseReason = reason;
      cancel();
      paintIn = 0;
   }
   function chooseRole(role) {
      if (ui.mode === 'select') {
         if (role === 'debug') {
            ui.mode = 'debug';
            ui.role = 'editor';
            for (const block of BLOCKS) game.inventory[block.type] = 99;
         } else if (room && (role === 'shooter' || role === 'editor')) {
            ui.mode = 'coop';
            ui.role = role;
            window.server.init(channel, {}, { accumulate: true });
            session = new Session(game, { room, role,
               id: () => window.clientID, clients: () => window.clients || [],
               connected: () => window.server.socket?.readyState === 1,
               send: message => window.server.send(channel, message) });
            pumpNetwork();
         } else return;
      } else if (ui.mode === 'debug' && (role === 'shooter' || role === 'editor')) {
         if (ui.role === role) return;
         ui.role = role;
         if (game.phase === 'playing') pause('Role changed. Resume when ready.');
      } else return;
      ui.editorOpen = ui.role === 'editor';
      editorPose = null;
      cancel();
      paintIn = 0;
   }
   function action(id) {
      if (!id) return;
      sound.unlock();
      if (id === 'sound') {
         if (sound.label !== 'ENABLE SOUND') sound.cycleVolume();
         paintIn = 0; return;
      }
      if (id.startsWith('role:')) { chooseRole(id.slice(5)); return; }
      if (ui.mode === 'select') return;
      const edit = operation => {
         if (ui.role !== 'editor') return;
         if (ui.mode === 'debug') game.edit(operation, 'editor');
         else session.command({ kind: 'edit', operation });
      };
      if (id.startsWith('slot:')) {
         const [, parent, index] = id.split(':');
         const slot = { parent: Number(parent), index: Number(index) };
         if (ui.moving && ui.selectedNode) {
            edit({ kind: 'move', id: ui.selectedNode, ...slot });
            ui.moving = false;
         } else ui.selectedSlot = slot;
      } else if (id.startsWith('node:')) {
         ui.selectedNode = Number(id.slice(5));
      } else if (id.startsWith('add:')) {
         edit({ kind: 'add', type: id.slice(4), ...ui.selectedSlot });
      } else if (id === 'delete' && ui.selectedNode) {
         edit({ kind: 'delete', id: ui.selectedNode }); ui.selectedNode = null;
         ui.selectedSlot = { parent: 0, index: 0 };
      } else if (id === 'cycle' && ui.selectedNode) {
         edit({ kind: 'cycle', id: ui.selectedNode });
      } else if (id === 'move' && ui.selectedNode) {
         ui.moving = !ui.moving;
      } else if (id.startsWith('scroll:')) {
         ui.scroll = Math.max(0, ui.scroll + Number(id.slice(7)) * 5);
      } else if (id === 'collect' && ui.mode === 'debug' && ui.role === 'editor') {
         // ponytail: debug shortcut for occluded drops; co-op requires beam dragging.
         drag('cancel');
         for (const item of game.loot) game.inventory[item.type]++;
         game.loot.length = 0;
      } else if (id === 'pause' && (ui.mode === 'debug' || ui.role === 'shooter')) {
         if (ui.paused) { ui.paused = false; ui.pauseReason = ''; }
         else pause();
      } else if (id === 'action' && ui.paused) {
         ui.paused = false;
         ui.pauseReason = '';
      } else if (id === 'editor' || id === 'action' && game.phase === 'playing') {
         toggleEditor();
      } else if (id === 'action') {
         if (ui.role === 'editor' || session?.waiting) return;
         if (game.phase === 'won' || game.phase === 'lost') {
            game.reset();
            if (ui.mode === 'debug') for (const block of BLOCKS) game.inventory[block.type] = 99;
            ui.selectedSlot = { parent: 0, index: 1 };
            ui.selectedNode = null;
         }
         game.startWave();
         ui.paused = false;
         ui.editorOpen = false;
         cancel();
         session?.publish();
      }
      paintIn = 0;
   }
   function updateMouse(e) {
      const r = canvas.getBoundingClientRect();
      mouse = [(e.clientX - r.left) / r.width * 2 - 1, 1 - (e.clientY - r.top) / r.height * 2];
   }
   listen(canvas, 'pointermove', e => { if (!ui.xr) updateMouse(e); });
   listen(canvas, 'pointerdown', e => {
      sound.unlock();
      if (ui.xr || e.button !== 0) return;
      updateMouse(e);
      mouseHeld = true;
      mouseTap = true; // Preserve a quick click even between slow preview frames.
      e.preventDefault();
      e.stopImmediatePropagation();
   });
   // The framework also listens to mouse events for camera dragging.
   for (const event of ['mousedown', 'mousemove', 'mouseup'])
      listen(canvas, event, e => {
         if (!ui.xr && (event !== 'mousemove' || mouseHeld)) e.stopImmediatePropagation();
      });
   listen(window, 'pointerup', e => { if (e.button === 0) mouseHeld = false; });
   listen(canvas, 'wheel', e => {
      if (!ui.xr && dragging !== null) {
         wheelPull = Math.max(-.3, Math.min(.3, wheelPull + e.deltaY * .002));
         e.preventDefault();
      }
   });
   listen(canvas, 'pointerleave', () => { mouse = null; mouseHeld = false; mouseTap = false; });
   listen(window, 'keydown', e => {
      sound.unlock();
      if (ui.xr || /INPUT|TEXTAREA|SELECT/.test(e.target?.tagName) || e.target?.isContentEditable) return;
      if (e.repeat) return;
      let id;
      if (e.key === 'Enter') id = 'action';
      if (e.key.toLowerCase() === 'p') id = 'pause';
      if (e.key === 'Tab') id = 'editor';
      if (e.key === '1' && (ui.mode === 'select' && room || ui.mode === 'debug')) id = 'role:shooter';
      if (e.key === '2' && (ui.mode === 'select' && room || ui.mode === 'debug')) id = 'role:editor';
      if (e.key === '3' && ui.mode === 'select') id = 'role:debug';
      if (id) { action(id); e.preventDefault(); e.stopImmediatePropagation(); }
   });
   listen(window, 'blur', () => { audioFocused = false; cancel(); pause('Focus lost. Resume when ready.'); });
   listen(window, 'focus', () => { audioFocused = true; pumpNetwork(); });
   listen(document, 'visibilitychange', () => {
      if (document.hidden) { cancel(); pause('Session interrupted. Resume when ready.'); }
      pumpNetwork();
   });

   function pumpNetwork() {
      if (!live || !session || !session.connected()) return;
      const receive = (messages, sender) => {
         for (const message of Object.values(messages)) session.receive(message, sender);
      };
      window.server.sync(channel, receive);
      session.networkTick(ui.paused || document.hidden);
      // send() only enqueues: flush this heartbeat without waiting for a frame.
      window.server.sync(channel, receive);
   }
   const networkTimer = setInterval(pumpNetwork, 100);
   disposers.push(() => clearInterval(networkTimer));

   function localHead() {
      const view = window.clay.views?.[0];
      return view ? cg.mMultiply(window.clay.inverseRootMatrix, cg.mInverse(view.viewMatrix)) : null;
   }
   function setAnchor(head) {
      const horizontal = [head[8], 0, head[10]];
      const z = cg.norm(horizontal) > .001 ? cg.normalize(horizontal) : [0, 0, 1];
      anchor = [z[2], 0, -z[0], 0, 0, 1, 0, 0, z[0], 0, z[2], 0,
         head[12], head[13] - 1.6, head[14], 1];
      arena.setMatrix(anchor);
      editorPose = null;
   }
   function getRay(hand) {
      let matrix;
      if (ui.xr) {
         if (window.handtracking || controllerMatrix[hand].length !== 16) return null;
         // Same 45-degree beam tilt as ControllerBeam. Convert world -> local
         // exactly once, for both hit testing and the visible gun/reticle.
         const grip = cg.mMultiply(window.clay.inverseRootMatrix, controllerMatrix[hand]);
         matrix = cg.mMultiply(cg.mInverse(anchor), cg.mMultiply(grip,
            cg.mMultiply(cg.mRotateX(-Math.PI / 4), cg.mTranslate(0, .02, 0))));
      } else {
         if (hand === 'left') return null;
         const view = window.clay.views?.[0];
         if (!mouse || !view) return null;
         const p = cg.mTransform(cg.mInverse(view.projectionMatrix), [mouse[0], mouse[1], -1, 1]);
         const direction = cg.normalize(p.slice(0, 3).map(v => v / p[3]));
         matrix = cg.mMultiply(cg.mInverse(anchor), cg.mMultiply(localHead(),
            cg.mAimZ(cg.scale(direction, -1), [1, 0, 0])));
      }
      return { matrix, origin: matrix.slice(12, 15), direction: cg.normalize(cg.scale(matrix.slice(8, 11), -1)) };
   }
   function panelHit(ray, node, panel) {
      const m = cg.mMultiply(cg.mInverse(arena.getGlobalMatrix()), node.getGlobalMatrix());
      const hit = cg.mHitRect(ray.matrix, m);
      if (!hit || !Number.isFinite(hit[2])) return null;
      return { distance: hit[2], id: buttonAt(panel, (hit[0] + 1) / 2 * panel.canvas.width,
         (1 - hit[1]) / 2 * panel.canvas.height) };
   }
   function line(node, a, b, width) {
      node.identity().move(cg.mix(a, b, .5)).aimZ(cg.subtract(a, b))
         .scale(width, width, Math.max(.001, cg.distance(a, b) / 2));
   }
   function pulse(hand, amount, duration) {
      if (!ui.xr) return;
      try { window.vibrate?.(hand, amount, duration); } catch (_) { /* Optional actuator. */ }
   }
   function eventEffect(event) {
      if (event.type === 'shot') {
         const node = arena.add('tubeZ').color(event.hit ? [1, .77, .37] : cyan).dull();
         line(node, event.origin, event.position, .012);
         effects.push({ node, life: .12, total: .12 });
         pulse(event.hand, event.hit ? .35 : .12, 35);
      } else if (event.type === 'kill' || event.type === 'damage') {
         for (let i = 0; i < 6; i++) {
            const a = i * Math.PI / 3;
            const node = mesh(arena, 'octahedron', event.position, .07,
               event.type === 'kill' ? cyan : [1, .22, .28]);
            effects.push({ node, life: .42, total: .42, position: event.position.slice(),
               velocity: [Math.cos(a) * .7, Math.sin(a) * .7, .3] });
         }
         if (event.type === 'damage') { pulse('left', .7, 110); pulse('right', .7, 110); }
      } else if (event.type === 'upgrade') paintIn = 0;
   }
   function remove(node) {
      arena.remove(node);
      // Clay.remove detaches render children but leaves its serialization tree.
      const children = arena.dataTree.children;
      const index = children.indexOf(node.dataTree);
      if (index >= 0) children.splice(index, 1);
   }
   function paint() {
      ui.soundLabel = sound.label;
      drawIDE(ide, game, ui);
      drawHUD(hud, game, ui);
      for (const t of textures) {
         const entry = window._canvas_txtr[t.channel];
         if (entry?.src === t.canvas) entry.counter = 1;
      }
   }
   paint();

   model.animate(() => {
      if (!live) return;
      const dt = Math.max(0, Math.min(model.deltaTime || 0, .05));
      pumpNetwork();
      const head = localHead();
      if (!head) return;
      ui.xr = !!window.isXR?.();
      dashboard.identity().move(ui.xr ? ui.role === 'editor' ? -1.55 : 0 : 1.35, 2.65, -3.5);
      if (!anchor || ui.xr !== wasXR) {
         if (wasXR !== null) pause('Display mode changed. Resume when ready.');
         setAnchor(head);
         wasXR = ui.xr;
      }
      const headPos = cg.mTransform(cg.mInverse(anchor), head.slice(12, 15));
      ui.waiting = session?.waiting || false;
      ui.occupied = session?.occupied || false;
      const gripHeld = ui.xr && !!buttonState.left[1]?.pressed;
      if (gripHeld && !wasGrip && ui.mode !== 'select') toggleEditor();
      wasGrip = gripHeld;
      // Each client creates only its own UI. The editor's full workspace is
      // never transmitted as a world object to the gunner's headset.
      if (ui.editorOpen && !editorPose) {
         const pos = ui.xr
            ? cg.add(headPos, ui.role === 'shooter' ? [-.83, -.12, -1.15] : [.42, -.16, -1.15])
            : [-.48, 1.38, -1.02];
         editor.identity().move(pos).aimZ(cg.subtract(headPos, pos), [1, 0, 0])
            .scale(ui.xr ? ui.role === 'shooter' ? .62 : 1.6 : 1.2);
         editorPose = editor.getMatrix().slice();
      }
      if (editorPose) editor.setMatrix(editorPose);
      editor.opacity(ui.editorOpen ? 1 : .0001);
      if (ui.xr && (window.handtracking || controllerMatrix.right.length !== 16 ||
                    controllerMatrix.left.length !== 16))
         pause('Use two tracked controllers, then resume.');
      const rays = { left: getRay('left'), right: getRay('right') };
      let hit = null;
      if (rays.right) {
         const hits = [panelHit(rays.right, hudFace, hud)];
         if (ui.editorOpen) hits.push(panelHit(rays.right, editorFace, ide));
         const distance = game.phase === 'playing' && ui.role === 'shooter'
            ? nearestEnemy(rays.right, game.enemies).distance : Infinity;
         hit = pickButtonHit(hits, distance);
      }
      if (ui.hover !== hit?.id) { ui.hover = hit?.id; paintIn = 0; }
      const held = { left: ui.xr && !!buttonState.left[0]?.pressed,
         right: ui.xr ? !!buttonState.right[0]?.pressed : mouseHeld || mouseTap };
      mouseTap = false;
      const pickupHand = ui.role === 'editor' ? ui.xr ? 'left' : 'right' : null;
      let lootHit = null, lootDistance = 12;
      if (pickupHand && rays[pickupHand]) for (const item of game.loot) {
         const d = raySphere(rays[pickupHand].origin, rays[pickupHand].direction, item.position, .35);
         if (d !== null && d < lootDistance) { lootHit = item; lootDistance = d; }
      }
      for (const hand of ['right', 'left']) {
         if (!held[hand]) { captured[hand] = false; game.release(hand); }
         if (held[hand] && !wasHeld[hand] && !captured[hand]) {
            sound.unlock();
            if (hand === pickupHand && lootHit && (hand !== 'right' || !hit || lootDistance < hit.distance)) {
               dragging = lootHit.id;
               drag('grab', rays[hand]);
               dragIn = 0;
               pulse(hand, .35, 55);
               captured[hand] = true;
            } else if (hand === 'right' && hit) {
               action(hit.id); captured.right = true; game.cancel('right');
            } else if (ui.role === 'shooter' && !ui.paused && rays[hand])
               game.press(hand);
         }
         if (!rays[hand] || document.hidden || ui.paused || ui.role !== 'shooter') {
            game.cancel(hand);
            if (held[hand]) captured[hand] = true;
         }
         wasHeld[hand] = held[hand];
      }
      if (dragging !== null) {
         const ray = rays[pickupHand];
         if (!ray || document.hidden || ui.waiting || ui.role !== 'editor') drag('cancel');
         else {
            dragIn += dt;
            if (dragIn >= .05 || !held[pickupHand]) {
               const stick = ui.xr ? joyStickState.left.y : 0;
               const pull = Math.max(-.3, Math.min(.3, wheelPull + (Math.abs(stick) > .15 ? stick * 2 * dragIn : 0)));
               drag('move', ray, pull);
               wheelPull = 0; dragIn = 0;
            }
            if (!held[pickupHand]) drag('release');
         }
      }
      const canRun = ui.mode !== 'select' && !ui.paused && !document.hidden;
      const firingRays = { left: captured.left ? null : rays.left,
         right: captured.right ? null : rays.right };
      const events = session ? session.tick(dt, firingRays, !canRun)
         : canRun ? game.tick(dt, firingRays) : game.takeEvents();
      events.forEach(eventEffect);
      const silent = !audioFocused || document.hidden || ui.waiting || ui.mode === 'select';
      const battlePaused = ui.paused || !!session?.paused;
      sound.update(game, { silent, battlePaused, allowDrag: !battlePaused || ui.mode === 'debug' && ui.role === 'editor' }, performance.now() / 1000);
      if (!silent) for (const event of events) {
         if (!battlePaused || event.type === 'compile' || event.type === 'collect')
            sound.event(event, ui.role, editor.getMatrix().slice(12, 15));
      }
      coreLights.forEach((node, i) => node.color(i < game.hp ? cyan : [.18, .055, .065]));
      gateRing.color(game.phase === 'lost' ? [.65, .13, .18] : game.phase === 'won' ? gold : [.24, .65, .65]);

      for (const [id, visual] of enemies) {
         if (!game.enemies.some(e => e.id === id)) { remove(visual.root); enemies.delete(id); }
      }
      for (const enemy of game.enemies) {
         let visual = enemies.get(enemy.id);
         if (!visual) {
            const root = arena.add();
            const shell = mesh(root, 'octahedron', [0, 0, 0], .25, [.90, .16, .23]);
            mesh(root, 'cube', [0, .025, .19], [.17, .075, .035], [.09, .045, .065]);
            mesh(root, 'cube', [0, .03, .23], [.12, .018, .008], [1, .74, .39]);
            for (const side of [-1, 1]) {
               mesh(root, 'octahedron', [side * .22, -.045, 0], [.075, .13, .10], [.40, .065, .12]);
               mesh(root, 'cube', [side * .22, -.13, .025], [.026, .018, .04], [1, .32, .24]);
            }
            mesh(root, 'cube', [0, .36, 0], [.22, .016, .016], [.15, .09, .14]);
            const health = mesh(root, 'cube', [0, .36, .02], [.22, .016, .016], [1, .55, .40]);
            const ring = mesh(root, 'torusY', [0, -.03, 0], [.28, .012, .28], [.48, .11, .19]);
            visual = { root, shell, health, ring };
            enemies.set(enemy.id, visual);
         }
         visual.root.identity().move(enemy.position).turnY(-enemy.angle);
         visual.shell.identity().turnZ(.08 * Math.sin(game.time * 3 + enemy.seed)).scale(.25)
            .color(enemy.hit ? [1, .92, .8] : [.9, .12 + .04 * enemy.maxHP, .23]);
         visual.ring.identity().turnX(.35).turnZ(game.time * .5).scale(.28, .012, .28);
         const fraction = enemy.hp / enemy.maxHP;
         visual.health.identity().move(-.22 * (1 - fraction), .36, .02).scale(.22 * fraction, .016, .016);
      }
      for (const [id, visual] of drops) {
         if (!game.loot.some(item => item.id === id)) { remove(visual); drops.delete(id); }
      }
      for (const item of game.loot) {
         let visual = drops.get(item.id);
         if (!visual) {
            visual = arena.add();
            mesh(visual, 'cube', [0, 0, 0], [.13, .15, .045], [.17, .13, .075]);
            mesh(visual, 'cube', [0, 0, .049], [.105, .125, .006], [.82, .48, .12]);
            for (const side of [-1, 1]) {
               mesh(visual, 'cube', [side * .15, 0, 0], [.012, .11, .025], gold);
               mesh(visual, 'cube', [0, side * .17, 0], [.09, .012, .025], gold);
            }
            const count = BLOCKS.findIndex(b => b.type === item.type) + 1;
            for (let i = 0; i < count; i++)
               mesh(visual, 'cube', [0, (i - (count - 1) / 2) * .038, .059], [.07, .009, .003], [.12, .08, .035]);
            drops.set(item.id, visual);
         }
         visual.identity().move(item.position)
            .turnY(item.held ? 0 : Math.sin(game.time + item.id) * .35)
            .scale(item.held || lootHit?.id === item.id && ui.role === 'editor' ? 1.12 : 1);
      }
      collector.color(game.loot.some(item => item.held && cg.distance(item.position, COLLECTOR.position) <= COLLECTOR.radius)
         ? [1, .85, .35] : cyan);
      for (let i = effects.length - 1; i >= 0; i--) {
         const effect = effects[i];
         effect.life -= dt;
         if (effect.life <= 0) { remove(effect.node); effects.splice(i, 1); continue; }
         effect.node.opacity(effect.life / effect.total);
         if (effect.velocity) {
            effect.position = cg.add(effect.position, cg.scale(effect.velocity, dt));
            effect.node.identity().move(effect.position).turnY(game.time * 4).scale(.065 * effect.life / effect.total);
         }
      }
      for (const hand of ['left', 'right']) {
         const ray = rays[hand], visual = guns[hand], uiHit = hand === 'right' ? hit : null;
         visual.beam.opacity(ray ? .6 : .0001);
         visual.pointer.opacity(ray ? 1 : .0001);
         visual.gun.opacity(ui.xr && ray && ui.role === 'shooter' ? 1 : .0001);
         if (!ray) continue;
         let distance = uiHit?.distance ?? nearestEnemy(ray, game.enemies, 10).distance;
         if (hand === pickupHand && lootHit && (hand !== 'right' || !uiHit || lootDistance < uiHit.distance))
            distance = lootDistance;
         const heldDrop = hand === pickupHand && game.loot.find(item => item.id === dragging);
         if (heldDrop) distance = cg.distance(ray.origin, heldDrop.position);
         const end = cg.add(ray.origin, cg.scale(ray.direction, distance));
         line(visual.beam, cg.add(ray.origin, cg.scale(ray.direction, Math.min(.24, distance))), end,
            uiHit ? .0015 : .0008);
         visual.pointer.identity().move(end).scale(uiHit ? .007 : .012)
            .color(uiHit ? cyan : [1, .77, .37]);
         visual.gun.setMatrix(ray.matrix);
         visual.muzzle.color(game.hands[hand].flash ? [1, .9, .6] : visual.color);
         visual.charge.identity().move(0, .049, .045).scale(.028 * Math.max(.02, game.energy / 100), .006, .009)
            .color(game.energy < 20 ? gold : cyan);
      }
      paintIn -= dt;
      if (paintIn <= 0) { paint(); paintIn = 1 / 20; }
   });

   cleanup = ctxForever.spellcodeCleanup = () => {
      if (!live) return;
      live = false;
      sound.dispose();
      drag('cancel');
      session?.send('leave');
      if (session) window.server.sync(channel, () => {});
      game.cancel();
      disposers.forEach(dispose => dispose());
      for (const t of textures) {
         if (window._canvas_txtr[t.channel]?.src === t.canvas) {
            delete window._canvas_txtr[t.channel];
            window.txtrChannel = window.txtrChannel.filter(c => c !== t.channel);
         }
         gl.deleteTexture(t.texture);
      }
      delete ctxForever.spellcodeCleanup;
   };
};

export const deinit = () => { cleanup?.(); cleanup = null; };
