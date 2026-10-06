export const BLOCKS = [
   { type: 'fire', name: 'fire()', values: [] },
   { type: 'repeat', name: 'for', values: [2, 3, 5] },
   { type: 'hold', name: 'while', values: [] },
   { type: 'spread', name: 'spread()', values: [3, 5] },
   { type: 'power', name: 'power()', values: [2, 3] },
];
const definition = type => BLOCKS.find(b => b.type === type);
const clone = value => JSON.parse(JSON.stringify(value));
export const COLLECTOR = { position: [-.8, 1.15, -1.8], radius: .45 };
const children = node => node.body || [];
const findList = (program, parent) => {
   if (parent === 0) return program;
   for (const node of program) {
      if (node.id === parent) return node.body || null;
      const found = findList(children(node), parent);
      if (found) return found;
   }
   return null;
};
const findNode = (program, id) => {
   for (const list of [program, ...program.flatMap(node => nestedLists(node))]) {
      const index = list.findIndex(node => node.id === id);
      if (index >= 0) return { list, index, node: list[index] };
   }
   return null;
};
const nestedLists = node => node.body ? [node.body, ...node.body.flatMap(nestedLists)] : [];
const allNodes = program => program.flatMap(node => [node, ...children(node).flatMap(n => allNodes([n]))]);
const contains = (node, id) => node.id === id || children(node).some(child => contains(child, id));

export function validateProgram(program) {
   if (!Array.isArray(program)) return { ok: false, error: 'Program must be a list.' };
   const seen = new Set();
   let holds = 0, shots = 0, nodes = 0, incomplete = '';
   function inspect(list, repeat = 1, pellets = 1, damage = 1, depth = 0, withinHold = false) {
      if (!Array.isArray(list) || depth > 8) throw Error('Maximum nesting depth is 8.');
      for (const node of list) {
         const def = definition(node.type);
         if (!def || !Number.isInteger(node.id) || seen.has(node.id)) throw Error('Unknown or duplicate code block.');
         seen.add(node.id);
         if (++nodes > 256) throw Error('Program is too large.');
         if (def.values.length && !def.values.includes(node.value)) throw Error('Invalid block parameter.');
         if (node.type === 'fire') { shots += repeat * pellets; continue; }
         if (node.type === 'hold') {
            if (withinHold || ++holds > 1) throw Error('Only one while(triggerHeld) block is allowed.');
         }
         if (pellets * (node.type === 'spread' ? node.value : 1) > 5 ||
             damage * (node.type === 'power' ? node.value : 1) > 3)
            throw Error('Nested spread/power exceeds the weapon budget.');
         if (!Array.isArray(node.body)) throw Error('Invalid block body.');
         if (!node.body.length) { incomplete ||= node.type + ' needs a body with fire().'; continue; }
         const before = shots;
         inspect(node.body, repeat * (node.type === 'repeat' ? node.value : 1),
            pellets * (node.type === 'spread' ? node.value : 1),
            damage * (node.type === 'power' ? node.value : 1), depth + 1,
            withinHold || node.type === 'hold');
         if (shots === before) incomplete ||= node.type + ' needs a reachable fire().';
         if (shots > 64) throw Error('This trigger would fire over 64 bolts.');
      }
   }
   try {
      inspect(program);
      if (incomplete) throw Error(incomplete);
      if (!shots) throw Error('Insert at least one fire() block.');
      return { ok: true, shots };
   } catch (error) { return { ok: false, error: error.message }; }
}
export function* execute(program, held, weapon = { pellets: 1, damage: 1 }) {
   for (const node of program) {
      switch (node.type) {
      case 'fire': yield { type: 'fire', ...weapon }; break;
      case 'repeat':
         for (let i = 0; i < node.value; i++) yield* execute(node.body, held, weapon);
         break;
      case 'hold':
         while (held()) { yield* execute(node.body, held, weapon); yield { type: 'wait', seconds: .30 }; }
         break;
      case 'spread':
         yield* execute(node.body, held, { ...weapon, pellets: weapon.pellets * node.value });
         break;
      case 'power':
         yield* execute(node.body, held, { ...weapon, damage: weapon.damage * node.value });
         break;
      }
   }
}
export function programLines(program) {
   const lines = [{ text: 'function onTrigger(hand) {', depth: 0 }];
   const write = (list, depth, parent) => {
      lines.push({ slot: { parent, index: 0 }, depth });
      list.forEach((node, index) => {
         const count = node.value;
         const title = node.type === 'fire' ? 'fire(weapon, hand);'
            : node.type === 'repeat' ? `for (let i = 0; i < ${count}; i++) {`
            : node.type === 'hold' ? 'while (triggerHeld(hand)) {'
            : `with ${node.type}(weapon, ${count}) {`;
         lines.push({ text: title, depth, id: node.id, type: node.type, value: count });
         if (node.body) { write(node.body, depth + 1, node.id); lines.push({ text: '}', depth }); }
         lines.push({ slot: { parent, index: index + 1 }, depth });
      });
   };
   write(program, 1, 0);
   lines.push({ text: '}', depth: 0 });
   return lines;
}
export function raySphere(origin, direction, center, radius) {
   const delta = origin.map((v, i) => v - center[i]);
   const b = delta.reduce((sum, v, i) => sum + v * direction[i], 0);
   const c = delta.reduce((sum, v) => sum + v * v, 0) - radius * radius;
   if (c <= 0) return 0;
   const discriminant = b * b - c;
   if (discriminant < 0) return null;
   const near = -b - Math.sqrt(discriminant);
   return near >= 0 ? near : null;
}
export function nearestEnemy(ray, enemies, limit = 12) {
   let enemy = null, distance = limit;
   if (ray) for (const candidate of enemies) {
      if (candidate.hp <= 0) continue;
      const d = raySphere(ray.origin, ray.direction, candidate.position, candidate.radius);
      if (d !== null && d < distance) { enemy = candidate; distance = d; }
   }
   return { enemy, distance };
}
const directions = (ray, count) => {
   let right = [ray.direction[2], 0, -ray.direction[0]];
   const length = Math.hypot(...right) || 1;
   right = right.map(v => v / length);
   return Array.from({ length: count }, (_, i) => {
      const angle = (i - (count - 1) / 2) * .10;
      return ray.direction.map((v, j) => v * Math.cos(angle) + right[j] * Math.sin(angle));
   });
};
const handState = () => ({ held: false, runner: null, next: null, cooldown: 0, flash: 0, iteration: 0 });
export class Game {
   constructor(random = Math.random) { this.random = random; this.reset(); }
   reset() {
      this.pendingEvents = [];
      Object.assign(this, { phase: 'ready', wave: 0, hp: 5, energy: 100, score: 0, kills: 0,
         shots: 0, time: 0, draft: [{ id: 1, type: 'fire' }], program: [{ id: 1, type: 'fire' }],
         revision: 1, nextNodeId: 2, inventory: Object.fromEntries(BLOCKS.map(b => [b.type, 0])),
         error: '', loot: [], enemies: [], remaining: 0, spawnIn: 0, lowEnergy: 0, nextId: 0,
         hands: { left: handState(), right: handState() } });
   }
   snapshot() {
      const { phase, wave, hp, energy, score, kills, shots, time, draft, program, revision,
         inventory, error, loot, enemies, remaining, lowEnergy } = this;
      return { phase, wave, hp, energy, score, kills, shots, time, draft, program, revision,
         inventory, error, loot, enemies, remaining, lowEnergy };
   }
   load(snapshot) {
      for (const key of Object.keys(this.snapshot())) if (snapshot[key] !== undefined) this[key] = snapshot[key];
   }
   edit(op, role = 'editor') {
      const accepted = this.editDraft(op, role);
      if (role === 'editor' || role === 'solo')
         this.pendingEvents.push({ type: 'compile', ok: accepted && !this.error });
      return accepted;
   }
   takeEvents() { return this.pendingEvents.splice(0); }
   editDraft(op, role = 'editor') {
      if (role !== 'editor' && role !== 'solo') return false;
      const draft = clone(this.draft), inventory = { ...this.inventory };
      let nextId = this.nextNodeId;
      if (op.kind === 'add') {
         const def = definition(op.type), list = findList(draft, op.parent);
         if (!def || !list || !Number.isInteger(op.index) || op.index < 0 || op.index > list.length ||
             inventory[op.type] < 1) return false;
         const node = { id: nextId++, type: op.type };
         if (def.values.length) node.value = def.values[0];
         if (op.type !== 'fire') node.body = [];
         list.splice(op.index, 0, node); inventory[op.type]--;
      } else if (op.kind === 'delete') {
         const found = findNode(draft, op.id);
         if (!found) return false;
         for (const node of allNodes([found.node])) inventory[node.type]++;
         found.list.splice(found.index, 1);
      } else if (op.kind === 'cycle') {
         const found = findNode(draft, op.id), values = definition(found?.node.type)?.values;
         if (!values?.length) return false;
         found.node.value = values[(values.indexOf(found.node.value) + 1) % values.length];
      } else if (op.kind === 'move') {
         const found = findNode(draft, op.id);
         if (!found || contains(found.node, op.parent)) return false;
         const [node] = found.list.splice(found.index, 1);
         const list = findList(draft, op.parent);
         if (!list || !Number.isInteger(op.index) || op.index < 0 || op.index > list.length + (list === found.list ? 1 : 0))
            return false;
         const index = list === found.list && op.index > found.index ? op.index - 1 : op.index;
         list.splice(index, 0, node);
      } else return false;
      const result = validateProgram(draft);
      if (!result.ok && !/needs a body|needs a reachable fire|Insert at least one fire/.test(result.error))
         return false;
      this.draft = draft; this.inventory = inventory; this.nextNodeId = nextId;
      this.error = result.error || '';
      if (result.ok) { this.program = clone(draft); this.revision++; }
      return true;
   }
   drag(action, id, ray, pull = 0, role = 'editor') {
      if (role !== 'editor' && role !== 'solo') return false;
      const index = this.loot.findIndex(item => item.id === id);
      if (index < 0) return false;
      const item = this.loot[index];
      if (action === 'release' || action === 'cancel') {
         if (!item.held) return false;
         delete item.held;
         if (action === 'release' && Math.hypot(...item.position.map((v, i) => v - COLLECTOR.position[i])) <= COLLECTOR.radius) {
            this.inventory[item.type]++;
            this.loot.splice(index, 1);
            this.pendingEvents.push({ type: 'collect', position: COLLECTOR.position.slice() });
         }
         return true;
      }
      if (!ray || ![ray.origin, ray.direction].every(v => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite)) ||
          Math.abs(Math.hypot(...ray.direction) - 1) > .001 || !Number.isFinite(pull) || Math.abs(pull) > .3)
         return false;
      if (action === 'grab') {
         const distance = raySphere(ray.origin, ray.direction, item.position, .35);
         if (this.loot.some(drop => drop.held) || distance === null || distance > 12) return false;
         item.held = true;
         return true;
      }
      if (action !== 'move' || !item.held) return false;
      // Project onto the controller beam, as in beamSphere.js; pull adjusts depth.
      const depth = item.position.reduce((sum, v, i) => sum + (v - ray.origin[i]) * ray.direction[i], 0);
      const distance = Math.max(.25, Math.min(12, depth - pull));
      item.position = ray.origin.map((v, i) => v + ray.direction[i] * distance);
      return true;
   }
   startWave() {
      if (!['ready', 'upgrade'].includes(this.phase)) return false;
      this.wave++; this.phase = 'playing'; this.remaining = [6, 9, 12][this.wave - 1];
      this.spawnIn = .8; this.energy = 100; this.cancel();
      return true;
   }
   press(hand = 'right') {
      const state = this.hands[hand];
      if (!state || this.phase !== 'playing' || state.held) return;
      state.held = true; state.iteration = 0;
      const program = clone(this.program);
      state.hasHold = allNodes(program).some(node => node.type === 'hold');
      state.runner = execute(program, () => state.held); state.next = null;
   }
   release(hand = 'right') {
      const state = this.hands[hand];
      if (!state) return;
      state.held = false;
      if (state.hasHold) { state.runner = null; state.next = null; }
   }
   cancel(hand) {
      for (const key of hand ? [hand] : ['left', 'right']) {
         const state = this.hands[key];
         if (state) { state.held = false; state.runner = null; state.next = null; state.flash = 0; }
      }
   }
   spawn() {
      const angle = (this.random() - .5) * 1.1, distance = 5.6 + this.random() * 1.2;
      const y = 1.25 + this.random() * .55, seed = this.random() * Math.PI * 2;
      this.enemies.push({ id: this.nextId++, angle, distance, hp: this.wave, maxHP: this.wave,
         radius: .28, y, seed, hit: 0,
         position: [Math.sin(angle) * distance, y + .1 * Math.sin(this.time * 2 + seed), -Math.cos(angle) * distance] });
   }
   tick(seconds, rays = {}) {
      const dt = Math.max(0, Math.min(Number.isFinite(seconds) ? seconds : 0, .05)), events = this.takeEvents();
      this.time += dt; this.lowEnergy = Math.max(0, this.lowEnergy - dt);
      for (const state of Object.values(this.hands)) state.flash = Math.max(0, state.flash - dt);
      if (this.phase !== 'playing') return events;
      this.energy = Math.min(100, this.energy + 18 * dt);
      for (const hand of ['right', 'left']) {
         const state = this.hands[hand], ray = rays?.[hand];
         state.cooldown = Math.max(0, state.cooldown - dt);
         if (!ray) { this.cancel(hand); continue; }
         if (!state.runner || state.cooldown > 0) continue;
         if (!state.next) {
            const step = state.runner.next();
            if (step.done) { state.runner = null; continue; }
            state.next = step.value;
         }
         if (state.next.type === 'wait') { state.cooldown = state.next.seconds; state.next = null; continue; }
         const { pellets, damage } = state.next, cost = 9 + (pellets - 1) * 4 + (damage - 1) * 4;
         if (this.energy < cost) { this.lowEnergy = .6; continue; }
         this.energy -= cost; state.next = null; state.cooldown = .16; state.flash = .12; state.iteration++;
         let pellet = 0;
         for (const direction of directions(ray, pellets)) {
            const { enemy, distance } = nearestEnemy({ origin: ray.origin, direction }, this.enemies);
            this.shots++;
            events.push({ type: 'shot', hand, sound: pellet++ === 0, origin: ray.origin.slice(),
               position: ray.origin.map((v, i) => v + direction[i] * distance), hit: !!enemy });
            if (enemy) {
               enemy.hp = Math.max(0, enemy.hp - damage); enemy.hit = .15;
               if (!enemy.hp) {
                  this.score += 100 * this.wave; this.kills++;
                  events.push({ type: 'kill', position: enemy.position.slice() });
                  const type = BLOCKS[(this.kills - 1) % BLOCKS.length].type;
                  this.loot.push({ id: this.kills, type, position: enemy.position.slice() });
               }
            }
         }
      }
      this.enemies = this.enemies.filter(e => e.hp > 0);
      for (const enemy of this.enemies) {
         enemy.distance -= (.24 + .08 * this.wave) * dt; enemy.hit = Math.max(0, enemy.hit - dt);
         enemy.position = [Math.sin(enemy.angle) * enemy.distance,
            enemy.y + .1 * Math.sin(this.time * 2 + enemy.seed), -Math.cos(enemy.angle) * enemy.distance];
         if (enemy.distance < 1) {
            enemy.hp = 0; this.hp = Math.max(0, this.hp - 1);
            events.push({ type: 'damage', position: enemy.position });
         }
      }
      this.enemies = this.enemies.filter(e => e.hp > 0);
      if (!this.hp) { this.phase = 'lost'; this.cancel(); events.push({ type: 'lost' }); return events; }
      this.spawnIn -= dt;
      if (this.remaining > 0 && this.spawnIn <= 0 && this.enemies.length < 5) {
         this.spawn(); this.remaining--; this.spawnIn = 1.8 - .2 * this.wave;
      }
      if (!this.remaining && !this.enemies.length) {
         this.phase = this.wave === 3 ? 'won' : 'upgrade'; this.cancel();
         events.push({ type: this.phase });
      }
      return events;
   }
}
