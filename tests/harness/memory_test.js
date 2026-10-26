// Usage: node memory_test.js <html> <label> <sizesCsv>   e.g. 1,5,10,20,100,400,800,1300
// Long-sequence reliability: exports plies 1..k of a long legal game through the real UI, sampling the
// summed RSS of every Chromium process (ps) and the page's JS heap during the export; validates each
// file with FFmpeg against the independent timeline.
const fs = require('fs');
const path = require('path');
const { execFileSync, execSync } = require('child_process');
const L = require('./lib');
const B = require('./p2b_lib');
const { longGame } = require('./longgame');
const [, , HTML, LABEL, SIZES = '1,5,10,20,100,400'] = process.argv;
const OUT = path.join(L.OUT, `memory_${LABEL}`); fs.mkdirSync(OUT, { recursive: true });
const rssMB = () => { try { return Math.round(execSync("ps -eo rss=,args= | grep -E 'pw-browsers|chrom' | grep -v grep | awk '{s+=$1} END {print s}'").toString().trim() / 1024); } catch (e) { return null; } };
(async () => {
  const sizes = SIZES.split(',').map(Number), maxPly = Math.max(...sizes);
  const pgn = longGame(Math.max(maxPly, 20)); const tr = B.truth(pgn);
  const rows = [];
  for (const k of sizes) {
    const { browser, page, errors } = await L.openPage(HTML, { width: 1280, height: 900 });
    await L.importPgn(page, pgn);
    await B.chooseRange(page, 1, k);
    const plan = B.expectedPlan(tr, 1, k);
    const info = await page.evaluate(() => document.getElementById('seqInfo').textContent);
    await page.waitForTimeout(500);
    const rss0 = rssMB(), heap0 = await page.evaluate(() => performance.memory.usedJSHeapSize);
    let peakRss = rss0, peakHeap = heap0, samples = 0;
    const timer = setInterval(async () => { const r = rssMB(); if (r > peakRss) peakRss = r; samples++; try { const h = await page.evaluate(() => performance.memory.usedJSHeapSize); if (h > peakHeap) peakHeap = h; } catch (e) {} }, 400);
    const dl = page.waitForEvent('download', { timeout: 3600000 }); const t0 = Date.now();
    await page.click('#exportSequence'); const d = await dl; const wall = Date.now() - t0;
    clearInterval(timer);
    const file = `${OUT}/ply1-${k}.webm`; await d.saveAs(file);
    await page.waitForTimeout(1500);
    const rssAfter = rssMB(), heapAfter = await page.evaluate(() => performance.memory.usedJSHeapSize);
    await browser.close();
    let v; try { v = JSON.parse(execFileSync('node', [path.join(__dirname, 'validate_webm.js'), file, String(plan.totalFrames), '30'], { maxBuffer: 1 << 28 }).toString()); } catch (e) { v = { pass: false, problems: ['validator: ' + String(e.message).slice(0, 120)] }; }
    const r = { plies: k, frames: plan.totalFrames, videoSec: +plan.durationSec.toFixed(2), uiInfoFrames: (info.match(/\((\d+) frames\)/) || [])[1] | 0, exportSec: +(wall / 1000).toFixed(1), msPerFrame: +(wall / plan.totalFrames).toFixed(1),
      fileMB: +(fs.statSync(file).size / 1048576).toFixed(2), rssBeforeMB: rss0, rssPeakMB: peakRss, rssGrowthMB: peakRss - rss0, rssAfterMB: rssAfter, jsHeapPeakMB: +(peakHeap / 1048576).toFixed(1), jsHeapAfterMB: +(heapAfter / 1048576).toFixed(1), samples,
      valid: v.pass, decoded: v.decodedFrames, ptsExact: v.ptsExact, durationSec: v.containerDurationSec, problems: v.problems, pageErrors: errors.length };
    rows.push(r); console.log(JSON.stringify(r));
  }
  fs.writeFileSync(`${OUT}/summary.json`, JSON.stringify(rows, null, 1));
  console.log(`==== memory: ${rows.filter((r) => r.valid && r.uiInfoFrames === r.frames && r.pageErrors === 0).length}/${rows.length} sizes exported and valid ====`);
})();
