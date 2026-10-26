// Phase 2B test support. Everything "expected" here is computed independently of the app:
// the timeline model is the test's own copy of the agreed rules, positions come from chess.js.
const L = require('./lib');
const FPS = 30;
const T = (d) => Math.min(160 + 20 * (d - 1), 280);
const cheb = (a, b) => Math.max(Math.abs(a.charCodeAt(0) - b.charCodeAt(0)), Math.abs(+a[1] - +b[1]));

// chess.js truth: verbose moves + piece placement before/after each ply (map 'e4' -> 'wp').
function truth(pgn) {
  const g = new L.Chess(); if (!g.load_pgn(pgn)) throw new Error('bad PGN ' + pgn);
  const moves = g.history({ verbose: true });
  const r = new L.Chess(); const place = () => { const m = {}; r.board().forEach((row, i) => row.forEach((p, j) => { if (p) m['abcdefgh'[j] + (8 - i)] = p.color + p.type; })); return m; };
  const before = [], after = [];
  for (const mv of moves) { before.push(place()); r.move(mv.san); after.push(place()); }
  return { moves, before, after, check: moves.map((m) => /[+#]$/.test(m.san)) };
}

// Independent timeline (units ms*fps; frame n at n*1000). `marks[ply]` = true when the creator marked
// that ply (Story Targets / arrows / highlights / badge); `story[ply]` = has Story Targets.
// Phase 2C pacing, classified from chess.js SAN and capture flags (not from the app's records):
// viewing interval checkmate 5000 > check 700 > capture 700 > ordinary 450 ms; the range's last move at
// least 1000 ms; hold = max(interval, full camera hold of a marked/last move [30 (+44 Story) frames],
// Capture FX beat [15 frames] when on) — never a sum.
const PACE = { checkmate: 5000, check: 700, capture: 700, ordinary: 450 };
const classOf = (mv) => (/#$/.test(mv.san) ? 'checkmate' : /\+$/.test(mv.san) ? 'check' : mv.captured ? 'capture' : 'ordinary');
function expectedPlan(tr, from, to, { fx = true, marks = {}, story = {} } = {}) {
  const out = []; let cur = 0;
  for (let p = from; p <= to; p++) {
    const mv = tr.moves[p - 1], last = p === to;
    const full = last || !!marks[p];
    const cls = classOf(mv), viewMs = last ? Math.max(PACE[cls], 1000) : PACE[cls];
    const holdU = Math.max(viewMs * FPS, full ? (30 + (story[p] ? 14 + 30 : 0)) * 1000 : 0, (mv.captured && fx) ? 15 * 1000 : 0);
    const Tm = T(cheb(mv.from, mv.to)), start = cur, land = start + Tm * FPS, end = land + holdU;
    out.push({ ply: p, san: mv.san, cls, viewMs, holdMs: holdU / FPS, T: Tm, full, start, land, end, landFrame: Math.ceil(land / 1000) });
    cur = end;
  }
  const totalFrames = Math.ceil(cur / 1000) + 1;
  return { moves: out, totalFrames, durationSec: totalFrames / FPS };
}
function frameAt(plan, n) {
  const u = n * 1000; let k = plan.moves.findIndex((m) => u < m.end); if (k < 0) k = plan.moves.length - 1;
  const m = plan.moves[k];
  return u < m.land ? { k, ply: m.ply, moving: true, tMs: (u - m.start) / FPS } : { k, ply: m.ply, moving: false, holdIndex: n - m.landFrame };
}

// What each EXPORTED frame draws on the export's working canvas: static pieces ('wp@e4') and moving pieces
// (images drawn centred on a translate()), delimited by the encoder's colour VideoFrames; plus a pixel hash.
async function installExportProbe(page) {
  await page.evaluate(() => {
    if (window.__X) { window.__X.frames = []; window.__X.cur = { movers: [], statics: [], fx: null }; return; }   // once per page: hooks must not stack
    const kind = new Map();
    for (const c of ['w', 'b']) for (const t of ['p', 'n', 'b', 'r', 'q', 'k']) if (pieceImages[c] && pieceImages[c][t]) kind.set(pieceImages[c][t], c + t);
    const S = LOGICAL_SIZE / 8, sqOf = (x, y) => 'abcdefgh'[Math.floor(x / S)] + (8 - Math.floor(y / S));
    const X = window.__X = { frames: [], cur: { movers: [], statics: [], fx: null } };
    const P = CanvasRenderingContext2D.prototype;
    const tr = P.translate, rot = P.rotate, di = P.drawImage, sv = P.save, rs = P.restore, cr = P.clearRect;
    const isTemp = (c) => c.canvas && c.canvas.width === 2400;
    P.save = function () { if (isTemp(this)) (this.__st = this.__st || []).push({ x: this.__tx || 0, y: this.__ty || 0, a: this.__ta || 0 }); return sv.apply(this, arguments); };
    P.restore = function () { if (isTemp(this) && this.__st && this.__st.length) { const s = this.__st.pop(); this.__tx = s.x; this.__ty = s.y; this.__ta = s.a; } return rs.apply(this, arguments); };
    P.translate = function (x, y) { if (isTemp(this)) { this.__tx = (this.__tx || 0) + x; this.__ty = (this.__ty || 0) + y; } return tr.apply(this, arguments); };
    P.rotate = function (a) { if (isTemp(this)) this.__ta = (this.__ta || 0) + a; return rot.apply(this, arguments); };
    P.clearRect = function () { if (isTemp(this)) { X.cur.movers = []; X.cur.statics = []; X.cur.fx = null; } return cr.apply(this, arguments); };
    P.drawImage = function (img, ...a) {
      if (isTemp(this) && kind.has(img) && a.length === 4) {
        if (this.__tx !== undefined && Math.abs(a[0] + a[2] / 2) < 1e-9 && Math.abs(a[1] + a[3] / 2) < 1e-9) X.cur.movers.push({ p: kind.get(img), x: +this.__tx.toFixed(2), y: +this.__ty.toFixed(2), angle: +(this.__ta || 0).toFixed(4), sq: sqOf(this.__tx, this.__ty) });
        else X.cur.statics.push(kind.get(img) + '@' + sqOf(a[0] + a[2] / 2, a[1] + a[3] / 2));
      }
      return di.call(this, img, ...a);
    };
    const dce = window.drawCaptureEffect;
    window.drawCaptureEffect = function (c, effect, victim, progress) { if (isTemp(c)) X.cur.fx = progress; return dce.apply(this, arguments); };
    const hash = (c) => { const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let h = 2166136261; for (let i = 0; i < d.length; i += 61) { h ^= d[i]; h = Math.imul(h, 16777619); } return h >>> 0; };
    const VF = window.VideoFrame;
    window.VideoFrame = function (src, init) { if (src instanceof HTMLCanvasElement && src.width === 1080) X.frames.push({ ...X.cur, hash: hash(src), ts: init && init.timestamp }); return new VF(src, init); };
    window.VideoFrame.prototype = VF.prototype;
  });
}
// Board placement implied by an export frame: statics + movers that sit exactly on a square centre.
function framePlacement(f) {
  const m = {};
  for (const s of f.statics) { const [p, sq] = s.split('@'); m[sq] = p; }
  for (const v of f.movers) { const c = { x: ('abcdefgh'.indexOf(v.sq[0]) + 0.5) * 75, y: (8 - +v.sq[1] + 0.5) * 75 }; if (Math.hypot(v.x - c.x, v.y - c.y) < 1e-6) m[v.sq] = v.p; }
  return m;
}
const samePlacement = (a, b) => { const ka = Object.keys(a).sort(), kb = Object.keys(b).sort(); return ka.length === kb.length && ka.every((k, i) => k === kb[i] && a[k] === b[k]); };
const diffPlacement = (a, b) => [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => a[k] !== b[k]).map((k) => `${k}:${a[k] || '-'}/${b[k] || '-'}`).join(' ');

// Choose a range through the real selectors.
async function chooseRange(page, from, to) {
  await page.selectOption('#seqFrom', String(from)); await page.selectOption('#seqTo', String(to));
}
// Mark plies through the real UI: story targets / a highlight on the selected ply.
async function storyTargets(page, ply, squares) {
  await L.timelineClick(page, ply); await page.selectOption('#mode', 'story');
  for (const sq of squares) { const p = await L.sqXY(page, sq); await page.mouse.click(p.x, p.y); await page.waitForTimeout(150); }
  await page.selectOption('#mode', 'move');
}
async function highlight(page, ply, sq) {
  await L.timelineClick(page, ply); await page.selectOption('#mode', 'highlight');
  const p = await L.sqXY(page, sq); await page.mouse.click(p.x, p.y); await page.waitForTimeout(150);
  await page.selectOption('#mode', 'move');
}
module.exports = { FPS, T, cheb, PACE, classOf, truth, expectedPlan, frameAt, installExportProbe, framePlacement, samePlacement, diffPlacement, chooseRange, storyTargets, highlight };
