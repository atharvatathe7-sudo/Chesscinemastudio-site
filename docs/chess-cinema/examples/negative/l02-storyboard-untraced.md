## Storyboard

Target: about 18 s. Range: plies 1–13 (the whole game). Ending: the mating close-up, then the full board
(return_to_full true).

1. **Setup.** The opening moves pass quickly: 250–300 ms each.
2. **Anticipation.** 3… Bg4 pins the knight to the queen, and the arrow shows the pin line (A1). The pause after
   4… g6 is the last quiet moment before the strike (C1).
3. **Strike.** 5. Nxe5 in close-up, with the queen on d1 as Story Target: the knight leaves the pin and the queen
   is attacked (A2).
4. **Response.** 5… Bxd1 takes the queen (A3).
5. **Consequence.** 6. Bxf7+, the only reply 6… Ke7 (A4), then 7. Nd5# (A5): a 4-second hold on the mate, then
   the full board.

| Ply | SAN | Role | Evidence from the analysis | Camera | Hold |
|---|---|---|---|---|---|
| 6 | Bg4 | anticipation (pin) | A1: the bishop pins the knight on f3 to the queen on d1 | arrow g4→d1 | 1200 |
| 9 | Nxe5 | strike | A2: captures on e5; the g4 bishop now attacks the queen on d1; claims: capture | close, target d1 | 2500 |
| 10 | Bxd1 | response | A3: Black captures the queen; claims: capture | close | 1800 |
| 11 | Bxf7+ | strike | A4: captures on f7 with check; only reply 6… Ke7; claims: capture, check | close | 1800 |
| 13 | Nd5# | consequence | A5: checkmate; claims: mate | close, then return to the full board | ending 4000 |

### Not expressible in the schema
- A title card "Legal's mate": there is no text rendering.
- Slow motion on 5. Nxe5: `move_ms` is not supported.
- One unbroken close-up through plies 9–13: continuity cannot be forced. The inspector shows the camera easing
  out for 6… Ke7 and zooming in again for 7. Nd5#.

### Missing from the analysis
- Any classification of 5… Bxd1 or 5. Nxe5 (none was supplied), so none is implied.

### Accepted story-lint warning
- `Q_SELECTIVITY`: 6 of 13 plies are emphasized (46 %). The game is a 13-ply miniature whose whole second half is
  the combination. Removing emphasis to get under 25 % would hide the story.
