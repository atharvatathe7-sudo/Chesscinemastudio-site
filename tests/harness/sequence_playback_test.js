// Usage: node sequence_playback_test.js <html>
// Stage C: continuous playback of a selected range, through the real buttons. animateRecord is wrapped
// (still the real one) to log each move: scheduled start, actual start, completion, the board shown on
// completion. Expected moves/positions come from chess.js and the timeline from the test's own model.
const L = require('./lib');
const B = require('./p2b_lib');
const { QSC_PGN } = require('./p2a_cases');
const { installProbe } = require('./preview_probe');
const [, , HTML] = process.argv;
const results = [];
const ok = (name, pass, detail) => { results.push(pass); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name} — ${detail}`); };

// Installed once per page. lastDrawn = the static board drawBoard() actually drew last (hidden squares
// excluded). A ply's settled board is what was drawn when the NEXT ply starts (or when the run ends).
const LOG = () => {
  if (window.__seqInstalled) { window.__seq = []; window.__maxActive = 0; return; }
  window.__seqInstalled = true; window.__seq = []; let active = 0; window.__maxActive = 0;
  window.__place = () => { const m = {}; (previewBoard || game.board()).forEach((row, i) => row.forEach((p, j) => { const sq = 'abcdefgh'[j] + (8 - i); if (p && !animHideSquares.has(sq)) m[sq] = p.color + p.type; })); return m; };
  const db = window.drawBoard;
  window.drawBoard = function () { const r = db.apply(this, arguments); window.__lastDrawn = window.__place(); window.__lastStatus = document.getElementById('status-bar').textContent; return r; };
  const ar = window.animateRecord;
  window.animateRecord = function (rec, onComplete, startAt, onSettled, ...rest) {
    const prev = window.__seq[window.__seq.length - 1];
    if (prev && !prev.placementAfter) { prev.placementAfter = window.__lastDrawn; prev.status = window.__lastStatus; }
    const e = { ply: rec.ply, startAt, calledAt: performance.now(), placementBefore: window.__lastDrawn }; window.__seq.push(e);
    active++; window.__maxActive = Math.max(window.__maxActive, active);
    return ar.call(this, rec, function () { e.doneAt = performance.now(); return onComplete.apply(this, arguments); }, startAt,
      onSettled && function () { active--; e.settledAt = performance.now(); return onSettled.apply(this, arguments); }, ...rest);
  };
};
const closeLog = (page) => page.evaluate(() => { const l = window.__seq[window.__seq.length - 1]; if (l && !l.placementAfter) { l.placementAfter = window.__lastDrawn; l.status = window.__lastStatus; } return window.__seq; });
const state = (page) => page.evaluate(() => ({ state: sequencePlayback.state, selectedPly, historyPointer, hidden: animHideSquares.size, stop: !document.getElementById('stopSequence').disabled, play: !document.getElementById('playSequence').disabled, status: document.getElementById('status-bar').textContent }));
const waitIdle = (page, ms = 30000) => page.waitForFunction(() => sequencePlayback.state === 'idle', null, { timeout: ms });

async function playRange(page, pgn, from, to, opts = {}) {
  await page.evaluate(LOG);
  await B.chooseRange(page, from, to);
  const startPlacement = await page.evaluate(() => null);
  await page.click('#playSequence');
  const playing = await page.evaluate(() => sequencePlayback.state);
  await waitIdle(page);
  await page.waitForTimeout(100);
  const log = await closeLog(page), maxActive = await page.evaluate(() => window.__maxActive);
  return { startState: { m: log[0].placementBefore, state: playing }, log, maxActive, end: await state(page), endPlacement: await page.evaluate(() => window.__place()) };
}

function checkRun(label, tr, from, to, r, opts = {}) {
  const plan = B.expectedPlan(tr, from, to, opts);
  const plies = r.log.map((e) => e.ply);
  const want = Array.from({ length: to - from + 1 }, (_, i) => from + i);
  ok(`${label}: starts on the position before ply ${from}`, B.samePlacement(r.startState.m, tr.before[from - 1]) && r.startState.state === 'playing', B.diffPlacement(r.startState.m, tr.before[from - 1]) || r.startState.status);
  ok(`${label}: every ply played once, in order, none skipped/duplicated`, JSON.stringify(plies) === JSON.stringify(want), JSON.stringify(plies));
  const badBoards = r.log.filter((e) => !B.samePlacement(e.placementAfter, tr.after[e.ply - 1])).map((e) => `ply ${e.ply}: ${B.diffPlacement(e.placementAfter, tr.after[e.ply - 1])}`);
  ok(`${label}: board after each ply matches chess.js`, badBoards.length === 0, badBoards.join('; ') || `${r.log.length} positions`);
  ok(`${label}: no overlapping animations; the next ply starts only after the previous one settled (incl. capture beat)`, r.maxActive === 1 && r.log.every((e, i) => i === 0 || (r.log[i - 1].settledAt !== undefined && e.calledAt >= r.log[i - 1].settledAt)), `max concurrent ${r.maxActive}`);
  const t0 = r.log[0].startAt;
  const sched = r.log.map((e, i) => +(e.startAt - t0).toFixed(3)), wantSched = plan.moves.map((m) => +(m.start / B.FPS).toFixed(3));
  ok(`${label}: each ply scheduled at its timeline start (independent model)`, JSON.stringify(sched) === JSON.stringify(wantSched), `starts ms ${JSON.stringify(sched)}`);
  // Each ply's clock is its SCHEDULED start, so a late first frame never shifts later plies; lateness
  // only bounds when the first frame of a ply is drawn (one rAF, occasionally a skipped frame).
  const late = r.log.map((e) => e.calledAt - e.startAt);
  ok(`${label}: started on time (never early, at most 50 ms late, no drift)`, late.every((d) => d >= -1 && d <= 50) && (late.length < 4 || Math.max(...late.slice(-3)) <= 50), `lateness ms ${late.map((d) => d.toFixed(1)).join(',')}`);
  ok(`${label}: ends on the position after ply ${to}, ply ${to} selected, idle`, B.samePlacement(r.endPlacement, tr.after[to - 1]) && r.end.selectedPly === to && r.end.state === 'idle' && r.end.hidden === 0 && r.end.play && !r.end.stop,
    `${B.diffPlacement(r.endPlacement, tr.after[to - 1])} ${JSON.stringify(r.end)}`);
  return plan;
}

(async () => {
  // 1. full Legal game: captures (Capture FX on), check, mate
  {
    const { browser, page, errors } = await L.openPage(HTML, { width: 1280, height: 900 });
    await L.importPgn(page, L.LEGAL_PGN);
    const tr = B.truth(L.LEGAL_PGN);
    const r = await playRange(page, L.LEGAL_PGN, 1, 13);
    const plan13 = checkRun('Legal 1-13 (captures, check, mate)', tr, 1, 13, r);
    const p9 = plan13.moves.find((m) => m.ply === 9);
    ok('unmarked capture (9. Nxe5): 700 ms viewing interval (Capture FX inside it) before the next ply', (p9.end - p9.land) / B.FPS === 700 && Math.abs((r.log[9].startAt - r.log[8].startAt) - (180 + 700)) < 0.01, `${(r.log[9].startAt - r.log[8].startAt).toFixed(1)} ms between starts`);
    ok('Legal 1-13: final status is checkmate', /Checkmate! White wins/.test(r.end.status), r.end.status);
    ok('Legal 1-13: check shown after 6. Bxf7+', /\(Check\)/.test(r.log[10].status), r.log[10].status);
    // repeated playback gives the same run
    const r2 = await playRange(page, L.LEGAL_PGN, 1, 13);
    ok('repeated playback: same plies in the same order and timing', JSON.stringify(r2.log.map((e) => [e.ply, +(e.startAt - r2.log[0].startAt).toFixed(3)])) === JSON.stringify(r.log.map((e) => [e.ply, +(e.startAt - r.log[0].startAt).toFixed(3)])), `${r2.log.length} plies`);
    // middle range
    checkRun('Legal 5-9 (middle range)', tr, 5, 9, await playRange(page, L.LEGAL_PGN, 5, 9));
    // single-ply range, first and last ply
    checkRun('Legal 1-1 (first ply only)', tr, 1, 1, await playRange(page, L.LEGAL_PGN, 1, 1));
    checkRun('Legal 13-13 (last ply only)', tr, 13, 13, await playRange(page, L.LEGAL_PGN, 13, 13));
    ok('no page errors', errors.length === 0, JSON.stringify(errors));
    await browser.close();
  }
  // 2. special moves
  for (const [label, pgn, from, to] of [['castling O-O (1-8)', L.CASTLE_PGN, 1, 8], ['castling O-O-O (1-9)', QSC_PGN, 1, 9], ['en passant (1-5)', L.EP_PGN, 1, 5], ['promotion x2 (1-10)', L.PROMO_PGN, 1, 10]]) {
    const { browser, page, errors } = await L.openPage(HTML, { width: 1280, height: 900 });
    await L.importPgn(page, pgn);
    const tr = B.truth(pgn);
    await installProbe(page);
    const r = await playRange(page, pgn, from, to);
    checkRun(label, tr, from, to, r);
    if (/castling/.test(label)) {
      const frames = await page.evaluate(() => window.__pp.frames);
      const ply = tr.moves.findIndex((m) => /O-O/.test(m.san)) + 1, e = r.log.find((x) => x.ply === ply);
      const t0 = r.log[0].startAt - (await page.evaluate(() => 0)), base = frames.length ? 0 : 0;
      const during = frames.filter((f) => f.overlay.length && f.fxProgress === null && f.busy > 0 && f.overlay.some((o) => /k$/.test(o.p)));
      ok(`${label}: king and rook move together in every frame of the castle`, during.length > 0 && during.every((f) => f.overlay.length === 2), `${during.filter((f) => f.overlay.length === 2).length}/${during.length} frames`);
    }
    ok(`${label}: no page errors`, errors.length === 0, JSON.stringify(errors));
    await browser.close();
  }
  // 3. Story Targets and an annotation: their plies get the full hold
  {
    const { browser, page, errors } = await L.openPage(HTML, { width: 1280, height: 900 });
    await L.importPgn(page, L.LEGAL_PGN);
    const tr = B.truth(L.LEGAL_PGN);
    await B.storyTargets(page, 9, ['c6', 'f6']);
    await B.highlight(page, 7, 'f7');
    const r = await playRange(page, L.LEGAL_PGN, 6, 10);
    const plan = checkRun('Story Targets on ply 9 + highlight on ply 7 (6-10)', tr, 6, 10, r, { marks: { 9: true, 7: true }, story: { 9: true } });
    const gap = (p) => { const m = plan.moves.find((x) => x.ply === p); return (m.end - m.land) / B.FPS; };
    ok('holds: ply 7 (highlight) 1000 ms, ply 9 (Story Targets, capture) 2466.7 ms, ordinary 6 and 8: 450 ms', Math.abs(gap(7) - 1000) < 0.01 && Math.abs(gap(9) - 2466.667) < 0.01 && gap(6) === 450 && gap(8) === 450, `holds ${[6, 7, 8, 9].map((p) => p + ':' + gap(p).toFixed(1)).join(' ')}`);
    const r9 = r.log.find((e) => e.ply === 9), r10 = r.log.find((e) => e.ply === 10);
    ok('on screen, ply 10 starts 2466.7 ms after ply 9 lands (180 ms move)', Math.abs((r10.startAt - r9.startAt) - (180 + 2466.667)) < 0.01, `${(r10.startAt - r9.startAt).toFixed(3)} ms`);
    ok('no page errors', errors.length === 0, JSON.stringify(errors));
    await browser.close();
  }
  // 4. Capture FX off: captures get no beat
  {
    const { browser, page } = await L.openPage(HTML, { width: 1280, height: 900 });
    await L.importPgn(page, L.LEGAL_PGN); await page.selectOption('#captureFx', 'off');
    checkRun('Capture FX off (1-13): capture interval unchanged (700 ms)', B.truth(L.LEGAL_PGN), 1, 13, await playRange(page, L.LEGAL_PGN, 1, 13), { fx: false });
    await browser.close();
  }
  // 5. Stop, guards, navigation after stop, restart
  {
    const { browser, page, errors } = await L.openPage(HTML, { width: 1280, height: 900 });
    await L.importPgn(page, L.LEGAL_PGN);
    const tr = B.truth(L.LEGAL_PGN);
    await page.evaluate(LOG);
    await B.chooseRange(page, 1, 13);
    await page.click('#playSequence');
    await page.waitForFunction(() => window.__seq.length >= 6, null, { timeout: 10000 });
    // guards while playing
    const s0 = await state(page);
    for (const sel of ['#nextMove', '#prevMove', '#playAnim', '#exportAnim', '#reset', '#loadSample', '#flip']) await page.locator(sel).click({ force: true });
    await page.locator('#timelineList button').nth(1).click({ force: true });
    await page.locator('#playSequence').click({ force: true });
    await page.locator('#exportSequence').click({ force: true });
    const g = await page.evaluate(() => ({ state: sequencePlayback.state, exporting: exportInProgress, flipped: boardFlipped, hist: historyPointer, msg: document.getElementById('message-box').innerText, moves: moveHistory.length }));
    ok('while playing: navigation, Play/Export, Reset, Load sample, Flip and timeline clicks are refused', g.state === 'playing' && !g.exporting && !g.flipped && g.hist === s0.historyPointer && g.moves === 13 && /Stop the sequence first/.test(g.msg), JSON.stringify(g));
    const before = await page.evaluate(() => window.__maxActive);
    await page.click('#stopSequence');
    const st = await state(page);
    const landed = await page.evaluate(() => { const e = window.__seq.filter((x) => x.doneAt); return e.length ? e[e.length - 1].ply : 0; });
    const nCalls = await page.evaluate(() => window.__seq.length);
    await page.waitForTimeout(1500);
    const after = await page.evaluate(() => ({ calls: window.__seq.length, hidden: animHideSquares.size, overlayInk: (() => { const o = document.getElementById('overlay'); const d = o.getContext('2d').getImageData(0, 0, o.width, o.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i]) n++; return n; })() }));
    const shown = await L.shownPlacement(page);
    ok('Stop: idle at once, no further moves start, nothing left animating', st.state === 'idle' && !st.stop && after.calls === nCalls && after.hidden === 0 && after.overlayInk === 0 && before === 1, JSON.stringify({ st, after }));
    ok(`Stop: the last landed ply (${landed}) is selected and shown`, st.selectedPly === landed && landed >= 3, `selected ${st.selectedPly}`);
    const tShown = await page.evaluate(() => window.__place());
    ok('Stop: board equals chess.js after that ply', B.samePlacement(tShown, tr.after[landed - 1]), B.diffPlacement(tShown, tr.after[landed - 1]));
    await page.click('#nextMove'); await page.waitForTimeout(150);
    const nv = await L.navState(page);
    const afterNext = await page.evaluate(() => window.__place());
    ok('after Stop, Next steps on from the shown ply (normal navigation)', nv.selectedPly === landed + 1 && nv.historyPointer === landed + 1 && B.samePlacement(afterNext, tr.after[landed]), JSON.stringify({ sel: nv.selectedPly, hp: nv.historyPointer }) + ' ' + B.diffPlacement(afterNext, tr.after[landed]));
    // restart after stop plays the whole range again
    await page.evaluate(LOG);
    await B.chooseRange(page, 1, 13);
    await page.click('#playSequence'); await waitIdle(page);
    const plies = await page.evaluate(() => window.__seq.map((e) => e.ply));
    ok('restart after Stop plays the whole range again, once each', JSON.stringify(plies) === JSON.stringify(Array.from({ length: 13 }, (_, i) => i + 1)), JSON.stringify(plies));
    // stop immediately after Play (before the first frame) is clean too
    await page.evaluate(() => { window.__seq = []; });
    const sel0 = (await L.navState(page)).selectedPly;
    await page.evaluate(() => { document.getElementById('playSequence').click(); document.getElementById('stopSequence').click(); });   // same task: before the first frame
    await page.waitForTimeout(800);
    const q = await page.evaluate(() => ({ calls: window.__seq.length, state: sequencePlayback.state, sel: selectedPly, hidden: animHideSquares.size }));
    ok('Stop straight after Play: nothing plays, selection restored', q.calls === 0 && q.state === 'idle' && q.sel === sel0 && q.hidden === 0, JSON.stringify(q));
    ok('no page errors', errors.length === 0, JSON.stringify(errors));
    await browser.close();
  }
  // 6. An error during playback stops the sequence cleanly (nothing left "playing"), and playback works after
  {
    const { browser, page } = await L.openPage(HTML, { width: 1280, height: 900 });
    await L.importPgn(page, L.LEGAL_PGN);
    await page.evaluate(() => { const ar = window.animateRecord; let n = 0; window.__arCalls = 0; window.animateRecord = function (...a) { window.__arCalls++; if (++n === 3) throw new Error('animation failure (induced)'); return ar.apply(this, a); }; });
    await B.chooseRange(page, 1, 13);
    await page.click('#playSequence');
    await page.waitForTimeout(1500);
    const s1 = await page.evaluate(() => ({ state: sequencePlayback.state, calls: window.__arCalls, hidden: animHideSquares.size, msg: document.getElementById('message-box').innerText, play: !document.getElementById('playSequence').disabled, stop: !document.getElementById('stopSequence').disabled, sel: selectedPly }));
    ok('an error during playback stops it: idle, message, no further moves, nothing animating, last landed ply shown', s1.state === 'idle' && s1.calls === 3 && s1.hidden === 0 && /Sequence playback stopped/.test(s1.msg) && s1.play && !s1.stop && s1.sel === 2, JSON.stringify(s1));
    await page.evaluate(LOG);
    await page.click('#playSequence'); await waitIdle(page);
    const plies = await page.evaluate(() => window.__seq.map((e) => e.ply));
    ok('… and the next playback runs the whole range', JSON.stringify(plies) === JSON.stringify(Array.from({ length: 13 }, (_, i) => i + 1)), JSON.stringify(plies));
    await browser.close();
  }
  console.log(`==== sequence playback: ${results.filter(Boolean).length}/${results.length} passed ====`);
})();
