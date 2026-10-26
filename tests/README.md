# Chess Cinema regression tests

Browser tests for `public/chess-cinema/index.html`, carried over from Phases 1–2C. They drive the real
page in headless Chromium (Playwright) with real clicks, and check exported videos with FFmpeg.

**Not deployed.** Cloudflare Pages publishes only `public/` (see the main README), so nothing here is
served. There is no `package.json` and no build step, so the site's build (`exit 0`) is unaffected.

## Requirements

- Node.js and Playwright with Chromium (`require('playwright')` must resolve). Last verified with
  Node 22.22, Playwright 1.56.1 and its Chromium, headless.
- FFmpeg and ffprobe on `PATH`, with the `libvpx-vp9` decoder (system FFmpeg 6.1 is known to work).
  `FFMPEG=/path/to/ffmpeg` overrides the binary `export_suite.js` uses for its summary probe.
- `git` (the runner reads reference builds from this repository's history).
- chess.js 0.12.0, fetched by `setup.sh`. The page loads `chess.min.js` 0.12.0 from cdnjs; the tests
  serve the same version (npm build, SHA-256 checked) in its place, so they run offline.

## Running

```sh
tests/setup.sh                       # once: fetches chess.js, checks the tools
tests/run_all.sh                     # every suite, against public/chess-cinema/index.html
tests/run_all.sh path/to/page.html mylabel
ONLY=pacing,flip_guard_webcodecs tests/run_all.sh
```

The runner prints one line per suite and exits non-zero if any suite fails. Logs go to
`tests/out/logs/<label>/`, and videos, screenshots and JSON go to `tests/out/`. Both `out/` and the
fetched `.cache/` are git-ignored. A full run takes roughly an hour; the memory suite (up to 8,400
frames) and the CPU-throttled export suites take the longest.

Single suites can be run directly, e.g. `node tests/harness/pacing_test.js "$PWD/public/chess-cinema/index.html"`
(the HTML path must be absolute). Prefix `EXPORT_MODE=fallback` to remove WebCodecs, so that the
export takes its MediaRecorder fallback path.

## Suites

| Runner name | File | What it checks | Phase |
|---|---|---|---|
| `regression` | `regression.js` | 57 UI checks: navigation, timeline, annotations, PGN import, export basics | 1 |
| `zoom` | `zoom_test.js` | Double-tap zoom is measured in pixels, and taps land on the squares drawn under them | 1 |
| `layout`, `overflow` | `layout.js`, `overflow_probe.js` | Layout at desktop and phone sizes, with no horizontal overflow (report: read the log) | 1 |
| `pinch` | `pinch_test.js` | Real two-finger pinch: magnification vs scale, focal drift (report) | 1 |
| `export_webcodecs`, `export_fallback` | `export_suite.js` | 12 single-move exports: VP9, alpha, exact frame count and timestamps, capture effects | 2A |
| `timing` | `timing_test.js` | Movement durations by distance | 2A |
| `parity` | `parity_test.js` | Live preview vs export pose at equal elapsed times | 2A |
| `start_rest` | `start_rest_test.js` | Every move starts at rest on its origin square | 2A |
| `throttle` | `throttle_test.js` | Exports under 1×/4×/6× CPU throttling are identical | 2A |
| `busy_*`, `race_*` | `busy_guard_test.js`, `abort_race_test.js` | The export lock and its release on every exit path | 1, 2A |
| `recorder_cleanup_fallback`, `encoder_cleanup` | `recorder_cleanup_test.js`, `encoder_cleanup_test.js` | Recorder, encoder, frame and canvas cleanup on success and failure | 1, 2A |
| `visual_vs_phase1` | `visual_compare.js` | Camera crops of annotated / Story Target moves vs Phase 1 (report) | 2A |
| `range` | `range_test.js` | Sequence range selectors | 2B |
| `seq_playback` | `sequence_playback_test.js` | Sequence playback schedule, Stop, guards | 2B |
| `seq_export` | `sequence_export_test.js` | Every frame of a sequence export against chess.js truth; file validity | 2B |
| `seq_parity` | `sequence_parity_test.js` | Sequence playback vs sequence export at equal times | 2B |
| `seq_throttle` | `sequence_throttle_test.js` | Sequence exports under CPU throttling are identical | 2B |
| `seq_cleanup_*` | `sequence_cleanup_test.js` | Cancel, failure and the frame limit for sequence exports | 2B |
| `memory` | `memory_test.js` | Long exports up to the 8,400-frame limit: validity, memory growth | 2B |
| `pacing` | `pacing_test.js` | Post-move viewing intervals (450 / 700 / 700 / 5000 ms, last move ≥ 1000 ms) | 2C |
| `flip_guard_*` | `flip_guard_test.js` | Flip is refused while an export runs; one orientation in every frame | flip guard |
| `camera_transitions` | `camera_transition_test.js` | Export camera between moves, frame by frame against a model of the agreed rules (from the Phase 2C crops) and against the first Phase 3A build: eased cuts, the 500 ms Story zoom-in after landing, the marked-mate return to the full board, crops and pixels unchanged elsewhere, pieces and timing unchanged, both orientations | 3A |
| `hash_vs_baseline` | `hash_compare.js` | The 12 single-move exports, frame-hash-identical to the accepted baseline build | — |

Shared helpers: `lib.js` (page setup, chess.js truth), `p2b_lib.js` (independent timeline model and
export-frame probe), `p2a_cases.js`, `preview_probe.js`, `longgame.js`, `validate_webm.js` (FFmpeg
checks), `webm_frames.js` (WebM block timestamps), `proto_playback.js` (Chrome `<video>` playback of a file).

The expected values are the tests' own model of the agreed rules (e.g. `expectedPlan` in
`p2b_lib.js`), not values read from the app. If a rule is changed on purpose, change the model with it.

## Notes

- `flip_guard_test.js` fails on builds without the export flip guard (e.g. the Phase 2C commit
  `a18ff63`), because there a flip during an export does mix orientations.
- In fallback mode, the MediaRecorder file's timing follows the wall clock by design; the fallback suites
  require a valid, decodable file rather than exact timestamps.
- `BASELINE=<commit>` changes the build `hash_vs_baseline` compares against (default `a18ff63`, the
  accepted Phase 2C).
