// Usage: node proto_playback.js <file.webm> <frames> <fps> [--pattern]
// Chrome's own <video> pipeline: metadata duration, then seeks to frames (first, middle, last) and
// reads them back through a canvas -- frame index code and alpha (transparency survives playback).
// (Kept from the Phase 2A WebCodecs prototype; any empty page can host the <video>.)
const fs = require('fs');
const { chromium } = require('./lib');
const [, , FILE, N, FPS, PAT] = process.argv;
(async () => {
  const browser = await chromium.launch(); const page = await browser.newPage();
  await page.setContent('<!doctype html><html><body></body></html>');
  const r = await page.evaluate(async ([b64, n, fps, pat]) => {
    const bin = atob(b64); const u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    const url = URL.createObjectURL(new Blob([u8], { type: 'video/webm' }));
    const v = document.createElement('video'); v.muted = true; v.src = url; v.preload = 'auto'; document.body.appendChild(v);
    await new Promise((res, rej) => { v.onloadeddata = res; v.onerror = () => rej(new Error('video error ' + (v.error && v.error.message))); });
    const out = { duration: v.duration, videoWidth: v.videoWidth, videoHeight: v.videoHeight, frames: [] };
    const c = document.createElement('canvas'); c.width = v.videoWidth; c.height = v.videoHeight; const x = c.getContext('2d', { willReadFrequently: true });
    for (const f of [0, Math.floor(n / 2), n - 1]) {
      v.currentTime = (f + 0.5) / fps; await new Promise((res) => v.onseeked = res);
      x.clearRect(0, 0, c.width, c.height); x.drawImage(v, 0, 0);
      const px = (X, Y) => Array.from(x.getImageData(X, Y, 1, 1).data);
      const rec = { requested: f };
      if (pat) { let k = 0; for (let i = 0; i < 10; i++) { const [R, G, B] = px(80 + i * 100, 80); k = (k << 1) | ((R + G + B) / 3 > 128 ? 1 : 0); } rec.decodedIndex = k; rec.alpha = { opaque: px(540, 480)[3], semi: px(540, 630)[3], clear: px(540, 1030)[3] }; }
      else { rec.corner = px(5, 5); }
      out.frames.push(rec);
    }
    v.currentTime = v.duration; await new Promise((res) => v.onseeked = res); out.endedSeekOk = true;
    return out;
  }, [fs.readFileSync(FILE).toString('base64'), +N, +FPS, PAT === '--pattern']);
  r.durationMatches = Math.abs(r.duration - (+N) / (+FPS)) < 0.002;
  if (PAT === '--pattern') r.framesCorrect = r.frames.every((f) => f.decodedIndex === f.requested && f.alpha.opaque > 250 && Math.abs(f.alpha.semi - 128) < 8 && f.alpha.clear < 4);
  console.log(JSON.stringify(r));
  await browser.close();
})();
