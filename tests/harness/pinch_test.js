// Usage: node pinch_test.js <html> <shotPrefix>
// Real two-finger pinch via CDP Input.dispatchTouchEvent (multi-touch), centred on e4.
// Measures the effective on-screen magnification of a magenta e4 highlight against viewTransform.scale,
// and how far e4 drifts from the pinch midpoint (the point that should stay under the fingers).
const fs = require('fs');
const L = require('./lib');
const [, , HTML, SHOT] = process.argv;

(async () => {
  const browser = await L.chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, hasTouch: true });
  const page = await context.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/chess.min.js', (r) => r.fulfill({ path: L.CHESS_JS, contentType: 'application/javascript' }));
  await page.goto('file://' + HTML); await page.waitForTimeout(600);
  await L.importPgn(page, L.LEGAL_PGN); await page.click('#nextMove'); await page.waitForTimeout(150);
  await page.fill('#color', '#ff00ff'); await page.selectOption('#mode', 'highlight');
  let p = await L.sqXY(page, 'e4'); await page.mouse.click(p.x, p.y); await page.waitForTimeout(400);
  await page.selectOption('#mode', 'move');
  await page.locator('#overlay').scrollIntoViewIfNeeded();
  const holder = await page.locator('#boardHolder').boundingBox();
  const box = async (f) => {
    await page.locator('#boardHolder').screenshot({ path: f });
    return page.evaluate(async (b64) => {
      const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
      const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const x = c.getContext('2d'); x.drawImage(img, 0, 0);
      const d = x.getImageData(0, 0, c.width, c.height).data; let a = 1e9, b = 1e9, e = -1, g = -1;
      for (let y = 0; y < c.height; y++) for (let i = 0; i < c.width; i++) { const k = (y * c.width + i) * 4; if (d[k] - d[k + 1] > 45 && d[k + 2] - d[k + 1] > 45) { a = Math.min(a, i); e = Math.max(e, i); b = Math.min(b, y); g = Math.max(g, y); } }
      return e < 0 ? null : { w: e - a + 1, cx: (a + e + 1) / 2, cy: (b + g + 1) / 2 };
    }, fs.readFileSync(f).toString('base64'));
  };
  const before = await box(`${SHOT}_before.png`);
  const cdp = await context.newCDPSession(page);
  async function pinch(cx, cy, d0, d1) {
    const pts = (d) => [{ x: cx - d, y: cy, id: 1 }, { x: cx + d, y: cy, id: 2 }];
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pts(d0) });
    const step = d1 > d0 ? 4 : -4;
    for (let d = d0 + step; step > 0 ? d <= d1 : d >= d1; d += step) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pts(d) }); await page.waitForTimeout(16); }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(300);
  }
  const res = { gestures: [], errors };
  async function measure(label, cx, cy) {
    const vt = await page.evaluate(() => ({ ...viewTransform }));
    const after = await box(`${SHOT}_${label}.png`);
    const mid = { x: cx - holder.x, y: cy - holder.y };
    const eff = after ? after.w / before.w : null;
    const g = { gesture: label, viewTransformScale: +vt.scale.toFixed(3), pan: [+vt.panX.toFixed(1), +vt.panY.toFixed(1)],
      effectiveMagnification: eff && +eff.toFixed(3), magnificationMatchesScale: !!eff && Math.abs(eff - vt.scale) < 0.06,
      e4Centre: after && [after.cx, after.cy], fingerMidpoint: [mid.x, mid.y],
      focalDriftPx: after ? +Math.hypot(after.cx - mid.x, after.cy - mid.y).toFixed(1) : null };
    res.gestures.push(g); return g;
  }
  p = await L.sqXY(page, 'e4');
  await pinch(p.x, p.y, 30, 75); await measure('1_pinch_out_on_e4', p.x, p.y);
  const g1 = res.gestures[0];
  // second pinch-out, centred on wherever e4 is now drawn (exercises the anchor maths while already zoomed)
  const cx2 = holder.x + (g1.e4Centre ? g1.e4Centre[0] : 300), cy2 = holder.y + (g1.e4Centre ? g1.e4Centre[1] : 300);
  await pinch(cx2, cy2, 30, 50); await measure('2_second_pinch_out_on_e4', cx2, cy2);
  // pinch back in far enough to reach scale 1
  await pinch(cx2, cy2, 120, 20); const g3 = await measure('3_pinch_in_to_1x', cx2, cy2);
  g3.restoredHome = g3.viewTransformScale === 1 && g3.pan[0] === 0 && g3.pan[1] === 0 && g3.e4Centre && Math.abs(g3.e4Centre[0] - before.cx) <= 2 && Math.abs(g3.e4Centre[1] - before.cy) <= 2;
  for (const g of res.gestures) console.log(JSON.stringify(g));
  console.log('errors:', JSON.stringify(errors));
  await browser.close();
})();
