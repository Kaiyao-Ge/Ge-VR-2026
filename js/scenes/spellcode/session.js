// Uses the classroom message queue. Messages are namespaced by room;
// only the gunner simulates the battle. Solo mode never creates a session.
export class Session {
   constructor(game, { room, role, id, clients, send, connected = () => true }) {
      this.game = game;
      this.room = room;
      this.role = role;
      this.id = id;
      this.clients = clients;
      this.sendRaw = send;
      this.connected = connected;
      this.editorId = null;
      this.hostId = null;
      this.epoch = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
      this.hostEpoch = null;
      this.editorEpoch = null;
      this.occupied = false;
      this.occupiedAt = 0;
      this.nextHelloAt = 0;
      this.nextSnapshotAt = 0;
      this.lastSnapshot = 0;
      this.lastEditorMessage = 0;
      this.seq = 0;
      this.seen = 0;
      this.events = [];
      this.eventsAt = 0;
      this.paused = false;
   }
   send(type, payload = {}) {
      const from = this.id();
      if (from === undefined || from === null || !this.connected()) return;
      // server.send queues references until sync: freeze each outgoing snapshot.
      this.sendRaw(JSON.parse(JSON.stringify({ room: this.room, from, epoch: this.epoch,
         host: this.role === 'editor' && !this.waiting ? this.hostId : null,
         role: this.role, type, ...payload })));
   }
   get waiting() {
      if (!this.connected()) return true;
      if (this.role === 'shooter') return this.editorId === null || !this.clients().includes(this.editorId) ||
         Date.now() - this.lastEditorMessage > 3000;
      return this.hostId === null || !this.clients().includes(this.hostId) || Date.now() - this.lastSnapshot > 3000;
   }
   receive(message, sender) {
      if (!message || message.from !== sender || !this.clients().includes(sender) ||
          message.room !== this.room || message.from === this.id() || typeof message.epoch !== 'string') return;
      if (message.type === 'leave') {
         if (message.from === this.hostId && message.epoch === this.hostEpoch) {
            this.hostId = null; this.hostEpoch = null; this.events = []; this.occupied = false;
         }
         if (message.from === this.editorId && message.epoch === this.editorEpoch) {
            this.editorId = null; this.editorEpoch = null;
         }
         return;
      }
      if (this.role === 'shooter') {
         if (message.type === 'hello' && message.role === 'editor' &&
             (message.host === null || message.host === this.id())) {
            if (this.waiting || this.editorId === message.from) {
               this.editorId = message.from;
               this.editorEpoch = message.epoch;
               this.lastEditorMessage = Date.now();
            }
            this.publish();
         }
         if (message.type !== 'command' || message.from !== this.editorId || message.epoch !== this.editorEpoch ||
             message.host !== this.id() || message.hostEpoch !== this.epoch || message.role !== 'editor') return;
         this.lastEditorMessage = Date.now();
         if (message.command && typeof message.command === 'object') this.game.command(message.command, 'editor');
         this.publish();
      } else if (message.role === 'shooter' && message.type === 'snapshot' &&
                 (this.hostId === null || this.hostId === message.from ||
                  this.waiting || !this.clients().includes(this.hostId))) {
         if (!message.state || typeof message.state !== 'object') return;
         if (message.editorId !== this.id() || message.editorEpoch !== this.epoch) {
            if (this.hostId === message.from || this.waiting) {
               this.occupied = message.editorId !== null;
               this.occupiedAt = Date.now();
               this.hostId = null; this.hostEpoch = null; this.events = [];
            }
            return;
         }
         // The first snapshot establishes a baseline, not a replay of old sounds.
         if (this.hostId !== message.from || this.hostEpoch !== message.epoch) {
            this.seen = message.seq; this.events = [];
         }
         this.hostId = message.from;
         this.hostEpoch = message.epoch;
         this.occupied = false;
         this.lastSnapshot = Date.now();
         this.game.load(message.state);
         this.paused = !!message.paused;
         if (message.seq > this.seen) {
            if (Date.now() - this.eventsAt > 500) this.events = [];
            this.events.push(...(message.events || []));
            // Presentation effects must not grow indefinitely while rendering stops.
            this.events = this.events.slice(-128);
            this.eventsAt = Date.now();
            this.seen = message.seq;
         }
      }
   }
   command(command) {
      if (this.role === 'editor' && !this.waiting)
         this.send('command', { command, hostEpoch: this.hostEpoch });
   }
   publish(events = []) {
      if (this.role !== 'shooter') return;
      if (events.length) { this.events = events; this.seq++; }
      this.send('snapshot', { state: this.game.snapshot(), seq: this.seq, events: this.events,
         paused: this.paused, editorId: this.editorId, editorEpoch: this.editorEpoch });
      this.nextSnapshotAt = Date.now() + 100;
   }
   networkTick(paused = false) {
      const now = Date.now();
      if (this.occupied && now - this.occupiedAt > 3000) this.occupied = false;
      // Network deadlines use real time, like the disconnect timeout. The
      // simulation's capped dt would delay heartbeats on slow rendering clients.
      if (now >= this.nextHelloAt) {
         this.nextHelloAt = now + 1000;
         this.send('hello');
      }
      if (this.role !== 'shooter') return;
      const wasPaused = this.paused;
      this.paused = this.waiting || paused;
      if (this.paused !== wasPaused || now >= this.nextSnapshotAt) this.publish();
   }
   tick(dt, rays, paused = false, head) {
      this.networkTick(paused);
      if (this.role !== 'shooter') {
         const events = Date.now() - this.eventsAt <= 500 ? this.events : [];
         this.events = [];
         return events;
      }
      const events = this.paused ? this.game.takeEvents() : this.game.tick(dt, rays, head);
      if (events.length) this.publish(events);
      return events;
   }
}
