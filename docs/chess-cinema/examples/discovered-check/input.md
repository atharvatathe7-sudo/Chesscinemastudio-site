# Input: discovered check wins the queen (the reviewed game, plies 41–56)

This is what is pasted into the four slots of [the prompt](../../storytelling-prompt.md). The game is the 69-ply
game the test harness calls `review` (`tests/harness/games.js` on the test branches).

> **ILLUSTRATIVE ANALYSIS — NOT A CHESSIS EXPORT.** The analysis below was written for this example from the
> moves themselves, and every statement was checked with chess.js 0.12.0. It contains no engine evaluations and no
> move classifications; where Chessis would give one, it says "not supplied". Material counts use the
> conventional piece values 1/3/3/5/9: a count, not an evaluation. The plan's `analysis.source` says `illustrative`.

## 1. Game header (Chess Cinema → Copy game header, at `ff71e1f`)

```json
{
  "plies": 69,
  "final_fen": "Qkb5/2p3p1/p2n4/1p1B4/1P1p4/P6N/5PPP/6K1 b - - 3 35",
  "fingerprint": "sha256:3a995f68223ef717ec5c86d99d4027cbd3dcb4dd6c5e6c2909b19b19792e0d50"
}
```

## 2. PGN

```
1. d4 e6 2. c4 Nf6 3. a3 Nc6 4. Nc3 d5 5. Nf3 dxc4 6. e4 Bd6 7. e5 Ne4 8. Nxe4 Be7 9. Bxc4 O-O 10. O-O a6
11. Ba2 b5 12. Qd3 Bb7 13. Bb1 f6 14. exf6 Bxf6 15. Nxf6+ Qxf6 16. Qxh7+ Kf7 17. Ng5+ Ke7 18. d5 exd5
19. Re1+ Ne5 20. Be3 Rad8 21. Bc5+ Kd7 22. Qc2 Rfe8 23. Nh3 Ng4 24. Ba2 Rxe1+ 25. Rxe1 d4 26. Be6+ Kc6
27. Be7+ Kb6 28. Bxf6 Nxf6 29. Qf5 Re8 30. b4 Bc8 31. Qc5+ Kb7 32. Bd5+ Kb8 33. Rxe8 Nxe8 34. Qc6 Nd6 35. Qa8#
```

## 3. Analysis (source: illustrative)

Moments:
- **A1. Ply 52, 26… Kc6.** The white queen on c2, the white bishop on c5 and the black king on c6 now stand on the
  c-file, with c3 and c4 empty. Classification: not supplied.
- **A2. Ply 53, 27. Be7+.** The bishop leaves c5 for e7. The queen on c2 now gives check along the c-file (a
  discovered check: the bishop on e7 does not attack c6). From e7 the bishop attacks the black queen on f6.
  Classification: not supplied.
- **A3. Ply 54, 27… Kb6.** Black's only legal move.
- **A4. Ply 55, 28. Bxf6.** The bishop captures the queen.
- **A5. Ply 56, 28… Nxf6.** The knight recaptures the bishop. Material: after ply 50, White 28 and Black 25; after
  ply 56, White 25 and Black 16.

Context:
- **C1. Ply 41, 21. Bc5+.** The bishop arrives on c5 with check.
- **C2. Ply 43, 22. Qc2.** The queen arrives on c2.

Moment plies (for story lint): 52, 53, 54, 55, 56.

## 4. Request

Target length about **18 seconds**. Style: "show the pieces lining up, then the discovered check and what it wins".
