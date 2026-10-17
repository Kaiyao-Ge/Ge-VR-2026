// Run: node tests/spellcode-audio.test.cjs (no browser or dependencies required).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const url = source => 'data:text/javascript;base64,' + Buffer.from(source).toString('base64');
(async () => {
   const nodes = [], spatial = [];
   globalThis.audioTest = {
      audioContext: { state: 'running', resume: async () => {}, createBufferSource() {
         const node = { playbackRate: {}, connect() {}, disconnect() { this.disconnected = true; },
            start() { this.started = true; }, stop() { this.stopped = true; } };
         nodes.push(node); return node;
      } },
      resonance: { createSource() {
         const source = { input: {}, setPosition(...p) { this.position = p; }, setGain(g) { this.gain = g; } };
         spatial.push(source); return source;
      } },
      loadSound: async (name, setter) => setter({ name }),
   };
   const dependency = url('export const { audioContext, resonance, loadSound } = globalThis.audioTest;');
   const source = fs.readFileSync(path.join(__dirname, '../js/scenes/spellcode/audio.js'), 'utf8');
   const { GameAudio } = await import(url(source.replace("'../../util/positional-audio.js'", JSON.stringify(dependency))));
   const sound = new GameAudio(p => p.map((v, i) => v + (i === 0 ? 10 : 0)));
   sound.unlock(); await Promise.resolve();
   sound.event({ type: 'shot', origin: [-1, 1, -2], sound: true }, 'shooter');
   sound.event({ type: 'shot', origin: [1, 1, -2], sound: true }, 'shooter');
   sound.event({ type: 'shot', origin: [1, 1, -2], sound: false }, 'shooter');
   assert.equal(nodes.length, 2);
   assert.deepEqual(spatial[0].position, [9, 1, -2]);
   assert.deepEqual(spatial[1].position, [11, 1, -2]);
   sound.event({ type: 'compile', ok: true }, 'shooter', [0, 1, -1]);
   assert.equal(nodes.length, 2);
   sound.event({ type: 'compile', ok: false }, 'editor', [0, 1, -1]);
   assert.equal(nodes.length, 3);
   const game = { phase: 'playing', enemies: [] };
   const options = { silent: false, battlePaused: false };
   sound.event({ type: 'warn', position: [0, 3.2, -13.4] }, 'shooter');
   assert.deepEqual(spatial[3].position, [10, 3.2, -13.4]); // ROOT's telegraph comes from the eye.
   sound.update(game, { ...options, silent: true }, .2);
   assert.ok(nodes.every(n => n.stopped || n.disconnected));
   game.enemies = [{ distance: 2, position: [1, 1, -2] }];
   sound.update(game, options, 2);
   const count = nodes.length;
   sound.update(game, options, 2.1);
   assert.equal(nodes.length, count); // Warning is rate limited.
   for (let i = 0; i < 20; i++) sound.cue('shot', [0, 0, 0]);
   assert.ok(nodes.filter(n => !n.stopped && !n.disconnected).length <= 8);
   sound.cycleVolume(); sound.cycleVolume();
   assert.equal(sound.volume, 0);
   const muted = nodes.length;
   sound.cue('shot', [0, 0, 0]);
   assert.equal(nodes.length, muted);
   sound.dispose();
   sound.volume = 1; sound.cue('shot', [0, 0, 0]);
   assert.equal(nodes.length, muted);
   assert.ok(nodes.every(n => n.stopped && n.disconnected));
   console.log('ok - spatial voices, coordinate conversion, volley filtering, private cues, ROOT telegraph, warning, mute and cleanup');
   delete globalThis.audioTest;
})().catch(error => { console.error(error); process.exitCode = 1; });
