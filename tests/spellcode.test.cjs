// Run: node tests/spellcode.test.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const data = file => 'data:text/javascript;base64,' +
   Buffer.from(fs.readFileSync(path.join(__dirname, file), 'utf8')).toString('base64');
(async () => {
   const gameURL = data('../js/scenes/spellcode/game.js');
   const { Game, COLLECTOR, validateProgram, execute, programLines, raySphere } = await import(gameURL);
   const { Session } = await import(data('../js/scenes/spellcode/session.js'));
   const miss = { origin: [0, 1.5, 0], direction: [0, 1, 0] };
   const aim = enemy => {
      const origin = [0, 1.5, 0], v = enemy.position.map((x, i) => x - origin[i]);
      return { origin, direction: v.map(x => x / Math.hypot(...v)) };
   };
   const step = (game, frames, rays = { right: miss }) => {
      for (let i = 0; i < frames; i++) game.tick(.05, rays);
   };
   let checks = 0;
   const test = (name, run) => { run(); console.log('ok - ' + name); checks++; };
   const fire = id => ({ id, type: 'fire' });
   const collect = (send, item) => {
      send({ kind: 'drag', action: 'grab', id: item.id, ray: aim(item) });
      const ray = aim(COLLECTOR);
      const depth = item.position.reduce((sum, v, i) => sum + (v - ray.origin[i]) * ray.direction[i], 0);
      const target = Math.hypot(...COLLECTOR.position.map((v, i) => v - ray.origin[i]));
      const steps = Math.max(1, Math.ceil(Math.abs(depth - target) / .15));
      for (let i = 0; i < steps; i++)
         send({ kind: 'drag', action: 'move', id: item.id, ray, pull: (depth - target) / steps });
      send({ kind: 'drag', action: 'release', id: item.id });
   };
   const loop = (id, count, body) => ({ id, type: 'repeat', value: count, body });
   test('serial and nested duplicate for blocks have different semantics', () => {
      const serial = [loop(2, 2, [fire(1)]), loop(4, 3, [fire(3)])];
      const nested = [loop(2, 2, [loop(4, 3, [fire(1)])])];
      assert.equal(validateProgram(serial).shots, 5);
      assert.equal(validateProgram(nested).shots, 6);
      const fires = p => [...execute(p, () => false)].filter(x => x.type === 'fire').length;
      assert.equal(fires(serial), 5); assert.equal(fires(nested), 6);
      assert.ok(programLines(nested).some(line => line.depth === 3 && line.type === 'fire'));
   });
   test('editor adds the same for block repeatedly and can move into another loop', () => {
      const g = new Game();
      g.inventory.repeat = 2;
      assert.equal(g.edit({ kind: 'add', type: 'repeat', parent: 0, index: 1 }), true);
      assert.equal(g.error.includes('needs a body'), true);
      assert.equal(g.revision, 1); // invalid draft does not replace active gun
      assert.equal(g.edit({ kind: 'move', id: 1, parent: 2, index: 0 }), true);
      assert.equal(g.error, ''); assert.equal(g.revision, 2);
      assert.equal(g.edit({ kind: 'add', type: 'repeat', parent: 0, index: 1 }), true);
      assert.equal(g.edit({ kind: 'move', id: 2, parent: 3, index: 0 }), true);
      assert.equal(validateProgram(g.program).shots, 4);
      assert.equal(g.inventory.repeat, 0);
      assert.equal(g.edit({ kind: 'move', id: 3, parent: 2, index: 0 }), false);
   });
   test('loop parameters cycle and deleting a subtree returns collected blocks', () => {
      const g = new Game();
      g.inventory.repeat = 1;
      g.edit({ kind: 'add', type: 'repeat', parent: 0, index: 0 });
      g.edit({ kind: 'move', id: 1, parent: 2, index: 0 });
      assert.equal(validateProgram(g.program).shots, 2);
      g.edit({ kind: 'cycle', id: 2 });
      assert.equal(validateProgram(g.program).shots, 3);
      g.edit({ kind: 'delete', id: 2 });
      assert.equal(g.inventory.repeat, 1);
      assert.equal(g.inventory.fire, 1);
      assert.match(g.error, /Insert at least one/);
      assert.equal(validateProgram(g.program).shots, 3);
   });
   test('compiler rejects empty/unbounded/over-budget constructions', () => {
      assert.equal(validateProgram([]).ok, false);
      assert.equal(validateProgram([{ id: 1, type: 'hold', body: [] }]).ok, false);
      assert.equal(validateProgram([{ id: 1, type: 'hold', body: [
         { id: 2, type: 'hold', body: [fire(3)] } ] }]).ok, false);
      assert.equal(validateProgram([loop(2, 5, [loop(3, 5, [loop(4, 5, [fire(1)])])])]).ok, false);
      assert.equal(validateProgram([fire(1), fire(1)]).ok, false);
      const g = new Game(); g.inventory.hold = 2;
      assert.equal(g.edit({ kind: 'add', type: 'hold', parent: 0, index: 1 }), true);
      assert.equal(g.edit({ kind: 'add', type: 'hold', parent: 0, index: 2 }), false);
      assert.equal(g.inventory.hold, 1);
      assert.equal(g.draft.length, 2);
   });
   test('while stops on release; for without while finishes after release', () => {
      const g = new Game();
      g.program = [loop(2, 3, [fire(1)])]; g.startWave(); g.press();
      g.tick(.05, { right: miss }); g.release(); step(g, 30);
      assert.equal(g.shots, 3);
      const h = new Game(); h.program = [{ id: 2, type: 'hold', body: [fire(1)] }];
      h.startWave(); h.press(); step(h, 25); assert.ok(h.shots > 2);
      const n = h.shots; h.release(); step(h, 30); assert.equal(h.shots, n);
   });
   test('a live edit affects the next press but not a queued loop', () => {
      const g = new Game();
      g.program = [loop(2, 3, [fire(1)])]; g.draft = structuredClone(g.program);
      g.inventory.repeat = 1; g.startWave(); g.press();
      g.tick(.05, { right: miss }); g.release();
      g.edit({ kind: 'cycle', id: 2 }, 'editor');
      step(g, 40); assert.equal(g.shots, 3);
      g.press(); step(g, 60); assert.equal(g.shots, 8);
   });
   test('a real close hit precedes breach; inside-sphere hits', () => {
      assert.equal(raySphere([0, 0, 1], [0, 0, 1], [0, 0, 0], 2), 0);
      const g = new Game(() => .5); g.startWave(); g.spawn();
      const e = g.enemies[0]; e.distance = 1.001; e.position = [0, 1.5, -1.001];
      g.press(); g.tick(.05, { right: aim(e) });
      assert.equal(g.hp, 5); assert.equal(g.score, 100);
   });
   test('three waves reach a scored victory; five breaches show defeat', () => {
      const win = new Game(() => .5); win.startWave();
      for (let frame = 0; frame < 20000 && win.phase !== 'won'; frame++) {
         if (win.phase === 'upgrade') win.startWave();
         win.release();
         const enemy = win.enemies[0];
         if (enemy && !win.hands.right.runner) win.press();
         win.tick(.05, { right: enemy ? aim(enemy) : miss });
      }
      assert.equal(win.phase, 'won'); assert.equal(win.score, 6000);
      const lose = new Game(() => .5); lose.startWave();
      for (let frame = 0; frame < 5000 && lose.phase !== 'lost'; frame++) lose.tick(.05, { right: miss });
      assert.equal(lose.phase, 'lost');
   });
   test('only the coder can collect a world drop, and a drop is claimed once', () => {
      const g = new Game(() => .5); g.startWave(); g.spawn();
      g.press(); g.tick(.05, { right: aim(g.enemies[0]) });
      assert.equal(g.loot.length, 1);
      const loot = g.loot[0], ray = aim({ position: loot.position });
      assert.equal(g.drag('grab', loot.id, ray, 0, 'shooter'), false);
      assert.equal(g.drag('grab', loot.id, miss), false);
      assert.equal(g.drag('grab', loot.id, ray), true);
      assert.equal(g.drag('move', loot.id, { ...ray, direction: [NaN, 0, 0] }), false);
      assert.equal(g.drag('move', loot.id, ray, 10), false);
      assert.equal(g.drag('release', loot.id), true);
      assert.equal(g.inventory.fire, 0); // Outside the ring: drop stays in the world.
      collect(cmd => g.drag(cmd.action, cmd.id, cmd.ray, cmd.pull), loot);
      assert.equal(g.drag('release', loot.id), false);
      assert.equal(g.inventory.fire, 1);
   });
   test('the gunner cannot edit, and unowned code cannot be added', () => {
      const g = new Game();
      assert.equal(g.edit({ kind: 'delete', id: 1 }, 'shooter'), false);
      assert.equal(g.edit({ kind: 'add', type: 'repeat', parent: 0, index: 1 }, 'editor'), false);
      assert.equal(g.revision, 1);
   });
   test('the two-hand gun still works; editor does not need to shoot', () => {
      const g = new Game(); g.startWave();
      g.press('left'); g.press('right'); g.tick(.05, { left: miss, right: miss });
      assert.equal(g.shots, 2); assert.equal(g.energy, 82);
   });
   test('one authoritative game shares snapshots, coder commands and disconnect freeze', () => {
      const shooterGame = new Game(() => .5), editorGame = new Game();
      let shooter, editor;
      const members = [1, 2];
      shooter = new Session(shooterGame, { room: 'LAB', role: 'shooter', id: () => 1,
         clients: () => members, send: message => editor.receive(message, 1) });
      editor = new Session(editorGame, { room: 'LAB', role: 'editor', id: () => 2,
         clients: () => members, send: message => shooter.receive(message, 2) });
      assert.equal(shooter.waiting, true);
      editor.send('hello');
      assert.equal(shooter.editorId, 2); assert.equal(editor.waiting, false);
      shooterGame.startWave(); shooterGame.spawn();
      shooterGame.press(); shooter.tick(.05, { right: aim(shooterGame.enemies[0]) });
      assert.equal(editorGame.loot.length, 1);
      const item = editorGame.loot[0];
      collect(cmd => editor.command(cmd), item);
      assert.equal(editorGame.inventory.fire, 1);
      editor.command({ kind: 'edit', operation: { kind: 'add', type: 'fire', parent: 0, index: 1 } });
      assert.equal(shooterGame.program.length, 2);
      assert.equal(editorGame.revision, 2);
      shooter.receive({ room: 'LAB', from: 99, role: 'editor', type: 'command',
         command: { kind: 'edit', operation: { kind: 'delete', id: 1 } } }, 99);
      shooter.receive({ room: 'LAB', from: 2, role: 'editor', type: 'command',
         command: { kind: 'edit', operation: { kind: 'delete', id: 1 } } }, 99);
      assert.equal(shooterGame.program.length, 2);
      members.pop();
      assert.equal(shooter.waiting, true);
      const before = shooterGame.time;
      shooter.tick(.05, { right: miss });
      assert.equal(shooterGame.time, before);
      members.splice(0, 1, 3);
      editor.receive({ room: 'LAB', from: 3, role: 'shooter', type: 'snapshot',
         epoch: 'replacement', editorId: 2, editorEpoch: editor.epoch,
         state: new Game().snapshot(), seq: 0, events: [] }, 3);
      assert.equal(editor.hostId, 3);
   });
   test('queued snapshots are immutable; cancellation and disconnect release held loot', () => {
      const g = new Game(), messages = [], members = [1, 2];
      const s = new Session(g, { room: 'LAB', role: 'shooter', id: () => 1,
         clients: () => members, send: m => messages.push(m) });
      g.loot.push({ id: 1, type: 'fire', position: [0, 1.5, -3] });
      s.publish();
      g.drag('grab', 1, aim(g.loot[0]));
      assert.equal(messages[0].state.loot[0].held, undefined);
      assert.equal(g.drag('cancel', 1), true);
      assert.equal(g.inventory.fire, 0);
      g.drag('grab', 1, aim(g.loot[0]));
      s.editorId = 2;
      s.lastEditorMessage = Date.now() - 4000;
      assert.equal(s.waiting, true); // A connected client can leave the scene.
      s.tick(.05, {});
      assert.equal(g.loot[0].held, undefined);
   });
   test('classroom Server.init/send/sync carries two clients and isolates rooms', () => {
      const vm = require('node:vm');
      const source = fs.readFileSync(path.join(__dirname, '../server/client.js'), 'utf8');
      const peers = [], packets = [];
      function peer(id, role, room = 'LAB') {
         const context = { console, name: '', location: { protocol: 'http:', host: 'test' },
            clientID: id, clients: [1, 2, 3], ArrayBuffer,
            WebSocket: class { constructor() { this.readyState = 1; }
               send(packet) { packets.push({ from: id, packet }); } } };
         context.window = context;
         vm.createContext(context);
         vm.runInContext(source + '; server = new Server(); server.neverLoadOrSave();', context);
         const channel = 'spellcode_' + room;
         context.server.init(channel, {}, { accumulate: true });
         const game = new Game();
         const session = new Session(game, { room, role, id: () => id, clients: () => context.clients,
            send: m => context.server.send(channel, m) });
         const p = { context, channel, game, session };
         peers.push(p); return p;
      }
      const gunner = peer(1, 'shooter'), coder = peer(2, 'editor'), other = peer(3, 'editor', 'OTHER');
      function pump() {
         for (let i = 0; i < 4; i++) {
            for (const p of peers) p.context.server.sync(p.channel, (msgs, sender) => {
               for (const m of Object.values(msgs)) p.session.receive(m, sender);
            });
            for (const { from, packet } of packets.splice(0))
               for (const p of peers) if (p.context.clientID !== from)
                  p.context.server.socket.onmessage({ data: packet });
         }
      }
      coder.session.send('hello'); other.session.send('hello'); pump();
      assert.equal(coder.session.waiting, false);
      assert.equal(other.session.waiting, true);
      gunner.game.loot.push({ id: 1, type: 'repeat', position: [0, 1.5, -5] });
      gunner.session.publish(); pump();
      collect(cmd => { coder.session.command(cmd); pump(); }, coder.game.loot[0]);
      assert.equal(coder.game.inventory.repeat, 1);
      coder.session.command({ kind: 'edit', operation: { kind: 'add', type: 'repeat', parent: 0, index: 1 } }); pump();
      coder.session.command({ kind: 'edit', operation: { kind: 'move', id: 1, parent: 2, index: 0 } }); pump();
      assert.equal(validateProgram(gunner.game.program).shots, 2);
      assert.equal(coder.game.revision, gunner.game.revision);
      assert.equal(other.game.loot.length, 0);
   });
   const panelsSource = fs.readFileSync(path.join(__dirname, '../js/scenes/spellcode/panels.js'), 'utf8')
      .replace("'./game.js'", "'" + gameURL + "'");
   const { drawIDE, drawHUD, buttonAt } = await import('data:text/javascript;base64,' + Buffer.from(panelsSource).toString('base64'));
   const texts = [];
   const panel = { buttons: [], ctx: { fillRect() {}, fillText(t) { texts.push(t); },
      measureText(t) { return { width: t.length * 16 }; } } };
   test('VR editor exposes insertion slots and stock; gunner sees read-only text', () => {
      const g = new Game(); g.inventory.repeat = 1;
      drawIDE(panel, g, { role: 'editor', selectedSlot: { parent: 0, index: 1 } });
      assert.equal(buttonAt(panel, 100, 307), 'slot:0:1');
      assert.ok(panel.buttons.some(b => b.id === 'add:repeat'));
      drawIDE(panel, g, { role: 'shooter' });
      assert.ok(!panel.buttons.some(b => b.id.startsWith('add:')));
      assert.ok(texts.includes('SPELLCODE / READ ONLY'));
   });
   test('VR HUD keeps score, instructions, role and explicit win/loss', () => {
      const g = new Game();
      for (const role of ['shooter', 'editor']) for (const phase of ['ready', 'playing', 'won', 'lost']) {
         g.phase = phase; texts.length = 0;
         drawHUD(panel, g, { role, editorOpen: false });
         assert.ok(texts.includes('SCORE'));
         assert.ok(texts.includes('YOU WIN') || phase !== 'won');
         assert.ok(texts.includes('YOU LOSE') || phase !== 'lost');
         if (role === 'editor' && phase === 'ready') assert.equal(buttonAt(panel, 100, 350), undefined);
      }
      texts.length = 0;
      drawHUD(panel, g, { role: 'shooter', paused: true, pauseReason: 'Controller lost.' });
      assert.ok(texts.includes('PAUSED') && texts.includes('Controller lost.') && texts.includes('RESUME RUN'));
   });
   test('in-game role picker and debug controls have clickable buttons', () => {
      const g = new Game();
      drawHUD(panel, g, { mode: 'select', role: 'select', room: 'LAB' });
      assert.equal(buttonAt(panel, 100, 330), 'role:shooter');
      assert.equal(buttonAt(panel, 420, 330), 'role:editor');
      assert.equal(buttonAt(panel, 750, 330), 'role:debug');
      drawHUD(panel, g, { mode: 'select', role: 'select', room: '' });
      assert.equal(buttonAt(panel, 100, 330), undefined);
      assert.equal(buttonAt(panel, 750, 330), 'role:debug');
      g.startWave();
      drawHUD(panel, g, { mode: 'debug', role: 'editor', paused: true });
      assert.equal(buttonAt(panel, 100, 440), 'role:shooter');
      assert.equal(buttonAt(panel, 350, 440), 'role:editor');
      assert.equal(buttonAt(panel, 600, 440), 'pause');
      assert.equal(buttonAt(panel, 800, 440), undefined);
      g.loot.push({ id: 1, type: 'fire', position: [0, 1, -3] });
      drawHUD(panel, g, { mode: 'debug', role: 'editor', paused: true });
      assert.equal(buttonAt(panel, 800, 440), 'collect');
      assert.ok(texts.includes('RESUME'));
   });
   test('restyled panels keep click targets inside the canvas and code text inside its column', () => {
      const g = new Game();
      g.draft = [loop(2, 2, [loop(3, 3, [loop(4, 2, [fire(1)])])])];
      const drawn = [];
      const p = { buttons: [], ctx: { fillRect() {},
         measureText: value => ({ width: String(value).length * 16 }),
         fillText: (value, x, y) => drawn.push({ value, x, y }) } };
      for (const role of ['editor', 'shooter']) {
         drawIDE(p, g, { role, selectedSlot: { parent: 4, index: 1 }, selectedNode: 1 });
         assert.ok(p.buttons.every(b => b.x >= 0 && b.y >= 0 && b.x + b.w <= 1024 && b.y + b.h <= 1024));
         assert.ok(drawn.every(t => t.x + t.value.length * 16 <= 1000));
      }
      for (const mode of ['select', 'debug', 'coop']) {
         drawHUD(p, g, { mode, role: 'editor', room: 'LAB' });
         assert.ok(p.buttons.every(b => b.x + b.w <= 1024 && b.y + b.h <= 512));
      }
   });
   test('audio events survive batched snapshots without replay; paused edits still arrive', () => {
      const g = new Game(), members = [1, 2];
      const editor = new Session(g, { room: 'A', role: 'editor', id: () => 2, clients: () => members, send() {} });
      const packet = seq => ({ from: 1, room: 'A', role: 'shooter', type: 'snapshot', seq,
         epoch: 'gunner', editorId: 2, editorEpoch: editor.epoch,
         state: g.snapshot(), events: [{ type: 'collect', position: [seq, 0, 0] }], paused: true });
      editor.receive(packet(0), 1); // Joining does not replay historical effects.
      assert.equal(editor.tick(.05, {}).length, 0);
      editor.receive(packet(1), 1); editor.receive(packet(2), 1); editor.receive(packet(2), 1);
      assert.equal(editor.tick(.05, {}).length, 2);
      assert.equal(editor.tick(.05, {}).length, 0);
      assert.equal(editor.paused, true);
      const hostGame = new Game(), sent = [];
      const host = new Session(hostGame, { room: 'A', role: 'shooter', id: () => 1,
         clients: () => members, send: m => sent.push(m) });
      hostGame.edit({ kind: 'delete', id: 1 });
      assert.equal(host.tick(.05, {}, true)[0].type, 'compile');
      assert.equal(sent.at(-1).events[0].ok, false);
   });
   test('spread emits one sound per volley and collection emits a confirmed event', () => {
      const g = new Game();
      g.program = [{ id: 2, type: 'spread', value: 5, body: [fire(1)] }];
      g.startWave(); g.press();
      const events = g.tick(.05, { right: miss });
      assert.equal(events.filter(e => e.type === 'shot').length, 5);
      assert.equal(events.filter(e => e.type === 'shot' && e.sound).length, 1);
      g.loot.push({ id: 1, type: 'fire', position: COLLECTOR.position.slice() });
      g.drag('grab', 1, aim(COLLECTOR)); g.drag('release', 1);
      assert.equal(g.takeEvents()[0].type, 'collect');
      assert.equal(g.takeEvents().length, 0);
   });
   console.log(checks + ' Spellcode checks passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
