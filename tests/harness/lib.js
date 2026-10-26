// Shared helpers for the Chess Cinema audit harness. Test-time only; never modifies the page under test.
const { chromium } = require('playwright');
const path = require('path');

// chess.js 0.12.0 (the version the app loads from cdnjs), fetched by tests/setup.sh.
const CHESS_JS = process.env.CHESS_JS || path.resolve(__dirname, '../.cache/chess.js-0.12.0/package/chess.js');
const { Chess } = require(CHESS_JS);
// Every file a test writes (videos, screenshots, JSON) goes under here.
const OUT = process.env.TEST_OUT || path.resolve(__dirname, '../out');

// All PGNs below were verified legal with chess.js 0.12.0 in node before use.
const LEGAL_PGN = '1. e4 e5 2. Nf3 d6 3. Bc4 Bg4 4. Nc3 g6 5. Nxe5 Bxd1 6. Bxf7+ Ke7 7. Nd5#'; // 13 plies, mate
const SECOND_PGN = '1. d4 d5 2. c4 e6 3. Nc3 Nf6 4. cxd5 exd5 5. Bg5 Be7'; // 10 plies
const CASTLE_PGN = '1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 4. O-O Nf6'; // ply 7 = O-O
const EP_PGN = '1. e4 Nf6 2. e5 d5 3. exd6'; // ply 5 = en passant
const PROMO_PGN = '1. a4 h5 2. a5 h4 3. a6 h3 4. axb7 hxg2 5. bxa8=Q gxh1=Q'; // ply 9/10 capture-promotions

// stubChess: true  -> serve the identical chess.js 0.12.0 locally (the sandbox blocks cdnjs)
//            'abort' -> make the CDN request fail, to test the "engine not loaded" error path
async function openPage(htmlPath, viewport, { stubChess = true } = {}) {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport, acceptDownloads: true });
  // EXPORT_MODE=fallback: no WebCodecs encoder, so the export takes its MediaRecorder fallback path.
  if (process.env.EXPORT_MODE === 'fallback') await context.addInitScript(() => { delete window.VideoEncoder; });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
  if (stubChess === true) {
    await page.route('**/chess.min.js', (r) => r.fulfill({ path: CHESS_JS, contentType: 'application/javascript' }));
  } else if (stubChess === 'abort') {
    await page.route('**/chess.min.js', (r) => r.abort());
  }
  await page.goto('file://' + htmlPath);
  await page.waitForTimeout(600);
  return { browser, context, page, errors };
}

async function importPgn(page, pgn) {
  await page.fill('#pgnInput', pgn);
  await page.click('#importPgn');
  await page.waitForTimeout(250);
  return page.locator('#pgnStatus').innerText();
}

async function navState(page) {
  return page.evaluate(() => ({
    historyPointer, selectedPly, importedLimit,
    movesRecorded: moveHistory.length,
    liveFen: game.fen(),
    previewing: !!previewBoard,
    animBusy: animHideSquares.size,
    status: document.getElementById('status-bar').textContent,
    selectedLabel: document.getElementById('selectedMoveLabel').textContent
  }));
}

async function waitIdle(page, timeout = 12000) {
  await page.waitForFunction(() => animHideSquares.size === 0, null, { timeout });
  await page.waitForTimeout(80);
}

// ---- ground truth from an independent chess.js instance ----
function truthAt(pgn, n) {
  const src = new Chess(); src.load_pgn(pgn, { sloppy: true });
  const hist = src.history();
  const c = new Chess();
  for (let i = 0; i < n; i++) c.move(hist[i], { sloppy: true });
  const turn = c.turn();
  let label;
  if (c.in_checkmate()) label = `Checkmate! ${turn === 'w' ? 'Black' : 'White'} wins.`;
  else if (c.in_stalemate()) label = 'Stalemate! Game is a draw.';
  else if (c.in_draw()) label = 'Draw!';
  else label = (turn === 'w' ? "White's Turn" : "Black's Turn") + (c.in_check() ? ' (Check)' : '');
  return { placement: c.fen().split(' ')[0], label, total: hist.length, verbose: src.history({ verbose: true }) };
}

// What the board currently SHOWS (preview snapshot if previewing, else live engine) as a FEN placement string.
async function shownPlacement(page) {
  return page.evaluate(() => {
    const b = previewBoard || game.board();
    return b.map((row) => { let s = '', e = 0; for (const p of row) { if (!p) { e++; continue; } if (e) { s += e; e = 0; } s += p.color === 'w' ? p.type.toUpperCase() : p.type; } if (e) s += e; return s; }).join('/');
  });
}

// Pixel centre of a square on the overlay canvas (handles board flip).
async function sqXY(page, sq, flipped = false) {
  await page.locator('#overlay').scrollIntoViewIfNeeded(); // earlier clicks may have scrolled the board out of view
  const b = await page.locator('#overlay').boundingBox();
  const s = b.width / 8;
  const f = 'abcdefgh'.indexOf(sq[0]); const r = parseInt(sq[1], 10);
  const vf = flipped ? 7 - f : f; const vr = flipped ? r - 1 : 8 - r;
  return { x: b.x + (vf + 0.5) * s, y: b.y + (vr + 0.5) * s };
}
async function dragMove(page, from, to) {
  const a = await sqXY(page, from), b = await sqXY(page, to);
  await page.mouse.move(a.x, a.y); await page.mouse.down();
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 4 });
  await page.mouse.move(b.x, b.y, { steps: 4 }); await page.mouse.up();
  await waitIdle(page, 15000);
}
async function timelineClick(page, ply) {
  await page.locator('#timelineList button').nth(ply - 1).click();
  await page.waitForTimeout(80);
}

module.exports = { chromium, openPage, importPgn, navState, waitIdle, truthAt, shownPlacement, sqXY, dragMove, timelineClick, LEGAL_PGN, SECOND_PGN, CASTLE_PGN, EP_PGN, PROMO_PGN, CHESS_JS, Chess, OUT };
