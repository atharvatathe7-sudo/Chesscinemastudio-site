// Usage: node zoom_test.js <html> <shotPrefix>
// Pixel-measured double-tap zoom test. A pure-magenta highlight is put on e4, and its on-screen box is
// measured inside the visible board container (#boardHolder) before zoom, after a double-tap on e4,
// and after a double-tap to unzoom. Then taps on the zoomed board are checked to register on the
// squares that are drawn under them (input/drawing alignment).
const L = require('./lib');
const [, , HTML, SHOT] = process.argv;
const out = { checks: [] };
const ok = (name, pass, detail) => { out.checks.push({ name, pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name} — ${detail}`); };

async function magentaBox(page, file) {
  await page.locator('#boardHolder').screenshot({ path: file });
  return page.evaluate(async (b64) => {
    const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    const x = c.getContext('2d'); x.drawImage(img, 0, 0); const d = x.getImageData(0, 0, c.width, c.height).data;
    let minX = 1e9, minY = 1e9, maxX = -1, maxY = -1, n = 0;
    for (let y = 0; y < c.height; y++) for (let i = 0; i < c.width; i++) {
      const k = (y * c.width + i) * 4, r = d[k], g = d[k + 1], bl = d[k + 2];
      if (r - g > 45 && bl - g > 45) { n++; if (i < minX) minX = i; if (i > maxX) maxX = i; if (y < minY) minY = y; if (y > maxY) maxY = y; }
    }
    return n ? { w: maxX - minX + 1, h: maxY - minY + 1, cx: (minX + maxX + 1) / 2, cy: (minY + maxY + 1) / 2, n, holderW: c.width } : null;
  }, require('fs').readFileSync(file).toString('base64'));
}
const holderPoint = async (page, x, y) => { const b = await page.locator('#boardHolder').boundingBox(); return { x: b.x + x, y: b.y + y }; };

(async () => {
  const { browser, page, errors } = await L.openPage(HTML, { width: 1280, height: 900 });
  await L.importPgn(page, L.LEGAL_PGN);
  await page.click('#nextMove'); await page.waitForTimeout(150);          // ply 1 (e4) live, Black to move
  await page.fill('#color', '#ff00ff');
  await page.selectOption('#mode', 'highlight');
  let p = await L.sqXY(page, 'e4'); await page.mouse.click(p.x, p.y); await page.waitForTimeout(400);
  await page.selectOption('#mode', 'move');
  await page.locator('#overlay').scrollIntoViewIfNeeded();

  const before = await magentaBox(page, `${SHOT}_1_before.png`);
  const sq = before.holderW / 8;
  ok('unzoomed: e4 highlight is one square at e4', Math.abs(before.w - sq) <= 4 && Math.abs(before.cx - 4.5 * sq) <= 4 && Math.abs(before.cy - 4.5 * sq) <= 4,
    `box ${before.w}x${before.h} centred (${before.cx},${before.cy}); expected ${sq}px at (${4.5 * sq},${4.5 * sq})`);

  // double-tap e4 in Move mode
  p = await L.sqXY(page, 'e4');
  await page.mouse.click(p.x, p.y); await page.waitForTimeout(90); await page.mouse.click(p.x, p.y);
  await page.waitForTimeout(800);
  const vt = await page.evaluate(() => ({ ...viewTransform, css: document.getElementById('canvasWrap').style.transform }));
  const zoomed = await magentaBox(page, `${SHOT}_2_zoomed.png`);
  // highlights are drawn slightly inset (72px of a 75px square), so magnification is zoomed size / measured unzoomed size
  const mag = zoomed ? zoomed.w / before.w : null;
  ok('zoomed: effective magnification is 2.5x', zoomed && Math.abs(mag - 2.5) <= 0.06, `e4 drawn ${zoomed ? zoomed.w + 'x' + zoomed.h : 'NOT VISIBLE'}px = ${mag ? mag.toFixed(2) : '?'}x (viewTransform ${JSON.stringify(vt)})`);
  ok('zoomed: tapped square e4 is centred in the visible board', zoomed && Math.abs(zoomed.cx - before.holderW / 2) <= 5 && Math.abs(zoomed.cy - before.holderW / 2) <= 5,
    zoomed ? `centre (${zoomed.cx},${zoomed.cy}); holder centre (${before.holderW / 2},${before.holderW / 2})` : 'e4 not visible at all');

  // input/drawing alignment while zoomed: taps at drawn square centres must register on those squares
  await page.selectOption('#mode', 'highlight');
  const zs = sq * 2.5, c = before.holderW / 2;
  const targets = [['e4', c, c], ['f4', c + zs, c], ['e5', c, c - zs], ['d3', c - zs, c + zs]];
  const hits = [];
  for (const [want, x, y] of targets) {
    const q = await holderPoint(page, x, y); await page.mouse.click(q.x, q.y); await page.waitForTimeout(400);
    hits.push([want, await page.evaluate(() => { const h = getActiveRecord().highlights; return h[h.length - 1].sq; })]);
  }
  ok('zoomed: taps on drawn squares register on those squares (overlay/input aligned)', hits.every(([w, g]) => w === g), JSON.stringify(hits));
  const zoomed2 = await magentaBox(page, `${SHOT}_3_zoomed_with_taps.png`);
  await page.selectOption('#mode', 'move');

  // double-tap again to unzoom
  const q = await holderPoint(page, c, c);
  await page.mouse.click(q.x, q.y); await page.waitForTimeout(90); await page.mouse.click(q.x, q.y);
  await page.waitForTimeout(800);
  const vt2 = await page.evaluate(() => ({ ...viewTransform, css: document.getElementById('canvasWrap').style.transform }));
  // remove the extra highlights so only e4's remains, then measure
  await page.evaluate(() => { const r = getActiveRecord(); r.highlights = r.highlights.slice(0, 1); redrawOverlay(); });
  const after = await magentaBox(page, `${SHOT}_4_unzoomed.png`);
  ok('unzoom: view restored (scale 1, pan 0) and e4 back at its original place/size', vt2.scale === 1 && vt2.panX === 0 && vt2.panY === 0 && after && Math.abs(after.w - before.w) <= 2 && Math.abs(after.cx - before.cx) <= 2 && Math.abs(after.cy - before.cy) <= 2,
    `viewTransform ${JSON.stringify(vt2)}; box ${after ? after.w + ' at (' + after.cx + ',' + after.cy + ')' : 'none'} vs before ${before.w} at (${before.cx},${before.cy})`);
  ok('no console errors', errors.length === 0, JSON.stringify(errors));
  const pass = out.checks.filter((x) => x.pass).length;
  console.log(`==== zoom: ${pass}/${out.checks.length} passed ====`);
  await browser.close();
})();
