# In Progress

Games flagged as `inProgress` at `/in-progress`. For games actively being played or paused mid-playthrough.

## Layout

Same queue/rest split as Backlog (first 3 = queue, rest below). Subtitle: `"Xh invested across N paused games"`.

## Features

### HLTB progress bar
Each card shows a fill-bar representing how far through the game you are, based on playtime vs. HLTB estimates:

- **Fill**: `Math.min((playedH / ceiling) * 100, 100)%` where `ceiling` = completionist > main+extras > main
- **Tick marks**: vertical lines at the Main Story and Main+Extras milestones (if below ceiling)
- **Label** (dynamic):
  - `"43% of Main Story"` — if below main story estimate
  - `"Main done · 67% of Main+Extras"` — if past main, below extras
  - `"Extras done · 89% completionist"` — if past extras, below completionist
  - `"Past all estimates"` — if beyond all HLTB estimates

If no HLTB data exists for a game, no progress bar is shown.

### Drag-and-drop ordering
Same as Backlog — order persisted via `PUT /api/order/in-progress`. Separate order from the backlog order.

## Data source

- `GET /api/flags` filtered for `flag.inProgress === true`
- `GET /relay/api/steam/games` for game metadata (playtime, HLTB, name, header)
- `GET /api/order/in-progress` for saved order

## Key files

| File | Role |
|------|------|
| `src/lib/svelte/in-progress/InProgress.svelte` | In-Progress component |
| `src/routes/in-progress/+page.svelte` | Route shell |
| `src/routes/api/order/in-progress/+server.ts` | GET/PUT saved order |

## Common questions

**Q: The progress bar shows 100% but I haven't finished the game.**
The bar caps at 100% (`Math.min(..., 100)`). If your playtime exceeds all HLTB estimates, it fills completely and the label shows "Past all estimates." This just means you've played longer than HLTB's data predicts — it doesn't mean the game detected you as completed.

**Q: No progress bar shows for a game.**
HLTB data (`gameplayMain`, `gameplayMainExtra`, `gameplayCompletionist`) must be non-null for the bar to render. If HLTB hasn't matched this game, no bar appears. Refresh HLTB from the game page to trigger a match.

## Gotchas

- **Playtime used is `playtime_forever`** (Steam's stored total), not the live session playtime. The bar won't tick up during an active session — it updates on next data reload.
- **`ceiling` picks the highest available HLTB milestone** — completionist if available, otherwise main+extras, otherwise main. This ensures the bar always represents progress toward the most ambitious goal you have data for.
