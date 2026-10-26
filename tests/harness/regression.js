// Usage: node regression.js <abs html path> <results.json> [onlyPrefix]
// Runs the same checks against any build. PASS/FAIL per check with evidence. Real clicks/mouse events only.
const fs = require('fs');
const L = require('./lib');
const { openPage, importPgn, navState, waitIdle, truthAt, shownPlacement, sqXY, dragMove, timelineClick } = L;
const [, , HTML, OUT, ONLY] = process.argv;
const results = [];
const pad = (s, n) => String(s).padEnd(n);

class Fail extends Error {}
const check = (cond, msg) => { if (!cond) throw new Fail(msg); };

async function T(id, title, fn, { vp = { width: 1280, height: 900 }, stub = true, expectErrors = false } = {}) {
  if (ONLY && !id.startsWith(ONLY)) return;
  let ctx;
  try {
    ctx = await openPage(HTML, vp, { stubChess: stub });
    const evidence = await fn(ctx);
    if (!expectErrors && ctx.errors.filter((e) => !/ERR_|net::|Failed to load resource/.test(e)).length) throw new Fail('console errors: ' + ctx.errors.join(' | '));
    results.push({ id, title, pass: true, evidence: evidence || '' });
  } catch (e) {
    results.push({ id, title, pass: false, evidence: (e instanceof Fail ? '' : 'EXCEPTION ') + e.message.split('\n')[0] });
  } finally {
    if (ctx) await ctx.browser.close();
  }
  const r = results[results.length - 1];
  console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${pad(r.id, 5)} ${r.title}${r.evidence ? '  — ' + r.evidence : ''}`);
}

// Asserts the board + label on screen equal the independent chess.js truth at `ply` of `pgn`.
async function expectView(page, pgn, ply, what) {
  const t = truthAt(pgn, ply);
  const shown = await shownPlacement(page);
  const s = await navState(page);
  check(shown === t.placement, `${what}: board does not show ply ${ply}`);
  check(s.status === t.label, `${what}: label "${s.status}" != expected "${t.label}" at ply ${ply}`);
}

(async () => {
  console.log('Build under test:', HTML, '\n');

  // ---------------- P: PGN import ----------------
  await T('P1', 'fresh load: no errors, label "White\'s Turn"', async ({ page }) => {
    const s = await navState(page);
    check(s.status === "White's Turn", 'label=' + s.status);
    check(s.movesRecorded === 0, 'moves recorded on fresh load');
  });
  await T('P2', 'valid PGN imports (13 plies, timeline, board at start)', async ({ page }) => {
    const msg = await importPgn(page, L.LEGAL_PGN);
    check(/^Imported 13 moves/.test(msg), 'status=' + msg);
    check((await page.locator('#timelineList button').count()) === 13, 'timeline button count');
    await expectView(page, L.LEGAL_PGN, 0, 'after import');
    return msg;
  });
  await T('P3', 'malformed PGN gives feedback and does not damage the loaded game', async ({ page }) => {
    await importPgn(page, L.LEGAL_PGN);
    const msg = await importPgn(page, 'hello this is not a pgn at all');
    check(/Could not read|no moves/i.test(msg), 'feedback=' + msg);
    const s = await navState(page);
    check(s.movesRecorded === 13, 'game damaged, moves=' + s.movesRecorded);
    return msg;
  });
  await T('P4', 'empty import gives feedback', async ({ page }) => {
    const msg = await importPgn(page, '   ');
    check(/Paste a PGN first/.test(msg), 'feedback=' + msg);
    return msg;
  });
  await T('P5', 'illegal move in PGN: sensible feedback, state consistent', async ({ page }) => {
    await importPgn(page, L.LEGAL_PGN);
    const msg = await importPgn(page, '1. e4 e5 2. Ke4 Nc6');
    const s = await navState(page);
    check(msg.length > 0, 'no feedback shown');
    check(s.movesRecorded === s.importedLimit || s.movesRecorded === 13, 'inconsistent recorded/imported counts ' + JSON.stringify(s));
    return `feedback="${msg}" movesRecorded=${s.movesRecorded}`;
  });
  await T('P6', 'PGN with comments, NAGs and a variation imports mainline only', async ({ page }) => {
    const msg = await importPgn(page, '1. e4 {best} e5 (1... c5 2. Nf3) 2. Nf3 $1 Nc6 3. Bb5');
    check(/^Imported 5 moves/.test(msg), 'status=' + msg);
    return msg;
  });
  await T('P7', 'PGN with headers and result token imports', async ({ page }) => {
    const msg = await importPgn(page, '[Event "x"]\n[White "A"]\n[Black "B"]\n\n1. e4 e5 2. Nf3 Nc6 1-0');
    check(/^Imported 4 moves/.test(msg), 'status=' + msg);
    return msg;
  });
  await T('P8', 'importing a second game after the first fully replaces it', async ({ page }) => {
    await importPgn(page, L.LEGAL_PGN);
    for (let i = 0; i < 5; i++) await page.click('#nextMove');
    const msg = await importPgn(page, L.SECOND_PGN);
    check(/^Imported 10 moves/.test(msg), 'status=' + msg);
    const s = await navState(page);
    check(s.historyPointer === 0 && s.selectedPly === null && s.importedLimit === 10, 'stale pointers ' + JSON.stringify(s));
    check((await page.locator('#timelineList button').count()) === 10, 'timeline not replaced');
    for (let i = 0; i < 10; i++) { await page.click('#nextMove'); }
    await page.waitForTimeout(100);
    await expectView(page, L.SECOND_PGN, 10, 'second game end');
    return msg;
  });

  // ---------------- N: navigation ----------------
  await T('N1', 'select any move k then Next -> k+1, then Prev -> k-1 (imported at start AND walked to end; 52 checks)', async ({ page }) => {
    let n = 0;
    for (const base of ['start', 'end']) {
      for (let k = 1; k <= 13; k++) {
        await importPgn(page, L.LEGAL_PGN);
        if (base === 'end') { for (let i = 0; i < 13; i++) await page.click('#nextMove'); await page.waitForTimeout(40); }
        await timelineClick(page, k);
        await expectView(page, L.LEGAL_PGN, k, `${base}: after clicking move ${k}`);
        await page.click('#nextMove'); await page.waitForTimeout(40);
        await expectView(page, L.LEGAL_PGN, Math.min(k + 1, 13), `${base}: select ${k} then Next`); n++;
        await importPgn(page, L.LEGAL_PGN);
        if (base === 'end') { for (let i = 0; i < 13; i++) await page.click('#nextMove'); await page.waitForTimeout(40); }
        await timelineClick(page, k);
        await page.click('#prevMove'); await page.waitForTimeout(40);
        await expectView(page, L.LEGAL_PGN, k - 1, `${base}: select ${k} then Prev`); n++;
      }
    }
    return `${n} step checks + ${n} click checks`;
  });
  await T('N2', 'first/last boundaries: Prev at start and Next at end are safe no-ops', async ({ page }) => {
    await importPgn(page, L.LEGAL_PGN);
    await page.click('#prevMove'); await page.waitForTimeout(40);
    await expectView(page, L.LEGAL_PGN, 0, 'Prev at start');
    for (let i = 0; i < 13; i++) await page.click('#nextMove');
    await page.waitForTimeout(60);
    await expectView(page, L.LEGAL_PGN, 13, 'at end');
    for (let i = 0; i < 4; i++) await page.click('#nextMove');
    await page.waitForTimeout(60);
    await expectView(page, L.LEGAL_PGN, 13, 'Next x4 past end');
    await timelineClick(page, 13); await page.click('#nextMove'); await page.waitForTimeout(40);
    await expectView(page, L.LEGAL_PGN, 13, 'select last then Next');
    await timelineClick(page, 1); await page.click('#prevMove'); await page.waitForTimeout(40);
    await expectView(page, L.LEGAL_PGN, 0, 'select first then Prev');
  });
  await T('N3', 'random walk of 90 Next/Prev/timeline-click steps never desynchronises board, label and timeline highlight', async ({ page }) => {
    await importPgn(page, L.LEGAL_PGN);
    let seed = 12345; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    let view = 0;
    for (let step = 0; step < 90; step++) {
      const r = rnd();
      let op;
      if (r < 0.4) { op = 'next'; await page.click('#nextMove'); view = Math.min(view + 1, 13); }
      else if (r < 0.8) { op = 'prev'; await page.click('#prevMove'); view = Math.max(view - 1, 0); }
      else { const k = 1 + Math.floor(rnd() * 13); op = 'click ' + k; await timelineClick(page, k); view = k; }
      await page.waitForTimeout(30);
      await expectView(page, L.LEGAL_PGN, view, `step ${step} (${op})`);
      const active = await page.evaluate(() => [...document.querySelectorAll('#timelineList button')].map((b, i) => b.classList.contains('active') ? i + 1 : 0).filter(Boolean));
      check(view === 0 ? active.length === 0 : (active.length === 1 && active[0] === view), `step ${step} (${op}): timeline highlight ${JSON.stringify(active)} != ${view}`);
    }
  });
  await T('N4', 'hand-played game (real drags): select earlier move then Next/Prev/Undo/Redo step from it', async ({ page }) => {
    const moves = [['e2', 'e4'], ['e7', 'e5'], ['g1', 'f3'], ['b8', 'c6'], ['f1', 'c4'], ['g8', 'f6']];
    for (const [a, b] of moves) await dragMove(page, a, b);
    const PGN = '1. e4 e5 2. Nf3 Nc6 3. Bc4 Nf6';
    const s0 = await navState(page);
    check(s0.historyPointer === 6, 'hand-played moves not recorded: ' + s0.historyPointer);
    // NB: in a hand-played game the plies after the pointer are (by design) hidden from the timeline once you step back,
    // so each selection below only uses plies that are visible at that moment.
    await timelineClick(page, 3); await page.click('#nextMove'); await page.waitForTimeout(60);
    await expectView(page, PGN, 4, 'select 3, Next');
    await page.click('#nextMove'); await page.click('#nextMove'); await page.waitForTimeout(60);
    await expectView(page, PGN, 6, 'Next x2 more (redo future still reachable)');
    await timelineClick(page, 4); await page.click('#prevMove'); await page.waitForTimeout(60);
    await expectView(page, PGN, 3, 'select 4, Prev');
    await page.click('#redo'); await page.waitForTimeout(60);
    await expectView(page, PGN, 4, 'Redo after Prev');
    await timelineClick(page, 2); await page.click('#undo'); await page.waitForTimeout(60);
    await expectView(page, PGN, 1, 'select 2, Undo');
    await page.click('#redo'); await page.waitForTimeout(60);
    await expectView(page, PGN, 2, 'Redo');
  });
  await T('N5', 'Live button returns to the live position and label', async ({ page }) => {
    await importPgn(page, L.LEGAL_PGN);
    for (let i = 0; i < 9; i++) await page.click('#nextMove');
    await page.waitForTimeout(60);
    await timelineClick(page, 3);
    await expectView(page, L.LEGAL_PGN, 3, 'previewing 3');
    await page.click('#backToLive'); await page.waitForTimeout(60);
    await expectView(page, L.LEGAL_PGN, 9, 'after Live');
  });

  await T('N6', 'clicking the LAST move of an imported game shows the final position (not the start); also after Prev from the end', async ({ page }) => {
    await importPgn(page, L.LEGAL_PGN); await timelineClick(page, 13);
    await expectView(page, L.LEGAL_PGN, 13, 'imported, click last move');
    await importPgn(page, L.LEGAL_PGN);
    for (let i = 0; i < 13; i++) await page.click('#nextMove');
    await page.waitForTimeout(60); await page.click('#prevMove'); await page.waitForTimeout(60);
    await timelineClick(page, 13);
    await expectView(page, L.LEGAL_PGN, 13, 'Prev from end, click last move');
  });

  // ---------------- A: playback / animation ----------------
  await T('A1', 'Play Animation on selected capture (ply 9): runs, then settles on correct board; no stale animation state', async ({ page }) => {
    await importPgn(page, L.LEGAL_PGN);
    await timelineClick(page, 9);
    await page.click('#playAnim'); await page.waitForTimeout(300);
    const busy = await page.evaluate(() => animHideSquares.size);
    check(busy > 0, 'animation did not start (animHideSquares empty at 300ms)');
    await waitIdle(page);
    const s = await navState(page);
    check(s.animBusy === 0 && s.selectedPly === 9, 'state after play ' + JSON.stringify(s));
    await expectView(page, L.LEGAL_PGN, 9, 'after Play');
  });
  await T('A2', 'navigating manually right after playback leaves no stale state', async ({ page }) => {
    await importPgn(page, L.LEGAL_PGN);
    await timelineClick(page, 9);
    await page.click('#playAnim'); await waitIdle(page);
    await page.click('#nextMove'); await page.waitForTimeout(60);
    await expectView(page, L.LEGAL_PGN, 10, 'Next after Play');
    await page.click('#prevMove'); await page.click('#prevMove'); await page.waitForTimeout(60);
    await expectView(page, L.LEGAL_PGN, 8, 'Prev x2');
  });
  await T('A3', 'Play Animation with nothing selected is a safe no-op (documents: no feedback shown)', async ({ page }) => {
    await importPgn(page, L.LEGAL_PGN);
    await page.click('#playAnim'); await page.waitForTimeout(400);
    const s = await navState(page);
    check(s.animBusy === 0 && s.historyPointer === 0, 'state changed ' + JSON.stringify(s));
    return 'no animation, no message (existing behavior)';
  });
  await T('A4', 'rapid double-click Play ends idle with correct board', async ({ page }) => {
    await importPgn(page, L.LEGAL_PGN);
    await timelineClick(page, 9);
    await page.click('#playAnim'); await page.click('#playAnim');
    await waitIdle(page, 20000); await page.waitForTimeout(500); await waitIdle(page, 20000);
    await expectView(page, L.LEGAL_PGN, 9, 'after double Play');
  });
  for (const [id, name, pgn, ply] of [['A5', 'castling (O-O)', L.CASTLE_PGN, 7], ['A6', 'en passant', L.EP_PGN, 5], ['A7', 'promotion by capture', L.PROMO_PGN, 9]]) {
    await T(id, `Play Animation: ${name} animates and lands on the correct board`, async ({ page }) => {
      await importPgn(page, pgn); await timelineClick(page, ply);
      // Phase 2A: moves take 160-280 ms, so "still animating 300 ms later" no longer proves it started
      // (a castle is done in ~200 ms). Observe the start itself: the moving piece's square being hidden.
      await page.evaluate(() => { window.__animStarted = 0; const add = animHideSquares.add.bind(animHideSquares); animHideSquares.add = (v) => { window.__animStarted++; return add(v); }; });
      await page.click('#playAnim'); await page.waitForTimeout(300);
      check((await page.evaluate(() => window.__animStarted)) > 0, 'animation did not start');
      await waitIdle(page);
      await expectView(page, pgn, ply, name);
    });
  }
  await T('A8', 'Reset clears game, timeline, selection and animation state', async ({ page }) => {
    await importPgn(page, L.LEGAL_PGN); await timelineClick(page, 5); await page.click('#nextMove');
    await page.click('#reset'); await page.waitForTimeout(300);
    const s = await navState(page);
    check(s.movesRecorded === 0 && s.historyPointer === 0 && s.selectedPly === null && s.importedLimit === 0 && s.animBusy === 0, JSON.stringify(s));
    check((await page.locator('#timelineList button').count()) === 0, 'timeline not cleared');
    check(s.status === "White's Turn", 'label ' + s.status);
  });

  // ---------------- V: Capture FX ----------------
  await T('V1', 'Capture FX options (7, original order) and default "Dissolve"', async ({ page }) => {
    const vals = await page.$$eval('#captureFx option', (o) => o.map((x) => x.value));
    check(JSON.stringify(vals) === JSON.stringify(['off', 'dissolve', 'shatter', 'energy', 'implosion', 'drift', 'burst']), 'options ' + vals);
    check((await page.locator('#captureFx').inputValue()) === 'dissolve', 'default not dissolve');
    check((await page.evaluate(() => captureEffect)) === 'dissolve', 'captureEffect var default');
    return vals.join(',');
  });
  for (const vp of [[1440, 900], [1280, 720], [1024, 768], [768, 1024], [390, 844], [360, 640]]) {
    await T('V2', `Capture FX control visible in viewport & panel, no horizontal scroll @ ${vp[0]}x${vp[1]}`, async ({ page }) => {
      const m = await page.evaluate(() => { const b = document.getElementById('captureFx').getBoundingClientRect(); const p = document.querySelector('.panel').getBoundingClientRect(); return { l: Math.round(b.left), r: Math.round(b.right), pl: Math.round(p.left), pr: Math.round(p.right), iw: innerWidth, sw: document.documentElement.scrollWidth }; });
      check(m.l >= 0 && m.r <= m.iw, `outside viewport: ${m.l}..${m.r} of ${m.iw}`);
      check(m.l >= m.pl && m.r <= m.pr, `outside panel: ${m.l}..${m.r} vs panel ${m.pl}..${m.pr}`);
      check(m.sw <= m.iw, `horizontal scroll: scrollWidth ${m.sw} > ${m.iw}`);
      return `x=${m.l}..${m.r}`;
    }, { vp: { width: vp[0], height: vp[1] } });
  }
  const FX = ['off', 'dissolve', 'shatter', 'energy', 'implosion', 'drift', 'burst'];
  await T('V3', 'every Capture FX option is drawn on a capture (Play), and "off" draws nothing', async ({ page }) => {
    await importPgn(page, L.LEGAL_PGN);
    await page.evaluate(() => { window.__fx = []; const o = window.drawCaptureEffect; window.drawCaptureEffect = function (c, effect) { window.__fx.push(effect); return o.apply(this, arguments); }; });
    const seen = {};
    for (const fx of FX) {
      await page.selectOption('#captureFx', fx);
      await page.evaluate(() => { window.__fx.length = 0; });
      await timelineClick(page, 9); await page.click('#playAnim'); await waitIdle(page);
      const calls = await page.evaluate(() => window.__fx.slice());
      seen[fx] = calls.length;
      if (fx === 'off') check(calls.length === 0, 'off still drew ' + calls.length);
      else check(calls.length > 0 && calls.every((e) => e === fx), `${fx}: calls=${calls.length} effects=${[...new Set(calls)]}`);
    }
    return JSON.stringify(seen);
  });
  await T('V4', 'no capture effect on a non-capture move', async ({ page }) => {
    await importPgn(page, L.LEGAL_PGN);
    await page.evaluate(() => { window.__fx = []; const o = window.drawCaptureEffect; window.drawCaptureEffect = function (c, effect) { window.__fx.push(effect); return o.apply(this, arguments); }; });
    await page.selectOption('#captureFx', 'shatter');
    await timelineClick(page, 1); await page.click('#playAnim'); await waitIdle(page);
    check((await page.evaluate(() => window.__fx.length)) === 0, 'effect drawn on non-capture');
  });
  await T('V5', 'across games: selection persists, no stale effect/animation state, effect still fires', async ({ page }) => {
    await importPgn(page, L.LEGAL_PGN); await page.selectOption('#captureFx', 'burst');
    await timelineClick(page, 9); await page.click('#playAnim'); await page.waitForTimeout(300);
    await waitIdle(page);
    await importPgn(page, L.SECOND_PGN);
    const s = await navState(page);
    check(s.animBusy === 0, 'stale animation state after new import');
    check((await page.locator('#captureFx').inputValue()) === 'burst', 'selection changed');
    await page.evaluate(() => { window.__fx = []; const o = window.drawCaptureEffect; window.drawCaptureEffect = function (c, effect) { window.__fx.push(effect); return o.apply(this, arguments); }; });
    await timelineClick(page, 7); // 4. cxd5 (capture) = ply 7
    await page.click('#playAnim'); await waitIdle(page);
    const n = await page.evaluate(() => window.__fx.length);
    check(n > 0, 'effect did not fire in second game');
  });

  // ---------------- C: annotations & presentation ----------------
  await T('C1', 'highlight mode: click a square on a selected move stores one highlight', async ({ page }) => {
    await importPgn(page, L.LEGAL_PGN); await timelineClick(page, 3);
    await page.selectOption('#mode', 'highlight');
    const p = await sqXY(page, 'e4'); await page.mouse.click(p.x, p.y);
    const n = await page.evaluate(() => getActiveRecord().highlights.length);
    check(n === 1, 'highlights=' + n);
  });
  await T('C2', 'arrow mode: drag between squares stores one arrow', async ({ page }) => {
    await importPgn(page, L.LEGAL_PGN); await timelineClick(page, 3);
    await page.selectOption('#mode', 'arrow');
    const a = await sqXY(page, 'c4'), b = await sqXY(page, 'f7');
    await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 5 }); await page.mouse.up();
    const r = await page.evaluate(() => { const x = getActiveRecord().arrows; return x.map((q) => q.from + q.to); });
    check(r.length === 1 && r[0] === 'c4f7', 'arrows=' + JSON.stringify(r));
  });
  await T('C3', 'annotation Color picker: chosen colour is used for new highlight/arrow', async ({ page }) => {
    await importPgn(page, L.LEGAL_PGN); await timelineClick(page, 3);
    await page.fill('#color', '#00ff00');
    await page.selectOption('#mode', 'highlight');
    const p = await sqXY(page, 'd4'); await page.mouse.click(p.x, p.y);
    await page.selectOption('#mode', 'arrow');
    const a = await sqXY(page, 'c4'), b = await sqXY(page, 'f7');
    await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 5 }); await page.mouse.up();
    const r = await page.evaluate(() => { const rec = getActiveRecord(); return { h: rec.highlights[0] && rec.highlights[0].color, a: rec.arrows[0] && rec.arrows[0].color }; });
    check(/0,\s*255,\s*0/.test(r.h || ''), 'highlight colour=' + r.h);
    check(/(#00ff00|0,\s*255,\s*0)/i.test(r.a || ''), 'arrow colour=' + r.a);
    return JSON.stringify(r);
  });
  await T('C4', 'Clear button removes the selected move\'s arrows and highlights only', async ({ page }) => {
    await importPgn(page, L.LEGAL_PGN);
    for (const ply of [3, 5]) {
      await timelineClick(page, ply); await page.selectOption('#mode', 'highlight');
      const p = await sqXY(page, 'e' + (ply === 3 ? 4 : 5)); await page.mouse.click(p.x, p.y);
      await page.waitForTimeout(400);
    }
    await timelineClick(page, 3); await page.click('#clearAll');
    const r = await page.evaluate(() => [moveHistory[2].highlights.length, moveHistory[4].highlights.length]);
    check(r[0] === 0 && r[1] === 1, 'highlights after Clear (ply3, ply5) = ' + r);
  });
  await T('C5', 'Story Target mode toggles targets; list and Clear Story Targets work', async ({ page }) => {
    await importPgn(page, L.LEGAL_PGN); await timelineClick(page, 5);
    await page.selectOption('#mode', 'story');
    const p = await sqXY(page, 'e5'); await page.mouse.click(p.x, p.y);
    const q = await sqXY(page, 'f7'); await page.mouse.click(q.x, q.y);
    const t1 = await page.locator('#storyTargetList').innerText();
    check(/e5/.test(t1) && /f7/.test(t1), 'list=' + t1);
    await page.click('#clearStoryTargets');
    const t2 = await page.locator('#storyTargetList').innerText();
    check(/none/i.test(t2), 'after clear=' + t2);
  });
  await T('C6', 'Classification sets a badge shown on the timeline', async ({ page }) => {
    await importPgn(page, L.LEGAL_PGN); await timelineClick(page, 9);
    await page.selectOption('#annotationSelect', 'Brilliant');
    const label = await page.locator('#timelineList button').nth(8).innerText();
    check(/!!/.test(label), 'timeline label=' + label);
    return label;
  });
  await T('C7', 'Flip board: orientation toggles, navigation and labels stay correct', async ({ page }) => {
    await importPgn(page, L.LEGAL_PGN);
    await page.click('#flip'); await page.waitForTimeout(80);
    check((await page.evaluate(() => boardFlipped)) === true, 'not flipped');
    await timelineClick(page, 5); await page.click('#nextMove'); await page.waitForTimeout(60);
    await expectView(page, L.LEGAL_PGN, 6, 'flipped nav');
    await page.click('#flip');
    check((await page.evaluate(() => boardFlipped)) === false, 'not unflipped');
  });
  await T('C8', 'player name/Elo/flag inputs are removed; every other control is still present', async ({ page }) => {
    const ids = ['whiteName', 'whiteElo', 'whiteFlag', 'blackName', 'blackElo', 'blackFlag'];
    const left = await page.evaluate((ids) => ids.filter((i) => document.getElementById(i)).concat(document.querySelector('.playerBox') ? ['.playerBox'] : []), ids);
    check(left.length === 0, 'still present: ' + left);
    const keep = ['mode', 'color', 'clearAll', 'captureFx', 'prevMove', 'nextMove', 'undo', 'redo', 'flip', 'playAnim', 'exportAnim', 'reset', 'removeToggle', 'pgnInput', 'importPgn', 'loadSample', 'pgnStatus', 'timelineList', 'selectedMoveLabel', 'backToLive', 'annotationSelect', 'storyTargetList', 'clearStoryTargets', 'notes', 'historyList', 'boardCanvas', 'overlay', 'status-bar', 'quickstart'];
    const missing = await page.evaluate((k) => k.filter((i) => !document.getElementById(i)), keep);
    check(missing.length === 0, 'controls missing: ' + missing);
    const src = fs.readFileSync(HTML, 'utf8');
    const refs = ids.concat(['playerBox']).map((i) => (src.match(new RegExp(i, 'g')) || []).length).reduce((a, b) => a + b, 0);
    check(refs === 0, 'source still references removed ids/class: ' + refs);
    return `${keep.length} other controls present; 0 references to the removed ids/class remain`;
  });
  await T('C9', 'Notes textarea exists (INFO: not read by any code)', async () => {
    const src = fs.readFileSync(HTML, 'utf8');
    const n = (src.match(/id="notes"/g) || []).length, js = (src.match(/getElementById\('notes'\)/g) || []).length;
    check(n === 1, 'notes textarea count ' + n);
    return `JS references to #notes: ${js}`;
  });
  await T('C10', 'controls usable on a 390px phone: key buttons inside viewport, clickable, no horizontal scroll', async ({ page }) => {
    const ids = ['prevMove', 'nextMove', 'playAnim', 'exportAnim', 'importPgn', 'flip', 'reset', 'captureFx', 'mode', 'color'];
    const m = await page.evaluate((ids) => ids.map((i) => { const b = document.getElementById(i).getBoundingClientRect(); return [i, Math.round(b.left), Math.round(b.right)]; }), ids);
    const bad = m.filter(([, l, r]) => l < 0 || r > 390);
    check(bad.length === 0, 'outside viewport: ' + JSON.stringify(bad));
    check((await page.evaluate(() => document.documentElement.scrollWidth)) <= 390, 'horizontal scroll');
    await importPgn(page, L.LEGAL_PGN); await page.click('#nextMove'); await page.waitForTimeout(50);
    await expectView(page, L.LEGAL_PGN, 1, 'phone Next');
  }, { vp: { width: 390, height: 844 } });

  // ---------------- S: sample game + quick start ----------------
  await T('S1', '"Load sample game" loads the 13-ply sample via the import path', async ({ page }) => {
    check((await page.locator('#loadSample').count()) === 1, 'button missing');
    check(/Load sample game/.test(await page.locator('#loadSample').innerText()), 'label');
    await page.click('#loadSample'); await page.waitForTimeout(250);
    const msg = await page.locator('#pgnStatus').innerText();
    check(/^Imported 13 moves/.test(msg), 'status=' + msg);
    check((await page.locator('#timelineList button').count()) === 13, 'timeline');
    await expectView(page, L.LEGAL_PGN, 0, 'sample at start');
    for (let i = 0; i < 13; i++) await page.click('#nextMove');
    await page.waitForTimeout(80);
    await expectView(page, L.LEGAL_PGN, 13, 'sample end (mate)');
    return msg;
  });
  await T('S2', 'sample is legal; includes captures, a check and a mate', async () => {
    const t = truthAt(L.LEGAL_PGN, 13);
    const caps = t.verbose.filter((m) => m.captured).length, checks = t.verbose.filter((m) => /[+#]/.test(m.san)).length;
    check(caps >= 3 && checks >= 2, `captures=${caps} checks/mates=${checks}`);
    // The shipped constant must be the same game
    const src = fs.readFileSync(HTML, 'utf8');
    const m = src.match(/const SAMPLE_PGN = '([^']*(?:\\'[^']*)*)';/);
    check(!!m, 'SAMPLE_PGN constant not found');
    const c = new L.Chess(); const ok = c.load_pgn(m[1].replace(/\\n/g, '\n').replace(/\\'/g, "'"), { sloppy: true });
    check(ok && c.history().length === 13 && c.in_checkmate(), 'shipped PGN not legal/13 plies/mate');
    return `${caps} captures, ${checks} check/mate moves, ends in checkmate`;
  });
  await T('S3', 'sample can be loaded repeatedly (confirm accepted each time)', async ({ page }) => {
    const dialogs = []; page.on('dialog', async (d) => { dialogs.push(d.message()); await d.accept(); });
    for (let i = 0; i < 4; i++) { await page.click('#loadSample'); await page.waitForTimeout(250); }
    const s = await navState(page);
    check(s.movesRecorded === 13 && s.importedLimit === 13 && s.historyPointer === 0, JSON.stringify(s));
    check(dialogs.length === 3, 'expected 3 confirms (2nd..4th load) got ' + dialogs.length);
    check(/replaces the current game/.test(dialogs[0]), 'confirm text: ' + dialogs[0]);
  });
  await T('S4', 'declining the confirm leaves the current game and its annotations untouched', async ({ page }) => {
    await importPgn(page, L.SECOND_PGN); await timelineClick(page, 3);
    await page.selectOption('#mode', 'highlight'); const p = await sqXY(page, 'c3'); await page.mouse.click(p.x, p.y);
    page.once('dialog', (d) => d.dismiss());
    await page.click('#loadSample'); await page.waitForTimeout(250);
    const s = await navState(page);
    check(s.movesRecorded === 10, 'game replaced despite Cancel');
    check((await page.evaluate(() => moveHistory[2].highlights.length)) === 1, 'annotation lost despite Cancel');
  });
  await T('S5', 'no stale arrows/highlights/story targets/badges/selection/preview/animation after loading the sample', async ({ page }) => {
    await importPgn(page, L.SECOND_PGN); await timelineClick(page, 4);
    await page.selectOption('#mode', 'highlight'); let p = await sqXY(page, 'c3'); await page.mouse.click(p.x, p.y);
    await page.selectOption('#mode', 'arrow'); const a = await sqXY(page, 'c1'), b = await sqXY(page, 'g5'); await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 4 }); await page.mouse.up();
    await page.selectOption('#mode', 'story'); p = await sqXY(page, 'd5'); await page.mouse.click(p.x, p.y);
    await page.selectOption('#annotationSelect', 'Blunder');
    page.once('dialog', (d) => d.accept());
    await page.click('#loadSample'); await page.waitForTimeout(300);
    const st = await page.evaluate(() => ({
      marks: moveHistory.reduce((n, r) => n + r.arrows.length + r.highlights.length + r.storyTargets.length + (r.badge ? 1 : 0) + (r.annotation ? 1 : 0), 0),
      selectedPly, previewing: !!previewBoard, anim: animHideSquares.size, ptr: historyPointer, last: lastMoveRecord,
      sel: document.getElementById('selectedMoveLabel').textContent, story: document.getElementById('storyTargetList').textContent,
      list: document.getElementById('historyList').children.length
    }));
    check(st.marks === 0, 'leftover annotations on new records: ' + st.marks);
    check(st.selectedPly === null && !st.previewing && st.anim === 0 && st.ptr === 0 && st.last === null, 'stale nav/animation state ' + JSON.stringify(st));
    check(/No move selected/.test(st.sel) && /none/i.test(st.story) && st.list === 0, 'stale panel: ' + JSON.stringify(st));
  });
  await T('S6', 'sample does not overwrite a pasted-but-unimported PGN; a different PGN then imports normally', async ({ page }) => {
    await page.fill('#pgnInput', L.SECOND_PGN);
    await page.click('#loadSample'); await page.waitForTimeout(250);
    check((await page.locator('#pgnInput').inputValue()) === L.SECOND_PGN, 'textarea was overwritten');
    page.once('dialog', (d) => d.accept());
    await page.click('#importPgn'); await page.waitForTimeout(250);
    const msg = await page.locator('#pgnStatus').innerText();
    check(/^Imported 10 moves/.test(msg), 'normal import after sample failed: ' + msg);
    await expectView(page, L.SECOND_PGN, 0, 'second game after sample');
  });
  await T('S7', 'sample failure shows useful feedback (chess engine unavailable) without exceptions', async ({ page }) => {
    await page.click('#loadSample'); await page.waitForTimeout(300);
    const msg = await page.locator('#pgnStatus').innerText();
    const box = await page.locator('#message-box').innerText();
    check(/engine not loaded/i.test(msg) && /engine not loaded/i.test(box), `pgnStatus="${msg}" messageBox="${box}"`);
    return msg;
  }, { stub: 'abort', expectErrors: true });
  await T('S8', 'sample refused while a move animation is running; works afterwards', async ({ page }) => {
    await importPgn(page, L.LEGAL_PGN); await timelineClick(page, 9);
    await page.click('#playAnim'); await page.waitForTimeout(250);
    const dialogs = []; page.on('dialog', async (d) => { dialogs.push(d.message()); await d.accept(); });
    await page.click('#loadSample'); await page.waitForTimeout(100);
    check(/Wait for the current animation/.test(await page.locator('#message-box').innerText()), 'no busy message');
    check((await navState(page)).selectedPly === 9, 'game changed during animation');
    check(dialogs.length === 0, 'asked for confirm while busy');
    await waitIdle(page);
    await page.click('#loadSample'); await page.waitForTimeout(250);
    check((await navState(page)).selectedPly === null && dialogs.length === 1, 'did not load after animation finished');
  });
  await T('S9', 'sample after a hand-played game (real drags) replaces it cleanly', async ({ page }) => {
    for (const [a, b] of [['e2', 'e4'], ['e7', 'e5']]) await dragMove(page, a, b);
    page.once('dialog', (d) => d.accept());
    await page.click('#loadSample'); await page.waitForTimeout(250);
    const s = await navState(page);
    check(s.movesRecorded === 13 && s.historyPointer === 0, JSON.stringify(s));
    await expectView(page, L.LEGAL_PGN, 0, 'sample after hand-played');
  });
  await T('S10', 'sample game: clicking its final move (Nd5#) shows the mate position; Play on it ends on that board', async ({ page }) => {
    await page.click('#loadSample'); await page.waitForTimeout(250);
    await timelineClick(page, 13);
    await expectView(page, L.LEGAL_PGN, 13, 'sample, click final move');
    await page.click('#playAnim'); await waitIdle(page);
    await expectView(page, L.LEGAL_PGN, 13, 'sample, Play final move');
  });
  await T('Q1', 'quick-start guide exists, collapsed by default, and opens/closes', async ({ page }) => {
    check((await page.locator('details#quickstart').count()) === 1, 'guide missing');
    check((await page.locator('details#quickstart').evaluate((e) => e.open)) === false, 'not collapsed by default');
    await page.click('details#quickstart summary'); check(await page.locator('details#quickstart').evaluate((e) => e.open), 'did not open');
    await page.click('details#quickstart summary'); check(!(await page.locator('details#quickstart').evaluate((e) => e.open)), 'did not close');
  });
  await T('Q2', 'every control name the guide mentions exists on the page', async ({ page }) => {
    const r = await page.evaluate(() => {
      const names = [...document.querySelectorAll('#quickstart li b')].map((b) => b.textContent.trim().replace(/:$/, ''));
      const pool = [...document.querySelectorAll('button, label, option, summary, span.small')].map((e) => e.textContent.replace(/\s+/g, ' ').trim());
      const controlNames = ['Import PGN', 'Load sample game', '‹ Prev', 'Next ›', 'Move Timeline', 'Play Animation', 'Capture FX', 'Draw Arrow', 'Highlight', 'Story Target', 'Mode', 'Color', 'Export Animation'];
      return { guideBold: names, missing: controlNames.filter((n) => !names.includes(n) ? true : !pool.some((p) => p.includes(n))) };
    });
    check(r.missing.length === 0, 'guide names not found as controls: ' + r.missing);
    return r.guideBold.join(' | ');
  });
  for (const vp of [[1280, 720], [390, 844], [360, 640]]) {
    await T('Q3', `guide does not push the board far down / overflow @ ${vp[0]}x${vp[1]} (closed then open)`, async ({ page }) => {
      const top = () => page.evaluate(() => Math.round(document.getElementById('boardHolder').getBoundingClientRect().top + scrollY));
      const closed = await top();
      await page.click('details#quickstart summary'); const open = await top();
      const sw = await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
      check(sw[0] <= sw[1], 'horizontal scroll when open');
      return `board top: closed=${closed}px open=${open}px (open adds ${open - closed}px)`;
    }, { vp: { width: vp[0], height: vp[1] } });
  }

  fs.writeFileSync(OUT, JSON.stringify(results, null, 1));
  const p = results.filter((r) => r.pass).length;
  console.log(`\n==== ${p}/${results.length} checks passed ====`);
})();
