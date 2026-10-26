// Usage: node hash_compare.js <labelA> <labelB> [...]
// Compares, per export case, the per-frame pixel hashes recorded by `HASH=1 node export_suite.js`
// (every frame pushed to the recorder, in order) across builds, and the frames actually present in
// each WebM file (EBML block count).
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const S = require('./lib').OUT;
const labels = process.argv.slice(2);
const ids = fs.readdirSync(`${S}/exports/${labels[0]}`).filter((f) => f.endsWith('.hashes.json')).map((f) => f.replace('.hashes.json', '')).sort();
const rows = [];
for (const id of ids) {
  const h = labels.map((l) => JSON.parse(fs.readFileSync(`${S}/exports/${l}/${id}.hashes.json`, 'utf8')));
  const webm = labels.map((l) => JSON.parse(execFileSync('node', [path.join(__dirname, 'webm_frames.js'), `${S}/exports/${l}/${id}.webm`]).toString()));
  const ref = h[0];
  const cmp = h.slice(1).map((x) => {
    let firstDiff = -1; const n = Math.max(x.length, ref.length);
    for (let i = 0; i < n; i++) if (x[i] !== ref[i]) { firstDiff = i; break; }
    return { identical: firstDiff === -1, firstDiff, lengths: [ref.length, x.length] };
  });
  rows.push({ id, pushed: h.map((x) => x.length), distinctFrames: new Set(ref).size, webmFrames: webm.map((w) => w.frames), webmLastMs: webm.map((w) => w.lastMs), effFps: webm.map((w) => w.effectiveFps), identicalToFirst: cmp.map((c) => c.identical), detail: cmp.filter((c) => !c.identical) });
}
console.log(`labels: ${labels.join(' | ')}`);
for (const r of rows) console.log(`${r.identicalToFirst.every(Boolean) ? 'SAME' : 'DIFF'}  ${r.id.padEnd(18)} pushed=${r.pushed.join('/')} distinct=${r.distinctFrames} webmFrames=${r.webmFrames.join('/')} webmLastMs=${r.webmLastMs.join('/')} effFps=${r.effFps.join('/')}${r.detail.length ? ' ' + JSON.stringify(r.detail) : ''}`);
console.log(`==== frame hashes identical in ${rows.filter((r) => r.identicalToFirst.every(Boolean)).length}/${rows.length} cases ====`);
fs.writeFileSync(`${S}/hash_compare_${labels.join('_vs_')}.json`, JSON.stringify(rows, null, 1));
