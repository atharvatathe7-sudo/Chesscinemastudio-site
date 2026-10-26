// Usage: [EXPORT_MODE=fallback] node sequence_cleanup_test.js <html>
// Cancellation, failure and resource cleanup of the SEQUENCE export (page source untouched). Instruments
// encoders, VideoFrames, the export's working canvases, MediaRecorders and capture tracks.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const L = require('./lib');
const B = require('./p2b_lib');
const { longGame } = require('./longgame');
const [, , HTML] = process.argv;
const FALLBACK = process.env.EXPORT_MODE === 'fallback';
const OUT = path.join(L.OUT, 'seqcleanup'); fs.mkdirSync(OUT, { recursive: true });
const results = [];
const ok = (name, pass, detail) => { results.push(pass); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name} — ${detail}`); };
const INSTR = () => {
  const I = window.__I = { encoders: [], framesCreated: 0, framesClosed: 0, canvases: [], recorders: [], streams: [], encodes: 0, labels: [] };
  if (typeof VideoEncoder === 'function') {
    const V = window.VideoEncoder;
    window.VideoEncoder = function (init) { const e = new V(init); I.encoders.push(e); const enc = e.encode.bind(e); e.encode = (f, o) => { I.encodes++; return enc(f, o); }; return e; };
    window.VideoEncoder.prototype = V.prototype; window.VideoEncoder.isConfigSupported = V.isConfigSupported.bind(V);
    const VF = window.VideoFrame;
    window.VideoFrame = function (s, i) { const f = new VF(s, i); I.framesCreated++; const c = f.close.bind(f); f.close = () => { I.framesClosed++; c(); }; return f; };
  }
  const R = window.MediaRecorder;
  window.MediaRecorder = function (...a) { const r = new R(...a); I.recorders.push(r); return r; };
  window.MediaRecorder.prototype = R.prototype; window.MediaRecorder.isTypeSupported = R.isTypeSupported;
  const cs = HTMLCanvasElement.prototype.captureStream;
  HTMLCanvasElement.prototype.captureStream = function (...a) { const s = cs.apply(this, a); I.streams.push(s); return s; };
  const ce = document.createElement.bind(document);
  document.createElement = (t, ...a) => { const el = ce(t, ...a); if (String(t).toLowerCase() === 'canvas') I.canvases.push(el); return el; };
  const btn = document.getElementById('exportSequence');
  new MutationObserver(() => { if (I.labels[I.labels.length - 1] !== btn.textContent) I.labels.push(btn.textContent); }).observe(btn, { childList: true, characterData: true, subtree: true });
};
const ST = () => {
  const I = window.__I;
  return { encoders: I.encoders.map((e) => e.state), framesCreated: I.framesCreated, framesClosed: I.framesClosed, encodes: I.encodes,
    canvases: I.canvases.filter((c) => [0, 1080, 2400].includes(c.width)).map((c) => c.width), recorders: I.recorders.map((r) => r.state),
    tracks: I.streams.map((s) => s.getTracks().map((t) => t.readyState).join('')), exporting: exportInProgress, cancelDisabled: document.getElementById('cancelExport').disabled,
    seqLabel: document.getElementById('exportSequence').textContent, msg: document.getElementById('message-box').innerText, labels: I.labels.slice(0, 6) };
};
const released = (s) => s.encoders.every((e) => e === 'closed') && s.framesCreated === s.framesClosed && s.canvases.length > 0 && s.canvases.every((w) => w === 0) && s.recorders.every((r) => r === 'inactive') && s.tracks.every((t) => t === 'ended' || t === '') && !s.exporting && s.cancelDisabled;

(async () => {
  console.log('mode:', FALLBACK ? 'MediaRecorder fallback' : 'WebCodecs');
  const tr = B.truth(L.LEGAL_PGN), N13 = B.expectedPlan(tr, 1, 13).totalFrames;
  // 1. Cancel mid-sequence, then a full export
  {
    const { browser, page, errors } = await L.openPage(HTML, { width: 1280, height: 900 });
    await L.importPgn(page, L.LEGAL_PGN); await page.evaluate(INSTR);
    const downloads = []; page.on('download', (d) => downloads.push(d));
    await B.chooseRange(page, 1, 13);
    await page.click('#exportSequence');
    await page.waitForFunction(() => /Exporting… [1-9]\d?%/.test(document.getElementById('exportSequence').textContent), null, { timeout: 30000 });
    const mid = await page.evaluate(ST);
    await page.click('#cancelExport');
    await page.waitForTimeout(2500);
    const s = await page.evaluate(ST);
    ok('progress is shown on the Export Sequence button while exporting, Cancel enabled', /Exporting… \d+%/.test(mid.seqLabel) && !mid.cancelDisabled && mid.exporting, `${mid.seqLabel}; labels seen ${JSON.stringify(mid.labels)}`);
    ok('Cancel mid-sequence: everything released, no file, message', released(s) && downloads.length === 0 && /Export cancelled/.test(s.msg) && s.seqLabel === 'Export Sequence',
      JSON.stringify({ enc: s.encoders, frames: `${s.framesCreated}/${s.framesClosed}`, canv: s.canvases, rec: s.recorders, tracks: s.tracks, msg: s.msg, dl: downloads.length }));
    const encAfterCancel = s.encodes; await page.waitForTimeout(1000);
    ok('the cancelled export does no further encoding', (await page.evaluate(ST)).encodes === encAfterCancel, `${encAfterCancel} encode calls`);
    const dl2 = page.waitForEvent('download', { timeout: 300000 }); await page.click('#exportSequence'); const d = await dl2;
    await page.waitForFunction(() => !exportInProgress); const file = `${OUT}/after_cancel_${FALLBACK ? 'fb' : 'wc'}.webm`; await d.saveAs(file);
    const v = JSON.parse(execFileSync('node', [path.join(__dirname, 'validate_webm.js'), file, String(N13), '30']).toString());
    ok('after Cancel, a full sequence export succeeds' + (FALLBACK ? ' (fallback: decodable; timing is real-time)' : ' (exact schedule)'), (FALLBACK ? v.nativeVp9DecodeOk && v.decodedFrames > 0 : v.pass) && downloads.length === 1, `frames ${v.packets}/${N13} ptsExact ${v.ptsExact} ${v.containerDurationSec}s`);
    ok('no page errors', errors.length === 0, JSON.stringify(errors));
    await browser.close();
  }
  // 2. Cancel and start a new export in the same task: the old export must not touch the new one
  {
    const { browser, page } = await L.openPage(HTML, { width: 1280, height: 900 });
    await L.importPgn(page, L.LEGAL_PGN); await page.evaluate(INSTR);
    const downloads = []; page.on('download', (d) => downloads.push(d));
    await B.chooseRange(page, 1, 13);
    await page.click('#exportSequence');
    await page.waitForFunction(() => /Exporting… [1-9]\d?%/.test(document.getElementById('exportSequence').textContent), null, { timeout: 30000 });
    await page.evaluate(() => { document.getElementById('cancelExport').click(); document.getElementById('exportSequence').click(); });
    await page.waitForTimeout(400);
    const mid = await page.evaluate(ST);
    await page.waitForFunction(() => !exportInProgress, null, { timeout: 300000 }); await page.waitForTimeout(1500);
    const s = await page.evaluate(ST);
    ok('cancel + immediate new export: the new export stays locked and running', mid.exporting && /Exporting/.test(mid.seqLabel) && !mid.cancelDisabled, JSON.stringify({ exporting: mid.exporting, label: mid.seqLabel }));
    ok('… and completes: exactly one file, all resources of both released', downloads.length === 1 && released(s), JSON.stringify({ dl: downloads.length, enc: s.encoders, frames: `${s.framesCreated}/${s.framesClosed}`, rec: s.recorders }));
    if (downloads.length === 1) { const file = `${OUT}/race_${FALLBACK ? 'fb' : 'wc'}.webm`; await downloads[0].saveAs(file); const v = JSON.parse(execFileSync('node', [path.join(__dirname, 'validate_webm.js'), file, String(N13), '30']).toString()); ok('… and its file is complete' + (FALLBACK ? ' (decodable)' : ' (exact schedule)'), FALLBACK ? v.nativeVp9DecodeOk : v.pass, `frames ${v.packets}/${N13}`); }
    await browser.close();
  }
  // 3. A render failure in the middle of the sequence
  {
    const { browser, page } = await L.openPage(HTML, { width: 1280, height: 900 });
    await L.importPgn(page, L.LEGAL_PGN); await page.evaluate(INSTR);
    const downloads = []; page.on('download', (d) => downloads.push(d));
    await page.evaluate(() => { window.__fx = window.drawCaptureEffect; window.drawCaptureEffect = function () { throw new Error('render failure (induced)'); }; });
    await B.chooseRange(page, 1, 13);
    await page.click('#exportSequence');
    await page.waitForFunction(() => !exportInProgress, null, { timeout: 120000 }); await page.waitForTimeout(1500);
    const s = await page.evaluate(ST);
    ok('render failure mid-sequence (at 9. Nxe5): aborted, released, no file, error shown', released(s) && downloads.length === 0 && /Export failed/.test(s.msg), JSON.stringify({ enc: s.encoders, frames: `${s.framesCreated}/${s.framesClosed}`, msg: s.msg }));
    await page.evaluate(() => { window.drawCaptureEffect = window.__fx; });
    const dl = page.waitForEvent('download', { timeout: 300000 }); await page.click('#exportSequence'); await dl;
    ok('after the failure, the next export succeeds', true, '1 download');
    await browser.close();
  }
  // 4. Cancel also applies to a single-move export
  {
    const { browser, page } = await L.openPage(HTML, { width: 1280, height: 900 });
    await L.importPgn(page, L.LEGAL_PGN); await page.evaluate(INSTR); await L.timelineClick(page, 9);
    const downloads = []; page.on('download', (d) => downloads.push(d));
    await page.click('#exportAnim');
    await page.waitForFunction(() => /Exporting… [1-9]\d?%/.test(document.getElementById('exportAnim').textContent), null, { timeout: 30000 });
    await page.click('#cancelExport'); await page.waitForTimeout(2000);
    const s = await page.evaluate(ST);
    const lbl = await page.evaluate(() => document.getElementById('exportAnim').textContent);
    ok('Cancel during a single-move export: released, no file, button restored', released(s) && downloads.length === 0 && lbl === 'Export Animation', JSON.stringify({ enc: s.encoders, rec: s.recorders, lbl }));
    await browser.close();
  }
  // 5. A range over the frame limit is refused before any work starts (WebCodecs mode only: same check)
  if (!FALLBACK) {
    const pgn = longGame(2000); const trL = B.truth(pgn); const N = B.expectedPlan(trL, 1, trL.moves.length).totalFrames;
    const { browser, page } = await L.openPage(HTML, { width: 1280, height: 900 });
    await L.importPgn(page, pgn); await page.evaluate(INSTR);
    await B.chooseRange(page, 1, trL.moves.length);
    const u = await page.evaluate(() => ({ info: document.getElementById('seqInfo').textContent, exp: document.getElementById('exportSequence').disabled, play: document.getElementById('playSequence').disabled }));
    ok(`over-limit range (${trL.moves.length} plies, ${N} frames): Export disabled with the reason, Play still allowed`, u.exp && !u.play && /Too long to export \(limit 8400 frames, 280 s\)/.test(u.info), u.info.slice(-140));
    await page.evaluate(() => { document.getElementById('exportSequence').disabled = false; document.getElementById('exportSequence').click(); });
    await page.waitForTimeout(800);
    const s = await page.evaluate(ST);
    ok('forced: refused before any encoder or canvas is created, lock released, reason shown', s.encoders.length === 0 && s.canvases.length === 0 && !s.exporting && /longest export supported is 8400 frames/.test(s.msg), JSON.stringify({ enc: s.encoders.length, canv: s.canvases.length, msg: s.msg.slice(0, 120) }));
    await browser.close();
  }
  console.log(`==== sequence cleanup: ${results.filter(Boolean).length}/${results.length} passed ====`);
})();
