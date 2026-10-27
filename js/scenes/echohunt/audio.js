// What the players hear: synthesized sounds placed in the room with the
// framework's Resonance scene (the listener follows the headset), and the
// microphone, read by an analyser.
import { audioContext, resonance } from '../../util/positional-audio.js';

const RATE = audioContext.sampleRate;
function buffer(seconds, f) {
   const b = audioContext.createBuffer(1, Math.ceil(seconds * RATE), RATE), d = b.getChannelData(0);
   for (let i = 0; i < d.length; i++) d[i] = f(i / RATE);
   return b;
}
const tone = (t, hz) => Math.sin(2 * Math.PI * hz * t);
let seed = 1;
const noise = () => (seed = seed * 16807 % 2147483647) / 1073741823.5 - 1;

// A tongue click: low is a hollow tok, high a sharp tick.
const clicks = Array.from({ length: 9 }, (_, i) => {
   const hz = 500 * 2 ** (i * 3.3 / 8), len = .07 - i * .005;
   return buffer(len, t => (tone(t, hz) * Math.exp(-t / (len / 4)) + (t < .002 ? noise() : 0)) * .9);
});
let lp = 0;
const SOUNDS = {
   // A moth against a wall: a soft papery tap.
   tap: buffer(.05, t => (lp += (noise() - lp) * .25) * Math.exp(-t / .012) * 2.2),
   // Caught: two bright notes.
   catch: buffer(.35, t => (tone(t, 1320) + (t > .08 ? tone(t, 1760) : 0)) * .3 * Math.exp(-t / .12)),
   // The clock's bell: inharmonic partials, the low ones ringing longest.
   bell: buffer(3, t => [[1, 1, 1.4], [2, .5, .9], [2.76, .4, .6], [5.4, .2, .3]]
      .reduce((s, [k, a, d]) => s + a * tone(t, 220 * k) * Math.exp(-t / d), 0) * .35),
   ding: buffer(.8, t => tone(t, 880) * Math.exp(-t / .2) * .4),
};
export const clickSound = pitch => clicks[Math.round(pitch * 8)];
// One pool of Resonance sources for every visit to the scene.
const voices = [];

export class Audio {
   // toHeadset: world point to the headset's reference space, where the listener is.
   constructor(toHeadset) {
      this.toHeadset = toHeadset;
      if (resonance && !voices.length) for (let i = 0; i < 12; i++) voices.push({ spatial: resonance.createSource(), node: null });
      this.voices = voices;
      this.cursor = 0;
      this.mic = null;
   }
   unlock() { audioContext.resume().catch(() => {}); }
   get state() { return audioContext.state; }
   play(name, pos, gain = 1) {
      const buf = typeof name === 'string' ? SOUNDS[name] : name;
      if (!this.voices.length || audioContext.state !== 'running') return;
      const voice = this.voices[this.cursor++ % this.voices.length];
      voice.node?.stop();
      const node = audioContext.createBufferSource();
      node.buffer = buf;
      voice.spatial.setPosition(...this.toHeadset(pos));
      voice.spatial.setGain(gain);
      node.connect(voice.spatial.input);
      node.onended = () => { node.disconnect(); if (voice.node === node) voice.node = null; };
      voice.node = node;
      node.start();
   }
   // The microphone, with echo cancellation so the game's own sounds do not light the room.
   async startMic() {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: false, autoGainControl: false } });
      const an = audioContext.createAnalyser();
      an.fftSize = 2048; an.smoothingTimeConstant = 0;
      audioContext.createMediaStreamSource(stream).connect(an);
      this.mic = { an, stream, state: { time: new Float32Array(2048), freq: new Float32Array(1024), slow: 0 } };
   }
   dispose() {
      for (const v of this.voices) v.node?.stop();
      this.mic?.stream.getTracks().forEach(t => t.stop());
   }
}
