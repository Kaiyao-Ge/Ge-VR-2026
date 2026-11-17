// The Link of a device that is alone, or forced to run both parts (?railsRole=both): the IDE and the runtime host sit in
// one page, and this object offers each of them the surface that link.js offers (on, sendIn/Snap/Ack/Dev/Cmd, live, mutual,
// peer), so that neither knows the difference. A message is built and checked by wire.js like one for the relay, copied,
// and handed to the other side at once, in the order sent; nothing goes to the server. A handler that throws is counted
// and does not reach the sender (the Worker's callback, or a key handler, must not be taken down by the other part).
//
// routedLink() wraps the real Link and the loopback for one part: sends and events go through the loopback while the
// page's role is 'both' and through the real Link otherwise, so that a part is created once and a change of role needs
// no rewiring. retire() silences a part for good and removes its handlers from both links (the scene builds a fresh
// runtime host each time it is activated again, and the old one must not hear anything or be kept alive). signal() calls
// the part's own handlers of a type at once, whatever the role: the scene uses it to tell the IDE `pair` when its
// upstream changes (a new host, or a switch between the real link and the loopback).
import { validCopy, senders } from './wire.js';
import { errText } from './values.js';

const SENDS = Object.keys(senders(null));
const READS = ['rank', 'caps', 'epoch', 'stats', 'rtt', 'off'];   // what only the real Link knows

export function createLoopback({ now = () => 0, caps = { mac: false } } = {}) {
   const stats = { sent: 0, refused: 0, errors: 0, lastError: null };
   const handlers = { ide: {}, host: {} };
   let seq = 0;

   const guarded = (fn, ...args) => {
      try { fn(...args); }
      catch (err) { stats.errors++; stats.lastError = errText(err).slice(0, 200); }
   };
   // The message is the copy that send made: every handler of the side hears that one. As link.js does, an `in` of kind blur
   // is also a release (held keys and buttons are let go, a grab is cancelled).
   const deliver = (to, message) => {
      for (const fn of handlers[to][message.type] || []) guarded(fn, message, 0);
      if (message.type === 'in' && message.ev.k === 'blur') for (const fn of handlers[to].release || []) guarded(fn, 'blur');
   };

   // The two sides differ in their name only: a message sent on one is heard on the other.
   const side = (me, other) => {
      const send = (type, fields) => {
         const message = validCopy({ ...fields, type, from: 0, epoch: 'loopback', seq: seq++, t: now() });
         if (!message) { stats.refused++; return false; }
         stats.sent++;
         deliver(other, message);
         return true;
      };
      const peer = { id: 0, rank: 1, role: 'both', caps, epoch: 'loopback', heard: 0, said: null };
      const s = {
         on(type, fn) { (handlers[me][type] ||= []).push(fn); return s; },
         removeHandler(type, fn) { handlers[me][type] = (handlers[me][type] || []).filter(f => f !== fn); return s; },
         ...senders(send),
         live: true, mutual: true, heardMs: 0, role: 'both',
         get peer() { return { ...peer, heard: now() }; },
      };
      return s;
   };

   return {
      ide: side('ide', 'host'),
      host: side('host', 'ide'),
      stats,
      // The pairing of two parts that were apart: what a real Link says when it becomes mutual, so that the host sends a
      // full snapshot to the IDE (which keeps its buffers and refills from it).
      pair() { deliver('host', { type: 'pair' }); },
   };
}

// One part's view of the two links. `role()` is the page's role now; `side` is 'ide' or 'host' (which end of the loopback
// this part is).
export function routedLink({ real, loop, role, side }) {
   let alive = true;
   const near = () => role() === 'both';
   const added = [];   // [target, type, wrapper], to take them off again
   // The part's own handlers by type, for signal().
   const own = {};
   const link = {
      // Events of the real Link only count outside 'both', those of the loopback only inside it.
      on(type, fn) {
         const far = (...args) => { if (alive && !near()) fn(...args); };
         const close = (...args) => { if (alive && near()) fn(...args); };
         real.on(type, far); loop[side].on(type, close);
         added.push([real, type, far], [loop[side], type, close]);
         (own[type] ||= []).push(fn);
         return link;
      },
      signal(type, ...args) { if (alive) for (const fn of own[type] || []) fn(...args); },
      retire() {
         alive = false;
         for (const [target, type, fn] of added.splice(0)) target.removeHandler?.(type, fn);
         for (const k of Object.keys(own)) delete own[k];
      },
      get live() { return near() ? true : real.live; },
      get mutual() { return near() ? true : real.mutual; },
      get heardMs() { return near() ? 0 : real.heardMs; },
      get peer() { return near() ? loop[side].peer : real.peer; },
      get role() { return role(); },
   };
   for (const name of SENDS) link[name] = (...args) => (near() ? loop[side] : real)[name](...args);
   for (const name of READS) Object.defineProperty(link, name, { get: () => real[name], enumerable: true });
   return link;
}
