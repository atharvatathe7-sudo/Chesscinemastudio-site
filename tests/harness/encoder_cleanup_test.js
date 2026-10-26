// Usage: node encoder_cleanup_test.js <html>
// Resource cleanup of the WebCodecs export path (page source untouched). Instruments every VideoEncoder
// (state, encode calls), every VideoFrame (created vs closed), the export's working canvases (released =
// width 0) and captureStream() calls, then checks the final state after success and after each failure.
const L = require('./lib');
const [, , HTML] = process.argv;
const results = [];
const ok = (name, pass, detail) => { results.push(pass); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name} — ${detail}`); };

const INSTRUMENT = (opts) => {
  const I = window.__I = { encoders: [], framesCreated: 0, framesClosed: 0, canvases: [], captureStreams: 0, encodeCalls: [] };
  const V = window.VideoEncoder;
  window.VideoEncoder = function (init) {
    const idx = I.encoders.length; I.encodeCalls.push(0);
    const e = new V(init); I.encoders.push(e);
    const enc = e.encode.bind(e);
    e.encode = (frame, o) => {
      I.encodeCalls[idx]++;
      if (opts.encodeThrowAt && idx === 0 && I.encodeCalls[idx] === opts.encodeThrowAt) throw new Error('encode failed (induced)');
      if (opts.asyncErrorAt && idx === 0 && I.encodeCalls[idx] === opts.asyncErrorAt) { setTimeout(() => { e.close(); init.error(new DOMException('encoder error (induced)', 'EncodingError')); }, 0); }
      return enc(frame, o);
    };
    return e;
  };
  window.VideoEncoder.prototype = V.prototype; window.VideoEncoder.isConfigSupported = V.isConfigSupported.bind(V);
  const VF = window.VideoFrame;
  window.VideoFrame = function (src, init) { const f = new VF(src, init); I.framesCreated++; const c = f.close.bind(f); f.close = () => { I.framesClosed++; c(); }; return f; };
  const ce = document.createElement.bind(document);
  document.createElement = (tag, ...a) => { const el = ce(tag, ...a); if (String(tag).toLowerCase() === 'canvas') I.canvases.push(el); return el; };
  const cs = HTMLCanvasElement.prototype.captureStream;
  HTMLCanvasElement.prototype.captureStream = function (...a) { I.captureStreams++; return cs.apply(this, a); };
  if (opts.renderThrow) { const fx = window.drawCaptureEffect; window.drawCaptureEffect = function () { throw new Error('render failure (induced)'); }; window.__restoreFx = () => { window.drawCaptureEffect = fx; }; }
  // Export setup failure, before any frame is encoded. (Phase 2A induced it in captureVictim(); since
  // Phase 2B the UI's range info also calls that, so the failure is induced in vacatedSnapshot(), which
  // the export's per-move setup calls and the UI refresh does not.)
  if (opts.setupThrow) { const vs = window.vacatedSnapshot; let n = 0; window.vacatedSnapshot = function (...a) { if (exportInProgress && n++ === 0) throw new Error('setup failure (induced)'); return vs.apply(this, a); }; }
  // A UI refresh that throws while the export takes its lock must not leave the lock held.
  if (opts.uiThrow) { const u = window.updateSequenceControls; let n = 0; window.updateSequenceControls = function (...a) { if (n++ === 0) throw new Error('ui refresh failure (induced)'); return u.apply(this, a); }; }
};
const STATE = () => {
  const I = window.__I, b = document.getElementById('exportAnim');
  return { encoders: I.encoders.map((e) => e.state), encodeCalls: I.encodeCalls.slice(), framesCreated: I.framesCreated, framesClosed: I.framesClosed,
    exportCanvases: I.canvases.filter((c) => c.width === 0 || c.width === 1080 || c.width === 2400).map((c) => c.width), captureStreams: I.captureStreams,
    button: { disabled: b.disabled, text: b.textContent }, message: document.getElementById('message-box').innerText };
};

async function scenario(label, opts, expectDownload) {
  const { browser, page, errors } = await L.openPage(HTML, { width: 1280, height: 900 });
  await L.importPgn(page, L.LEGAL_PGN); await L.timelineClick(page, 9);
  const downloads = []; page.on('download', (d) => downloads.push(d.suggestedFilename()));
  await page.evaluate(INSTRUMENT, opts);
  await page.click('#exportAnim');
  await page.waitForFunction(() => !document.getElementById('exportAnim').disabled, null, { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(1500);
  const s = await page.evaluate(STATE);
  const encAfter = s.encodeCalls.slice(); await page.waitForTimeout(1000); const encLater = (await page.evaluate(STATE)).encodeCalls;
  const allClosed = s.encoders.every((e) => e === 'closed');
  const canvasesReleased = s.exportCanvases.length > 0 && s.exportCanvases.every((w) => w === 0);
  ok(`${label}: encoders closed (${s.encoders.length})`, opts.setupThrow ? s.encoders.length === 0 : (s.encoders.length === 2 && allClosed), JSON.stringify(s.encoders));
  ok(`${label}: every VideoFrame closed`, s.framesCreated === s.framesClosed, `created=${s.framesCreated} closed=${s.framesClosed}`);
  ok(`${label}: working canvases released, no capture stream opened`, canvasesReleased && s.captureStreams === 0, `canvas widths=${JSON.stringify(s.exportCanvases)} captureStreams=${s.captureStreams}`);
  ok(`${label}: lock released, button restored`, !s.button.disabled && s.button.text === 'Export Animation', JSON.stringify(s.button) + ` "${s.message}"`);
  ok(`${label}: ${expectDownload ? 'exactly one download' : 'no file downloaded'}`, downloads.length === (expectDownload ? 1 : 0), JSON.stringify(downloads));
  if (!expectDownload) ok(`${label}: aborted export stops encoding (no encode calls after abort)`, JSON.stringify(encAfter) === JSON.stringify(encLater) && /Export failed/.test(s.message), `encode calls ${JSON.stringify(encAfter)} -> ${JSON.stringify(encLater)}`);
  if (!expectDownload) {
    await page.evaluate(() => { if (window.__restoreFx) window.__restoreFx(); });
    await page.click('#exportAnim');
    await page.waitForFunction(() => !document.getElementById('exportAnim').disabled, null, { timeout: 60000 }); await page.waitForTimeout(1500);
    ok(`${label}: the next export succeeds`, downloads.length === 1, JSON.stringify(downloads));
  }
  ok(`${label}: no uncaught page error`, !errors.some((e) => /PAGEERROR/.test(e)), JSON.stringify(errors.filter((e) => /PAGEERROR/.test(e))));
  await browser.close();
}

(async () => {
  await scenario('success', {}, true);
  await scenario('mid-render throw', { renderThrow: true }, false);
  await scenario('encode() throws at frame 10', { encodeThrowAt: 10 }, false);
  await scenario('async encoder error at frame 10', { asyncErrorAt: 10 }, false);
  await scenario('setup throws before encoding', { setupThrow: true }, false);
  await scenario('UI refresh throws while taking the lock', { uiThrow: true }, true);
  console.log(`==== encoder cleanup: ${results.filter(Boolean).length}/${results.length} passed ====`);
})();
