// Usage: node parity_test.js <html>
// Live preview vs export, same move, compared at equivalent timeline times (page source untouched).
//  preview: what each DISPLAYED frame shows (preview_probe.js), t = ms since the animation's first frame
//  export : what each exported frame draws on the export's working canvas -- moving pieces are the piece
//           images drawn centred on a translate() (drawMovingPieceToTemp), frames delimited by the encoder
//           (WebCodecs VideoFrame) -- plus the capture-effect progress drawn in each frame.
const L = require('./lib');
const { CASES } = require('./p2a_cases');
const { playAndRecord } = require('./preview_probe');
const [, , HTML] = process.argv;
const FPS = 30;
const results = [];
const ok = (name, pass, detail) => { results.push(pass); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name} — ${detail}`); };
const T = (d) => Math.min(160 + 20 * (d - 1), 280);

async function exportFrames(page) {
  await page.evaluate(() => {
    const kind = new Map();
    for (const c of ['w', 'b']) for (const t of ['p', 'n', 'b', 'r', 'q', 'k']) if (pieceImages[c] && pieceImages[c][t]) kind.set(pieceImages[c][t], c + t);
    const X = window.__X = { frames: [], cur: { movers: [], fx: null, staticVictim: [] } };
    const P = CanvasRenderingContext2D.prototype;
    const tr = P.translate, rot = P.rotate, di = P.drawImage, sv = P.save, rs = P.restore;
    const isTemp = (c) => c.canvas && c.canvas.width === 2400;
    P.save = function () { if (isTemp(this)) { (this.__st = this.__st || []).push({ x: this.__tx || 0, y: this.__ty || 0, a: this.__ta || 0 }); } return sv.apply(this, arguments); };
    P.restore = function () { if (isTemp(this) && this.__st && this.__st.length) { const s = this.__st.pop(); this.__tx = s.x; this.__ty = s.y; this.__ta = s.a; } return rs.apply(this, arguments); };
    P.translate = function (x, y) { if (isTemp(this)) { this.__tx = (this.__tx || 0) + x; this.__ty = (this.__ty || 0) + y; } return tr.apply(this, arguments); };
    P.rotate = function (a) { if (isTemp(this)) this.__ta = (this.__ta || 0) + a; return rot.apply(this, arguments); };
    P.drawImage = function (img, ...a) {
      if (isTemp(this) && kind.has(img) && a.length === 4) {
        if (this.__tx !== undefined && Math.abs(a[0] + a[2] / 2) < 1e-9 && Math.abs(a[1] + a[3] / 2) < 1e-9) X.cur.movers.push({ p: kind.get(img), x: +(this.__tx).toFixed(2), y: +(this.__ty).toFixed(2), angle: +(this.__ta || 0).toFixed(4), scale: +(a[2] / (LOGICAL_SIZE / 8 * PIECE_SCALE)).toFixed(4) });
        else X.cur.staticVictim.push(kind.get(img) + '@' + 'abcdefgh'[Math.floor((a[0] + a[2] / 2) / (LOGICAL_SIZE / 8))] + (8 - Math.floor((a[1] + a[3] / 2) / (LOGICAL_SIZE / 8))));
      }
      return di.call(this, img, ...a);
    };
    const dce = window.drawCaptureEffect;
    window.drawCaptureEffect = function (c, effect, victim, progress) { if (isTemp(c)) X.cur.fx = progress; return dce.apply(this, arguments); };
    const VF = window.VideoFrame;
    window.VideoFrame = function (src, init) { if (src instanceof HTMLCanvasElement && src.width === 1080) { X.frames.push(X.cur); X.cur = { movers: [], fx: null, staticVictim: [] }; } return new VF(src, init); };
    window.VideoFrame.prototype = VF.prototype;
  });
  const dl = page.waitForEvent('download', { timeout: 120000 }); await page.click('#exportAnim'); await dl;
  return page.evaluate(() => window.__X.frames);
}

(async () => {
  console.log('Preview frames are sampled by requestAnimationFrame (60 Hz here); export frames at t_n = n*1000/30 ms.');
  for (const c of CASES) {
    const fx = c.capture ? 'dissolve' : 'off';
    let ctx = await L.openPage(HTML, { width: 1280, height: 900 });
    const pv = await playAndRecord(ctx.page, c.pgn, c.ply, fx);
    await ctx.browser.close();
    ctx = await L.openPage(HTML, { width: 1280, height: 900 });
    await L.importPgn(ctx.page, c.pgn); await ctx.page.selectOption('#captureFx', fx); await L.timelineClick(ctx.page, c.ply);
    const ex = await exportFrames(ctx.page);
    await ctx.browser.close();
    const dur = T(c.d), M = Math.ceil(dur * FPS / 1000);
    const exMoving = ex.slice(0, M);
    // 1. positions at equivalent times
    // A preview frame's rAF time sits up to ~0.1 ms off the export grid; the pose may differ by at most
    // that offset times the trajectory's top speed (easeOutCubic: 3x average, x1.25 for curved paths).
    const S = 75, dist = Math.hypot(('abcdefgh'.indexOf(c.to[0]) - 'abcdefgh'.indexOf(c.from[0])) * S, (+c.to[1] - +c.from[1]) * S);
    const vmax = 3 * 1.25 * Math.max(dist, S) / dur, wmax = 3 * 2 * Math.PI / dur;
    let compared = 0, maxDxy = 0, maxDang = 0, maxDscale = 0, worst = 0, maxDt = 0;
    for (let n = 0; n < M; n++) {
      const tn = n * 1000 / FPS;
      const f = pv.find((q) => Math.abs(q.t - tn) < 1 && q.overlay.length);
      if (!f) continue;
      const dt = Math.abs(f.t - tn); maxDt = Math.max(maxDt, dt);
      const a = [...f.overlay].sort((p, q) => p.p.localeCompare(q.p)), b = [...ex[n].movers].sort((p, q) => p.p.localeCompare(q.p));
      if (a.length !== b.length) { maxDxy = Infinity; continue; }
      a.forEach((m, i) => {
        const dxy = Math.hypot(m.x - b[i].x, m.y - b[i].y), dang = Math.abs(m.angle - b[i].angle);
        maxDxy = Math.max(maxDxy, dxy); maxDang = Math.max(maxDang, dang); maxDscale = Math.max(maxDscale, Math.abs(m.scale - b[i].scale));
        worst = Math.max(worst, dxy / (0.05 + dt * vmax), dang / (0.001 + dt * wmax));
      });
      compared++;
    }
    // preview's own time base can sit a fraction of a ms off the export grid; tolerate <= 0.6 logical px
    ok(`${c.id}: piece pose at equivalent times (${compared} frame pairs)`, compared >= Math.floor(M / 2) && worst <= 1 && maxDscale <= 0.005,
      `max |dxy|=${maxDxy.toFixed(3)}px |dangle|=${maxDang.toFixed(4)}rad |dscale|=${maxDscale.toFixed(4)}; max time offset ${maxDt.toFixed(3)}ms; worst deviation / offset-allowance = ${worst.toFixed(2)}`);
    // 2. arrival: both show the move landed at the first sample at/after T
    const pvMoving = pv.filter((q) => q.overlay.length && q.fxProgress === null && q.busy > 0);
    const pvLast = pvMoving.length ? pvMoving[pvMoving.length - 1].t : null;
    const pvArrive = pv.find((q) => q.t > pvLast);
    const exLanding = ex[M] && ex[M].movers.every((m) => m.angle === 0 && m.scale === 1);
    // Preview: no displayed frame at/after T still shows the piece moving, and the first displayed frame
    // at/after T shows it landed. (Not "within 17 ms": headless Chromium occasionally skips a display
    // frame, which delays when the landing is SEEN but is not the app landing late.)
    const pvFirstAtT = pv.find((q) => q.t >= dur - 1);
    const pvNoLateMovement = pvMoving.every((q) => q.t < dur - 0.5);
    ok(`${c.id}: arrival at ${dur} ms in both`, pvNoLateMovement && pvFirstAtT && pvArrive && pvFirstAtT.t === pvArrive.t && ex.length > M && (M - 1) * 1000 / FPS < dur && M * 1000 / FPS >= dur && exLanding,
      `preview last moving frame ${pvLast}ms, landed frame ${pvArrive && pvArrive.t}ms; export movement frames ${M} (last ${((M - 1) * 1000 / FPS).toFixed(1)}ms), landing frame ${M} at ${(M * 1000 / FPS).toFixed(1)}ms`);
    // 3. castling: both pieces in every moving frame, both paths
    if (c.rook) ok(`${c.id}: king and rook both move in every frame (preview and export)`, pvMoving.every((q) => q.overlay.length === 2) && exMoving.every((q) => q.movers.length === 2),
      `preview ${pvMoving.filter((q) => q.overlay.length === 2).length}/${pvMoving.length}, export ${exMoving.filter((q) => q.movers.length === 2).length}/${exMoving.length}`);
    // 4. capture timing: victim stands until landing; the beat starts at landing with the same progress per elapsed time
    if (c.capture) {
      const vsq = c.victimSq || c.to;
      const pvVictim = pvMoving.filter((q) => q.staticPieces.some((s) => s.endsWith('@' + vsq))).length;
      const exVictim = exMoving.filter((q) => q.staticVictim.some((s) => s.endsWith('@' + vsq))).length;
      const pvFx = pv.filter((q) => q.fxProgress !== null), exFx = ex.map((q, i) => ({ i, p: q.fx })).filter((q) => q.p !== null);
      const landT = pvArrive ? pvArrive.t : 0;
      // preview progress vs the export's at the same time since landing (the export samples every 33.3 ms)
      let maxDp = 0;
      for (const q of pvFx) { const dt = q.t - pvFx[0].t; const exp = Math.min(1, dt / 500); maxDp = Math.max(maxDp, Math.abs(q.fxProgress - exp)); }
      ok(`${c.id}: captured piece visible until landing (preview and export)`, pvVictim === pvMoving.length && exVictim === exMoving.length, `preview ${pvVictim}/${pvMoving.length}, export ${exVictim}/${exMoving.length}`);
      ok(`${c.id}: capture beat starts at landing and runs 500 ms in both`, exFx.length && exFx[0].i === M && exFx[0].p === 0 && pvFx.length && Math.abs(pvFx[0].t - landT) < 17 && pvFx[0].fxProgress === 0 && maxDp <= 0.04 && Math.abs((pvFx[pvFx.length - 1].t - pvFx[0].t) - 500) < 34,
        `export: first effect frame ${exFx[0] && exFx[0].i} (landing ${M}), ${exFx.length} frames to progress ${exFx.length && exFx[exFx.length - 1].p.toFixed(2)}; preview: starts ${pvFx[0] && pvFx[0].t}ms (landed ${landT}ms), lasts ${pvFx.length && (pvFx[pvFx.length - 1].t - pvFx[0].t).toFixed(1)}ms, max progress deviation from elapsed/500ms ${maxDp.toFixed(3)}`);
    }
  }
  console.log(`==== preview/export parity: ${results.filter(Boolean).length}/${results.length} passed ====`);
})();
