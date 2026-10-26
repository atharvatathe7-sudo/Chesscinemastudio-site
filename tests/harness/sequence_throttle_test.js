// Usage: node sequence_throttle_test.js <html> <label> [rates=1,4,6]
// Sequence export under CDP CPU throttling: the file's frames, timestamps and duration must not change.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const L = require('./lib');
const B = require('./p2b_lib');
const [, , HTML, LABEL, RATES = '1,4,6'] = process.argv;
const OUT = path.join(L.OUT, `seqthrottle_${LABEL}`); fs.mkdirSync(OUT, { recursive: true });
const results = [];
const ok = (name, pass, detail) => { results.push(pass); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name} — ${detail}`); };
(async () => {
  const CASES = [{ id: 'legal_1-13', pgn: L.LEGAL_PGN, from: 1, to: 13 }, { id: 'story_6-10', pgn: L.LEGAL_PGN, from: 6, to: 10, storyUI: { 9: ['c6', 'f6'] }, story: { 9: true } }];
  for (const c of CASES) {
    const N = B.expectedPlan(B.truth(c.pgn), c.from, c.to, { story: c.story || {}, marks: c.story || {} }).totalFrames;
    const md5 = {};
    for (const rate of RATES.split(',').map(Number)) {
      const { browser, page, errors } = await L.openPage(HTML, { width: 1280, height: 900 });
      await L.importPgn(page, c.pgn);
      for (const [ply, sqs] of Object.entries(c.storyUI || {})) await B.storyTargets(page, +ply, sqs);
      await B.chooseRange(page, c.from, c.to);
      const cdp = await page.context().newCDPSession(page); await cdp.send('Emulation.setCPUThrottlingRate', { rate });
      const dl = page.waitForEvent('download', { timeout: 1800000 }); const t0 = Date.now();
      await page.click('#exportSequence'); const d = await dl; const wall = Date.now() - t0;
      const file = `${OUT}/${c.id}_x${rate}.webm`; await d.saveAs(file); await browser.close();
      const v = JSON.parse(execFileSync('node', [path.join(__dirname, 'validate_webm.js'), file, String(N), '30', '--json', file + '.json']).toString());
      md5[rate] = JSON.parse(fs.readFileSync(file + '.json')).decodedMd5;
      ok(`${c.id} at ${rate}x CPU throttle: ${N} frames, exact timestamps, ${(N / 30).toFixed(3)} s (export took ${(wall / 1000).toFixed(1)} s)`, v.pass && errors.length === 0, `packets ${v.packets} decoded ${v.decodedFrames} ptsExact ${v.ptsExact} duration ${v.containerDurationSec}s`);
    }
    const rates = Object.keys(md5);
    for (const k of rates.slice(1)) { const same = md5[k].filter((m, i) => m === md5[rates[0]][i]).length; ok(`${c.id}: decoded frames at ${k}x identical to ${rates[0]}x`, same === N && md5[k].length === N, `${same}/${N}`); }
  }
  console.log(`==== sequence throttle: ${results.filter(Boolean).length}/${results.length} passed ====`);
})();
