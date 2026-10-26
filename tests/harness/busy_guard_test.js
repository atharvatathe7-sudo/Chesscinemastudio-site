// Usage: [EXPORT_MODE=fallback] node busy_guard_test.js <html>
// Export busy guard, driven through the real button. Recording SESSIONS are counted (a WebCodecs export
// creates its colour+alpha encoder pair; a fallback export creates one MediaRecorder) -- the real objects
// are still used. Failure paths are induced by making the real environment fail.
const L = require('./lib');
const [, , HTML] = process.argv;
const results = [];
const ok = (name, pass, detail) => { results.push(pass); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name} — ${detail}`); };
const btnState = (page) => page.evaluate(() => { const b = document.getElementById('exportAnim'); return { disabled: b.disabled, text: b.textContent }; });
const COUNT_SESSIONS = () => {
  window.__sessions = 0;
  const R = window.MediaRecorder;
  window.MediaRecorder = function (...a) { window.__sessions++; return new R(...a); };
  window.MediaRecorder.prototype = R.prototype; window.MediaRecorder.isTypeSupported = R.isTypeSupported;
  if (typeof window.VideoEncoder === 'function') {
    const V = window.VideoEncoder; let n = 0;
    window.VideoEncoder = function (init) { if (n++ % 2 === 0) window.__sessions++; return new V(init); };
    window.VideoEncoder.prototype = V.prototype; window.VideoEncoder.isConfigSupported = V.isConfigSupported.bind(V);
  }
};

(async () => {
  console.log('mode:', process.env.EXPORT_MODE === 'fallback' ? 'MediaRecorder fallback' : 'WebCodecs');
  // ---- 1. double/triple click during a running export, then a follow-up export ----
  {
    const { browser, page, errors } = await L.openPage(HTML, { width: 1280, height: 900 });
    await L.importPgn(page, L.LEGAL_PGN); await L.timelineClick(page, 9);
    await page.evaluate(COUNT_SESSIONS);
    const downloads = []; page.on('download', (d) => downloads.push(d.suggestedFilename()));
    const bb = await page.locator('#exportAnim').boundingBox();
    const cx = bb.x + bb.width / 2, cy = bb.y + bb.height / 2;
    await page.mouse.click(cx, cy);                         // start export
    const during = await btnState(page);
    await page.mouse.click(cx, cy); await page.mouse.click(cx, cy); // two more real clicks while running
    await page.locator('#exportAnim').click({ force: true, timeout: 2000 }).catch(() => {}); // forced click on disabled button
    const stillBusy = await btnState(page);
    await page.waitForFunction(() => !document.getElementById('exportAnim').disabled, null, { timeout: 60000 });
    await page.waitForTimeout(1500);
    const after = await btnState(page);
    const s1 = await page.evaluate(() => window.__sessions);
    ok('during export: button disabled and labelled', during.disabled && /Exporting/.test(during.text) && stillBusy.disabled, JSON.stringify(during) + ' after extra clicks ' + JSON.stringify(stillBusy));
    ok('repeat clicks while exporting start no second recording', s1 === 1, `recording sessions started: ${s1}`);
    ok('exactly one file downloaded for the first export', downloads.length === 1, JSON.stringify(downloads));
    ok('after completion: button enabled with original label', !after.disabled && after.text === 'Export Animation', JSON.stringify(after));
    await page.mouse.click(cx, cy);
    await page.waitForFunction(() => !document.getElementById('exportAnim').disabled, null, { timeout: 60000 });
    await page.waitForTimeout(1500);
    ok('a subsequent export succeeds', downloads.length === 2 && (await page.evaluate(() => window.__sessions)) === 2, `downloads=${JSON.stringify(downloads)}`);
    ok('no console errors in normal flow', errors.length === 0, JSON.stringify(errors));
    await browser.close();
  }
  // ---- 2. no recorder or encoder available -> lock released, no download, next export works ----
  {
    const { browser, page } = await L.openPage(HTML, { width: 1280, height: 900 });
    await L.importPgn(page, L.LEGAL_PGN); await L.timelineClick(page, 9);
    const downloads = []; page.on('download', (d) => downloads.push(d.suggestedFilename()));
    await page.evaluate(() => {
      window.__R = window.MediaRecorder; window.MediaRecorder = function () { throw new Error('recorder unavailable (induced)'); };
      if (typeof VideoEncoder === 'function') { window.__isCS = VideoEncoder.isConfigSupported; VideoEncoder.isConfigSupported = async () => ({ supported: false }); }
    });
    await page.click('#exportAnim'); await page.waitForTimeout(800);
    const st = await btnState(page); const msg = await page.locator('#message-box').innerText();
    ok('recorder/encoder unavailable: lock released, message shown, no download', !st.disabled && st.text === 'Export Animation' && /not supported/.test(msg) && downloads.length === 0, `button=${JSON.stringify(st)} message="${msg}" downloads=${downloads.length}`);
    await page.evaluate(() => { window.MediaRecorder = window.__R; if (window.__isCS) VideoEncoder.isConfigSupported = window.__isCS; });
    await page.click('#exportAnim');
    await page.waitForFunction(() => !document.getElementById('exportAnim').disabled, null, { timeout: 60000 }); await page.waitForTimeout(1500);
    ok('recorder/encoder unavailable: the next export succeeds', downloads.length === 1, JSON.stringify(downloads));
    await browser.close();
  }
  // ---- 2b. (WebCodecs) encoder cannot be created -> abort cleanly ----
  if (process.env.EXPORT_MODE !== 'fallback') {
    const { browser, page } = await L.openPage(HTML, { width: 1280, height: 900 });
    await L.importPgn(page, L.LEGAL_PGN); await L.timelineClick(page, 9);
    const downloads = []; page.on('download', (d) => downloads.push(d.suggestedFilename()));
    await page.evaluate(() => { window.__V = VideoEncoder; const cs = VideoEncoder.isConfigSupported.bind(VideoEncoder); window.VideoEncoder = function () { throw new Error('encoder construction failed (induced)'); }; window.VideoEncoder.isConfigSupported = cs; });
    await page.click('#exportAnim'); await page.waitForTimeout(1000);
    const st = await btnState(page); const msg = await page.locator('#message-box').innerText();
    ok('encoder construction failure: export aborted, lock released, no download', !st.disabled && st.text === 'Export Animation' && /Export failed/.test(msg) && downloads.length === 0, `button=${JSON.stringify(st)} message="${msg}" downloads=${downloads.length}`);
    await page.evaluate(() => { window.VideoEncoder = window.__V; });
    await page.click('#exportAnim');
    await page.waitForFunction(() => !document.getElementById('exportAnim').disabled, null, { timeout: 60000 }); await page.waitForTimeout(1500);
    ok('encoder construction failure: the next export succeeds', downloads.length === 1, JSON.stringify(downloads));
    await browser.close();
  }
  // ---- 3. renderer throws mid-export (at the capture beat) -> abort, lock released, no partial file ----
  {
    const { browser, page, errors } = await L.openPage(HTML, { width: 1280, height: 900 });
    await L.importPgn(page, L.LEGAL_PGN); await L.timelineClick(page, 9);
    const downloads = []; page.on('download', (d) => downloads.push(d.suggestedFilename()));
    await page.evaluate(() => { window.__fx = window.drawCaptureEffect; window.drawCaptureEffect = function () { throw new Error('render failure (induced)'); }; });
    await page.click('#exportAnim');
    await page.waitForFunction(() => !document.getElementById('exportAnim').disabled, null, { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(2500);
    const st = await btnState(page); const msg = await page.locator('#message-box').innerText();
    ok('mid-render failure: export aborted, lock released, no partial download', !st.disabled && st.text === 'Export Animation' && /Export failed/.test(msg) && downloads.length === 0,
      `button=${JSON.stringify(st)} message="${msg}" downloads=${downloads.length} consoleErrors=${errors.filter((e) => /render failure/.test(e)).length}`);
    await page.evaluate(() => { window.drawCaptureEffect = window.__fx; });
    await page.click('#exportAnim');
    await page.waitForFunction(() => !document.getElementById('exportAnim').disabled, null, { timeout: 60000 }); await page.waitForTimeout(1500);
    ok('mid-render failure: the next export succeeds', downloads.length === 1, JSON.stringify(downloads));
    await browser.close();
  }
  console.log(`==== busy guard: ${results.filter(Boolean).length}/${results.length} passed ====`);
})();
