# Chess Cinema storytelling guide (Phase 5A)

How to turn a chess game and its analysis into a **story plan** that Chess Cinema can validate and execute.
Written for the external AI (Gemini, ChatGPT) that drafts the plan, and for the person who checks it.

```
Chessis analysis ──► external AI (this guide + the prompt) ──► storyboard + plan JSON ──► Chess Cinema: Validate, Apply, Play, Export
```

- Chess Cinema has **no AI and no chess engine** inside it. It checks the plan against the loaded game with
  chess.js and executes only what its schema supports.
- The AI must **not add facts**. Every emphasis in a plan has to rest on something the supplied analysis says, or on
  a fact the moves themselves show (a capture, a check, a mate).
- This guide matches the application at commit `ff71e1f` (Phase 4B.2, plan schema `chess-cinema-plan/1`). When the
  application changes, this guide must be re-checked against it.
- The copy-paste prompt is in [storytelling-prompt.md](storytelling-prompt.md); worked examples are in
  [examples/](examples/); real-AI trial results go in [ai-trials.md](ai-trials.md).
- **Target format:** 15–45-second short-form videos (1080 × 1080, 30 fps).

---

## 1. What the plan can and cannot say

### 1.1 The executable schema (`chess-cinema-plan/1`)

Only these fields exist. Anything else is an error, not a hint.

```jsonc
{
  "schema": "chess-cinema-plan/1",                       // required, exactly this
  "game": {                                              // required: paste "Copy game header" output here, unchanged
    "plies": 69, "start_fen": "…", "final_fen": "…",     //   start_fen only appears for games from a set-up position
    "fingerprint": "sha256:…"                            //   required to Apply; never typed or invented
  },
  "analysis": { "source": "chessis" },                   // where the analysis came from (non-empty string)
  "range": { "from_ply": 41, "to_ply": 56 },             // ONE contiguous segment = one video
  "defaults": { "auto_frame": false },                   // automatic close-ups for every capture/check (usually false)
  "moves": [                                             // directives, at most one per ply
    { "ply": 53, "san": "Be7+",                          //   both required; san must be the game's move at that ply
      "claims": ["check"],                               //   capture | check | mate | castle | en_passant | promotion
      "hold_ms": 2600,                                   //   0–20000: time on the position after the move lands
      "frame": { "mode": "close", "targets": ["f6"] },   //   mode default | close | full; targets = Story Target squares
      "marks": { "highlights": [{ "sq": "e7" }],         //   squares highlighted after the move lands
                 "arrows": [{ "from": "e7", "to": "f6" }] } }
  ],
  "ending": { "hold_ms": 3500, "return_to_full": true }  // final hold 1000–20000; return to the full board at the end
}
```

Highlights and arrows also take an optional `"color"` in `#RRGGBB` form. (The `//` comments are for this guide only.
Real plans are plain JSON: comments are a parse error.)

**Ply numbering.** Plies count half-moves from 1: `1. e4` is ply 1, `1… e5` is ply 2, `5. Nxe5` is ply 9.
White's move *n* is ply 2n − 1 and Black's is ply 2n. SAN is compared without trailing `+ # ! ?`, and `0-0` is
read as `O-O`.

**Recognised but not available yet.** These give `E_UNSUPPORTED_COMMAND`:
- top level: `groups`, `acts`, `intro`, `camera`, `settings`;
- inside a move: `classification`, `move_ms`, `anticipation_ms`;
- `optional`, anywhere.

**Any other field** gives `E_UNKNOWN_FIELD`, for example `caption`, `title`, `note`, `evaluation`, `storyboard` or
`comment`.

### 1.2 Storytelling needs mapped to the schema

| Storytelling need | How to express it now | What is not possible yet |
|---|---|---|
| Choose the span of the story | `range` (one segment, at most 8,400 frames = 280 s) | Several segments, cold opens, loops |
| Keep ordinary moves quiet | No directive (full board, default holds), or a short `hold_ms` for a brisk setup | — |
| Show a critical move | `frame.mode: "close"` (a close-up after landing, held ≥ 1.8 s); `frame.targets` (close-up plus a consequence beat, ≥ ~2.5 s); highlights/arrows (≥ 1 s) | Slow motion (`move_ms`) |
| Build anticipation before a strike | A longer `hold_ms` on the ply **before** the strike; an arrow on that ply showing the line the analysis names | A pause *inside* a move or a camera move before it (`anticipation_ms`, camera cues). Marks appear only when their move lands |
| Show the opponent's response | A directive on the reply ply (a hold, a highlight, `close`) | — |
| Show the consequence | `frame.targets` on the squares the analysis names (forked pieces, an attacked queen, the king); a `full` move to show the whole board | Captions explaining it (no text rendering) |
| Keep a combination continuous | Consecutive `close` moves. The camera keeps a close-up only when the next move fits inside it (section 6) | Guaranteed continuity (`groups`) |
| Reset the viewer's context | `frame.mode: "full"` (marks are still drawn) | — |
| Vary the pacing | `hold_ms` per ply; `ending.hold_ms` | Movement speed is fixed: 160–280 ms per move by distance |
| End satisfyingly | `ending.hold_ms`; `ending.return_to_full`; choosing the last ply | Loop endings |
| State the facts | `claims` (checked against chess.js); `analysis.source` | Evaluations, classifications, "best move": not shown and not checked |
| Explain why each moment matters | **The storyboard, outside the JSON** (section 9) | A non-rendered rationale field (later) |

---

## 2. What the AI must be given

1. **The game header**, from Chess Cinema's **Copy game header** button, with the game loaded.
2. **The PGN** of the same game.
3. **The analysis** (Chessis output), labelled with its source.
4. **The target length** (default: about 20–30 s) and, optionally, a style note.

**If the game header is missing, the AI must stop and ask for it.** It must never write a `fingerprint`,
`final_fen` or `plies` value itself. The fingerprint is a SHA-256 over every move of the game; a guessed or
retyped one is always rejected (`E_GAME_MISMATCH`), and leaving it out means the plan cannot be applied
(`W_FINGERPRINT_MISSING` on Validate, `E_MISSING_FIELD` on Apply).

**If the analysis is missing or does not cover a moment,** the AI may still use facts the moves show: captures,
checks, mates, castling, promotion. It must not supply evaluations, classifications ("blunder", "brilliant") or
tactical labels of its own, and the storyboard must say what was missing.

---

## 3. Step 1: the ply table

Before choosing anything, write out the game as a table: `ply · move number · SAN`, from the PGN. Every later
reference copies **both** the ply and the SAN from this table.

Off-by-one plies are the most likely mistake. The two common forms are counting moves instead of plies (`5. Nxe5`
written as ply 5) and starting from 0. Chess Cinema rejects both with `E_SAN_MISMATCH`, but only on plies the plan
mentions.

---

## 4. Step 2: important moments vs ordinary moves

Rank moments **only from the analysis**, in this order:

1. **Turning points the analysis names:** moves it classifies (blunder, mistake, brilliant, only move), large
   evaluation swings *if the analysis gives evaluations*, moves it calls decisive.
2. **Tactical sequences the analysis describes:** a pin, a fork, a discovered attack, a combination. These come
   with the moves that set them up and the forced or natural replies.
3. **Forced finishes:** checkmate, or a decisive material gain the moves show.

Everything else is an **ordinary move**. Checks and captures are **not** moments by themselves. A recapture, a
routine check or a developing move gets no directive unless the analysis gives it a role.

How many moments a short video can carry:

| Video length | Moments to emphasize |
|---|---|
| 15–25 s | 1–2 (one combination or one finish) |
| 25–45 s | 2–3 |

**Roles inside a moment.** For each moment, identify:
- the **setup**: the moves that put the pieces in place;
- the **anticipation**: the last position before the strike;
- the **strike** (critical move);
- the **response**: the opponent's reply, especially a forced one;
- the **consequence**: what the moves show afterwards, such as material won or mate.

These roles become the storyboard's "Role" column.

---

## 5. Step 3: choose the range and estimate the length

- **Start** a few plies before the first setup move that the analysis mentions, so the viewer sees the pieces
  arrive. **End** on the decisive move, or on the reply that shows the consequence.
- **Estimate the length:** about 0.2 s of movement per ply plus every hold (section 7). The application reports the
  exact duration and frame count after Validate/Apply. Revise holds, not facts, to meet the target.
- **The hard limit is 8,400 frames (280 s);** beyond it the plan plays but cannot be exported (`W_TOO_LONG`).
  Short-form videos should stay within 15–45 s.

---

## 6. Step 4: camera (selective close, full and automatic framing)

| Tool | Use it for | What the application does |
|---|---|---|
| (no directive) | Ordinary moves | Full board throughout |
| `frame.mode: "close"` | A strike where the board around one piece matters | A close-up of the move, held at least 1.8 s. Coming from the full board it usually zooms in over 0.5 s after the move lands; otherwise it eases across before the move. The inspector shows which. On a checkmate: the close-up mate camera |
| `frame.targets: [...]` | The consequence is elsewhere: an attacked queen, forked pieces, the king | A close-up that also takes in the target squares, held ~2.5 s at least. Keep targets few and near the landing square, or the frame opens to the whole board |
| `marks` (highlights, arrows) | A square or line the analysis names | Drawn when the move lands; the camera frames the move and its marks (the whole board if they span it, e.g. the g4→d1 arrow in legals-mate) and holds at least 1 s |
| `frame.mode: "full"` | A move whose meaning is board-wide, or a reset between two ideas | Whole board on every frame of that move, marks still drawn, never zoomed |
| `defaults.auto_frame: true` | Rarely: a dense tactical segment where *every* capture and check deserves a close-up | Every unmarked capture and check (not mate) gets an automatic close-up of at least 1.8 s, unless that close-up would be the whole board. Usually leave it `false` and use `close` selectively |

Rules of thumb:
- **Frame few plies.** Up to about a quarter of the plies in the range for 15–45 s videos (a provisional guide;
  see section 11).
- **Don't ask for a close-up of a move that spans the board.** If the move's path, or its landing square and the
  checked king, cover 6 squares or more, the close-up would be the whole board. The application warns
  (`W_CLOSEUP_IS_FULL`) and keeps the full board. Use `full`, or leave the move alone.
- **Don't ping-pong** (close, full, close) inside one combination on purpose. The camera may still do it on its
  own; see below.

### Camera continuity: a known limitation

A plan **cannot force the camera to stay close through a combination.** The application keeps a close-up from one
move to the next only in two cases:

- **Kept:** both moves are *automatic* close-ups (`close` with no marks or targets, or `auto_frame`), and the next
  move's piece path, and any check, fit inside the current close-up.
- **Bridged:** one quiet, unmarked move between two automatic close-ups keeps the close-up, under the same fit
  condition.

Moves with Story Targets or marks, `full` moves and the last move always end their own camera. The next close-up
then **eases** in from the current view, or **zooms in** after landing from the full board.

**Demonstrated by the Legal's mate example** ([examples/legals-mate](examples/legals-mate/)). Plies 9, 10, 11 and
13 all ask for close-ups:
- 5. Nxe5 has a Story Target (d1), so it cannot hand its close-up on;
- 5… Bxd1 and 6. Bxf7+ each **ease** into a new close-up (frames 229–237 and 289–297);
- the camera then **eases out to the full board** for 6… Ke7 (frames 349–357). 6… Ke7 is a quiet move between two
  automatic close-ups, so it could have been bridged, but the close-up of 6. Bxf7+ does not contain both 6… Ke7 and
  7. Nd5#;
- after 7. Nd5# lands it **zooms in again** (frames 382–396).

The plan is valid and the video is correct. The continuity just comes from pacing, not from one unbroken shot.

**What to do about it:**
- Read the inspector after Apply. Each row says how the camera enters the move ("close-up kept from the move
  before", "eases in over frames …", "cut at frame …", "full board") and whether it "moves after landing" (a
  zoom-in).
- Accept a reversal when the story still reads; story lint reports it as a note. It warns only when a combination
  has more than one.
- Don't add or move directives just to chase continuity at the expense of the story.
- Guaranteed continuity needs later work (`groups`).

---

## 7. Step 5: pacing with `hold_ms` and `ending`

`hold_ms` is the time the position is shown **after the move lands** (movement itself takes 160–280 ms). The
application never shortens a move below its structural minimum; it raises a too-short request and reports
`W_HOLD_RAISED` with the reason.

| Minimums the application enforces | |
|---|---|
| A capture, with Capture FX on (the default) | 500 ms |
| A marked move (highlights or arrows) | 1,000 ms |
| A move with Story Targets | ~2,467 ms (74 frames) |
| A `close` move | 1,800 ms |
| The last move | 1,000 ms; more when it returns to the full board |

The table below gives suggested holds: values chosen so that the minimums above never override them.

| Role | Suggested `hold_ms` |
|---|---|
| Setup, brisk | 250–450 (captures: 500) |
| Ordinary, no directive | defaults: 450, captures and checks 700 |
| Anticipation (the ply before a strike) | 900–1,500 |
| Strike with `close` | 1,800–2,500 |
| Strike with `targets` | 2,500–3,000 |
| Marked move | 1,000–1,500 |
| Response | 1,000–1,800 |
| Final position (`ending.hold_ms`) | 3,000–5,000 |

**Contrast is the point.** A fast setup and a slow strike tell the viewer where to look. Uniform holds tell them
nothing.

**Anticipation, with the tools that exist:**
- hold the position before the strike, so the viewer sees the pieces lined up;
- draw an arrow on that ply for the line the analysis names (the arrow appears when that ply lands);
- start the range a few plies before the strike so the setup is seen.

---

## 8. Step 6: endings

| Ending | When | How |
|---|---|---|
| **Stay on the mating close-up** | A checkmate whose net is local | Last ply `frame.mode: "close"`, `ending.return_to_full: false`, `ending.hold_ms` 3,000–5,000 |
| **Return to the full board** | The consequence is board-wide (material, a lost position) or the viewer needs the whole picture | `ending.return_to_full: true`. The close-up holds ~1 s, then eases out; the final hold is raised if needed (`W_HOLD_RAISED`) |
| **End on the full board** | A consequence shown best without a close-up (a recapture, the resulting material) | Last ply `frame.mode: "full"` (or no framing), `ending.hold_ms` ≥ 3,000 |

- **Always state `return_to_full`** (true or false), so the ending is a decision, not a default.
- **Give the final hold in one place:** `ending.hold_ms`, not `hold_ms` on the last ply. Both at once is
  `E_CONFLICT`.
- **End on a result the moves show.** The video may end on a strike only if the story is the strike itself; the
  storyboard must say so.

---

## 9. Step 7: truthfulness, and the storyboard

**Rules (all hard):**
1. **The game block** is copied verbatim from Copy game header. Never type or alter it.
2. **Claims:** every emphasized capture, check or mate carries `claims` ("capture", "check", "mate"). The
   application verifies each against chess.js and rejects a false one (`E_CLAIM_MISMATCH`).
3. **Every emphasized ply is traced to the analysis.** "Emphasized" means `close`, `targets`, `marks` or
   `hold_ms` ≥ 900. Each such ply needs a storyboard row naming the analysis item it rests on.
4. **Nothing is invented:**
   - no evaluations, classifications or tactical labels that the analysis does not give;
   - arrows and targets point only at squares the analysis or the move itself involves.
5. **`analysis.source`** names the real source: `"chessis"`, or `"illustrative …"` for made-up teaching material.
6. **Dramatic pacing is allowed; implying an unsupported chess fact is not.**

**The storyboard** is written *before* the JSON, as Markdown, and is never put inside the JSON. Its format:

```markdown
## Storyboard
Target: about 18 s. Range: plies 41–56. Ending: full board, return_to_full true.

Acts (prose, 1–3 sentences each): setup → anticipation → strike → response → consequence.

| Ply | SAN | Role | Evidence from the analysis | Camera | Hold |
|---|---|---|---|---|---|
| 52 | Kc6 | anticipation | A1: queen c2, bishop c5 and king c6 on the c-file | arrow c2→c6 | 1500 |
| 53 | Be7+ | strike | A2: discovered check from c2; the e7 bishop attacks the queen on f6 | close, target f6 | 2600 |

### Not expressible in the schema
- (anything the story wants that the schema lacks: captions, slow motion, an evaluation bar)

### Missing from the analysis
- (any moment the AI would have liked to emphasize but the analysis does not support)
```

- One row per emphasized ply. Plies without a directive need no row.
- The "Ply" cell is a bare number, and "SAN" is copied from the ply table: story lint checks both against the
  game.
- "Evidence" names an analysis item (A1, M2, …) or a move fact ("capture", "check": shown by the move itself).
  It is never an opinion of the AI's own.

---

## 10. Step 8: output, validation and repair

**The AI outputs, in this order:**
1. the ply table, for the plies in the range only;
2. the storyboard;
3. **one** fenced `json` block with the plan, and nothing else inside it.

**Then the person:**
1. pastes the JSON into Chess Cinema's Story plan panel, with the same game loaded, and presses **Validate**;
2. if there are errors, presses **Copy report** and gives the report back to the AI;
3. presses **Apply**, reads the inspector (holds, camera per ply, ending, total length), then **Play Sequence**
   and **Export Sequence**.

**Repair rules for the AI:**
- fix exactly the codes and paths in the report;
- change nothing else;
- never "fix" a game mismatch by editing the game block: ask for a new Copy game header instead.

| Code | Meaning | Fix |
|---|---|---|
| `E_JSON_PARSE` | Not valid JSON: comments, trailing commas, smart quotes, two JSON blocks | Output one plain JSON object |
| `E_TYPE`, `E_VALUE_RANGE` | Wrong type or out of range (e.g. `ending.hold_ms` < 1000, `hold_ms` > 20000) | Use the documented type/range |
| `E_SCHEMA_VERSION` | `schema` is not `chess-cinema-plan/1` | Use exactly that string |
| `E_UNKNOWN_FIELD` | A field the schema doesn't have (`caption`, `note`, …) | Remove it; put the idea in the storyboard |
| `E_UNSUPPORTED_COMMAND` | A planned-but-unavailable field (`acts`, `move_ms`, `classification`, …) | Remove it; list it under "Not expressible" |
| `E_MISSING_FIELD` | A required field is absent (`game`, `ply`, `san`, the fingerprint on Apply) | Add it. For `game`, paste Copy game header |
| `E_GAME_MISMATCH` | The plan is for another game (plies, positions or fingerprint differ) | Load the right game, or get a fresh Copy game header; never edit the header by hand |
| `E_SAN_MISMATCH` | The SAN at that ply is a different move | Re-read the ply table (ply = half-move) |
| `E_PLY_RANGE`, `E_RANGE_INVALID` | A ply or range beyond the game, or `from_ply` > `to_ply` | Use plies from the table |
| `E_DUPLICATE_DIRECTIVE` | Two directives for one ply | Merge them |
| `E_CLAIM_MISMATCH` | A claim the move does not satisfy | Remove the false claim; rethink the emphasis if it rested on it |
| `E_CONFLICT` | `full` with targets, or a final hold given twice | Drop one side |
| `E_PLAN_TOO_LARGE` | Over 64 KB | Remove directives for ordinary moves |
| `E_NO_GAME`, `E_FINGERPRINT_UNAVAILABLE`, `E_INTERNAL` | Nothing loaded / page not secure (plain http) / unexpected | Not the AI's to fix: load the game, open the page over https or as a file, retry |
| `W_FINGERPRINT_MISSING` | Validates, but cannot be applied | Paste Copy game header |
| `W_OUTSIDE_RANGE` | A directive outside the range is ignored | Remove it or widen the range |
| `W_NO_MOVE_REFERENCES` | No directives at all | Fine for a plain sequence; a story needs some |
| `W_FINAL_FEN_MISSING` | No `final_fen` | Paste the whole Copy game header |
| `W_CLOSEUP_IS_FULL` | The close-up would be the whole board | Use `full`, or leave the move alone |
| `W_HOLD_RAISED` | A hold is below the application's minimum and was raised | Use at least the minimum (section 7) |
| `W_TOO_LONG` | More than 8,400 frames: plays but cannot be exported | Shorten the range or holds |

---

## 11. Story lint and acceptance criteria

`tests/harness/story_lint.js` runs a plan through the real Validate and Apply. It reads the page's own timeline and
camera summary (the inspector, derived from the camera track the export renders) and reports three tiers. It never
recomputes holds or camera framing.

**Hard failures** (correctness; must be zero):
- the plan is invalid or was not applied;
- it is longer than the export limit;
- `analysis.source` is missing;
- with a storyboard: a storyboard ply or SAN that is not the game's (`H_STORYBOARD_PLY`, `H_STORYBOARD_SAN`), or
  an emphasized ply without analysis evidence (`H_UNTRACED`).

**Quality warnings.** These are provisional thresholds for 15–45 s videos, and prompts for a reviewer, not
failures:

| Check | Provisional threshold | Limitation |
|---|---|---|
| `Q_SELECTIVITY` | Emphasized plies ≤ 25 % of the range | Short miniatures that *are* one combination exceed it legitimately (the Legal's mate example: 46 %) |
| `Q_ANTICIPATION` | Hold on the ply before a combination's first strike ≥ 1.5 × median setup hold | Measures only that one ply; an arrow without a longer hold does not count |
| `Q_CONTRAST` | Median framed hold ≥ 2 × median setup hold | Not measurable with no framed plies before the last (reported as a note) |
| `Q_FINAL_HOLD` | Last ply holds ≥ 2,000 ms | — |
| `Q_DURATION` | Within ±15 % of the target, or within 15–45 s if no target is given | The target is whatever the request said |
| `Q_MOMENT_NOT_EMPHASIZED` | Each analysis moment inside the range is emphasized (or is the last ply with a final hold ≥ 2 s) | Needs the moment list from the analysis; cannot judge whether a moment *should* have been left out |
| `Q_ENDS_BEFORE_REPLY` | The story does not end on a strike before the game ends | Ending on a strike can be deliberate |
| `Q_UNCLAIMED` | Strikes that capture, check or mate carry the matching claims | — |
| `Q_CLOSEUP_IS_FULL`, `Q_HOLD_RAISED` | The application's own warnings | — |
| `Q_ENDING_IMPLICIT` | `return_to_full` is stated | — |
| `Q_CAMERA_REVERSALS` | At most one camera reversal (close → full → close) inside a combination | Read from the inspector; the plan cannot always prevent it (section 6) |

**Definitions used by the lint:**
- **Strike:** a ply with `close` or Story Targets.
- **Marked:** highlights or arrows.
- **Held:** a requested `hold_ms` ≥ 900 on an unframed ply.
- **Emphasized:** strike, marked or held.
- **Setup:** any other ply in the range except the last.
- **Combination:** strikes at most two plies apart.

**Notes** (information only):
- each camera reversal, with frames;
- `auto_frame` on;
- moments outside the range;
- measurements that could not be made.

**Do not force a plan to meet a threshold** at the expense of chess accuracy or a coherent story. A quality
warning that the storyboard explains is acceptable; a hard failure is not.

The human review still decides storytelling quality. Two reviewers score clarity, selectivity, rhythm, payoff and
accuracy from 1 to 5. Target an average of 4 or more; **accuracy must be 5**. See [ai-trials.md](ai-trials.md).

---

## 12. Later work (needs application or schema changes; not Phase 5A)

- **Schema and header additions:**
  - a non-rendered `note` field per move, so the rationale can travel inside the JSON;
  - a ply → SAN list in Copy game header, so the AI never has to count plies.
- **Already designed but deferred:**
  - `groups`, for guaranteed camera continuity through a combination;
  - `anticipation_ms` and camera cues before a move;
  - `intro`, an opening hold;
  - `move_ms`, slow motion;
  - classification badges with source labels.
- **New overlay and format features:**
  - captions and titles, with truthfulness rules;
  - evaluation display;
  - marks drawn before a move lands;
  - several segments per video.
- **Out of scope:** cold opens, loop endings, complex overlays and custom movement durations, unless approved.
