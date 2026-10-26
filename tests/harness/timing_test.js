// Usage: node timing_test.js <html>
// Movement-timing model, tested independently of rendering, against the test's OWN model
// T(d) = min(160 + 20(d-1), 280) ms with d = Chebyshev distance in squares.
const L = require('./lib');
const { CASES } = require('./p2a_cases');
const [, , HTML] = process.argv;
const results = [];
const ok = (name, pass, detail) => { results.push(pass); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name} — ${detail}`); };
const T = (d) => Math.min(160 + 20 * (d - 1), 280);

(async () => {
  const { browser, page } = await L.openPage(HTML, { width: 1280, height: 900 });
  // 1. table d = 1..7, straight and diagonal
  const table = await page.evaluate(() => {
    const out = [];
    for (let d = 1; d <= 7; d++) out.push({ d, file: computeMoveDuration({ from: 'a1', to: 'abcdefgh'[d] + '1' }), rank: computeMoveDuration({ from: 'a1', to: 'a' + (1 + d) }), diag: computeMoveDuration({ from: 'a1', to: 'abcdefgh'[d] + (1 + d) }) });
    return out;
  });
  for (const r of table) ok(`d=${r.d} -> ${T(r.d)} ms (file, rank, diagonal)`, r.file === T(r.d) && r.rank === T(r.d) && r.diag === T(r.d), JSON.stringify(r));
  // 2. the app's own move records for every test case (castling: the king's move decides)
  for (const c of CASES) {
    await L.importPgn(page, c.pgn); await L.timelineClick(page, c.ply);
    const r = await page.evaluate(() => { const rec = getActiveRecord(); return { from: rec.from, to: rec.to, ms: computeMoveDuration(rec), secondary: rec.secondary ? rec.secondary.from + '-' + rec.secondary.to : null }; });
    ok(`${c.id}: ${r.from}-${r.to} d=${c.d} -> ${T(c.d)} ms`, r.ms === T(c.d) && r.from === c.from && r.to === c.to, JSON.stringify(r));
  }
  // 3. invalid / degenerate input is safe
  const odd = await page.evaluate(() => [
    computeMoveDuration({ from: 'e4', to: 'e4' }), computeMoveDuration({ from: 'z9', to: 'e4' }), computeMoveDuration({}),
    computeMoveDuration(null), computeMoveDuration({ from: 'e4' }), moveDurationForDistance(0), moveDurationForDistance(-3), moveDurationForDistance(NaN), moveDurationForDistance(10)]);
  ok('zero distance, invalid squares, missing record -> 160 ms minimum (never negative/NaN)', odd.slice(0, 8).every((v) => v === 160), JSON.stringify(odd));
  ok('duration is capped at 280 ms (d=10 -> 280)', odd[8] === 280, String(odd[8]));
  // 4. squares, not pixels
  const sq = await page.evaluate(() => ({ knight: computeMoveDuration({ from: 'g1', to: 'f3' }), straight2: computeMoveDuration({ from: 'e2', to: 'e4' }), diag1: computeMoveDuration({ from: 'e4', to: 'f5' }), straight1: computeMoveDuration({ from: 'e4', to: 'e5' }) }));
  ok('Chebyshev, not Euclidean: knight jump = 2-square push, diagonal step = straight step', sq.knight === sq.straight2 && sq.diag1 === sq.straight1, JSON.stringify(sq));
  // 5. trajectory: rest at both ends, no overshoot, short hesitation
  const tr = await page.evaluate(() => {
    const S = LOGICAL_SIZE / 8, out = [];
    for (const type of ['p', 'n', 'b', 'r', 'q', 'k']) for (const [lbl, a, b] of [['1sq', { x: S * 4.5, y: S * 4.5 }, { x: S * 4.5, y: S * 3.5 }], ['7sq', { x: S * 0.5, y: S * 7.5 }, { x: S * 7.5, y: S * 0.5 }]]) {
      const p0 = pieceTrajectory(type, a, b, 0), p1 = pieceTrajectory(type, a, b, 1);
      const rest = (p, q) => Math.hypot(p.x - q.x, p.y - q.y) < 1e-9 && Math.abs(Math.sin(p.angle)) < 1e-9 && Math.cos(p.angle) > 0 && Math.abs(p.scale - 1) < 1e-9;
      let mono = true, inRange = true, prev = -1, crawlT = null;
      const dist = Math.hypot(b.x - a.x, b.y - a.y);
      for (let i = 0; i <= 2000; i++) { const t = i / 2000, st = pieceTrajectory(type, a, b, t); if (st.e < prev - 1e-12) mono = false; if (st.e < -1e-12 || st.e > 1 + 1e-12) inRange = false; prev = st.e; if (crawlT === null && (1 - st.e) * dist < 0.5) crawlT = t; }
      out.push({ piece: type + '_' + lbl, restAtStart: rest(p0, a), restAtEnd: rest(p1, b), monotonic: mono, noOvershoot: inRange, lastHalfPixelFraction: +(1 - crawlT).toFixed(3) });
    }
    return out;
  });
  for (const r of tr) {
    const d = r.piece.endsWith('7sq') ? 7 : 1, crawlMs = Math.round(r.lastHalfPixelFraction * T(d));
    ok(`${r.piece}: starts and lands exactly at rest, eased progress monotonic in [0,1], final 0.5px crawl ${crawlMs} ms`, r.restAtStart && r.restAtEnd && r.monotonic && r.noOvershoot && crawlMs <= 40, JSON.stringify(r));
  }
  await browser.close();
  console.log(`==== movement timing: ${results.filter(Boolean).length}/${results.length} passed ====`);
})();
