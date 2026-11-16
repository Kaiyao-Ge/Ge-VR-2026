// The line that Doorways sends to the server log (doorways.js), pure so that it can be tested without a browser. It says
// what a player's client holds of the round: the level (rooms with their symbols, slots and turns), where the mini has
// been and can go, the state, and what the symbols' textures are, to find out from a headset's report why something
// could not be seen.
import { reachable } from './rules.js';

// Which things a room holds, as letters: k key, s switch, c chest, g gate, a anchor.
const flags = r => (r.key ? 'k' : '') + (r.switch ? 's' : '') + (r.chest ? 'c' : '') + (r.gate ? 'g' : '') + (r.anchor ? 'a' : '');

// game: { level, state }. extras: { ev ('round', 'win' or 'tick'), xr, role, paired, round, visited, errors, lastError,
// channels: [{ symbol, channel, uploaded, same }], txtrChannel }.
// uploaded: the symbol's pixels are in its texture; same: the channel still holds the symbol's own canvas (false when another texture took it over). Returns a plain object that goes through JSON.stringify as one short line.
export const reportOf = ({ level, state }, extras) => {
   const { ev, xr, role, paired, round, visited, errors, lastError, channels, txtrChannel } = extras;
   const report = {
      v: 1, ev, xr: !!xr, role, paired, round: round || 0, seed: level.seed, goal: level.goal, goalSymbol: level.goalSymbol,
      rooms: level.rooms.map(r => [r.id, r.symbol, state.at[r.id]?.slot ?? null, state.at[r.id]?.rot ?? null, flags(r)]),
      mini: state.mini, visited: [...visited], reachable: [...reachable(level, state)],
      keys: [...state.keys], unlocked: [...state.unlocked], pressed: [...state.pressed], opened: [...state.opened],
      penalty: state.penalty, won: state.won,
      channels: channels.map(({ symbol, channel, uploaded, same }) => ({ symbol, channel, uploaded, same })), txtrChannel: [...(txtrChannel || [])], errors: errors || 0,
   };
   if (errors) report.lastError = lastError;
   return report;
};
