// Usage: [EXPORT_MODE=fallback] node flip_guard_test.js <html>
// Board flip while an export is running. An export fixes its piece paths and camera when it starts but
// draws the static pieces with the current orientation on every frame, so a flip mid-export used to give a
// file whose later frames mix orientations. Flip (button or the F key) must be refused while an export
// runs, every encoded frame must keep one orientation, and Flip must work again afterwards.
const L = require('./lib');
const B = require('./p2b_lib');
const [, , HTML] = process.argv;
const FALLBACK = process.env.EXPORT_MODE === 'fallback';
const results = [];
const ok = (name, pass, detail) => { results.push(pass); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name} — ${detail}`); };
const mirror = (sq) => 'abcdefgh'[7 - 'abcdefgh'.indexOf(sq[0])] + (9 - +sq[1]);

// Orientation of each encoded frame's STATIC pieces against chess.js truth ('normal' | 'mirrored' | 'other').
// The probe names squares by unflipped board coordinates; the moving piece's squares are left out.
function orientations(frames, tr, plan) {
  return frames.map((f, n) => {
    const at = B.frameAt(plan, n), mv = tr.moves[at.ply - 1];
    const strip = (m) => { const o = { ...m }; for (const sq of [mv.from, mv.to, mirror(mv.from), mirror(mv.to)]) delete o[sq]; return o; };
    const got = {}; for (const s of f.statics) { const [p, sq] = s.split('@'); got[sq] = p; }
    const gotMirrored = {}; for (const [sq, p] of Object.entries(got)) gotMirrored[mirror(sq)] = p;
    const want = strip(at.moving ? tr.before[at.ply - 1] : tr.after[at.ply - 1]);
    return B.samePlacement(strip(got), want) ? 'normal' : B.samePlacement(strip(gotMirrored), want) ? 'mirrored' : 'other';
  });
}
const count = (a) => a.reduce((m, o) => ((m[o] = (m[o] || 0) + 1), m), {});
const flipState = (page) => page.evaluate(() => ({ flipped: boardFlipped, exporting: exportInProgress, msg: document.getElementById('message-box').innerText }));

// Starts an export with `button`, tries Flip (click, then the F key) while it runs, and waits for the end.
async function flipDuringExport(page, button, startFlipped) {
  const dl = page.waitForEvent('download', { timeout: 300000 });
  await page.click(button);
  await page.waitForFunction(() => exportInProgress && (!window.__X || window.__X.frames.length >= 20), null, { timeout: 60000, polling: 5 });
  await page.click('#flip');
  const afterClick = await flipState(page);
  await page.locator('body').click({ position: { x: 5, y: 5 } }); await page.keyboard.press('f');
  const afterKey = await flipState(page);
  const d = await dl; await page.waitForFunction(() => !exportInProgress);
  const refused = afterClick.exporting && afterKey.exporting && afterClick.flipped === startFlipped && afterKey.flipped === startFlipped && /Wait for the export to finish/.test(afterClick.msg);
  return { d, afterClick, afterKey, refused };
}

(async () => {
  console.log('mode:', FALLBACK ? 'MediaRecorder fallback' : 'WebCodecs');
  const tr = B.truth(L.LEGAL_PGN);
  // 1. Flip works normally when nothing is exporting, and is refused during a sequence export
  for (const startFlipped of [false, true]) {
    const tag = startFlipped ? 'board flipped before export' : 'board unflipped';
    const { browser, page, errors } = await L.openPage(HTML, { width: 1280, height: 900 });
    await L.importPgn(page, L.LEGAL_PGN); await B.chooseRange(page, 1, 13);
    await page.click('#flip'); const idle1 = await flipState(page);
    if (!startFlipped) { await page.click('#flip'); }
    const idle2 = await flipState(page);
    ok(`${tag}: Flip works when no export is running`, idle1.flipped === true && idle2.flipped === startFlipped, JSON.stringify([idle1.flipped, idle2.flipped]));
    if (!FALLBACK) await B.installExportProbe(page);
    const r = await flipDuringExport(page, '#exportSequence', startFlipped);
    ok(`${tag}: Flip (button and F key) refused during a sequence export, with a message`, r.refused, JSON.stringify({ click: r.afterClick, key: r.afterKey }));
    if (!FALLBACK) {
      const frames = await page.evaluate(() => window.__X.frames), plan = B.expectedPlan(tr, 1, 13);
      const o = count(orientations(frames, tr, plan)), want = startFlipped ? 'mirrored' : 'normal';
      ok(`${tag}: every encoded frame keeps one orientation (${want})`, frames.length === plan.totalFrames && o[want] === plan.totalFrames, `${frames.length}/${plan.totalFrames} frames ${JSON.stringify(o)}`);
    }
    ok(`${tag}: the export still completes (one file)`, r.d.suggestedFilename() === 'sequence_ply1-13.webm', r.d.suggestedFilename());
    await page.click('#flip'); const after = await flipState(page);
    ok(`${tag}: Flip works again after the export`, after.flipped === !startFlipped, JSON.stringify(after));
    ok(`${tag}: no page errors`, errors.length === 0, JSON.stringify(errors));
    await browser.close();
  }
  // 2. Single-move export
  {
    const { browser, page, errors } = await L.openPage(HTML, { width: 1280, height: 900 });
    await L.importPgn(page, L.LEGAL_PGN); await L.timelineClick(page, 9);
    const r = await flipDuringExport(page, '#exportAnim', false);
    ok('single-move export: Flip refused while it runs, export completes', r.refused && r.d.suggestedFilename() === 'move_f3_to_e5.webm', JSON.stringify({ click: r.afterClick.flipped, key: r.afterKey.flipped, file: r.d.suggestedFilename() }));
    await page.click('#flip');
    ok('single-move export: Flip works again afterwards', (await flipState(page)).flipped === true && errors.length === 0, JSON.stringify(errors));
    await browser.close();
  }
  // 3. Cancel releases the guard
  {
    const { browser, page } = await L.openPage(HTML, { width: 1280, height: 900 });
    await L.importPgn(page, L.LEGAL_PGN); await B.chooseRange(page, 1, 13);
    await page.click('#exportSequence');
    await page.waitForFunction(() => /Exporting… [1-9]\d?%/.test(document.getElementById('exportSequence').textContent), null, { timeout: 30000 });
    await page.click('#flip'); const during = await flipState(page);
    await page.click('#cancelExport'); await page.waitForFunction(() => !exportInProgress);
    await page.click('#flip'); const after = await flipState(page);
    ok('cancelled export: Flip refused before Cancel, works after it', during.flipped === false && after.flipped === true, JSON.stringify({ during: during.flipped, after: after.flipped }));
    await browser.close();
  }
  // 4. Sequence playback keeps its own guard (unchanged)
  {
    const { browser, page } = await L.openPage(HTML, { width: 1280, height: 900 });
    await L.importPgn(page, L.LEGAL_PGN); await B.chooseRange(page, 1, 4);
    await page.click('#playSequence'); await page.waitForTimeout(300);
    await page.click('#flip'); const during = await flipState(page);
    const msg = await page.evaluate(() => document.getElementById('message-box').innerText);
    await page.click('#stopSequence');
    ok('sequence playback: Flip still refused with "Stop the sequence first."', during.flipped === false && /Stop the sequence first/.test(msg), JSON.stringify({ flipped: during.flipped, msg }));
    await browser.close();
  }
  console.log(`==== flip guard: ${results.filter(Boolean).length}/${results.length} passed ====`);
})();
