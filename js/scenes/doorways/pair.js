// The glue between the Doorways scene and its network session (net.js), for two players: what each
// client sends of its own part, how the other part is read and applied, and the rounds.
//
// Each client owns one part and sends it whole at 20 Hz; the other part is applied from the latest
// snapshot, checked field by field (anything malformed is ignored whole):
//   giant -> { at, held: { id, m } | null, body? }                      at: every room's { slot, rot }
//   mini  -> { state: MINI_PART values, ref, map, time, body? }          ref: the room it stands in (or 'table'),
//            map: its real body (model frame) to its avatar, relative to that room's settled pose;
//            time: the round's clock; body: its camera, for a desktop player (the headset's is in clientState).
// Everything is in the table's frame, so that it means the same at both tables.
import * as cg from '../../render/core/cg.js';
import { ENTRANCE, CELLS, DEPOT, MAX_KEYS, COLOURS, slotPose } from './rules.js';
import { MINI_PART } from './mini.js';
import { Session, Interp } from './net.js';
import { readBody } from './bodies.js';

export const CHANNEL = 'doorways';

const isMatrix = m => Array.isArray(m) && m.length === 16 && m.every(v => typeof v === 'number' && Number.isFinite(v));
const isObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const SLOTS = new Set([...CELLS, ...DEPOT]);

// A body is optional; one that is there must be good. Returns { ok, body }.
const body = b => { const r = b === undefined || b === null ? null : readBody(b); return { ok: b === undefined || b === null || r !== null, body: r }; };

const idList = (v, ids, limit = Infinity) => Array.isArray(v) && v.length <= limit && v.every(x => ids.has(x)) && new Set(v).size === v.length;
const colourList = (v, limit) => Array.isArray(v) && v.length <= limit && v.every(c => COLOURS.includes(c));

// The giant's snapshot, checked against the level: { at, held, body } (copies) or null.
export const readGiant = (m, level) => {
   if (!isObject(m) || !isObject(m.at)) return null;
   const ids = new Set(level.rooms.map(r => r.id)), names = Object.keys(m.at), slots = new Set();
   if (names.length !== ids.size || !names.every(n => ids.has(n))) return null;
   const at = {};
   for (const n of names) {
      const { slot, rot } = m.at[n] ?? {};
      if (!SLOTS.has(slot) || slots.has(slot) || !Number.isInteger(rot) || rot < 0 || rot > 3) return null;
      slots.add(slot);
      at[n] = { slot, rot };
   }
   let held = null;
   if (m.held !== null && m.held !== undefined) {
      if (!isObject(m.held) || !ids.has(m.held.id) || !isMatrix(m.held.m)) return null;
      held = { id: m.held.id, m: m.held.m.slice() };
   }
   const b = body(m.body);
   return b.ok ? { at, held, body: b.body } : null;
};

// The mini's snapshot, checked: { state, ref, map, time, body } or null. state has exactly the mini's part.
export const readMini = (m, level) => {
   if (!isObject(m) || !isObject(m.state)) return null;
   const ids = new Set(level.rooms.map(r => r.id)), s = m.state;
   const ok = (s.mini === ENTRANCE || ids.has(s.mini)) && colourList(s.keys, MAX_KEYS) && colourList(s.pressed, COLOURS.length) &&
      idList(s.taken, ids) && idList(s.unlocked, ids) && idList(s.opened, ids) &&
      Number.isFinite(s.penalty) && s.penalty >= 0 && typeof s.won === 'boolean';
   const ref = m.ref === 'table' || m.ref === ENTRANCE || ids.has(m.ref);
   if (!ok || !ref || !isMatrix(m.map) || !Number.isFinite(m.time) || m.time < 0) return null;
   const b = body(m.body);
   if (!b.ok) return null;
   const state = Object.fromEntries(MINI_PART.map(k => [k, JSON.parse(JSON.stringify(s[k]))]));
   return { state, ref: m.ref, map: m.map.slice(), time: m.time, body: b.body };
};

// What each client sends. body: a desktop player's body in the format of readBody, else nothing.
export const giantPart = (game, bodyOf) => ({
   at: game.state.at, held: game.held ? { id: game.held.id, m: game.held.m } : null, ...(bodyOf ? { body: bodyOf } : {}),
});
export const miniPart = (game, { ref, map, time, body: bodyOf }) => ({
   state: Object.fromEntries(MINI_PART.map(k => [k, game.state[k]])), ref, map, time, ...(bodyOf ? { body: bodyOf } : {}),
});

// The matrix that takes the mini's real body (model frame) to its avatar relative to the pose of the room it
// stands in, in the table frame: inv(pose) * inv(F) * toMini. The giant draws F * pose(ref) * map * body, so
// the avatar stays in the room, wherever the giant's hand has taken it.
export const mapOf = (pose, F, toMini) => cg.mMultiply(cg.mInverse(pose), cg.mMultiply(cg.mInverse(F), toMini));

// The network of the scene: a Session over the message queue of the classroom server.
//   id(), clients(): who I am and who is there; send(message): put a message in the queue;
//   sync(callback): deliver what has arrived, callback(messages, sender); now(): milliseconds.
export class Link {
   constructor({ id, clients, send, sync, now }) {
      this.session = new Session({ id, clients, send, now });
      this.sync = sync;
      this.now = now;
      this.round = 0;      // the round of the session that the scene has started
      this.key = null;     // that round with its seed and giant: what the scene has started
      this.reset();
   }

   // A round (or a partner) begins: nothing seen before it counts.
   reset() {
      this.seen = { giant: null, mini: null };   // the last snapshots looked at, so that each is checked once
      this.interp = new Interp();
      this.heldId = null;
      this.view = null;    // the mini's last { ref, map, time }, from its snapshot (for the giant's client)
      this.body = null;    // the partner's last snapshot body
   }

   // Deliver what has arrived; call it before reading, and after sending to flush.
   pump() {
      this.sync?.((messages, sender) => { for (const m of Object.values(messages)) this.session.receive(m, sender); });
   }

   // The rounds. Returns the seed of a round the scene must start now, or null. When a live pair has no round, the
   // giant starts the first (its own level); when the round's giant is neither of us, the lower id starts another.
   rounds(ownSeed, newSeed) {
      const s = this.session, peer = s.peer;
      if (s.live && s.round === 0 && s.role === 'giant') s.newRound(ownSeed, s.id());
      else if (s.live && s.round > 0 && s.giant !== s.id() && s.giant !== peer.id && s.id() < peer.id) s.newRound(newSeed, s.id());
      // Two rounds started at once have the same number: the session keeps the higher id's (its seed and giant), so the
      // seed and the giant count as much as the number.
      const key = s.round + '|' + s.seed + '|' + s.giant;
      if (s.round === 0 || key === this.key) return null;
      this.key = key;
      this.round = s.round;
      this.reset();
      return Number.isInteger(s.seed) && s.seed >= 0 ? s.seed : 0;
   }

   // A new round after a win: the giant stays (N), or the roles change (M).
   start(seed, swap) {
      const s = this.session, other = s.peer.id, giant = s.role === 'giant' ? s.id() : other;
      s.newRound(seed, swap ? (giant === s.id() ? other : s.id()) : giant);
   }

   // The mini's client takes the giant's part: where the rooms are, the room in its hand. moved(was, now) is called with
   // the settled poses (table frame) of the room the mini stands in when it has been set down somewhere else, for the
   // scene to carry the mini with it. The held room is interpolated, so that game.held.m is 100 ms behind.
   takeGiant(game, moved) {
      if (!this.session.live) return;
      const latest = this.session.latest.giant;
      if (latest && latest !== this.seen.giant) {
         this.seen.giant = latest;
         const part = readGiant(latest, game.level);
         if (part) this.applyGiant(game, part, moved);
      }
      game.held = this.heldId ? { id: this.heldId, m: this.interp.at(this.now()) ?? slotPose(game.state.at[this.heldId].slot, game.state.at[this.heldId].rot), hand: 'peer' } : null;
   }

   applyGiant(game, part, moved) {
      const home = game.state.mini === ENTRANCE ? null : game.state.at[game.state.mini], pose = a => slotPose(a.slot, a.rot);
      game.state.at = part.at;
      const now = home && part.at[game.state.mini];
      if (home && (now.slot !== home.slot || now.rot !== home.rot)) moved(pose(home), pose(now));
      if (part.held && part.held.id !== this.heldId) this.interp = new Interp();
      this.heldId = part.held?.id ?? null;
      if (part.held) this.interp.push(this.now(), part.held.m);
      this.body = part.body;
   }

   // The giant's client takes the mini's part: the state it owns, and where its avatar is.
   takeMini(game) {
      if (!this.session.live) return;
      const latest = this.session.latest.mini;
      if (!latest || latest === this.seen.mini) return;
      this.seen.mini = latest;
      const part = readMini(latest, game.level);
      if (!part) return;
      for (const k of MINI_PART) game.state[k] = part.state[k];
      this.view = { ref: part.ref, map: part.map, time: part.time };
      this.body = part.body;
   }

   // Every frame: presence, and my part at 20 Hz. See Session.tick.
   send(o) { this.session.tick(o); }
}
