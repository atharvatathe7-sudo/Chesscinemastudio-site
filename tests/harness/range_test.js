// Usage: node range_test.js <html>
// Stage B: move-range selection through the real selectors.
const L = require('./lib');
const B = require('./p2b_lib');
const [, , HTML] = process.argv;
const results = [];
const ok = (name, pass, detail) => { results.push(pass); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name} — ${detail}`); };
const ui = (page) => page.evaluate(() => ({
  options: [...document.querySelectorAll('#seqFrom option')].map((o) => o.value + ':' + o.textContent),
  from: document.getElementById('seqFrom').value, to: document.getElementById('seqTo').value,
  info: document.getElementById('seqInfo').textContent,
  play: !document.getElementById('playSequence').disabled, exp: !document.getElementById('exportSequence').disabled,
  selDisabled: document.getElementById('seqFrom').disabled
}));
(async () => {
  const { browser, page, errors } = await L.openPage(HTML, { width: 1280, height: 900 });
  const tr = B.truth(L.LEGAL_PGN);
  // empty game
  let u = await ui(page);
  ok('empty game: no options, buttons disabled, explanation shown', u.options.length === 0 && !u.play && !u.exp && u.selDisabled && /Import a PGN/.test(u.info), JSON.stringify(u));
  // invalid PGN leaves it empty and working
  await L.importPgn(page, 'this is not a pgn 1. e9');
  u = await ui(page);
  ok('invalid PGN: still empty and usable', u.options.length === 0 && !u.play && /Import a PGN/.test(u.info), JSON.stringify({ n: u.options.length, info: u.info }));
  // import -> full range by default, ply labels with move number and colour
  await L.importPgn(page, L.LEGAL_PGN);
  u = await ui(page);
  const expLabels = tr.moves.map((m, i) => `${i + 1}:${Math.floor(i / 2) + 1}${m.color === 'b' ? '…' : '.'} ${m.san}`);
  ok('import: one option per ply, labelled "N. san" (White) / "N… san" (Black)', JSON.stringify(u.options) === JSON.stringify(expLabels), u.options.slice(0, 4).join(' | ') + ' … ' + u.options.slice(-2).join(' | '));
  const exp13 = B.expectedPlan(tr, 1, 13);
  ok('default range = whole game, count and duration shown', u.from === '1' && u.to === '13' && u.play && u.exp && u.info.startsWith('13 plies: 1. e4 → 7. Nd5#') && u.info.includes(`(${exp13.totalFrames} frames)`),
    u.info);
  // board/navigation untouched by choosing a range
  const s0 = await L.navState(page), p0 = await L.shownPlacement(page);
  for (const [f, t, name, n] of [[1, 1, 'first move only', 1], [13, 13, 'last move only', 1], [5, 9, 'middle range', 5], [1, 13, 'full game', 13]]) {
    await B.chooseRange(page, f, t);
    u = await ui(page);
    const plan = B.expectedPlan(tr, f, t);
    const first = `${Math.floor((f - 1) / 2) + 1}${tr.moves[f - 1].color === 'b' ? '…' : '.'} ${tr.moves[f - 1].san}`;
    ok(`${name} (${f}-${t}): count ${n}, starts before ${first}, frames ${plan.totalFrames}`, u.play && u.exp && u.info.startsWith(`${n} ${n === 1 ? 'ply' : 'plies'}: ${first}`) && u.info.includes(`Starts from the position before ${first}`) && u.info.includes(`(${plan.totalFrames} frames)`), u.info);
  }
  const s1 = await L.navState(page), p1 = await L.shownPlacement(page);
  ok('choosing ranges never changes the game, selection or board', JSON.stringify(s0) === JSON.stringify(s1) && JSON.stringify(p0) === JSON.stringify(p1), JSON.stringify({ before: s0.selectedPly, after: s1.selectedPly }));
  // invalid range: From after To
  await B.chooseRange(page, 9, 5);
  u = await ui(page);
  ok('invalid range (From after To): rejected, Play/Export disabled, reason shown', !u.play && !u.exp && /must not come after/.test(u.info), u.info);
  // even forced, the handlers refuse it
  await page.evaluate(() => { document.getElementById('playSequence').disabled = false; document.getElementById('exportSequence').disabled = false; });
  await page.click('#playSequence'); await page.click('#exportSequence'); await page.waitForTimeout(300);
  const st = await page.evaluate(() => ({ state: sequencePlayback.state, exporting: exportInProgress, msg: document.getElementById('message-box').innerText }));
  ok('forced click on an invalid range does nothing harmful', st.state === 'idle' && !st.exporting && /must not come after/.test(st.msg), JSON.stringify(st));
  // a value that is not a ply of this game
  await page.evaluate(() => { const s = document.getElementById('seqTo'); const o = document.createElement('option'); o.value = '99'; s.appendChild(o); s.value = '99'; s.dispatchEvent(new Event('change')); });
  u = await ui(page);
  const toOpts = await page.evaluate(() => [...document.querySelectorAll('#seqTo option')].map((o) => o.value));
  ok('out-of-game ply is not accepted (clamped to the game, stray option removed)', u.to === '13' && toOpts.length === 13 && !toOpts.includes('99'), JSON.stringify({ to: u.to, toOptions: toOpts.length }));
  // new import after choosing a range: range follows the new game
  await B.chooseRange(page, 3, 7);
  await L.importPgn(page, L.SECOND_PGN);
  u = await ui(page);
  ok('importing another game resets the range to the new whole game', u.options.length === 10 && u.from === '1' && u.to === '10' && u.info.startsWith('10 plies: 1. d4 → 5… Be7'), u.info);
  // Reset -> empty again
  await page.click('#reset'); await page.waitForTimeout(200);
  u = await ui(page);
  ok('Reset empties the range', u.options.length === 0 && !u.play, JSON.stringify({ n: u.options.length }));
  // hand-played moves: range grows with the game while "To" is at the end
  for (const [a, b] of [['e2', 'e4'], ['e7', 'e5'], ['g1', 'f3']]) await L.dragMove(page, a, b);
  u = await ui(page);
  ok('hand-played game: range covers the played plies and follows new moves', u.options.length === 3 && u.from === '1' && u.to === '3', JSON.stringify({ n: u.options.length, from: u.from, to: u.to }));
  // a hand-played game after Undo: undone plies are not offered
  await page.click('#undo'); await page.waitForTimeout(150);
  u = await ui(page);
  ok('after Undo, the undone ply is not part of the range', u.options.length === 2 && u.to === '2', JSON.stringify({ n: u.options.length, to: u.to }));
  ok('no page errors', errors.length === 0, JSON.stringify(errors));
  await browser.close();
  console.log(`==== range: ${results.filter(Boolean).length}/${results.length} passed ====`);
})();
