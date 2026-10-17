import * as cg from '../render/core/cg.js';
import { controllerMatrix, buttonState } from '../render/core/controllerInput.js';
import { AIQuery } from '../util/aiquery.js';
import { BLOCKS, EYE, Game, nearestEnemy } from './spellcode/game.js';
import { PALETTE } from './spellcode/daemons.js';
import { Root } from './spellcode/root.js';
import { Session } from './spellcode/session.js';
import { GameAudio } from './spellcode/audio.js';
import { makePanel, drawIDE, drawHUD, drawWall, drawPopup, buttonAt, pickButtonHit } from './spellcode/panels.js';

let cleanup;
export const init = async (model, ctx = {}, ctxForever = {}) => {
   ctxForever.spellcodeCleanup?.();
   const game = new Game();
   const params = new URLSearchParams(location.search);
   const room = (params.get('spellcodeRoom') || '').trim().slice(0, 24).toUpperCase();
   const channel = 'spellcode_' + encodeURIComponent(room);
   const ui = { room, mode: 'select', role: 'select', editorOpen: false,
      selectedSlot: { parent: 0, index: 1 }, glyphs: [],
      selectedNode: null, moving: false, scroll: 0, hover: null,
      paused: false, pauseReason: '', xr: false, waiting: false };
   let session = null, root = null;
   // ROOT plans through the classroom AIQuery helper (/api/aiquery).
   const ai = new AIQuery({ timeout: 25000 });
   const ask = async messages => {
      const data = await ai.queryFull('', { messages, response_format: { type: 'json_object' } });
      return JSON.parse(data.message?.content || data.response);
   };
   const arena = model.add();
   // Drawn after the arena, so the blackout layer covers everything in it.
   const shade = model.add('square').color(0, .02, .01).dull().opacity(.0001);
   const sound = new GameAudio(position => cg.mTransform(arena.getGlobalMatrix(), position));
   const effects = [], enemies = new Map(), textures = [];
   const ide = makePanel(1024, 1024), hud = makePanel(1024, 512), wall = makePanel(1024, 256);
   const editor = arena.add(), dashboard = arena.add().move(0, 2.65, -3.5);
   const gl = window.clay.gl, canvas = gl.canvas;
   const disposers = [];
   let anchor = null, wasXR = null, wasGrip = false, editorPose = null, panelOpen = false;
   const wasHeld = { left: false, right: false }, captured = { left: false, right: false };
   let mouse = null, mouseHeld = false, mouseTap = false, paintIn = 0, live = true;
   let audioFocused = true;

   const mesh = (parent, form, position, size, color) =>
      parent.add(form).move(position).scale(size).color(color).dull();
   const cyan = [.24, .9, .84], dark = [.012, .03, .022], gold = [1, .69, .29];
   const green = [.25, 1, .5], red = [1, .16, .2];
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
   // Black machine space: floor grid, three lanes, structural frames.
   mesh(arena, 'cube', [0, -.16, -4], [6, .14, 8], dark);
   for (let i = 0; i < 12; i++) {
      const z = 2 - i * 1.1;
      mesh(arena, 'cube', [0, .005, z], [5.8, .003, .008], [.05, .16, .09]);
      for (const side of [-1, 1]) mesh(arena, 'cube', [side * 2.5, .012, z], [.018, .008, .36], [.10, .42, .25]);
   }
   for (const angle of [-.42, 0, .42])
      mesh(arena, 'cube', [Math.sin(angle) * 5, .01, -Math.cos(angle) * 5], [.025, .006, 4], [.12, .55, .3]).turnY(-angle);
   for (const side of [-1, 1]) {
      mesh(arena, 'cube', [side * 5.7, .12, -4], [.18, .25, 7.7], [.03, .08, .05]);
      for (let i = 0; i < 5; i++) {
         const z = -1 - i * 2.6, height = 1.7 + (i % 3) * .6;
         mesh(arena, 'cube', [side * 6.2, height, z], [.55, height, .5], [.02, .05, .035]);
         mesh(arena, 'cube', [side * 5.63, height, z + .3], [.018, height * .65, .06], [.09, .36, .2]);
      }
   }
   mesh(arena, 'cube', [0, 4, -14], [10, 5, .2], [.01, .025, .016]);
   for (let i = 0; i < 3; i++) {
      const z = -8 - i * 2.3, tint = [.08, .34 - i * .06, .18 - i * .03];
      for (const side of [-1, 1]) mesh(arena, 'cube', [side * 4.07, 2.8, z + .25], [.035, 2.7, .025], tint);
      mesh(arena, 'cube', [0, 5.27, z + .25], [4.1, .025, .025], tint);
   }
   mesh(arena, 'torusY', [0, .025, 0], [1, .025, 1], [.10, .28, .18]);
   const coreLights = [];
   for (let i = 0; i < 5; i++) {
      const a = (i - 2) * .48, x = Math.sin(a) * 1.18, z = -.1 + Math.cos(a) * .75;
      mesh(arena, 'cube', [x, .08, z], [.14, .08, .18], [.05, .09, .07]);
      coreLights.push(mesh(arena, 'cube', [x, .165, z], [.10, .008, .13], cyan));
   }
   // ROOT's eye turns toward the player it is about to attack.
   const eye = arena.add().move(EYE);
   mesh(eye, 'sphere', [0, 0, 0], .95, [.02, .05, .035]);
   const eyeRing = mesh(eye, 'spellcodeRing', [0, 0, .3], [1.2, 1.2, 1], green);
   const iris = eye.add();
   const irisDisk = mesh(iris, 'sphere', [0, 0, .78], [.42, .42, .16], green);
   mesh(iris, 'sphere', [0, 0, .9], [.17, .17, .08], [0, 0, 0]);
   const packet = arena.add();
   mesh(packet, 'sphere', [0, 0, 0], .22, [.01, .01, .01]);
   mesh(packet, 'torusZ', [0, 0, 0], [.3, .3, .06], red);

   function surface(parent, panel, w, h) {
      mesh(parent, 'cube', [0, 0, -.013], [w + .012, h + .012, .012], [.02, .065, .045]);
      const node = parent.add('square').scale(w, h, 1).dull().setTxtr(panel.canvas);
      const channel = node._txtr;
      gl.activeTexture(gl.TEXTURE0 + channel);
      const texture = gl.getParameter(gl.TEXTURE_BINDING_2D);
      textures.push({ channel, texture, canvas: panel.canvas });
      return node;
   }
   const editorFace = surface(editor, ide, .34, .34);
   const hudFace = surface(dashboard, hud, 1.65, .825);
   // Tip board: subtitle position, below the aim corridor and clear of the side console.
   const board = arena.add().move(0, .75, -3).turnX(.28);
   surface(board, wall, .8, .2);
   const popupPanel = makePanel(512, 340);
   drawPopup(popupPanel);
   const popups = [0, 1, 2].map(() => {
      const node = arena.add();
      surface(node, popupPanel, .3, .2);
      return node;
   });
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
   function command(cmd) {
      if (session) session.command(cmd);
      else game.command(cmd, 'editor');
   }
   function cancel() {
      sound.stop();
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
   function makeRoot() {
      root = new Root(game, ask);
      window.spellcodeRootLog = root.records; // Per-wave requests, responses and validation.
   }
   function debugStock() { for (const block of BLOCKS) game.inventory[block.type] = 99; }
   function chooseRole(role) {
      if (ui.mode === 'select') {
         if (role === 'debug') {
            ui.mode = 'debug';
            ui.role = 'editor';
            debugStock();
            makeRoot();
         } else if (room && (role === 'shooter' || role === 'editor')) {
            ui.mode = 'coop';
            ui.role = role;
            if (role === 'shooter') makeRoot();
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
      const edit = operation => { if (ui.role === 'editor') command({ kind: 'edit', operation }); };
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
      } else if (id.startsWith('pick:') && ui.role === 'editor') {
         command({ kind: 'pick', type: id.slice(5) });
      } else if (id === 'glyph:clear') {
         ui.glyphs = [];
      } else if (id.startsWith('glyph:') && ui.role === 'editor') {
         ui.glyphs.push(Number(id.slice(6)));
         if (ui.glyphs.length === 4) { command({ kind: 'unlock', glyphs: ui.glyphs }); ui.glyphs = []; }
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
            if (ui.mode === 'debug') debugStock();
            ui.selectedSlot = { parent: 0, index: 1 };
            ui.selectedNode = null;
         }
         root?.prepare();
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
            const node = mesh(arena, 'octahedron', event.position, .07, event.type === 'kill' ? green : red);
            effects.push({ node, life: .42, total: .42, position: event.position.slice(),
               velocity: [Math.cos(a) * .7, Math.sin(a) * .7, .3] });
         }
         if (event.type === 'damage') { pulse('left', .7, 110); pulse('right', .7, 110); }
      } else paintIn = 0;
   }
   function remove(node) {
      arena.remove(node);
      // Clay.remove detaches render children but leaves its serialization tree.
      const children = arena.dataTree.children;
      const index = children.indexOf(node.dataTree);
      if (index >= 0) children.splice(index, 1);
   }
   function buildDaemon(def) {
      const visual = { root: arena.add(), parts: [], shields: [], size: def.size, faded: false };
      for (const p of def.parts) for (const side of p.mirror ? [1, -1] : [1]) {
         const node = mesh(visual.root, p.form, [p.pos[0] * def.size * side, p.pos[1] * def.size, p.pos[2] * def.size],
            p.scale.map(v => v * def.size), PALETTE[p.color]);
         visual.parts.push(node);
         if (p.tag === 'shield') visual.shields.push(node);
      }
      mesh(visual.root, 'cube', [0, def.size + .1, 0], [.22, .016, .016], [.15, .09, .14]);
      visual.health = mesh(visual.root, 'cube', [0, def.size + .1, .02], [.22, .016, .016], [1, .55, .40]);
      return visual;
   }
   function paint() {
      ui.soundLabel = sound.label;
      drawIDE(ide, game, ui);
      drawHUD(hud, game, ui);
      // Hidden when there is nothing to say.
      board.opacity(drawWall(wall, game, ui.mode === 'debug' ? ui.role !== 'editor' : ui.role === 'shooter') ? 1 : .0001);
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
      // A side console keeps ROOT's eye and the aim corridor clear.
      const side = ui.xr && ui.role === 'editor' ? -1 : 1;
      dashboard.identity().move(side * 2, 2.2, -3).turnY(-side * .59);
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
      // ROOT watches how long the coder keeps the console open.
      if ((ui.role === 'editor' && ui.editorOpen) !== panelOpen) {
         panelOpen = !panelOpen;
         command({ kind: 'panel', open: panelOpen });
      }
      // Each client creates only its own UI. The editor's full workspace is
      // never transmitted as a world object to the gunner's headset.
      if (ui.editorOpen && !editorPose) {
         const pos = ui.xr
            ? cg.add(headPos, ui.role === 'shooter' ? [-.83, -.12, -1.15] : [.42, -.16, -1.15])
            : [-.48, 1.38, -1.02];
         editor.identity().move(pos).aimZ(cg.subtract(headPos, pos))
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
      for (const hand of ['right', 'left']) {
         if (!held[hand]) { captured[hand] = false; game.release(hand); }
         if (held[hand] && !wasHeld[hand] && !captured[hand]) {
            sound.unlock();
            if (hand === 'right' && hit) {
               action(hit.id); captured.right = true; game.cancel('right');
            } else if (ui.role === 'shooter' && !ui.paused && rays[hand])
               game.press(hand);
         } else if (held[hand] && !captured[hand] && !game.hands[hand].held && ui.role === 'shooter' && !ui.paused && rays[hand])
            game.press(hand); // A trigger held through a gun lock resumes once the lock is solved.
         if (!rays[hand] || document.hidden || ui.paused || ui.role !== 'shooter') {
            game.cancel(hand);
            if (held[hand]) captured[hand] = true;
         }
         wasHeld[hand] = held[hand];
      }
      const canRun = ui.mode !== 'select' && !ui.paused && !document.hidden;
      const firingRays = { left: captured.left ? null : rays.left,
         right: captured.right ? null : rays.right };
      const events = session ? session.tick(dt, firingRays, !canRun, headPos)
         : canRun ? game.tick(dt, firingRays, headPos) : game.takeEvents();
      root?.update();
      events.forEach(eventEffect);
      const silent = !audioFocused || document.hidden || ui.waiting || ui.mode === 'select';
      const battlePaused = ui.paused || !!session?.paused;
      sound.update(game, { silent, battlePaused }, performance.now() / 1000);
      if (!silent) for (const event of events) {
         if (!battlePaused || event.type === 'compile') sound.event(event, ui.role, editor.getMatrix().slice(12, 15));
      }
      coreLights.forEach((node, i) => node.color(i < game.hp ? cyan : [.18, .055, .065]));
      if (!game.active('GUN_LOCK')) ui.glyphs = []; // A half-entered code never carries over to the next lock.

      // ROOT's eye looks at you when you are its next target.
      const myTarget = ui.mode === 'debug' || (ui.role === 'shooter' ? 'gunner' : 'coder') === game.root.target;
      const look = game.root.target && myTarget ? headPos : game.root.target ? [3, 1.2, 0]
         : [Math.sin(game.time * .4) * 2, 1.4 + Math.sin(game.time * .7) * .3, 0];
      iris.identity().aimZ(cg.subtract(look, EYE));
      const exposed = game.root.exposed > 0;
      irisDisk.color(exposed ? (Math.sin(game.time * 20) > 0 ? gold : [1, 1, 1]) : game.root.target ? red : green);
      eyeRing.color(game.phase === 'lost' ? red : game.phase === 'won' ? gold : game.root.target ? red : green);
      if (game.packet) packet.identity().move(game.packet.position).turnZ(game.time * 6);
      else packet.identity().move(0, -50, 0);
      popups.forEach((node, i) => {
         const p = game.popups[i];
         node.identity().move(p ? p.position : [0, -50, 0]);
      });
      // Head-locked blackout: 0.1 s fade in, 0.8 s hold, 0.3 s fade out.
      const shown = ui.mode === 'debug' || ui.role === 'shooter';
      const elapsed = 1.2 - game.blackout;
      const alpha = !shown || game.blackout <= 0 ? 0 : elapsed < .1 ? elapsed / .1 * .92 : elapsed < .9 ? .92 : game.blackout / .3 * .92;
      shade.setMatrix(cg.mMultiply(head, cg.mMultiply(cg.mTranslate(0, 0, -.12), cg.mScale(.6, .6, 1))));
      shade.opacity(Math.max(.0001, alpha));

      for (const [id, visual] of enemies) {
         if (!game.enemies.some(e => e.id === id)) { remove(visual.root); enemies.delete(id); }
      }
      for (const enemy of game.enemies) {
         let visual = enemies.get(enemy.id);
         if (!visual) enemies.set(enemy.id, visual = buildDaemon(game.defs[enemy.kind]));
         visual.root.identity().move(enemy.position).turnY(-enemy.angle).scale(enemy.hit ? 1.12 : 1);
         const faded = !enemy.vulnerable;
         if (faded !== visual.faded) {
            visual.faded = faded;
            for (const node of visual.parts) node.opacity(faded ? .3 : 1);
         }
         for (const node of visual.shields) node.opacity(enemy.shield > 0 ? faded ? .3 : 1 : .0001);
         const fraction = enemy.hp / enemy.maxHP;
         visual.health.identity().move(-.22 * (1 - fraction), visual.size + .1, .02).scale(.22 * fraction, .016, .016);
      }
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
         const distance = uiHit?.distance ?? nearestEnemy(ray, game.enemies, 10).distance;
         const end = cg.add(ray.origin, cg.scale(ray.direction, distance));
         line(visual.beam, cg.add(ray.origin, cg.scale(ray.direction, Math.min(.24, distance))), end,
            uiHit ? .0015 : .0008);
         visual.pointer.identity().move(end).scale(uiHit ? .007 : .012)
            .color(uiHit ? cyan : [1, .77, .37]);
         visual.gun.setMatrix(ray.matrix);
         const locked = game.gunLocked(hand);
         visual.muzzle.color(locked ? red : game.hands[hand].flash ? [1, .9, .6] : visual.color);
         visual.charge.color(locked ? red : game.hands[hand].cooldown > 0 ? gold : cyan);
      }
      paintIn -= dt;
      if (paintIn <= 0) { paint(); paintIn = 1 / 20; }
   });

   cleanup = ctxForever.spellcodeCleanup = () => {
      if (!live) return;
      live = false;
      sound.dispose();
      session?.send('leave');
      if (session) window.server.sync(channel, () => {});
      game.cancel();
      game.reset(); // Invalidates any ROOT request still in flight.
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
