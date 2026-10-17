// Real classroom Server, ordered socket delivery, independently scheduled clients.
// Run: node tests/spellcode-network.test.cjs
const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
const path = require('node:path');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const load = require('./esm.cjs');
(async () => {
   const { Game } = await load('js/scenes/spellcode/game.js');
   const { Session } = await load('js/scenes/spellcode/session.js');
   const source = read('server/client.js');
   {
      const peers = [], packets = [];
      function connect(actual, role) {
         const c = { console, name: '', location: { protocol: 'http:', host: 'test' }, ArrayBuffer,
            WebSocket: class { constructor() { this.readyState = 1; }
               send(data) { packets.push({ actual, data }); } } };
         c.window = c; vm.createContext(c);
         vm.runInContext(source + '; Channel = function() { this.id = () => null; }; server = new Server(); server.neverLoadOrSave();', c);
         c.server.init('spellcode_TEAM42', {}, { accumulate: true });
         c.server.sync('spellcode_TEAM42', () => {});
         assert.equal(c.clientID, undefined); // No guessed identity before welcome.
         c.server.socket.onmessage({ data: JSON.stringify({ type: 'welcome', clientID: actual }) });
         const game = new Game();
         const session = new Session(game, { room: 'TEAM42', role, id: () => c.clientID,
            clients: () => c.clients, send: m => c.server.send('spellcode_TEAM42', m) });
         const p = { actual, c, session }; peers.push(p);
         for (const peer of peers) peer.c.server.socket.onmessage({ data: JSON.stringify({
            global: 'clients', value: peers.map(p => p.actual) }) });
         return p;
      }
      const coder = connect(0, 'editor'), gunner = connect(1, 'shooter');
      // Both have connected before either renders/synchronizes; gunner goes first.
      for (let i = 0; i < 8; i++) {
         for (const p of [gunner, coder]) {
            p.c.server.sync('spellcode_TEAM42', (msgs, sender) =>
               Object.values(msgs).forEach(m => p.session.receive(m, sender)));
            p.session.tick(1, {});
         }
         for (const packet of packets.splice(0)) for (const p of peers)
            if (p.actual !== packet.actual) p.c.server.socket.onmessage({ data: packet.data });
      }
      assert.equal(coder.c.clientID, 0); assert.equal(gunner.c.clientID, 1);
      assert.equal(coder.session.waiting, false); assert.equal(gunner.session.waiting, false);
      assert.equal(gunner.session.editorId, 0);
      console.log('ok - server identities survive delayed first sync; TEAM42 roles pair');
   }
   function network() {
      const peers = [], packets = [];
      function restart(p) {
         p.c.server.init(p.channel, {}, { accumulate: true });
         p.game = new Game(); p.active = true;
         p.session = new Session(p.game, { room: p.room, role: p.role, id: () => p.c.clientID,
            connected: () => p.c.server.socket.readyState === 1,
            clients: () => p.c.clients, send: m => p.c.server.send(p.channel, m) });
      }
      function peer(id, role, room = 'LAB') {
         const c = { console, name: '', location: { protocol: 'http:', host: 'test' },
            clientID: id, clients: [1, 2, 3, 4], ArrayBuffer,
            WebSocket: class { constructor() { this.readyState = 1; }
               send(packet) { packets.push({ id, packet }); } } };
         c.window = c; vm.createContext(c);
         vm.runInContext(source + '; server = new Server(); server.neverLoadOrSave();', c);
         const p = { c, role, room, channel: 'spellcode_' + room };
         restart(p); peers.push(p); return p;
      }
      function sync(p) {
         if (p.active) p.c.server.sync(p.channel, (msgs, sender) =>
            Object.values(msgs).forEach(m => p.session.receive(m, sender)));
      }
      function deliver() {
         for (const { id, packet } of packets.splice(0)) for (const p of peers)
            if (p.c.clientID !== id) p.c.server.socket.onmessage({ data: packet });
      }
      function pump() { for (let i = 0; i < 4; i++) { peers.forEach(sync); deliver(); } }
      const h = peer(1, 'shooter'), e = peer(2, 'editor');
      e.session.send('hello'); pump();
      assert.equal(e.session.waiting, false);
      return { h, e, peer, restart, sync, deliver, pump };
   }
   {
      const realNow = Date.now;
      let now = 100000;
      Date.now = () => now;
      try {
         const n = network(), { h, e } = n;
         h.game.startWave();
         let firstDistance;
         // 5 FPS: each 200 ms frame still supplies the capped 50 ms game dt.
         for (let i = 0; i < 80; i++) {
            now += 200;
            e.session.tick(.05, {}, true); // Coder's local pause cannot pause the host.
            n.sync(e); n.deliver(); n.sync(h);
            h.session.tick(.05, {});
            n.sync(h); n.deliver(); n.sync(e);
            assert.equal(h.session.waiting, false);
            assert.equal(e.session.waiting, false);
            assert.equal(h.session.paused, false);
            assert.equal(e.session.paused, false);
            // A hello response may publish just before the current simulation step.
            assert.ok(h.game.time - e.game.time <= .051);
            if (firstDistance === undefined && h.game.enemies.length)
               firstDistance = h.game.enemies[0].distance;
         }
         assert.ok(h.game.enemies[0].distance < firstDistance);
         // Heartbeats continue even when simulation dt is zero.
         for (let i = 0; i < 30; i++) {
            now += 200; e.session.tick(0, {}); n.sync(e); n.deliver(); n.sync(h);
            h.session.tick(0, {}, true); n.sync(h); n.deliver(); n.sync(e);
            assert.equal(h.session.waiting, false); assert.equal(e.session.waiting, false);
            assert.equal(e.session.paused, true); // Gunner pause still propagates.
         }
         // No render tick at all on the coder, including event consumption.
         for (let i = 0; i < 100; i++) {
            now += 100;
            n.sync(e); e.session.networkTick(true); n.sync(e); n.deliver(); n.sync(h);
            h.session.tick(.05, {}); n.sync(h); n.deliver(); n.sync(e);
            assert.equal(h.session.waiting, false);
            assert.equal(h.session.paused, false);
            assert.equal(e.session.waiting, false);
         }
         for (let i = 0; i < 200; i++) { h.session.publish([{ type: 'shot' }]); n.pump(); }
         assert.ok(e.session.events.length <= 128);
         now += 501;
         assert.deepEqual(e.session.tick(0, {}), []); // No stale audio burst on return.
         now += 3100; // A genuinely silent peer must still time out.
         h.session.tick(.05, {});
         assert.equal(h.session.waiting, true); assert.equal(h.session.paused, true);
         e.session.tick(.05, {}); n.sync(e); n.deliver(); n.sync(h);
         h.session.tick(.05, {});
         assert.equal(h.session.waiting, false); assert.equal(h.session.paused, false);
         console.log('ok - real-time heartbeat/snapshots at 5 FPS, zero dt, pause, timeout and recovery');
      } finally { Date.now = realNow; }
   }
   {
      const n = network(), { h, e } = n;
      h.c.clients = [1];
      e.c.clients = [2];
      assert.equal(h.session.waiting, true);
      assert.equal(e.session.waiting, true);
      e.c.clients = [1, 2]; e.c.server.socket.readyState = 3;
      assert.equal(e.session.waiting, true);
      e.session.networkTick();
      assert.equal(Object.keys(e.c.spellcode_LAB_updates).length, 0);
      console.log('ok - socket closure and membership removal invalidate pairing immediately');
   }
   {
      const n = network(), { h, e } = n;
      h.game.inventory.fire = 3; h.session.publish(); n.pump();
      for (let i = 0; i < 2; i++) {
         e.session.command({ kind: 'edit', operation: { kind: 'add', type: 'fire', parent: 0, index: 1 } });
         n.sync(e); n.deliver(); // Sender renders twice before receiver renders once.
      }
      n.sync(h); n.pump();
      assert.equal(h.game.draft.length, 3);
      assert.equal(h.game.inventory.fire, 1);
      n.pump(); assert.equal(h.game.draft.length, 3); // No replay.
      console.log('ok - asymmetric frames retain both edits exactly once');
   }
   {
      const n = network(), { h, e } = n;
      h.game.prepare({ need: ['chain'] }); h.session.publish(); n.pump();
      h.game.startWave(); h.game.root.budget = 10; h.game.startAttack({ type: 'GUN_LOCK', hand: 'right' }, '');
      for (let i = 0; i < 61; i++) h.game.tick(.05, {}); // First lock of the run warns for 3 s.
      h.session.publish(); n.pump();
      const glyphs = e.game.active('GUN_LOCK').glyphs;
      for (const command of [{ kind: 'pick', type: 'chain' }, { kind: 'unlock', glyphs }, { kind: 'panel', open: true }]) {
         e.session.command(command); n.sync(e); n.deliver();
      }
      n.sync(h);
      assert.equal(h.game.inventory.chain, 1);
      assert.equal(h.game.active('GUN_LOCK').solved, 'coder');
      assert.equal(h.game.panel.open, true);
      console.log('ok - pick, unlock and panel commands retain order across receiver stall');
   }
   {
      const n = network(), { h, e } = n;
      h.session.publish([{ type: 'shot' }]); n.sync(h); n.deliver();
      h.session.publish([{ type: 'kill' }]); n.sync(h); n.deliver();
      n.sync(e);
      assert.deepEqual(e.session.tick(.01, {}).map(x => x.type), ['shot', 'kill']);
      n.pump(); assert.equal(e.session.tick(.01, {}).length, 0);
      n.restart(h); e.session.send('hello'); n.pump();
      assert.equal(e.session.hostEpoch, h.session.epoch);
      h.session.publish([{ type: 'kill' }]); n.pump();
      assert.deepEqual(e.session.tick(.01, {}).map(x => x.type), ['kill']);
      console.log('ok - event batches retained, deduplicated, and reset on same-ID scene re-entry');
   }
   {
      const n = network(), { h, e } = n;
      h.active = false; // Socket remains alive, but scene no longer processes messages.
      e.session.lastSnapshot = Date.now() - 4000;
      const replacement = n.peer(3, 'shooter');
      e.session.send('hello'); n.pump();
      assert.equal(replacement.session.editorId, 2);
      assert.equal(e.session.hostId, 3);
      assert.equal(e.session.waiting, false);
      console.log('ok - timeout permits replacement host while old socket stays connected');
   }
   {
      const n = network(), { h, e } = n;
      const extra = n.peer(3, 'editor'), other = n.peer(4, 'editor', 'OTHER');
      extra.session.send('hello'); other.session.send('hello'); n.pump();
      assert.equal(extra.session.waiting, true); assert.equal(extra.session.occupied, true);
      assert.equal(other.session.hostId, null);
      extra.session.command({ kind: 'edit', operation: { kind: 'delete', id: 1 } }); n.pump();
      assert.equal(h.game.draft.length, 1);
      e.session.send('leave'); n.sync(e); n.deliver(); e.active = false; n.pump();
      assert.equal(h.session.waiting, true);
      extra.session.send('hello'); n.pump();
      assert.equal(h.session.editorId, 3); assert.equal(extra.session.waiting, false);
      assert.equal(extra.session.occupied, false);
      console.log('ok - role occupancy, departure, reassignment and room isolation');
   }
   {
      const n = network(), { h, e } = n;
      const stale = { room: 'LAB', from: 2, epoch: e.session.epoch, host: 1, hostEpoch: h.session.epoch,
         role: 'editor', type: 'command', command: { kind: 'edit', operation: { kind: 'delete', id: 1 } } };
      n.restart(h); e.session.send('hello'); n.pump();
      h.session.receive(stale, 2);
      assert.equal(h.game.draft.length, 1);
      h.session.send('leave'); n.sync(h); n.deliver(); h.active = false; n.sync(e);
      assert.equal(e.session.waiting, true);
      console.log('ok - stale commands rejected and explicit host departure clears pairing');
   }
   {
      const n = network(), { e } = n;
      e.c.server.init('legacy', {});
      const receive = (global, value) => e.c.server.socket.onmessage({ data: JSON.stringify({ global, value }) });
      receive('__legacy_updates__1', { 0: 'old' });
      receive('__legacy_updates__1', { 1: 'new' });
      assert.equal(e.c.__legacy_updates__1[0], undefined);
      assert.equal(e.c.__legacy_updates__1[1], 'new');
      receive('ordinaryState', { old: true }); receive('ordinaryState', { newer: true });
      assert.equal(e.c.ordinaryState.old, undefined);
      console.log('ok - non-opt-in queues and ordinary state keep classroom replacement semantics');
   }
})().catch(e => { console.error(e); process.exitCode = 1; });
