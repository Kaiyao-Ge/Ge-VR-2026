// The session protocol of Doorways: pairs two clients, assigns the roles,
// shares the round seed, carries each side's snapshots and notices a partner
// gone silent. It is pure: the transport (id, clients, send, now) is injected,
// so it runs the same over the classroom message queue and over a fake one in
// Node. Each client owns one part of the state and broadcasts it whole, so a
// lost message does no harm. Also here: the pose interpolation that draws the
// partner's moving things a little behind, so that 20 Hz looks smooth.

const HELLO_MS = 500;       // presence: 2 Hz
const SNAPSHOT_MS = 50;     // state: 20 Hz
const SILENT_MS = 3000;     // a peer not heard for this long is gone for now
const DELAY_MS = 100;       // interpolated poses lie this far behind the clock
const KEEP = 12;            // samples an Interp holds: well over DELAY_MS at 20 Hz

const isObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const isNum = v => typeof v === 'number' && Number.isFinite(v);
const isRound = v => Number.isInteger(v) && v >= 0;
const isSeed = v => v === null || isNum(v) || typeof v === 'string';
const isId = v => v === null || isNum(v);
const isTable = v => v === null || (Array.isArray(v) && v.length === 16 && v.every(isNum));
const WANTS = ['giant', 'mini'], ROLES = ['solo', 'giant', 'mini'];
const copy = m => JSON.parse(JSON.stringify(m));   // the queue keeps references until sync

// The fields each message type must have, checked before anything is trusted.
const valid = {
   hello: m => isRound(m.round) && isSeed(m.seed) && isId(m.giant) && WANTS.includes(m.want) &&
               ROLES.includes(m.role) && isTable(m.table) && typeof m.xr === 'boolean',
   round: m => isRound(m.round) && isSeed(m.seed) && isId(m.giant),
   giant: m => isNum(m.seq) && isRound(m.round),
   mini: m => isNum(m.seq) && isRound(m.round),
};

// The next time for a periodic send: one interval after the last due time, not after the frame that noticed it, so that
// frames of 13.9 ms do not stretch 50 ms to 55.6 ms. A page that fell more than an interval behind (a pause, the first
// call) starts afresh one interval from now instead of sending a burst to catch up.
const schedule = (due, interval, now) => {
   const next = due + interval;
   return next < now - interval || !Number.isFinite(next) ? now + interval : next;
};

const newEpoch = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;

export class Session {
   constructor({ id, clients, send, now }) {
      this.id = id;
      this.clients = clients;
      this.sendRaw = send;
      this.now = now;
      // A new epoch per instance tells the partner that a reload is not the same session.
      this.epoch = newEpoch();
      this.seq = 0;
      this.round = 0;
      this.seed = null;
      this.giant = null;               // the client id that is the giant in the current round
      this.known = null;               // what the last accepted hello said of the peer, and when it was last heard
      this.latest = { giant: null, mini: null };
      this.want = 'giant';
      this.table = null;
      this.xr = false;
      this.nextHelloAt = -Infinity;
      this.nextSnapshotAt = -Infinity;
   }

   // A peer heard within 3 s; later it is silent, and we are alone again.
   get live() { return !!this.known && this.now() - this.known.heard < SILENT_MS; }
   get waiting() { return !!this.known && !this.live; }

   // { id, role, xr, table, epoch, heard, want, round } or null. Its role is worked out from ours
   // rather than quoted from its last hello, which a new round makes stale for up to half a second.
   get peer() {
      if (!this.known) return null;
      const role = this.live ? (this.role === 'giant' ? 'mini' : 'giant') : this.known.role;
      return { ...this.known, role };
   }

   // With a round, its giant decides; before any, the wants do, and on a clash the higher id yields.
   get role() {
      if (!this.live) return 'solo';
      if (this.round > 0) return this.id() === this.giant ? 'giant' : 'mini';
      const mine = this.want, theirs = this.known.want;
      if (mine !== theirs) return mine;
      return this.id() > this.known.id ? (mine === 'giant' ? 'mini' : 'giant') : mine;
   }

   send(message) {
      const from = this.id();
      if (from === undefined || from === null) return;
      this.sendRaw(copy({ ...message, from, epoch: this.epoch }));
   }

   // Take the peer's round if it is newer, or equal with a higher sender id, so that
   // two rounds started at once settle on one without asking anybody.
   adopt(round, seed, giant, sender) {
      if (round === 0) return;
      if (round > this.round || (round === this.round && sender > this.id())) {
         // Snapshots of a round that is over must not outlive it; a hello that repeats the round we have changes nothing.
         if (round !== this.round || seed !== this.seed || giant !== this.giant) this.latest = { giant: null, mini: null };
         this.round = round; this.seed = seed; this.giant = giant;
      }
   }

   // The peer is the first other client whose hello arrives while there is no live peer.
   // A hello from the peer's own id with a new epoch is a reload of it.
   acceptHello(m, sender) {
      const p = this.known;
      if (p && p.id === sender && p.epoch === m.epoch) return true;
      if (p && p.id === sender) { this.latest = { giant: null, mini: null }; return true; }   // reload
      if (this.live) return false;
      if (p) this.latest = { giant: null, mini: null };   // a different partner: the old one's state is not theirs
      return true;
   }

   receive(message, sender) {
      if (!isObject(message) || !Object.hasOwn(valid, message.type) || typeof message.epoch !== 'string') return;
      if (message.from !== sender || sender === this.id() || !this.clients().includes(sender)) return;
      if (!valid[message.type](message)) return;
      if (message.type === 'hello') this.receiveHello(message, sender);
      else if (this.known && this.known.id === sender && this.known.epoch === message.epoch) this.receiveFrom(message, sender);
   }

   receiveHello(m, sender) {
      if (!this.acceptHello(m, sender)) return;
      this.known = { id: sender, role: m.role, xr: m.xr, table: m.table, epoch: m.epoch, want: m.want,
                    round: m.round, heard: this.now() };
      this.adopt(m.round, m.seed, m.giant, sender);
   }

   receiveFrom(m, sender) {
      this.known.heard = this.now();
      if (m.type === 'round') {
         this.known.round = m.round;
         this.adopt(m.round, m.seed, m.giant, sender);
      } else if (m.round === this.round && (!this.latest[m.type] || m.seq > this.latest[m.type].seq)) {
         // A snapshot of another round is dropped: an older one is stale, a newer one waits for its round to arrive.
         this.latest[m.type] = m;
      }
   }

   // Start a round: one number above anything either side has seen, so it wins everywhere.
   newRound(seed, giantId) {
      this.round = Math.max(this.round, this.known ? this.known.round : 0) + 1;
      this.seed = seed;
      this.giant = giantId;
      this.latest = { giant: null, mini: null };
      this.send({ type: 'round', round: this.round, seed, giant: giantId });
   }

   // Called every frame: presence at 2 Hz, and the snapshot of the role we play at 20 Hz.
   tick({ want, table, xr, giant, mini }) {
      const now = this.now();
      this.want = WANTS.includes(want) ? want : this.want;
      this.table = table ?? null;
      this.xr = !!xr;
      if (now >= this.nextHelloAt) {
         this.nextHelloAt = schedule(this.nextHelloAt, HELLO_MS, now);
         this.send({ type: 'hello', round: this.round, seed: this.seed, giant: this.giant, want: this.want,
                     role: this.role, table: this.table, xr: this.xr });
      }
      if (now < this.nextSnapshotAt) return;
      this.nextSnapshotAt = schedule(this.nextSnapshotAt, SNAPSHOT_MS, now);
      const role = this.role;
      if (role === 'solo') return;
      const snapshot = (role === 'giant' ? giant : mini)();
      // The payload goes first so that it cannot overwrite the protocol's own fields.
      this.send({ ...snapshot, type: role, seq: ++this.seq, round: this.round });
   }
}

// Element-wise blend of two column-major 4x4 poses, then columns 0-2 made
// orthonormal again so that a blend of two rotations stays a rotation; the
// translation, column 3, is the plain blend. Column 0 is normalised, column 1
// is made orthogonal to it, and column 2 is their cross product with the
// handedness of the start pose, so the basis is a proper rotation whatever happens.
const dot = (p, q) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2];
const cross = (p, q) => [p[1] * q[2] - p[2] * q[1], p[2] * q[0] - p[0] * q[2], p[0] * q[1] - p[1] * q[0]];
const unit = v => { const l = Math.hypot(v[0], v[1], v[2]); return l > 1e-9 ? v.map(x => x / l) : null; };
const without = (v, u) => { const d = dot(v, u); return [v[0] - d * u[0], v[1] - d * u[1], v[2] - d * u[2]]; };

export function lerpPose(a, b, f) {
   const m = a.map((v, i) => v + (b[i] - v) * f);
   const colA = k => a.slice(k * 4, k * 4 + 3), colM = k => m.slice(k * 4, k * 4 + 3);
   // Opposite rotations blend to nothing in a column: fall back to the start's, never divide by zero.
   const x = unit(colM(0)) || unit(colA(0)) || [1, 0, 0];
   const y = unit(without(colM(1), x)) || unit(without(colA(1), x)) ||
             unit(without(Math.abs(x[0]) < .9 ? [1, 0, 0] : [0, 1, 0], x));
   const hand = dot(colA(2), cross(colA(0), colA(1))) < 0 ? -1 : 1;
   const z = cross(x, y).map(v => v * hand);
   [x, y, z].forEach((u, k) => { for (let i = 0; i < 3; i++) m[k * 4 + i] = u[i]; });
   return m;
}

// Buffers timestamped poses and answers for a moment 100 ms before the clock,
// between the two samples around it, so arrival jitter does not show.
export class Interp {
   constructor() { this.samples = []; }
   push(t, m) {
      const last = this.samples[this.samples.length - 1];
      if (last && t <= last.t) return;   // out of order: the newer sample already covers it
      this.samples.push({ t, m: m.slice() });
      if (this.samples.length > KEEP) this.samples.shift();
   }
   at(t) {
      const s = this.samples;
      if (!s.length) return null;
      const target = t - DELAY_MS;
      if (target <= s[0].t) return s[0].m.slice();
      for (let i = 1; i < s.length; i++) {
         if (target <= s[i].t) return lerpPose(s[i - 1].m, s[i].m, (target - s[i - 1].t) / (s[i].t - s[i - 1].t));
      }
      return s[s.length - 1].m.slice();
   }
}
