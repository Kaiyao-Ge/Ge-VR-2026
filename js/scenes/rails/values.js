// The values that travel on the Rails bus, pure and without graphics: what a value
// may be, how it is copied and frozen at publish, what a module may draw, how
// persistent state survives a hot reload, and the one rule for docking a port to a
// rail. The bus, the sandbox and the IDE all use these functions, so they agree
// on what is legal and why a dock is refused.

import { SLOTS } from './layout.js';

export const TYPES = ['any', 'num', 'bool', 'str', 'vec3', 'time'];
export const KINDS = ['state', 'event'];
// Module, rail and device names. `constructor` is the one name here that an ordinary object already has, so it is reserved.
export const NAME = /^(?!constructor$)[a-z][a-z0-9_]{0,31}$/;
export const MAX_SOURCE = 64 * 1024, MAX_PASTE = 4096, MAX_REASON = 1000;   // chars: a module's source, one paste, a refusal's reason
export const MAX_VALUE_BYTES = 4096, MAX_STATE_BYTES = 16384, MAX_DEPTH = 6, MAX_SHAPES = 128;
export const SHAPES = ['sphere', 'box', 'line', 'text'];

// The bus holds at most this many variables (the built-in ones count), and the built-in variable of each
// device output, as {device: {port: variable}}.
export const MAX_VARS = 64;
export const DEVICE_VARS = { clock: { time: 'time' }, gaze: { hit: 'gaze_hit', on: 'gaze_on' }, pointer: { pos: 'pointer_pos', down: 'pointer_down' } };
// The key of an input in `uses` and in a layout: the card and the input name.
export const bindingKey = (card, port) => `${card}.${port}`;

export const CARD_SLOTS = SLOTS.length;          // cards the cylinder has room for
export const isSlot = v => Number.isInteger(v) && v >= 0 && v < CARD_SLOTS;

export const finite = x => typeof x === 'number' && Number.isFinite(x);
export const isVec3 = v => Array.isArray(v) && v.length === 3 && v.every(finite);
// isObject is the loose check ("something with keys"); isPlain also refuses class instances, for data that came from outside.
export const isObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);
export const isPlain = v => isObject(v) &&
                     (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null);
const fail = error => ({ ok: false, error });

// Small helpers the runtime and the IDE share: the two answers of a command, the text of a caught error, two values that
// are equal as JSON, a JSON deep copy, and a string cut to n characters with an ellipsis (at the end, or keeping the end).
export const yes = () => ({ ok: true });
export const no = reason => ({ ok: false, reason });
export const errText = err => String(err && err.message || err);
export const sameJson = (a, b) => a === b || JSON.stringify(a) === JSON.stringify(b);
export const jsonCopy = v => JSON.parse(JSON.stringify(v));
export const clip = (s, n) => s.length <= n ? s : n <= 1 ? '…'.slice(0, n) : s.slice(0, n - 1) + '…';
export const clipTail = (s, n) => s.length <= n ? s : n <= 1 ? '…'.slice(0, n) : '…' + s.slice(s.length - (n - 1));

// The length of a string in UTF-8 bytes.
const bytes = s => {
   let n = 0;
   for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      if (c < 0x80) n += 1;
      else if (c < 0x800) n += 2;
      else if (c >= 0xd800 && c < 0xdc00 && (s.charCodeAt(i + 1) & 0xfc00) === 0xdc00) { n += 4; i++; }   // a surrogate pair
      else n += 3;                                                                                         // (a lone surrogate encodes as U+FFFD)
   }
   return n;
};

// A type check for one value. `any` accepts everything, because validateValue is what
// decides whether a value may be on the bus at all.
export function typeOk(type, v) {
   switch (type) {
      case 'any': return true;
      case 'num': return finite(v);
      case 'bool': return typeof v === 'boolean';
      case 'str': return typeof v === 'string';
      case 'vec3': return isVec3(v);
      case 'time': return isPlain(v) && finite(v.t) && finite(v.dt) && finite(v.n);
      default: return false;
   }
}

// Walks a value and returns the first problem as text, or null. Depth counts the
// containers around a leaf, so [[1]] has depth 2; a cycle is caught by the depth limit.
// A shared reference is walked once per path, so a DAG of 100 references per level would
// take forever: `walk` counts every node it visits against MAX_NODES, and keeps a running
// lower bound of the JSON size so a huge value is refused before it is fully walked.
// `at` is a link to the parent ({ up, key }, the root has `root`): the path is only written out when there is a problem to report.
export const MAX_NODES = 10000;

function pathOf(at) {
   const keys = [];
   for (; at.up; at = at.up) keys.push(at.key);
   return keys.reduceRight((s, k) => typeof k === 'number' ? `${s}[${k}]` : `${s}.${k}`, at.root);
}

function problem(v, depth, at, walk) {
   if (++walk.nodes > MAX_NODES) return `value has more than ${MAX_NODES} nodes (shared references count once per path)`;
   if (v === null) { walk.bytes += 4; return null; }
   if (typeof v === 'boolean') { walk.bytes += v ? 4 : 5; return null; }
   if (typeof v === 'string') { walk.bytes += bytes(v) + 2; return null; }
   if (typeof v === 'number') { walk.bytes += 1; return finite(v) ? null : `${pathOf(at)} is not a finite number`; }
   if (typeof v !== 'object') return `${pathOf(at)} is ${v === undefined ? 'undefined' : typeof v}, which is not JSON`;
   if (depth > MAX_DEPTH) return `${pathOf(at)} is nested deeper than ${MAX_DEPTH} levels`;
   if (walk.bytes > walk.limit) return null;
   if (Array.isArray(v)) {
      if (v.length > MAX_NODES) return `${pathOf(at)} has ${v.length} items, over the node limit of ${MAX_NODES}`;
      walk.bytes += 2 + Math.max(0, v.length - 1);
      for (let i = 0; i < v.length; i++) { const p = problem(v[i], depth + 1, { up: at, key: i }, walk); if (p) return p; }
      return null;
   }
   if (!isPlain(v)) return `${pathOf(at)} is not a plain object`;
   const keys = Object.keys(v);
   walk.bytes += 2 + Math.max(0, keys.length - 1);
   for (const k of keys) {
      walk.bytes += bytes(k) + 3;
      const p = problem(v[k], depth + 1, { up: at, key: k }, walk);
      if (p) return p;
   }
   return null;
}

// Never throws: a getter or a Proxy that throws while it is walked or stringified is a refused value.
function validJson(v, limit, what) {
   const walk = { nodes: 0, bytes: 0, limit };
   try {
      const p = problem(v, 1, { root: what, up: null }, walk);
      if (p) return fail(p);
      if (walk.bytes > limit) return fail(`${what} is at least ${walk.bytes} bytes of JSON, over the limit of ${limit}`);
      const size = bytes(JSON.stringify(v));
      return size <= limit ? { ok: true } : fail(`${what} is ${size} bytes of JSON, over the limit of ${limit}`);
   } catch (err) {
      return fail(`${what} could not be read: ${err && err.message !== undefined ? err.message : err}`);
   }
}

// A value is publishable when it is JSON with finite numbers, at most 6 levels deep and 4096 bytes.
export function validateValue(v) {
   return validJson(v, MAX_VALUE_BYTES, 'value');
}

// A module's persistent state is a JSON object of at most 16 KB.
export function validState(o) {
   if (!isPlain(o)) return fail('state must be an object');
   return validJson(o, MAX_STATE_BYTES, 'state');
}

// A deep copy, optionally deep frozen. A key named __proto__ is defined rather than assigned, because
// assigning it would replace the prototype of the copy.
function copy(v, freeze) {
   if (v === null || typeof v !== 'object') return v;
   if (Array.isArray(v)) { const out = v.map(x => copy(x, freeze)); return freeze ? Object.freeze(out) : out; }
   const out = {};
   for (const k of Object.keys(v)) {
      if (k === '__proto__') Object.defineProperty(out, k, { value: copy(v[k], freeze), enumerable: true, writable: true, configurable: true });
      else out[k] = copy(v[k], freeze);
   }
   return freeze ? Object.freeze(out) : out;
}

// A published value is copied and frozen, so the publisher cannot change it afterwards and no reader can.
export function freezeCopy(v) {
   return copy(v, true);
}

const COLOUR = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
const KEYS = ['shape', 'p', 's', 'color', 'text', 'to'];

function shapeProblem(d, i) {
   const at = `draw[${i}]`;
   if (!isPlain(d)) return `${at} is not an object`;
   const extra = Object.keys(d).find(k => !KEYS.includes(k));
   if (extra) return `${at} has an unknown field '${extra}'`;
   if (!SHAPES.includes(d.shape)) return `${at}.shape must be one of ${SHAPES.join(', ')}`;
   if (!isVec3(d.p)) return `${at}.p must be three finite numbers`;
   if (!finite(d.s) && !(d.shape === 'box' && isVec3(d.s))) return `${at}.s must be a finite number${d.shape === 'box' ? ' or three' : ''}`;
   if (typeof d.color !== 'string' || !COLOUR.test(d.color)) return `${at}.color must be #rgb or #rrggbb`;
   if (d.shape === 'line' && !isVec3(d.to)) return `${at}.to must be three finite numbers`;
   if (d.shape === 'text' && (typeof d.text !== 'string' || d.text.length > 200)) return `${at}.text must be a string of at most 200 characters`;
   return null;
}

// A module's draw list: at most 128 shapes of plain data, in stage coordinates.
export function validDraw(list) {
   if (!Array.isArray(list)) return fail('draw needs a list of shapes');
   if (list.length > MAX_SHAPES) return fail(`draw has ${list.length} shapes, at most ${MAX_SHAPES}`);
   for (let i = 0; i < list.length; i++) { const p = shapeProblem(list[i], i); if (p) return fail(p); }
   return { ok: true };
}

const kindOf = x => x === null ? 'null' : Array.isArray(x) ? 'array' : typeof x;

// Hot reload: keep an old key when the new defaults still have it with the same kind of
// value, otherwise take the default. Keys the defaults no longer have are dropped. Values
// are copied, so the new state never shares objects with the old one or with the defaults.
export function migrate(old, defaults) {
   const before = isPlain(old) ? old : {};
   const out = {};
   for (const k of Object.keys(defaults)) {
      const keep = Object.hasOwn(before, k) && kindOf(before[k]) === kindOf(defaults[k]);
      Object.defineProperty(out, k, { value: copy(keep ? before[k] : defaults[k], false), enumerable: true, writable: true, configurable: true });
   }
   return out;
}

// The one dock rule: a port of direction dir, kind and type may bind to a rail when the
// kinds are equal and the types are equal or either is `any`. The reason is for the IDE to show.
export function compatible({ dir, kind, type }, rail) {
   if (dir !== 'in' && dir !== 'out') return { ok: false, reason: `unknown direction '${dir}'` };
   if (!TYPES.includes(type) || !TYPES.includes(rail.type)) return { ok: false, reason: `unknown type '${TYPES.includes(type) ? rail.type : type}'` };
   if (kind !== rail.kind) return { ok: false, reason: `kind mismatch: the port is ${kind}, the variable is ${rail.kind}` };
   if (type !== rail.type && type !== 'any' && rail.type !== 'any') return { ok: false, reason: `type mismatch: the port is ${type}, the variable is ${rail.type}` };
   return { ok: true };
}
