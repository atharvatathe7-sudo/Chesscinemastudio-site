// Usage: node visual_compare.js <phase1.html> <phase2a.html>
// Settled (landing + hold) frames of Phase 1 vs Phase 2A for annotated / Story Target moves, whose camera
// box is sized from sampled trajectory poses. Per frame: pixel hash (same FNV as the baseline) and the
// camera crop (source rect of the final 9-argument drawImage onto the 1080 canvas, in logical px).
const L = require('./lib');
const [, , A, B] = process.argv;
const CASES = [
  { id: 'story_c6_f6', ply: 9, fx: 'shatter', story: ['c6', 'f6'] },
  { id: 'highlight_arrow', ply: 9, fx: 'dissolve', highlight: ['e5'], arrow: ['f3', 'c6'] },
  { id: 'plain_capture', ply: 9, fx: 'burst' }
];
async function run(html, c) {
  const { browser, page } = await L.openPage(html, { width: 1280, height: 900 });
  await L.importPgn(page, L.LEGAL_PGN); await page.selectOption('#captureFx', c.fx); await L.timelineClick(page, c.ply);
  if (c.story) { await page.selectOption('#mode', 'story'); for (const sq of c.story) { const p = await L.sqXY(page, sq); await page.mouse.click(p.x, p.y); await page.waitForTimeout(300); } }
  if (c.highlight) { await page.selectOption('#mode', 'highlight'); for (const sq of c.highlight) { const p = await L.sqXY(page, sq); await page.mouse.click(p.x, p.y); await page.waitForTimeout(300); } }
  if (c.arrow) { await page.selectOption('#mode', 'arrow'); const a = await L.sqXY(page, c.arrow[0]), b = await L.sqXY(page, c.arrow[1]); await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 8 }); await page.mouse.up(); await page.waitForTimeout(300); }
  await page.selectOption('#mode', 'move');
  const ann = await page.evaluate(() => { const r = getActiveRecord(); return { story: r.storyTargets.slice(), hl: r.highlights.length, ar: r.arrows.length }; });
  await page.evaluate(() => {
    window.__f = []; let crop = null;
    const hash = (c) => { const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let h = 2166136261; for (let i = 0; i < d.length; i += 61) { h ^= d[i]; h = Math.imul(h, 16777619); } return h >>> 0; };
    const di = CanvasRenderingContext2D.prototype.drawImage;
    CanvasRenderingContext2D.prototype.drawImage = function (...a) { if (this.canvas && this.canvas.width === 1080 && a.length === 9) crop = [a[1], a[2], a[3]].map((v) => +(v / 4).toFixed(2)); return di.apply(this, a); };
    const push = (c) => window.__f.push({ h: hash(c), crop });
    const pr = CanvasCaptureMediaStreamTrack.prototype, rq = pr.requestFrame; pr.requestFrame = function () { push(this.canvas); return rq.apply(this, arguments); };
    if (typeof VideoFrame === 'function') { const VF = window.VideoFrame; window.VideoFrame = function (s, i) { if (s instanceof HTMLCanvasElement && s.width === 1080) push(s); return new VF(s, i); }; window.VideoFrame.prototype = VF.prototype; }
  });
  const dl = page.waitForEvent('download', { timeout: 120000 }); await page.click('#exportAnim'); await dl;
  const f = await page.evaluate(() => window.__f); await browser.close();
  return { f, ann };
}
(async () => {
  for (const c of CASES) {
    const a = await run(A, c), b = await run(B, c);
    const hold = Math.min(a.f.length, b.f.length) - 7;           // settled part: everything after the movement frames
    const sa = a.f.slice(-hold), sb = b.f.slice(-hold);
    const sameHash = sa.filter((x, i) => x.h === sb[i].h).length;
    const cropDiff = sa.map((x, i) => Math.max(...x.crop.map((v, k) => Math.abs(v - sb[i].crop[k])))); 
    console.log(`${c.id.padEnd(16)} annotations ${JSON.stringify(b.ann)} | frames phase1 ${a.f.length} / phase2a ${b.f.length} | settled frames pixel-identical ${sameHash}/${hold} | max camera crop difference ${Math.max(...cropDiff).toFixed(2)} logical px (crop box phase1 ${JSON.stringify(sa[sa.length - 1].crop)} vs ${JSON.stringify(sb[sb.length - 1].crop)}) | landing crop ${JSON.stringify(sa[0].crop)} vs ${JSON.stringify(sb[0].crop)}`);
  }
})();
