// Story lint for Chess Cinema plans (Phase 5A). Test-time only; never modifies the page under test.
//
// Usage: node story_lint.js <html> <packet-dir>
//        node story_lint.js <html> --pgn <file> --plan <file> [--storyboard <file>] [--target-s <n>] [--moments 9,11,13]
//
// A packet directory holds game.pgn, plan.json and optionally storyboard.md and expected.json (whose
// "lint_context" gives target_s and the plies the analysis lists as moments).
//
// The plan is run through the page's own Validate and Apply. Everything measured comes from the page: the
// validation report, the timeline of the applied plan (#planTimeline: start, landing, end and hold of every move)
// and its camera summary (the inspector's data-cam* fields, which the page derives from the camera track the
// export renders). Nothing here re-derives holds or camera framing.
//
// Results come in three tiers:
//   hard    — correctness: the plan is invalid or was not applied, cannot be exported, gives no analysis source,
//             or its storyboard names a ply/SAN that is not the game's or leaves an emphasized ply without evidence.
//             Any hard failure makes the exit code 1.
//   quality — subjective story-quality warnings against PROVISIONAL thresholds (THRESHOLDS below). They are
//             prompts for a reviewer, not failures: a plan may rightly miss one to stay accurate or coherent.
//   notes   — information (each camera reversal, automatic framing on, moments outside the range, ...).
const { chromium } = require('playwright');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

// chess.js 0.12.0 (the version the page loads from cdnjs), served to the page in place of the CDN copy.
// Fetch it with tests/setup.sh on the test-harness branch, or:
//   mkdir -p tests/.cache/chess.js-0.12.0 && (cd tests/.cache/chess.js-0.12.0 && npm pack chess.js@0.12.0 && tar xzf chess.js-0.12.0.tgz)
const CHESS_JS = process.env.CHESS_JS || path.resolve(__dirname, '../.cache/chess.js-0.12.0/package/chess.js');
const CHESS_JS_SHA256 = 'ff18b066d1cac6a82f0dde715b6273f5f47760c5d7043db3d0c3504bca988657';

// Provisional (Phase 5A), for 15–45 s short-form videos. See docs/chess-cinema/storytelling-guide.md.
const THRESHOLDS = {
  maxEmphasizedShare: 0.25,   // emphasized plies / plies in the range
  anticipationRatio: 1.5,     // hold of the ply before a combination's first strike / median setup hold
  contrastRatio: 2,           // median hold of framed plies / median setup hold
  minFinalHoldMs: 2000,       // hold on the last ply
  durationTolerance: 0.15,    // |duration - target| / target
  shortForm: [15, 45],        // seconds, when no target is given
  heldMs: 900,                // a requested hold_ms at or above this emphasizes an unframed ply
  maxReversalsPerCombination: 1,
};

const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const median = (xs) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b), h = s.length >> 1; return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2; };
const r2 = (x) => Math.round(x * 100) / 100;

function pageInfo(html) {
  if (!html || !path.isAbsolute(html) || !fs.existsSync(html)) throw new Error(`give the absolute path of the application's index.html (got ${html})`);
  let commit = 'unknown', branch = 'unknown';
  try {
    commit = execFileSync('git', ['-C', path.dirname(html), 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    branch = execFileSync('git', ['-C', path.dirname(html), 'rev-parse', '--abbrev-ref', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch (e) {}
  return { path: html, sha256: sha256(html), branch, commit };
}

async function openPage(html) {
  if (!fs.existsSync(CHESS_JS)) throw new Error(`chess.js 0.12.0 not found at ${CHESS_JS} (set CHESS_JS, or fetch it: see the top of story_lint.js)`);
  if (sha256(CHESS_JS) !== CHESS_JS_SHA256) throw new Error(`${CHESS_JS} is not chess.js 0.12.0 (SHA-256 differs)`);
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
  await page.route('**/chess.min.js', (r) => r.fulfill({ path: CHESS_JS, contentType: 'application/javascript' }));
  await page.goto('file://' + html);
  await page.waitForFunction(() => typeof Chess === 'function' && typeof game !== 'undefined' && !!game);
  return { browser, page, errors };
}

// Import is synchronous; the status line says whether the whole PGN was read.
async function loadGame(page, pgn) {
  await page.fill('#pgnInput', pgn);
  await page.click('#importPgn');
  const status = await page.locator('#pgnStatus').innerText();
  if (!/^Imported \d+ moves\./.test(status)) throw new Error('the PGN was not imported completely: ' + status);
  await page.waitForFunction(() => animHideSquares.size === 0);
}

// The panel's buttons complete asynchronously (the fingerprint): wait for its run counter.
const openPanel = (page) => page.evaluate(() => { document.getElementById('planPanel').open = true; });
async function runAndWait(page, button) {
  await openPanel(page);
  const seq = await page.evaluate(() => document.getElementById('planPanel').dataset.seq || '0');
  await page.click(button);
  await page.waitForFunction((s) => (document.getElementById('planPanel').dataset.seq || '0') !== s, seq, { timeout: 30000 });
}
const readReport = (page) => page.evaluate(() => {
  const p = document.getElementById('planPanel');
  return {
    result: p.dataset.result || '', active: p.dataset.active === '1',
    entries: [...document.querySelectorAll('#planReport li[data-code]')].map((li) => ({ severity: li.dataset.severity, code: li.dataset.code, path: li.dataset.path })),
    text: document.getElementById('planReportText').value,
  };
});
async function validatePlan(page, text) { await openPanel(page); await page.fill('#planInput', text); await runAndWait(page, '#validatePlan'); return readReport(page); }
async function applyPlan(page, text) { await openPanel(page); await page.fill('#planInput', text); await runAndWait(page, '#applyPlan'); return readReport(page); }
// What "Copy game header" gives for the loaded game (the clipboard itself may be unavailable when headless).
async function copyGameHeader(page) { await runAndWait(page, '#copyGameHeader'); return JSON.parse(await page.locator('#gameHeaderText').inputValue()); }

// The applied plan's timeline and camera, as the inspector shows them.
const readTimeline = (page) => page.evaluate(() => {
  const foot = document.querySelector('#planTimeline [data-cam-ending]:not([data-ply])');
  const moves = [...document.querySelectorAll('#planTimeline [data-ply]')].map((d) => ({
    ply: +d.dataset.ply, start: +d.dataset.start, land: +d.dataset.land, end: +d.dataset.end, holdMs: Math.round(+d.dataset.holdMs), holdReason: d.dataset.holdReason,
    auto: d.dataset.auto === '1', camEntry: d.dataset.camEntry, camEntryFrames: d.dataset.camEntryFrames, camTracking: d.dataset.camTracking === '1', camAfter: d.dataset.camAfter,
    camSettle: +d.dataset.camSettle, camOwn: d.dataset.camOwn, camBox: +d.dataset.camBox, camEnding: d.dataset.camEnding, camReturn: d.dataset.camReturn }));
  return { fps: EXPORT_FPS, maxFrames: MAX_EXPORT_FRAMES, totalFrames: foot ? +foot.dataset.totalFrames : 0, ending: foot ? foot.dataset.camEnding : '', moves };
});
const readRecords = (page) => page.evaluate(() => moveHistory.map((r) => ({ ply: r.ply, san: r.san, capture: !!r.captured, check: !!r.checkSquare, mate: /#$/.test(r.san || '') })));

// Storyboard table rows: | Ply | SAN | Role | Evidence from the analysis | ... (first cell a ply number).
function parseStoryboard(md) {
  const rows = [];
  for (const line of md.split('\n')) {
    const cells = line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
    if (cells.length >= 4 && /^\d+$/.test(cells[0])) rows.push({ ply: +cells[0], san: cells[1].replace(/`/g, ''), role: cells[2], evidence: cells[3] });
  }
  return rows;
}
const normSan = (s) => { const t = String(s).replace(/^\d+(\.+|…)\s*/, '').replace(/[+#!?]+$/, ''); return t === '0-0' ? 'O-O' : t === '0-0-0' ? 'O-O-O' : t; };

// Measures and judges one plan on a page that already has its game loaded.
async function lintOnPage(page, planText, ctx = {}) {
  const out = { hard: [], quality: [], notes: [], metrics: {} };
  const hard = (id, msg) => out.hard.push({ id, msg }), quality = (id, msg) => out.quality.push({ id, msg }), note = (id, msg) => out.notes.push({ id, msg });
  out.validate = await validatePlan(page, planText);
  if (out.validate.result !== 'valid') { hard('H_INVALID', 'Validate: ' + out.validate.entries.filter((e) => e.severity === 'error').map((e) => `${e.code}@${e.path}`).join(', ')); return out; }
  out.apply = await applyPlan(page, planText);
  if (out.apply.result !== 'applied' || !out.apply.active) { hard('H_NOT_APPLIED', 'Apply: ' + out.apply.entries.filter((e) => e.severity === 'error').map((e) => `${e.code}@${e.path}`).join(', ')); return out; }
  const plan = JSON.parse(planText), T = await readTimeline(page), recs = await readRecords(page);
  out.timeline = T;
  const from = T.moves[0].ply, to = T.moves[T.moves.length - 1].ply, inRange = (p) => p >= from && p <= to;
  const dirs = new Map((plan.moves || []).filter((d) => inRange(d.ply)).map((d) => [d.ply, d]));
  const held = new Map(T.moves.map((m) => [m.ply, m.holdMs]));
  const seconds = T.totalFrames / T.fps;
  out.metrics.frames = T.totalFrames; out.metrics.seconds = r2(seconds);

  // Correctness.
  for (const e of out.apply.entries) {
    if (e.code === 'W_TOO_LONG') hard('H_TOO_LONG', `${T.totalFrames} frames: more than the export limit (${T.maxFrames})`);
    if (e.code === 'W_CLOSEUP_IS_FULL') quality('Q_CLOSEUP_IS_FULL', `${e.path}: the close-up asked for would be the whole board`);
    if (e.code === 'W_HOLD_RAISED') quality('Q_HOLD_RAISED', `${e.path}: a requested hold is below the app's minimum and was raised`);
  }
  if (!(plan.analysis && typeof plan.analysis.source === 'string' && plan.analysis.source.trim())) hard('H_SOURCE_MISSING', 'analysis.source does not name where the analysis came from');

  // What the plan emphasizes. A strike is framed close (or with Story Targets); marks also frame a ply; a long
  // requested hold emphasizes an unframed ply (tension, a reply).
  const role = (p) => {
    const d = dirs.get(p); if (!d) return 'setup';
    const fr = d.frame || {}, mk = d.marks || {};
    if (fr.mode === 'close' || (fr.targets || []).length) return 'strike';
    if ((mk.highlights || []).length || (mk.arrows || []).length) return 'marked';
    if (d.hold_ms != null && d.hold_ms >= THRESHOLDS.heldMs) return 'held';
    return 'setup';
  };
  const plies = T.moves.map((m) => m.ply), roles = new Map(plies.map((p) => [p, role(p)]));
  const emphasized = plies.filter((p) => roles.get(p) !== 'setup'), strikes = plies.filter((p) => roles.get(p) === 'strike');
  const setup = plies.filter((p) => roles.get(p) === 'setup' && p !== to);
  const setupMedian = median(setup.map((p) => held.get(p)));
  out.metrics.roles = Object.fromEntries(plies.map((p) => [p, roles.get(p)]));
  out.metrics.emphasizedShare = r2(emphasized.length / plies.length);
  out.metrics.setupMedianMs = setupMedian;

  // A combination: strikes at most two plies apart (the reply between them belongs to it).
  const combos = [];
  for (const p of strikes) { const c = combos[combos.length - 1]; if (c && p - c[c.length - 1] <= 2) c.push(p); else combos.push([p]); }
  out.metrics.combinations = combos;

  // Storyboard traceability (correctness, when a storyboard is given).
  if (ctx.storyboard != null) {
    const rows = parseStoryboard(ctx.storyboard), byPly = new Map(rows.map((r) => [r.ply, r]));
    for (const r of rows) {
      const rec = recs[r.ply - 1];
      if (!rec) hard('H_STORYBOARD_PLY', `storyboard ply ${r.ply} is beyond the game (${recs.length} plies)`);
      else if (normSan(r.san) !== normSan(rec.san)) hard('H_STORYBOARD_SAN', `storyboard ply ${r.ply} says ${r.san}; the game's ply ${r.ply} is ${rec.san}`);
      if (!inRange(r.ply)) note('N_STORYBOARD_OUTSIDE_RANGE', `storyboard row for ply ${r.ply} is outside the range ${from}–${to}`);
    }
    for (const p of emphasized) {
      const r = byPly.get(p);
      if (!r || !r.evidence || /^[-–—]?$/.test(r.evidence)) hard('H_UNTRACED', `ply ${p} (${roles.get(p)}) is emphasized but the storyboard gives no analysis evidence for it`);
    }
  } else note('N_TRACE_NOT_CHECKED', 'no storyboard given: traceability to the analysis was not checked');

  // Story quality (provisional thresholds).
  if (out.metrics.emphasizedShare > THRESHOLDS.maxEmphasizedShare)
    quality('Q_SELECTIVITY', `${emphasized.length} of ${plies.length} plies emphasized (${Math.round(out.metrics.emphasizedShare * 100)} % > ${THRESHOLDS.maxEmphasizedShare * 100} %)`);
  out.metrics.anticipation = [];
  for (const c of combos) {
    const p = c[0] - 1;
    if (!inRange(p)) { note('N_NO_ANTICIPATION_PLY', `the combination from ply ${c[0]} starts the range: no ply before it to hold`); continue; }
    if (setupMedian == null) { note('N_NO_SETUP', 'no setup plies: the anticipation ratio cannot be measured'); continue; }
    const ratio = r2(held.get(p) / setupMedian);
    out.metrics.anticipation.push({ strike: c[0], before: p, holdMs: held.get(p), ratio });
    if (ratio < THRESHOLDS.anticipationRatio) quality('Q_ANTICIPATION', `ply ${p} before the strike at ply ${c[0]} holds ${held.get(p)} ms, ${ratio}× the median setup hold (< ${THRESHOLDS.anticipationRatio}×)`);
  }
  const framedMedian = median(plies.filter((p) => p !== to && (roles.get(p) === 'strike' || roles.get(p) === 'marked')).map((p) => held.get(p)));
  out.metrics.framedMedianMs = framedMedian;
  if (framedMedian != null && setupMedian != null) {
    out.metrics.contrast = r2(framedMedian / setupMedian);
    if (out.metrics.contrast < THRESHOLDS.contrastRatio) quality('Q_CONTRAST', `median framed hold ${framedMedian} ms is ${out.metrics.contrast}× the median setup hold (< ${THRESHOLDS.contrastRatio}×)`);
  } else note('N_NO_CONTRAST', 'no framed plies before the last, or no setup plies: the pacing contrast cannot be measured');
  out.metrics.finalHoldMs = held.get(to);
  if (held.get(to) < THRESHOLDS.minFinalHoldMs) quality('Q_FINAL_HOLD', `the last ply holds ${held.get(to)} ms (< ${THRESHOLDS.minFinalHoldMs} ms)`);
  if (!(plan.ending && typeof plan.ending.return_to_full === 'boolean')) quality('Q_ENDING_IMPLICIT', 'ending.return_to_full is not stated (true or false)');
  if (ctx.targetS) {
    out.metrics.durationError = r2((seconds - ctx.targetS) / ctx.targetS);
    if (Math.abs(out.metrics.durationError) > THRESHOLDS.durationTolerance) quality('Q_DURATION', `${r2(seconds)} s against a target of ${ctx.targetS} s (${Math.round(out.metrics.durationError * 100)} %)`);
  } else if (seconds < THRESHOLDS.shortForm[0] || seconds > THRESHOLDS.shortForm[1]) quality('Q_DURATION', `${r2(seconds)} s is outside ${THRESHOLDS.shortForm[0]}–${THRESHOLDS.shortForm[1]} s`);
  for (const p of ctx.moments || []) {
    if (!inRange(p)) note('N_MOMENT_OUTSIDE_RANGE', `analysis moment at ply ${p} is outside the range ${from}–${to}`);
    else if (roles.get(p) === 'setup' && !(p === to && held.get(to) >= THRESHOLDS.minFinalHoldMs)) quality('Q_MOMENT_NOT_EMPHASIZED', `analysis moment at ply ${p} (${recs[p - 1].san}) gets no emphasis`);
  }
  if (strikes.includes(to) && to < recs.length) quality('Q_ENDS_BEFORE_REPLY', `the story ends on the strike at ply ${to}, before the opponent's reply`);
  for (const p of strikes) {
    const d = dirs.get(p), rec = recs[p - 1], claims = d.claims || [], missing = [];
    if (rec.capture && !claims.includes('capture')) missing.push('capture');
    if (rec.check && !rec.mate && !claims.includes('check')) missing.push('check');
    if (rec.mate && !claims.includes('mate')) missing.push('mate');
    if (missing.length) quality('Q_UNCLAIMED', `ply ${p} (${rec.san}) is a strike without claims: ${missing.join(', ')}`);
  }
  if (plan.defaults && plan.defaults.auto_frame) note('N_AUTO_FRAME', 'automatic close framing is on for every capture and check in the range');

  // Camera continuity, from the inspector: a ply the plan did not ask to be full, whose camera settles on the
  // full board between two close-ups.
  const cam = new Map(T.moves.map((m) => [m.ply, m]));
  const reversals = [];
  for (let i = 1; i < T.moves.length - 1; i++) {
    const m = T.moves[i], d = dirs.get(m.ply);
    if (m.camOwn === 'full' && T.moves[i - 1].camOwn === 'close' && T.moves[i + 1].camOwn === 'close' && !(d && d.frame && d.frame.mode === 'full')) reversals.push(m.ply);
  }
  out.metrics.reversals = reversals;
  const back = (m) => (m.camEntry === 'ease' ? `eases back in (frames ${m.camEntryFrames})` : m.camEntry === 'cut' ? `cuts back in (frame ${m.camEntryFrames})` : `zooms back in after ply ${m.ply} lands (frames ${m.camAfter})`);
  for (const p of reversals) note('N_CAMERA_REVERSAL', `ply ${p}: the camera leaves the close-up of ply ${p - 1} for the full board (frames ${cam.get(p).camEntryFrames}), then ${back(cam.get(p + 1))}`);
  for (const c of combos) {
    const n = reversals.filter((p) => p > c[0] && p < c[c.length - 1]).length;
    if (n > THRESHOLDS.maxReversalsPerCombination) quality('Q_CAMERA_REVERSALS', `${n} camera reversals inside the combination at plies ${c.join(', ')}`);
  }
  return out;
}

function readPacket(dir) {
  const rd = (f) => (fs.existsSync(path.join(dir, f)) ? fs.readFileSync(path.join(dir, f), 'utf8') : null);
  const expected = rd('expected.json') ? JSON.parse(rd('expected.json')) : {};
  const lc = expected.lint_context || {};
  return { dir, pgn: rd('game.pgn'), plan: rd('plan.json'), storyboard: rd('storyboard.md'), expected, ctx: { targetS: lc.target_s, moments: lc.moments || [] } };
}

async function lint(html, { pgn, plan, storyboard, targetS, moments }) {
  const { browser, page, errors } = await openPage(html);
  try {
    await loadGame(page, pgn);
    const out = await lintOnPage(page, plan, { storyboard, targetS, moments });
    out.pageErrors = errors;
    return out;
  } finally { await browser.close(); }
}

function printLint(out) {
  const v = out.validate, a = out.apply;
  console.log(`validate: ${v.result}${v.entries.length ? ' ' + v.entries.map((e) => `${e.severity[0]}:${e.code}@${e.path}`).join(' ') : ''}`);
  if (a) console.log(`apply:    ${a.result}${a.entries.length ? ' ' + a.entries.map((e) => `${e.severity[0]}:${e.code}@${e.path}`).join(' ') : ''}`);
  if (out.timeline) {
    console.log(`timeline: ${out.metrics.frames} frames, ${out.metrics.seconds} s; ending ${out.timeline.ending}`);
    for (const m of out.timeline.moves) console.log(`  ply ${m.ply}: ${out.metrics.roles[m.ply]}, hold ${m.holdMs} ms (${m.holdReason}), camera ${m.camEntry}${m.camEntryFrames ? ' ' + m.camEntryFrames : ''} → ${m.camOwn}${m.camEnding ? ', ending ' + m.camEnding + (m.camReturn ? ' ' + m.camReturn : '') : ''}`);
    console.log('metrics: ' + JSON.stringify({ ...out.metrics, roles: undefined }));
  }
  for (const [tier, list] of [['HARD', out.hard], ['QUALITY', out.quality], ['NOTE', out.notes]]) for (const x of list) console.log(`${tier.padEnd(7)} ${x.id}: ${x.msg}`);
  console.log(`result: ${out.hard.length ? 'FAIL' : 'PASS'} (${out.hard.length} hard, ${out.quality.length} quality warnings, ${out.notes.length} notes)`);
}

module.exports = { THRESHOLDS, CHESS_JS, pageInfo, openPage, loadGame, validatePlan, applyPlan, readReport, copyGameHeader, readTimeline, readRecords, parseStoryboard, lintOnPage, readPacket, lint, printLint };

if (require.main === module) {
  (async () => {
    const [, , html, ...rest] = process.argv;
    const info = pageInfo(html);
    console.log(`page: ${info.path}\nsha256: ${info.sha256}\ngit: ${info.branch} ${info.commit}`);
    let input;
    if (rest[0] && !rest[0].startsWith('--')) {
      const p = readPacket(path.resolve(rest[0]));
      input = { pgn: p.pgn, plan: p.plan, storyboard: p.storyboard, ...p.ctx };
    } else {
      const arg = (k) => { const i = rest.indexOf(k); return i >= 0 ? rest[i + 1] : null; };
      const file = (k) => (arg(k) ? fs.readFileSync(arg(k), 'utf8') : null);
      input = { pgn: file('--pgn'), plan: file('--plan'), storyboard: file('--storyboard'), targetS: arg('--target-s') ? +arg('--target-s') : null, moments: arg('--moments') ? arg('--moments').split(',').map(Number) : [] };
    }
    if (!input.pgn || !input.plan) throw new Error('give a packet directory, or --pgn and --plan');
    const out = await lint(html, input);
    printLint(out);
    if (out.pageErrors.length) console.log('page errors: ' + JSON.stringify(out.pageErrors));
    process.exit(out.hard.length || out.pageErrors.length ? 1 : 0);
  })().catch((e) => { console.error(e); process.exit(2); });
}
