// Usage: node pacing_test.js <html>
// Phase 2C post-move viewing intervals. The app's timeline (sequencePlan, which drives BOTH playback and
// export) is compared move by move with the test's own model (p2b_lib.expectedPlan: classification from
// chess.js SAN/captures, intervals 450/700/700/5000, last >= 1000, max() with marked/FX holds). The
// exported frames of a hold are then checked to show the landed position throughout.
const L = require('./lib');
const B = require('./p2b_lib');
const { QSC_PGN } = require('./p2a_cases');
const { longGame } = require('./longgame');
const [, , HTML] = process.argv;
const results = [];
const ok = (name, pass, detail) => { results.push(pass); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name} — ${detail}`); };
const appPlan = (page, from, to) => page.evaluate(([f, t]) => { const p = sequencePlan(moveHistory.slice(f - 1, t), 30, captureEffect);
  return { total: p.totalFrames, moves: p.moves.map((m) => ({ ply: m.rec.ply, cls: m.cls, viewMs: m.viewMs, holdMs: m.holdMs, start: m.start, land: m.land, end: m.end })) }; }, [from, to]);
function compare(label, app, exp) {
  const bad = [];
  exp.moves.forEach((e, i) => { const a = app.moves[i];
    if (!a || a.ply !== e.ply || a.cls !== e.cls || a.viewMs !== e.viewMs || Math.abs(a.holdMs - e.holdMs) > 1e-9 || a.start !== e.start || a.land !== e.land || a.end !== e.end) bad.push(`ply ${e.ply} ${e.san}: app ${JSON.stringify(a)} want ${JSON.stringify({ cls: e.cls, viewMs: e.viewMs, holdMs: e.holdMs, start: e.start, end: e.end })}`); });
  ok(`${label}: every move's class, interval, hold and start/land/end match the independent model; ${exp.totalFrames} frames`, bad.length === 0 && app.total === exp.totalFrames, bad.slice(0, 2).join(' | ') || `${exp.moves.length} moves, ${(exp.totalFrames / 30).toFixed(3)} s`);
}
(async () => {
  // 1. plain games, Capture FX on and off
  for (const [label, pgn] of [['Legal', L.LEGAL_PGN], ['castle O-O', L.CASTLE_PGN], ['castle O-O-O', QSC_PGN], ['en passant', L.EP_PGN], ['promotion', L.PROMO_PGN], ['random 200 plies', longGame(200, 11)]]) {
    const { browser, page } = await L.openPage(HTML, { width: 1280, height: 900 });
    await L.importPgn(page, pgn); const tr = B.truth(pgn); const n = tr.moves.length;
    for (const fx of ['dissolve', 'off']) {
      await page.selectOption('#captureFx', fx);
      compare(`${label} 1-${n} (FX ${fx})`, await appPlan(page, 1, n), B.expectedPlan(tr, 1, n, { fx: fx !== 'off' }));
    }
    // a middle range: its last move gets the final interval, the others their own
    if (n >= 6) compare(`${label} 2-${n - 2} (middle range)`, await appPlan(page, 2, n - 2), B.expectedPlan(tr, 2, n - 2));
    compare(`${label} ${n}-${n} (last move only)`, await appPlan(page, n, n), B.expectedPlan(tr, n, n));
    if (label === 'random 200 plies') {
      const cls = await page.evaluate(() => moveHistory.map((r) => moveClass(r)));
      const want = tr.moves.map(B.classOf);
      const mism = cls.map((c, i) => c === want[i] ? null : `${i + 1} ${tr.moves[i].san}: ${c}/${want[i]}`).filter(Boolean);
      const counts = want.reduce((m, c) => (m[c] = (m[c] || 0) + 1, m), {});
      ok('classification agrees with chess.js on all 200 plies', mism.length === 0, mism.slice(0, 3).join(' | ') || JSON.stringify(counts));
    }
    await browser.close();
  }
  // 2. explicit values on the Legal game (measured, ms)
  {
    const { browser, page } = await L.openPage(HTML, { width: 1280, height: 900 });
    await L.importPgn(page, L.LEGAL_PGN);
    const a = await appPlan(page, 1, 13); const h = (p) => a.moves[p - 1].holdMs, gapStart = (p) => (a.moves[p].start - a.moves[p - 1].start) / 30;
    ok('ordinary move: 450 ms after landing, then the next move starts (1. e4: 180 ms move, next starts at 630 ms)', h(1) === 450 && a.moves[1].start / 30 === 630 && gapStart(1) === 630, `hold ${h(1)} ms, next start ${a.moves[1].start / 30} ms`);
    ok('capture (5. Nxe5): 700 ms total, not 700 + 500 effect', h(9) === 700 && gapStart(9) === 180 + 700, `hold ${h(9)} ms`);
    ok('capture + check (6. Bxf7+): check wins, 700 ms (not stacked)', a.moves[10].cls === 'check' && h(11) === 700, `${a.moves[10].cls} ${h(11)} ms`);
    ok('checkmate (7. Nd5#): 5000 ms terminal interval, then one closing frame', a.moves[12].cls === 'checkmate' && h(13) === 5000 && a.total === Math.ceil(a.moves[12].end / 1000) + 1, `${h(13)} ms, ${a.total} frames, ${(a.total / 30).toFixed(3)} s`);
    const b = await appPlan(page, 1, 12);
    ok('final ordinary move of a range (6… Ke7 as last): 1000 ms', b.moves[11].cls === 'ordinary' && b.moves[11].holdMs === 1000, `${b.moves[11].holdMs} ms`);
    const c = await appPlan(page, 1, 9);
    ok('final capture of a range (5. Nxe5 as last): 1000 ms (final rule, not 700)', c.moves[8].holdMs === 1000, `${c.moves[8].holdMs} ms`);
    // marked moves and multiple annotations: max(), never a sum
    await B.storyTargets(page, 9, ['c6', 'f6']);           // capture + Story Targets
    await B.highlight(page, 3, 'e5'); await B.highlight(page, 3, 'f3');   // two highlights on an ordinary move
    await page.evaluate(() => { moveHistory[10].badge = '!'; moveHistory[10].annotation = 'Good'; moveHistory[3].arrows.push({ from: 'd7', to: 'd6', color: '#ff0000' }); moveHistory[3].highlights.push({ file: 3, rank: 2, sq: 'd6', color: 'rgba(255,0,0,1)', alpha: 0.28 }); moveHistory[3].badge = '?!'; });
    await B.storyTargets(page, 13, ['e7']);                  // checkmate + Story Targets
    const m = await appPlan(page, 1, 13); const hm = (p) => m.moves[p - 1].holdMs;
    const exp = B.expectedPlan(B.truth(L.LEGAL_PGN), 1, 13, { marks: { 9: true, 3: true, 4: true, 11: true, 13: true }, story: { 9: true, 13: true } });
    compare('marked moves', m, exp);
    ok('two highlights on an ordinary move (2. Nf3): 1000 ms (marked hold), not 450 + 1000 or 2 x 1000', hm(3) === 1000, `${hm(3)} ms`);
    ok('arrow + highlight + badge on one move (2… d6): 1000 ms, counted once', hm(4) === 1000, `${hm(4)} ms`);
    ok('capture + Story Targets (5. Nxe5): 2466.7 ms (Story camera beat), not 700 + 2466.7', Math.abs(hm(9) - 2466.667) < 0.01, `${hm(9).toFixed(1)} ms`);
    ok('check + badge (6. Bxf7+ "!"): 1000 ms', hm(11) === 1000, `${hm(11)} ms`);
    ok('checkmate + Story Targets (last): 5000 ms (mate wins), not 5000 + 2466.7', hm(13) === 5000, `${hm(13)} ms`);
    ok('marking moves does not change any movement time', m.moves.every((x, i) => (x.land - x.start) === (a.moves[i].land - a.moves[i].start)), '');
    await browser.close();
  }
  // 3. exported frames: during a hold the landed position is shown on every frame; the effect only at its start
  {
    const { browser, page } = await L.openPage(HTML, { width: 1280, height: 900 });
    await L.importPgn(page, L.LEGAL_PGN); await B.chooseRange(page, 7, 10);
    await B.installExportProbe(page);
    const dl = page.waitForEvent('download'); await page.click('#exportSequence'); await dl;
    const fr = await page.evaluate(() => window.__X.frames);
    const tr = B.truth(L.LEGAL_PGN), plan = B.expectedPlan(tr, 7, 10);
    const seg = {}; const bad = [];
    fr.forEach((f, n) => { const at = B.frameAt(plan, n); const key = at.ply + (at.moving ? 'm' : 'h'); seg[key] = (seg[key] || 0) + 1;
      if (!at.moving) { const pl = B.framePlacement(f); if (!B.samePlacement(pl, tr.after[at.ply - 1])) bad.push(`f${n}`); const drawn = f.fx !== null && f.fx >= 0 && f.fx < 1; if (drawn !== (!!tr.moves[at.ply - 1].captured && at.holdIndex < 15)) bad.push(`f${n} fx ${f.fx}`); } });
    const holdFrames = (p) => { const m = plan.moves.find((x) => x.ply === p); return Math.ceil(m.end / 1000) - m.landFrame; };
    ok('export 4. Nc3 … 5… Bxd1: frames per hold = frames inside [landing, landing + interval)', fr.length === plan.totalFrames && [7, 8, 9].every((p) => seg[p + 'h'] === holdFrames(p)),
      `holds (frames): 7:${seg['7h']} 8:${seg['8h']} 9:${seg['9h']} 10:${seg['10h']} (want ${holdFrames(7)},${holdFrames(8)},${holdFrames(9)}, last ${Math.ceil(plan.moves[3].end / 1000) - plan.moves[3].landFrame}+1 closing)`);
    ok('every hold frame shows the landed position; capture effect only in its first 15 frames, then the still position', bad.length === 0, bad.slice(0, 4).join(' ') || `${fr.length} frames`);
    await browser.close();
  }
  // 4. the frame limit with the new holds: exactly at the limit is allowed, one ply more is refused before work
  {
    const pgn = longGame(1650); const tr = B.truth(pgn);
    let k = 1; while (B.expectedPlan(tr, 1, k + 1).totalFrames <= 8400) k++;
    const { browser, page } = await L.openPage(HTML, { width: 1280, height: 900 });
    await L.importPgn(page, pgn);
    await B.chooseRange(page, 1, k);
    const at = await page.evaluate(() => ({ exp: !document.getElementById('exportSequence').disabled, info: document.getElementById('seqInfo').textContent }));
    await B.chooseRange(page, 1, k + 1);
    const over = await page.evaluate(() => ({ exp: !document.getElementById('exportSequence').disabled, play: !document.getElementById('playSequence').disabled, info: document.getElementById('seqInfo').textContent }));
    await page.evaluate(() => { window.__enc = 0; const V = window.VideoEncoder; window.VideoEncoder = function (i) { window.__enc++; return new V(i); }; window.VideoEncoder.isConfigSupported = V.isConfigSupported.bind(V);
      document.getElementById('exportSequence').disabled = false; document.getElementById('exportSequence').click(); });
    await page.waitForTimeout(600);
    const forced = await page.evaluate(() => ({ enc: window.__enc, exporting: exportInProgress, msg: document.getElementById('message-box').innerText }));
    ok(`limit: plies 1-${k} = ${B.expectedPlan(tr, 1, k).totalFrames} frames is exportable; 1-${k + 1} = ${B.expectedPlan(tr, 1, k + 1).totalFrames} frames is refused (Play still allowed)`, at.exp && /\(8400 frames\)/.test(at.info) && !over.exp && over.play && /Too long to export/.test(over.info), over.info.slice(-150));
    ok('forced export over the limit: refused before any encoder exists, lock released, reason shown', forced.enc === 0 && !forced.exporting && /longest export supported is 8400 frames/.test(forced.msg), JSON.stringify(forced).slice(0, 200));
    await browser.close();
  }
  console.log(`==== pacing: ${results.filter(Boolean).length}/${results.length} passed ====`);
})();
