// The messages that Rails sends over the class relay, and the one place that says what they look like. Every message
// is { type, from, epoch, seq, t } plus the fields of its type; valid() checks all of it, and refuses anything else:
// an unknown type, a field the type does not have, a number that is not finite. That matters most for `cmd`, which
// changes the runtime: its ops are a closed table, names are matched by regex, and there is no field that could carry
// a path or code. The envelope's `t` is the sender's clock in ms; `seq` counts up per sender over all types.
//
//    hello  { role: 'ide'|'runtime'|'both', rank: 1|2, caps: { mac }, echo?: { seq, t }, peer?: { id, epoch } | null }
//           peer is whom the sender has accepted and hears (link.js uses it to tell when a pairing is mutual)
//    in     { ev }   ev: { k:'key', d, key, code, mods:{c,a,s,m}, rep } | { k:'paste', text } | { k:'wheel', dx, dy, zoom? (+1 or -1: one step of zoom, wheel up = in) }
//                        | { k:'btn', d } | { k:'blur' }
//    dev    { id, port, value }
//    ack    { cmd, ok, reason? }
//    cmd    { cmd: { id, op, ...fields of the op (see CMDS) } }  nested, because a command's own fields could clash with the envelope
//    snap   { snap }  the runtime's snapshot, nested because its own `t` would clash with the envelope's
import { validateValue, isPlain as isObject, finite, isSlot, NAME, MAX_SOURCE, MAX_PASTE, MAX_REASON, MAX_VARS } from './values.js';

export const MAX_KEY = 16, MAX_MESSAGE = 256 * 1024;
const MAX_ENTRIES = 200, MAX_USES = 400;
const ENVELOPE = ['type', 'from', 'epoch', 'seq', 't'];

const isInt = v => Number.isSafeInteger(v) && v >= 0;
const isStr = v => typeof v === 'string';
const isBool = v => typeof v === 'boolean';
const oneOf = list => v => list.includes(v);
const isName = v => isStr(v) && NAME.test(v);
const isSource = v => isStr(v) && v.length <= MAX_SOURCE;

// An object whose keys are exactly those of `required`, plus any of `optional` that are present, each passing its check.
// A key that is present with the value undefined is present: it must pass too.
const shape = (required, optional = {}) => o => isObject(o) &&
   Object.keys(o).every(k => Object.hasOwn(required, k) || Object.hasOwn(optional, k)) &&
   Object.keys(required).every(k => Object.hasOwn(o, k) && required[k](o[k])) &&
   Object.keys(optional).every(k => !Object.hasOwn(o, k) || optional[k](o[k]));

// A map from names to small objects, as in the geometry command: { ball: { slot: 2 } }.
const mapOf = entry => o => isObject(o) && Object.keys(o).length <= MAX_ENTRIES &&
   Object.keys(o).every(k => NAME.test(k) && entry(o[k]));

const isMods = shape({ c: isBool, a: isBool, s: isBool, m: isBool });
const EVENTS = {
   key: shape({ k: oneOf(['key']), d: oneOf(['down', 'up']), key: v => isStr(v) && v.length >= 1 && v.length <= MAX_KEY,
                code: v => isStr(v) && v.length <= 32, mods: isMods, rep: isBool }),
   paste: shape({ k: oneOf(['paste']), text: v => isStr(v) && v.length <= MAX_PASTE }),
   wheel: shape({ k: oneOf(['wheel']), dx: finite, dy: finite }, { zoom: oneOf([-1, 1]) }),
   btn: shape({ k: oneOf(['btn']), d: oneOf(['down', 'up']) }),
   blur: shape({ k: oneOf(['blur']) }),
};
Object.setPrototypeOf(EVENTS, null);      // so that a kind named `constructor` or `toString` finds nothing
const isEvent = ev => isObject(ev) && isStr(ev.k) && !!EVENTS[ev.k] && EVENTS[ev.k](ev);

// The ops of `cmd` and the fields each has besides id and op: [required fields, optional fields], each a check. This is the
// table that the runtime (runtime.js) implements; an op that is not here does not exist.
const CMDS = {
   commit: [{ module: isName, source: isSource }],
   addModule: [{ module: isName }, { source: isSource }],
   rmModule: [{ module: isName }],
   renameModule: [{ module: isName, to: isName }],
   reset: [{ module: isName }],
   revert: [{ module: isName }],
   use: [{ module: isName, port: isName, variable: v => v === null || isName(v) }],      // the input of a card points at a variable (null: its own name)
   plug: [{ module: isName, on: isBool }],
   pause: [{}], resume: [{}], resumeHere: [{}], play: [{}], stop: [{}],
   seek: [{ t: finite }],
   geometry: [{ cards: mapOf(shape({ slot: isSlot })) }],
};
export const OPS = Object.keys(CMDS);
const cmdChecks = Object.assign(Object.create(null), Object.fromEntries(OPS.map(op => {
   const [required, optional] = CMDS[op];
   return [op, shape({ ...required, id: isInt, op: oneOf([op]) }, optional)];
})));

// The snapshot object: every field optional (the runtime sends only what changed), each with its type checked.
// What is inside rails, modules and the rest is for the IDE to read defensively; here only the size is bounded.
// `vars` (the names of the variables, at most MAX_VARS), `uses` ('card.input' -> variable) and `unplugged` (card names) are the bus's
// wiring.
const isUses = o => isObject(o) && Object.keys(o).length <= MAX_USES && Object.keys(o).every(k => isStr(k) && k.length <= 100 && isName(o[k]));
const isSnap = shape({}, {
   rev: isInt, t: finite, paused: isBool, playing: isBool, playhead: v => v === null || finite(v),
   window: v => Array.isArray(v) && v.length === 2 && v.every(finite),
   density: v => Array.isArray(v) && v.length <= 60 && v.every(finite),
   rails: isObject, modules: isObject, geometry: v => v === null || isObject(v),
   notices: Array.isArray,
   vars: v => Array.isArray(v) && v.length <= MAX_VARS && v.every(isName), uses: isUses,
   unplugged: v => Array.isArray(v) && v.length <= MAX_ENTRIES && v.every(isName),
});

const isCmd = rest => isObject(rest) && Object.keys(rest).length === 1 && isObject(rest.cmd) && isStr(rest.cmd.op) &&
   !!cmdChecks[rest.cmd.op] && cmdChecks[rest.cmd.op](rest.cmd);

const BODIES = {
   hello: shape({ role: oneOf(['ide', 'runtime', 'both']), rank: oneOf([1, 2]), caps: shape({ mac: isBool }) },
                { echo: shape({ seq: isInt, t: finite }),
                  peer: v => v === null || shape({ id: isInt, epoch: v => isStr(v) && v.length >= 1 && v.length <= 100 })(v) }),
   in: shape({ ev: isEvent }),
   dev: shape({ id: isName, port: isName, value: v => validateValue(v).ok }),
   ack: shape({ cmd: isInt, ok: isBool }, { reason: v => isStr(v) && v.length <= MAX_REASON }),
   snap: shape({ snap: isSnap }),
};
Object.setPrototypeOf(BODIES, null);

// The type-specific fields of a message, without the envelope.
// A key named __proto__ (JSON.parse makes it an own key) is never copied: it would replace the prototype of `rest`.
const body = m => {
   const rest = {};
   for (const k of Object.keys(m)) if (k === '__proto__') return null; else if (!ENVELOPE.includes(k)) rest[k] = m[k];
   return rest;
};
const isEnvelope = m => isInt(m.from) && isStr(m.epoch) && m.epoch.length >= 1 && m.epoch.length <= 100 && isInt(m.seq) && finite(m.t);
const tooBig = (m, text) => { try { return (text ?? JSON.stringify(m)).length > MAX_MESSAGE; } catch { return true; } };

// `text` is the message as JSON, when the caller has it already (the size is measured on it).
export function valid(m, text) {
   if (!isObject(m) || !isStr(m.type) || !isEnvelope(m)) return false;
   if (tooBig(m, text)) return false;
   const rest = body(m);
   if (rest === null) return false;
   if (m.type === 'cmd') return isCmd(rest);
   return !!BODIES[m.type] && BODIES[m.type](rest);
}

// A sender hands over a copy (the queue keeps references until the next sync): made from the same JSON text that the size
// check measures. Null when the message is not valid.
export function validCopy(m) {
   let text;
   try { text = JSON.stringify(m); } catch { return null; }
   return valid(m, text) ? JSON.parse(text) : null;
}

// The five senders of a part over its `send(type, fields)`; link.js and loopback.js both offer them.
export const senders = send => ({
   sendIn: ev => send('in', { ev }),
   sendSnap: snap => send('snap', { snap }),
   sendAck: (cmd, ok, reason) => send('ack', typeof reason === 'string' ? { cmd, ok, reason } : { cmd, ok }),
   sendDev: (id, port, value) => send('dev', { id, port, value }),
   sendCmd: command => send('cmd', { cmd: command }),
});
