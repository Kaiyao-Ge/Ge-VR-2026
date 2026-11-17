// The link between the two devices of Rails: a Quest headset (the IDE) and a laptop (the runtime, which also reads the
// keyboard). It pairs them over the class relay as Doorways does (js/scenes/doorways/net.js): hello at 2 Hz, the peer
// is the first other client heard while none is live, the same id with a new epoch is a reload of it, and a peer not
// heard for 3 s is gone. A stranger on the shared relay is therefore ignored until the peer is silent, and cannot type
// into the editor or send a command. The transport (id, clients, send, now) is injected, so it runs in Node.
//
// Roles: forced wins; alone is 'both'; with a live peer the higher rank is the IDE and the lower the runtime, and on
// equal ranks the lower id is the runtime. Events (on): 'hello', 'in', 'snap', 'ack', 'dev', 'cmd' from the paired peer
// only and validated; 'role' on a change; 'release' when it falls silent or its window loses focus, so that held keys
// and a grab are let go. 'pair' fires when the pairing becomes MUTUAL: we accepted the peer and its latest hello names
// our id and epoch (hello.peer), so what we send next is surely heard. It fires again whenever that is re-established
// (the peer reloads, we reload, the peer returns after silence); the host sends a full snapshot on it. Without this a
// laptop that reloaded under a new id would start sending to a headset that still holds the old one. Only a hello can
// pair; every other message is heard only while the pairing is mutual, so a stray tab that accepted the headset gets
// none of its commands. A peer that stays unmatched for 3 s is let go, and a side whose peer has the same rank as itself
// switches to a newcomer of the other rank (a laptop tab paired with another laptop tab meets the headset).
import { valid, validCopy, senders } from './wire.js';

const HELLO_MS = 500;       // presence: 2 Hz
const SILENT_MS = 3000;     // a peer not heard for this long is gone for now
const STALE_MS = 2000;      // an action `in` this much later than the best case is a stall, and typing it now would surprise
const BUCKET_MS = 3000, BUCKETS = 10;   // the best case is the minimum of the last 30 s, so a clock that stepped back recovers
const RTT_KEEP = 20;        // round trips the median is taken over
const RTT_MAX_MS = 60000;   // an echo older than this is not a measurement

// What an `in` does, as against what it lets go: only the first kind is dropped when late. A late key up, button up or
// blur must still arrive, or a key stays down on the headset.
const isAction = ev => (ev.k === 'key' || ev.k === 'btn') ? ev.d === 'down' : ev.k !== 'blur';

const UNMATCHED_MS = 3000;  // an accepted peer that does not name us back for this long is let go

const newEpoch = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;

// 2 for a headset: in XR, or a Quest's browser; 1 for everything else.
export const rankOf = ({ xr, ua } = {}) => xr || /OculusBrowser|Quest/.test(ua || '') ? 2 : 1;

// The next time for a periodic send: one interval after the last due time, not after the frame that noticed it, so that
// frames of 13.9 ms do not stretch 500 ms; a page that fell far behind starts afresh instead of sending a burst.
const schedule = (due, interval, now) => {
   const next = due + interval;
   return next < now - interval || !Number.isFinite(next) ? now + interval : next;
};

// The middle of the samples (the upper one of two), or null when there are none.
const median = list => list.length ? [...list].sort((a, b) => a - b)[Math.floor(list.length / 2)] : null;

export class Link {
   constructor({ id, clients, send, now, rank = 1, forced = null, caps = { mac: false } }) {
      if (rank !== 1 && rank !== 2) throw new Error(`rank must be 1 or 2, not ${rank}`);
      this.idOf = typeof id === 'function' ? id : () => id;
      this.clients = clients;
      this.sendRaw = send;
      this.now = now;
      this.rank = rank;
      this.forced = ['ide', 'runtime', 'both'].includes(forced) ? forced : null;
      this.caps = caps;
      // A new epoch per instance tells the peer that a reload is not the same session.
      this.epoch = newEpoch();
      this.seq = 0;
      this.known = null;               // the accepted peer: { id, rank, role, caps, epoch, heard, said }
      this.lastSeq = -1;               // newest seq heard from it
      this.mins = [];                  // [{ b, min }]: min(now - t) per 3 s bucket, over the last 30 s
      this.echo = null;                // { seq, t } of the last message heard from it
      this.stats = { rx: 0, gaps: 0, dups: 0, stale: 0, rttN: 0 };
      this.samples = [];               // the last round trips, ms
      this.rttMax = null;
      this.handlers = {};
      Object.assign(this, senders((type, fields) => this.send(type, fields)));   // sendIn, sendSnap, sendAck, sendDev, sendCmd
      this.nextHelloAt = -Infinity;
      this.wasLive = false;
      this.mutual = false;
      this.since = -Infinity;          // when the peer was accepted, or last stopped being mutual
      this.lastRole = this.role;
   }

   on(type, fn) { (this.handlers[type] ||= []).push(fn); return this; }
   // (not `off`: that is the clock offset)
   removeHandler(type, fn) { if (this.handlers[type]) this.handlers[type] = this.handlers[type].filter(f => f !== fn); return this; }
   emit(type, ...args) { for (const fn of this.handlers[type] || []) fn(...args); }

   // A peer heard within 3 s; later it is silent, and we are alone again.
   get live() { return !!this.known && this.now() - this.known.heard < SILENT_MS; }
   get heardMs() { return this.known ? this.now() - this.known.heard : null; }
   get peer() { return this.known ? { ...this.known } : null; }
   // min(now - t) over the peer's messages of the last 30 s: the clock offset plus the fastest delivery.
   get off() { return this.mins.reduce((m, e) => Math.min(m, e.min), Infinity); }
   get rtt() { return { p50: median(this.samples), max: this.rttMax }; }

   get role() {
      if (this.forced) return this.forced;
      if (!this.live) return 'both';
      if (this.rank !== this.known.rank) return this.rank > this.known.rank ? 'ide' : 'runtime';
      return this.idOf() < this.known.id ? 'runtime' : 'ide';
   }

   // ---- sending ----------------------------------------------------------------------------------------------------
   // The payload goes first so that it cannot overwrite the envelope. A message that would not be valid is not sent.
   send(type, fields) {
      const from = this.idOf();
      if (from === undefined || from === null) return false;
      const copy = validCopy({ ...fields, type, from, epoch: this.epoch, seq: this.seq, t: this.now() });
      if (!copy) return false;
      this.seq++;
      this.sendRaw(copy);
      return true;
   }

   // Called every frame: presence at 2 Hz, and the checks of role and silence.
   tick() {
      const now = this.now();
      if (now >= this.nextHelloAt) {
         this.nextHelloAt = schedule(this.nextHelloAt, HELLO_MS, now);
         // `peer` is whom we have accepted, if it is live: it tells the peer whether we hear it.
         const fields = { role: this.role, rank: this.rank, caps: this.caps,
                          peer: this.live ? { id: this.known.id, epoch: this.known.epoch } : null };
         if (this.echo) fields.echo = { ...this.echo };
         this.send('hello', fields);
      }
      this.check();
   }

   // ---- receiving --------------------------------------------------------------------------------------------------
   // The peer is the first other client whose hello arrives while there is no live peer. A hello from the peer's own
   // id with a new epoch is a reload of it. A live peer is also given up for a newcomer of a higher rank, if that rank
   // is not ours: a laptop with a laptop for a peer takes the headset, but a headset does not leave its laptop for a
   // second headset, and equal ranks never preempt.
   accepts(sender, rank) {
      if (this.known?.id === sender || !this.live) return true;
      return rank > this.known.rank && rank !== this.rank;
   }

   // Let the peer go: the next hello heard, from anybody, may be accepted afresh.
   drop(reason) {
      this.known = null; this.wasLive = false; this.mutual = false;
      this.emit('release', reason);
   }

   receive(message, sender) {
      if (!valid(message)) return;
      if (message.from !== sender || sender === this.idOf() || !this.clients().includes(sender)) return;
      this.check();   // a peer that was silent is released before it is heard again
      if (message.type === 'hello') {
         if (!this.accepts(sender, message.rank)) return;
         if (this.known && this.known.id !== sender && this.live) this.drop('preempted');
      } else if (!this.mutual || this.known.id !== sender || this.known.epoch !== message.epoch) return;   // hello alone pairs
      const fresh = this.hear(message, sender);
      if (fresh === null) return;
      if (message.type === 'hello') this.receiveHello(message, fresh);
      this.check();
      if (message.type === 'hello') this.emit('hello', message, sender);
      else this.receiveBody(message, sender);
   }

   // Book-keeping for any message of the peer: a fresh epoch starts a new session, an old or repeated seq is dropped.
   // Returns null if the message is to be ignored, else whether it started a session (a new peer or a reload).
   hear(m, sender) {
      const p = this.known;
      const fresh = !p || p.id !== sender || p.epoch !== m.epoch;
      if (fresh) {
         this.known = { id: sender, rank: 2, role: 'both', caps: { mac: false }, epoch: m.epoch, heard: this.now(), said: null };
         this.lastSeq = m.seq - 1;
         this.echo = null;
         // A new session is never the pairing of the old one, even when its first hello already names us (a reloaded page that
         // heard our hello before it sent its own): check() then finds it mutual again and says `pair`, so that the IDE
         // starts its snapshot baselines afresh and the runtime sends a full snapshot.
         this.mutual = false;
      }
      if (m.seq <= this.lastSeq) { this.stats.dups++; return null; }
      if (m.seq > this.lastSeq + 1) this.stats.gaps += m.seq - this.lastSeq - 1;
      this.lastSeq = m.seq;
      if (fresh || !this.wasLive) { this.mins = []; this.since = this.now(); }   // another clock, and a fresh 3 s to match
      this.wasLive = true;
      this.known.heard = this.now();
      this.best(this.now() - m.t);
      this.echo = { seq: m.seq, t: m.t };
      return fresh;
   }

   best(diff) {
      const b = Math.floor(this.now() / BUCKET_MS), last = this.mins[this.mins.length - 1];
      if (last && last.b === b) last.min = Math.min(last.min, diff);
      else this.mins.push({ b, min: diff });
      while (this.mins[0].b <= b - BUCKETS) this.mins.shift();
   }

   // A hello says whom the peer hears. When that changed, or the peer is new, we answer at the next tick instead of
   // waiting out the 500 ms, so that the pairing is mutual within a frame or two, not a second.
   receiveHello(m, fresh) {
      const said = m.peer ? { id: m.peer.id, epoch: m.peer.epoch } : null, was = this.known.said;
      this.known.said = said;
      Object.assign(this.known, { rank: m.rank, role: m.role, caps: m.caps });
      if (m.echo) this.measure(m.echo);
      if (fresh || (was?.id ?? null) !== (said?.id ?? null) || (was?.epoch ?? null) !== (said?.epoch ?? null))
         this.nextHelloAt = Math.min(this.nextHelloAt, this.now());
   }

   receiveBody(m, sender) {
      if (m.type !== 'in') return this.emit(m.type, m, sender);
      if (isAction(m.ev) && (this.now() - m.t) - this.off > STALE_MS) { this.stats.stale++; return; }
      this.stats.rx++;
      this.emit('in', m, sender);
      if (m.ev.k === 'blur') this.emit('release', 'blur');
   }

   // Round trip: the peer echoes the t of the last message of ours it heard; a sample that is negative or very old is
   // not a measurement (a clock that moved, or a peer that heard nothing of ours for a minute).
   measure(echo) {
      const rtt = this.now() - echo.t;
      if (!(rtt >= 0 && rtt <= RTT_MAX_MS)) return;
      this.stats.rttN++;
      this.samples.push(rtt);
      if (this.samples.length > RTT_KEEP) this.samples.shift();
      this.rttMax = Math.max(this.rttMax ?? 0, rtt);
   }

   // Silence ends a pairing, and so does a peer that stays unmatched; a change of role is announced once; so is each
   // time the pairing becomes mutual. A peer back from silence must say hello again before it counts.
   check() {
      const now = this.now();
      if (this.wasLive && !this.live) { this.wasLive = false; this.known.said = null; this.emit('release', 'silent'); }
      const said = this.known?.said;
      const mutual = this.live && !!said && said.id === this.idOf() && said.epoch === this.epoch;
      const became = mutual && !this.mutual;
      if (mutual !== this.mutual) { this.mutual = mutual; if (!mutual) this.since = now; }
      if (this.known && this.live && !this.mutual && now - this.since >= UNMATCHED_MS) this.drop('unmatched');
      const role = this.role;
      if (role !== this.lastRole) { this.lastRole = role; this.emit('role', role); }
      if (became && this.mutual) this.emit('pair', this.peer);
   }
}
