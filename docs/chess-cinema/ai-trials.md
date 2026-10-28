# External-AI trials (Phase 5A)

Results of running [the prompt](storytelling-prompt.md) through real external AIs (Gemini and ChatGPT), by hand.
Chess Cinema has no AI integration: a person pastes the prompt, the answer and the validation report.

**Status: no trials have been run yet.** The tables below are empty on purpose. Nothing here may be filled in
except from an actual trial.

## Scope

- **Inputs:** at least **3 games × 2 AIs** (Gemini, ChatGPT), with real Chessis analysis where available.
- **Chessis exports:** until real ones exist, use the illustrative analysis from [examples/](examples/) and record
  that you did.
- **Request:** 15–45-second videos, as in the prompt.

## Procedure, per trial

1. **Load the game** in Chess Cinema (`ff71e1f` or later; record the build). Press **Copy game header**.
2. **Start fresh.** Open a new chat with the AI. Paste the prompt from `storytelling-prompt.md` with the four slots
   filled. Do not add hints.
3. **Round 0.** Paste the returned JSON into the Story plan box and press **Validate**. Record the errors and
   warnings by code.
4. **Repair rounds, at most two.** If there are errors, press **Copy report**, send it with "Fix exactly these
   problems. Change nothing else.", and validate again. Record each round.
5. **Apply.** Record the warnings, the duration and frames, and the inspector's camera rows.
6. **Lint.** Save the answer as a packet (`game.pgn`, `plan.json`, `storyboard.md`). Run
   `node tests/harness/story_lint.js "$PAGE" <packet>` with `--target-s` and `--moments` (the plies the analysis
   ranks). Record the hard failures and the quality warnings.
7. **Accuracy review.** Check every storyboard row against the analysis. Any claim, evaluation, classification or
   tactic not in the analysis is an accuracy failure.
8. **Stop-rule test (once per AI).** Send the prompt with slot 1 empty. Record whether the AI asked for the game
   header instead of writing a plan.
9. **Score** the exported or played video with the rubric below. Two reviewers score independently.

## Acceptance criteria

| Area | Criterion | Target |
|---|---|---|
| Schema validity | Valid at round 0 | ≥ 80 % of trials |
| Schema validity | Valid within two repair rounds | 100 % |
| Schema validity | No `E_UNKNOWN_FIELD` / `E_UNSUPPORTED_COMMAND` in final plans | 100 % |
| Analysis consistency | Game block equals Copy game header (no `E_GAME_MISMATCH`) | 100 % |
| Analysis consistency | No `E_CLAIM_MISMATCH` in final plans | 100 % |
| Analysis consistency | Story lint hard failures (`H_*`) in final plans | 0 |
| Analysis consistency | Accuracy review: nothing invented | 100 % |
| Analysis consistency | Stop rule: asks for the missing header | 100 % |
| Storytelling quality | Story lint quality warnings | Reported and explained; not a pass/fail gate (provisional thresholds) |
| Storytelling quality | Rubric average (clarity, selectivity, rhythm, payoff) | ≥ 4 of 5 |
| Storytelling quality | Rubric accuracy | 5 of 5 in every trial |

## Rubric (1–5)

| Score | Clarity | Selectivity | Rhythm | Payoff | Accuracy |
|---|---|---|---|---|---|
| 5 | A viewer can say what happened and why | Only the moments that matter stand out | Setup brisk, strikes slow, the ending lingers | The ending lands on the consequence | Everything shown or implied is in the analysis or the moves |
| 3 | Mostly followable | Some ordinary moves emphasized, or one moment missed | Even pacing in places | The ending is there but flat | — |
| 1 | Confusing | Everything or nothing emphasized | Uniform | Stops abruptly | Anything invented (accuracy is pass/fail: 5 or 1) |

## Trial log

| # | Date | AI (product, version as shown) | Game, range | Analysis source | Round 0 codes | Rounds to valid | Apply warnings | Duration | Lint hard | Lint quality | Accuracy review | Rubric (C/S/R/P/A) | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| | | | | | | | | | | | | | |

## Stop-rule log

| AI | Date | Asked for the header? | Notes |
|---|---|---|---|
| | | | |

## Findings

(Patterns across trials: recurring codes, prompt changes they suggest, threshold adjustments. Record each prompt
change with the trial that motivated it.)
