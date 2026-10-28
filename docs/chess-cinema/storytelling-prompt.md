# Story plan prompt (Phase 5A)

How to use this prompt:
- Copy everything between the two `====` lines into Gemini or ChatGPT.
- Replace the four `<<…>>` slots.
- Optimised for **15–45-second** short-form chess videos.
- The rules come from [storytelling-guide.md](storytelling-guide.md) and match Chess Cinema at `ff71e1f`
  (plan schema `chess-cinema-plan/1`).

Before you start, in Chess Cinema:
1. Import the game's PGN.
2. Open **Story plan** and press **Copy game header**.
3. Paste the result into slot 1.

After the AI answers:
1. Paste its JSON block into the Story plan box and press **Validate**.
2. If there are errors, press **Copy report** and send the report back to the AI with: "Fix exactly these
   problems. Change nothing else."
3. When the plan is valid, press **Apply** and read the inspector before you export.

```text
================================================================================
You are planning a short chess video for Chess Cinema. Chess Cinema replays a game on a 1080×1080 board at
30 fps and follows a JSON "story plan" that you write. It has no chess engine and no AI of its own: it
checks your plan against the game with chess.js and executes only what its schema supports. Your job is
storytelling — choosing what to show, how long, and how close — using ONLY the game and the analysis below.

INPUTS
1. GAME HEADER (from Chess Cinema's "Copy game header"):
<<paste the game header JSON here>>
2. PGN:
<<paste the PGN here>>
3. ANALYSIS (source: <<chessis | other — say which>>):
<<paste the analysis here>>
4. REQUEST: target length about <<N>> seconds (15–45). Style: <<optional, e.g. "fast setup, slow finish">>.

STOP RULE
If input 1 is missing, empty, or not a JSON object with "plies" and "fingerprint", do not write a plan.
Reply only: "Please load the game in Chess Cinema, press Copy game header, and paste the result." Never write,
guess, shorten or alter "plies", "start_fen", "final_fen" or "fingerprint" yourself.

TRUTH RULES
- Use only facts the analysis states or the moves themselves show (a capture, a check, a mate, castling,
  promotion). Do not add evaluations, classifications ("blunder", "brilliant"), "best move" claims or tactics the
  analysis does not mention. If the analysis gives no evaluations, mention none.
- Every ply you emphasize (frame close, targets, highlights/arrows, or hold_ms >= 900) must be justified by a named
  analysis item or a move fact in the storyboard.
- Add "claims" for every emphasized capture, check or mate. Chess Cinema verifies them; a false claim is rejected.
- Arrows and targets may point only at squares the analysis names or the move itself involves.

METHOD
A. Ply table. List every ply of the range as "ply | move number | SAN". Ply = half-move from 1: 1. e4 is ply 1,
   1… e5 is ply 2; White's move n is ply 2n−1, Black's is ply 2n. Copy ply AND SAN from this table everywhere.
B. Moments. From the analysis only, rank turning points, then tactical sequences, then forced finishes. Checks and
   captures are not moments by themselves. Pick 1–2 moments for 15–25 s, 2–3 for 25–45 s. For each, name the setup,
   the anticipation (last position before the strike), the strike, the opponent's response, and the consequence.
C. Range. One contiguous segment: start a few plies before the first setup move, end on the decisive move or on the
   reply that shows the consequence. Estimate: about 0.2 s of movement per ply plus every hold.
D. Camera. No directive for ordinary moves (full board). "close" for a strike where the area around one piece
   matters. "targets" (1–2 squares near the landing square) when the consequence is elsewhere: an attacked queen,
   forked pieces, the king. Highlights/arrows (at most 2 per move) for squares or lines the analysis names. "full"
   for a board-wide move or a reset. Keep "defaults.auto_frame" false unless every capture and check deserves a
   close-up. Emphasize at most about a quarter of the plies. Do not ask for "close" on a move whose path, or whose
   landing square and the checked king, span 6 squares or more: it would be the whole board.
   The camera stays close from one move to the next only when both are plain "close" moves and the next move fits
   inside the close-up; moves with targets or marks always end their own close-up. Do not try to force continuity.
E. Pacing (hold_ms = time on the position after the move lands; minimums are enforced by the app):
   setup 250–450 (captures at least 500) · ordinary: no hold_ms (defaults 450, captures/checks 700) ·
   the ply before a strike 900–1500 · strike with close 1800–2500 · strike with targets 2500–3000 ·
   marked move 1000–1500 · response 1000–1800 · final hold via ending.hold_ms 3000–5000.
   Make the strikes clearly slower than the setup.
F. Ending. Always set "ending.return_to_full" (true or false) and "ending.hold_ms". Stay on the close-up
   (false) for a local mating net; return to the full board (true) when the consequence is board-wide. Never put
   hold_ms on the last ply when ending.hold_ms is set.

SCHEMA (chess-cinema-plan/1) — the ONLY fields that exist:
{
  "schema": "chess-cinema-plan/1",
  "game": <input 1, pasted unchanged: "plies", "final_fen", "fingerprint" and, for a set-up start, "start_fen">,
  "analysis": { "source": "<where the analysis came from>" },
  "range": { "from_ply": <int>, "to_ply": <int> },
  "defaults": { "auto_frame": <bool> },
  "moves": [ { "ply": <int>, "san": "<SAN>", "claims": ["capture"|"check"|"mate"|"castle"|"en_passant"|"promotion"],
              "hold_ms": <0..20000>, "frame": { "mode": "default"|"close"|"full", "targets": ["<square>"] },
              "marks": { "highlights": [{ "sq": "<square>", "color": "<optional #RRGGBB>" }],
                         "arrows": [{ "from": "<square>", "to": "<square>", "color": "<optional #RRGGBB>" }] } } ],
  "ending": { "hold_ms": <1000..20000>, "return_to_full": <bool> }
}
Only "schema", "game", and in each move "ply" and "san" are required. At most one entry per ply. "full" cannot
have targets. Do NOT add any other field: no caption, title, note, comment, evaluation, classification, acts,
groups, intro, camera, settings, move_ms, anticipation_ms or optional — Chess Cinema rejects them. Put such ideas
in the storyboard under "Not expressible in the schema".

OUTPUT — exactly these four parts, in this order:
1. "## Ply table" — the plies of the range.
2. "## Storyboard" — first line: "Target: about N s. Range: plies X–Y. Ending: …". Then 3–5 one-sentence acts
   (setup, anticipation, strike, response, consequence). Then a table with one row per emphasized ply:
   | Ply | SAN | Role | Evidence from the analysis | Camera | Hold |
   (Ply is a bare number; Evidence names the analysis item or the move fact.) Then "### Not expressible in the
   schema" and "### Missing from the analysis" (write "none" if empty).
3. "## Plan" — ONE fenced ```json block containing only the plan: plain JSON, no comments, no trailing commas,
   straight quotes.
4. "## Self-check" — answer each with yes/no: game block pasted unchanged? every ply/SAN copied from the ply
   table? every emphasized ply in the storyboard with evidence? claims on every emphasized capture/check/mate?
   no fields outside the schema? return_to_full stated? final hold given only in ending?

REPAIR
When I send you a Chess Cinema validation report, fix exactly the codes and paths it lists and change nothing
else. If it reports E_GAME_MISMATCH, do not edit the game block — ask me for a new Copy game header.
================================================================================
```

## Notes for the person running the prompt

- **Analysis source.**
  - Real Chessis output: write `chessis` in slot 3.
  - Your own notes: say so. The plan's `analysis.source` must match.
  - The examples in this folder use **illustrative** analysis, which is not a Chessis export.
- **Header after a correction.** If you correct the PGN in Chess Cinema after copying the header, copy it again: the
  fingerprint covers every move.
- **What you get back.** The storyboard is for you and reviewers. Only the JSON goes into Chess Cinema.
- **Story lint.** To check a returned plan, save the parts as a packet (`game.pgn`, `plan.json`, `storyboard.md`)
  and run `tests/harness/story_lint.js` (see [examples/README.md](examples/README.md)).
- **Logging trials.** Record each trial in [ai-trials.md](ai-trials.md).
