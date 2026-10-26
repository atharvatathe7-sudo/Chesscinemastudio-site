// Usage: node throttle_test.js <html> <label> [rates=1,4,6]
// Real exports under CDP CPU throttling. Each file is validated against the exact schedule by the system
// FFmpeg (frame count, per-frame timestamps, container duration, full decode), and the decoded frames are
// compared across throttle rates. Expected frames are computed independently (see export_suite.js).
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const L = require('./lib');
const { BISHOP_PGN, QSC_PGN } = require('./p2a_cases');
const [, , HTML, LABEL, RATES = '1,4,6'] = process.argv;
const OUT = path.join(L.OUT, `throttle_${LABEL}`); fs.mkdirSync(OUT, { recursive: true });
const FPS = 30;
const T = (d) => Math.min(160 + 20 * (d - 1), 280);
const CASES = [
  { id: 'capture_Nxe5_dissolve', pgn: L.LEGAL_PGN, ply: 9, fx: 'dissolve', d: 2, hold: 30 },
  { id: 'castle_queenside', pgn: QSC_PGN, ply: 9, fx: 'off', d: 2, hold: 30 },
  { id: 'diag_7sq_capture_burst', pgn: BISHOP_PGN, ply: 11, fx: 'burst', d: 7, hold: 30 },
  { id: 'story_targets_Nxe5', pgn: L.LEGAL_PGN, ply: 9, fx: 'shatter', d: 2, hold: 30 + 14 + 30, story: ['c6', 'f6'] }
];
(async () => {
  const rows = [];
  for (const c of CASES) {
    const N = Math.ceil(T(c.d) * FPS / 1000) + c.hold + 1;
    const md5s = {};
    for (const rate of RATES.split(',').map(Number)) {
      const { browser, page, errors } = await L.openPage(HTML, { width: 1280, height: 900 });
      await L.importPgn(page, c.pgn); await page.selectOption('#captureFx', c.fx); await L.timelineClick(page, c.ply);
      if (c.story) { await page.selectOption('#mode', 'story'); for (const sq of c.story) { const p = await L.sqXY(page, sq); await page.mouse.click(p.x, p.y); await page.waitForTimeout(300); } await page.selectOption('#mode', 'move'); }
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Emulation.setCPUThrottlingRate', { rate });
      const dl = page.waitForEvent('download', { timeout: 300000 }); const t0 = Date.now();
      await page.click('#exportAnim'); const d = await dl; const file = `${OUT}/${c.id}_x${rate}.webm`; await d.saveAs(file);
      const wall = Date.now() - t0;
      await browser.close();
      let v;
      try { v = JSON.parse(execFileSync('node', [path.join(__dirname, 'validate_webm.js'), file, String(N), String(FPS), '--json', file + '.json']).toString()); }
      catch (e) { v = { pass: false, problems: ['validator failed'] }; }
      const full = fs.existsSync(file + '.json') ? JSON.parse(fs.readFileSync(file + '.json')) : {};
      md5s[rate] = full.decodedMd5 || [];
      const r = { case: c.id, throttle: rate + 'x', exportWallMs: wall, expectedFrames: N, packets: v.packets, decoded: v.decodedFrames, ptsExact: v.ptsExact, durationSec: v.containerDurationSec, expectedSec: +(N / FPS).toFixed(4), alphaMode: v.alphaMode, valid: v.pass, problems: v.problems, pageErrors: errors.length };
      rows.push(r); console.log(JSON.stringify(r));
    }
    const rates = Object.keys(md5s), ref = md5s[rates[0]];
    for (const k of rates.slice(1)) {
      const same = md5s[k].filter((m, i) => m === ref[i]).length;
      console.log(`   ${c.id}: decoded frames at ${k}x identical to ${rates[0]}x: ${same}/${ref.length}${md5s[k].length !== ref.length ? ` (lengths ${ref.length} vs ${md5s[k].length})` : ''}`);
      rows.push({ case: c.id, compare: `${k}x vs ${rates[0]}x`, identicalDecodedFrames: `${same}/${ref.length}`, pass: same === ref.length && md5s[k].length === ref.length });
    }
  }
  const failures = rows.filter((r) => (r.valid === false) || (r.pass === false)).length;
  console.log(`==== throttle: ${rows.length - failures}/${rows.length} rows passed ====`);
  fs.writeFileSync(`${OUT}/summary.json`, JSON.stringify(rows, null, 1));
})();
