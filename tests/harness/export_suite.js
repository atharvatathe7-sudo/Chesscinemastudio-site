// Usage: node export_suite.js <html> <label> [--frames]
// Real exports (MediaRecorder -> WebM download). Verifies the produced FILE, not just that the button clicks.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const L = require('./lib');
const [, , HTML, LABEL, FLAG] = process.argv;
const OUTDIR = `${L.OUT}/exports/${LABEL}`;
fs.mkdirSync(OUTDIR, { recursive: true });
const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const results = [];
// Independent model (the test's own, not read from the app): T(d) = min(160 + 20(d-1), 280) ms by Chebyshev
// distance; endpoint rule: ceil(T*fps/1000) movement frames + the final hold + 1 closing frame. The final hold is
// 30 frames (1 s) — or, since Phase 2C, 5 s (150 frames) when the move is checkmate.
const FPS = 30, HOLD = 30, MATE_HOLD = 150;
const cheb = (a, b) => Math.max(Math.abs(a.charCodeAt(0) - b.charCodeAt(0)), Math.abs(+a[1] - +b[1]));
const expectedFrames = (from, to, mate) => Math.ceil(Math.min(160 + 20 * (cheb(from, to) - 1), 280) * FPS / 1000) + (mate ? MATE_HOLD : HOLD) + 1;

function probe(file) {
  let txt = '';
  try { execFileSync(FFMPEG, ['-hide_banner', '-i', file], { stdio: ['ignore', 'pipe', 'pipe'] }); } catch (e) { txt = String(e.stderr || ''); }
  const dur = /Duration: (\d+):(\d+):([\d.]+)/.exec(txt);
  const vid = /Video: (\w+).*?, (\d+)x(\d+)/.exec(txt);
  return { seconds: dur ? (+dur[1]) * 3600 + (+dur[2]) * 60 + parseFloat(dur[3]) : null, codec: vid && vid[1], w: vid && +vid[2], h: vid && +vid[3], alpha: /alpha_mode\s*:\s*1/.test(txt) };
}

async function exportOne({ id, title, pgn, ply, fx, expectName, minCalls, from, to, mate }) {
  const { browser, page, errors } = await L.openPage(HTML, { width: 1280, height: 900 });
  try {
    await L.importPgn(page, pgn);
    await page.selectOption('#captureFx', fx);
    await page.evaluate(() => { window.__fx = []; const o = window.drawCaptureEffect; window.drawCaptureEffect = function (c, effect) { window.__fx.push(effect); return o.apply(this, arguments); }; });
    await L.timelineClick(page, ply);
    const stateBefore = await L.navState(page);
    if (process.env.HASH) await page.evaluate(() => {
      // Hash of every frame handed to the encoder (WebCodecs: the canvas a colour VideoFrame is made from;
      // fallback: the canvas behind requestFrame) -- same FNV sampling as the Phase 1 baseline hashes.
      window.__hashes = [];
      const hash = (c) => { const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let h = 2166136261; for (let i = 0; i < d.length; i += 61) { h ^= d[i]; h = Math.imul(h, 16777619); } return h >>> 0; };
      const proto = window.CanvasCaptureMediaStreamTrack.prototype, orig = proto.requestFrame;
      proto.requestFrame = function () { window.__hashes.push(hash(this.canvas)); return orig.apply(this, arguments); };
      if (typeof VideoFrame === 'function') {
        const VF = window.VideoFrame;
        window.VideoFrame = function (src, init) { if (src instanceof HTMLCanvasElement && src.width === 1080) window.__hashes.push(hash(src)); return new VF(src, init); };
        window.VideoFrame.prototype = VF.prototype;
      }
    });
    const dl = page.waitForEvent('download', { timeout: 120000 });
    const t0 = Date.now();
    await page.click('#exportAnim');
    const d = await dl;
    const file = `${OUTDIR}/${id}.webm`;
    await d.saveAs(file);
    const ms = Date.now() - t0;
    const calls = await page.evaluate(() => window.__fx.slice());
    if (process.env.HASH) fs.writeFileSync(`${OUTDIR}/${id}.hashes.json`, JSON.stringify(await page.evaluate(() => window.__hashes)));
    const stateAfter = await L.navState(page);
    const meta = probe(file); const bytes = fs.statSync(file).size;
    const problems = [];
    if (d.suggestedFilename() !== expectName) problems.push(`filename ${d.suggestedFilename()} != ${expectName}`);
    if (meta.codec !== 'vp9') problems.push('codec ' + meta.codec);
    if (!(meta.w === meta.h && meta.w >= 720)) problems.push(`dimensions ${meta.w}x${meta.h}`);
    const N = expectedFrames(from, to, mate);
    const v = JSON.parse(execFileSync('node', [path.join(__dirname, 'validate_webm.js'), file, String(N), String(FPS)]).toString());
    // WebCodecs path: the exact schedule is required. MediaRecorder fallback: timing follows the wall clock
    // by design (documented limitation), so there a valid, fully decodable file is required and the frame
    // count / timestamps are reported, not required.
    if (process.env.EXPORT_MODE === 'fallback') { if (!v.nativeVp9DecodeOk || v.codec !== 'vp9' || !(v.decodedFrames > 0)) problems.push('fallback file invalid: ' + v.problems.join(', ')); }
    else if (!v.pass) problems.push('schedule/decode: ' + v.problems.join(', '));
    if (process.env.EXPORT_MODE !== 'fallback' && v.alphaMode !== '1') problems.push('alpha_mode ' + v.alphaMode);
    if (bytes < 50000) problems.push('tiny file ' + bytes);
    if (fx === 'off' || minCalls === 0) { if (calls.length !== 0) problems.push('effect drawn but expected none: ' + calls.length); }
    else if (!(calls.length > 0 && calls.every((e) => e === fx))) problems.push(`effect calls=${calls.length} names=${[...new Set(calls)]} (expected ${fx})`);
    if (stateBefore.selectedPly !== stateAfter.selectedPly || stateBefore.historyPointer !== stateAfter.historyPointer) problems.push('export changed navigation state ' + JSON.stringify([stateBefore.selectedPly, stateBefore.historyPointer, stateAfter.selectedPly, stateAfter.historyPointer]));
    if (errors.filter((e) => !/ERR_|net::/.test(e)).length) problems.push('console errors ' + errors.join('|'));
    const pass = problems.length === 0;
    results.push({ id, pass });
    console.log(`${pass ? 'PASS' : 'FAIL'}  ${id.padEnd(22)} ${title} — ${d.suggestedFilename()} ${bytes}B ${meta.codec} ${meta.w}x${meta.h}${meta.alpha ? ' alpha' : ''} frames=${v.packets}/${N} decoded=${v.decodedFrames} ${v.containerDurationSec}s ptsExact=${v.ptsExact} effectCalls=${calls.length} (${ms}ms)${pass ? '' : '  PROBLEMS: ' + problems.join('; ')}`);
  } catch (e) {
    results.push({ id, pass: false });
    console.log(`FAIL  ${id.padEnd(22)} ${title} — EXCEPTION ${e.message.split('\n')[0]}`);
  } finally { await browser.close(); }
}

(async () => {
  console.log('Build under test:', HTML, '\n');
  const FX = ['off', 'dissolve', 'shatter', 'energy', 'implosion', 'drift', 'burst'];
  for (const fx of FX) {
    await exportOne({ id: `capture_${fx}`, title: `Nxe5 capture, Capture FX=${fx}`, pgn: L.LEGAL_PGN, ply: 9, fx, expectName: 'move_f3_to_e5.webm', from: 'f3', to: 'e5' });
  }
  await exportOne({ id: 'noncapture_e4', title: 'non-capture e4 with shatter selected (no effect expected)', pgn: L.LEGAL_PGN, ply: 1, fx: 'shatter', expectName: 'move_e2_to_e4.webm', minCalls: 0, from: 'e2', to: 'e4' });
  await exportOne({ id: 'castling', title: 'O-O', pgn: L.CASTLE_PGN, ply: 7, fx: 'dissolve', expectName: 'move_e1_to_g1.webm', minCalls: 0, from: 'e1', to: 'g1' });
  await exportOne({ id: 'en_passant', title: 'exd6 e.p.', pgn: L.EP_PGN, ply: 5, fx: 'dissolve', expectName: 'move_e5_to_d6.webm', from: 'e5', to: 'd6' });
  await exportOne({ id: 'promotion', title: 'bxa8=Q', pgn: L.PROMO_PGN, ply: 9, fx: 'dissolve', expectName: 'move_b7_to_a8.webm', from: 'b7', to: 'a8' });
  await exportOne({ id: 'last_move_mate', title: 'final move Nd5# (last ply, previewed not live)', pgn: L.LEGAL_PGN, ply: 13, fx: 'dissolve', expectName: 'move_c3_to_d5.webm', minCalls: 0, from: 'c3', to: 'd5', mate: true });
  const p = results.filter((r) => r.pass).length;
  console.log(`\n==== exports: ${p}/${results.length} passed ====`);
  fs.writeFileSync(`${L.OUT}/results_export_${LABEL}.json`, JSON.stringify(results));
})();
