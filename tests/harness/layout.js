// Usage: node layout.js <abs html path> <screenshot prefix>
const { openPage } = require('./lib');
const [, , htmlPath, shotPrefix] = process.argv;

const VIEWPORTS = [
  { name: 'desktop-1440x900', width: 1440, height: 900 },
  { name: 'laptop-1280x720', width: 1280, height: 720 },
  { name: 'small-laptop-1024x768', width: 1024, height: 768 },
  { name: 'tablet-768x1024', width: 768, height: 1024 },
  { name: 'phone-390x844', width: 390, height: 844 },
  { name: 'phone-small-360x640', width: 360, height: 640 }
];

(async () => {
  for (const vp of VIEWPORTS) {
    const { browser, page, errors } = await openPage(htmlPath, { width: vp.width, height: vp.height });
    const m = await page.evaluate(() => {
      const r = (sel) => { const e = document.querySelector(sel); if (!e) return null; const b = e.getBoundingClientRect(); return { left: Math.round(b.left), right: Math.round(b.right), top: Math.round(b.top + scrollY), bottom: Math.round(b.bottom + scrollY), w: Math.round(b.width) }; };
      const doc = document.documentElement;
      const panel = r('.panel');
      const fx = r('#captureFx');
      const fxLabel = [...document.querySelectorAll('label')].find((l) => l.textContent.trim().startsWith('Capture FX'));
      const fxLabelRect = fxLabel ? (() => { const b = fxLabel.getBoundingClientRect(); return { left: Math.round(b.left), right: Math.round(b.right), top: Math.round(b.top + scrollY) }; })() : null;
      const modeRow = document.querySelector('#mode').parentElement;
      const modeRowRect = modeRow.getBoundingClientRect();
      return {
        innerWidth, innerHeight,
        docScrollWidth: doc.scrollWidth,
        horizontalOverflow: doc.scrollWidth > innerWidth,
        board: r('#boardHolder'), panel, modeRow: { left: Math.round(modeRowRect.left), right: Math.round(modeRowRect.right), scrollWidth: modeRow.scrollWidth, clientWidth: modeRow.clientWidth },
        captureFxLabel: fxLabelRect, captureFx: fx,
        captureFxFullyInsideViewport: fx ? fx.left >= 0 && fx.right <= innerWidth : null,
        captureFxFullyInsidePanel: fx && panel ? fx.left >= panel.left && fx.right <= panel.right : null,
        captureFxTopPx: fx ? fx.top : null,
        captureFxAboveFold: fx ? fx.top < innerHeight : null,
        pageHeight: doc.scrollHeight,
        panelBelowBoard: panel && r('#boardHolder') ? panel.top >= r('#boardHolder').bottom : null,
        neighbours: ['#mode', '#color', '#clearAll', '#captureFx'].map((s) => ({ s, ...r(s) }))
      };
    });
    console.log('=== ' + vp.name + ' ===');
    console.log(JSON.stringify(m));
    if (shotPrefix) await page.screenshot({ path: `${shotPrefix}_${vp.name}.png`, fullPage: true });
    if (errors.length) console.log('errors:', errors);
    await browser.close();
  }
})();
