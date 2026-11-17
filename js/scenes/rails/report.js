// The line that Rails sends to the server log every 5 s from each role (the field names are those of doc/hw9-design.md, section 4),
// pure so that it can be tested without a browser. reportOf copies the logged fields and nothing else: strings are cut
// to 200 characters, numbers must be finite, lists are short, and anything the scene passes in beyond the fields (such as
// what was typed) is dropped, so that no key text can reach the log by accident.
import { isObject } from './values.js';

const MAX_STRING = 200, MAX_ROWS = 32;

const str = v => typeof v === 'string' ? v.slice(0, MAX_STRING) : null;
const num = v => typeof v === 'number' && Number.isFinite(v) ? v : null;
const count = v => num(v) ?? 0;
const bool = v => v === true;
const flag = v => typeof v === 'boolean' ? v : null;
const rows = (list, ...cells) => (Array.isArray(list) ? list : []).filter(Array.isArray).slice(0, MAX_ROWS)
   .map(row => cells.map((cell, i) => cell(row[i])));

export function reportOf(s) {
   const r = isObject(s) ? s : {};
   const peer = isObject(r.peer) ? r.peer : {}, input = isObject(r.input) ? r.input : {}, rtt = isObject(r.rtt) ? r.rtt : {};
   const rec = isObject(r.rec) ? r.rec : {}, saves = isObject(r.saves) ? r.saves : {}, worker = isObject(r.worker) ? r.worker : {};
   const perf = isObject(r.perf) ? r.perf : {};
   return {
      v: num(r.v) ?? 1, ev: str(r.ev), role: str(r.role), rank: num(r.rank), mutual: bool(r.mutual),
      peer: { live: bool(peer.live), heardMs: num(peer.heardMs) },
      input: { rx: count(input.rx), gaps: count(input.gaps), dups: count(input.dups) },
      rtt: { p50: num(rtt.p50), max: num(rtt.max) },
      focus: str(r.focus),
      cards: rows(r.cards, str, str, flag),
      rails: rows(r.rails, str, str, num, num, num),
      rec: { paused: bool(rec.paused), span: num(rec.span) },
      saves: { ok: count(saves.ok), fail: count(saves.fail) },
      worker: { restarts: count(worker.restarts) },
      fps: num(r.fps), errors: count(r.errors), lastError: str(r.lastError),
      // Where the frame time went (ms a frame on average: the whole frame, the server queue and link, the IDE; the worst
      // frame), snapshots a second and the JS heap in MB, so that a falling frame rate can be told apart: this code or the GPU.
      perf: { xr: bool(perf.xr), frameMs: num(perf.frameMs), netMs: num(perf.netMs), ideMs: num(perf.ideMs), worstMs: num(perf.worstMs),
              snaps: num(perf.snaps), heapMB: num(perf.heapMB) },
   };
}
