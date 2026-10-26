#!/usr/bin/env bash
# Usage: tests/run_all.sh [html] [label]
# Runs the Phase 1–2C regression suites against one build of the Chess Cinema page (default: this
# checkout's public/chess-cinema/index.html). Logs go to tests/out/logs/<label>/, files to tests/out/.
# Env: ONLY=name,name (run a subset), BASELINE=<commit> (frame-hash reference, default the accepted
# Phase 2C commit), MEMORY_SIZES (default 1,5,10,20,100,429), TEST_OUT (output directory).
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
REPO=$(cd "$HERE/.." && pwd)
HTML=$(realpath "${1:-$REPO/public/chess-cinema/index.html}")
LABEL=${2:-current}
export TEST_OUT=${TEST_OUT:-$HERE/out}
BASELINE=${BASELINE:-a18ff636727463007d2cc6195188f2348ac3a901}   # Phase 2C, accepted
PHASE1=cbaae1b7fcb550a541555f401847f5c352c8f11f                   # Phase 1 (visual_compare reference)
LOG=$TEST_OUT/logs/$LABEL; REF=$TEST_OUT/ref; mkdir -p "$LOG" "$REF"
H=$HERE/harness
git -C "$REPO" show "$BASELINE:public/chess-cinema/index.html" > "$REF/baseline.html"
git -C "$REPO" show "$PHASE1:public/chess-cinema/index.html" > "$REF/phase1.html"
echo "build under test: $HTML"; echo "label: $LABEL   baseline: $BASELINE   output: $TEST_OUT"
FAILED=0
want(){ [ -z "${ONLY:-}" ] || [[ ",$ONLY," == *",$1,"* ]]; }
# r <name> <command...>: a suite that ends with "==== ...: x/y passed ====".
r(){ local name=$1; shift; want "$name" || return 0
  "$@" > "$LOG/$name.log" 2>&1
  local s; s=$(grep -E '^====' "$LOG/$name.log" | tail -1)
  local x y; x=$(sed -nE 's/.* ([0-9]+)\/([0-9]+) .*/\1/p' <<<"$s"); y=$(sed -nE 's/.* ([0-9]+)\/([0-9]+) .*/\2/p' <<<"$s")
  if [ -n "$s" ] && [ "$x" = "$y" ]; then echo "PASS  $name: $s"; else echo "FAIL  $name: ${s:-no summary line, see $LOG/$name.log}"; FAILED=1; fi; }
# m <name> <command...>: a measurement report (no pass/fail line); read the log.
m(){ local name=$1; shift; want "$name" || return 0
  if "$@" > "$LOG/$name.log" 2>&1; then echo "REPORT $name: $LOG/$name.log"; else echo "FAIL  $name: exited non-zero, see $LOG/$name.log"; FAILED=1; fi; }
SHOTS=$TEST_OUT/shots/$LABEL; mkdir -p "$SHOTS"

# Phase 1: UI, navigation, annotations, export basics, layout
r regression            node "$H/regression.js" "$HTML" "$LOG/regression.json"
m layout                node "$H/layout.js" "$HTML" "$SHOTS/layout"
m overflow              node "$H/overflow_probe.js" "$HTML"
r zoom                  node "$H/zoom_test.js" "$HTML" "$SHOTS/zoom"
m pinch                 node "$H/pinch_test.js" "$HTML" "$SHOTS/pinch"
# Phase 2A: movement timing, deterministic export, cleanup
rm -rf "$TEST_OUT/exports/$LABEL" "$TEST_OUT/exports/${LABEL}_fallback"
HASH=1 r export_webcodecs node "$H/export_suite.js" "$HTML" "$LABEL"
EXPORT_MODE=fallback r export_fallback node "$H/export_suite.js" "$HTML" "${LABEL}_fallback"
r timing                node "$H/timing_test.js" "$HTML"
r parity                node "$H/parity_test.js" "$HTML"
r start_rest            node "$H/start_rest_test.js" "$HTML"
r throttle              node "$H/throttle_test.js" "$HTML" "$LABEL"
r busy_webcodecs        node "$H/busy_guard_test.js" "$HTML"
EXPORT_MODE=fallback r busy_fallback node "$H/busy_guard_test.js" "$HTML"
r race_webcodecs        node "$H/abort_race_test.js" "$HTML"
EXPORT_MODE=fallback r race_fallback node "$H/abort_race_test.js" "$HTML"
EXPORT_MODE=fallback r recorder_cleanup_fallback node "$H/recorder_cleanup_test.js" "$HTML"
r encoder_cleanup       node "$H/encoder_cleanup_test.js" "$HTML"
m visual_vs_phase1      node "$H/visual_compare.js" "$REF/phase1.html" "$HTML"
# Phase 2B: sequence range, playback, export
r range                 node "$H/range_test.js" "$HTML"
r seq_playback          node "$H/sequence_playback_test.js" "$HTML"
r seq_export            node "$H/sequence_export_test.js" "$HTML" "$LABEL"
r seq_parity            node "$H/sequence_parity_test.js" "$HTML"
r seq_throttle          node "$H/sequence_throttle_test.js" "$HTML" "$LABEL"
r seq_cleanup_webcodecs node "$H/sequence_cleanup_test.js" "$HTML"
EXPORT_MODE=fallback r seq_cleanup_fallback node "$H/sequence_cleanup_test.js" "$HTML"
r memory                node "$H/memory_test.js" "$HTML" "$LABEL" "${MEMORY_SIZES:-1,5,10,20,100,429}"
# Phase 2C: pacing
r pacing                node "$H/pacing_test.js" "$HTML"
# Export camera between moves (Phase 3A), against the Phase 2C reference
r camera_transitions    node "$H/camera_transition_test.js" "$HTML"
# Board flip during export (added with the flip guard)
r flip_guard_webcodecs  node "$H/flip_guard_test.js" "$HTML"
EXPORT_MODE=fallback r flip_guard_fallback node "$H/flip_guard_test.js" "$HTML"
# Single-move export frames vs the accepted baseline, frame by frame
if want hash_vs_baseline; then
  rm -rf "$TEST_OUT/exports/baseline"
  HASH=1 node "$H/export_suite.js" "$REF/baseline.html" baseline > "$LOG/export_baseline.log" 2>&1
  r hash_vs_baseline node "$H/hash_compare.js" baseline "$LABEL"
fi
exit $FAILED
