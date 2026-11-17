// The one-line command language of Rails, pure: parseCommand(line) turns what was typed after
// Esc into {op, ...} for the scene to carry out, or {error} with a message to show under the
// line. It checks the shape of a command (words, names); whether the card, the input or the
// variable exists, or the shapes fit, is for the bus and the scene to say.
//
//    card <name>                       -> addModule     new card from the skeleton
//    use <input> [variable]            -> use           bind an input of the focused card to a variable (none: its own name)
//    plug | unplug                     -> plug          the focused card's outputs and inputs on the bus, or off it
//    rm | rename <name> | undo | reset | revert
//    pause | live | play | here        -> same as the keys (live resumes; here continues from the paused playhead)
import { NAME } from './values.js';

const NAMELESS = ['rm', 'undo', 'reset', 'revert', 'pause', 'live', 'play', 'here'];

const fail = error => ({ error });
const bad = name => fail(`bad name '${name}': a-z, 0-9, _, starting with a letter, 32 at most; constructor is reserved`);
const usage = text => fail(`usage: ${text}`);

export function parseCommand(line) {
   const words = String(line == null ? '' : line).trim().split(/\s+/).filter(Boolean);
   if (!words.length) return fail('type a command');
   const [verb, ...args] = words;
   if (NAMELESS.includes(verb)) return args.length ? usage(verb) : { op: verb };
   if (verb === 'plug' || verb === 'unplug') return args.length ? usage(verb) : { op: 'plug', on: verb === 'plug' };
   if (verb === 'card') return named(verb, args, name => ({ op: 'addModule', name }), 'card <name>');
   if (verb === 'rename') return named(verb, args, name => ({ op: 'rename', name }), 'rename <name>');
   if (verb === 'use') return use(args);
   return fail(`unknown command '${verb}'`);
}

function named(verb, args, make, text) {
   if (args.length !== 1) return usage(text);
   return NAME.test(args[0]) ? make(args[0]) : bad(args[0]);
}

function use([port, variable = null, ...extra]) {
   if (port === undefined || extra.length) return usage('use <input> [variable]');
   if (!NAME.test(port)) return bad(port);
   if (variable !== null && !NAME.test(variable)) return bad(variable);
   return { op: 'use', port, variable };
}
