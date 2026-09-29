// Run: node tests/spellcode.test.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const data = file => 'data:text/javascript;base64,' +
   Buffer.from(fs.readFileSync(path.join(__dirname, file), 'utf8')).toString('base64');
(async () => {
   const gameURL = data('../js/scenes/spellcode/game.js');
   const { Game, validateProgram, execute, programLines, raySphere } = await import(gameURL);
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
      assert.equal(g.pickup(loot.id, ray, 'shooter'), false);
      assert.equal(g.pickup(loot.id, miss, 'editor'), false);
      assert.equal(g.pickup(loot.id, ray, 'editor'), true);
      assert.equal(g.pickup(loot.id, ray, 'editor'), false);
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
         clients: () => members, send: message => editor.receive(message) });
      editor = new Session(editorGame, { room: 'LAB', role: 'editor', id: () => 2,
         clients: () => members, send: message => shooter.receive(message) });
      assert.equal(shooter.waiting, true);
      editor.send('hello');
      assert.equal(shooter.editorId, 2); assert.equal(editor.waiting, false);
      shooterGame.startWave(); shooterGame.spawn();
      shooterGame.press(); shooter.tick(.05, { right: aim(shooterGame.enemies[0]) });
      assert.equal(editorGame.loot.length, 1);
      const item = editorGame.loot[0];
      editor.command({ kind: 'pickup', id: item.id, ray: aim({ position: item.position }) });
      assert.equal(editorGame.inventory.fire, 1);
      editor.command({ kind: 'edit', operation: { kind: 'add', type: 'fire', parent: 0, index: 1 } });
      assert.equal(shooterGame.program.length, 2);
      assert.equal(editorGame.revision, 2);
      shooter.receive({ room: 'LAB', from: 99, role: 'editor', type: 'command',
         command: { kind: 'edit', operation: { kind: 'delete', id: 1 } } });
      assert.equal(shooterGame.program.length, 2);
      members.pop();
      assert.equal(shooter.waiting, true);
      const before = shooterGame.time;
      shooter.tick(.05, { right: miss });
      assert.equal(shooterGame.time, before);
      members.splice(0, 1, 3);
      editor.receive({ room: 'LAB', from: 3, role: 'shooter', type: 'snapshot',
         state: new Game().snapshot(), seq: 0, events: [] });
      assert.equal(editor.hostId, 3);
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
   console.log(checks + ' Spellcode checks passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
