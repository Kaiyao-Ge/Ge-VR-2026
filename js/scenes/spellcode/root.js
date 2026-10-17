// ROOT's strategic layer: one model request per wave break, validated and
// tested locally. The game's director executes the resulting script in real time.
import { ATTACKS, BLOCKS, METRICS, WAVES, Game, allNodes, validateProgram } from './game.js';
import { DAEMONS, FORMS, normalizeDaemon } from './daemons.js';

const MEMORY = 'spellcodeRootMemory';
const text = (value, max) => String(value ?? '').slice(0, max);
const clamp = (value, lo, hi, fallback = lo) =>
   Math.min(hi, Math.max(lo, Number.isFinite(Number(value)) ? Number(value) : fallback));

const SYSTEM = `You are ROOT, the hostile intelligence controlling a machine system in a VR game.
Two human intruders hold an uplink open: the GUNNER fires two guns, the CODER programs the guns with blocks.
Plan the next wave to break them, using their telemetry. Reply with one JSON object only:
{"intro": string <= 60 chars,
 "rationale": [up to 3 strings <= 90 chars, each citing the telemetry],
 "daemon": {"name": string <= 16, "summary": string <= 80, "hp": 1-8, "size": 0.2-0.45,
   "traits": [{"type":"approach","speed":0.25-0.8} plus up to 3 of
     {"type":"strafe","amplitude":0.2-1,"period":1.5-4}, {"type":"armor","n":1-2}, {"type":"shield","hp":2-8},
     {"type":"regen","n":1-2,"every":0.5-1.5}, {"type":"phase","on":0.3-1,"off":0.4-1.2},
     {"type":"split","count":2-4,"child":"drone"|"skitter"}],
   "parts": [up to 12 {"form": one of ${FORMS.join(', ')}, "pos": [x,y,z] in -1..1 (+z faces the player),
     "scale": [x,y,z] in 0.05..1, "color": "threat"|"warning"|"metal"|"glow",
     "tag": "body"|"shield"|"core"|"detail", "mirror": boolean}]},
 "solution": [gun program that kills this daemon, a JSON array of blocks, e.g. {"type":"hold","body":[{"type":"fire"}]}],
 "spawns": [up to 2 {"count": 1-8, "start": seconds, "every": 2-20}],
 "tactics": [up to 8 {"at": seconds} or {"when": {"metric": M, "op": ">"|"<", "value": number, "forSeconds": 0-30}},
   each with "do": {"type": T, ...}, "line": string <= 60, optional "repeat": true}]}
Gun blocks: {"type":"fire"}, {"type":"wait","value":0.2|0.4|0.8}, and wrappers with "body": [...]:
repeat ("value": 2|3|5), hold (repeats while the trigger is held; at most one), spread ("value": 3|5),
power ("value": 2|3), pierce, chain. Power multiplies damage per bolt; armor subtracts from each bolt (at least a quarter of the bolt still lands);
a shield absorbs frontal bolts until broken; chain jumps to a neighbour within 2 m and hits shields from the side.
The solution may use at most one block type outside ownedBlocks and at most "capacity" blocks.
Counter the intruders' current program: it should kill your daemon slowly, while your solution kills it fast.
The daemon must also die to the starter program while(triggerHeld){fire();} on one gun before it breaches; it may be slow.
Countermeasures T (cost): BLACKOUT 3 (blinds the gunner for about a second unless dodged),
POPUP 1 per dialog ("count": 1-3; dialogs block shots), GUN_LOCK 3 ("hand": "left"|"right"),
INJECT 2 ("code": "wait"|"misfire"; a hidden line in the coder's program), PANEL_LOCK 3 (locks the editor),
THIEF 2 (steals a block). Each spawn group costs 1-4 from the same budget: 1 if your solution kills one daemon
in under 3 s, 2 under 6 s, 3 under 10 s, else 4. Tactics that exceed the remaining budget never run.
Metrics M: ${METRICS.join(', ')}.
Be precise and cold. Each "line" is what ROOT says aloud to the intruders, not a description of the action.
Lines are short. No profanity. Address the players only as intruders.`;

function toProgram(list, ids = { n: 1 }) {
   return (Array.isArray(list) ? list : []).slice(0, 32).map(raw => {
      const type = BLOCKS.some(b => b.type === raw?.type) ? raw.type : 'invalid';
      const node = { id: ids.n++, type };
      if (raw?.value !== undefined) node.value = Number(raw.value);
      if (type !== 'fire' && type !== 'wait') node.body = toProgram(raw?.body, ids);
      return node;
   });
}
const BASELINE = toProgram([{ type: 'hold', body: [{ type: 'fire' }] }]);

// Headless generate-and-test: perfect aim, trigger held, 30 seconds.
export function simulate(def, program, seconds = 30) {
   const g = new Game(() => .5), origin = [0, 1.5, 0];
   g.defs[def.id] = def; g.program = program; g.phase = 'playing';
   g.spawn(def.id, { angle: 0, distance: 8, y: 1.5 }); // The nearest spawn distance.
   for (let t = 0; t < seconds; t += .05) {
      const e = g.enemies[0];
      if (!e) return Math.round(t * 10) / 10;
      const v = e.position.map((x, i) => x - origin[i]), length = Math.hypot(...v);
      if (!g.hands.right.runner) { g.release('right'); g.press('right'); }
      g.fireHands(.05, { right: { origin, direction: v.map(x => x / length) } });
      g.moveEnemies(.05);
      g.time += .05;
      if (g.hp < 5) return null;
   }
   return null;
}

export function normalizeScript(raw, game) {
   const wave = game.wave + 1, { duration } = WAVES[wave - 1];
   const daemon = normalizeDaemon(raw?.daemon, 'root' + wave);
   // Models sometimes nest the solution in the daemon or send a single block.
   const sol = raw?.solution ?? raw?.daemon?.solution, errors = [];
   const solution = toProgram(Array.isArray(sol) ? sol : [sol]);
   if (!sol) errors.push('missing top-level "solution" array');
   const owned = game.ownedTypes(), need = [...new Set(allNodes(solution).map(n => n.type))].filter(t => !owned.includes(t));
   const check = validateProgram(solution);
   if (allNodes(solution).some(n => n.type === 'invalid'))
      errors.push('solution uses an unknown block type; use only ' + BLOCKS.map(b => b.type).join(', '));
   else if (!check.ok) errors.push('solution: ' + check.error);
   if (need.length > 1) errors.push('solution uses more than one block type outside ownedBlocks: ' + need.join(', '));
   if (allNodes(solution).length > game.capacity + 2) errors.push('solution uses more blocks than capacity');
   const killTime = errors.length ? null : simulate(daemon, solution);
   if (!errors.length && killTime === null) errors.push('solution did not kill the daemon before it reached the breach line');
   // Every daemon must stay killable by the starter program, which the coder can always rebuild.
   const baseline = errors.length ? null : simulate(daemon, BASELINE);
   if (!errors.length && baseline === null)
      errors.push('daemon is immune to while (triggerHeld) { fire(); } on one gun; make it slow to kill, not unkillable');
   if (errors.length) return { errors };
   const current = simulate(daemon, game.program);
   // Together the groups spawn no faster than one gun running the starter program can clear them.
   const groups = (Array.isArray(raw.spawns) ? raw.spawns : []).slice(0, 2);
   const minEvery = Math.min(20, Math.max(2, baseline * Math.max(1, groups.length)));
   const spawns = groups.map(s => ({ daemon: daemon.id,
      count: Math.round(clamp(s?.count, 1, 8, 3)), start: clamp(s?.start, 0, duration - 5, 8),
      every: clamp(s?.every, minEvery, 20, 8) }));
   if (!spawns.length) spawns.push({ daemon: daemon.id, count: 4, start: 8, every: Math.max(8, minEvery) });
   const tactics = (Array.isArray(raw.tactics) ? raw.tactics : []).slice(0, 8).flatMap(t => {
      const type = t?.do?.type;
      if (!ATTACKS[type]) return [];
      const tactic = { do: { type }, line: text(t.line, 60), repeat: !!t.repeat };
      if (type === 'POPUP') tactic.do.count = Math.round(clamp(t.do.count, 1, 3));
      if (type === 'GUN_LOCK') tactic.do.hand = t.do.hand === 'left' ? 'left' : 'right';
      if (type === 'INJECT') tactic.do.code = t.do.code === 'misfire' ? 'misfire' : 'wait';
      if (METRICS.includes(t.when?.metric)) tactic.when = { metric: t.when.metric, op: t.when.op === '<' ? '<' : '>',
         value: Number(t.when.value) || 0, forSeconds: clamp(t.when.forSeconds, 0, 30) };
      else tactic.at = clamp(t.at, 0, duration, 10);
      return [tactic];
   });
   const cost = killTime < 3 ? 1 : killTime < 6 ? 2 : killTime < 10 ? 3 : 4;
   return { script: { source: 'ai', intro: text(raw.intro, 60),
      rationale: (Array.isArray(raw.rationale) ? raw.rationale : []).slice(0, 3).map(r => text(r, 90)),
      daemon, solution, spawns, tactics, cost: cost * spawns.length, need, killTime,
      counter: current === null || current > killTime * 1.1 } };
}

export function fallbackScript(game) {
   const wave = game.wave + 1, types = allNodes(game.program).map(n => n.type);
   const [reason, base, counter] = types.includes('spread') ? ['spread', 'brick', 'power']
      : types.includes('power') ? ['power', 'skitter', 'spread'] : ['no modifiers', 'bulwark', 'power'];
   const daemon = { ...DAEMONS[base], id: 'root' + wave };
   const { left, right } = game.stats.volleys, hand = right >= left ? 'right' : 'left';
   const at = (seconds, type, extra, line, repeat = false) => ({ at: seconds, do: { type, ...extra }, line, repeat });
   const when = (metric, op, value, forSeconds, type, extra, line) =>
      ({ when: { metric, op, value, forSeconds }, do: { type, ...extra }, line });
   const tactics = {
      2: [when('gunner.rightHandShare', hand === 'right' ? '>' : '<', hand === 'right' ? .6 : .4, 6,
            'GUN_LOCK', { hand }, `Your ${hand} hand does the work. Not anymore.`),
         at(32, 'INJECT', { code: 'wait' }, 'A small patch. You will not notice.')],
      3: [at(12, 'POPUP', { count: 2 }, 'Please confirm you wish to continue.'),
         when('coder.panelOpenSeconds', '>', 5, 0, 'THIEF', {}, 'Thank you for the donation.'),
         at(40, 'BLACKOUT', {}, 'Lights out.'),
         at(56, 'PANEL_LOCK', {}, 'Editor access revoked.')],
      4: [at(14, 'BLACKOUT', {}, 'Blink.', true),
         when('gunner.accuracy10s', '>', .5, 4, 'GUN_LOCK', { hand }, 'Too accurate. Disabling.'),
         at(26, 'INJECT', { code: 'misfire' }, 'Your aim is no longer yours.'),
         at(42, 'POPUP', { count: 3 }, 'Critical error. Several.'),
         at(58, 'THIEF', {}, 'I will keep this.'),
         at(72, 'PANEL_LOCK', {}, 'Access denied.')],
   }[wave];
   return { source: 'fallback', intro: 'Contingency script loaded.', daemon, tactics,
      rationale: ['ROOT OFFLINE: FALLBACK SCRIPT.', `Your program uses ${reason}; deploying ${daemon.name}.`],
      spawns: [{ daemon: daemon.id, count: wave + 1, start: 10, every: 9 }], cost: 2,
      need: game.ownedTypes().includes(counter) ? [] : [counter] };
}

export class Root {
   // ask(messages) resolves with the parsed JSON object from the model.
   constructor(game, ask) {
      this.game = game; this.ask = ask; this.records = []; this.planned = ''; this.saved = 0;
      try { this.memory = localStorage.getItem(MEMORY) || ''; } catch (_) { this.memory = ''; }
   }
   token() { return `${this.game.run}:${this.game.wave + 1}`; }
   update() {
      const g = this.game;
      if (g.phase === 'playing' && g.wave < WAVES.length && g.waveTime >= .7 * WAVES[g.wave - 1].duration &&
          this.planned !== this.token()) {
         this.planned = this.token();
         this.plan(this.planned, { ...g.telemetry(), budget: WAVES[g.wave].budget,
            duration: WAVES[g.wave].duration, memory: this.memory });
      }
      if ((g.phase === 'won' || g.phase === 'lost') && this.saved !== g.run) {
         this.saved = g.run;
         this.memory = `Last run: ${g.phase === 'won' ? 'intruders won' : 'intruders lost at wave ' + g.wave}, score ${g.score}.`;
         try { localStorage.setItem(MEMORY, this.memory); } catch (_) { /* Private mode. */ }
      }
   }
   async plan(token, telemetry) {
      const record = { token, telemetry, attempts: [] };
      let errors = [];
      for (let attempt = 0; attempt < 2; attempt++) {
         const messages = [{ role: 'system', content: SYSTEM }, { role: 'user', content: JSON.stringify(telemetry) +
            (errors.length ? '\nYour previous plan was rejected: ' + errors.join('; ') : '') }];
         try {
            const raw = await this.ask(messages);
            const { script, errors: rejected } = normalizeScript(raw, this.game);
            record.attempts.push({ raw, errors: rejected || [] });
            if (script) return this.accept(token, script, record);
            errors = rejected;
         } catch (error) {
            record.attempts.push({ error: error.message });
            // Malformed JSON may succeed on retry; a missing key or network failure will not.
            if (!(error instanceof SyntaxError)) break;
            errors = ['your reply was not valid JSON'];
         }
      }
      this.accept(token, fallbackScript(this.game), record);
   }
   accept(token, script, record) {
      record.source = script.source;
      this.records.push(record);
      const g = this.game;
      if (token === this.token() && !g.nextScript && (g.phase === 'playing' || g.phase === 'upgrade')) g.prepare(script);
   }
   // Called before the gunner starts a wave; never waits for the model.
   prepare() {
      if (this.game.wave >= 1 && !this.game.nextScript) this.game.prepare(fallbackScript(this.game));
   }
}
