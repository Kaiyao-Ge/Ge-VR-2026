// The text a new card starts with, pure and without graphics. It declares what a module
// can do, a clock input, a state output (published as a variable named after the card) and a draw call, and leaves the body to the user.

// A name is shown in a comment, so line breaks are dropped to keep the comment one line.
export function skeleton(name) {
   const label = String(name).replace(/[\r\n]+/g, ' ');
   const variable = label.replace(/[^a-z0-9_]/g, '_');       // a card's name is a-z, 0-9, _ already; this only keeps the code valid for any other text
   return `// ${label}: a Rails module. Its code only declares ports; the bus does the wiring, by name.
// An input takes the variable of its own name; "use <input> <variable>" on the command line points it elsewhere.
const time = input('time', 'state', 'time');   // the variable time ticks here, 60 times a second
const out = output('${variable}', 'state', 'num');   // the variable is named after this card; a state output keeps its latest value: out.set(v)
const S = state({ count: 0 });                 // the only memory that survives a hot reload

time.on(({ t }) => {
   S.count++;
   out.set(S.count);
   // positions are metres on the stage mat: x right, y up, z towards you
   draw([{ shape: 'sphere', p: [Math.sin(t) * .1, .02, 0], s: .02, color: '#ffb000' }]);
});
`;
}
