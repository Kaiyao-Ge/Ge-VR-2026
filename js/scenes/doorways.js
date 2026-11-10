// Doorways: a two-player puzzle on a table (design: doc/hw8-design.md). The giant, at your size,
// arranges rooms on a 3 x 3 board by lifting and turning them; the mini, 1/12 of that, walks
// through their doorways to the treasure chest. This is the solo scene: one client plays both
// parts and switches between them, with the HW7 flight between the views (1.5 s):
//   giant: you see the table from above, rooms with roofs on (stakes show which cannot be lifted
//          yet), the mini on the table; the task card on your wrist says which symbol marks the
//          treasure room. Grip (in reach, or by ray) or a mouse drag holds a room; let go to set it
//          down in the nearest free cell or depot slot, turned to the nearest quarter, else it goes back.
//   mini:  you see through the avatar's eyes, the room 12 times bigger. Stick (or W/A/S/D) walks it
//          over the floors and across doorways, the right stick (or Q/E) turns, pushed forward (or T
//          held) aims a teleport to a room it can reach. Grip (G) takes a key, trigger (F) unlocks a
//          gate, presses a switch, opens a chest: the right one wins, an empty one costs 20 s.
// Controls, giant. Headset: grip holds a room (in reach, or by ray), the right stick turns the held room a
// quarter, letting go sets it down. Desktop: a left press on a room holds it (a drag elsewhere still turns the view),
// Q/E turn it a quarter, releasing sets it down; W/A/S/D/F/C keep moving the camera.
// Controls, mini. Headset: the left stick walks, the right stick turns (snap) and, pushed forward, aims a
// teleport; grip takes a key; trigger unlocks a gate, presses a switch, opens a chest. Desktop: W/A/S/D walk,
// Q/E turn, T held aims a teleport, G takes a key, F uses.
// Controls, both. A (V) switches role when alone, B (N) starts a new round after a win, Y (M) swaps the roles
// after a win, X with the left controller on the table sets the table; in the headset the first thing is the 12 s
// depth scan (as HW7).
// URL: ?doorwaysSeed=N chooses the level.
//
// Everything shared is in the table's frame (world.frame in model coordinates), so the state stays
// the same when the table is moved. The giant's part of it is state.at and `held` (giant.js); the
// mini's is the rest of the state and its pose (mini.js, `mini` below): neither touches the other's.
//
// Two players: with a partner (doorways/pair.js over net.js, the class server's message queue) one client is
// the giant and the other the mini. Each writes its own part and sends it; the other part comes from the
// partner's latest snapshot. The giant sees the mini's avatar from its snapshot, in the room it stands in, and
// the mini sees the giant as a figure at the real size, 12 times bigger than the table in its view (bodies.js).
// The first round is the giant's level; N and M after a win start another (M swaps the roles). Alone, a client
// plays both parts and A switches. If the partner goes quiet the page waits for it, with its role and state kept.
//
// The parts: doorways/{rules,generate} (the game, pure), rooms, board, symbols (what is drawn), walk
// (the mini's feet), giant, mini, input, panel, net (the session protocol), pair (its glue to the scene) and
// bodies (the partner's figure); and the HW7 modules in miniature/.
import * as cg from '../render/core/cg.js';
import { Mapping, flight, frame, yawOf } from './miniature/mapping.js';
import { mapRay } from './miniature/rays.js';
import { World } from './miniature/world.js';
import { Avatar } from './miniature/avatar.js';
import { Scanner } from './miniature/scanner.js';
import { ScanDraw } from './miniature/scandraw.js';
import { MAX_TRIS, roomMesh, pickTable, tableTop } from './miniature/scanned.js';
import { ENTRANCE, ROOM, slotPose, slotCentre, startState, movable } from './doorways/rules.js';
import { generate } from './doorways/generate.js';
import { createRoom } from './doorways/rooms.js';
import { createBoard } from './doorways/board.js';
import { symbolTexture } from './doorways/symbols.js';
import { createInput } from './doorways/input.js';
import { Panel } from './doorways/panel.js';
import * as Giant from './doorways/giant.js';
import { createMini, WALK, TURN, PUSH, CENTRE } from './doorways/mini.js';
import { Link, CHANNEL, giantPart, miniPart, mapOf } from './doorways/pair.js';
import { giantFigure, miniFigure } from './doorways/bodies.js';

const FLIGHT = 1.5, PREVIEW = 3;   // seconds between the views; seconds a finished scan shows before it fades
const EYE = 1.6, START_YAW = -Math.PI / 2;   // the mini's eye height (m) when it stands idle; it starts facing east, into the board
const HINTS = { key: 'grip: take the key', switch: 'trigger: press the switch', chest: 'trigger: open the chest', gate: 'trigger: unlock the gate' };

let cleanup;
export const init = async (model, ctx = {}, ctxForever = {}) => {
   ctxForever.doorwaysCleanup?.();
   const disposers = [], xr = () => !!window.isXR?.(), now = () => performance.now() / 1000;
   const listen = (target, event, handler) => {
      target.addEventListener(event, handler, true);
      disposers.push(() => target.removeEventListener(event, handler, true));
   };

   // The avatars go in first, so that they show through what Clay draws after them.
   const worldNode = model.add(), world = new World(worldNode), avatar = new Avatar(worldNode), giant = new Avatar(worldNode);
   // The texture channels and GL textures that the panel and the symbols take, to give back on leaving (see cleanup).
   const owned = [];
   const boardNode = worldNode.add(), board = createBoard(boardNode), panel = new Panel(model, owned), mapping = new Mapping();
   const scanner = new Scanner(window.clay.gl), scanDraw = new ScanDraw(window.clay.gl), textures = new Map();
   // The partner: the session over the classroom's message queue (alone, or offline, nothing comes of it).
   window.server?.init(CHANNEL, {}, { accumulate: true });
   const link = new Link({ id: () => window.clientID, clients: () => window.clients || [], now: () => performance.now(),
      send: message => window.server?.send(CHANNEL, message), sync: callback => window.server?.sync(CHANNEL, callback) });
   const randomSeed = () => Math.floor(Math.random() * 2 ** 31);

   // The game: the level, the state (the giant's part state.at and `held`; the mini's part the rest and `mini`), all in the table frame.
   const game = { level: null, state: null, held: null, mini: { ref: ENTRANCE, local: [0, 0, 0] } };
   let levelNode = null, nodes = new Map(), roomViews = new Map(), mini = null, clock = {}, fresh = true;
   // The level of the URL's seed the first time, a random one after.
   const urlSeed = Number(new URLSearchParams(location.search).get('doorwaysSeed') ?? NaN);
   const startRound = (seed = randomSeed()) => {
      if (levelNode) worldNode.remove(levelNode);
      const { level } = generate(seed);
      levelNode = worldNode.add();
      nodes = new Map(level.rooms.map(r => [r.id, levelNode.add()]));
      roomViews = new Map(level.rooms.map(r => [r.id, createRoom(nodes.get(r.id), r, { goal: r.id === level.goal, rug: (n, s) => symbolTexture(n, s, textures, owned) })]));
      Object.assign(game, { level, state: startState(level), held: null });
      mini = createMini({ rooms: roomViews, board });
      clock = { start: null, end: null };
      // A notice belongs to the round it was shown in: "empty: 20 s lost" must not outlive the level it was about.
      notice = ''; noticeUntil = 0;
      if (head) placeMini(); else fresh = true;   // the first round starts before the first frame, which knows the head
   };

   // mode is the view I am in or flying to ('player' is the giant's, 'avatar' the mini's), t how far along the flight (0 giant, 1 mini).
   let mode = 'player', phase = 0, t = 0, flying = false, head = null, giantAt = null, tilt = cg.mIdentity();
   let aiming = false, target = null, turnWas = 0, aimed = false, notice = '', noticeUntil = 0, blockedAt = 0;
   // paired: the role I play with a partner ('giant' or 'mini'), kept while it is away; null when I have had none (solo).
   let paired = null;
   const viewRole = () => mode === 'avatar' ? 'mini' : 'giant';
   const role = () => paired ?? viewRole();
   const F = () => world.frame, toTable = p => cg.mTransform(cg.mInverse(F()), p);
   const flash = (text, seconds = 2.5) => { notice = text; noticeUntil = now() + seconds; };
   const haptic = (hand, strength, ms) => { if (xr() && hand !== 'desktop') try { window.vibrate?.(hand, strength, ms); } catch (_) { /* No actuator. */ } };
   const begin = () => { clock.start ??= now(); };
   const settledPose = id => id === ENTRANCE ? cg.mIdentity() : slotPose(game.state.at[id].slot, game.state.at[id].rot);

   // The mini starts in the entrance hall, facing into the board.
   const placeMini = () => {
      const [x, , z] = slotCentre(ENTRANCE);
      mapping.setBody(head).setStand(cg.mTransform(F(), [x, ROOM.FLOOR, z]), world.table.yaw + START_YAW);
   };
   // The table is somewhere else: the mini stays on it where it was, the room in my hand is set down.
   const moveTable = (p, yaw, size) => {
      const feet = toTable(mapping.stand.p), was = world.table.yaw;
      if (game.held) setDown();
      world.setTable(p, yaw, size);
      mapping.setStand(cg.mTransform(F(), feet), mapping.stand.yaw + yaw - was);
   };
   const takeScan = (room, eye, fwd) => {
      const table = pickTable(room, eye, fwd);
      world.setScan(roomMesh(room, MAX_TRIS, table && tableTop(room, table.box)));
      if (table) moveTable(table.p, table.yaw, table.size);
      return table;
   };
   let scanSession = null, scanNote = '', scannedAt = -1e9, scanFound = false;

   // Set the room in the giant's hand down; the mini, if it rides in it, goes with it to where it is set (if the
   // mini is mine: a partner's client carries its own mini). The mini's client never sets down: the room is the giant's.
   const setDown = () => {
      if (!game.held || paired === 'mini') return null;
      const { id, hand } = game.held, was = cg.mMultiply(F(), settledPose(id)), carried = game.state.mini === id && paired !== 'giant';
      const result = Giant.release(game);
      if (carried) mapping.carry(was, cg.mMultiply(F(), settledPose(id)));
      haptic(hand, .4, 30);
      if (result.error) flash(result.error);
      return result;
   };
   // Use what the mini's hand chose; the rules decide, and the clock and the panel hear of it.
   const use = (button, thing, hand) => {
      const result = mini.use(game, button, thing);
      if (!result) return false;
      if (result.error) { flash(result.error); return false; }
      begin();
      haptic(hand, .6, 40);
      if (game.state.won && clock.end === null) clock.end = now();   // the panel shows the win from state.won, so it needs no notice
      else if (button === 'trigger' && thing.what === 'chest') flash('empty: 20 s lost');
      return true;
   };
   const setMode = (next, hands) => {
      if (next === mode) return;
      mode = next;
      if (game.held) setDown();
      if (mode === 'avatar') {
         const pose = hand => hands.find(h => h.hand === hand)?.m;
         mapping.setBody(head);
         giantAt = { poses: { head, left: pose('left'), right: pose('right') }, feet: [head[12], 0, head[14]] };
      }
   };
   const toggle = hands => setMode(mode === 'player' ? 'avatar' : 'player', hands);

   // The mouse's ray, or a hand's, meets a room the giant may lift: for the input to hold the mouse press back from the view.
   // The mini uses the walking keys; the giant leaves them to the camera, which it needs to see the board from where it likes.
   const input = createInput({ listen, xr, uses: code => role() === 'mini' || /Key[QEVNM]/.test(code),
      hits: ray => role() === 'giant' && !flying && !game.held && !game.state.won && Giant.pick(game, null, mapRay(cg.mInverse(F()), ray)) !== null });

   // The giant's frame: lift, carry, turn and set down.
   const giantFrame = (hands, mouse, turnEdge) => {
      const Fi = cg.mInverse(F()), grab = (id, hand) => { if (id) { Giant.grab(game, id, hand); begin(); haptic(hand.hand, .6, 40); } };
      // Turn first, so that a turn and a letting go in one frame turn the room that is set down.
      const dir = xr() ? turnEdge : mouse?.rotate;
      if (game.held && dir) Giant.turn(game, dir);
      if (['left', 'right'].includes(game.held?.hand) && !hands.some(h => h.hand === game.held.hand)) setDown();
      for (const h of hands.filter(h => h.hand !== 'desktop' && !game.state.won)) {
         const hand = { hand: h.hand, m: cg.mMultiply(Fi, h.m), ray: mapRay(Fi, h.ray) };
         if (!game.held && h.gripPressed) grab(Giant.pick(game, hand.m.slice(12, 15), hand.ray), hand);
         if (game.held?.hand === h.hand) h.grip ? Giant.follow(game, hand) : setDown();
      }
      const ray = mouse?.ray && mapRay(Fi, mouse.ray);
      if (mouse?.pressed && !game.held && ray && !game.state.won) grab(Giant.pick(game, null, ray), { hand: 'mouse', ray });
      if (game.held?.hand === 'mouse') { if (!mouse.down) setDown(); else if (ray) Giant.follow(game, { ray }); }
      return game.held ? 'let go to set it down' : 'grip or drag a room';
   };

   // The mini's frame: turn, aim, teleport, use. The step itself is taken every frame, whoever is playing.
   const miniFrame = (inp, hands, dt, eye, turnEdge) => {
      const toMini = cg.mMultiply(cg.mInverse(F()), mapping.toMini), pushed = inp.turn.y < -PUSH;
      if (turnEdge) mapping.turn(-turnEdge * TURN);
      const right = hands.find(h => h.hand === 'right' || h.hand === 'desktop');
      let message = '';
      if (pushed) {
         // The right stick pushed forward aims (T on the desktop: along the view, a little down).
         const ray = xr() ? right?.ray : { o: eye, d: cg.normalize(head.slice(8, 11).map((v, i) => i === 1 ? -v - .6 : -v)) };
         target = ray ? mini.aim(game, mapRay(toMini, ray)) : null;
         message = target ? 'release to go there' : 'aim at a room you can reach';
      } else {
         if (aiming && target && !mini.go(game, target.id).error) {
            mapping.setStand(cg.mTransform(F(), target.p), mapping.stand.yaw);
            begin();
            haptic('right', .5, 30);
         }
         target = null;
      }
      aiming = pushed;
      for (const h of hands) {
         const hand = { p: cg.mTransform(toMini, h.m.slice(12, 15)), ray: mapRay(toMini, h.ray) }, thing = mini.touch(game, hand);
         if (h === right && thing) message = HINTS[thing.what];
         if (h.gripPressed) use('grip', thing, h.hand);
         if (h.pressed) use('trigger', thing, h.hand);
      }
      const stick = inp.walk, walk = Math.hypot(stick.x, stick.y) > .15 ? mapping.direction(head, -stick.y * WALK * dt, stick.x * WALK * dt) : [0, 0, 0];
      return { walk, message: message || 'walk to a doorway' };
   };

   // The mini's body: the step, in the table frame; where it is is the physics' to say.
   const stepMini = walk => {
      const Fi = cg.mInverse(F()), d = cg.mTransform(Fi, [...walk, 0]), feet = cg.mTransform(Fi, mapping.stand.p);
      const r = mini.step(game, feet, d[0], d[2]);
      if (walk.some(v => v)) { begin(); if (r.blocked && now() - blockedAt > .3) { blockedAt = now(); haptic('left', .4, 30); } }
      mapping.setStand(cg.mTransform(F(), r.feet), mapping.stand.yaw);
      if (r.room) game.state.mini = r.room;
      game.mini = { ref: game.state.mini, local: cg.mTransform(cg.mInverse(settledPose(game.state.mini)), r.feet) };
   };

   // The partner: what its session says and what it has sent, taken at the start of each frame. Returns nothing; it
   // sets `paired`, starts a round when the session has one, and applies the partner's part (not while it is away).
   const network = () => {
      link.pump();
      if (link.session.live) paired = link.session.role;
      const seed = link.rounds(game.level.seed, randomSeed());
      if (seed !== null) startRound(seed);
      if (paired === 'mini') link.takeGiant(game, (was, now) => mapping.carry(cg.mMultiply(F(), was), cg.mMultiply(F(), now)));
      else if (paired === 'giant') link.takeMini(game);
   };
   // After a win: another round, with the roles swapped or not. With a partner, the session carries it to both.
   const again = (swap, hands) => {
      if (!paired) { if (swap) toggle(hands); startRound(randomSeed()); }
      else if (link.session.live) { link.start(randomSeed(), swap); network(); }
   };
   const clockTime = () => clock.start === null ? 0 : (clock.end ?? now()) - clock.start;
   // A desktop player's body for the partner (a headset's is in clientState): its camera, in the table frame for the
   // giant and the model frame for the mini; and the giant's hand at the room it holds with the mouse.
   const desktopBody = () => {
      if (xr()) return null;
      if (paired === 'mini') return { head };
      const h = cg.mMultiply(cg.mInverse(F()), head), grip = game.held?.hand === 'mouse' && [...h.slice(0, 12), game.held.m[12], game.held.m[13] + ROOM.WALL, game.held.m[14], 1];
      return grip ? { head: h, right: grip } : { head: h };
   };
   // The partner's figure in my model frame: the mini's avatar for the giant (in the room it stands in, wherever the
   // room is now), the giant for the mini (not while it is away).
   const partnerFigure = f => {
      const peer = link.session.peer;
      if (!paired || !peer) return null;
      if (paired === 'giant') {
         const ref = link.view?.ref, pose = ref in game.state.at ? Giant.roomPose(game, ref) : cg.mIdentity();
         return link.view && miniFigure(f, pose, link.view.map, peer, link.body, window.clientState);
      }
      return link.session.live ? giantFigure(f, peer, link.body, window.clientState) : null;
   };

   let last = performance.now(), frames = 0, partnerHead = null;   // frames: how many have run, for tests that wait for the next one
   model.animate(() => {
      const t0 = performance.now(), dt = Math.min(.05, (t0 - last) / 1000);
      last = t0;
      const views = window.clay.views;
      if (!views?.length) return;
      // My head, between the eyes; my hands, in the headset.
      const inv = v => cg.mInverse(v.viewMatrix);
      head = cg.mMultiply(window.clay.inverseRootMatrix, views.length > 1 ? cg.mix(inv(views[0]), inv(views[1]), .5) : inv(views[0]));
      const eye = head.slice(12, 15), inp = input.frame(head), hands = inp.hands, left = hands.find(h => h.hand === 'left');
      if (fresh) { fresh = false; placeMini(); }

      // The scan: it starts when I first am in the headset. The giant's view while it runs.
      const session = xr() ? window.xrFrame?.session : null;
      if (session && session !== scanSession) {
         scanSession = session;
         if (mode === 'avatar') toggle(hands);
         scanner.start(session, eye, now());
      }
      if (session) scanner.update(window.xrFrame, window.xrFrameRefSpace, eye, window.clay.inverseRootMatrix, now());
      else scanner.cancel();
      const scanned = scanner.take();
      if (scanned) { scanFound = !!takeScan(scanned, eye, [-head[8], -head[10]]); scannedAt = now(); }
      const since = now() - scannedAt;
      scanNote = scanner.busy ? (scanner.state === 'meshing' ? 'building the room...' : 'look around: scanning ' + scanner.left(now()) + ' s')
         : scanner.state === 'failed' ? scanner.note : since < PREVIEW + 1 ? (scanFound ? 'room scanned, table found' : 'room scanned, no table: X to set it') : '';

      // The partner, and the role it gives me (after a scan, if I was scanning). Then the buttons: roles (not with a
      // partner), rounds, the table. A new round, or a swap, comes after a win.
      network();
      if (paired && !scanner.busy) setMode(paired === 'mini' ? 'avatar' : 'player', hands);
      const b = inp.buttons, won = game.state.won;
      if (b.switchRole && !scanner.busy && !paired) toggle(hands);
      if (won && (b.swap || b.newRound)) again(b.swap, hands);
      if (b.calibrate && left) moveTable(left.m.slice(12, 15), yawOf(left.m));

      // Flying between the views. I leave a giant of myself where I stand.
      const goal = mode === 'avatar' ? 1 : 0, step = dt / FLIGHT;
      phase = Math.abs(goal - phase) <= step ? goal : phase + Math.sign(goal - phase) * step;
      t = phase * phase * (3 - 2 * phase);
      flying = phase !== goal;

      // The snap turn of the right stick (or Q/E): once, until it comes back to the centre.
      const pushed = inp.turn.y < -PUSH;
      if (pushed) aimed = true; else if (Math.abs(inp.turn.x) < CENTRE && Math.abs(inp.turn.y) < CENTRE) aimed = false;
      const steady = pushed || aimed ? 0 : Math.round(inp.turn.x * 1.4), turnEdge = steady && steady !== turnWas ? steady : 0;
      turnWas = steady;

      let message = flying ? 'flying...' : '', walk = [0, 0, 0];
      if (!flying && role() === viewRole()) {
         if (role() === 'giant') message = giantFrame(hands, inp.mouse, turnEdge);
         else ({ walk, message } = miniFrame(inp, hands, dt, eye, turnEdge));
      } else { aiming = false; target = null; }
      if (paired !== 'giant') stepMini(walk);   // a partner's client moves its own mini
      if (game.state.won) message = 'Treasure found!';
      else if (now() < noticeUntil) message = notice;

      // Send my part, and flush what the queue holds.
      link.send({ want: paired ?? viewRole(), table: F(), xr: xr(), giant: () => giantPart(game, desktopBody()),
         mini: () => miniPart(game, { ref: game.state.mini, map: mapOf(settledPose(game.state.mini), F(), mapping.toMini), time: clockTime(), body: desktopBody() }) });
      link.pump();

      // Draw: the world as it is, or, from the avatar's eyes, 12 times bigger round me.
      const f = F();
      worldNode.setMatrix(t ? flight(eye, cg.mTransform(mapping.toMini, eye), mapping.body.yaw - mapping.stand.yaw, t) : cg.mIdentity());
      boardNode.setMatrix(f);
      for (const r of game.level.rooms) {
         nodes.get(r.id).setMatrix(cg.mMultiply(f, Giant.roomPose(game, r.id)));
         roomViews.get(r.id).update(game.state, { roofed: true });
      }
      world.update(xr() ? Math.min(1, t / .3) : 1);
      board.update();
      const W = worldNode.getGlobalMatrix(), shown = Math.max(world.solid, .6 * Math.min(1, Math.max(0, PREVIEW + 1 - since)));
      scanDraw.draw(views, W, shown > 0 ? world.scan : null, shown);

      // The mini: me through the avatar's eyes in its view; standing still where it is when I am the giant. A room in
      // the giant's hand turns and carries it as it carries the room. With a partner: its avatar from its snapshot when I am
      // the giant, and the giant as a figure when I am the mini.
      const fig = partnerFigure(f), show = { head: t < .9, body: t < .9, hands: true };
      const riding = game.held && game.state.mini === game.held.id;
      tilt = riding && paired !== 'giant' ? cg.mMultiply(cg.mMultiply(f, game.held.m), cg.mMultiply(cg.mInverse(settledPose(game.held.id)), cg.mInverse(f))) : cg.mIdentity();
      avatar.root.setMatrix(paired === 'giant' && !fig ? cg.mScale(0) : tilt);
      const right = hands.find(h => h.hand === 'right');
      if (paired === 'giant') { if (fig) avatar.update(fig.poses, fig.feet, { head: true, body: true, hands: true }); }
      else if (mode === 'avatar') avatar.update({ head: mapping.mini(head), left: left && mapping.mini(left.m), right: right && mapping.mini(right.m) }, mapping.feet(head), show);
      else avatar.update({ head: cg.mMultiply(frame(mapping.stand.p, mapping.stand.yaw), cg.mMultiply(cg.mTranslate(0, EYE / 12, 0), cg.mScale(1 / 12))) }, mapping.stand.p, show);
      partnerHead = fig?.poses.head ?? null;
      const statue = !paired && giantAt && t;
      giant.root.setMatrix(statue || (paired === 'mini' && fig) ? cg.mIdentity() : cg.mScale(0));
      if (paired === 'mini' && fig) giant.update(fig.poses, fig.feet, { head: true, body: true, hands: true });
      else if (giantAt) giant.update(giantAt.poses, giantAt.feet, { head: t > .3, body: true, hands: true });

      // The wrist panel, above the left controller (on the desktop, low in front).
      const lm = left?.m, fw = head.slice(8, 11), x = head.slice(0, 3), y = head.slice(4, 7);
      const time = paired === 'giant' ? link.view?.time ?? 0 : clockTime();   // the mini's client keeps the clock
      panel.update({ role: role(), time, penalty: game.state.penalty, won: game.state.won, keys: game.state.keys, message: scanNote || message,
         waiting: link.session.waiting, solo: !paired, goalSymbol: role() === 'giant' ? game.level.goalSymbol : null }, lm ? [lm[12], lm[13] + .1, lm[14]] : eye.map((v, i) => v - fw[i] * .5 - x[i] * .17 - y[i] * .1), eye);
      frames++;
   });

   // Test hooks.
   // (With a partner each hook acts only on my own part: hold and release are the giant's, the rest the mini's.)
   window.doorwaysDebug = {
      get net() { const s = link.session; return { paired, live: s.live, waiting: s.waiting, round: s.round, seed: s.seed, giant: s.giant, id: s.id(), peer: s.peer?.id ?? null }; },
      get partner() { return partnerHead; }, get time() { return paired === 'giant' ? link.view?.time ?? 0 : clockTime(); },      get level() { return game.level; }, get state() { return game.state; }, get role() { return role(); }, get t() { return t; },
      get held() { return game.held; }, get mini() { return game.mini; }, get panel() { return panel.state; }, get frame() { return F(); }, get tilt() { return tilt; }, get frames() { return frames; },
      get textures() { return owned.map(t => t.channel); },
      get scale() { return cg.norm(worldNode.getGlobalMatrix().slice(0, 3)); }, get target() { return target; },
      get feet() { return head && toTable(mapping.stand.p); },
      onFloor() { return !!head && mini.step(game, toTable(mapping.stand.p), 0, 0).room !== null; },
      roomPose: id => Giant.roomPose(game, id),
      hold(id, m) {
         if (paired === 'mini') return false;
         if (game.held?.id !== id) {
            if (game.held || !game.level.rooms.some(r => r.id === id) || !movable(game.level, game.state, id)) return false;
            Giant.grab(game, id, { hand: 'debug', m: Giant.roomPose(game, id) });
         }
         game.held.m = m;
         return true;
      },
      release: () => game.held ? setDown() : null,
      // A teleport to a room: the mini goes only where the rules let it.
      go(id) {
         if (paired === 'giant') return false;
         const to = mini.centre(game, id);
         if (!to || mini.go(game, id).error) return false;
         mapping.setStand(cg.mTransform(F(), to.p), mapping.stand.yaw);
         return true;
      },
      // Put the mini at (x, z) of a room's floor, whatever the rules say (for tests).
      put(id, [x, z]) {
         if (paired === 'giant') return;
         mapping.setStand(cg.mTransform(F(), cg.mTransform(settledPose(id), [x, ROOM.FLOOR, z])), mapping.stand.yaw);
         game.state.mini = id;
         game.mini = { ref: id, local: [x, ROOM.FLOOR, z] };
      },
      // Use a thing in reach, as a hand would: 'take', 'unlock', 'press' or 'open'.
      act(what) {
         if (paired === 'giant') return false;
         const kind = { take: 'key', unlock: 'gate', press: 'switch', open: 'chest' }[what];
         return use(kind === 'key' ? 'grip' : 'trigger', mini.find(game, kind), 'desktop');
      },
      setRole(r) { if (!paired && r !== role() && ['giant', 'mini'].includes(r)) toggle([]); },
      newRound: seed => paired ? false : startRound(seed),
      mapping, world,
   };
   startRound(Number.isInteger(urlSeed) && urlSeed >= 0 ? urlSeed : undefined);

   cleanup = ctxForever.doorwaysCleanup = () => {
      disposers.forEach(d => d());
      scanner.dispose();
      scanDraw.dispose();
      world.setScan(null);
      // Give back each texture channel and GL texture; a channel that another scene has taken since is not ours to free.
      for (const t of owned) {
         if (window._canvas_txtr[t.channel]?.src === t.canvas) {
            delete window._canvas_txtr[t.channel];
            window.txtrChannel = window.txtrChannel.filter(c => c !== t.channel);
         }
         window.clay.gl.deleteTexture(t.texture);
      }
      owned.length = 0;
      delete window.doorwaysDebug;
      delete ctxForever.doorwaysCleanup;
   };
};

export const deinit = () => { cleanup?.(); cleanup = null; };
