// Usage: node sequence_parity_test.js <html>
// Sequence playback on screen vs the exported sequence, compared at equivalent GLOBAL timeline times.
// Preview: every displayed frame (preview_probe), t = ms since the frame that showed the start position
// (playback's t0). Export: every encoded frame (p2b_lib probe), t_n = n*1000/30.
const L = require('./lib');
const B = require('./p2b_lib');
const { QSC_PGN } = require('./p2a_cases');
const { installProbe } = require('./preview_probe');
const [, , HTML] = process.argv;
const results = [];
const ok = (name, pass, detail) => { results.push(pass); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name} — ${detail}`); };
const S = 75, centre = (sq) => ({ x: ('abcdefgh'.indexOf(sq[0]) + 0.5) * S, y: (8 - +sq[1] + 0.5) * S });
function shown(staticList, movers) {   // board as seen: statics + pieces resting exactly on a square centre
  const m = {};
  for (const s of staticList) { const [p, sq] = s.split('@'); m[sq] = p; }
  for (const v of movers) { const sq = 'abcdefgh'[Math.floor(v.x / S)] + (8 - Math.floor(v.y / S)); const c = centre(sq); if (Math.hypot(v.x - c.x, v.y - c.y) < 1e-6) m[sq] = v.p; }
  return m;
}
async function setup(page, c) {
  await L.importPgn(page, c.pgn);
  for (const [ply, sqs] of Object.entries(c.storyUI || {})) await B.storyTargets(page, +ply, sqs);
  await B.chooseRange(page, c.from, c.to);
}
(async () => {
  const CASES = [
    { id: 'legal_1-13', pgn: L.LEGAL_PGN, from: 1, to: 13 },
    { id: 'castles_OOO_1-9', pgn: QSC_PGN, from: 1, to: 9 },
    { id: 'promotion_6-10', pgn: L.PROMO_PGN, from: 6, to: 10 },
    { id: 'story_7-10', pgn: L.LEGAL_PGN, from: 7, to: 10, storyUI: { 9: ['c6', 'f6'] } }
  ];
  for (const c of CASES) {
    const tr = B.truth(c.pgn);
    let ctx = await L.openPage(HTML, { width: 1280, height: 900 });
    await setup(ctx.page, c);
    await installProbe(ctx.page);
    await ctx.page.click('#playSequence');
    await ctx.page.waitForFunction(() => sequencePlayback.state === 'idle', null, { timeout: 60000 });
    const pv = await ctx.page.evaluate(() => window.__pp.frames);
    await ctx.browser.close();
    ctx = await L.openPage(HTML, { width: 1280, height: 900 });
    await setup(ctx.page, c);
    await B.installExportProbe(ctx.page);
    const dl = ctx.page.waitForEvent('download', { timeout: 300000 }); await ctx.page.click('#exportSequence'); await dl;
    const ex = await ctx.page.evaluate(() => window.__X.frames);
    await ctx.browser.close();
    const plan = B.expectedPlan(tr, c.from, c.to, { story: Object.fromEntries(Object.keys(c.storyUI || {}).map((k) => [k, true])), marks: Object.fromEntries(Object.keys(c.storyUI || {}).map((k) => [k, true])) });
    let pairs = 0, boardMismatch = [], worst = 0, maxDt = 0;
    ex.forEach((f, n) => {
      const tn = n * 1000 / 30;
      const q = pv.find((p) => Math.abs(p.t - tn) < 1);
      if (!q) return;
      pairs++;
      const dt = Math.abs(q.t - tn); maxDt = Math.max(maxDt, dt);
      const at = B.frameAt(plan, n), mv = tr.moves[at.ply - 1];
      const vmax = 3 * 1.25 * Math.max(75, Math.hypot(('abcdefgh'.indexOf(mv.to[0]) - 'abcdefgh'.indexOf(mv.from[0])) * 75, (+mv.to[1] - +mv.from[1]) * 75)) / B.T(B.cheb(mv.from, mv.to));
      const a = shown(q.staticPieces, q.overlay), b = shown(f.statics, f.movers);
      // within a frame's offset of a landing the two may legitimately sit either side of it
      const nearLanding = plan.moves.some((m) => Math.abs(tn - m.land / 30) <= dt + 0.01 || Math.abs(tn - m.end / 30) <= dt + 0.01);
      if (!B.samePlacement(a, b) && !nearLanding) boardMismatch.push(`t=${tn.toFixed(1)} ply ${at.ply}: ${B.diffPlacement(a, b)}`);
      const ma = q.overlay.filter((o) => !a[o.p] || true).filter((o) => { const sq = 'abcdefgh'[Math.floor(o.x / S)] + (8 - Math.floor(o.y / S)); const cc = centre(sq); return Math.hypot(o.x - cc.x, o.y - cc.y) >= 1e-6; }).sort((x, y) => x.p.localeCompare(y.p));
      const mb = f.movers.filter((o) => { const cc = centre(o.sq); return Math.hypot(o.x - cc.x, o.y - cc.y) >= 1e-6; }).sort((x, y) => x.p.localeCompare(y.p));
      if (ma.length === mb.length) ma.forEach((m, i) => { worst = Math.max(worst, Math.hypot(m.x - mb[i].x, m.y - mb[i].y) / (0.05 + dt * vmax)); });
      else if (!nearLanding) boardMismatch.push(`t=${tn.toFixed(1)} movers ${ma.length} vs ${mb.length}`);
    });
    ok(`${c.id}: same board and moving pieces on screen and in the file at equivalent times (${pairs} frame pairs)`, pairs >= ex.length / 2 && boardMismatch.length === 0 && worst <= 1,
      `${boardMismatch.slice(0, 3).join(' | ') || 'boards equal'}; moving-piece deviation / time-offset allowance ${worst.toFixed(2)} (max offset ${maxDt.toFixed(3)} ms)`);
    const pvEnd = pv[pv.length - 1].t, exEnd = (ex.length - 1) * 1000 / 30;
    ok(`${c.id}: on-screen playback ends when the timeline ends (${(plan.totalFrames - 1) * 1000 / 30} ms)`, Math.abs(pvEnd - exEnd) < 60, `preview last frame ${pvEnd.toFixed(1)} ms, export last frame ${exEnd.toFixed(1)} ms`);
  }
  console.log(`==== sequence parity: ${results.filter(Boolean).length}/${results.length} passed ====`);
})();
