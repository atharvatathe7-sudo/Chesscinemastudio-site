// Usage: node abort_race_test.js <html>
// Race: an export aborts mid-render (lock released at once by the abort), and a new export starts
// before the aborted recorder's asynchronous onstop has fired. That stale onstop must NOT release the
// NEW export's lock. The new export is started from a microtask the moment the button re-enables
// (deterministically ahead of the onstop task); a third click is then attempted during export 2.
const L = require('./lib');
const [, , HTML] = process.argv;
(async () => {
  console.log('mode:', process.env.EXPORT_MODE === 'fallback' ? 'MediaRecorder fallback' : 'WebCodecs');
  const { browser, page } = await L.openPage(HTML, { width: 1280, height: 900 });
  await L.importPgn(page, L.LEGAL_PGN); await L.timelineClick(page, 9);
  const downloads = []; page.on('download', (d) => downloads.push(d.suggestedFilename()));
  await page.evaluate(() => {
    // Recording SESSIONS: one MediaRecorder (fallback) or one colour+alpha VideoEncoder pair (WebCodecs).
    window.__recorders = 0; window.__log = [];
    const R = window.MediaRecorder;
    window.MediaRecorder = function (...a) { window.__recorders++; const r = new R(...a); const n = window.__recorders; r.addEventListener('stop', () => window.__log.push(`rec${n} stop; button disabled=${document.getElementById('exportAnim').disabled}`)); return r; };
    window.MediaRecorder.prototype = R.prototype; window.MediaRecorder.isTypeSupported = R.isTypeSupported;
    if (typeof window.VideoEncoder === 'function') {
      const V = window.VideoEncoder; let k = 0;
      window.VideoEncoder = function (init) {
        const first = k++ % 2 === 0; if (first) window.__recorders++;
        const n = window.__recorders, e = new V(init), close = e.close.bind(e);
        if (first) e.close = () => { window.__log.push(`session${n} encoders closed; button disabled=${document.getElementById('exportAnim').disabled}`); close(); };
        return e;
      };
      window.VideoEncoder.prototype = V.prototype; window.VideoEncoder.isConfigSupported = V.isConfigSupported.bind(V);
    }
    window.__fx = window.drawCaptureEffect;
    window.drawCaptureEffect = function () { throw new Error('render failure (induced)'); };
    const btn = document.getElementById('exportAnim');
    const mo = new MutationObserver(() => {
      if (!btn.disabled && window.__recorders === 1) {          // export 1 just aborted and released the lock
        mo.disconnect();
        window.drawCaptureEffect = window.__fx;                  // export 2 renders normally
        window.__log.push('export 1 aborted; starting export 2 immediately');
        btn.click();
      }
    });
    mo.observe(btn, { attributes: true, childList: true, characterData: true, subtree: true });
  });
  await page.click('#exportAnim');
  await page.waitForFunction(() => window.__recorders === 2, null, { timeout: 30000 });
  await page.waitForTimeout(400);                                // aborted recorder's onstop has fired by now
  const mid = await page.evaluate(() => ({ disabled: document.getElementById('exportAnim').disabled, text: document.getElementById('exportAnim').textContent }));
  await page.locator('#exportAnim').click({ force: true, timeout: 2000 }).catch(() => {}); // third click during export 2
  await page.waitForTimeout(200);
  const recDuring = await page.evaluate(() => window.__recorders);
  await page.waitForFunction(() => !document.getElementById('exportAnim').disabled, null, { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(8000);                               // let any extra (racing) export finish too
  const log = await page.evaluate(() => window.__log);
  const fin = await page.evaluate(() => ({ recorders: window.__recorders, disabled: document.getElementById('exportAnim').disabled, text: document.getElementById('exportAnim').textContent }));
  const checks = [
    ['export 2 stays locked after the aborted recorder stops', mid.disabled && /Exporting/.test(mid.text), JSON.stringify(mid)],
    ['a click during export 2 starts no third recording', recDuring === 2 && fin.recorders === 2, `recording sessions during=${recDuring} final=${fin.recorders}`],
    ['exactly one download (export 2), none from the aborted export', downloads.length === 1, JSON.stringify(downloads)],
    ['button restored at the end', !fin.disabled && fin.text === 'Export Animation', JSON.stringify(fin)]
  ];
  for (const [n, p, d] of checks) console.log(`${p ? 'PASS' : 'FAIL'}  ${n} — ${d}`);
  console.log('event log:', JSON.stringify(log));
  console.log(`==== abort race: ${checks.filter((c) => c[1]).length}/${checks.length} passed ====`);
  await browser.close();
})();
