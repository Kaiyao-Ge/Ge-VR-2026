import { BLOCKS, programLines } from './game.js';
const C = { bg: '#141b29', bar: '#202b3d', muted: '#9cb0ca', text: '#edf4ff',
   cyan: '#61e7df', purple: '#c9a2ff', gold: '#ffd184', red: '#ff7c86' };
export function makePanel(width, height) {
   const canvas = document.createElement('canvas');
   canvas.width = width; canvas.height = height;
   return { canvas, ctx: canvas.getContext('2d'), buttons: [] };
}
function box(p, x, y, w, h, color) { p.ctx.fillStyle = color; p.ctx.fillRect(x, y, w, h); }
function text(p, value, x, y, size = 25, color = C.text, mono = false) {
   p.ctx.font = `${mono ? '' : '500 '}${size}px ${mono ? 'monospace' : 'sans-serif'}`;
   p.ctx.textBaseline = 'middle'; p.ctx.fillStyle = color; p.ctx.fillText(value, x, y);
}
function button(p, id, label, x, y, w, h, hover, enabled = true) {
   box(p, x, y, w, h, !enabled ? '#273042' : hover === id ? '#2d7080' : '#224d60');
   text(p, label, x + 14, y + h / 2, 22, enabled ? C.cyan : C.muted);
   if (enabled) p.buttons.push({ id, x, y, w, h });
}
export function buttonAt(panel, x, y) {
   return panel.buttons.find(b => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h)?.id;
}
export function pickButtonHit(hits, enemyDistance = Infinity) {
   return hits.filter(h => h?.id && h.distance >= 0 && h.distance < enemyDistance)
      .sort((a, b) => a.distance - b.distance)[0] || null;
}
export function drawIDE(p, game, ui) {
   const coder = ui.role === 'editor', lines = programLines(game.draft);
   p.buttons = [];
   box(p, 0, 0, 1024, 1024, C.bg);
   box(p, 0, 0, 1024, 64, C.bar);
   text(p, '</>', 25, 32, 30, C.cyan, true);
   text(p, coder ? 'SPELLCODE / LIVE EDITOR' : 'SPELLCODE / READ ONLY', 104, 32, 26);
   button(p, 'editor', 'X', 934, 8, 70, 48, ui.hover);
   text(p, coder ? 'LEFT RAY: collect drops   RIGHT RAY: select code' :
      'Gun program preview - no edit controls', 30, 101, 26, C.cyan);
   const selected = ui.selectedSlot || { parent: 0, index: game.draft.length };
   text(p, coder ? 'Choose a + slot, then add a block. Select a line to move or delete.' :
      'Your teammate changes the gun; the next trigger run uses the update.', 30, 146, 22, C.muted);
   box(p, 22, 178, 980, 590, '#192738');
   const start = Math.max(0, Math.min(ui.scroll || 0, Math.max(0, lines.length - 16)));
   for (let n = start; n < Math.min(lines.length, start + 16); n++) {
      const line = lines[n], y = 205 + (n - start) * 34;
      const x = 45 + Math.min(line.depth, 8) * 34;
      if (line.slot) {
         const active = line.slot.parent === selected.parent && line.slot.index === selected.index;
         box(p, x, y - 14, 900 - x, 28, active ? '#225b60' : '#243447');
         text(p, active ? '+ INSERT HERE' : '+', x + 10, y, 22, active ? C.cyan : C.muted, true);
         if (coder) p.buttons.push({ id: `slot:${line.slot.parent}:${line.slot.index}`, x, y: y - 16, w: 920 - x, h: 31 });
      } else {
         if (line.id === ui.selectedNode) box(p, x, y - 14, 900 - x, 28, '#38475f');
         text(p, line.text, x + 12, y, 24,
            line.type === 'fire' ? C.gold : line.type ? C.purple : C.text, true);
         if (coder && line.id) p.buttons.push({ id: 'node:' + line.id, x, y: y - 16, w: 920 - x, h: 31 });
      }
   }
   button(p, 'scroll:-1', 'UP', 816, 108, 88, 43, ui.hover, coder && start > 0);
   button(p, 'scroll:1', 'DOWN', 910, 108, 100, 43, ui.hover, coder && start + 16 < lines.length);
   if (coder) {
      text(p, ui.moving ? 'Choose a + slot to move the selected block.' :
         game.error ? 'DRAFT: ' + game.error : 'COMPILED / NEXT TRIGGER USES THIS CODE', 30, 793, 21,
         game.error ? C.red : C.cyan);
      button(p, 'delete', 'DELETE', 30, 817, 160, 50, ui.hover, !!ui.selectedNode);
      button(p, 'move', ui.moving ? 'CANCEL MOVE' : 'MOVE TO +', 198, 817, 207, 50, ui.hover, !!ui.selectedNode);
      button(p, 'cycle', 'CHANGE xN', 413, 817, 190, 50, ui.hover, !!ui.selectedNode);
      text(p, 'COLLECTED BLOCKS', 30, 893, 23, C.gold);
      BLOCKS.forEach((block, i) => {
         const count = game.inventory[block.type] || 0, x = 30 + i * 195;
         button(p, 'add:' + block.type, `${block.name}  ×${count}`,
            x, 914, 185, 53, ui.hover, count > 0);
      });
   } else {
      text(p, 'GUNNER: both triggers fire. Your editor collects and programs.', 30, 847, 24, C.muted);
   }
   box(p, 0, 980, 1024, 44, '#126272');
   text(p, `BUILD v${game.revision}     SCORE ${game.score}`, 28, 1002, 23, '#fff', true);
}
export function drawHUD(p, game, ui) {
   p.buttons = [];
   box(p, 0, 0, 1024, 512, '#101a2b');
   box(p, 0, 0, 1024, 5, game.phase === 'lost' ? C.red : C.cyan);
   text(p, 'S P E L L C O D E', 40, 48, 28, C.cyan);
   if (ui.mode === 'select') {
      text(p, 'CHOOSE ROLE', 40, 134, 47);
      text(p, ui.room ? `ROOM ${ui.room} / Choose one role on each headset` :
         'LOCAL TEST / Open a room URL for two-player mode', 40, 211, 27, C.muted);
      button(p, 'role:shooter', 'GUNNER', 40, 290, 296, 82, ui.hover, !!ui.room);
      button(p, 'role:editor', 'CODER', 364, 290, 296, 82, ui.hover, !!ui.room);
      button(p, 'role:debug', 'SOLO DEBUG', 688, 290, 296, 82, ui.hover);
      text(p, 'DEBUG: switch roles, pause freely, build before shooting.', 40, 439, 26, C.cyan);
      return;
   }
   text(p, ui.mode === 'debug' ? `DEBUG ${ui.role === 'editor' ? 'CODER' : 'GUNNER'}` :
      ui.role === 'editor' ? 'CODER' : 'GUNNER', 780, 48, 23, C.gold);
   text(p, String(game.score).padStart(4, '0'), 40, 113, 52);
   text(p, 'SCORE', 205, 126, 22, C.muted);
   text(p, `WAVE ${game.wave || 1}/3   CORE ${game.hp}/5   ENERGY ${Math.floor(game.energy)}`, 388, 112, 27);
   box(p, 40, 163, 944, 2, '#31435b');
   const title = ui.waiting ? 'WAITING FOR TEAMMATE' : ui.paused ? 'PAUSED' :
      ({ ready: 'BUILD, THEN DEFEND THE CORE', playing: 'DEFEND THE CORE',
         upgrade: 'WAVE CLEARED / EDIT YOUR GUN', won: 'YOU WIN', lost: 'YOU LOSE' })[game.phase];
   text(p, title, 40, 214, 36, game.phase === 'lost' ? C.red : C.text);
   const subtitle = ui.waiting ? 'Both headsets must join the same room.'
      : ui.paused ? ui.pauseReason || 'Point at RESUME RUN when ready.'
      : game.phase === 'playing'
         ? `${game.remaining + game.enemies.length} bugs left / ${game.loot.length} code drops / gun v${game.revision}`
         : game.phase === 'won' ? `${game.kills} bugs removed. ${game.shots} bolts fired.`
         : game.phase === 'lost' ? 'Core breached. Try another build.'
         : ui.mode === 'debug' ? 'Debug blocks are ready. Switch to GUNNER to start.' :
            'Gunner shoots; coder collects drops and edits the shared program.';
   text(p, subtitle, 40, 272, 26, C.muted);
   const canStart = !ui.waiting && ui.role !== 'editor';
   const action = ui.paused ? 'RESUME RUN' : game.phase === 'ready' ? 'START RUN' : game.phase === 'upgrade' ? 'NEXT WAVE'
      : ['won', 'lost'].includes(game.phase) ? 'PLAY AGAIN' : 'VIEW CODE';
   button(p, 'action', action, 40, 326, 310, 76, ui.hover, canStart || game.phase === 'playing');
   button(p, 'editor', ui.editorOpen ? 'CLOSE CODE' : 'OPEN CODE', 660, 326, 324, 76, ui.hover);
   if (ui.mode === 'debug') {
      button(p, 'role:shooter', 'GUNNER', 40, 418, 225, 56, ui.hover);
      button(p, 'role:editor', 'CODER', 277, 418, 225, 56, ui.hover);
      button(p, 'pause', ui.paused ? 'RESUME' : 'PAUSE', 514, 418, 225, 56, ui.hover,
         game.phase === 'playing');
      button(p, 'collect', 'COLLECT DROPS', 751, 418, 233, 56, ui.hover,
         ui.role === 'editor' && game.loot.length > 0);
      text(p, 'Role switch pauses the battle. Desktop: 1 / 2 / P.', 40, 498, 22, C.muted);
   } else {
      text(p, ui.role === 'editor' ? 'LEFT TRIGGER: collect drops   RIGHT TRIGGER: edit' :
         'BOTH TRIGGERS: fire   LEFT GRIP: inspect gun', 40, 449, 25);
      text(p, ui.role === 'shooter' ? 'Code panel is private and read-only.' :
         'LEFT GRIP: open / close code workspace', 40, 483, 23, C.muted);
   }
}
