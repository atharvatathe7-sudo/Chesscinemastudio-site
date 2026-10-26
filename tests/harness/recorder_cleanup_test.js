// Usage: node recorder_cleanup_test.js <html>
// Targeted regression for the "setup fails after recorder.start() but before abortExport exists" leak.
// The page source is untouched: the failure is injected from the harness by making the first call made
// AFTER recorder.start() throw, ONLY while a MediaRecorder is 'recording' (the synchronous window between
// recorder.start() and the frame loop). Phase 1 that call was captureVictim(); since Phase 2A all setup
// precedes the recorder and the call in that window is the "Recording..." showMessage(). Fallback path
// only (run with EXPORT_MODE=fallback); the WebCodecs path is covered by encoder_cleanup_test.js. Every MediaRecorder and every canvas capture stream is recorded so their final state can
// be inspected.
const L = require('./lib');
const [, , HTML] = process.argv;
const results = [];
const ok = (name, pass, detail) => { results.push(pass); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name} — ${detail}`); };

const INSTRUMENT = () => {
  window.__recs = []; window.__streams = [];
  const R = window.MediaRecorder;
  window.MediaRecorder = function (...a) { const r = new R(...a); window.__recs.push(r); return r; };
  window.MediaRecorder.prototype = R.prototype; window.MediaRecorder.isTypeSupported = R.isTypeSupported;
  const cs = HTMLCanvasElement.prototype.captureStream;
  HTMLCanvasElement.prototype.captureStream = function (...a) { const s = cs.apply(this, a); window.__streams.push(s); return s; };
};
const snap = (page) => page.evaluate(() => ({
  recorders: window.__recs.map((r) => r.state),
  tracks: window.__streams.map((s) => s.getTracks().map((t) => t.readyState)),
  button: { disabled: document.getElementById('exportAnim').disabled, text: document.getElementById('exportAnim').textContent },
  message: document.getElementById('message-box').innerText
}));

(async () => {
  // ---- 1. failure after recorder.start(), before abortExport is defined ----
  {
    const { browser, page } = await L.openPage(HTML, { width: 1280, height: 900 });
    const pageErrors = []; page.on('pageerror', (e) => pageErrors.push(e.message));
    await L.importPgn(page, L.LEGAL_PGN); await L.timelineClick(page, 9);
    const downloads = []; page.on('download', (d) => downloads.push(d.suggestedFilename()));
    await page.evaluate(INSTRUMENT);
    await page.evaluate(() => {
      const sm = window.showMessage; window.__thrown = 0;
      window.showMessage = function (...a) {
        if (window.__thrown === 0 && window.__recs.some((r) => r.state === 'recording')) { window.__thrown++; throw new Error('setup failure after recorder.start (induced)'); }
        return sm.apply(this, a);
      };
    });
    await page.click('#exportAnim'); await page.waitForTimeout(3500);
    const s = await snap(page); const thrown = await page.evaluate(() => window.__thrown);
    ok('failure was injected after the recorder had started', thrown === 1 && s.recorders.length === 1, `thrown=${thrown} recorders=${s.recorders.length}`);
    ok('recorder is stopped', s.recorders.every((r) => r === 'inactive'), JSON.stringify(s.recorders));
    ok('canvas capture tracks are released (ended)', s.tracks.length >= 1 && s.tracks.flat().every((t) => t === 'ended'), JSON.stringify(s.tracks));
    ok('export lock cleared, button restored, error shown', !s.button.disabled && s.button.text === 'Export Animation' && /Export failed/.test(s.message), `${JSON.stringify(s.button)} "${s.message}"`);
    ok('no file downloaded (not even after the late stop event)', downloads.length === 0, JSON.stringify(downloads));
    ok('no uncaught page error (e.g. stop event reading an uninitialised variable)', pageErrors.length === 0, JSON.stringify(pageErrors));
    // a following export works normally and is not affected by the old export
    await page.click('#exportAnim');
    await page.waitForFunction(() => !document.getElementById('exportAnim').disabled, null, { timeout: 60000 }); await page.waitForTimeout(1500);
    const s2 = await snap(page);
    ok('the next export succeeds (one download, its own recorder, tracks untouched until it finished)', downloads.length === 1 && s2.recorders.length === 2 && s2.recorders[1] === 'inactive', `downloads=${JSON.stringify(downloads)} recorders=${JSON.stringify(s2.recorders)}`);
    await browser.close();
  }
  // ---- 2. the old export's delayed stop event must not touch a NEWER export ----
  {
    const { browser, page } = await L.openPage(HTML, { width: 1280, height: 900 });
    const pageErrors = []; page.on('pageerror', (e) => pageErrors.push(e.message));
    await L.importPgn(page, L.LEGAL_PGN); await L.timelineClick(page, 9);
    const downloads = []; page.on('download', (d) => downloads.push(d.suggestedFilename()));
    await page.evaluate(INSTRUMENT);
    await page.evaluate(() => {
      const sm = window.showMessage; window.__thrown = 0;
      window.showMessage = function (...a) {
        if (window.__thrown === 0 && window.__recs.some((r) => r.state === 'recording')) { window.__thrown++; throw new Error('setup failure after recorder.start (induced)'); }
        return sm.apply(this, a);
      };
      const btn = document.getElementById('exportAnim');
      const mo = new MutationObserver(() => { if (!btn.disabled && window.__recs.length === 1) { mo.disconnect(); btn.click(); } }); // start export 2 the instant export 1 fails
      mo.observe(btn, { attributes: true, childList: true, characterData: true, subtree: true });
    });
    await page.click('#exportAnim');
    await page.waitForFunction(() => window.__recs.length === 2, null, { timeout: 30000 });
    await page.waitForTimeout(600);                                   // old recorder's stop event has fired by now
    const mid = await snap(page);
    ok('older export\'s stop event leaves export 2 recording, locked, tracks live', mid.recorders[0] === 'inactive' && mid.recorders[1] === 'recording' && mid.button.disabled && mid.tracks[1].every((t) => t === 'live'), `${JSON.stringify(mid.recorders)} tracks=${JSON.stringify(mid.tracks)} button=${JSON.stringify(mid.button)}`);
    await page.locator('#exportAnim').click({ force: true, timeout: 2000 }).catch(() => {});
    await page.waitForFunction(() => !document.getElementById('exportAnim').disabled, null, { timeout: 60000 }); await page.waitForTimeout(1500);
    const fin = await snap(page);
    ok('export 2 completes: exactly one download, no third recorder', downloads.length === 1 && fin.recorders.length === 2, `downloads=${JSON.stringify(downloads)} recorders=${JSON.stringify(fin.recorders)}`);
    ok('no uncaught page error', pageErrors.length === 0, JSON.stringify(pageErrors));
    await browser.close();
  }
  // ---- 3. recorder unsupported: capture tracks are released too ----
  {
    const { browser, page } = await L.openPage(HTML, { width: 1280, height: 900 });
    await L.importPgn(page, L.LEGAL_PGN); await L.timelineClick(page, 9);
    const downloads = []; page.on('download', (d) => downloads.push(d.suggestedFilename()));
    await page.evaluate(INSTRUMENT);
    await page.evaluate(() => { window.MediaRecorder = function () { throw new Error('recorder unavailable (induced)'); }; });
    await page.click('#exportAnim'); await page.waitForTimeout(800);
    const s = await snap(page);
    ok('recorder unsupported: tracks released, lock cleared, no download', s.tracks.length >= 1 && s.tracks.flat().every((t) => t === 'ended') && !s.button.disabled && downloads.length === 0 && /not supported/.test(s.message), `tracks=${JSON.stringify(s.tracks)} button=${JSON.stringify(s.button)} downloads=${downloads.length}`);
    await browser.close();
  }
  console.log(`==== recorder cleanup: ${results.filter(Boolean).length}/${results.length} passed ====`);
})();
