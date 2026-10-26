// Usage: node camera_transition_test.js <html>
// Export camera between moves of a sequence (Phase 3A). Each case is exported by the build under test and by
// two reference builds read from git history — Phase 2C (a18ff63: every move's own camera, with hard cuts
// between moves) and the first Phase 3A build (e4f6bc1) — and compared frame by frame. Camera geometry is
// compared separately from pixels: the camera is the source rectangle of the export's final crop (working
// canvas -> 1080 canvas), in logical board px (0..600).
//
// The rules under test, as agreed for Phase 3A. The expected crop of every frame is built from them here,
// from the Phase 2C crops and the test's own timeline, not read from the app:
//  1. Where Phase 2C cuts from move k's framing to move k+1's, the camera eases over the LAST N frames of k's
//     hold and reaches k+1's framing exactly on k+1's first frame. N = min(8, floor(still / 2)), where
//     `still` counts k's hold frames after the landing frame with the camera at rest on its final framing
//     (at least half of that still view remains); N < 3 keeps the cut. 8 in-between frames = 300 ms.
//  2. Exception (zoom-in to Story Targets): when k is unmarked (full board) and k+1 has Story Targets, k keeps
//     the full board for its whole hold, k+1 moves on the full board (the camera does not move while the
//     piece moves), and from k+1's landing frame the camera eases over 15 steps (500 ms) from the full board
//     into k+1's own camera, which it follows exactly from then on.
//  3. Marked checkmate: when the range's last move is checkmate and its own camera is not the full board, the
//     close-up is kept for 30 frames (1 s) from the frame it settles, then eases to the full board over
//     9 steps (300 ms), and the full board stays to the end, the closing frame included.
// Frame count, timestamps and pieces are unchanged on every frame; pixels are unchanged wherever the crop is.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const L = require('./lib');
const B = require('./p2b_lib');
const [, , HTML] = process.argv;
const REFS = { p2c: 'a18ff636727463007d2cc6195188f2348ac3a901', p3a1: 'e4f6bc1934b560ead073263dbffa1039a3146f96' };
const MAX_IN_BETWEEN = 8, MIN_IN_BETWEEN = 3, ZOOM_IN_STEPS = 15, MATE_CLOSEUP = 30, MATE_OUT_STEPS = 9;
const MIN_BOX = 75 * 2.8, EPS = 1e-6, FULL = [0, 0, 600];
const results = [];
const ok = (name, pass, detail) => { results.push(pass); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name} — ${detail}`); };

function referenceHtml(name) {
  const file = path.join(L.OUT, 'ref', `camera_${name}.html`); fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, execFileSync('git', ['-C', path.resolve(__dirname, '../..'), 'show', `${REFS[name]}:public/chess-cinema/index.html`]));
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

const same = (a, b) => [0, 1, 2].every((i) => Math.abs(a[i] - b[i]) <= EPS);
const isFull = (a) => same(a, FULL);
const lerp = (a, b, e) => [0, 1, 2].map((i) => a[i] + (b[i] - a[i]) * e);
const fmt = (c) => `[${c.slice(0, 3).map((v) => +v.toFixed(2)).join(',')}]`;
const ease = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);   // easeInOutCubic; max slope 3 (at x = 0.5)
const step = (a, b) => Math.max(...[0, 1, 2].map((i) => Math.abs(a[i] - b[i])));

// The expected crop of every frame (rules 1–3 above) from the Phase 2C crops R.
function model(R, plan, c, tr) {
  const N = R.length, exp = R.map((cr) => cr.slice(0, 3)), changed = new Array(N).fill(null), boundaries = [];
  const firstFrame = (m) => Math.ceil(m.start / 1000), endFrame = (k) => (k + 1 < plan.moves.length ? Math.ceil(plan.moves[k].end / 1000) : N);
  for (let k = 0; k + 1 < plan.moves.length; k++) {
    const m = plan.moves[k], nx = plan.moves[k + 1], s = endFrame(k), land = m.landFrame;
    const from = R[s - 1], to = R[s];
    const b = { k, label: `${tr.moves[m.ply - 1].san} → ${tr.moves[nx.ply - 1].san}`, s, land, from, to, cut: !same(from, to) };
    if (!b.cut) continue;
    if (!m.full && (c.story || {})[nx.ply] && isFull(from)) {
      b.kind = 'zoom-in'; b.nland = nx.landFrame; b.nend = endFrame(k + 1); b.prevStart = firstFrame(m);
      b.fits = b.nland + ZOOM_IN_STEPS < b.nend;
      for (let n = s; n < b.nland; n++) { exp[n] = FULL.slice(); changed[n] = 'zoom-in'; }
      for (let h = 0; h < ZOOM_IN_STEPS; h++) { const n = b.nland + h; exp[n] = lerp(FULL, R[n], ease(h / ZOOM_IN_STEPS)); changed[n] = 'zoom-in'; }
      for (let n = land; n < s; n++) changed[n] = changed[n] || 'zoom-in-prev';   // the first Phase 3A build eased here
    } else {
      let still = 0; for (let n = s - 1; n > land && same(R[n], from); n--) still++;
      const want = Math.min(MAX_IN_BETWEEN, Math.floor(still / 2)); b.still = still; b.N = want >= MIN_IN_BETWEEN ? want : 0;
      b.kind = b.N ? 'ease' : 'cut';
      for (let j = 1; j <= b.N; j++) { const n = s - 1 - b.N + j; exp[n] = lerp(from, to, ease(j / (b.N + 1))); changed[n] = 'ease'; }
    }
    boundaries.push(b);
  }
  const L_ = plan.moves[plan.moves.length - 1], fin = R[N - 1];
  const mate = { applies: /#$/.test(tr.moves[L_.ply - 1].san) && !isFull(fin), land: L_.landFrame, start: firstFrame(L_) };
  if (mate.applies) {
    let settle = N - 1; while (settle - 1 >= L_.landFrame && same(R[settle - 1], fin)) settle--;
    Object.assign(mate, { settle, outStart: settle + MATE_CLOSEUP, fullFrom: settle + MATE_CLOSEUP + MATE_OUT_STEPS - 1, closeup: fin });
    mate.fits = mate.fullFrom <= N - 1;
    for (let j = 1; j < MATE_OUT_STEPS; j++) { const n = mate.outStart - 1 + j; exp[n] = lerp(fin, FULL, ease(j / MATE_OUT_STEPS)); changed[n] = 'mate'; }
    for (let n = mate.fullFrom; n < N; n++) { exp[n] = FULL.slice(); changed[n] = 'mate'; }
  }
  return { exp, changed, boundaries, mate };
}

async function runCase(refs, c, flipped) {
  const id = `${c.id}${flipped ? ' (flipped)' : ''}`;
  const tr = B.truth(L.LEGAL_PGN);
  const plan = B.expectedPlan(tr, c.from, c.to, { marks: c.marks || {}, story: c.story || {} });
  const N = plan.totalFrames;
  const R = await exportCase(refs.p2c, c, flipped), P = await exportCase(refs.p3a1, c, flipped), X = await exportCase(HTML, c, flipped);
  ok(`${id}: board orientation as set (${flipped ? 'flipped' : 'normal'})`, [R, P, X].every((b) => b.flipped === flipped), `${R.flipped}/${P.flipped}/${X.flipped}`);
  ok(`${id}: ${N} frames (independent timeline; Phase 2C and first Phase 3A build the same), one camera crop per frame, timestamps round(n*1e6/30) µs, ${(N / 30).toFixed(3)} s`,
    [R, P, X].every((b) => b.frames.length === N && b.crops.length === N) && X.frames.every((f, n) => f.ts === Math.round(n * 1e6 / 30)),
    `test ${X.frames.length}/${X.crops.length}, Phase 2C ${R.frames.length}/${R.crops.length}, Phase 3A-1 ${P.frames.length}/${P.crops.length}`);
  if (![R, P, X].every((b) => b.frames.length === N && b.crops.length === N)) return;
  for (const [name, ref] of [['Phase 2C', R], ['first Phase 3A build', P]]) {
    const d = []; X.frames.forEach((f, n) => { const r = ref.frames[n]; if (JSON.stringify([f.statics, f.movers, f.fx]) !== JSON.stringify([r.statics, r.movers, r.fx])) d.push(n); });
    ok(`${id}: pieces, moving-piece poses and capture effect identical to ${name} on every frame`, d.length === 0, d.length ? `differ at frames ${d.slice(0, 8)}` : `${N} frames`);
  }
  const M = model(R.crops, plan, c, tr);
  const zoomIns = M.boundaries.filter((b) => b.kind === 'zoom-in').length;
  ok(`${id}: case exercises what it should (${c.expect.zoomIn} Story zoom-in, marked mate ${c.expect.mate ? 'yes' : 'no'})`, zoomIns === c.expect.zoomIn && M.mate.applies === c.expect.mate, `zoom-ins ${zoomIns}, marked mate ${M.mate.applies}`);
  if (c.expectRefCuts) ok(`${id}: Phase 2C has the known cuts ${c.expectRefCuts.join(', ')}`, JSON.stringify(M.boundaries.map((b) => `${b.s - 1}→${b.s}`)) === JSON.stringify(c.expectRefCuts), JSON.stringify(M.boundaries.map((b) => `${b.s - 1}→${b.s}`)));
  const off = []; X.crops.forEach((cr, n) => { if (!same(cr, M.exp[n])) off.push(n); });
  ok(`${id}: every frame's camera crop equals the rules' expected crop`, off.length === 0, off.length ? `differ at ${off.slice(0, 6).map((n) => `${n}: ${fmt(X.crops[n])} want ${fmt(M.exp[n])}`).join('; ')}` : `${N} frames`);

  for (const b of M.boundaries) {
    const tag = `${id}: ${b.label} (Phase 2C cut ${b.s - 1}→${b.s})`;
    if (b.kind === 'zoom-in') {
      const prevOk = X.crops.slice(b.prevStart, b.s).every((cr, i) => same(cr, R.crops[b.prevStart + i]) && isFull(cr));
      const stillMoving = X.crops.slice(b.s, b.nland).every(isFull);
      const zoom = X.crops.slice(b.nland, b.nland + ZOOM_IN_STEPS + 1);
      let maxStep = 0, ownStep = 0, onCurve = true;
      for (let h = 1; h <= ZOOM_IN_STEPS; h++) { maxStep = Math.max(maxStep, step(zoom[h], zoom[h - 1])); ownStep = Math.max(ownStep, step(R.crops[b.nland + h], R.crops[b.nland + h - 1])); }
      for (let h = 0; h < ZOOM_IN_STEPS; h++) if (!same(zoom[h], lerp(FULL, R.crops[b.nland + h], ease(h / ZOOM_IN_STEPS)))) onCurve = false;
      const total = step(FULL, R.crops[b.nland + ZOOM_IN_STEPS]), bound = 3 * total / ZOOM_IN_STEPS + ownStep + EPS;
      b.report = `zoom-in after landing: frames ${b.nland}–${b.nland + ZOOM_IN_STEPS} (${ZOOM_IN_STEPS} steps, ${Math.round(ZOOM_IN_STEPS * 1000 / 30)} ms), largest step ${maxStep.toFixed(2)} px`;
      ok(`${tag}: Story zoom-in fits in the marked move's own hold (landing ${b.nland} + ${ZOOM_IN_STEPS} < next move ${b.nend})`, b.fits, `hold frames ${b.nland}–${b.nend - 1}`);
      ok(`${tag}: previous move keeps its full viewing time on the full board (no window in its hold)`, prevOk, `frames ${b.prevStart}–${b.s - 1}`);
      ok(`${tag}: camera does not move while the piece moves (full board on movement frames ${b.s}–${b.nland - 1})`, stillMoving && b.nland > b.s, `${b.nland - b.s} movement frames`);
      ok(`${tag}: zoom begins only after the landing frame (landing frame ${b.nland} is the full board)`, isFull(X.crops[b.nland]) && !isFull(X.crops[b.nland + 1]), `${fmt(X.crops[b.nland])} → ${fmt(X.crops[b.nland + 1])}`);
      ok(`${tag}: reaches the move's own camera after ${ZOOM_IN_STEPS} steps (500 ms) and follows it exactly from then on`, same(zoom[ZOOM_IN_STEPS], R.crops[b.nland + ZOOM_IN_STEPS]) && onCurve,
        `frame ${b.nland + ZOOM_IN_STEPS}: ${fmt(zoom[ZOOM_IN_STEPS])} vs own ${fmt(R.crops[b.nland + ZOOM_IN_STEPS])}, on curve ${onCurve}`);
      ok(`${tag}: bounded zoom-in — each step ≤ 3×(total/${ZOOM_IN_STEPS}) + the own camera's own step`, maxStep <= bound, `largest step ${maxStep.toFixed(2)} px, bound ${bound.toFixed(2)} px`);
    } else if (b.kind === 'ease') {
      const w = b.N, s = b.s, seq = [b.from].concat(X.crops.slice(s - w, s), [X.crops[s]]);
      let mono = true, bounded = true, maxStep = 0;
      for (let i = 0; i < 3; i++) {
        const total = b.to[i] - b.from[i], cap = 3 * Math.abs(total) / (w + 1) + EPS;
        for (let j = 1; j < seq.length; j++) { const d = seq[j][i] - seq[j - 1][i]; maxStep = Math.max(maxStep, Math.abs(d)); if (d * total < -EPS) mono = false; if (Math.abs(d) > cap) bounded = false; }
      }
      b.report = `eases over ${w} in-between frames, ${w + 1} steps = ${Math.round((w + 1) * 1000 / 30)} ms, largest step ${maxStep.toFixed(2)} px`;
      ok(`${tag}: eases over ${w} in-between frames (still view ${b.still})`, X.crops.slice(s - w, s).every((cr, i) => !same(cr, R.crops[s - w + i])) && same(X.crops[s - w - 1], b.from), `window ${s - w}..${s - 1}`);
      ok(`${tag}: after the landing frame (${b.land}), at least half the still view kept`, s - w > b.land && b.still - w >= Math.ceil(b.still / 2), `still frames kept ${b.still - w}/${b.still}`);
      ok(`${tag}: ends exactly on move k+1's first-frame framing (frame ${s})`, same(X.crops[s], b.to), `${fmt(X.crops[s])} vs ${fmt(b.to)}`);
      ok(`${tag}: bounded movement — monotonic, no overshoot, each step ≤ 3×(total/steps)`, mono && bounded, `largest step ${maxStep.toFixed(2)} px, monotonic ${mono}, bounded ${bounded}`);
    } else b.report = 'cut kept (still view too short)';
  }
  if (M.mate.applies) {
    const m = M.mate, tag = `${id}: marked checkmate`;
    const close = X.crops.slice(m.settle, m.outStart), out = X.crops.slice(m.outStart - 1, m.fullFrom + 1);
    let maxStep = 0; for (let j = 1; j < out.length; j++) maxStep = Math.max(maxStep, step(out[j], out[j - 1]));
    m.report = `close-up settles at ${m.settle}, held ${MATE_CLOSEUP} frames (1.0 s), eases out ${m.outStart}–${m.fullFrom} (${MATE_OUT_STEPS} steps, 300 ms, largest step ${maxStep.toFixed(2)} px), full board ${m.fullFrom}–${N - 1} (${((N - m.fullFrom) / 30).toFixed(2)} s)`;
    ok(`${tag}: fits in the 5 s hold (full board from ${m.fullFrom} ≤ last frame ${N - 1}); hold ${plan.moves[plan.moves.length - 1].holdMs} ms unchanged`, m.fits && plan.moves[plan.moves.length - 1].holdMs === 5000, m.report);
    // (Frames of a Story zoom-in into the mate are checked against the zoom-in rule above, not here.)
    ok(`${tag}: existing close-up (knight and king) unchanged from movement through settling, then held ${MATE_CLOSEUP} frames`, X.crops.slice(m.start, m.outStart).every((cr, i) => M.changed[m.start + i] === 'zoom-in' || same(cr, R.crops[m.start + i])) && close.every((cr) => same(cr, m.closeup)) && !isFull(m.closeup),
      `frames ${m.start}–${m.outStart - 1} as Phase 2C; close-up ${fmt(m.closeup)} on ${m.settle}–${m.outStart - 1}`);
    ok(`${tag}: eases to the full board over ${MATE_OUT_STEPS} steps (300 ms), monotonic`, isFull(X.crops[m.fullFrom]) && !isFull(X.crops[m.fullFrom - 1]) && [0, 1, 2].every((i) => out.every((cr, j) => j === 0 || (cr[i] - out[j - 1][i]) * (FULL[i] - m.closeup[i]) >= -EPS)), `frames ${m.outStart}–${m.fullFrom}`);
    ok(`${tag}: full board to the end, final frame included`, X.crops.slice(m.fullFrom).every(isFull) && isFull(X.crops[N - 1]), `frames ${m.fullFrom}–${N - 1}`);
  } else {
    const Lm = plan.moves[plan.moves.length - 1], st = Math.ceil(Lm.start / 1000);
    const unchanged = X.crops.slice(st).every((cr, i) => same(cr, R.crops[st + i]) && same(cr, P.crops[st + i]));
    ok(`${id}: last move (${tr.moves[Lm.ply - 1].san}) camera unchanged from Phase 2C and the first Phase 3A build, final frame ${isFull(X.crops[N - 1]) ? 'full board' : fmt(X.crops[N - 1])}`, unchanged, `frames ${st}–${N - 1}`);
  }
  // Pixels: identical to Phase 2C wherever the crop is Phase 2C's.
  const hashDiff = []; for (let n = 0; n < N; n++) if (same(M.exp[n], R.crops[n]) && X.frames[n].hash !== R.frames[n].hash) hashDiff.push(n);
  const keep = M.exp.filter((e, n) => same(e, R.crops[n])).length;
  ok(`${id}: rendered pixels identical to Phase 2C on the ${keep} frames whose crop is unchanged (frame hash)`, hashDiff.length === 0, hashDiff.length ? `differ at ${hashDiff.slice(0, 8)}` : `${keep} frames`);
  // Against the first Phase 3A build: everything outside the zoom-in and marked-mate frames unchanged.
  const pCrop = [], pHash = []; let compared = 0;
  for (let n = 0; n < N; n++) { if (M.changed[n] && M.changed[n] !== 'ease') continue; compared++; if (!same(X.crops[n], P.crops[n])) pCrop.push(n); else if (X.frames[n].hash !== P.frames[n].hash) pHash.push(n); }
  ok(`${id}: outside the Story zoom-in and marked-mate frames, crops and pixels identical to the first Phase 3A build (zoom-out, marked→marked, highlight-only unchanged)`, pCrop.length === 0 && pHash.length === 0,
    pCrop.length || pHash.length ? `crop differs at ${pCrop.slice(0, 6)}, pixels at ${pHash.slice(0, 6)}` : `${compared} frames`);
  const bad = X.crops.map((cr, n) => [n, cr]).filter(([, cr]) => !(cr[0] >= -EPS && cr[1] >= -EPS && cr[0] + cr[2] <= 600 + EPS && cr[1] + cr[2] <= 600 + EPS && cr[2] >= MIN_BOX - EPS && Math.abs(cr[2] - cr[3]) <= EPS));
  ok(`${id}: every crop square, inside the board, never smaller than MIN_BOX (${MIN_BOX} px)`, bad.length === 0, bad.length ? JSON.stringify(bad.slice(0, 3)) : `${N} crops`);
  let maxJump = 0, at = -1; for (let n = 1; n < N; n++) { const d = step(X.crops[n], X.crops[n - 1]); if (d > maxJump) { maxJump = d; at = n; } }
  const cutsKept = M.boundaries.filter((b) => b.kind === 'cut').length;
  ok(`${id}: no hard camera cut left between moves (${cutsKept} kept)`, cutsKept === 0, `largest frame-to-frame camera change ${maxJump.toFixed(2)} px at ${at - 1}→${at}`);
  ok(`${id}: no page errors`, [R, P, X].every((b) => b.errors.length === 0), JSON.stringify(X.errors.concat(R.errors, P.errors)));
  for (const b of M.boundaries) console.log(`   ${id}: ${b.label}  cut ${b.s - 1}→${b.s}  ${b.kind}: ${b.report}`);
  if (M.mate.applies) console.log(`   ${id}: marked mate: ${M.mate.report}`);
}

(async () => {
  const refs = { p2c: referenceHtml('p2c'), p3a1: referenceHtml('p3a1') };
  console.log(`build under test: ${HTML}\nreferences: Phase 2C ${REFS.p2c}, first Phase 3A build ${REFS.p3a1}`);
  const S9 = { 9: ['c6', 'f6'] };
  const CASES = [
    // The Phase 2C reference trace: Story Targets on 9. Nxe5, a highlight on 11. Bxf7+, unmarked mate.
    { id: 'story9_highlight11_1-13', from: 1, to: 13, storyUI: S9, highlightUI: { 11: 'f7' }, marks: { 9: true, 11: true }, story: { 9: true }, expectRefCuts: ['151→152', '231→232', '258→259', '294→295'], expect: { zoomIn: 1, mate: false }, flips: [false, true] },
    // Adjacent marked moves: marked -> marked framings, then back to the full board.
    { id: 'adjacent_marks_6-12', from: 6, to: 12, storyUI: S9, highlightUI: { 10: 'd1', 11: 'f7' }, marks: { 9: true, 10: true, 11: true }, story: { 9: true }, expect: { zoomIn: 1, mate: false }, flips: [false, true] },
    // Nothing marked: the full board throughout, every frame identical to Phase 2C.
    { id: 'unmarked_1-13', from: 1, to: 13, expect: { zoomIn: 0, mate: false }, flips: [false] },
    // Marked mating move (highlights through to the mate): close-up through the mate, then back to the full board.
    { id: 'marked_mate_6-13', from: 6, to: 13, storyUI: S9, highlightUI: { 10: 'd1', 11: 'f7', 12: 'e7', 13: 'd5' }, marks: { 9: true, 10: true, 11: true, 12: true, 13: true }, story: { 9: true }, expect: { zoomIn: 1, mate: true }, flips: [false, true] },
    // Unmarked mate after a marked king move: the mate stays exactly as before.
    { id: 'unmarked_mate_after_marked_6-13', from: 6, to: 13, storyUI: S9, highlightUI: { 10: 'd1', 11: 'f7', 12: 'e7' }, marks: { 9: true, 10: true, 11: true, 12: true }, story: { 9: true }, expect: { zoomIn: 1, mate: false }, flips: [false] },
    // Story Targets on the mating move after an unmarked move: the zoom-in and the marked-mate return together.
    { id: 'story_mate_12-13', from: 12, to: 13, storyUI: { 13: ['e7'] }, marks: { 13: true }, story: { 13: true }, expect: { zoomIn: 1, mate: true }, flips: [false, true] },
    // A one-move export of a marked mate.
    { id: 'marked_mate_single_13', from: 13, to: 13, highlightUI: { 13: 'd5' }, marks: { 13: true }, expect: { zoomIn: 0, mate: true }, flips: [false] },
  ];
  for (const c of CASES) for (const f of c.flips) await runCase(refs, c, f);
  console.log(`==== camera transitions: ${results.filter(Boolean).length}/${results.length} passed ====`);
})();
