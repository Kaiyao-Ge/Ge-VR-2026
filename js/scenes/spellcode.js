import * as cg from '../render/core/cg.js';
import { controllerMatrix, buttonState } from '../render/core/controllerInput.js';
import { BLOCKS, Game, nearestEnemy, raySphere } from './spellcode/game.js';
import { Session } from './spellcode/session.js';
import { makePanel, drawIDE, drawHUD, buttonAt, pickButtonHit } from './spellcode/panels.js';

let cleanup;
export const init = async (model, ctx = {}, ctxForever = {}) => {
   ctxForever.spellcodeCleanup?.();
   const game = new Game();
   const params = new URLSearchParams(location.search);
   const room = (params.get('spellcodeRoom') || '').trim().slice(0, 24).toUpperCase();
   const ui = { room, mode: 'select', role: 'select', editorOpen: false,
      selectedSlot: { parent: 0, index: 1 },
      selectedNode: null, moving: false, scroll: 0, hover: null,
      paused: false, pauseReason: '', xr: false, waiting: false };
   let session = null;
   const arena = model.add();
   const effects = [], enemies = new Map(), drops = new Map(), textures = [];
   const ide = makePanel(1024, 1024), hud = makePanel(1024, 512);
   const editor = arena.add(), dashboard = arena.add().move(0, 2.65, -3.5);
   const gl = window.clay.gl, canvas = gl.canvas;
   const disposers = [];
   let anchor = null, wasXR = null, wasGrip = false, editorPose = null;
   const wasHeld = { left: false, right: false }, captured = { left: false, right: false };
   let mouse = null, mouseHeld = false, mouseTap = false, paintIn = 0, live = true;

   const mesh = (parent, form, position, size, color) =>
      parent.add(form).move(position).scale(size).color(color).dull();
   const cyan = [.18, .85, .87], dark = [.015, .025, .045];
   // A small, fixed geometry set: no external assets or physics engine needed.
   mesh(arena, 'cube', [0, -.05, -3], [5, .04, 6], dark);
   for (let i = -4; i <= 4; i++) {
      mesh(arena, 'cube', [i, 0, -3], [.003, .002, 6], [.045, .13, .17]);
      mesh(arena, 'cube', [0, 0, i - 3], [5, .002, .003], [.045, .13, .17]);
   }
   mesh(arena, 'torusY', [0, .03, 0], [1, .035, 1], cyan);
   for (let i = -2; i <= 2; i++) {
      mesh(arena, 'cube', [i * 1.45, .7, -7.4], [.025, .7, .025], [.10, .25, .34]);
      mesh(arena, 'octahedron', [i * 1.45, 1.45, -7.4], .08, cyan);
   }
   for (const x of [-2.6, 0, 2.6]) {
      mesh(arena, 'torusZ', [x, 1.5, -8], [.68, .68, .045], [.08, .27, .34]);
      mesh(arena, 'torusZ', [x, 1.5, -8.03], [.8, .8, .02], [.04, .12, .18]);
   }
   for (let i = 0; i < 32; i++)
      mesh(arena, 'octahedron', [Math.sin(i * 13.7) * 7, 2 + (i % 7) * .42, -9 - i % 3],
         .012 + (i % 3) * .005, [.17, .26, .38]);

   function surface(parent, panel, w, h) {
      mesh(parent, 'cube', [0, 0, -.013], [w + .012, h + .012, .012], [.025, .065, .095]);
      const node = parent.add('square').scale(w, h, 1).dull().setTxtr(panel.canvas);
      const channel = node._txtr;
      gl.activeTexture(gl.TEXTURE0 + channel);
      const texture = gl.getParameter(gl.TEXTURE_BINDING_2D);
      textures.push({ channel, texture, canvas: panel.canvas });
      return node;
   }
   const editorFace = surface(editor, ide, .34, .34);
   const hudFace = surface(dashboard, hud, 1.65, .825);
   const guns = {};
   for (const hand of ['left', 'right']) {
      const color = hand === 'left' ? [.66, .48, 1] : cyan;
      const gun = arena.add();
      mesh(gun, 'cube', [0, -.035, .01], [.03, .04, .10], [.045, .075, .12]);
      mesh(gun, 'tubeZ', [0, 0, -.1], [.018, .018, .12], [.10, .26, .32]);
      const muzzle = mesh(gun, 'torusZ', [0, 0, -.23], [.03, .03, .014], color);
      guns[hand] = { gun, muzzle, color,
         pointer: mesh(arena, 'sphere', [0, 0, 0], .008, color),
         beam: mesh(arena, 'tubeZ', [0, 0, 0], .001, color) };
   }

   function listen(target, event, handler) {
      target.addEventListener(event, handler, true);
      disposers.push(() => target.removeEventListener(event, handler, true));
   }
   if (room) listen(window.server.socket, 'message', e => {
      if (typeof e.data !== 'string') return;
      try { session?.receive(JSON.parse(e.data).spellcode); } catch (_) { /* Other framework packets. */ }
   });
   function cancel() {
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
            session = new Session(game, { room, role,
               id: () => window.clientID, clients: () => window.clients || [],
               send: message => window.server.broadcastObject({ spellcode: message }) });
            session.send('hello');
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
         // ponytail: debug shortcut for desktop-occluded drops; co-op still validates pickup rays.
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
   listen(window, 'blur', () => pause('Focus lost. Resume when ready.'));
   listen(document, 'visibilitychange', () => {
      if (document.hidden) pause('Session interrupted. Resume when ready.');
   });

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
            if (hand === pickupHand && lootHit && (hand !== 'right' || !hit || lootDistance < hit.distance)) {
               if (session) session.command({ kind: 'pickup', id: lootHit.id, ray: rays[hand] });
               else game.pickup(lootHit.id, rays[hand], 'editor');
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
      const canRun = ui.mode !== 'select' && !ui.paused && !document.hidden;
      const firingRays = { left: captured.left ? null : rays.left,
         right: captured.right ? null : rays.right };
      const events = session ? session.tick(dt, firingRays, !canRun)
         : canRun ? game.tick(dt, firingRays) : [];
      events.forEach(eventEffect);

      for (const [id, visual] of enemies) {
         if (!game.enemies.some(e => e.id === id)) { remove(visual.root); enemies.delete(id); }
      }
      for (const enemy of game.enemies) {
         let visual = enemies.get(enemy.id);
         if (!visual) {
            const root = arena.add();
            const shell = mesh(root, 'octahedron', [0, 0, 0], .24, [1, .25, .32]);
            mesh(root, 'cube', [-.09, .025, .17], [.035, .045, .025], [1, .85, .5]);
            mesh(root, 'cube', [ .09, .025, .17], [.035, .045, .025], [1, .85, .5]);
            mesh(root, 'cube', [0, .36, 0], [.22, .016, .016], [.15, .09, .14]);
            const health = mesh(root, 'cube', [0, .36, .02], [.22, .016, .016], [1, .55, .40]);
            const ring = mesh(root, 'torusY', [0, -.03, 0], [.31, .018, .31], [.60, .20, .30]);
            visual = { root, shell, health, ring };
            enemies.set(enemy.id, visual);
         }
         visual.root.identity().move(enemy.position).turnY(-enemy.angle);
         visual.shell.identity().turnZ(.15 * Math.sin(game.time * 3 + enemy.seed)).scale(.24)
            .color(enemy.hit ? [1, 1, 1] : [1, .19 + .04 * enemy.maxHP, .30]);
         visual.ring.identity().turnX(.35).turnZ(game.time).scale(.31, .018, .31);
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
            mesh(visual, 'octahedron', [0, 0, 0], .13, [.98, .71, .24]);
            mesh(visual, 'torusY', [0, -.13, 0], [.22, .018, .22], [.6, .38, .10]);
            drops.set(item.id, visual);
         }
         visual.identity().move(cg.add(item.position, [0, .23 + .05 * Math.sin(game.time * 4 + item.id), 0]))
            .turnY(game.time * 2);
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
         let distance = uiHit?.distance ?? nearestEnemy(ray, game.enemies, 10).distance;
         if (hand === pickupHand && lootHit && (hand !== 'right' || !uiHit || lootDistance < uiHit.distance))
            distance = lootDistance;
         const end = cg.add(ray.origin, cg.scale(ray.direction, distance));
         line(visual.beam, cg.add(ray.origin, cg.scale(ray.direction, Math.min(.24, distance))), end,
            uiHit ? .0015 : .0008);
         visual.pointer.identity().move(end).scale(uiHit ? .007 : .012)
            .color(uiHit ? cyan : [1, .77, .37]);
         visual.gun.setMatrix(ray.matrix);
         visual.muzzle.color(game.hands[hand].flash ? [1, .9, .6] : visual.color);
      }
      paintIn -= dt;
      if (paintIn <= 0) { paint(); paintIn = 1 / 20; }
   });

   cleanup = ctxForever.spellcodeCleanup = () => {
      if (!live) return;
      live = false;
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
