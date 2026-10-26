// Usage: node sequence_export_test.js <html> [label]
// Stage D/E: complete-sequence export through the real "Export Sequence" button. Every encoded frame is
// checked against an independent expectation (the test's own timeline + chess.js positions), the first
// and last frames against single-move exports, and the file with the system FFmpeg and Chrome playback.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const L = require('./lib');
const B = require('./p2b_lib');
const { QSC_PGN } = require('./p2a_cases');
const [, , HTML, LABEL = 'wip'] = process.argv;
const OUT = path.join(L.OUT, `seqexport_${LABEL}`); fs.mkdirSync(OUT, { recursive: true });
const results = [];
const ok = (name, pass, detail) => { results.push(pass); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name} — ${detail}`); };

async function exportVia(page, button) {
  await B.installExportProbe(page);
  const dl = page.waitForEvent('download', { timeout: 600000 });
  await page.click(button);
  const d = await dl;
  await page.waitForFunction(() => !exportInProgress, null, { timeout: 60000 });
  const frames = await page.evaluate(() => window.__X.frames);
  await page.evaluate(() => { window.__X.frames = []; });
  return { d, frames };
}

async function runCase(c) {
  const { browser, page, errors } = await L.openPage(HTML, { width: 1280, height: 900 });
  await L.importPgn(page, c.pgn);
  await page.selectOption('#captureFx', c.fx === false ? 'off' : 'dissolve');
  for (const [ply, sqs] of Object.entries(c.storyUI || {})) await B.storyTargets(page, +ply, sqs);
  for (const [ply, sq] of Object.entries(c.highlightUI || {})) await B.highlight(page, +ply, sq);
  const tr = B.truth(c.pgn);
  // single-move exports of the first and last ply (reference first/last frames)
  await L.timelineClick(page, c.from); const sFirst = (await exportVia(page, '#exportAnim')).frames;
  await L.timelineClick(page, c.to); const sLast = (await exportVia(page, '#exportAnim')).frames;
  // the sequence
  await B.chooseRange(page, c.from, c.to);
  const t0 = Date.now();
  const { d, frames } = await exportVia(page, '#exportSequence');
  const wall = Date.now() - t0;
  const file = `${OUT}/${c.id}.webm`; await d.saveAs(file);
  const btn = await page.evaluate(() => ({ seq: document.getElementById('exportSequence').textContent, single: document.getElementById('exportAnim').textContent, cancel: document.getElementById('cancelExport').disabled }));
  await browser.close();

  const plan = B.expectedPlan(tr, c.from, c.to, { fx: c.fx !== false, marks: c.marks || {}, story: c.story || {} });
  const N = plan.totalFrames;
  const expName = c.from === c.to ? `move_${tr.moves[c.from - 1].from}_to_${tr.moves[c.from - 1].to}.webm` : `sequence_ply${c.from}-${c.to}.webm`;
  ok(`${c.id}: one file, named ${expName}`, d.suggestedFilename() === expName, d.suggestedFilename());
  ok(`${c.id}: encoder received ${N} frames (independent timeline), timestamps round(n*1e6/30) µs`, frames.length === N && frames.every((f, n) => f.ts === Math.round(n * 1e6 / 30)), `${frames.length} frames`);
  // per-frame content
  const bad = [], plyOfFrame = [];
  frames.forEach((f, n) => {
    const at = B.frameAt(plan, n), mv = tr.moves[at.ply - 1];
    plyOfFrame.push(at.ply);
    if (at.moving) {
      const exp = { ...tr.before[at.ply - 1] }; delete exp[mv.from];
      const rook = mv.flags.includes('k') ? (mv.color === 'w' ? 'h1' : 'h8') : mv.flags.includes('q') ? (mv.color === 'w' ? 'a1' : 'a8') : null;
      if (rook) delete exp[rook];
      const st = {}; f.statics.forEach((s) => { const [p, sq] = s.split('@'); st[sq] = p; });
      const types = f.movers.map((m) => m.p).sort().join(','), wantTypes = [mv.color + mv.piece].concat(rook ? [mv.color + 'r'] : []).sort().join(',');
      if (!B.samePlacement(st, exp)) bad.push(`f${n} ply${at.ply} moving statics ${B.diffPlacement(st, exp)}`);
      if (types !== wantTypes) bad.push(`f${n} ply${at.ply} movers ${types} want ${wantTypes}`);
      if (f.fx !== null && f.fx >= 0 && f.fx < 1) bad.push(`f${n} effect while moving`);
    } else {
      const pl = B.framePlacement(f);
      if (!B.samePlacement(pl, tr.after[at.ply - 1])) bad.push(`f${n} ply${at.ply} hold ${at.holdIndex} board ${B.diffPlacement(pl, tr.after[at.ply - 1])}`);
      if (f.movers.some((m) => m.angle !== 0)) bad.push(`f${n} landed piece not at rest`);
      const wantFx = (mv.captured && c.fx !== false && at.holdIndex < 15) ? at.holdIndex / 15 : null;
      // drawCaptureEffect draws nothing outside 0 <= progress < 1 (it is still called after the beat)
      const drawn = (f.fx !== null && f.fx >= 0 && f.fx < 1) ? f.fx : null;
      if ((drawn === null) !== (wantFx === null) || (wantFx !== null && Math.abs(drawn - wantFx) > 1e-9)) bad.push(`f${n} ply${at.ply} effect ${f.fx} want ${wantFx}`);
    }
  });
  ok(`${c.id}: every frame shows the scheduled ply, phase and position (chess.js); victim stands until landing; effect only on capture beats`, bad.length === 0, bad.slice(0, 4).join(' | ') || `${N} frames checked`);
  const order = [...new Set(plyOfFrame)];
  ok(`${c.id}: plies appear in order, each exactly once, none missing`, JSON.stringify(order) === JSON.stringify(Array.from({ length: c.to - c.from + 1 }, (_, i) => c.from + i)), JSON.stringify(order));
  ok(`${c.id}: first frame = single-move export's first frame of ply ${c.from} (pixel hash)`, frames[0].hash === sFirst[0].hash, `${frames[0].hash} vs ${sFirst[0].hash}`);
  ok(`${c.id}: last frame = single-move export's last (closing) frame of ply ${c.to} (pixel hash)`, frames[N - 1].hash === sLast[sLast.length - 1].hash, `${frames[N - 1].hash} vs ${sLast[sLast.length - 1].hash}`);
  ok(`${c.id}: no blank frames (every frame draws the board and pieces)`, frames.every((f) => f.statics.length + f.movers.length > 0), '');
  ok(`${c.id}: buttons restored after the export`, btn.seq === 'Export Sequence' && btn.single === 'Export Animation' && btn.cancel, JSON.stringify(btn));
  // the file, independently
  const v = JSON.parse(execFileSync('node', [path.join(__dirname, 'validate_webm.js'), file, String(N), '30', '--json', file + '.json']).toString());
  ok(`${c.id}: FFmpeg: ${N} packets and decoded frames, timestamps exactly round(n*1000/30), ${(N / 30).toFixed(3)} s, VP9 1080x1080, alpha_mode 1`, v.pass && v.codec === 'vp9' && v.width === 1080 && v.height === 1080 && v.alphaMode === '1',
    `packets ${v.packets} decoded ${v.decodedFrames} ptsExact ${v.ptsExact} duration ${v.containerDurationSec}s alpha ${v.alphaMode} ${v.problems.join(',')}`);
  const pb = JSON.parse(execFileSync('node', [path.join(__dirname, 'proto_playback.js'), file, String(N), '30']).toString());
  ok(`${c.id}: Chrome <video> plays it: duration ${(N / 30).toFixed(3)} s, seeks to the last frame`, pb.durationMatches && pb.endedSeekOk && pb.videoWidth === 1080, `duration ${pb.duration}`);
  ok(`${c.id}: no page errors`, errors.length === 0, JSON.stringify(errors));
  console.log(`   ${c.id}: ${N} frames, ${(N / 30).toFixed(2)} s video, exported in ${wall} ms, ${fs.statSync(file).size} bytes`);
}

(async () => {
  const CASES = [
    { id: 'legal_full_1-13', pgn: L.LEGAL_PGN, from: 1, to: 13 },
    { id: 'legal_middle_5-9', pgn: L.LEGAL_PGN, from: 5, to: 9 },
    { id: 'legal_first_1-1', pgn: L.LEGAL_PGN, from: 1, to: 1 },
    { id: 'legal_last_13-13', pgn: L.LEGAL_PGN, from: 13, to: 13 },
    { id: 'castle_OO_1-8', pgn: L.CASTLE_PGN, from: 1, to: 8 },
    { id: 'castle_OOO_1-9', pgn: QSC_PGN, from: 1, to: 9 },
    { id: 'en_passant_1-5', pgn: L.EP_PGN, from: 1, to: 5 },
    { id: 'promotion_1-10', pgn: L.PROMO_PGN, from: 1, to: 10 },
    { id: 'story_highlight_6-10', pgn: L.LEGAL_PGN, from: 6, to: 10, storyUI: { 9: ['c6', 'f6'] }, highlightUI: { 7: 'f7' }, marks: { 9: true, 7: true }, story: { 9: true } },
    { id: 'fx_off_1-13', pgn: L.LEGAL_PGN, from: 1, to: 13, fx: false }
  ];
  for (const c of CASES) await runCase(c);
  console.log(`==== sequence export: ${results.filter(Boolean).length}/${results.length} passed ====`);
})();
