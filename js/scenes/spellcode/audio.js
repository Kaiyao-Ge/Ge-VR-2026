// Same AudioContext, Resonance scene and mono samples as the classroom construct demo.
import { audioContext, resonance, loadSound } from '../../util/positional-audio.js';

const buffers = {}, voices = [];
let loading;
const cues = {
   shot: ['create', .22, 1.8], kill: ['delete', .45, 1],
   collect: ['create', .5, 1.3], compile: ['create', .28, 1.6],
   error: ['delete', .25, .7], warning: ['delete', .25, 1.5],
   damage: ['delete', .65, .65], lost: ['delete', .7, .5],
   won: ['create', .65, .8], upgrade: ['create', .45, 1.1],
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
      if (!voices.length) for (let i = 0; i < 9; i++)
         voices.push({ spatial: resonance.createSource(), node: null });
      loading ||= Promise.all(['Create_Mono_01', 'Delete_Mono_01', 'Drag_Mono_LP_01'].map((name, i) =>
         loadSound('/media/sound/SFXs/demoBalls/SFX_Ball_' + name + '.wav',
            buffer => { buffers[['create', 'delete', 'drag'][i]] = buffer; })));
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
   start(index, buffer, position, gain, rate = 1, loop = false) {
      if (this.disposed || !this.enabled || !this.volume || !buffer || audioContext.state !== 'running' || !resonance) return;
      const voice = voices[index];
      this.stopVoice(voice);
      const node = audioContext.createBufferSource();
      node.buffer = buffer; node.loop = loop; node.playbackRate.value = rate;
      voice.spatial.setPosition(...this.toHeadsetPosition(position));
      voice.spatial.setGain(gain * this.volume);
      node.connect(voice.spatial.input);
      voice.node = node;
      node.onended = () => { node.disconnect(); if (voice.node === node) voice.node = null; };
      node.start();
   }
   cue(type, position) {
      const cue = cues[type];
      if (cue) this.start(this.cursor++ % 8, buffers[cue[0]], position, cue[1], cue[2]);
   }
   event(event, role, panelPosition) {
      if (event.type === 'shot') {
         if (event.sound !== false) this.cue('shot', event.origin);
      } else if (event.type === 'compile') {
         if (role === 'editor') this.cue(event.ok ? 'compile' : 'error', panelPosition);
      } else this.cue(event.type, event.position || [0, .2, 0]);
   }
   update(game, { silent, battlePaused, allowDrag }, now) {
      if (silent) { this.stop(); return; }
      if (battlePaused && !this.wasPaused) this.stop();
      this.wasPaused = battlePaused;
      const held = allowDrag && game.loot.find(item => item.held);
      if (!held) this.stopVoice(voices[8]);
      else if (voices[8]?.node) voices[8].spatial.setPosition(...this.toHeadsetPosition(held.position));
      else this.start(8, buffers.drag, held.position, .16, 1, true);
      if (battlePaused || game.phase !== 'playing' || now < this.warningAt) return;
      const nearest = game.enemies.reduce((best, e) => !best || e.distance < best.distance ? e : best, null);
      if (nearest?.distance < 2.5) {
         this.cue('warning', nearest.position);
         this.warningAt = now + 1.2;
      }
   }
   dispose() { this.stop(); this.disposed = true; }
}
