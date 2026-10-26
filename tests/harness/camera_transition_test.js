// Usage: node camera_transition_test.js <html> [referenceHtml]
// Export camera between moves of a sequence (Phase 3A). Each case is exported by the build under test and
// by a reference build (default: Phase 2C, a18ff63, read from git history), and the two are compared frame
// by frame. Camera geometry is compared separately from pixels: the camera is the source rectangle of the
// export's final crop (working canvas -> 1080 canvas), in logical board px (0..600).
//
// The rule under test (agreed for Phase 3A): where the reference cuts from move k's framing to move k+1's,
// the camera eases instead, over the LAST N frames of move k's hold, reaching move k+1's framing exactly on
// k+1's first frame (no frame is added, no movement is overlapped). N = min(8, floor(still / 2)), where
// `still` counts move k's hold frames after the landing frame on which the reference camera is already at
// rest at its final framing, so at least half of that still view remains; with N < 3 the cut is kept.
// 8 in-between frames = 9 steps = 300 ms at 30 fps. Everything outside those windows, the pieces and the
// timing are unchanged from the reference.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const L = require('./lib');
const B = require('./p2b_lib');
const [, , HTML, REF_ARG] = process.argv;
const REF_COMMIT = 'a18ff636727463007d2cc6195188f2348ac3a901';   // Phase 2C, accepted
const MAX_IN_BETWEEN = 8, MIN_IN_BETWEEN = 3, MIN_BOX = 75 * 2.8, EPS = 1e-6;
const results = [];
const ok = (name, pass, detail) => { results.push(pass); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name} — ${detail}`); };

function referenceHtml() {
  if (REF_ARG) return path.resolve(REF_ARG);
  const file = path.join(L.OUT, 'ref', 'camera_reference.html'); fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, execFileSync('git', ['-C', path.resolve(__dirname, '../..'), 'show', `${REF_COMMIT}:public/chess-cinema/index.html`]));
  return file;
}

// Every encoded frame: the export probe's pieces/effect/pixel hash/timestamp, plus the camera crop [sx, sy, box].
async function exportCase(html, c, flipped) {
  const { browser, page, errors } = await L.openPage(html, { width: 1280, height: 900 });
  try {
    await L.importPgn(page, L.LEGAL_PGN);
    for (const [ply, sqs] of Object.entries(c.storyUI || {})) await B.storyTargets(page, +ply, sqs);
    for (const [ply, sq] of Object.entries(c.highlightUI || {})) await B.highlight(page, +ply, sq);
    if (flipped) await page.click('#flip');   // marks are placed first: they are stored by square name
    await B.chooseRange(page, c.from, c.to);
    await B.installExportProbe(page);
    await page.evaluate(() => {
      const P = CanvasRenderingContext2D.prototype, di = P.drawImage; window.__crops = [];
      P.drawImage = function (img, ...a) { if (this.canvas && this.canvas.width === 1080 && img && img.width === 2400 && a.length === 8) window.__crops.push([a[0] / 4, a[1] / 4, a[2] / 4, a[3] / 4]); return di.call(this, img, ...a); };
    });
    const dl = page.waitForEvent('download', { timeout: 600000 });
    await page.click('#exportSequence'); await dl;
    await page.waitForFunction(() => !exportInProgress);
    const out = await page.evaluate(() => ({ frames: window.__X.frames, crops: window.__crops, flipped: boardFlipped }));
    return { ...out, errors };
  } finally { await browser.close(); }
}

const same = (a, b) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) <= EPS);
const fmt = (c) => `[${c.slice(0, 3).map((v) => +v.toFixed(2)).join(',')}]`;
const ease = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);   // easeInOutCubic; max slope 3 (at x = 0.5)

async function runCase(refHtml, c, flipped) {
  const id = `${c.id}${flipped ? ' (flipped)' : ''}`;
  const tr = B.truth(L.LEGAL_PGN);
  const plan = B.expectedPlan(tr, c.from, c.to, { marks: c.marks || {}, story: c.story || {} });
  const R = await exportCase(refHtml, c, flipped), X = await exportCase(HTML, c, flipped);
  const N = plan.totalFrames;
  ok(`${id}: board orientation as set (${flipped ? 'flipped' : 'normal'})`, R.flipped === flipped && X.flipped === flipped, `ref ${R.flipped} test ${X.flipped}`);
  ok(`${id}: ${N} frames (independent timeline), one camera crop per frame, timestamps round(n*1e6/30) µs, ${(N / 30).toFixed(3)} s`,
    X.frames.length === N && R.frames.length === N && X.crops.length === N && R.crops.length === N && X.frames.every((f, n) => f.ts === Math.round(n * 1e6 / 30)),
    `test ${X.frames.length} frames/${X.crops.length} crops, reference ${R.frames.length}/${R.crops.length}`);
  if (X.frames.length !== N || X.crops.length !== N || R.crops.length !== N) return;
  const pieceDiff = []; X.frames.forEach((f, n) => { const r = R.frames[n]; if (JSON.stringify([f.statics, f.movers, f.fx]) !== JSON.stringify([r.statics, r.movers, r.fx])) pieceDiff.push(n); });
  ok(`${id}: pieces, moving-piece poses and capture effect identical to the reference on every frame`, pieceDiff.length === 0, pieceDiff.length ? `differ at frames ${pieceDiff.slice(0, 8)}` : `${N} frames`);

  // Move boundaries: k+1's first frame s, k's landing frame, and the reference camera on both sides.
  const windows = new Set(); const measured = [];
  for (let k = 0; k + 1 < plan.moves.length; k++) {
    const m = plan.moves[k], s = Math.ceil(m.end / 1000), land = m.landFrame;
    const rFrom = R.crops[s - 1], rTo = R.crops[s];
    if (same(rFrom, rTo)) continue;   // no cut in the reference: nothing may change here
    let still = 0; for (let n = s - 1; n > land && same(R.crops[n], rFrom); n--) still++;
    const want = Math.min(MAX_IN_BETWEEN, Math.floor(still / 2)), expectN = want >= MIN_IN_BETWEEN ? want : 0;
    let w = 0; while (w < s - land && !same(X.crops[s - 1 - w], R.crops[s - 1 - w])) w++;
    for (let n = s - w; n < s; n++) windows.add(n);
    const label = `${tr.moves[m.ply - 1].san} → ${tr.moves[m.ply].san}`;
    const r = { label, cutAt: `${s - 1}→${s}`, still, inBetween: w, steps: w + 1, ms: Math.round((w + 1) * 1000 / 30), from: rFrom, to: rTo };
    measured.push(r);
    ok(`${id}: ${label} (reference cut ${r.cutAt}): ${expectN ? `eases over ${expectN} in-between frames` : 'cut kept (hold too short)'}`, w === expectN,
      `in-between frames ${w} (expected ${expectN}; still view ${still} frames), ${r.steps} steps = ${r.ms} ms, ${fmt(rFrom)} → ${fmt(rTo)}`);
    if (!w) continue;
    const seq = [rFrom].concat(X.crops.slice(s - w, s), [X.crops[s]]);
    const startsAfterLanding = s - w > land, keepsStill = still - w >= Math.ceil(still / 2);
    ok(`${id}: ${label}: after the landing frame (${land}), inside k's hold, at least half the still view kept`, startsAfterLanding && keepsStill && same(X.crops[s - w - 1], rFrom),
      `window ${s - w}..${s - 1}, still frames kept ${still - w}/${still}`);
    ok(`${id}: ${label}: ends exactly on move k+1's first-frame framing (frame ${s})`, same(X.crops[s], rTo), `${fmt(X.crops[s])} vs ${fmt(rTo)}`);
    // Monotonic per component, no overshoot, every step within the eased curve's slope, and the eased path itself.
    let mono = true, bounded = true, onCurve = true, maxStep = 0;
    for (let i = 0; i < 3; i++) {
      const total = rTo[i] - rFrom[i], cap = 3 * Math.abs(total) / (w + 1) + EPS;
      for (let j = 1; j < seq.length; j++) {
        const d = seq[j][i] - seq[j - 1][i]; maxStep = Math.max(maxStep, Math.abs(d));
        if (d * total < -EPS) mono = false;
        if (Math.abs(d) > cap) bounded = false;
      }
      for (let j = 1; j <= w; j++) if (Math.abs(seq[j][i] - (rFrom[i] + total * ease(j / (w + 1)))) > 1e-3) onCurve = false;
    }
    r.maxStep = +maxStep.toFixed(2);
    ok(`${id}: ${label}: bounded movement — monotonic, no overshoot, each step ≤ 3×(total/steps), eased (easeInOutCubic)`, mono && bounded && onCurve,
      `largest step ${maxStep.toFixed(2)} px (box ${fmt(rFrom)}→${fmt(rTo)}), monotonic ${mono}, bounded ${bounded}, on curve ${onCurve}`);
  }
  if (c.expectRefCuts) ok(`${id}: reference has the known Phase 2C cuts ${c.expectRefCuts.join(', ')}`, JSON.stringify(measured.map((r) => r.cutAt)) === JSON.stringify(c.expectRefCuts), JSON.stringify(measured.map((r) => r.cutAt)));
  // Outside transition windows: the same camera and the same pixels as the reference.
  const cropDiff = [], hashDiff = [];
  for (let n = 0; n < N; n++) { if (windows.has(n)) continue; if (!same(X.crops[n], R.crops[n])) cropDiff.push(n); if (X.frames[n].hash !== R.frames[n].hash) hashDiff.push(n); }
  ok(`${id}: outside the ${windows.size} transition frames, camera crops identical to the reference`, cropDiff.length === 0, cropDiff.length ? `differ at ${cropDiff.slice(0, 8)}` : `${N - windows.size} frames`);
  ok(`${id}: outside the transition frames, rendered pixels identical to the reference (frame hash)`, hashDiff.length === 0, hashDiff.length ? `differ at ${hashDiff.slice(0, 8)}` : `${N - windows.size} frames`);
  const outside = X.crops.map((cr, n) => [n, cr]).filter(([, cr]) => !(cr[0] >= -EPS && cr[1] >= -EPS && cr[0] + cr[2] <= 600 + EPS && cr[1] + cr[2] <= 600 + EPS && cr[2] >= MIN_BOX - EPS && Math.abs(cr[2] - cr[3]) <= EPS));
  ok(`${id}: every crop square, inside the board, never smaller than MIN_BOX (${MIN_BOX} px)`, outside.length === 0, outside.length ? JSON.stringify(outside.slice(0, 3)) : `${N} crops`);
  let maxJump = 0, at = -1; for (let n = 1; n < N; n++) { const d = Math.max(...[0, 1, 2].map((i) => Math.abs(X.crops[n][i] - X.crops[n - 1][i]))); if (d > maxJump) { maxJump = d; at = n; } }
  const cutsKept = measured.filter((r) => !r.inBetween).length;
  ok(`${id}: no hard camera cut left between moves (${cutsKept} kept)`, c.cutsAllowed ? true : cutsKept === 0, `largest frame-to-frame camera change ${maxJump.toFixed(2)} px at ${at - 1}→${at}`);
  ok(`${id}: no page errors`, X.errors.length === 0 && R.errors.length === 0, JSON.stringify(X.errors.concat(R.errors)));
  for (const r of measured) console.log(`   ${id}: ${r.label}  cut ${r.cutAt}  still ${r.still}  in-between ${r.inBetween}  → ${r.inBetween ? `${r.steps} steps, ${r.ms} ms, largest step ${r.maxStep} px` : 'cut'}`);
}

(async () => {
  const refHtml = referenceHtml();
  console.log(`build under test: ${HTML}\nreference: ${REF_ARG ? refHtml : REF_COMMIT}`);
  const CASES = [
    // The Phase 2C reference trace: Story Targets on 9. Nxe5, a highlight on 11. Bxf7+, unmarked mate.
    { id: 'story9_highlight11_1-13', from: 1, to: 13, storyUI: { 9: ['c6', 'f6'] }, highlightUI: { 11: 'f7' }, marks: { 9: true, 11: true }, story: { 9: true }, expectRefCuts: ['151→152', '231→232', '258→259', '294→295'], flips: [false, true] },
    // Adjacent marked moves: marked -> marked framings, then back to the full board.
    { id: 'adjacent_marks_6-12', from: 6, to: 12, storyUI: { 9: ['c6', 'f6'] }, highlightUI: { 10: 'd1', 11: 'f7' }, marks: { 9: true, 10: true, 11: true }, story: { 9: true }, flips: [false, true] },
    // Nothing marked: the full board throughout, no transition, every frame identical to the reference.
    { id: 'unmarked_1-13', from: 1, to: 13, flips: [false] },
  ];
  for (const c of CASES) for (const f of c.flips) await runCase(refHtml, c, f);
  console.log(`==== camera transitions: ${results.filter(Boolean).length}/${results.length} passed ====`);
})();
