// Deterministic long legal game (seeded PRNG, chess.js): random legal moves, never ending the game early
// (a move that mates or stalemates is avoided when another exists). Writes PGN to stdout.
const L = require('./lib');
function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; }; }
function longGame(plies, seed = 7) {
  const g = new L.Chess(), r = rng(seed);
  while (g.history().length < plies) {
    const moves = g.moves(); if (!moves.length) break;
    const order = moves.map((m) => [r(), m]).sort((a, b) => a[0] - b[0]).map((x) => x[1]);
    let done = false;
    for (const m of order) { g.move(m); if (!g.in_checkmate() && !g.in_stalemate()) { done = true; break; } g.undo(); }
    if (!done) { g.move(order[0]); break; }
  }
  return g.pgn();
}
module.exports = { longGame };
if (require.main === module) process.stdout.write(longGame(+process.argv[2] || 400, +process.argv[3] || 7));
