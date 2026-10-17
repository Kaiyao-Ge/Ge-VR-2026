// Daemon trait language shared by the base library and ROOT's generated designs.
export const PALETTE = { threat: [.9, .14, .22], warning: [1, .52, .2], metal: [.11, .09, .13],
   glow: [1, .74, .39], gold: [1, .69, .29] };
export const FORMS = ['cube', 'sphere', 'octahedron', 'coneX', 'coneY', 'coneZ', 'pyramidX', 'pyramidY',
   'pyramidZ', 'torusX', 'torusY', 'torusZ', 'tubeX', 'tubeY', 'tubeZ', 'diskX', 'diskY', 'diskZ'];
// [min, max, integer]
export const TRAITS = {
   approach: { speed: [.25, .8] },
   strafe: { amplitude: [.2, 1], period: [1.5, 4] },
   armor: { n: [1, 2, true] },
   shield: { hp: [2, 8, true] },
   regen: { n: [1, 2, true], every: [.5, 1.5] },
   phase: { on: [.3, 1], off: [.4, 1.2] },
   split: { count: [2, 4, true] },
};
const TAGS = ['body', 'shield', 'core', 'detail'];
const clamp = (value, [lo, hi, int], fallback = lo) => {
   const n = Math.min(hi, Math.max(lo, Number.isFinite(Number(value)) ? Number(value) : fallback));
   return int ? Math.round(n) : Math.round(n * 100) / 100;
};
const vec = (v, range, fallback) => [0, 1, 2].map(i => clamp(v?.[i], range, fallback));
const part = (form, pos, scale, color, tag = 'body', mirror = false) => ({ form, pos, scale, color, tag, mirror });
const daemon = (id, hp, size, traits, parts, special) =>
   ({ id, name: id.toUpperCase(), summary: '', hp, size, traits, parts, special });
const approach = speed => ({ type: 'approach', speed });

// Parts live in a unit box; +z faces the player.
export const DAEMONS = {
   drone: daemon('drone', 2, .28, [approach(.4)], [
      part('octahedron', [0, 0, 0], [1, 1, 1], 'threat'),
      part('cube', [0, .1, .75], [.6, .25, .12], 'glow', 'core'),
      part('octahedron', [.85, -.15, 0], [.3, .5, .4], 'warning', 'detail', true)]),
   skitter: daemon('skitter', 1, .2, [approach(.7), { type: 'strafe', amplitude: .4, period: 1.5 }], [
      part('pyramidZ', [0, 0, 0], [.8, .5, 1], 'warning'),
      part('coneX', [.9, 0, -.2], [.5, .15, .15], 'threat', 'detail', true)]),
   brick: daemon('brick', 6, .42, [approach(.25), { type: 'armor', n: 1 }], [
      part('cube', [0, 0, 0], [.85, .75, .75], 'metal'),
      part('cube', [0, 0, .8], [.6, .2, .08], 'threat', 'core'),
      part('cube', [.9, -.3, 0], [.15, .4, .6], 'warning', 'detail', true)]),
   bulwark: daemon('bulwark', 3, .32, [approach(.35), { type: 'shield', hp: 4 }], [
      part('sphere', [0, 0, 0], [.7, .7, .7], 'threat'),
      part('diskZ', [0, 0, .95], [.95, .95, .1], 'metal', 'shield')]),
   pulse: daemon('pulse', 3, .3, [approach(.4), { type: 'phase', on: .6, off: .9 }], [
      part('sphere', [0, 0, 0], [.6, .6, .6], 'glow', 'core'),
      part('torusZ', [0, 0, 0], [1, 1, .4], 'threat'),
      part('torusX', [0, 0, 0], [.4, .8, .8], 'warning', 'detail')]),
   mender: daemon('mender', 5, .34, [approach(.3), { type: 'regen', n: 1, every: .5 }], [
      part('octahedron', [0, 0, 0], [.8, 1, .8], 'threat'),
      part('torusY', [0, 0, 0], [1, .3, 1], 'glow', 'core')]),
   splitter: daemon('splitter', 3, .32, [approach(.35), { type: 'split', count: 3, child: 'skitter' }], [
      part('octahedron', [.3, 0, 0], [.6, .6, .6], 'threat', 'body', true),
      part('sphere', [0, 0, .3], [.3, .3, .3], 'glow', 'core')]),
   lock: daemon('lock', 2, .3, [], [
      part('cube', [0, -.2, 0], [.8, .6, .4], 'gold'),
      part('torusZ', [0, .5, 0], [.55, .55, .3], 'gold', 'detail')], 'lock'),
   thief: daemon('thief', 1, .2, [approach(0)], [
      part('octahedron', [0, 0, 0], [.7, .7, 1], 'gold'),
      part('cube', [0, 0, -.9], [.5, .5, .5], 'warning', 'core')], 'thief'),
};

export function normalizeDaemon(raw = {}, id) {
   const traits = [];
   for (const t of Array.isArray(raw.traits) ? raw.traits : []) {
      const spec = TRAITS[t?.type];
      if (!spec || traits.some(x => x.type === t.type)) continue;
      const trait = { type: t.type };
      for (const key in spec) trait[key] = clamp(t[key], spec[key]);
      if (t.type === 'split') trait.child = t.child === 'drone' ? 'drone' : 'skitter';
      traits.push(trait);
   }
   const kept = [traits.find(t => t.type === 'approach') || approach(.4),
      ...traits.filter(t => t.type !== 'approach').slice(0, 3)];
   const parts = (Array.isArray(raw.parts) ? raw.parts : []).filter(p => FORMS.includes(p?.form)).slice(0, 12)
      .map(p => part(p.form, vec(p.pos, [-1, 1], 0), vec(p.scale, [.05, 1], .3),
         PALETTE[p.color] && p.color !== 'gold' ? p.color : 'threat', TAGS.includes(p.tag) ? p.tag : 'detail', !!p.mirror));
   if (!parts.length) parts.push(...DAEMONS.drone.parts);
   if (kept.some(t => t.type === 'shield') && !parts.some(p => p.tag === 'shield'))
      parts.push(part('diskZ', [0, 0, 1], [.9, .9, .1], 'metal', 'shield'));
   return { id, name: String(raw.name || 'UNNAMED').toUpperCase().slice(0, 16),
      summary: String(raw.summary || '').slice(0, 80), hp: clamp(raw.hp, [1, 8, true], 3),
      size: clamp(raw.size, [.2, .45], .3), traits: kept, parts };
}

export function daemonSource(def) {
   const body = def.traits.map(t => ({
      approach: `approach(${t.speed});`, strafe: `strafe(${t.amplitude}, ${t.period}s);`,
      armor: `armor(${t.n});`, shield: `shield(${t.hp});`, regen: `regen(${t.n}, ${t.every}s);`,
      phase: `phase(${t.on}s, ${t.off}s);`, split: `onDeath { split(${t.count}, ${t.child}); }`,
   })[t.type].padEnd(24) + ' // ' + ({
      approach: 'walks to the line', strafe: 'sidesteps → spread, chain', armor: `-${t.n} per bolt → power`,
      shield: 'blocks the front → chain, power', regen: 'heals itself → power bursts',
      phase: 'faded = immune → keep firing', split: 'splits on death → spread, pierce',
   })[t.type]);
   return [`daemon ${def.name} (hp ${def.hp}) {`, ...body.map(line => '   ' + line), '}'];
}
