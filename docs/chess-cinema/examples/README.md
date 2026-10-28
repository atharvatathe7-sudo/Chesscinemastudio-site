# Story plan examples (Phase 5A)

These are worked examples for [the storytelling guide](../storytelling-guide.md) and
[the prompt](../storytelling-prompt.md), together with the validation cases that pin down how Chess Cinema answers
the usual AI mistakes.

**Every expected value here was observed, not predicted.** Each packet was run through Validate and Apply on the
application at commit `ff71e1f` (Phase 4B.2; page SHA-256 `2b36098f…079ba5`, Capture FX at its default, board not
flipped). `tests/harness/story_examples_test.js` checks them all again on every run.

**The analysis is illustrative.** No real Chessis export was available. The analysis in every `input.md` was
written for the example from the moves themselves, and each statement was checked with chess.js 0.12.0. It
contains no engine evaluations and no move classifications, and it is labelled `ILLUSTRATIVE ANALYSIS — NOT A
CHESSIS EXPORT`. The plans say `"analysis": {"source": "illustrative (not a Chessis export)"}`. Do not read these
examples as Chessis output.

## Positive packets

| Packet | Game, plies | Length | What it teaches |
|---|---|---|---|
| [legals-mate](legals-mate/) | Legal's mate (the app's sample), 1–13 | 16.73 s, 502 frames | A whole miniature. Pin arrow as anticipation, a Story Target on the hanging queen, close-ups through the combination, mate with a return to the full board. **Shows the camera continuity limitation** (see below). Has one accepted quality warning (selectivity 46 %) |
| [discovered-check](discovered-check/) | The reviewed 69-ply game, 41–56 | 17.57 s, 527 frames | Setup → anticipation (arrow along the c-file) → strike (discovered check, target on the attacked queen) → forced reply → consequence (queen taken, recapture, full board). Meets every provisional threshold |
| [mating-net](mating-net/) | The reviewed game, 57–69 | 15.17 s, 455 frames | Restraint: pacing alone builds up to one close-up on the mate, which stays to the end (`return_to_full: false`). A rook move from e1 to e8 gets no close-up because it would be the whole board |

Each packet contains:

| File | What it is |
|---|---|
| `input.md` | What goes into the prompt's slots: the Copy game header output, the PGN, the analysis (labelled), the request |
| `game.pgn` | The PGN, for the tests |
| `storyboard.md` | The AI's storyboard: acts, one row per emphasized ply with its evidence, what the schema cannot express, accepted warnings |
| `plan.json` | The plan exactly as pasted into Chess Cinema |
| `expected.json` | Observed results: Validate/Apply entries, every move's start, landing, end, hold, hold reason and camera summary, total frames, ending, story-lint tiers and metrics, the lint context (target length, analysis moments), and an explanation for each accepted quality warning |

### The camera continuity limitation (legals-mate)

- **What the plan asks for:** close-ups on 5. Nxe5 (with a Story Target on d1), 5… Bxd1, 6. Bxf7+ and 7. Nd5#.
- **What the camera does instead:**
  - **eases** into each new close-up (frames 229–237 and 289–297);
  - **eases out to the full board** for 6… Ke7 (frames 349–357);
  - **zooms in again** after 7. Nd5# lands (frames 382–396);
  - returns to the full board at the end (frames 426–434).
- **Why:** a close-up is kept only between automatic close-ups when the next move fits inside it. A Story Target move
  ends its own close-up, and the close-up of 6. Bxf7+ does not contain both 6… Ke7 and 7. Nd5#.
- **Status:** the plan is valid and the video correct. This is a limitation of what a plan can express; it is not a
  validation error ([guide, section 6](../storytelling-guide.md#camera-continuity-a-known-limitation)).
- **Second occurrence:** discovered-check shows the same rule once. Its Story Target strike, 27. Be7+, ends its own
  close-up before 27… Kb6.

## Negative, warning and lint cases ([negative/](negative/))

`negative/cases.json` lists each case: its file, the game it is run on, the action (Validate, Apply or story lint),
what the AI did wrong, and the exact observed result.

| Case | The AI's mistake | Chess Cinema / story lint says |
|---|---|---|
| n01-fingerprint-altered | Retyped the fingerprint | `E_GAME_MISMATCH` at `/game/fingerprint` |
| n02-header-missing | No game block (should have asked for the header) | `E_MISSING_FIELD` at `/game` |
| n03-fingerprint-omitted | Dropped the fingerprint (Apply) | `E_MISSING_FIELD` at `/game/fingerprint` |
| n04-move-number-as-ply | Wrote 5. Nxe5 as ply 5 | `E_SAN_MISMATCH` at `/moves/7/san` |
| n05-caption-field | Added `caption` | `E_UNKNOWN_FIELD` at `/moves/8/caption` |
| n06-classification | Added `classification: "blunder"` | `E_UNSUPPORTED_COMMAND` at `/moves/9/classification` |
| n07-acts | Put the storyboard's acts in the JSON | `E_UNSUPPORTED_COMMAND` at `/acts` |
| n08-move-ms | Asked for slow motion | `E_UNSUPPORTED_COMMAND` at `/moves/8/move_ms` |
| n09-false-claim | Claimed 5. Nxe5 gives check | `E_CLAIM_MISMATCH` at `/moves/8/claims/1` |
| n10-full-with-targets | `full` with Story Targets | `E_CONFLICT` at `/moves/8/frame` |
| n11-final-hold-twice | `hold_ms` on the last ply and `ending.hold_ms` | `E_CONFLICT` at `/moves/11/hold_ms` |
| n12-ending-too-short | `ending.hold_ms: 500` | `E_VALUE_RANGE` at `/ending/hold_ms` |
| n13-json-with-comments | A `//` comment and a trailing comma | `E_JSON_PARSE` |
| w01-close-on-wide-move | `close` on 33. Rxe8 (e1–e8) | valid, `W_CLOSEUP_IS_FULL` at `/moves/8/frame/mode` |
| w02-short-close-hold | A close-up held 1000 ms (Apply) | applied, `W_HOLD_RAISED` at `/moves/9/hold_ms` |
| l01-storyboard-wrong-san | Storyboard names the wrong move at ply 9 | lint **hard** `H_STORYBOARD_SAN` (the plan itself is valid) |
| l02-storyboard-untraced | No storyboard row for an emphasized ply | lint **hard** `H_UNTRACED` |
| l03-source-missing | No `analysis.source` | lint **hard** `H_SOURCE_MISSING` (valid for the app, not for the guide) |
| l04-flat-pacing | Valid and correct, but no anticipation, no claims, no stated ending | lint: no hard failure; **quality** `Q_SELECTIVITY`, `Q_ANTICIPATION`, `Q_ENDING_IMPLICIT`, `Q_MOMENT_NOT_EMPHASIZED`, 4 × `Q_UNCLAIMED` |

All "n" and "w" cases change one thing in the legals-mate plan, except w01, which changes the mating-net plan.

## Running

The tests drive the real page in headless Chromium (Playwright). The page must be given explicitly as an absolute
path, and its SHA-256 and git commit are printed. chess.js 0.12.0 is served to the page in place of the CDN copy:
fetch it once into `tests/.cache` (the test-harness branch's `tests/setup.sh` does this), or point `CHESS_JS` at it.

```sh
PAGE="$PWD/public/chess-cinema/index.html"
node tests/harness/story_examples_test.js "$PAGE"                                  # every packet and case (about 15 s)
node tests/harness/story_lint.js "$PAGE" docs/chess-cinema/examples/legals-mate     # lint one packet
node tests/harness/story_lint.js "$PAGE" --pgn game.pgn --plan plan.json --storyboard storyboard.md --target-s 20 --moments 9,11
```

`story_lint.js` exits:
- **0** with no hard failures (quality warnings do not change the exit code);
- **1** with a hard failure or a page error;
- **2** if it could not run.

## Adding a packet

1. **Load the game** in Chess Cinema and press Copy game header. Paste the output unchanged into `input.md` and the
   plan.
2. **Write `input.md`.** Label the analysis truthfully: real Chessis output says so and the plan's `analysis.source`
   is `chessis`. Anything else is labelled illustrative.
3. **Write `storyboard.md` and `plan.json`** following the guide.
4. **Record `expected.json`** from an actual run on the application build it targets. Review every value against the
   inspector before committing it.
5. **Explain every quality warning** that is kept in `accepted_quality_warnings`.
6. **When the application changes,** re-run the test. A failure means the expectations must be re-observed and
   reviewed. Never edit them to match without checking why they changed.
