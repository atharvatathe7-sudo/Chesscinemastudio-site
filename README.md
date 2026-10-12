# Chess Cinema Studio: website

Source of the static website at https://chesscinemastudio.in. Plain HTML and CSS, **no build step**. Everything that is published lives in `public/`.

## Products

| Product | Status | Path |
|---|---|---|
| Chess Cinema | Available now (early prototype) | `/chess-cinema/` |
| Video Effects Lab | Available now (early version) | `/video-effects-lab/` |
| Integrated editing workflow | Planned, not built | n/a |

## Where the tool pages come from

- `public/chess-cinema/index.html` is `Chess_a-phase1c.html` from [Chess_13](https://github.com/atharvatathe7-sudo/Chess_13) at commit `f1d4625c7f64126e70261226a9f6f82f664bf697`, with these changes on top (see this repo's git history for each one): the `<title>` and `<h1>` read "Chess Cinema"; the unused player name/Elo/flag inputs are removed; the Capture FX control no longer overflows the panel; Prev/Next/Undo/Redo step from the selected timeline move; the turn label and the last-move preview match the board shown; a quick-start guide and a "Load sample game" button are added.
- `public/video-effects-lab/index.html` is `Video_Effects_Lab.html` from [Video_effects_lab](https://github.com/atharvatathe7-sudo/Video_effects_lab) at commit `efc51f7af7464860e9751787ea93cf5a5fd6d107`, unmodified.

## Hosting (Cloudflare Pages, Git integration)

| Setting | Value |
|---|---|
| Production branch | `main` |
| Framework preset | None |
| Build command | `exit 0` |
| Build output directory | `public` |
| Root directory | (default, repository root) |

## Contact

hello@chesscinemastudio.in
