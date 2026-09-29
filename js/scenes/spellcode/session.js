// Uses the project's existing WebSocket relay. Messages are namespaced by room;
// only the gunner simulates the battle. Solo mode never creates a session.
export class Session {
   constructor(game, { room, role, id, clients, send }) {
      this.game = game;
      this.room = room;
      this.role = role;
      this.id = id;
      this.clients = clients;
      this.sendRaw = send;
      this.editorId = null;
      this.hostId = null;
      this.elapsed = 0;
      this.snapshotIn = 0;
      this.lastSnapshot = 0;
      this.seq = 0;
      this.seen = 0;
      this.events = [];
   }
   send(type, payload = {}) {
      const from = this.id();
      if (from === undefined || from === null) return;
      this.sendRaw({ room: this.room, from, role: this.role, type, ...payload });
   }
   get waiting() {
      if (this.role === 'shooter') return this.editorId === null || !this.clients().includes(this.editorId);
      return this.hostId === null || Date.now() - this.lastSnapshot > 3000;
   }
   receive(message) {
      if (!message || message.room !== this.room || message.from === this.id()) return;
      if (this.role === 'shooter') {
         if (message.type === 'hello' && message.role === 'editor' &&
             (this.editorId === null || !this.clients().includes(this.editorId))) {
            this.editorId = message.from;
            this.publish();
         }
         if (message.type !== 'command' || message.from !== this.editorId || message.role !== 'editor') return;
         const cmd = message.command || {};
         if (cmd.kind === 'pickup') this.game.pickup(cmd.id, cmd.ray, 'editor');
         if (cmd.kind === 'edit') this.game.edit(cmd.operation, 'editor');
         this.publish();
      } else if (message.role === 'shooter' && message.type === 'snapshot' &&
                 (this.hostId === null || this.hostId === message.from ||
                  !this.clients().includes(this.hostId))) {
         this.hostId = message.from;
         this.lastSnapshot = Date.now();
         this.game.load(message.state);
         if (message.seq > this.seen) {
            this.events = message.events || [];
            this.seen = message.seq;
         }
      }
   }
   command(command) { if (this.role === 'editor' && !this.waiting) this.send('command', { command }); }
   publish(events = []) {
      if (this.role !== 'shooter') return;
      if (events.length) { this.events = events; this.seq++; }
      this.send('snapshot', { state: this.game.snapshot(), seq: this.seq, events: this.events });
   }
   tick(dt, rays, paused = false) {
      this.elapsed += dt;
      this.snapshotIn -= dt;
      if (this.elapsed >= 1) { this.elapsed = 0; this.send('hello'); }
      if (this.role !== 'shooter') {
         const events = this.events;
         this.events = [];
         return events;
      }
      const events = this.waiting || paused ? [] : this.game.tick(dt, rays);
      if (events.length || this.snapshotIn <= 0) {
         this.publish(events);
         this.snapshotIn = .1;
      }
      return events;
   }
}
