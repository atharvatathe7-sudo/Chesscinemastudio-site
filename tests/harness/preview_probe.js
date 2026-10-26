// Live-preview instrumentation (page source untouched). Records, for every DISPLAYED animation frame,
// what the user sees: the moving pieces on the overlay (piece, x, y, scale, angle), the static pieces on
// the board canvas, and whether a capture effect was drawn. A frame's displayed state is the state after
// the LAST rAF callback carrying that frame's timestamp (castling runs two callbacks per frame).
const L = require('./lib');

async function installProbe(page) {
  await page.evaluate(() => {
    const kind = new Map();
    for (const c of ['w', 'b']) for (const t of ['p', 'n', 'b', 'r', 'q', 'k']) if (pieceImages[c] && pieceImages[c][t]) kind.set(pieceImages[c][t], c + t);
    const S = LOGICAL_SIZE / 8, sqOf = (x, y) => 'abcdefgh'[Math.floor(x / S)] + (8 - Math.floor(y / S));
    let overlay = [], staticPieces = [], fx = 0, inDMI = false;
    window.__pp = { frames: [], start: null };
    const oClear = octx.clearRect.bind(octx);
    octx.clearRect = function (x, y, w, h) { if (w >= LOGICAL_SIZE && h >= LOGICAL_SIZE) overlay = []; return oClear(x, y, w, h); };
    const dmi = window.drawMovingImage;
    window.drawMovingImage = function (img, x, y, scale = 1, angle = 0, useOverlay = true) {
      if (useOverlay && img) overlay.push({ p: kind.get(img), x: +x.toFixed(2), y: +y.toFixed(2), scale: +scale.toFixed(4), angle: +angle.toFixed(4) });
      if (!useOverlay && img && kind.has(img)) staticPieces.push(kind.get(img) + '@' + sqOf(x, y));   // a piece drawn on the board layer
      inDMI = true; try { return dmi.apply(this, arguments); } finally { inDMI = false; }
    };
    const db = window.drawBoard;
    window.drawBoard = function () { staticPieces = []; return db.apply(this, arguments); };
    const cDraw = ctx.drawImage.bind(ctx);
    ctx.drawImage = function (img, ...a) { if (!inDMI && kind.has(img) && a.length === 4) staticPieces.push(kind.get(img) + '@' + sqOf(a[0] + a[2] / 2, a[1] + a[3] / 2)); return cDraw(img, ...a); };
    const dce = window.drawCaptureEffect;
    window.drawCaptureEffect = function (c, effect, victim, progress) { fx = progress; window.__pp.fxCalls = (window.__pp.fxCalls || 0) + 1; return dce.apply(this, arguments); };
    const rAF = window.requestAnimationFrame.bind(window);
    let lastNow = null;
    window.requestAnimationFrame = (cb) => rAF((now) => {
      if (now !== lastNow) { fx = null; lastNow = now; }   // per displayed frame, not per callback
      cb(now);
      if (window.__pp.start === null) window.__pp.start = now;
      const rec = { t: +(now - window.__pp.start).toFixed(2), overlay: overlay.slice(), staticPieces: staticPieces.slice(), fxProgress: fx, busy: animHideSquares.size };
      const fr = window.__pp.frames; if (fr.length && fr[fr.length - 1].t === rec.t) fr[fr.length - 1] = rec; else fr.push(rec);
    });
  });
}

// Plays the selected ply and returns the displayed-frame log.
async function playAndRecord(page, pgn, ply, fx = 'off') {
  await L.importPgn(page, pgn);
  await page.selectOption('#captureFx', fx);
  await L.timelineClick(page, ply);
  await installProbe(page);
  await page.click('#playAnim');
  await L.waitIdle(page);
  await page.waitForTimeout(100);
  return page.evaluate(() => window.__pp.frames);
}
module.exports = { installProbe, playAndRecord };
