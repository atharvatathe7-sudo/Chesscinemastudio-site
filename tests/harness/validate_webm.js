// Usage: node validate_webm.js <file.webm> <expectedFrames> <fps> [--pattern] [--json out.json]
// Independent validation with the system FFmpeg 6.1 (not Chrome): container metadata, every demuxed
// packet's timestamp, a full decode with the native vp9 decoder (errors are fatal), and a full decode
// with libvpx-vp9 to RGBA (which also decodes the WebM alpha side data). With --pattern, reads the
// prototype's 10-bit frame-index code and alpha probes out of every decoded frame.
const fs = require('fs');
const { execFileSync } = require('child_process');
const [, , FILE, NEXP, FPS, ...rest] = process.argv;
const PATTERN = rest.includes('--pattern');
const JSONOUT = rest.includes('--json') ? rest[rest.indexOf('--json') + 1] : null;
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { maxBuffer: 1 << 30, stdio: ['ignore', 'pipe', 'pipe'], ...opts });
const N = +NEXP, fps = +FPS;
const r = { file: FILE.split('/').pop(), problems: [] };

const probe = JSON.parse(run('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', FILE]).toString());
const st = probe.streams[0];
r.codec = st.codec_name; r.width = st.width; r.height = st.height; r.alphaMode = (st.tags || {}).alpha_mode || (st.tags || {}).ALPHA_MODE || null;
r.avgFrameRate = st.avg_frame_rate; r.containerDurationSec = +probe.format.duration;
const pk = JSON.parse(run('ffprobe', ['-v', 'error', '-select_streams', 'v', '-show_packets', '-show_entries', 'packet=pts_time,flags', '-of', 'json', FILE]).toString()).packets;
r.packets = pk.length;
const pts = pk.map((p) => Math.round(+p.pts_time * 1000));
r.ptsMs = { first: pts[0], last: pts[pts.length - 1] };
const expPts = Array.from({ length: N }, (_, n) => Math.round(n * 1000 / fps));
r.ptsExact = JSON.stringify(pts) === JSON.stringify(expPts);
const gaps = pts.slice(1).map((x, i) => x - pts[i]);
r.ptsGapsMs = { min: Math.min(...gaps), max: Math.max(...gaps), mean: +(gaps.reduce((a, b) => a + b, 0) / gaps.length).toFixed(3) };
r.keyframes = pk.map((p, i) => (p.flags.includes('K') ? i : -1)).filter((i) => i >= 0);
r.playbackDurationSec = +(N / fps).toFixed(4);

// native decoder: must decode every packet without error
let nativeErr = '';
try { run('ffmpeg', ['-v', 'error', '-xerror', '-c:v', 'vp9', '-i', FILE, '-fps_mode', 'passthrough', '-f', 'null', '-']); } catch (e) { nativeErr = String(e.stderr || e.message).slice(0, 300); }
r.nativeVp9DecodeOk = !nativeErr; if (nativeErr) r.nativeVp9Error = nativeErr;
// libvpx decoder with alpha -> RGBA, per-frame md5 (+ pts) and raw pixels
const md5 = run('ffmpeg', ['-v', 'error', '-c:v', 'libvpx-vp9', '-i', FILE, '-fps_mode', 'passthrough', '-pix_fmt', 'rgba', '-f', 'framemd5', '-']).toString()
  .split('\n').filter((l) => l && !l.startsWith('#')).map((l) => l.split(',').map((s) => s.trim()));
r.decodedFrames = md5.length;
r.decodedPtsMs = { first: +md5[0][2], last: +md5[md5.length - 1][2] };
r.decodedMd5 = md5.map((x) => x[5]);

if (PATTERN) {
  // Stream the decode to disk (a long clip is several GB of RGBA), then read it one frame at a time.
  const W = r.width, H = r.height, fsz = W * H * 4;
  const tmp = FILE + '.rgba';
  run('ffmpeg', ['-v', 'error', '-y', '-c:v', 'libvpx-vp9', '-i', FILE, '-fps_mode', 'passthrough', '-pix_fmt', 'rgba', '-f', 'rawvideo', tmp]);
  const fd = fs.openSync(tmp, 'r'), frames = fs.fstatSync(fd).size / fsz, buf = Buffer.alloc(fsz);
  const idx = [], alphaBad = [];
  for (let f = 0; f < frames; f++) {
    fs.readSync(fd, buf, 0, fsz, f * fsz);
    const px = (x, y) => { const o = (y * W + x) * 4; return [buf[o], buf[o + 1], buf[o + 2], buf[o + 3]]; };
    let n = 0; for (let i = 0; i < 10; i++) { const [R, G, B] = px(80 + i * 100, 80); n = (n << 1) | ((R + G + B) / 3 > 128 ? 1 : 0); }
    idx.push(n);
    const opaque = px(540, 480)[3], semi = px(540, 630)[3], clear = px(540, 1030)[3];
    if (opaque < 250 || Math.abs(semi - 128) > 6 || clear > 4) alphaBad.push({ f, opaque, semi, clear });
  }
  fs.closeSync(fd); fs.unlinkSync(tmp);
  r.decodedIndexSequenceCorrect = idx.length === N && idx.every((v, i) => v === (i % 1024));
  r.firstWrongIndex = idx.findIndex((v, i) => v !== (i % 1024));
  r.lastDecodedIndex = idx[idx.length - 1];
  r.alphaChecks = alphaBad.length === 0 ? 'opaque=255, 50% band=~128, transparent=0 in every frame' : alphaBad.slice(0, 3);
}
if (r.codec !== 'vp9') r.problems.push('codec ' + r.codec);
if (r.packets !== N) r.problems.push(`packets ${r.packets} != ${N}`);
if (r.decodedFrames !== N) r.problems.push(`decoded ${r.decodedFrames} != ${N}`);
if (!r.ptsExact) r.problems.push('pts not exactly round(n*1000/fps)');
if (!r.nativeVp9DecodeOk) r.problems.push('native decode error');
if (Math.abs(r.containerDurationSec - N / fps) > 0.0015) r.problems.push(`container duration ${r.containerDurationSec} != ${N / fps}`);
if (PATTERN && !r.decodedIndexSequenceCorrect) r.problems.push('decoded index sequence wrong at ' + r.firstWrongIndex);
if (PATTERN && r.alphaChecks !== 'opaque=255, 50% band=~128, transparent=0 in every frame') r.problems.push('alpha');
r.pass = r.problems.length === 0;
if (JSONOUT) fs.writeFileSync(JSONOUT, JSON.stringify(r));
const show = { ...r }; delete show.decodedMd5;
console.log(JSON.stringify(show));
