# Input: Legal's mate (the application's sample game)

This is what is pasted into the four slots of [the prompt](../../storytelling-prompt.md).

> **ILLUSTRATIVE ANALYSIS — NOT A CHESSIS EXPORT.** The analysis below was written for this example from the
> moves themselves, and every statement was checked with chess.js 0.12.0. It contains no engine evaluations and no
> move classifications; where Chessis would give one, it says "not supplied". The plan's `analysis.source` says
> `illustrative`.

## 1. Game header (Chess Cinema → Copy game header, at `ff71e1f`)

```json
{
  "plies": 13,
  "final_fen": "rn1q1bnr/ppp1kB1p/3p2p1/3NN3/4P3/8/PPPP1PPP/R1BbK2R b KQ - 2 7",
  "fingerprint": "sha256:5879152c8d428f840ff9919d5cfec074a954590e56d1987cda0c216793c12b7a"
}
```

## 2. PGN

```
1. e4 e5 2. Nf3 d6 3. Bc4 Bg4 4. Nc3 g6 5. Nxe5 Bxd1 6. Bxf7+ Ke7 7. Nd5#
```

## 3. Analysis (source: illustrative)

Moments:
- **A1. Ply 6, 3… Bg4.** The bishop on g4 pins the knight on f3 to the queen on d1 (the g4–f3–e2–d1 diagonal; e2
  is empty). Classification: not supplied.
- **A2. Ply 9, 5. Nxe5.** The knight leaves f3 and captures the pawn on e5. The bishop on g4 now attacks the queen
  on d1. Black's legal replies include 5… Bxd1 and 5… dxe5. Classification: not supplied.
- **A3. Ply 10, 5… Bxd1.** Black captures the queen. Classification: not supplied.
- **A4. Ply 11, 6. Bxf7+.** The bishop captures on f7 with check; Black's only legal reply is 6… Ke7.
- **A5. Ply 13, 7. Nd5#.** Checkmate.

Context:
- **C1. Ply 8, 4… g6.** The last quiet move before 5. Nxe5.

Moment plies (for story lint): 6, 9, 10, 11, 13.

## 4. Request

Target length about **18 seconds**. Style: "fast opening, slow down for the combination, end on the mate".
