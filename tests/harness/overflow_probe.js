const { openPage } = require('./lib');
(async () => {
  for (const vp of [{ width: 390, height: 844 }, { width: 360, height: 640 }]) {
    for (const file of process.argv.slice(2)) {
      const { browser, page } = await openPage(file, vp);
      const r = await page.evaluate(() => {
        const out = [];
        for (const el of document.querySelectorAll('body *')) {
          const b = el.getBoundingClientRect();
          if (b.width && b.right > innerWidth + 0.5) out.push({ tag: el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (el.className && typeof el.className === 'string' ? '.' + el.className.split(' ')[0] : ''), right: Math.round(b.right) });
        }
        const panel = getComputedStyle(document.querySelector('.panel'));
        return { innerWidth, docScrollWidth: document.documentElement.scrollWidth, boxSizing: panel.boxSizing, panelWidth: panel.width, over: out.slice(0, 8) };
      });
      console.log(vp.width, file.split('/').pop(), JSON.stringify(r));
      await browser.close();
    }
  }
})();
