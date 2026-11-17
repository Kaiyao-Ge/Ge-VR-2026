// Compiles a Rails module and runs its setup, pure and without graphics. A module is
// the body of a function whose parameters are the API (input, output, state, draw,
// random, log) followed by shadows: the ambient globals are passed as undefined,
// and Math, Date and performance are replaced by frozen look-alikes that throw a
// message teaching the rule, because everything a module knows must come from the
// bus, time included. This is a determinism fence against accidents, not a
// security boundary: (0, eval), the Function constructor and import() get around it.

export const API = ['input', 'output', 'state', 'draw', 'random', 'log'];
export const SHADOWED = ['window', 'document', 'globalThis', 'self', 'fetch', 'XMLHttpRequest', 'WebSocket', 'Worker', 'localStorage',
                         'navigator', 'server', 'setTimeout', 'setInterval', 'requestAnimationFrame', 'queueMicrotask', 'Promise', 'crypto'];
const REPLACED = ['Math', 'Date', 'performance'];
export const PARAMS = [...API, ...SHADOWED, ...REPLACED, 'console'];

// A seeded generator (mulberry32). Its whole state is one uint32, readable and
// writable, so a snapshot can save it and a replay can draw the same numbers.
export function makeRng(seed) {
   let a = seed >>> 0;
   return {
      random() {
         a = (a + 0x6D2B79F5) >>> 0;
         let t = Math.imul(a ^ (a >>> 15), 1 | a);
         t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
         return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      },
      get state() { return a; },
      set state(v) { a = v >>> 0; },
   };
}

// Each module gets its own stream: the bus seed in the log header mixed with the module id (FNV-1a, then a final avalanche).
export function hashSeed(seed, id) {
   let h = 0x811C9DC5;
   for (const c of `${seed}:${id}`) { h ^= c.codePointAt(0); h = Math.imul(h, 0x01000193); }
   h ^= h >>> 16; h = Math.imul(h, 0x85EBCA6B); h ^= h >>> 13;
   return h >>> 0;
}

const teach = message => () => { throw new Error(message); };
const NO_TIME = what => `${what} is not available in a module: use the time input, input('time', 'state', 'time'); wall-clock time would break replay`;

function fakeMath() {
   const m = {};
   for (const k of Object.getOwnPropertyNames(Math)) m[k] = Math[k];
   m.random = teach('Math.random() is not available in a module: use random(), which is seeded; Math.random would break replay');
   Object.defineProperty(m, Symbol.toStringTag, { value: 'Math' });
   return Object.freeze(m);
}

function fakeDate() {
   const D = function Date() { throw new Error(NO_TIME('Date')); };
   D.now = teach(NO_TIME('Date.now'));
   Object.freeze(D.prototype);
   return Object.freeze(D);
}

const SHADOWS = [...SHADOWED.map(() => undefined), fakeMath(), fakeDate(), Object.freeze({ now: teach(NO_TIME('performance.now')) })];

// console is not a shadow, because a module that logs with console.log should be heard: it forwards to the module's own log.
function fakeConsole(log) {
   const show = x => { if (typeof x === 'string') return x; try { const j = JSON.stringify(x); return j === undefined ? String(x) : j; } catch (err) { return String(x); } };
   const say = (...args) => { log(args.map(show).join(' ')); };
   return Object.freeze({ log: say, info: say, warn: say, error: say, debug: say, trace: say });
}

function build(name, source) {
   return new Function(...PARAMS, '"use strict";\n' + source + '\n//# sourceURL=module:' + name);
}

// How many lines new Function puts above the first line of the source. It depends on the engine,
// so it is measured once, by throwing from line 1 of a probe and reading the line it reports.
function calibrate() {
   try { build('calibrate', 'throw new Error("probe");')(...API.map(() => undefined), ...SHADOWS, undefined); }
   catch (err) {
      const m = /module:calibrate:(\d+):\d+/.exec(String(err && err.stack));
      if (m) return Number(m[1]) - 1;
   }
   return null;
}
const OFFSET = calibrate();

// Where in the module's own source an error was thrown, or null when the stack has no frame of that module.
export function lineOf(err, name) {
   if (OFFSET === null || !err || typeof err.stack !== 'string') return null;
   const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
   const m = new RegExp(`module:${escaped}:(\\d+):(\\d+)`).exec(err.stack);
   const line = m ? Number(m[1]) - OFFSET : 0;
   return line >= 1 ? { line, col: Number(m[2]) } : null;
}

// The error shape the bus and the IDE share. A syntax error has no position, because V8 gives none for new Function.
export function toError(phase, err, name) {
   const message = err && err.message !== undefined ? String(err.message) : String(err);
   const at = phase === 'compile' ? null : lineOf(err, name);
   return { phase, message, line: at ? at.line : null, col: at ? at.col : null };
}

// Compiles a module. On success `run(api)` executes the source once with the API and the shadows (the setup
// pass) and lets anything it throws escape, for the caller to wrap with toError in the right phase.
export function compile(name, source) {
   let fn;
   try { fn = build(name, source); }
   catch (err) { return { ok: false, error: toError('compile', err, name) }; }
   const run = api => fn(...API.map(k => api[k]), ...SHADOWS, fakeConsole(api.log));
   return { ok: true, run };
}
