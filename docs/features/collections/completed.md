# Completed (Hall of Fame)

Games flagged as `completed` at `/hall-of-fame`. Games you've finished, grouped into tiers by total playtime.

## Tiers

| Tier | Minimum playtime | Symbol | CSS class | Display |
|------|-----------------|--------|-----------|---------|
| Legend | 100h+ | ◆ | `hof-tier--legend` | Featured (prominent) |
| Veteran | 50h+ | ▲ | `hof-tier--veteran` | Standard |
| Completed | 20h+ | ● | `hof-tier--completed` | Standard |
| Finished | <20h | ○ | `hof-tier--finished` | Standard |

Tiers are determined by `playtime_forever` (Steam's total minutes played, divided by 60). No manual override — if the game was played on another platform or Steam playtime is wrong, the tier will be wrong.

The Legend tier has `featured: true` and receives visually prominent display (larger cards or hero section).

## Subtitle

`"N games conquered · Xh total"` — sum of all playtime across completed games.

## No ordering

Games are grouped by tier only. Within each tier the order is determined by the flags data (insertion order). No drag-to-reorder.

## Data source

- `GET /api/flags` filtered for `flag.completed === true`
- `GET /relay/api/steam/games` for playtime and metadata

## Key files

| File | Role |
|------|------|
| `src/lib/svelte/hall-of-fame/HallOfFame.svelte` | Hall of Fame component |
| `src/routes/hall-of-fame/+page.svelte` | Route shell |

## Common questions

**Q: A game I completed is in the wrong tier.**
Tiers are based solely on `playtime_forever` from Steam. If you played primarily on another platform, or Steam's playtime tracking was off, the hours will be wrong. There's no manual tier override.

**Q: How do I mark a game as completed?**
From the game page FlagsBar — toggle the "completed" flag. The game then appears on this page automatically.

## Gotchas

- **Route is `/hall-of-fame`, nav label is "Completed"** — these refer to the same page. The sidebar shows it as "Completed" and the route is `/hall-of-fame`. `getActiveId` maps `hall-of-fame` to the nav item correctly.
- **`grouped` is a `Map`** keyed by tier `key` (`legend`, `veteran`, `completed`, `finished`) — iterate in `TIERS` order, not insertion order, to preserve the tier hierarchy in the UI.
