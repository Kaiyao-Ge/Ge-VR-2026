// Keys to actions, pure: one key event from the laptop becomes a text edit for the focused
// card's buffer, a command for the scene, or nothing. Mod is Cmd on a Mac and Ctrl elsewhere.
// Text goes in only when no Mod is held, and a key the browser or the OS keeps for itself
// (Mod+W/T/N/Q/R, F5, F11, F12, Ctrl+Tab, Alt+Tab, Ctrl+Arrow on a Mac) is never bound.
// Commands ignore key repeat so holding Mod+Enter does not run the card again and again.
//
//    key                          Mac                  Windows / Linux
//    letters, digits, symbols     insert (also Option) insert (Alt alone: nothing; AltGr inserts)
//    Enter Tab Backspace Delete   newline, tab, backspace, delete (no Ctrl/Alt/Cmd held)
//    arrows Home End PageUp/Down  move left/right/up/down/home/end/pageup/pagedown
//    Cmd+Left / Cmd+Right         home / end           (nothing)
//    Mod+Backspace                delete to line start
//    Mod+Z, Mod+Shift+Z           undo, redo           undo, redo (and Ctrl+Y)
//    Mod+Enter, Mod+Shift+Enter   run, here (continue from the paused playhead)
//    Mod+P, Mod+. , Mod+Home      pause, play, recentre
//    Mod+B                        the bus window
//    Mod+= (or +), Mod+-, Mod+0   zoom the focused card in, out, back to 32 columns
//    Mod+[ , Mod+]                step the paused playhead back, forward by 0.5 s (Shift: 0.1 s, `fine`; they repeat when held;
//                                 also by the key's place, BracketLeft / BracketRight, on layouts where [ ] are not on those keys)
//    Escape                       escape (command line, then release focus)
//    anything else with Mod, modifier-only keys, F-keys, Dead, Unidentified: nothing

export const isMac = platform => /Mac|iPhone|iPad/.test(platform || '');

const MOVES = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down',
                Home: 'home', End: 'end', PageUp: 'pageup', PageDown: 'pagedown' };
const STEPS = { '[': 'stepBack', '{': 'stepBack', ']': 'stepFwd', '}': 'stepFwd' };
const STEP_CODES = { BracketLeft: 'stepBack', BracketRight: 'stepFwd' };
const PLAIN = { Enter: 'newline', Tab: 'tab', Backspace: 'backspace', Delete: 'delete' };

const edit = op => ({ edit: op });
const cmd = name => ({ cmd: name });

export function mapKey(ev, { mac = false } = {}) {
   if (!ev || ev.d !== 'down' || typeof ev.key !== 'string') return null;
   const { c, a, s, m } = ev.mods || {};
   const key = ev.key, one = key.length === 1;
   if (mac ? c : m) return null;                          // Ctrl on a Mac and Meta elsewhere belong to the OS
   if (!mac && c && a) return one ? edit({ op: 'insert', text: key }) : null;   // AltGr is Ctrl+Alt on Windows
   if (mac ? m : c) return a ? null : withMod(ev, mac, s);
   if (!mac && a) return null;                            // bare Alt opens the menu bar
   if (one) return edit({ op: 'insert', text: key });     // on a Mac, Option characters arrive here
   if (a) return null;
   if (key === 'Escape') return ev.rep ? null : cmd('escape');
   if (MOVES[key]) return edit({ op: 'move', dir: MOVES[key] });
   if (PLAIN[key]) return edit({ op: PLAIN[key] });
   return null;
}

// Keys with Mod held (and no Alt). Anything not listed is left to the browser.
function withMod(ev, mac, shift) {
   const key = ev.key.length === 1 ? ev.key.toLowerCase() : ev.key;
   if (key === 'z') return edit({ op: shift ? 'redo' : 'undo' });
   if (key === 'y' && !mac) return edit({ op: 'redo' });
   if (key === 'Backspace') return edit({ op: 'deleteLineStart' });
   if (mac && key === 'ArrowLeft') return edit({ op: 'move', dir: 'home' });
   if (mac && key === 'ArrowRight') return edit({ op: 'move', dir: 'end' });
   const step = STEPS[key] ?? STEP_CODES[ev.code];                   // Shift+[ types { on most keyboards; other layouts: by the key's place
   if (step) return shift ? { cmd: step, fine: true } : cmd(step);
   if (ev.rep) return null;
   if (key === 'Enter') return cmd(shift ? 'here' : 'run');
   if (key === 'p') return cmd('pause');
   if (key === '.') return cmd('play');
   if (key === 'Home') return cmd('recentre');
   if (key === 'b') return cmd('bus');
   if (key === '=' || key === '+') return cmd('zoomIn');
   if (key === '-') return cmd('zoomOut');
   if (key === '0') return cmd('zoomReset');
   return null;
}
