import { ATTACKS, BLOCKS, GLYPHS, WAVES, allNodes, programLines } from './game.js';
import { daemonSource } from './daemons.js';
const C = { bg: '#0d1714', bar: '#16261f', muted: '#a5b8b0', text: '#edf4f1', green: '#7dff9e',
   cyan: '#83e9d9', purple: '#c5b5fa', gold: '#f8c777', red: '#ff8791' };
export function makePanel(width, height) {
   const canvas = document.createElement('canvas');
   canvas.width = width; canvas.height = height;
   return { canvas, ctx: canvas.getContext('2d'), buttons: [] };
}
function box(p, x, y, w, h, color) { p.ctx.fillStyle = color; p.ctx.fillRect(x, y, w, h); }
function text(p, value, x, y, size = 25, color = C.text, mono = false, width = 1000 - x) {
   p.ctx.font = `${mono ? '' : '500 '}${size}px ${mono ? 'monospace' : 'sans-serif'}`;
   p.ctx.textBaseline = 'middle'; p.ctx.fillStyle = color;
   let label = String(value);
   if (p.ctx.measureText(label).width > width) {
      while (label.length && p.ctx.measureText(label + '…').width > width) label = label.slice(0, -1);
      label += '…';
   }
   p.ctx.fillText(label, x, y);
}
function button(p, id, label, x, y, w, h, hover, enabled = true) {
   const active = enabled && hover === id;
   box(p, x, y, w, h, !enabled ? '#2a3530' : active ? C.cyan : '#476d5f');
   box(p, x + 1, y + 1, w - 2, h - 2, !enabled ? '#19242e' : active ? '#245057' : '#213a33');
   if (enabled) box(p, x, y + 10, 3, h - 20, active ? '#e7fffa' : C.cyan);
   text(p, label, x + 16, y + h / 2, 22, enabled ? C.text : C.muted, false, w - 28);
   if (enabled) p.buttons.push({ id, x, y, w, h });
}
export function buttonAt(panel, x, y) {
   return panel.buttons.find(b => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h)?.id;
}
export function pickButtonHit(hits, enemyDistance = Infinity) {
   return hits.filter(h => h?.id && h.distance >= 0 && h.distance < enemyDistance)
      .sort((a, b) => a.distance - b.distance)[0] || null;
}
const lock = game => game.attacks.find(a => a.type === 'GUN_LOCK' && a.warn <= 0);

export function drawIDE(p, game, ui) {
   const coder = ui.role === 'editor', lines = programLines(game.draft);
   const locked = game.attacks.some(a => a.type === 'PANEL_LOCK' && a.warn <= 0), edit = coder && !locked;
   p.buttons = [];
   box(p, 0, 0, 1024, 1024, C.bg);
   box(p, 0, 0, 4, 1024, '#386a52');
   box(p, 0, 0, 1024, 64, C.bar);
   text(p, '</>', 25, 32, 30, C.green, true);
   text(p, coder ? 'SPELLCODE / OPERATOR CONSOLE' : 'SPELLCODE / READ ONLY', 104, 32, 26);
   button(p, 'editor', 'X', 934, 8, 70, 48, ui.hover);
   const used = allNodes(game.draft).filter(n => !n.foreign).length;
   // The console can cover the tip board, so the coder's current task also shows here.
   const tip = coder && wallLines(game, false).find(line => !line.root);
   text(p, tip ? tip.text : ui.moving ? 'Choose a + slot to move the selected block.' : game.error ? 'DRAFT: ' + game.error :
      `LIVE v${game.revision}   SLOTS ${used}/${game.capacity}`, 30, 96, 22, tip ? C.gold : game.error ? C.red : C.cyan, false, 760);
   const start = Math.max(0, Math.min(ui.scroll || 0, Math.max(0, lines.length - 13)));
   button(p, 'scroll:-1', 'UP', 806, 74, 92, 44, ui.hover, coder && start > 0);
   button(p, 'scroll:1', 'DOWN', 906, 74, 100, 44, ui.hover, coder && start + 13 < lines.length);
   const selected = ui.selectedSlot || { parent: 0, index: game.draft.length };
   box(p, 22, 124, 980, 460, '#111e19');
   box(p, 22, 124, 48, 460, '#16271f');
   for (let n = start; n < Math.min(lines.length, start + 13); n++) {
      const line = lines[n], y = 148 + (n - start) * 34, x = 70 + Math.min(line.depth, 8) * 30;
      text(p, String(n + 1).padStart(2, '0'), 31, y, 18, C.muted, true, 36);
      for (let depth = 1; depth < line.depth; depth++) box(p, 76 + depth * 30, y - 16, 1, 33, '#30483e');
      if (line.slot) {
         const active = line.slot.parent === selected.parent && line.slot.index === selected.index;
         box(p, x, y - 14, 970 - x, 28, active ? '#254c3a' : '#1b2d26');
         text(p, active ? '+ INSERT HERE' : '+', x + 10, y, 22, active ? C.cyan : C.muted, true);
         if (edit) p.buttons.push({ id: `slot:${line.slot.parent}:${line.slot.index}`, x, y: y - 16, w: 970 - x, h: 31 });
      } else {
         if (line.id === ui.selectedNode) { box(p, x, y - 14, 970 - x, 28, '#34524a'); box(p, x, y - 14, 3, 28, C.gold); }
         text(p, line.text, x + 12, y, 24, line.type === 'fire' ? C.gold : line.type ? C.purple : C.text, true, 962 - x);
         if (edit && line.id) p.buttons.push({ id: 'node:' + line.id, x, y: y - 16, w: 970 - x, h: 31 });
      }
   }
   if (locked) {
      box(p, 22, 124, 980, 460, '#2a0d12');
      text(p, 'PANEL LOCKED', 300, 320, 52, C.red);
      text(p, 'GUNNER: SHOOT THE GOLD LOCK', 270, 390, 28, C.gold);
   }
   box(p, 22, 596, 980, 210, '#111e19');
   // Once ROOT has planned, the offers belong to the next daemon, so show its source.
   const gunLock = lock(game), script = game.nextScript || game.script;
   if (coder && gunLock) {
      text(p, `${gunLock.hand.toUpperCase()} GUN LOCKED / ENTER THE GLYPHS YOUR GUNNER READS`, 40, 622, 22, C.gold);
      text(p, (ui.glyphs || []).map(i => GLYPHS[i]).join(' ') || '_ _ _ _', 40, 664, 32, C.text, true);
      GLYPHS.forEach((glyph, i) => button(p, 'glyph:' + i, glyph, 40 + i * 190, 702, 176, 84, ui.hover));
      button(p, 'glyph:clear', 'CLEAR', 812, 702, 176, 84, ui.hover);
   } else if (coder && script?.daemon) {
      text(p, `INTERCEPTED SOURCE / ${script.daemon.name}`, 40, 618, 22, C.green);
      daemonSource(script.daemon).slice(0, 6).forEach((line, i) => text(p, line, 40, 646 + i * 24, 21, C.text, true, 940));
      if (game.offers.length) {
         text(p, 'PICK ONE', 40, 786, 20, C.gold);
         game.offers.forEach((type, i) => button(p, 'pick:' + type,
            BLOCKS.find(b => b.type === type).name.replace('()', ''), 160 + i * 280, 764, 268, 40, ui.hover));
      }
   } else {
      text(p, coder ? game.phase === 'upgrade' ? 'ROOT is analyzing you...' : 'No intercepted source yet.' :
         'GUNNER: both triggers fire. Edits apply on your next trigger press.', 40, 700, 23, C.muted);
   }
   if (coder) {
      button(p, 'delete', 'DELETE', 30, 816, 160, 50, ui.hover, edit && !!ui.selectedNode);
      button(p, 'move', ui.moving ? 'CANCEL MOVE' : 'MOVE TO +', 198, 816, 207, 50, ui.hover, edit && !!ui.selectedNode);
      button(p, 'cycle', 'CHANGE xN', 413, 816, 190, 50, ui.hover, edit && !!ui.selectedNode);
      BLOCKS.forEach((block, i) => {
         const count = game.inventory[block.type] || 0;
         button(p, 'add:' + block.type, `${block.name.replace('()', '')} ×${count}`,
            30 + (i % 4) * 243, 876 + Math.floor(i / 4) * 52, 233, 46, ui.hover, edit && count > 0 && used < game.capacity);
      });
   }
   box(p, 0, 980, 1024, 44, '#244d3c');
   text(p, `BUILD v${game.revision}     SCORE ${game.score}`, 28, 1002, 23, '#fff', true);
}

const uplink = game => game.phase === 'won' ? 1 : game.phase === 'playing'
   ? (game.wave - 1 + Math.min(1, game.waveTime / WAVES[game.wave - 1].duration)) / WAVES.length
   : game.wave / WAVES.length;
const debriefLines = game => {
   const d = game.debrief;
   if (!d) return [];
   const log = d.log.map(l => `${l.type} ${l.resolvedBy === 'timeout' ? 'expired' : 'by ' + l.resolvedBy} ${l.seconds}s`);
   return [...d.rationale.slice(0, 2), log.join('  /  ') || 'No countermeasures.'];
};

export function drawHUD(p, game, ui) {
   p.buttons = [];
   box(p, 0, 0, 1024, 512, C.bg);
   box(p, 0, 5, 1024, 64, C.bar);
   box(p, 0, 0, 1024, 5, game.phase === 'lost' ? C.red : C.green);
   text(p, 'S P E L L C O D E', 40, 48, 28, C.green);
   button(p, 'sound', ui.soundLabel || 'ENABLE SOUND', 522, 16, 234, 43, ui.hover);
   if (ui.mode === 'select') {
      text(p, 'CHOOSE ROLE', 40, 134, 47);
      text(p, ui.room ? `ROOM ${ui.room} / Choose one role on each headset` :
         'LOCAL TEST / Open a room URL for two-player mode', 40, 211, 27, C.muted);
      button(p, 'role:shooter', 'GUNNER', 40, 290, 296, 82, ui.hover, !!ui.room);
      button(p, 'role:editor', 'CODER', 364, 290, 296, 82, ui.hover, !!ui.room);
      button(p, 'role:debug', 'SOLO DEBUG', 688, 290, 296, 82, ui.hover);
      for (const [i, label] of ['01 / JACKED IN', '02 / OPERATOR', '03 / SANDBOX'].entries())
         text(p, label, 40 + i * 324, 268, 20, i === 1 ? C.purple : C.muted, true);
      text(p, 'Two guns, one uplink', 56, 391, 21, C.muted);
      text(p, 'Read code. Patch guns.', 380, 391, 21, C.muted);
      text(p, 'Test both roles', 704, 391, 21, C.muted);
      text(p, 'ROOT controls this system. Survive four waves.', 40, 439, 26, C.green);
      return;
   }
   text(p, ui.mode === 'debug' ? `DEBUG ${ui.role === 'editor' ? 'CODER' : 'GUNNER'}` :
      ui.role === 'editor' ? 'CODER' : 'GUNNER', 780, 48, 23, C.gold);
   text(p, String(game.score).padStart(4, '0'), 40, 111, 48, C.text, true, 255);
   text(p, 'SCORE', 40, 147, 18, C.muted);
   text(p, `WAVE ${game.wave || 1}/${WAVES.length}`, 330, 102, 24);
   text(p, `CORE ${game.hp}/5`, 526, 102, 24);
   text(p, `UPLINK ${Math.floor(uplink(game) * 100)}%`, 759, 102, 24);
   for (let i = 0; i < WAVES.length; i++) box(p, 330 + i * 40, 134, 32, 7, i < game.wave ? C.green : '#30483e');
   for (let i = 0; i < 5; i++) box(p, 526 + i * 35, 134, 27, 7, i < game.hp ? game.hp <= 2 ? C.red : C.cyan : '#30483e');
   box(p, 759, 134, 225, 7, '#30483e');
   box(p, 759, 134, 225 * uplink(game), 7, C.green);
   box(p, 40, 163, 944, 2, '#31503f');
   const title = ui.occupied ? 'CODER ROLE OCCUPIED' : ui.waiting ? 'WAITING FOR TEAMMATE' : ui.paused ? 'PAUSED' :
      ({ ready: 'JACK IN, THEN HOLD THE UPLINK', playing: 'HOLD THE UPLINK', upgrade: `WAVE ${game.wave} SURVIVED`,
         won: 'YOU WIN', lost: 'YOU LOSE' })[game.phase];
   const accent = game.phase === 'lost' ? C.red : game.phase === 'won' ? C.gold : C.green;
   box(p, 24, 194, 4, 40, accent);
   text(p, title, 40, 214, 36, accent);
   const gunLock = lock(game), seesGlyphs = ui.mode === 'debug' || ui.role === 'shooter';
   const rootLine = game.root?.line && game.time - game.root.lineAt < 6 ? 'ROOT: ' + game.root.line : '';
   const subtitle = ui.occupied ? 'Another coder is paired. Wait, or reload into another room.'
      : ui.waiting ? 'Both headsets must join the same room.'
      : ui.paused ? ui.pauseReason || 'Point at RESUME RUN when ready.'
      : gunLock && seesGlyphs ? `${gunLock.hand.toUpperCase()} GUN LOCKED / READ TO CODER: ${gunLock.glyphs.map(i => GLYPHS[i]).join(' ')}`
      : rootLine ? rootLine
      : game.phase === 'playing' ? `${game.enemies.length} daemons / gun v${game.revision}`
      : game.phase === 'upgrade' ? game.nextScript ? `ROOT is ready. Next: ${game.nextScript.daemon.name}.` : 'ROOT is analyzing you...'
      : game.phase === 'won' ? `Uplink complete. ${game.kills} daemons removed.`
      : game.phase === 'lost' ? 'Connection lost. ROOT remembers this.'
      : ui.mode === 'debug' ? 'Debug blocks are ready. Switch to GUNNER to start.'
      : 'The gunner shoots; the coder reads ROOT\'s code and patches the guns.';
   text(p, subtitle, 40, 272, 26, rootLine && subtitle === rootLine ? C.green : gunLock && seesGlyphs ? C.gold : C.muted);
   const canStart = !ui.waiting && ui.role !== 'editor';
   const action = ui.paused ? 'RESUME RUN' : game.phase === 'ready' ? 'START RUN' : game.phase === 'upgrade' ? 'NEXT WAVE'
      : ['won', 'lost'].includes(game.phase) ? 'PLAY AGAIN' : 'VIEW CODE';
   button(p, 'action', action, 40, 326, 310, 76, ui.hover, canStart || game.phase === 'playing');
   button(p, 'editor', ui.editorOpen ? 'CLOSE CODE' : 'OPEN CODE', 660, 326, 324, 76, ui.hover);
   const debrief = game.phase === 'playing' ? [] : debriefLines(game);
   if (ui.mode === 'debug') {
      button(p, 'role:shooter', 'GUNNER', 40, 418, 300, 56, ui.hover);
      button(p, 'role:editor', 'CODER', 362, 418, 300, 56, ui.hover);
      button(p, 'pause', ui.paused ? 'RESUME' : 'PAUSE', 684, 418, 300, 56, ui.hover, game.phase === 'playing');
      text(p, debrief[0] || 'Role switch pauses the battle. Desktop: 1 / 2 / P.', 40, 498, 22, C.muted);
   } else if (debrief.length) {
      text(p, debrief[0], 40, 435, 22, C.green);
      text(p, debrief[1] || '', 40, 467, 22, C.muted);
      text(p, debrief[2] || '', 40, 497, 20, C.muted);
   } else {
      text(p, ui.role === 'editor' ? 'RIGHT: edit code   LEFT GRIP: toggle console' :
         'BOTH TRIGGERS: fire   LEFT GRIP: inspect gun', 40, 449, 25);
      text(p, ui.role === 'shooter' ? 'When ROOT\'s eye opens, shoot it to cut its attack short.' :
         'Watch for injected lines. Enter lock glyphs your gunner reads.', 40, 483, 23, C.muted);
   }
}

// What each player should do about each countermeasure, whoever it targets.
const TIPS = {
   BLACKOUT: { gunner: 'SHOOT THE BLACK ORB OR LEAN AWAY', coder: 'BLACK ORB INCOMING: TELL GUNNER TO DODGE' },
   POPUP: { gunner: 'SHOOT THE ✕ ON EACH ERROR WINDOW', coder: 'ERROR WINDOWS ARE BLOCKING YOUR GUNNER' },
   GUN_LOCK: { gunner: 'GUN IS ABOUT TO LOCK', coder: 'GUN LOCKED: ENTER GUNNER\'S GLYPHS IN CONSOLE' },
   INJECT: { gunner: 'GUN ACTING ODD? TELL YOUR CODER', coder: 'ONE LINE IS FAKE: FIND IT AND DELETE IT' },
   PANEL_LOCK: { gunner: 'SHOOT THE GOLD LOCK ON YOUR LEFT', coder: 'CONSOLE LOCKED: GUNNER MUST SHOOT THE LOCK' },
   THIEF: { gunner: 'KILL THE GOLD THIEF BEFORE IT ESCAPES', coder: 'BLOCK STOLEN: GUNNER MUST KILL THE THIEF' },
};
export function wallLines(game, gunner) {
   const me = gunner ? 'gunner' : 'coder', lines = [];
   const attacks = game.phase === 'playing' ? [...game.attacks]
      .sort((a, b) => (ATTACKS[b.type].target === me) - (ATTACKS[a.type].target === me)) : [];
   for (const a of attacks) {
      const glyphs = gunner && a.type === 'GUN_LOCK' && a.warn <= 0;
      lines.push({ warn: a.warn > 0, text: glyphs
         ? `${a.hand.toUpperCase()} GUN LOCKED: READ TO CODER ${a.glyphs.map(i => GLYPHS[i]).join(' ')}`
         : (a.type === 'GUN_LOCK' && gunner ? a.hand.toUpperCase() + ' ' : '') + TIPS[a.type][me] });
   }
   if (game.phase === 'playing' && game.root.exposed > 0)
      lines.push({ text: gunner ? 'ROOT\'S EYE IS OPEN: SHOOT IT 3 TIMES' : 'ROOT\'S EYE IS OPEN: TELL GUNNER TO SHOOT IT' });
   if (game.phase === 'ready')
      lines.push({ text: gunner ? 'POINT AT START RUN ON THE SIDE PANEL' : 'LEFT GRIP OPENS YOUR CODE CONSOLE' });
   if (game.offers.length && game.phase === 'upgrade')
      lines.push({ text: gunner ? 'YOUR CODER IS PICKING A NEW BLOCK' : 'PICK ONE NEW BLOCK IN YOUR CONSOLE' });
   const line = game.root?.line && game.time - game.root.lineAt < 6 ? game.root.line : '';
   if (lines.length < 2 && (line || game.phase === 'playing'))
      lines.push({ root: true, text: line ? 'ROOT: ' + line.toUpperCase() : 'R O O T' });
   return lines.slice(0, 2);
}
// The tip board above the aim corridor: tasks first, then ROOT's line.
export function drawWall(p, game, gunner) {
   const { width, height } = p.canvas;
   box(p, 0, 0, width, height, '#020604');
   const lines = wallLines(game, gunner);
   lines.forEach((line, i) => {
      let size = 52;
      p.ctx.font = `500 ${size}px sans-serif`;
      while (size > 28 && p.ctx.measureText(line.text).width > width - 60) p.ctx.font = `500 ${size -= 2}px sans-serif`;
      const color = line.root ? game.root?.target ? C.red : C.green : line.warn ? C.red : C.gold;
      text(p, line.text, 30, lines.length === 1 ? height / 2 : 78 + i * 100, size, color, false, width - 60);
   });
   return lines.length;
}

export function drawPopup(p) {
   box(p, 0, 0, 512, 340, '#d9dde0');
   box(p, 0, 0, 512, 90, '#b3202f');
   text(p, 'SYSTEM ERROR', 22, 45, 30, '#fff', false, 360);
   // The close box matches the hit area at the top right of the window.
   box(p, 420, 0, 82, 84, C.gold);
   text(p, '✕', 442, 44, 48, '#1a1a1a');
   text(p, 'Are you sure you want', 30, 160, 32, '#1a1a1a', false, 460);
   text(p, 'to continue living?', 30, 204, 32, '#1a1a1a', false, 460);
   text(p, 'SHOOT ✕ TO CLOSE', 30, 290, 30, '#b3202f', false, 460);
}
