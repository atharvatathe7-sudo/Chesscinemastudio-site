## Storyboard

Target: about 18 s. Range: plies 41–56. Ending: the full board on the recapture (return_to_full true; the last ply
is framed full).

1. **Setup.** 21. Bc5+ and 22. Qc2 put the bishop and the queen on the c-file (C1, C2). The moves that follow,
   including the rook exchange, pass quickly.
2. **Anticipation.** After 26… Kc6, the queen, the bishop and the king are on one file. The arrow c2→c6 shows the
   line, and the position is held (A1).
3. **Strike.** 27. Be7+ in close-up, with the black queen on f6 as Story Target: a discovered check from the
   queen, and the bishop now attacks the queen (A2).
4. **Response.** 27… Kb6 is Black's only legal move. It is held on the full board (A3).
5. **Consequence.** 28. Bxf6 takes the queen in close-up (A4). 28… Nxf6 recaptures, and the full board is held
   for 3.5 s to show the material that is left (A5).

| Ply | SAN | Role | Evidence from the analysis | Camera | Hold |
|---|---|---|---|---|---|
| 52 | Kc6 | anticipation | A1: queen c2, bishop c5 and king c6 on the c-file, c3 and c4 empty | arrow c2→c6 | 1500 |
| 53 | Be7+ | strike | A2: discovered check from c2; the e7 bishop attacks the queen on f6; claims: check | close, target f6 | 2600 |
| 54 | Kb6 | response | A3: Black's only legal move | full board | 1000 |
| 55 | Bxf6 | strike | A4: the bishop captures the queen; claims: capture | close | 1800 |
| 56 | Nxf6 | consequence | A5: the knight recaptures; material after ply 56: White 25, Black 16; claims: capture | full | ending 3500 |

### Not expressible in the schema
- A caption "discovered check": there is no text rendering.
- A material counter on screen: there is no overlay for it.
- Keeping the close-up from 27. Be7+ through 28. Bxf6: a move with Story Targets ends its own close-up. The
  inspector shows the camera easing out for 27… Kb6 and zooming in again after 28. Bxf6 lands.

### Missing from the analysis
- Whether 26… Kc6 or another 26th move was better for Black: no evaluation or classification was supplied, so
  none is implied.
