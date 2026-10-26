// Usage: node start_rest_test.js <html>
// A move's first exported frame must show the piece exactly at rest: pixel-identical (FNV hash) to the
// final settled frame of the PREVIOUS move's export, which shows the same position. Unannotated moves
// use the full-board camera, so the framing is the same.
const L = require('./lib');
const { CASES } = require('./p2a_cases');
const [, , HTML] = process.argv;
async function hashes(page, ply) {
  await L.timelineClick(page, ply);
  await page.evaluate(() => {
    window.__h = [];
    const hash = (c) => { const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let h = 2166136261; for (let i = 0; i < d.length; i += 61) { h ^= d[i]; h = Math.imul(h, 16777619); } return h >>> 0; };
    if (!window.__VF) { window.__VF = window.VideoFrame; window.VideoFrame = function (src, init) { if (src instanceof HTMLCanvasElement && src.width === 1080) window.__h.push(hash(src)); return new window.__VF(src, init); }; window.VideoFrame.prototype = window.__VF.prototype; }
  });
  const dl = page.waitForEvent('download', { timeout: 120000 }); await page.click('#exportAnim'); await dl;
  await page.waitForFunction(() => !document.getElementById('exportAnim').disabled);
  return page.evaluate(() => window.__h.slice());
}
(async () => {
  let pass = 0, n = 0;
  for (const c of CASES) {
    if (c.ply === 1) { console.log(`N/A   ${c.id.padEnd(18)} ply 1 has no previous move to export (pawn start-at-rest is covered by pawn_push_1)`); continue; }
    const { browser, page } = await L.openPage(HTML, { width: 1280, height: 900 });
    await L.importPgn(page, c.pgn); await page.selectOption('#captureFx', 'off');
    const prev = await hashes(page, c.ply - 1), cur = await hashes(page, c.ply);
    const same = prev[prev.length - 1] === cur[0]; n++; if (same) pass++;
    console.log(`${same ? 'PASS' : 'FAIL'}  ${c.id.padEnd(18)} first frame of ply ${c.ply} == settled last frame of ply ${c.ply - 1}: ${same} (${cur[0]} vs ${prev[prev.length - 1]})`);
    await browser.close();
  }
  console.log(`==== start at rest: ${pass}/${n} passed ====`);
})();
