# Backlog

Games flagged as `backlog` at `/backlog`. For games you intend to play but haven't started yet.

## Layout

- **Queue** (first 3 games): visually highlighted as "next up"
- **Rest**: remaining games in a standard card list below the queue
- **Subtitle**: `"~Xh of games waiting"` (sum of HLTB main estimates) or `"N games waiting"` if no HLTB data

## Features

### HLTB estimates
Each card shows the HLTB estimated playtime: `gameplayMain` hours if available, falling back to `gameplayCompletionist`. The subtitle accumulates these to give a total backlog time estimate.

### Random pick
A "Random pick" button selects a random game from the full list and highlights it. Useful for breaking analysis paralysis.

### Drag-and-drop ordering
Games can be dragged to reorder. Order is persisted server-side via `PUT /api/order/backlog` (sends an array of appids). On load, `GET /api/order/backlog` fetches the saved order and games are sorted accordingly.

Order is stored separately from the flag — removing the `backlog` flag from a game leaves its appid in the order array harmlessly.

## Data source

- `GET /api/flags` filtered for `flag.backlog === true`
- `GET /relay/api/steam/games` for game metadata (HLTB, name, header)
- `GET /api/order/backlog` for saved order

## Key files

| File | Role |
|------|------|
| `src/lib/svelte/backlog/Backlog.svelte` | Backlog component |
| `src/routes/backlog/+page.svelte` | Route shell |
| `src/routes/api/order/backlog/+server.ts` | GET/PUT saved order |

## Common questions

**Q: What's the difference between Backlog and In-Progress?**
Backlog = games you plan to play but haven't started. In-Progress = games actively being played or paused mid-playthrough. Both show first 3 as a queue but In-Progress adds HLTB progress bars showing how far you are.

**Q: A game appears in both Backlog and In-Progress.**
Flags are independent booleans — a game can have multiple flags set simultaneously. There's no auto-clear when you start playing; you manage flags manually on the game page.

## Gotchas

- **Ordering persists via appid array, not positions** — if you add or remove games, the saved order array still references the old appids. Missing appids are simply skipped when displaying; the position of surviving games is preserved.
- **Queue is always the first 3 after ordering** — there's no way to manually designate a game as "in the queue" vs. the rest other than its position in the drag order.
