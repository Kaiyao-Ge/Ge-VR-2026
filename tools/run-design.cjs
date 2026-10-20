// Runs AI design sessions without a browser, through the running game server,
// and saves each session's log as JSON.
// Run: node tools/run-design.cjs <preset 1-4 | "prompt"> [runs] [out dir] [model]
const fs = require('node:fs');
const path = require('node:path');
const load = require('../tests/esm.cjs');

globalThis.window = { clay: { formMesh: () => false, definePathsMesh() {} } };
const noSTL = { '../../render/core/stl.js': 'data:text/javascript,export const stl = () => {};' };

(async () => {
   const [which = '1', runs = '1', out = 'doc/ai-logs', model] = process.argv.slice(2);
   const { PRESETS, designSession } = await load('js/scenes/construction/ai.js', noSTL);
   const prompt = PRESETS[+which - 1] ?? which;
   fs.mkdirSync(out, { recursive: true });
   for (let r = 0; r < +runs; r++) {
      console.log(`\n=== ${prompt} (run ${r + 1})`);
      const { log } = await designSession(prompt, {
         endpoint: 'http://localhost:2026/api/aiquery', model,
         onEvent: e => {
            if (e.type === 'turn') console.log(`turn ${e.turn}: ${(e.ms / 1000).toFixed(1)} s ${e.text.slice(0, 120).replace(/\n/g, ' ')}`);
            if (e.type === 'tool') console.log(`  ${e.name}: ${e.result.split('\n').slice(0, 4).join(' | ').slice(0, 300)}`);
            if (e.type === 'end') console.log(`=> ${e.ok ? 'ACCEPTED' : 'NOT FINISHED'} (${e.reason})`);
         },
      });
      const file = path.join(out, `${new Date().toISOString().replace(/[:.]/g, '-')}-p${which}.json`);
      fs.writeFileSync(file, JSON.stringify(log, null, 1));
      console.log(`${log.turns.length} turns, ${log.calls} tool calls, ${(log.ms / 1000).toFixed(0)} s -> ${file}`);
   }
})();
