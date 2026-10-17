// Run: node tests/spellcode.test.cjs
const assert = require('node:assert/strict');
const load = require('./esm.cjs');
(async () => {
   const { Game, WAVES, ATTACKS, allNodes, validateProgram, execute, programLines, raySphere } = await load('js/scenes/spellcode/game.js');
   const { DAEMONS, normalizeDaemon, daemonSource } = await load('js/scenes/spellcode/daemons.js');
   const { Root, normalizeScript, fallbackScript, simulate } = await load('js/scenes/spellcode/root.js');
   const { Session } = await load('js/scenes/spellcode/session.js');
   const origin = [0, 1.5, 0];
   const miss = { origin, direction: [0, 1, 0] };
   const aim = target => {
      const v = target.position.map((x, i) => x - origin[i]);
      return { origin, direction: v.map(x => x / Math.hypot(...v)) };
   };
   const step = (game, frames, rays = { right: miss }) => { for (let i = 0; i < frames; i++) game.tick(.05, rays); };
   let checks = 0;
   const test = async (name, run) => { await run(); console.log('ok - ' + name); checks++; };
   const fire = id => ({ id, type: 'fire' });
   const loop = (id, count, body) => ({ id, type: 'repeat', value: count, body });
   const fresh = (program = [fire(1)]) => {
      const g = new Game(() => .5);
      g.program = structuredClone(program); g.draft = structuredClone(program); g.nextNodeId = 50;
      return g;
   };
   const playing = (program, wave = 2) => {
      const g = fresh(program);
      g.phase = 'playing'; g.wave = wave; g.root.budget = 99; g.spawnIn = 999;
      for (const type in ATTACKS) g.seen[type] = true; // Skip the longer first-time warnings.
      return g;
   };
   const daemon = (g, kind, at = { angle: 0, distance: 4, y: 1.5 }) => g.spawn(kind, at);

   await test('serial and nested duplicate for blocks have different semantics', () => {
      const serial = [loop(2, 2, [fire(1)]), loop(4, 3, [fire(3)])];
      const nested = [loop(2, 2, [loop(4, 3, [fire(1)])])];
      assert.equal(validateProgram(serial).shots, 5);
      assert.equal(validateProgram(nested).shots, 6);
      const fires = p => [...execute(p, () => false)].filter(x => x.type === 'fire').length;
      assert.equal(fires(serial), 5); assert.equal(fires(nested), 6);
      assert.ok(programLines(nested).some(line => line.depth === 3 && line.type === 'fire'));
   });
   await test('the run starts with while { fire } and starter stock inside four slots', () => {
      const g = new Game();
      assert.equal(validateProgram(g.program).ok, true);
      assert.equal(g.program[0].type, 'hold');
      assert.deepEqual([g.inventory.fire, g.inventory.repeat, g.inventory.spread, g.inventory.power], [1, 1, 1, 0]);
      assert.equal(g.capacity, 4);
   });
   await test('editor adds, nests and moves blocks; capacity limits the program', () => {
      const g = fresh();
      g.inventory.repeat = 3;
      assert.equal(g.edit({ kind: 'add', type: 'repeat', parent: 0, index: 1 }), true);
      assert.match(g.error, /needs a body/);
      assert.equal(g.revision, 1); // invalid draft does not replace active gun
      assert.equal(g.edit({ kind: 'move', id: 1, parent: 50, index: 0 }), true);
      assert.equal(g.error, ''); assert.equal(g.revision, 2);
      assert.equal(g.edit({ kind: 'add', type: 'repeat', parent: 0, index: 1 }), true);
      assert.equal(g.edit({ kind: 'move', id: 50, parent: 51, index: 0 }), true);
      assert.equal(validateProgram(g.program).shots, 4);
      assert.equal(g.edit({ kind: 'move', id: 51, parent: 50, index: 0 }), false);
      assert.equal(g.edit({ kind: 'add', type: 'repeat', parent: 0, index: 1 }), true);
      assert.equal(g.edit({ kind: 'add', type: 'repeat', parent: 0, index: 1 }), false); // 4/4 slots
   });
   await test('loop parameters cycle and deleting a subtree returns stock', () => {
      const g = fresh();
      g.inventory.repeat = 1;
      g.edit({ kind: 'add', type: 'repeat', parent: 0, index: 0 });
      g.edit({ kind: 'move', id: 1, parent: 50, index: 0 });
      g.edit({ kind: 'cycle', id: 50 });
      assert.equal(validateProgram(g.program).shots, 3);
      g.edit({ kind: 'delete', id: 50 });
      assert.equal(g.inventory.repeat, 1); assert.equal(g.inventory.fire, 2); // starter fire + refund
      assert.match(g.error, /Insert at least one/);
      assert.equal(validateProgram(g.program).shots, 3);
   });
   await test('compiler rejects empty, unbounded and over-budget programs, including top-level fire()', () => {
      assert.equal(validateProgram([]).ok, false);
      assert.equal(validateProgram([{ id: 1, type: 'hold', body: [] }]).ok, false);
      assert.equal(validateProgram([{ id: 1, type: 'hold', body: [{ id: 2, type: 'hold', body: [fire(3)] }] }]).ok, false);
      assert.equal(validateProgram([{ id: 1, type: 'hold', body: [{ id: 2, type: 'wait', value: .2 }] }]).ok, false);
      assert.equal(validateProgram([loop(2, 5, [loop(3, 5, [loop(4, 5, [fire(1)])])])]).ok, false);
      assert.equal(validateProgram([fire(1), fire(1)]).ok, false);
      const many = n => Array.from({ length: n }, (_, i) => fire(i + 1));
      assert.equal(validateProgram(many(64)).ok, true);
      assert.equal(validateProgram(many(65)).ok, false);
   });
   await test('while stops on release; for finishes after release; no hidden while wait', () => {
      const g = playing([loop(2, 3, [fire(1)])]);
      g.press(); g.tick(.05, { right: miss }); g.release(); step(g, 30);
      assert.equal(g.shots, 3);
      const h = playing([{ id: 2, type: 'hold', body: [fire(1)] }]);
      h.press(); step(h, 20); // 1 s at the 0.18 s minimum interval
      assert.ok(h.shots >= 5 && h.shots <= 6, h.shots);
      const n = h.shots; h.release(); step(h, 30); assert.equal(h.shots, n);
   });
   await test('volley weight sets the firing interval instead of energy', () => {
      const g = playing([{ id: 2, type: 'hold', body: [{ id: 3, type: 'spread', value: 5, body: [{ id: 4, type: 'power', value: 3, body: [fire(1)] }] }] }]);
      g.press(); step(g, 60); // 3 s at 2.7 s per volley
      assert.equal(g.shots, 10);
      assert.equal(g.hands.right.cooldown > 1, true);
      // Ideal damage per second is the same for every modifier: 1 / 0.18.
      const p = playing([{ id: 2, type: 'power', value: 2, body: [fire(1)] }]);
      p.press(); p.tick(.05, { right: miss });
      assert.ok(Math.abs(p.hands.right.cooldown - .36) < 1e-9);
   });
   await test('a held while adopts a newer build at the end of its cycle', () => {
      const g = playing([{ id: 2, type: 'hold', body: [fire(1)] }]);
      g.inventory.spread = 1;
      g.press(); step(g, 4);
      g.edit({ kind: 'add', type: 'spread', parent: 2, index: 0 });
      g.edit({ kind: 'move', id: 1, parent: 50, index: 0 });
      const before = g.shots; step(g, 12);
      assert.ok(g.shots - before >= 6, 'spread volleys were not adopted while held');
   });
   await test('daemon traits: armor, shield, phase, regen, split, pierce and chain', () => {
      const g = playing([fire(1)]);
      const brick = daemon(g, 'brick');
      g.damage(brick, 1, aim(brick).direction); assert.equal(brick.hp, 5.75);
      g.damage(brick, 3, aim(brick).direction); assert.equal(brick.hp, 3.75);
      const bulwark = daemon(g, 'bulwark', { angle: 0, distance: 5, y: 1.5 });
      g.damage(bulwark, 3, aim(bulwark).direction);
      assert.deepEqual([bulwark.shield, bulwark.hp], [1, 3]);
      g.damage(bulwark, 1, [1, 0, 0]); // From the side: bypasses the shield.
      assert.equal(bulwark.hp, 2);
      const pulse = daemon(g, 'pulse'); pulse.vulnerable = false;
      g.damage(pulse, 3, aim(pulse).direction); assert.equal(pulse.hp, 3);
      const mender = daemon(g, 'mender'); mender.hp = 2;
      g.moveEnemies(.6); assert.equal(mender.hp, 3);
      g.enemies = [];
      const splitter = daemon(g, 'splitter');
      g.damage(splitter, 3, aim(splitter).direction);
      assert.equal(g.enemies.filter(e => e.kind === 'skitter').length, 3);
      const p = playing([{ id: 2, type: 'pierce', body: [fire(1)] }]);
      const front = daemon(p, 'skitter', { angle: 0, distance: 3, y: 1.5 }), back = daemon(p, 'skitter', { angle: 0, distance: 5, y: 1.5 });
      front.strafe = back.strafe = null; p.place(front); p.place(back);
      p.press(); p.tick(.05, { right: aim(front) });
      assert.equal(p.kills, 2);
      const c = playing([{ id: 2, type: 'chain', body: [fire(1)] }]);
      const target = daemon(c, 'drone', { angle: 0, distance: 5, y: 1.5 });
      const shielded = daemon(c, 'bulwark', { angle: .2, distance: 5, y: 1.5 });
      c.press(); c.tick(.05, { right: aim(target) });
      assert.equal(target.hp, 1); assert.equal(shielded.hp, 2); assert.equal(shielded.shield, 4);
   });
   await test('time-based waves repair one segment, add slots and reach victory after four waves', () => {
      const g = new Game(() => .5);
      for (let wave = 1; wave <= 4; wave++) {
         assert.equal(g.startWave(), true);
         g.hp = 3;
         for (let t = 0; t < WAVES[wave - 1].duration + 1 && g.phase === 'playing'; t += .05) {
            g.hp = Math.max(g.hp, 3);
            g.tick(.05, {});
         }
         assert.equal(g.phase, wave === 4 ? 'won' : 'upgrade');
         assert.equal(g.enemies.length, 0);
         assert.equal(g.hp, 4);
         assert.equal(g.capacity, 4 + 2 * wave);
      }
      const lose = new Game(() => .5); lose.startWave();
      for (let i = 0; i < 4000 && lose.phase === 'playing'; i++) { lose.waveTime = 0; lose.tick(.05, {}); }
      assert.equal(lose.phase, 'lost');
   });
   await test('director runs a tactic; the coder unlocks a gun with glyphs the gunner reads', () => {
      const g = playing([{ id: 2, type: 'hold', body: [fire(1)] }]);
      g.script = { tactics: [{ at: 1, do: { type: 'GUN_LOCK', hand: 'right' }, line: 'Not anymore.' }] };
      step(g, 21);
      assert.equal(g.root.target, 'gunner'); assert.equal(g.root.line, 'Not anymore.');
      step(g, 21);
      const lock = g.active('GUN_LOCK');
      assert.ok(lock && lock.glyphs.length === 4);
      g.press('right'); step(g, 5); assert.equal(g.shots, 0);
      assert.equal(g.root.exposed > 0, true);
      assert.equal(g.command({ kind: 'unlock', glyphs: [9, 9, 9, 9] }), false);
      assert.equal(g.command({ kind: 'unlock', glyphs: lock.glyphs }), true);
      step(g, 1);
      assert.equal(g.attacks.length, 0);
      assert.deepEqual(g.log[0].resolvedBy, 'coder');
      g.press('right'); step(g, 2); assert.ok(g.shots > 0);
   });
   await test('one countermeasure per player, an 8 s gap and the threat budget', () => {
      const g = playing([fire(1)]);
      assert.equal(g.startAttack({ type: 'INJECT', code: 'wait' }), true);
      assert.equal(g.startAttack({ type: 'PANEL_LOCK' }), false); // Coder already targeted.
      assert.equal(g.startAttack({ type: 'GUN_LOCK', hand: 'left' }), true);
      assert.equal(g.startAttack({ type: 'BLACKOUT' }), false); // Gunner already targeted.
      g.endAttack(g.attacks[1], null);
      assert.equal(g.startAttack({ type: 'BLACKOUT' }), false); // 8 s gap.
      g.waveTime += 9;
      g.root.spent = 97; g.hp = 2;
      assert.equal(g.startAttack({ type: 'BLACKOUT' }), false); // Over 70% of the budget.
   });
   await test('INJECT hides a line that looks like fire(); deleting it refunds nothing; timeout strips it', () => {
      const g = playing([{ id: 1, type: 'hold', body: [fire(2)] }]);
      g.startAttack({ type: 'INJECT', code: 'misfire' }); step(g, 21);
      const injected = g.program[0].body.find(n => n.foreign);
      assert.equal(injected.type, 'misfire');
      assert.equal(programLines(g.draft).filter(l => l.text === 'fire(weapon, hand);').length, 2);
      const stock = { ...g.inventory };
      g.edit({ kind: 'delete', id: injected.id });
      assert.deepEqual(g.inventory, stock);
      step(g, 1);
      assert.equal(g.log.at(-1).resolvedBy, 'coder');
      const h = playing([fire(1)]);
      h.startAttack({ type: 'INJECT', code: 'wait' }); step(h, 21);
      assert.equal(h.program.length, 2);
      step(h, 30 * 20 + 2);
      assert.equal(h.program.length, 1); assert.equal(h.draft.length, 1);
      // Deleting the real fire() keeps the old live program; the gun never ends up empty.
      const m = playing([{ id: 1, type: 'hold', body: [fire(2)] }]);
      m.startAttack({ type: 'INJECT', code: 'misfire' }); step(m, 21);
      assert.equal(m.edit({ kind: 'delete', id: 2 }), true);
      assert.match(m.error, /needs a reachable fire/);
      assert.ok(allNodes(m.program).some(n => n.type === 'fire'));
      step(m, 30 * 20 + 2);
      assert.equal(validateProgram(m.program).ok, true);
   });
   await test('PANEL_LOCK blocks edits until the gunner shoots the lock; THIEF returns stock when shot', () => {
      const g = playing([fire(1)]);
      g.startAttack({ type: 'PANEL_LOCK' }); step(g, 21);
      const lock = g.enemies.find(e => e.special === 'lock');
      g.inventory.fire = 1;
      assert.equal(g.edit({ kind: 'add', type: 'fire', parent: 0, index: 1 }), false);
      g.damage(lock, 2, aim(lock).direction); step(g, 1);
      assert.equal(g.log.at(-1).resolvedBy, 'gunner');
      assert.equal(g.edit({ kind: 'add', type: 'fire', parent: 0, index: 1 }), true);
      const t = playing([fire(1)]);
      t.inventory = { ...t.inventory, fire: 0, repeat: 0, spread: 1 };
      t.startAttack({ type: 'THIEF' }); step(t, 21);
      const thief = t.enemies.find(e => e.special === 'thief');
      assert.equal(t.inventory.spread, 0);
      t.damage(thief, 1, aim(thief).direction);
      assert.equal(t.inventory.spread, 1);
      const escape = playing([fire(1)]);
      escape.inventory.spread = 1; escape.inventory.fire = escape.inventory.repeat = 0;
      escape.startAttack({ type: 'THIEF' }); step(escape, 21 + 6 * 20 + 2);
      assert.equal(escape.inventory.spread, 0);
      assert.equal(escape.log.at(-1).resolvedBy, 'timeout');
      // The wave ending while a thief is alive returns its block.
      const purge = playing([fire(1)]);
      purge.inventory.spread = 1; purge.inventory.fire = purge.inventory.repeat = 0;
      purge.startAttack({ type: 'THIEF' }); step(purge, 21);
      assert.equal(purge.inventory.spread, 0);
      purge.waveTime = WAVES[1].duration; step(purge, 1);
      assert.equal(purge.phase, 'upgrade'); assert.equal(purge.inventory.spread, 1);
   });
   await test('BLACKOUT lands on a still head, holds breaches, and can be dodged or shot down', () => {
      const g = playing([fire(1)]);
      g.startAttack({ type: 'BLACKOUT' }); step(g, 25);
      assert.ok(g.blackout > 0);
      const near = daemon(g, 'drone', { angle: 0, distance: 1.01, y: 1.5 });
      step(g, 10);
      assert.equal(g.hp, 5); assert.equal(near.distance, 1);
      step(g, 30);
      assert.ok(g.hp < 5);
      const d = playing([fire(1)]);
      d.startAttack({ type: 'BLACKOUT' });
      for (let i = 0; i < 25; i++) d.tick(.05, {}, [.6, 1.6, 0]);
      assert.equal(d.blackout, 0); assert.equal(d.log[0].resolvedBy, 'gunner');
      const s = playing([fire(1)]);
      s.startAttack({ type: 'BLACKOUT' }); step(s, 10);
      s.press(); s.tick(.05, { right: aim(s.packet) });
      step(s, 1);
      assert.equal(s.packet, null); assert.equal(s.log[0].resolvedBy, 'gunner');
   });
   await test('POPUP dialogs absorb bolts until their close button is shot', () => {
      const g = playing([fire(1)]);
      g.startAttack({ type: 'POPUP', count: 1 }); step(g, 21);
      const popup = g.popups[0], behind = daemon(g, 'drone', { angle: 0, distance: 6, y: popup.position[1] });
      behind.position = [popup.position[0], popup.position[1], -6];
      g.press(); g.tick(.05, { right: aim({ position: popup.position }) }); g.release();
      assert.equal(behind.hp, 2); assert.equal(g.popups.length, 1);
      step(g, 4);
      g.press(); g.tick(.05, { right: aim({ position: [popup.position[0] + .24, popup.position[1] + .15, popup.position[2]] }) });
      step(g, 1);
      assert.equal(g.popups.length, 0); assert.equal(g.log[0].resolvedBy, 'gunner');
   });
   await test('three hits on the exposed eye halve the attack and drain the budget', () => {
      const g = playing([{ id: 2, type: 'hold', body: [fire(1)] }]);
      g.startAttack({ type: 'GUN_LOCK', hand: 'left' }); step(g, 21);
      const left = g.active('GUN_LOCK').left, budget = g.root.budget;
      g.press(); for (let i = 0; i < 12; i++) g.tick(.05, { right: aim({ position: [0, 3.2, -13.4] }) });
      assert.ok(g.active('GUN_LOCK').left < left / 2 + .1);
      assert.equal(g.root.budget, budget - 1);
   });
   await test('daemon designs are clamped, rendered as source, and tested against their own solution', () => {
      const def = normalizeDaemon({ name: 'mitosis', hp: 99, size: 9, traits: [{ type: 'armor', n: 7 },
         { type: 'shield', hp: 3 }, { type: 'warp' }], parts: [{ form: 'teapot' }, { form: 'cube', pos: [5, 0, 0] }] }, 'x');
      assert.equal(def.hp, 8); assert.equal(def.size, .45);
      assert.deepEqual(def.traits.map(t => t.type), ['approach', 'armor', 'shield']);
      assert.equal(def.traits[1].n, 2);
      assert.equal(def.parts[0].pos[0], 1);
      assert.ok(def.parts.some(p => p.tag === 'shield'));
      assert.equal(daemonSource(def)[0], 'daemon MITOSIS (hp 8) {');
      const power = [{ id: 1, type: 'hold', body: [{ id: 2, type: 'power', value: 3, body: [fire(3)] }] }];
      assert.ok(simulate(DAEMONS.brick, power) > 0);
      assert.equal(simulate(normalizeDaemon({ hp: 8, traits: [{ type: 'approach', speed: .8 }, { type: 'armor', n: 2 },
         { type: 'regen', n: 2, every: .5 }] }, 'y'), [{ id: 1, type: 'hold', body: [fire(2)] }]), null);
   });
   await test('normalizeScript accepts a fair plan and rejects an unbeatable or over-stocked solution', () => {
      const g = new Game(() => .5); g.wave = 1; g.phase = 'upgrade';
      const raw = { intro: 'x'.repeat(99), rationale: ['a', 'b', 'c', 'd'],
         daemon: { name: 'shard', hp: 3, traits: [{ type: 'approach', speed: .4 }, { type: 'armor', n: 1 }],
            solution: [{ type: 'hold', body: [{ type: 'power', value: 2, body: [{ type: 'fire' }] }] }] },
         spawns: [{ count: 99, start: -5, every: 1 }],
         tactics: [{ at: 20, do: { type: 'GUN_LOCK', hand: 'left' }, line: 'Hand.' }, { at: 5, do: { type: 'NUKE' } },
            { when: { metric: 'gunner.rightHandShare', op: '>', value: .7, forSeconds: 99 }, do: { type: 'POPUP', count: 9 } }] };
      const { script } = normalizeScript(raw, g);
      assert.equal(script.intro.length, 60); assert.equal(script.rationale.length, 3);
      assert.deepEqual(script.need, ['power']);
      // A group spawns no faster than one starter gun can clear it.
      const starterTime = simulate(script.daemon, [{ id: 1, type: 'hold', body: [fire(2)] }]);
      assert.deepEqual(script.spawns[0], { daemon: 'root2', count: 8, start: 0, every: Math.max(2, starterTime) });
      assert.equal(script.tactics.length, 2);
      assert.deepEqual(script.tactics[1].when.forSeconds, 30); assert.equal(script.tactics[1].do.count, 3);
      g.prepare(script);
      assert.equal(g.offers[0], 'power'); assert.equal(new Set(g.offers).size, 3);
      const weak = structuredClone(raw); weak.daemon.traits.push({ type: 'regen', n: 2, every: .5 });
      weak.daemon.hp = 8; weak.daemon.solution = [{ type: 'hold', body: [{ type: 'fire' }] }];
      assert.match(normalizeScript(weak, g).errors[0], /did not kill/);
      const greedy = structuredClone(raw);
      greedy.daemon.solution = [{ type: 'hold', body: [{ type: 'power', value: 2, body: [{ type: 'pierce', body: [{ type: 'fire' }] }] }] }];
      assert.match(normalizeScript(greedy, g).errors[0], /more than one block type/);
      // Its own solution kills it, but plain fire cannot: armor plus fast regen would be a hard lock.
      const immune = structuredClone(raw); immune.daemon.hp = 1; immune.daemon.traits.push({ type: 'regen', n: 2, every: .5 });
      assert.match(normalizeScript(immune, g).errors[0], /immune/);
   });
   await test('every base daemon dies to the starter program on one gun before it breaches', () => {
      for (const def of Object.values(DAEMONS)) if (!def.special)
         assert.ok(simulate(def, [{ id: 1, type: 'hold', body: [fire(2)] }]) !== null, def.id);
   });
   await test('ROOT retries once with errors, falls back offline, and discards stale plans', async () => {
      const good = { daemon: { name: 'ok', hp: 2, traits: [{ type: 'approach', speed: .4 }],
         solution: [{ type: 'hold', body: [{ type: 'fire' }] }] }, tactics: [] };
      const bad = { daemon: { hp: 8, solution: [] } };
      const g = new Game(() => .5); g.startWave();
      const asked = [];
      const root = new Root(g, async messages => { asked.push(messages); return asked.length === 1 ? bad : good; });
      g.waveTime = 40; root.update();
      await new Promise(r => setTimeout(r, 0));
      assert.equal(asked.length, 2);
      assert.match(asked[1][1].content, /previous plan was rejected/);
      assert.equal(g.nextScript.source, 'ai'); assert.equal(g.nextScript.daemon.name, 'OK');
      const offline = new Game(() => .5); offline.startWave();
      const r2 = new Root(offline, async () => { throw new Error('OpenAI API key not configured'); });
      offline.waveTime = 40; r2.update(); await new Promise(r => setTimeout(r, 0));
      assert.equal(offline.nextScript.source, 'fallback');
      assert.equal(r2.records[0].attempts.length, 1);
      // Malformed JSON is retried; a top-level solution or a single block is accepted.
      const garbled = new Game(() => .5); garbled.startWave();
      const replies = [() => JSON.parse('{"daemon": {'), () => ({ ...good, daemon: { ...good.daemon, solution: undefined },
         solution: { type: 'hold', body: [{ type: 'fire' }] } })];
      let asked4 = 0;
      const r4 = new Root(garbled, async () => replies[asked4++]());
      garbled.waveTime = 40; r4.update(); await new Promise(r => setTimeout(r, 0));
      assert.equal(asked4, 2); assert.equal(garbled.nextScript.source, 'ai');
      let resolve;
      const slow = new Game(() => .5); slow.startWave();
      const r3 = new Root(slow, () => new Promise(r => { resolve = r; }));
      slow.waveTime = 40; r3.update();
      slow.reset(); // Replay before the model answers.
      resolve(good); await new Promise(r => setTimeout(r, 0));
      assert.equal(slow.nextScript, null);
      const late = new Game(() => .5); late.startWave(); late.phase = 'upgrade';
      new Root(late, null).prepare();
      assert.equal(late.nextScript.source, 'fallback');
      assert.equal(late.startWave(), true); assert.equal(late.script.daemon.id, 'root2');
   });
   await test('fallback scripts cover waves 2-4 and target the busier hand', () => {
      const g = new Game(() => .5);
      g.stats.volleys = { left: 9, right: 1 };
      for (const wave of [1, 2, 3]) {
         g.wave = wave;
         const script = fallbackScript(g);
         assert.ok(script.tactics.length >= 2);
         assert.equal(script.daemon.id, 'root' + (wave + 1));
      }
      g.wave = 1;
      assert.equal(fallbackScript(g).tactics[0].do.hand, 'left');
   });
   await test('one authoritative game shares snapshots, coder commands and disconnect freeze', () => {
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
      shooterGame.startWave(); shooter.tick(.05, {});
      editor.command({ kind: 'edit', operation: { kind: 'add', type: 'fire', parent: 1, index: 1 } });
      assert.equal(shooterGame.program[0].body.length, 2);
      assert.equal(editorGame.revision, 2);
      shooterGame.prepare({ need: ['chain'] }); shooter.publish();
      editor.command({ kind: 'pick', type: 'chain' });
      assert.equal(shooterGame.inventory.chain, 1); assert.deepEqual(editorGame.offers, []);
      editor.command({ kind: 'panel', open: true });
      assert.equal(shooterGame.panel.open, true);
      shooter.receive({ room: 'LAB', from: 99, role: 'editor', type: 'command',
         command: { kind: 'edit', operation: { kind: 'delete', id: 1 } } }, 99);
      assert.equal(shooterGame.program.length, 1);
      members.pop();
      assert.equal(shooter.waiting, true);
      const before = shooterGame.time;
      shooter.tick(.05, { right: miss });
      assert.equal(shooterGame.time, before);
   });
   await test('classroom Server.init/send/sync carries two clients and isolates rooms', () => {
      const vm = require('node:vm'), fs = require('node:fs'), path = require('node:path');
      const source = fs.readFileSync(path.join(__dirname, '../server/client.js'), 'utf8');
      const peers = [], packets = [];
      function peer(id, role, room = 'LAB') {
         const context = { console, name: '', location: { protocol: 'http:', host: 'test' },
            clientID: id, clients: [1, 2, 3], ArrayBuffer,
            WebSocket: class { constructor() { this.readyState = 1; } send(packet) { packets.push({ from: id, packet }); } } };
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
               for (const p of peers) if (p.context.clientID !== from) p.context.server.socket.onmessage({ data: packet });
         }
      }
      coder.session.send('hello'); other.session.send('hello'); pump();
      assert.equal(coder.session.waiting, false);
      assert.equal(other.session.waiting, true);
      gunner.game.inventory.repeat = 1; gunner.session.publish(); pump();
      coder.session.command({ kind: 'edit', operation: { kind: 'add', type: 'repeat', parent: 0, index: 1 } }); pump();
      coder.session.command({ kind: 'edit', operation: { kind: 'move', id: 1, parent: 3, index: 0 } }); pump();
      assert.equal(gunner.game.program[0].type, 'repeat');
      assert.equal(coder.game.revision, gunner.game.revision);
      assert.equal(other.game.revision, 1);
   });
   const panels = await load('js/scenes/spellcode/panels.js');
   const { drawIDE, drawHUD, buttonAt } = panels;
   const texts = [];
   const panel = { buttons: [], ctx: { fillRect() {}, fillText(t) { texts.push(t); },
      measureText(t) { return { width: String(t).length * 16 }; } } };
   await test('VR editor exposes slots, eight stock buttons and a glyph pad; gunner sees read-only text', () => {
      const g = new Game();
      for (const type in g.inventory) g.inventory[type] = 1;
      drawIDE(panel, g, { role: 'editor', selectedSlot: { parent: 0, index: 1 } });
      assert.equal(buttonAt(panel, 100, 182), 'slot:0:0');
      assert.equal(panel.buttons.filter(b => b.id.startsWith('add:')).length, 8);
      assert.ok(panel.buttons.every(b => b.x >= 0 && b.y >= 0 && b.x + b.w <= 1024 && b.y + b.h <= 1024));
      g.attacks = [{ type: 'GUN_LOCK', hand: 'right', warn: 0, glyphs: [0, 1, 2, 3] }];
      drawIDE(panel, g, { role: 'editor', glyphs: [] });
      assert.equal(buttonAt(panel, 100, 740), 'glyph:0');
      g.attacks = [{ type: 'PANEL_LOCK', warn: 0 }];
      drawIDE(panel, g, { role: 'editor' });
      assert.ok(!panel.buttons.some(b => /^(slot|node|add):/.test(b.id)));
      drawIDE(panel, g, { role: 'shooter' });
      assert.ok(!panel.buttons.some(b => b.id.startsWith('add:')));
      assert.ok(texts.includes('SPELLCODE / READ ONLY'));
   });
   await test('break shows intercepted source and draft offers to the coder', () => {
      const g = new Game(); g.phase = 'upgrade'; g.wave = 1;
      g.prepare(fallbackScript(g));
      texts.length = 0;
      drawIDE(panel, g, { role: 'editor' });
      assert.ok(texts.some(t => String(t).startsWith('daemon BULWARK')));
      assert.equal(panel.buttons.filter(b => b.id.startsWith('pick:')).length, 3);
   });
   await test('HUD keeps score, uplink, ROOT lines, lock glyphs for the gunner only, and win/loss', () => {
      const g = new Game();
      for (const role of ['shooter', 'editor']) for (const phase of ['ready', 'playing', 'won', 'lost']) {
         g.phase = phase; g.wave = 1; texts.length = 0;
         drawHUD(panel, g, { role, editorOpen: false });
         assert.ok(texts.includes('SCORE'));
         assert.ok(texts.some(t => String(t).startsWith('UPLINK')));
         assert.ok(texts.includes('YOU WIN') || phase !== 'won');
         assert.ok(texts.includes('YOU LOSE') || phase !== 'lost');
         if (role === 'editor' && phase === 'ready') assert.equal(buttonAt(panel, 100, 350), undefined);
      }
      g.phase = 'playing'; g.attacks = [{ type: 'GUN_LOCK', hand: 'left', warn: 0, glyphs: [0, 0, 1, 2] }];
      texts.length = 0; drawHUD(panel, g, { role: 'shooter' });
      assert.ok(texts.includes('LEFT GUN LOCKED / READ TO CODER: ▲ ▲ ● ■'));
      texts.length = 0; drawHUD(panel, g, { role: 'editor' });
      assert.ok(!texts.some(t => String(t).includes('▲')));
      g.attacks = []; g.root.line = 'Lights out.'; g.root.lineAt = g.time;
      texts.length = 0; drawHUD(panel, g, { role: 'editor' });
      assert.ok(texts.includes('ROOT: Lights out.'));
      texts.length = 0;
      drawHUD(panel, g, { role: 'shooter', paused: true, pauseReason: 'Controller lost.' });
      assert.ok(texts.includes('PAUSED') && texts.includes('Controller lost.') && texts.includes('RESUME RUN'));
   });
   await test('tip board tells each player what to do, and first-time attacks warn three times longer', () => {
      const { wallLines } = panels;
      const g = playing([{ id: 2, type: 'hold', body: [fire(1)] }]);
      g.seen = {};
      g.startAttack({ type: 'PANEL_LOCK' }, 'Access denied.');
      assert.equal(g.attacks[0].warn, 3);
      assert.deepEqual(wallLines(g, true)[0], { warn: true, text: 'SHOOT THE GOLD LOCK ON YOUR LEFT' });
      assert.equal(wallLines(g, false)[0].text, 'CONSOLE LOCKED: GUNNER MUST SHOOT THE LOCK');
      g.attacks = [{ type: 'GUN_LOCK', hand: 'left', warn: 0, glyphs: [0, 0, 1, 2] }];
      assert.equal(wallLines(g, true)[0].text, 'LEFT GUN LOCKED: READ TO CODER ▲ ▲ ● ■');
      assert.ok(!wallLines(g, false)[0].text.includes('▲'));
      g.attacks = []; g.root.exposed = 1;
      assert.match(wallLines(g, true)[0].text, /SHOOT IT 3 TIMES/);
      g.attacks = []; g.stats.lastEnd.gunner = -99; g.stats.lastBlackout = -99;
      g.startAttack({ type: 'BLACKOUT' }, 'Lights out.');
      assert.ok(Math.abs(g.attacks[0].warn - 3.6) < 1e-9);
      g.attacks = []; g.stats.lastEnd.gunner = -99; g.stats.lastBlackout = -99;
      g.startAttack({ type: 'BLACKOUT' });
      assert.equal(g.attacks[0].warn, 1.2);
      const idle = new Game();
      assert.equal(wallLines(idle, false)[0].text, 'LEFT GRIP OPENS YOUR CODE CONSOLE');
      idle.phase = 'upgrade'; idle.wave = 1; idle.prepare(fallbackScript(idle));
      assert.equal(wallLines(idle, false)[0].text, 'PICK ONE NEW BLOCK IN YOUR CONSOLE');
      idle.phase = 'won';
      assert.ok(!wallLines(idle, false).some(l => /PICK/.test(l.text)));
      g.attacks = []; g.root.exposed = 0; g.stats.lastEnd.gunner = -99;
      g.startAttack({ type: 'GUN_LOCK', hand: 'right' });
      assert.equal(wallLines(g, true)[0].text, 'RIGHT GUN IS ABOUT TO LOCK');
      // Mid-wave, once ROOT has planned, the console shows the daemon the offers counter.
      g.custom = {}; g.script = { daemon: { ...DAEMONS.drone, name: 'NOW' } };
      g.prepare(fallbackScript(g)); texts.length = 0;
      panels.drawIDE(panel, g, { role: 'editor', glyphs: [] });
      assert.ok(texts.some(t => String(t).includes('INTERCEPTED SOURCE / ' + g.nextScript.daemon.name)));
      assert.match(daemonSource(DAEMONS.brick)[2], /armor\(1\); +\/\/ -1 per bolt → power/);
   });
   await test('the popup close box covers the shootable corner', () => {
      const { drawPopup } = panels, boxes = [];
      drawPopup({ ctx: { fillRect(...r) { boxes.push(r); }, fillText() {}, measureText: () => ({ width: 0 }) } });
      // Hit circle: center (.24, .15) radius .07 on a .6 x .4 m window drawn on 512 x 340 px.
      const [x, y, w, h] = boxes.find(([x, , w]) => x > 400 && w < 100);
      for (const [cx, cy] of [[x, y], [x + w, y], [x + w, y + h], [x, y + h]]) {
         const mx = (cx / 512 * 2 - 1) * .3, my = (1 - cy / 340 * 2) * .2;
         assert.ok(Math.hypot(mx - .24, Math.max(-.2, Math.min(.2, my)) - .15) < .072, [cx, cy]);
      }
   });
   await test('in-game role picker and debug controls have clickable buttons', () => {
      const g = new Game();
      drawHUD(panel, g, { mode: 'select', role: 'select', room: 'LAB' });
      assert.equal(buttonAt(panel, 100, 330), 'role:shooter');
      assert.equal(buttonAt(panel, 420, 330), 'role:editor');
      assert.equal(buttonAt(panel, 750, 330), 'role:debug');
      drawHUD(panel, g, { mode: 'select', role: 'select', room: '' });
      assert.equal(buttonAt(panel, 100, 330), undefined);
      g.startWave();
      drawHUD(panel, g, { mode: 'debug', role: 'editor', paused: true });
      assert.equal(buttonAt(panel, 100, 440), 'role:shooter');
      assert.equal(buttonAt(panel, 400, 440), 'role:editor');
      assert.equal(buttonAt(panel, 800, 440), 'pause');
      for (const mode of ['select', 'debug', 'coop']) {
         drawHUD(panel, g, { mode, role: 'editor', room: 'LAB' });
         assert.ok(panel.buttons.every(b => b.x + b.w <= 1024 && b.y + b.h <= 512));
      }
   });
   await test('audio events survive batched snapshots without replay; paused edits still arrive', () => {
      const g = new Game(), members = [1, 2];
      const editor = new Session(g, { room: 'A', role: 'editor', id: () => 2, clients: () => members, send() {} });
      const packet = seq => ({ from: 1, room: 'A', role: 'shooter', type: 'snapshot', seq,
         epoch: 'gunner', editorId: 2, editorEpoch: editor.epoch,
         state: g.snapshot(), events: [{ type: 'kill', position: [seq, 0, 0] }], paused: true });
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
   await test('spread emits one sound per volley', () => {
      const g = playing([{ id: 2, type: 'spread', value: 5, body: [fire(1)] }]);
      g.press();
      const events = g.tick(.05, { right: miss });
      assert.equal(events.filter(e => e.type === 'shot').length, 5);
      assert.equal(events.filter(e => e.type === 'shot' && e.sound).length, 1);
      assert.equal(raySphere([0, 0, 1], [0, 0, 1], [0, 0, 0], 2), 0);
   });
   console.log(checks + ' Spellcode checks passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
