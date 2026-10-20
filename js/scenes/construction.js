// HW5 construction site: the AI designs a building, its site and its build
// plan from a preset prompt, proving it with tools; SO101 arms then build it,
// with annotations for the selected arm and take-over. Until a design is
// accepted, the hand-written tower is built. Design: doc/hw5-design.md.
import * as cg from '../render/core/cg.js';
import { controllerMatrix, buttonState } from '../render/core/controllerInput.js';
import { Arm } from './construction/arm.js';
import { PRESETS, designSession } from './construction/ai.js';
import { Annotations, line } from './construction/annotate.js';
import { compile, span } from './construction/design.js';
import { TOWER } from './construction/designs/tower.js';
import { capsules, segmentDistance, warmReachBands } from './construction/kinematics.js';
import { Builder } from './construction/plan.js';

let cleanup;
export const init = async (model, ctx = {}, ctxForever = {}) => {
   ctxForever.constructionCleanup?.();
   const gl = window.clay.gl, canvas = gl.canvas, disposers = [], textures = [];
   let live = true, mouse = null, click = false, wasXR = null;
   const keys = new Set();

   // The site: table top at 0.75 m, in front of the player. The desktop
   // preview brings it closer and tilts it toward the camera.
   const site = model.add();
   const XR_POSE = cg.mTranslate(0, .75, -.55);
   const DESKTOP_POSE = cg.mMultiply(cg.mTranslate(0, 1.05, -.15), cg.mRotateX(.75));
   let sitePose = XR_POSE, siteInverse = cg.mInverse(sitePose);
   const ghost = new Arm(site, { id: 'ghost', position: [0, 0], ghost: true });
   ghost.hide(true);

   // Everything that belongs to one design lives under `world`. With build,
   // the arms run its plan; without, it is the AI's draft, shown as outlines.
   let world = null, design = null, builder = null, arms = [], trays = [], logged = 0;
   function show(d, build) {
      if (world) site.remove(world);
      world = site.add(); design = d; logged = 0;
      takeover = null; select(null);
      const mesh = (form, pos, size, color) => world.add(form).move(pos).scale(size).color(color).dull();
      const [tw, td] = d.site.table[0] ? d.site.table : [1.4, .9];
      mesh('cube', [0, -.015, 0], [tw / 2, .015, td / 2], [.2, .22, .25]);
      for (const sx of [-1, 1]) for (const sz of [-1, 1])
         mesh('cube', [sx * (tw / 2 - .04), -.39, sz * (td / 2 - .04)], [.025, .36, .025], [.12, .13, .15]);
      arms = d.site.arms.map(a => new Arm(world, a));
      builder = build ? new Builder(d, arms) : null;
      // Modules from their primitives; an outline marks where each one belongs.
      for (const m of d.modules) {
         m.node = world.add();
         for (const p of m.prims) m.node.add(p.form).setMatrix(p.matrix).color(p.color).dull();
         const { min, max } = m.box;
         m.outline = world.add('cube').setMatrix(cg.mMultiply(cg.mTranslate(m.target), cg.mMultiply(cg.mRotateY(m.yaw),
            cg.mMultiply(cg.mTranslate(cg.mix(min, max, .5)), cg.mScale(cg.scale(cg.subtract(max, min), .5)))))).dull();
      }
      // Supply trays ride on their arm's lift.
      trays = d.site.trays.map(t => ({ ...t, arm: arms.find(a => a.id === t.arm),
         plate: mesh('cube', [0, 0, 0], 1, [.3, .34, .38]), column: mesh('cube', [0, 0, 0], 1, [.22, .24, .27]) }));
      help.dirty = true;
   }

   // Canvas panels: the selected arm's readout and a help/status panel.
   // Unlit: the ambient term cancels Clay's two default lights, so the panel
   // shows its canvas at the same brightness from every side.
   const UNLIT = [1 / 2, 1 / 2.1, 1 / 2.2, 0, 0, 0, 0, 0, 0, 1];
   function makePanel(w, h, width, height) {
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const node = site.add('square').scale(width, height, 1).color(UNLIT).setTxtr(c);
      const channel = node._txtr;
      gl.activeTexture(gl.TEXTURE0 + channel);
      const texture = gl.getParameter(gl.TEXTURE_BINDING_2D);
      textures.push({ channel, texture, canvas: c });
      return { canvas: c, ctx: c.getContext('2d'), node, channel, texture, dirty: true };
   }
   const readout = makePanel(1024, 704, .13, .09);
   const help = makePanel(900, 440, .3, .1);
   help.node.identity().move(-.42, .07, .41).turnX(-1).scale(.2, .0978, 1);
   const annotations = new Annotations(site, readout);
   readout.node.identity().scale(0);

   // The AI: preset prompts on a panel to the right, and the state of its session.
   const presets = makePanel(1024, 512, 1, 1);
   presets.matrix = cg.mMultiply(cg.mTranslate(.42, .07, .41), cg.mMultiply(cg.mRotateX(-1), cg.mScale(.2, .1, 1)));
   presets.inverse = cg.mInverse(presets.matrix);
   presets.node.setMatrix(presets.matrix);
   // Each row builds the saved design for its prompt; the AI button at its right end designs it anew.
   const ROW = { top: 84, height: 62, button: 896 };
   const ai = { state: 'idle', prompt: -1, turn: 0, last: '', start: 0, flash: new Map(), hover: null };
   async function showSaved(i) {
      if (ai.state === 'designing') return;
      const saved = await (await fetch(new URL(`./construction/designs/preset-${i + 1}.json`, import.meta.url))).json();
      if (!live) return;
      const { source: s } = saved;
      Object.assign(ai, { state: 'saved', prompt: i, flash: new Map(),
         last: `Designed by ${s.model} on ${s.date} in ${s.turns} turns and ${s.toolCalls} tool calls (${clock(s.seconds)}).` });
      show(compile(saved), true);
   }
   const escape = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
   async function startDesign(i) {
      if (ai.state === 'designing') return;
      Object.assign(ai, { state: 'designing', prompt: i, turn: 0, last: 'asking the model', start: performance.now(), flash: new Map() });
      const { ok, draft, log } = await designSession(PRESETS[i], { onEvent: e => {
         if (!live) return;
         if (e.type === 'turn') ai.turn = e.turn + 1;
         if (e.type !== 'tool') return;
         ai.last = `${e.name}: ${e.result}`;
         // The draft as it stands, with the parts the result names flashing.
         if (/^(set|patch)_/.test(e.name)) show(e.draft.compiled, false);
         for (const m of design.modules) if (new RegExp(`\\b${escape(m.id)}\\b`).test(e.result)) ai.flash.set(m.id, performance.now() + 1500);
      } });
      if (!live) return;
      console.log('construction AI session', log);
      ai.state = ok ? 'accepted' : 'unfinished'; ai.reason = log.reason;
      if (ok) show(compile(draft.design), true);
      else for (const id of ai.flash.keys()) ai.flash.set(id, Infinity); // what the last results named stays red
   }
   function presetRow(ray) {
      if (!ray) return null;
      const o = cg.mTransform(presets.inverse, ray.origin), d = cg.mTransform(presets.inverse, [...ray.direction, 0]);
      const t = -o[2] / d[2];
      if (!(t > 0)) return null;
      const x = o[0] + d[0] * t, y = o[1] + d[1] * t, row = Math.floor(((1 - y) / 2 * presets.canvas.height - ROW.top) / ROW.height);
      return Math.abs(x) <= 1 && Math.abs(y) <= 1 && row >= 0 && row < PRESETS.length ? { row, ai: (x + 1) / 2 * presets.canvas.width >= ROW.button } : null;
   }

   // Upload with mipmaps: the panels are seen smaller than their canvases, and
   // plain linear filtering then drops strokes and shimmers as the head moves.
   function refresh(panel) {
      if (window._canvas_txtr[panel.channel]?.src !== panel.canvas) return;
      gl.activeTexture(gl.TEXTURE0 + panel.channel);
      gl.bindTexture(gl.TEXTURE_2D, panel.texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, panel.canvas);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      panel.dirty = false;
   }

   // Input.
   function listen(target, event, handler) {
      target.addEventListener(event, handler, true);
      disposers.push(() => target.removeEventListener(event, handler, true));
   }
   listen(canvas, 'pointermove', e => {
      const r = canvas.getBoundingClientRect();
      mouse = [(e.clientX - r.left) / r.width * 2 - 1, 1 - (e.clientY - r.top) / r.height * 2];
   });
   listen(canvas, 'pointerdown', e => { if (!window.isXR?.() && e.button === 0) { click = true; e.stopImmediatePropagation(); } });
   for (const event of ['mousedown', 'mouseup'])
      listen(canvas, event, e => { if (!window.isXR?.()) e.stopImmediatePropagation(); });
   listen(window, 'keydown', e => {
      if (window.isXR?.() || /INPUT|TEXTAREA/.test(e.target?.tagName)) return;
      const k = e.key.toLowerCase();
      if (['g', ' ', 'tab', 'escape', 'q', 'e', 'w', 's'].includes(k)) { e.preventDefault(); e.stopImmediatePropagation(); }
      if (e.repeat) return;
      if (k === 'tab') select(arms[((selected ? arms.indexOf(selected) : -1) + 1) % arms.length]);
      if (k === 'escape') { if (takeover) handBack(); select(null); }
      if (k === 'g') toggleTakeover();
      const digit = +(/^Digit(\d)$/.exec(e.code)?.[1] ?? 0);
      if (digit >= 1 && digit <= PRESETS.length) (e.shiftKey ? startDesign : showSaved)(digit - 1);
      if (k === ' ' && takeover) builder.toggleGrip(takeover);
      keys.add(k);
   });
   listen(window, 'keyup', e => keys.delete(e.key.toLowerCase()));

   let selected = null, takeover = null, goal = null, goalYaw = 0, prevGrip = false, prevTrigger = false;
   function select(arm) { selected = arm; help.dirty = true; if (!arm) { annotations.hide(); readout.node.identity().scale(0); ghost.hide(true); } }
   function toggleTakeover() {
      if (takeover) { handBack(); return; }
      if (!selected || !builder) return;
      takeover = selected; takeover.clear();
      goal = takeover.tip; goalYaw = 0; help.dirty = true;
   }
   function handBack() {
      const arm = takeover;
      takeover = null; help.dirty = true;
      if (arm) builder.handBack(arm);
   }

   // Rays in site coordinates.
   function localHead() {
      const view = window.clay.views?.[0];
      return view ? cg.mMultiply(window.clay.inverseRootMatrix, cg.mInverse(view.viewMatrix)) : null;
   }
   function getRay(xr) {
      let m;
      if (xr) {
         if (controllerMatrix.right.length !== 16) return null;
         const grip = cg.mMultiply(window.clay.inverseRootMatrix, controllerMatrix.right);
         m = cg.mMultiply(grip, cg.mMultiply(cg.mRotateX(-Math.PI / 4), cg.mTranslate(0, .02, 0)));
      } else {
         const view = window.clay.views?.[0];
         if (!mouse || !view) return null;
         const p = cg.mTransform(cg.mInverse(view.projectionMatrix), [mouse[0], mouse[1], -1, 1]);
         const d = cg.normalize(p.slice(0, 3).map(v => v / p[3]));
         m = cg.mMultiply(localHead(), cg.mAimZ(cg.scale(d, -1), [1, 0, 0]));
      }
      m = cg.mMultiply(siteInverse, m);
      return { origin: m.slice(12, 15), direction: cg.normalize(cg.scale(m.slice(8, 11), -1)), matrix: m };
   }
   function pickArm(ray) {
      const far = cg.add(ray.origin, cg.scale(ray.direction, 4));
      let best = null;
      for (const arm of arms) for (const c of capsules(arm.frames)) {
         const d = segmentDistance(ray.origin, far, c.a, c.b);
         const along = cg.distance(ray.origin, d.a);
         if (d.distance < c.radius + .015 && (!best || along < best.along)) best = { arm, along };
      }
      return best?.arm || null;
   }
   const beam = site.add('tubeZ').color(.3, .9, 1).dull();
   const tower = compile(TOWER);
   if (tower.errors.length) console.error('construction design errors', tower.errors);
   show(tower, true);
   let fps = 72, last = performance.now();

   model.animate(() => {
      if (!live) return;
      const dt = Math.max(0, Math.min(model.deltaTime || 0, .05));
      warmReachBands();
      const now = performance.now(); fps = fps * .95 + 50 / Math.max(1, now - last); last = now;
      const xr = !!window.isXR?.();
      if (xr !== wasXR) {
         wasXR = xr; help.dirty = true;
         sitePose = xr ? XR_POSE : DESKTOP_POSE; siteInverse = cg.mInverse(sitePose);
      }
      site.setMatrix(sitePose);
      const headRoot = localHead();
      if (!headRoot) return;
      const head = cg.mTransform(siteInverse, headRoot.slice(12, 15));
      const ray = getRay(xr);

      // Buttons: right trigger selects or grips; right grip takes over.
      const trigger = xr ? !!buttonState.right[0]?.pressed : click;
      const gripButton = xr && !!buttonState.right[1]?.pressed;
      ai.hover = presetRow(ray);
      if (trigger && !prevTrigger) {
         if (takeover) builder.toggleGrip(takeover);
         else if (ai.hover) (ai.hover.ai ? startDesign : showSaved)(ai.hover.row);
         else if (ray) { const hit = pickArm(ray); if (hit || !xr) select(hit); }
      }
      if (gripButton && !prevGrip) toggleTakeover();
      prevTrigger = xr && trigger; prevGrip = gripButton; click = false;

      // Take-over goal: 5 cm in front of the controller, or the mouse on a horizontal plane.
      if (takeover) {
         if (xr && ray) {
            goal = cg.add(ray.origin, cg.scale(ray.direction, .05));
            goalYaw = Math.atan2(-ray.direction[2], ray.direction[0]);
         } else {
            if (keys.has('w')) goal[1] += .1 * dt;
            if (keys.has('s')) goal[1] -= .1 * dt;
            if (keys.has('q')) goalYaw += 1.5 * dt;
            if (keys.has('e')) goalYaw -= 1.5 * dt;
            if (ray && Math.abs(ray.direction[1]) > 1e-3) {
               const t = (goal[1] - ray.origin[1]) / ray.direction[1];
               if (t > 0) goal = [ray.origin[0] + ray.direction[0] * t, goal[1], ray.origin[2] + ray.direction[2] * t];
            }
         }
         // Never below the surface under the jaws.
         goal[1] = Math.max(goal[1], builder.surface([goal[0], goal[2]]) + .005);
         takeover.aim(goal, goalYaw);
      }

      // Construction pauses while an arm is taken over. A draft only stands there.
      if (builder) {
         builder.update(dt, takeover);
         while (logged < builder.failures.length) { const f = builder.failures[logged++]; console.warn(`construction ${f.t.toFixed(1)}s ${f.kind}: ${f.text}`); }
      } else for (const arm of arms) arm.update(dt);
      for (const m of design.modules) {
         if (!builder) {
            const flash = ai.flash.get(m.id) > now;
            m.node.identity().scale(0);
            m.outline.color(flash ? [1, .25, .2] : [.3, .9, 1]).opacity(flash ? .5 : .15);
            continue;
         }
         if (m.pos) m.node.identity().move(m.pos); else m.node.identity().scale(0);
         if (m.state === 'placed') m.outline.opacity(.0001);
         else m.outline.color(m.state === 'failed' ? [1, .25, .2] : [.3, .9, 1]).opacity(m.state === 'failed' ? .35 : .1);
      }
      for (const t of trays) {
         const lift = t.arm.lift;
         t.plate.identity().move(t.pos[0], lift - .002, t.pos[1]).scale(.05, .002, .05);
         t.column.identity().move(t.pos[0], lift / 2 - .003, t.pos[1]).scale(.02, Math.max(.001, lift / 2), .02).opacity(lift > .005 ? 1 : .0001);
      }

      if (selected) {
         const others = arms.filter(a => a !== selected);
         const paint = now - (readout.painted || 0) > 100;
         if (paint) readout.painted = now;
         annotations.show(selected, { head, up: cg.normalize(cg.mTransform(siteInverse, [0, 1, 0, 0]).slice(0, 3)), others, ghost, takeover: !!takeover, goalPos: takeover ? goal : null, paint });
      }
      if (ray) {
         beam.opacity(xr ? .6 : .0001);
         line(beam, cg.add(ray.origin, cg.scale(ray.direction, .02)), cg.add(ray.origin, cg.scale(ray.direction, takeover ? .05 : 1.2)), .0008);
      } else beam.opacity(.0001);

      if (help.dirty || Math.round(now / 500) !== help.tick) { drawHelp(xr); drawPresets(now); help.tick = Math.round(now / 500); }
      const hover = ai.hover ? `${ai.hover.row}${ai.hover.ai}` : '';
      if (hover !== presets.hover) { presets.hover = hover; drawPresets(now); }
      if (readout.dirty && selected) refresh(readout);
      if (help.dirty) refresh(help);
      if (presets.dirty) refresh(presets);
   });

   function drawHelp(xr) {
      const { ctx, canvas: c } = help;
      ctx.fillStyle = '#060e16'; ctx.fillRect(0, 0, c.width, c.height);
      const text = (s, y, size = 30, color = '#e8f4ff') => {
         ctx.font = `600 ${size}px sans-serif`; ctx.fillStyle = color; ctx.textBaseline = 'middle'; ctx.fillText(s, 28, y);
      };
      text(`SO101 CONSTRUCTION SITE · ${design.name}`, 40, 34, '#4de6ff');
      const lines = xr
         ? ['Right trigger: select an arm', 'Right grip: take over / hand back', 'In take-over: move the controller, trigger grips']
         : ['Click an arm (Tab cycles, Esc clears)', 'G: take over / hand back', 'Take-over: mouse moves, W/S height, Q/E yaw, Space grips'];
      lines.forEach((s, i) => text(s, 100 + i * 46, 28));
      const state = takeover ? `ARM ${takeover.id} IN MANUAL · construction paused` : selected ? `ARM ${selected.id} selected` : 'no arm selected';
      text(`${state}   ·   ${Math.round(fps)} fps`, 250, 26, takeover ? '#ffd84d' : '#9fb3c8');
      if (!builder) { text(`AI draft: ${design.modules.length} modules, ${design.site.arms.length} arms`, 300, 28, '#9fb3c8'); help.dirty = true; return; }
      const t = Math.floor(builder.time), f = builder.failures;
      text(`${builder.placed.length}/${design.modules.length} modules placed · ${clock(t)}` +
         ` · ${f.length} failure${f.length === 1 ? '' : 's'}${builder.done ? ' · finished' : ''}`, 300, 28, f.length ? '#ff7a66' : '#4dff8c');
      wrap(f.at(-1)?.text || design.errors[0] || '', 64, 3).forEach((r, i) => text(r, 346 + i * 32, 22, '#ff9f8f'));
      help.dirty = true;
   }
   function drawPresets(now) {
      const { ctx, canvas: c } = presets;
      ctx.fillStyle = '#060e16'; ctx.fillRect(0, 0, c.width, c.height);
      const text = (s, x, y, size, color) => { ctx.font = `600 ${size}px sans-serif`; ctx.fillStyle = color; ctx.textBaseline = 'middle'; ctx.fillText(s, x, y); };
      text(`PROMPTS · row: build saved · AI ↻: redesign${window.isXR?.() ? '' : '  (1-4 / Shift+1-4)'}`, 28, 44, 28, '#4de6ff');
      PRESETS.forEach((p, i) => {
         const y = ROW.top + i * ROW.height, h = ai.hover?.row === i ? ai.hover : null;
         const box = (x, w, color) => { ctx.fillStyle = color; ctx.fillRect(x, y + 4, w, ROW.height - 8); };
         if (h && !h.ai || i === ai.prompt) box(16, ROW.button - 24, h && !h.ai ? 'rgba(77,230,255,.25)' : 'rgba(77,230,255,.12)');
         box(ROW.button, c.width - 16 - ROW.button, h?.ai ? 'rgba(255,216,77,.45)' : 'rgba(255,216,77,.15)');
         text(`${i + 1}  ${p}`, 32, y + ROW.height / 2, 26, i === ai.prompt ? '#ffd84d' : '#e8f4ff');
         text('AI ↻', ROW.button + 22, y + ROW.height / 2, 28, '#ffd84d');
      });
      const y = ROW.top + PRESETS.length * ROW.height + 30, elapsed = clock(Math.floor((now - ai.start) / 1000));
      const state = { idle: 'Showing the hand-written tower', saved: `Saved design ${design.name} · building`, designing: `Designing · turn ${ai.turn} · ${elapsed}`,
         accepted: `Accepted after ${ai.turn} turns (${elapsed}) · building`, unfinished: `The AI did not finish (${ai.reason}): its draft is shown, failures in red` }[ai.state];
      text(state, 28, y, 28, { idle: '#9fb3c8', saved: '#4dff8c', designing: '#ffd84d', accepted: '#4dff8c', unfinished: '#ff7a66' }[ai.state]);
      wrap(ai.last.replace(/\s+/g, ' '), 70, 2).forEach((r, i) => text(r, 28, y + 40 + i * 30, 22, '#c8d8e8'));
      presets.dirty = true;
   }
   const clock = t => `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
   function wrap(s, width, max) {
      const rows = [''];
      for (const w of s.split(' ')) if ((rows.at(-1) + ' ' + w).length > width && rows.length < max) rows.push(w); else rows[rows.length - 1] += ' ' + w;
      return rows.map(r => r.trim());
   }

   cleanup = ctxForever.constructionCleanup = () => {
      if (!live) return;
      live = false;
      disposers.forEach(d => d());
      for (const t of textures) {
         if (window._canvas_txtr[t.channel]?.src === t.canvas) {
            delete window._canvas_txtr[t.channel];
            window.txtrChannel = window.txtrChannel.filter(c => c !== t.channel);
         }
         gl.deleteTexture(t.texture);
      }
      delete ctxForever.constructionCleanup;
   };
};

export const deinit = () => { cleanup?.(); cleanup = null; };
