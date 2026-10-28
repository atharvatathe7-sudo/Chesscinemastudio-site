# Input: the mating net (the reviewed game, plies 57–69)

This is what is pasted into the four slots of [the prompt](../../storytelling-prompt.md). The game is the same as
in [discovered-check](../discovered-check/input.md), so the header and PGN are identical.

> **ILLUSTRATIVE ANALYSIS — NOT A CHESSIS EXPORT.** The analysis below was written for this example from the
> moves themselves, and every statement was checked with chess.js 0.12.0. It contains no engine evaluations and no
> move classifications; where Chessis would give one, it says "not supplied". The plan's `analysis.source` says
> `illustrative`.

## 1. Game header (Chess Cinema → Copy game header, at `ff71e1f`)

```json
{
  "plies": 69,
  "final_fen": "Qkb5/2p3p1/p2n4/1p1B4/1P1p4/P6N/5PPP/6K1 b - - 3 35",
  "fingerprint": "sha256:3a995f68223ef717ec5c86d99d4027cbd3dcb4dd6c5e6c2909b19b19792e0d50"
}
```

## 2. PGN

The same PGN as [discovered-check](../discovered-check/input.md) (69 plies, ending 35. Qa8#).

## 3. Analysis (source: illustrative)

Moments:
- **A1. Ply 63, 32. Bd5+.** Check. The king answers 32… Kb8 (ply 64), to the square next to the a8 corner.
  Classification: not supplied.
- **A2. Ply 69, 35. Qa8#.** Checkmate on a8.

Context:
- **C1. Ply 61, 31. Qc5+.** Check; the king answers 31… Kb7.
- **C2. Plies 65–66, 33. Rxe8 Nxe8.** The rooks are exchanged.
- **C3. Ply 67, 34. Qc6.** A quiet queen move.
- **C4. Ply 68, 34… Nd6.** Black's last move before the mate.

Moment plies (for story lint): 63, 69.

## 4. Request

Target length about **15 seconds**. Style: "restrained: let the pacing build up to one close-up on the mate".
