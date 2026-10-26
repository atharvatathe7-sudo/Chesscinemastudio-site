// Usage: node webm_frames.js <file.webm> [...]
// Minimal read-only EBML walker: counts video blocks and their presentation timestamps (ms).
// Masters (Segment, Cluster, BlockGroup, Info) are descended in document order, so MediaRecorder's
// unknown-size Segment/Cluster elements are handled.
const fs = require('fs');
function vint(buf, pos, keepMarker) {
  const b = buf[pos]; let len = 1, mask = 0x80;
  while (len <= 8 && !(b & mask)) { len++; mask >>= 1; }
  let v = keepMarker ? b : (b & (mask - 1));
  let allOnes = (b & (mask - 1)) === mask - 1;
  for (let i = 1; i < len; i++) { v = v * 256 + buf[pos + i]; if (buf[pos + i] !== 0xff) allOnes = false; }
  return { v, len, unknown: !keepMarker && allOnes };
}
const MASTERS = new Set([0x18538067, 0x1f43b675, 0xa0, 0x1549a966]);
function frames(file) {
  const buf = fs.readFileSync(file);
  let pos = 0, clusterTs = 0, scale = 1000000; const ts = [];
  while (pos < buf.length - 2) {
    const id = vint(buf, pos, true); const sz = vint(buf, pos + id.len, false);
    const head = id.len + sz.len, body = pos + head;
    if (MASTERS.has(id.v)) { pos = body; continue; }
    if (id.v === 0x2ad7b1) { scale = buf.readUIntBE(body, sz.v); }
    else if (id.v === 0xe7) { clusterTs = buf.readUIntBE(body, sz.v); }
    else if (id.v === 0xa3 || id.v === 0xa1) { const tn = vint(buf, body, false); const rel = buf.readInt16BE(body + tn.len); ts.push((clusterTs + rel) * scale / 1e6); }
    if (sz.unknown) { pos = body; continue; }
    pos = body + sz.v;
  }
  return ts;
}
for (const f of process.argv.slice(2)) {
  const t = frames(f); const g = t.slice(1).map((x, i) => x - t[i]);
  const mean = g.reduce((a, b) => a + b, 0) / g.length;
  console.log(JSON.stringify({ file: f.split('/').pop(), frames: t.length, firstMs: t[0], lastMs: t[t.length - 1], intervalMs: { mean: +mean.toFixed(1), min: Math.min(...g), max: Math.max(...g) }, effectiveFps: +(1000 / mean).toFixed(1), designedFps: 30 }));
}
