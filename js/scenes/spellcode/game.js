import { DAEMONS } from './daemons.js';

export const BLOCKS = [
   { type: 'fire', name: 'fire()', values: [] },
   { type: 'repeat', name: 'for', values: [2, 3, 5] },
   { type: 'hold', name: 'while', values: [] },
   { type: 'wait', name: 'wait()', values: [.2, .4, .8] },
   { type: 'spread', name: 'spread()', values: [3, 5] },
   { type: 'power', name: 'power()', values: [2, 3] },
   { type: 'pierce', name: 'pierce()', values: [] },
   { type: 'chain', name: 'chain()', values: [] },
];
// ROOT's injected misfire renders exactly like fire().
const DEFS = [...BLOCKS, { type: 'misfire', name: 'fire()', values: [] }];
const LEAVES = new Set(['fire', 'misfire', 'wait']);
const definition = type => DEFS.find(b => b.type === type);
const clone = value => JSON.parse(JSON.stringify(value));
const round = (value, digits = 1) => Math.round(value * 10 ** digits) / 10 ** digits;

export const EYE = [0, 3.2, -13.4];
const PACKET_START = [0, 2.6, -7];
const LANES = [-.42, 0, .42];
export const GLYPHS = ['▲', '●', '■', '◆'];
export const WAVES = [
   { duration: 45, every: 3.2, budget: 0, pool: ['drone', 'skitter'] },
   { duration: 60, every: 2.8, budget: 6, pool: ['drone', 'skitter', 'brick', 'bulwark'] },
   { duration: 75, every: 2.5, budget: 10, pool: ['drone', 'skitter', 'brick', 'bulwark', 'pulse', 'mender'] },
   { duration: 90, every: 2.2, budget: 14, pool: ['drone', 'skitter', 'brick', 'bulwark', 'pulse', 'mender', 'splitter'] },
];
export const ATTACKS = {
   BLACKOUT: { target: 'gunner', cost: 3, warn: 1.2, max: 1.2 },
   POPUP: { target: 'gunner', cost: 1, warn: 1, max: 8 },
   GUN_LOCK: { target: 'gunner', cost: 3, warn: 1, max: 12 },
   INJECT: { target: 'coder', cost: 2, warn: 1, max: 30 },
   PANEL_LOCK: { target: 'coder', cost: 3, warn: 1, max: 12 },
   THIEF: { target: 'coder', cost: 2, warn: 1, max: 6 },
};
export const METRICS = ['gunner.accuracy10s', 'gunner.rightHandShare', 'gunner.idleSeconds',
   'coder.panelOpenSeconds', 'coder.editsLast10s', 'integrity', 'daemonsAlive', 'secondsSinceResolved'];

const children = node => node.body || [];
const nestedLists = node => node.body ? [node.body, ...node.body.flatMap(nestedLists)] : [];
const lists = program => [program, ...program.flatMap(nestedLists)];
export const allNodes = program => program.flatMap(node => [node, ...children(node).flatMap(n => allNodes([n]))]);
const findList = (program, parent) => parent === 0 ? program : allNodes(program).find(n => n.id === parent)?.body || null;
const findNode = (program, test) => {
   for (const list of lists(program)) {
      const index = list.findIndex(test);
      if (index >= 0) return { list, index, node: list[index] };
   }
   return null;
};
const contains = (node, id) => node.id === id || children(node).some(child => contains(child, id));
const strip = list => list.filter(n => !n.foreign).map(n => n.body ? { ...n, body: strip(n.body) } : n);

export function validateProgram(program) {
   if (!Array.isArray(program)) return { ok: false, error: 'Program must be a list.' };
   const seen = new Set();
   // ROOT's misfire counts toward the bolt cap but never makes a program valid: when the
   // injection expires it is removed, which must not leave a gun without a real fire().
   let holds = 0, shots = 0, real = 0, nodes = 0, incomplete = '';
   function inspect(list, repeat = 1, pellets = 1, damage = 1, depth = 0, withinHold = false) {
      if (!Array.isArray(list) || depth > 8) throw Error('Maximum nesting depth is 8.');
      for (const node of list) {
         const def = definition(node.type);
         if (!def || !Number.isInteger(node.id) || seen.has(node.id)) throw Error('Unknown or duplicate code block.');
         seen.add(node.id);
         if (++nodes > 256) throw Error('Program is too large.');
         if (def.values.length && !def.values.includes(node.value)) throw Error('Invalid block parameter.');
         if (node.type === 'fire' || node.type === 'misfire') {
            if ((shots += repeat * pellets) > 64) throw Error('This trigger would fire over 64 bolts.');
            if (node.type === 'fire') real++;
            continue;
         }
         if (node.type === 'wait') continue;
         if (node.type === 'hold' && (withinHold || ++holds > 1)) throw Error('Only one while(triggerHeld) block is allowed.');
         const nextPellets = pellets * (node.type === 'spread' ? node.value : 1);
         const nextDamage = damage * (node.type === 'power' ? node.value : 1);
         if (nextPellets > 5 || nextDamage > 3) throw Error('Nested spread/power exceeds the weapon budget.');
         if (!Array.isArray(node.body)) throw Error('Invalid block body.');
         if (!node.body.length) { incomplete ||= node.type + ' needs a body with fire().'; continue; }
         const before = real;
         inspect(node.body, repeat * (node.type === 'repeat' ? node.value : 1), nextPellets, nextDamage,
            depth + 1, withinHold || node.type === 'hold');
         if (real === before) incomplete ||= node.type + ' needs a reachable fire().';
      }
   }
   try {
      inspect(program);
      if (incomplete) throw Error(incomplete);
      if (!real) throw Error('Insert at least one fire() block.');
      return { ok: true, shots };
   } catch (error) { return { ok: false, error: error.message }; }
}
export function* execute(program, held, weapon = { pellets: 1, damage: 1, pierce: false, chain: false }) {
   for (const node of program) {
      switch (node.type) {
      case 'fire': yield { type: 'fire', ...weapon }; break;
      case 'misfire': yield { type: 'fire', ...weapon, misfire: true }; break;
      case 'wait': yield { type: 'wait', seconds: node.value }; break;
      case 'repeat':
         for (let i = 0; i < node.value; i++) yield* execute(node.body, held, weapon);
         break;
      case 'hold':
         // 'cycle' marks the safe boundary where a held trigger adopts a newer build.
         while (held()) { yield* execute(node.body, held, weapon); yield { type: 'cycle' }; }
         break;
      case 'spread': yield* execute(node.body, held, { ...weapon, pellets: weapon.pellets * node.value }); break;
      case 'power': yield* execute(node.body, held, { ...weapon, damage: weapon.damage * node.value }); break;
      case 'pierce': case 'chain': yield* execute(node.body, held, { ...weapon, [node.type]: true }); break;
      }
   }
}
export function programLines(program) {
   const lines = [{ text: 'function onTrigger(hand) {', depth: 0 }];
   const write = (list, depth, parent) => {
      lines.push({ slot: { parent, index: 0 }, depth });
      list.forEach((node, index) => {
         const count = node.value, fire = node.type === 'fire' || node.type === 'misfire';
         const title = fire ? 'fire(weapon, hand);'
            : node.type === 'wait' ? `wait(${count});`
            : node.type === 'repeat' ? `for (let i = 0; i < ${count}; i++) {`
            : node.type === 'hold' ? 'while (triggerHeld(hand)) {'
            : `with ${node.type}(weapon${count ? ', ' + count : ''}) {`;
         lines.push({ text: title, depth, id: node.id, type: fire ? 'fire' : node.type, value: count });
         if (node.body) { write(node.body, depth + 1, node.id); lines.push({ text: '}', depth }); }
         lines.push({ slot: { parent, index: index + 1 }, depth });
      });
   };
   write(program, 1, 0);
   lines.push({ text: '}', depth: 0 });
   return lines;
}
export const programText = program => programLines(program).filter(line => line.text)
   .map(line => '  '.repeat(line.depth) + line.text).join('\n');
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
export function nearestEnemy(ray, enemies, limit = 16) {
   let enemy = null, distance = limit;
   if (ray) for (const candidate of enemies) {
      if (candidate.hp <= 0) continue;
      const d = raySphere(ray.origin, ray.direction, candidate.position, candidate.radius);
      if (d !== null && d < distance) { enemy = candidate; distance = d; }
   }
   return { enemy, distance };
}
const directions = (ray, count, offset = 0) => {
   let right = [ray.direction[2], 0, -ray.direction[0]];
   const length = Math.hypot(...right) || 1;
   right = right.map(v => v / length);
   return Array.from({ length: count }, (_, i) => {
      const angle = (i - (count - 1) / 2) * .10 + offset;
      return ray.direction.map((v, j) => v * Math.cos(angle) + right[j] * Math.sin(angle));
   });
};
const handState = () => ({ held: false, runner: null, cooldown: 0, flash: 0, revision: 0, hasHold: false });
const START = [{ id: 1, type: 'hold', body: [{ id: 2, type: 'fire' }] }];
const SNAPSHOT = ['phase', 'wave', 'hp', 'score', 'kills', 'shots', 'hits', 'time', 'waveTime', 'draft', 'program',
   'revision', 'capacity', 'inventory', 'error', 'enemies', 'popups', 'packet', 'blackout', 'attacks', 'custom',
   'script', 'nextScript', 'offers', 'debrief', 'root'];

export class Game {
   constructor(random = Math.random) { this.random = random; this.run = 0; this.reset(); }
   reset() {
      this.run++;
      this.pendingEvents = [];
      Object.assign(this, { phase: 'ready', wave: 0, hp: 5, score: 0, kills: 0, shots: 0, hits: 0,
         time: 0, waveTime: 0, waveStart: 0, draft: clone(START), program: clone(START), revision: 1,
         nextNodeId: 3, capacity: 4, error: '', enemies: [], popups: [], packet: null, blackout: 0, safe: 0,
         attacks: [], seen: {}, nextId: 0, custom: {}, script: null, nextScript: null, offers: [], debrief: null, log: [],
         inventory: { ...Object.fromEntries(BLOCKS.map(b => [b.type, 0])), fire: 1, repeat: 1, spread: 1 },
         root: { target: null, exposed: 0, eyeHits: 0, line: '', lineAt: -99, budget: 0, spent: 0 },
         panel: { open: false, since: 0 }, spawnIn: 0, head: [0, 1.6, 0],
         stats: { volleys: { left: 0, right: 0 }, lastVolley: 0, shotLog: [], edits: [], killsBy: {},
            lastEnd: { gunner: -99, coder: -99 }, lastBlackout: -99 },
         hands: { left: handState(), right: handState() } });
      this.defs = { ...DAEMONS };
   }
   snapshot() { return Object.fromEntries(SNAPSHOT.map(key => [key, this[key]])); }
   load(snapshot) {
      for (const key of SNAPSHOT) if (snapshot[key] !== undefined) this[key] = snapshot[key];
      this.defs = { ...DAEMONS, ...this.custom };
   }
   emit(event) { this.pendingEvents.push(event); }
   takeEvents() { return this.pendingEvents.splice(0); }
   active(type) { return this.attacks.find(a => a.type === type && a.warn <= 0); }
   gunLocked(hand) { return this.active('GUN_LOCK')?.hand === hand; }
   ownedTypes() {
      const used = allNodes(this.program).filter(n => !n.foreign).map(n => n.type);
      return BLOCKS.map(b => b.type).filter(type => this.inventory[type] > 0 || used.includes(type));
   }

   // Coder commands arrive here from the local UI or the network session.
   command(cmd, role = 'editor') {
      if (role !== 'editor') return false;
      if (cmd.kind === 'edit') return this.edit(cmd.operation || {}, role);
      if (cmd.kind === 'pick' && this.offers.includes(cmd.type)) {
         this.inventory[cmd.type]++; this.offers = []; return true;
      }
      if (cmd.kind === 'unlock') {
         const lock = this.active('GUN_LOCK');
         if (!lock) return false;
         const ok = String(cmd.glyphs) === String(lock.glyphs);
         if (ok) lock.solved = 'coder';
         this.emit({ type: 'compile', ok });
         return ok;
      }
      if (cmd.kind === 'panel' && this.panel.open !== !!cmd.open) this.panel = { open: !!cmd.open, since: this.time };
      return cmd.kind === 'panel';
   }
   edit(op, role = 'editor') {
      const accepted = this.editDraft(op, role);
      if (role === 'editor') {
         if (accepted) this.stats.edits.push(this.time);
         this.emit({ type: 'compile', ok: accepted && !this.error });
      }
      return accepted;
   }
   editDraft(op, role = 'editor') {
      if (role !== 'editor' || this.active('PANEL_LOCK')) return false;
      const draft = clone(this.draft), inventory = { ...this.inventory };
      let nextId = this.nextNodeId;
      if (op.kind === 'add') {
         const def = BLOCKS.find(b => b.type === op.type), list = findList(draft, op.parent);
         if (!def || !list || !Number.isInteger(op.index) || op.index < 0 || op.index > list.length ||
             inventory[op.type] < 1 || allNodes(draft).filter(n => !n.foreign).length >= this.capacity) return false;
         const node = { id: nextId++, type: op.type };
         if (def.values.length) node.value = def.values[0];
         if (!LEAVES.has(op.type)) node.body = [];
         list.splice(op.index, 0, node); inventory[op.type]--;
      } else if (op.kind === 'delete') {
         const found = findNode(draft, n => n.id === op.id);
         if (!found) return false;
         // ROOT's injected lines vanish without refunding stock.
         for (const node of allNodes([found.node])) if (!node.foreign) inventory[node.type]++;
         found.list.splice(found.index, 1);
      } else if (op.kind === 'cycle') {
         const found = findNode(draft, n => n.id === op.id), values = definition(found?.node.type)?.values;
         if (!values?.length) return false;
         found.node.value = values[(values.indexOf(found.node.value) + 1) % values.length];
      } else if (op.kind === 'move') {
         const found = findNode(draft, n => n.id === op.id);
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

   prepare(script) {
      this.nextScript = script;
      const pool = BLOCKS.map(b => b.type).filter(type => type !== 'hold' && !script.need.includes(type));
      const offers = script.need.slice(0, 1);
      while (offers.length < 3) offers.push(pool.splice(Math.floor(this.random() * pool.length), 1)[0]);
      this.offers = offers;
   }
   startWave(script = this.nextScript) {
      if (!['ready', 'upgrade'].includes(this.phase)) return false;
      this.wave++; this.phase = 'playing'; this.waveTime = 0; this.waveStart = this.time; this.spawnIn = .8;
      this.script = this.wave > 1 ? script : null; this.nextScript = null;
      this.attacks = []; this.popups = []; this.packet = null; this.blackout = 0; this.log = [];
      Object.assign(this.stats, { volleys: { left: 0, right: 0 }, lastVolley: 0, shotLog: [],
         lastEnd: { gunner: -99, coder: -99 }, lastBlackout: -99 });
      this.root = { target: null, exposed: 0, eyeHits: 0, lineAt: this.time,
         line: this.script?.intro || (this.wave === 1 ? 'Logging intruder behavior...' : ''),
         budget: WAVES[this.wave - 1].budget, spent: this.script?.cost || 0 };
      if (this.script?.daemon) {
         this.custom[this.script.daemon.id] = this.script.daemon;
         this.defs = { ...DAEMONS, ...this.custom };
      }
      for (const group of this.script?.spawns || []) Object.assign(group, { left: group.count, next: group.start });
      this.cancel();
      return true;
   }
   press(hand = 'right') {
      const state = this.hands[hand];
      if (!state || this.phase !== 'playing' || state.held || this.gunLocked(hand)) return;
      state.held = true;
      this.arm(state);
   }
   arm(state) {
      const program = clone(this.program);
      state.hasHold = allNodes(program).some(node => node.type === 'hold');
      state.runner = execute(program, () => state.held);
      state.revision = this.revision;
   }
   release(hand = 'right') {
      const state = this.hands[hand];
      if (!state) return;
      state.held = false;
      if (state.hasHold) state.runner = null;
   }
   cancel(hand) {
      for (const key of hand ? [hand] : ['left', 'right']) {
         const state = this.hands[key];
         if (state) { state.held = false; state.runner = null; state.flash = 0; }
      }
   }
   spawn(kind, at = {}) {
      const def = this.defs[kind];
      const e = { id: this.nextId++, kind, hp: def.hp, maxHP: def.hp, radius: def.size,
         angle: at.angle ?? LANES[Math.floor(this.random() * 3)] + (this.random() - .5) * .16,
         distance: at.distance ?? 8 + this.random() * 1.5, y: at.y ?? 1.2 + this.random() * .6,
         seed: this.random() * 6.28, hit: 0, speed: 0, armor: 0, shield: 0, vulnerable: true, special: def.special };
      for (const t of def.traits) {
         if (t.type === 'approach') e.speed = t.speed;
         if (t.type === 'strafe') e.strafe = [t.amplitude, t.period];
         if (t.type === 'armor') e.armor = t.n;
         if (t.type === 'shield') e.shield = t.hp;
         if (t.type === 'regen') { e.regen = [t.n, t.every]; e.regenT = 0; }
         if (t.type === 'phase') e.phase = [t.on, t.off];
         if (t.type === 'split') e.split = [t.count, t.child];
      }
      this.place(e);
      this.enemies.push(e);
      return e;
   }
   place(e) {
      const side = e.strafe ? e.strafe[0] * Math.sin(this.time * 6.283 / e.strafe[1] + e.seed) : 0;
      e.position = [Math.sin(e.angle) * e.distance + Math.cos(e.angle) * side,
         e.y + .1 * Math.sin(this.time * 2 + e.seed),
         -Math.cos(e.angle) * e.distance + Math.sin(e.angle) * side];
   }

   tick(seconds, rays = {}, head) {
      const dt = Math.max(0, Math.min(Number.isFinite(seconds) ? seconds : 0, .05));
      this.time += dt;
      if (head) this.head = head;
      for (const state of Object.values(this.hands)) state.flash = Math.max(0, state.flash - dt);
      if (this.phase !== 'playing') return this.takeEvents();
      this.waveTime += dt;
      this.fireHands(dt, rays);
      this.moveEnemies(dt);
      this.updateAttacks(dt);
      this.direct(dt);
      this.spawnTick(dt);
      if (!this.hp) { this.phase = 'lost'; this.clearWave(); this.emit({ type: 'lost' }); }
      else if (this.waveTime >= WAVES[this.wave - 1].duration) this.endWave();
      return this.takeEvents();
   }
   fireHands(dt, rays) {
      for (const hand of ['right', 'left']) {
         const state = this.hands[hand], ray = rays?.[hand];
         state.cooldown = Math.max(0, state.cooldown - dt);
         if (!ray || this.gunLocked(hand)) { this.cancel(hand); continue; }
         for (let n = 0; n < 8 && state.runner && state.cooldown <= 0; n++) {
            const step = state.runner.next();
            if (step.done) { state.runner = null; break; }
            const value = step.value;
            if (value.type === 'wait') state.cooldown = value.seconds;
            else if (value.type === 'cycle') { if (state.revision !== this.revision) this.arm(state); }
            else this.volley(hand, ray, value);
         }
      }
   }
   volley(hand, ray, { pellets, damage, pierce, chain, misfire }) {
      const state = this.hands[hand];
      // Modifiers change how damage arrives, not its ideal rate.
      state.cooldown = .18 * pellets * damage; state.flash = .12;
      this.stats.volleys[hand]++; this.stats.lastVolley = this.waveTime;
      directions(ray, pellets, misfire ? .5 : 0).forEach((direction, i) => {
         const hit = this.bolt(ray.origin, direction, damage, pierce, chain, hand, i === 0);
         this.shots++; if (hit) this.hits++;
         this.stats.shotLog.push([this.waveTime, hit]);
      });
   }
   trace(origin, direction) {
      const { enemy, distance } = nearestEnemy({ origin, direction }, this.enemies);
      let best = { distance, enemy };
      if (direction[2] < 0) for (const popup of this.popups) {
         const t = (popup.position[2] - origin[2]) / direction[2];
         if (t <= 0 || t >= best.distance) continue;
         const x = origin[0] + direction[0] * t - popup.position[0], y = origin[1] + direction[1] * t - popup.position[1];
         if (Math.abs(x) <= .3 && Math.abs(y) <= .2) best = { distance: t, popup, close: Math.hypot(x - .24, y - .15) < .07 };
      }
      const spheres = [[this.packet && !this.packet.dead && this.packet.position, .3, 'packet'],
         [this.root.exposed > 0 && EYE, .9, 'eye']];
      for (const [center, radius, key] of spheres) {
         if (!center) continue;
         const d = raySphere(origin, direction, center, radius);
         if (d !== null && d < best.distance) best = { distance: d, [key]: true };
      }
      return best;
   }
   bolt(origin, direction, damage, pierce, chain, hand, sound) {
      const target = this.trace(origin, direction);
      const end = origin.map((v, i) => v + direction[i] * target.distance);
      this.emit({ type: 'shot', hand, sound, origin: origin.slice(), position: end, hit: !!target.enemy });
      if (target.popup) {
         if (target.close) this.popups = this.popups.filter(p => p !== target.popup);
         return false;
      }
      if (target.packet) { this.packet.dead = true; return true; }
      if (target.eye) { this.hitEye(); return true; }
      if (!target.enemy) return false;
      let last = target.enemy;
      this.damage(last, damage, direction);
      const extra = (from, next, dir) => {
         this.emit({ type: 'shot', hand, sound: false, origin: from, position: next.position.slice(), hit: true });
         this.damage(next, damage, dir);
         last = next;
      };
      if (pierce) {
         const next = nearestEnemy({ origin: end, direction }, this.enemies.filter(e => e !== last)).enemy;
         if (next) extra(end, next, direction);
      }
      if (chain) {
         const from = last.position, near = this.enemies.filter(e => e !== last && e.hp > 0)
            .map(e => [e, Math.hypot(...e.position.map((v, i) => v - from[i]))]).filter(([, d]) => d <= 2)
            .sort((a, b) => a[1] - b[1])[0];
         if (near) extra(from.slice(), near[0], near[0].position.map((v, i) => (v - from[i]) / near[1]));
      }
      return true;
   }
   damage(e, amount, direction) {
      if (e.hp <= 0 || e.phase && !e.vulnerable) return;
      e.hit = .15;
      if (e.shield > 0) {
         // The shield faces the player; bolts within 60 degrees of its front are absorbed.
         const f = [-e.position[0], -e.position[2]], fl = Math.hypot(...f) || 1, dl = Math.hypot(direction[0], direction[2]) || 1;
         if (-(direction[0] * f[0] + direction[2] * f[1]) / fl / dl > .5) { e.shield = Math.max(0, e.shield - amount); return; }
      }
      // Armor never blocks more than three quarters of a bolt, so every daemon stays killable.
      e.hp = Math.max(0, e.hp - Math.max(amount / 4, amount - e.armor));
      if (e.hp) return;
      this.kills++; this.score += 50 * e.maxHP;
      this.stats.killsBy[e.kind] = (this.stats.killsBy[e.kind] || 0) + 1;
      this.emit({ type: 'kill', position: e.position.slice() });
      if (e.carry) this.inventory[e.carry]++;
      if (e.split) for (let i = 0; i < e.split[0]; i++)
         this.spawn(e.split[1], { angle: e.angle + (i - (e.split[0] - 1) / 2) * .12, distance: e.distance, y: e.y });
   }
   hitEye() {
      if (++this.root.eyeHits < 3) return;
      this.root.exposed = 0; this.root.budget--;
      for (const a of this.attacks.slice()) {
         if (a.type === 'BLACKOUT' && a.warn > 0) this.endAttack(a, 'gunner');
         else if (a.warn <= 0) a.left /= 2;
      }
      this.emit({ type: 'eye', position: EYE });
   }
   moveEnemies(dt) {
      this.safe = Math.max(0, this.safe - dt);
      this.blackout = Math.max(0, this.blackout - dt);
      for (const e of this.enemies) {
         if (e.hp <= 0) continue;
         e.hit = Math.max(0, e.hit - dt);
         if (e.special === 'thief') e.distance += 1.6 * dt;
         // No breach resolves during a blackout: daemons wait at the line.
         else e.distance = Math.max(this.safe > 0 ? 1 : 0, e.distance - e.speed * dt);
         if (e.regen && (e.regenT += dt) >= e.regen[1]) { e.regenT = 0; e.hp = Math.min(e.maxHP, e.hp + e.regen[0]); }
         if (e.phase) e.vulnerable = (this.time + e.seed) % (e.phase[0] + e.phase[1]) < e.phase[0];
         this.place(e);
         if (!e.special && e.distance < 1) {
            e.hp = 0; this.hp = Math.max(0, this.hp - 1);
            this.emit({ type: 'damage', position: e.position });
         }
      }
      this.enemies = this.enemies.filter(e => e.hp > 0);
   }

   // ROOT's countermeasures. One per player at a time also enforces the
   // "never lock both guns" and "never lock the panel during an injection" rules.
   startAttack(spec, line) {
      const kind = ATTACKS[spec.type], target = kind.target, s = this.stats;
      const cost = spec.type === 'POPUP' ? spec.count : kind.cost;
      if (this.attacks.some(a => ATTACKS[a.type].target === target) || this.waveTime - s.lastEnd[target] < 8 ||
          this.root.spent + cost > this.root.budget * (this.hp <= 2 ? .7 : 1) ||
          spec.type === 'BLACKOUT' && this.waveTime - s.lastBlackout < 20) return false;
      this.root.spent += cost;
      // The first attack of each type in a run gives three times the warning, so players can read the tip.
      const warn = kind.warn * (this.seen[spec.type] ? 1 : 3);
      this.seen[spec.type] = true;
      this.attacks.push({ id: this.nextId++, type: spec.type, hand: spec.hand, count: spec.count, code: spec.code,
         warn, total: warn, left: 0, age: 0 });
      if (spec.type === 'BLACKOUT') {
         s.lastBlackout = this.waveTime;
         this.packet = { position: PACKET_START.slice(), target: this.head.slice() };
      }
      this.root.target = target;
      if (line && this.time - this.root.lineAt > 3) { this.root.line = line; this.root.lineAt = this.time; }
      this.emit({ type: 'warn', position: EYE });
      return true;
   }
   activate(a) {
      a.left = ATTACKS[a.type].max;
      this.root.exposed = 2; this.root.eyeHits = 0;
      if (a.type === 'BLACKOUT') {
         const target = this.packet.target;
         this.packet = null;
         if (Math.hypot(...this.head.map((v, i) => v - target[i])) >= .4) return this.endAttack(a, 'gunner');
         this.blackout = 1.2; this.safe = 1.7;
      } else if (a.type === 'POPUP') {
         for (let i = 0; i < a.count; i++) this.popups.push({ id: this.nextId++, attack: a.id,
            position: [(this.random() - .5) * 1.4, 1.4 + this.random() * .5, -2.2 - i * .35] });
      } else if (a.type === 'GUN_LOCK') {
         a.glyphs = Array.from({ length: 4 }, () => Math.floor(this.random() * 4));
         this.cancel(a.hand);
      } else if (a.type === 'INJECT') {
         const id = this.nextNodeId++;
         for (const program of [this.draft, this.program]) {
            const found = findNode(program, n => n.type === 'fire');
            if (found) found.list.splice(found.index + (a.code === 'misfire'),
               0, a.code === 'misfire' ? { id, type: 'misfire', foreign: true } : { id, type: 'wait', value: .8, foreign: true });
         }
         this.revision++;
      } else if (a.type === 'PANEL_LOCK') {
         this.spawn('lock', { angle: -.55 + this.random() * .2, distance: 3.2, y: 1.5 }).attack = a.id;
      } else if (a.type === 'THIEF') {
         const owned = BLOCKS.filter(b => this.inventory[b.type] > 0);
         if (!owned.length) return this.endAttack(a, null);
         const type = owned[Math.floor(this.random() * owned.length)].type;
         this.inventory[type]--;
         Object.assign(this.spawn('thief', { distance: 2.5, y: 1.3 }), { attack: a.id, carry: type });
      }
      this.emit({ type: 'attack', kind: a.type, position: EYE });
   }
   updateAttacks(dt) {
      this.root.exposed = Math.max(0, this.root.exposed - dt);
      for (const a of this.attacks.slice()) {
         a.age += dt;
         if (a.warn > 0) {
            a.warn -= dt;
            if (a.type === 'BLACKOUT') {
               if (this.packet.dead) { this.endAttack(a, 'gunner'); continue; }
               const t = Math.min(1, a.age / a.total);
               this.packet.position = PACKET_START.map((v, i) => v + (this.packet.target[i] - v) * t);
            }
            if (a.warn <= 0) this.activate(a);
            continue;
         }
         a.left -= dt;
         const mine = e => e.attack === a.id;
         const solved = { BLACKOUT: false, GUN_LOCK: a.solved,
            POPUP: !this.popups.some(mine) && 'gunner',
            INJECT: !allNodes(this.program).some(n => n.foreign) && 'coder',
            PANEL_LOCK: !this.enemies.some(mine) && 'gunner',
            THIEF: !this.enemies.some(mine) && 'gunner' }[a.type];
         if (solved) this.endAttack(a, solved);
         else if (a.left <= 0) this.endAttack(a, a.type === 'BLACKOUT' ? 'landed' : null);
      }
   }
   endAttack(a, by) {
      const target = ATTACKS[a.type].target, mine = e => e.attack !== a.id;
      this.attacks = this.attacks.filter(x => x !== a);
      if (a.type === 'BLACKOUT') this.packet = null;
      if (a.type === 'POPUP') this.popups = this.popups.filter(mine);
      if (a.type === 'PANEL_LOCK' || a.type === 'THIEF') this.enemies = this.enemies.filter(mine);
      if (a.type === 'INJECT' && allNodes(this.draft).concat(allNodes(this.program)).some(n => n.foreign)) {
         this.draft = strip(this.draft); this.program = strip(this.program); this.revision++;
      }
      this.stats.lastEnd[target] = this.waveTime;
      this.log.push({ type: a.type, target, resolvedBy: by || 'timeout', seconds: round(a.age) });
      if (this.root.target === target) this.root.target = null;
      this.emit({ type: 'resolved', kind: a.type, by });
   }
   metric(name) {
      const s = this.stats, now = this.waveTime;
      if (name === 'gunner.accuracy10s') {
         s.shotLog = s.shotLog.filter(([t]) => t > now - 10);
         return s.shotLog.length ? s.shotLog.filter(x => x[1]).length / s.shotLog.length : 0;
      }
      const volleys = s.volleys.left + s.volleys.right;
      return { 'gunner.rightHandShare': volleys ? s.volleys.right / volleys : .5,
         'gunner.idleSeconds': now - s.lastVolley,
         'coder.panelOpenSeconds': this.panel.open ? this.time - this.panel.since : 0,
         'coder.editsLast10s': s.edits.filter(t => t > this.time - 10).length,
         integrity: this.hp, daemonsAlive: this.enemies.length,
         secondsSinceResolved: now - Math.max(s.lastEnd.gunner, s.lastEnd.coder) }[name] ?? 0;
   }
   direct(dt) {
      for (const t of this.script?.tactics || []) {
         if (t.done) continue;
         let ready = t.at !== undefined && this.waveTime >= t.at;
         if (t.when) {
            const value = this.metric(t.when.metric);
            t.held = (t.when.op === '<' ? value < t.when.value : value > t.when.value) ? (t.held || 0) + dt : 0;
            ready = t.held >= t.when.forSeconds;
         }
         if (ready && this.waveTime - (t.last ?? -99) >= 15 && this.startAttack(t.do, t.line)) {
            t.last = this.waveTime; t.held = 0; t.done = !t.repeat;
         }
      }
   }
   spawnTick(dt) {
      const wave = WAVES[this.wave - 1], alive = this.enemies.filter(e => !e.special).length;
      if ((this.spawnIn -= dt) <= 0 && alive < 6) {
         this.spawn(wave.pool[Math.floor(this.random() * wave.pool.length)]);
         this.spawnIn = wave.every;
      }
      for (const group of this.script?.spawns || [])
         if (group.left > 0 && this.waveTime >= group.next && alive < 8) {
            this.spawn(group.daemon); group.left--; group.next += group.every;
         }
   }
   endWave() {
      this.clearWave();
      const script = this.script;
      this.debrief = { wave: this.wave, source: script?.source || 'observe', log: this.log,
         rationale: script?.rationale || ['Observation only. ROOT logged your behavior.'] };
      this.hp = Math.min(5, this.hp + 1); this.capacity += 2;
      this.phase = this.wave === WAVES.length ? 'won' : 'upgrade';
      this.emit({ type: this.phase });
   }
   clearWave() {
      // Daemons purged at the end of a wave drop what they stole.
      for (const e of this.enemies) if (e.carry) this.inventory[e.carry]++;
      for (const a of this.attacks.slice()) this.endAttack(a, null);
      this.enemies = []; this.cancel();
      this.root.target = null; this.root.exposed = 0;
   }
   telemetry() {
      const s = this.stats, volleys = s.volleys.left + s.volleys.right;
      return { nextWave: this.wave + 1, integrity: this.hp, program: programText(this.program),
         ownedBlocks: this.ownedTypes(), capacity: this.capacity + 2,
         gunner: { accuracy: round(this.hits / Math.max(1, this.shots), 2),
            rightHandShare: round(volleys ? s.volleys.right / volleys : .5, 2), killsByDaemon: s.killsBy },
         coder: { editsLastWave: s.edits.filter(t => t >= this.waveStart).length },
         countermeasures: this.log, previousDaemons: Object.values(this.custom).map(d => d.name) };
   }
}
