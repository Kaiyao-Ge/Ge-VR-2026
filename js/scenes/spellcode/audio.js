// Same AudioContext, Resonance scene and mono samples as the classroom construct demo.
import { audioContext, resonance, loadSound } from '../../util/positional-audio.js';

const buffers = {}, voices = [];
let loading;
// [sample, gain, playback rate]
const cues = {
   shot: ['create', .22, 1.8], kill: ['delete', .45, 1], compile: ['create', .28, 1.6],
   error: ['delete', .25, .7], warning: ['delete', .25, 1.5], damage: ['delete', .65, .65],
   lost: ['delete', .7, .5], won: ['create', .65, .8], upgrade: ['create', .45, 1.1],
   warn: ['delete', .55, .55], attack: ['create', .6, .45], resolved: ['create', .4, 1.4],
   eye: ['delete', .6, 1.9],
};

export class GameAudio {
   constructor(toHeadsetPosition) {
      this.toHeadsetPosition = toHeadsetPosition;
      this.volume = .5;
      this.enabled = false;
      this.disposed = false;
      this.warningAt = 0;
      this.cursor = 0;
      if (!resonance) return;
      if (!voices.length) for (let i = 0; i < 8; i++)
         voices.push({ spatial: resonance.createSource(), node: null });
      loading ||= Promise.all(['Create_Mono_01', 'Delete_Mono_01'].map((name, i) =>
         loadSound('/media/sound/SFXs/demoBalls/SFX_Ball_' + name + '.wav',
            buffer => { buffers[['create', 'delete'][i]] = buffer; })));
   }
   unlock() {
      if (this.disposed || !resonance) return;
      audioContext.resume().then(() => { if (!this.disposed) this.enabled = true; }).catch(() => {});
   }
   get label() {
      return !resonance ? 'NO AUDIO' : !this.volume ? 'SOUND OFF' :
         !this.enabled || audioContext.state !== 'running' ? 'ENABLE SOUND' : 'SOUND ' + Math.round(this.volume * 100) + '%';
   }
   cycleVolume() {
      this.volume = this.volume === .5 ? 1 : this.volume === 1 ? 0 : .5;
      this.stop();
      this.unlock();
   }
   stopVoice(voice) {
      if (!voice?.node) return;
      voice.node.onended = null;
      voice.node.stop(); voice.node.disconnect(); voice.node = null;
   }
   stop() { for (const voice of voices) this.stopVoice(voice); }
   start(index, buffer, position, gain, rate = 1) {
      if (this.disposed || !this.enabled || !this.volume || !buffer || audioContext.state !== 'running' || !resonance) return;
      const voice = voices[index];
      this.stopVoice(voice);
      const node = audioContext.createBufferSource();
      node.buffer = buffer; node.playbackRate.value = rate;
      voice.spatial.setPosition(...this.toHeadsetPosition(position));
      voice.spatial.setGain(gain * this.volume);
      node.connect(voice.spatial.input);
      voice.node = node;
      node.onended = () => { node.disconnect(); if (voice.node === node) voice.node = null; };
      node.start();
   }
   cue(type, position) {
      const cue = cues[type];
      if (cue) this.start(this.cursor++ % voices.length, buffers[cue[0]], position, cue[1], cue[2]);
   }
   event(event, role, panelPosition) {
      if (event.type === 'shot') {
         if (event.sound !== false) this.cue('shot', event.origin);
      } else if (event.type === 'compile') {
         if (role === 'editor') this.cue(event.ok ? 'compile' : 'error', panelPosition);
      } else this.cue(event.type, event.position || [0, .2, 0]);
   }
   update(game, { silent, battlePaused }, now) {
      if (silent || battlePaused && !this.wasPaused) this.stop();
      this.wasPaused = battlePaused;
      if (silent || battlePaused || game.phase !== 'playing' || now < this.warningAt) return;
      const nearest = game.enemies.reduce((best, e) => !e.special && (!best || e.distance < best.distance) ? e : best, null);
      if (nearest?.distance < 2.5) {
         this.cue('warning', nearest.position);
         this.warningAt = now + 1.2;
      }
   }
   dispose() { this.stop(); this.disposed = true; }
}
