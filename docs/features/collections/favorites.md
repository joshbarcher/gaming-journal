# Favorites

Games flagged as `favorite` at `/favorites`.

## Layout

- **Hero section**: the first game in the favorites list gets a full-bleed crossfading screenshot slideshow (same two-`<div>` alternating opacity pattern as GameHero), with a 14-second interval between image changes
- **Hero info**: local review stars, HLTB main time, playtime, community review score
- **Card list**: remaining favorites below the hero
- **Subtitle**: total playtime across all favorites (e.g., `"12 games · 847h played"`)

## Data source

- `GET /api/flags` filtered for `flag.favorite === true`
- `GET /relay/api/steam/games` for game metadata
- For the hero game: `GET /api/local-reviews/{appid}`, `GET /api/flags/{appid}`, and `GET /relay/api/steam/community-reviews/{appid}` to populate the detailed hero section

## No ordering

Unlike Backlog and In-Progress, favorites have no drag-to-reorder. The hero is always the first game in the list (determined by the order returned from flags, typically insertion order).

## Key files

| File | Role |
|------|------|
| `src/lib/svelte/favorites/Favorites.svelte` | Favorites component |
| `src/routes/favorites/+page.svelte` | Route shell |

## Common questions

**Q: How do I change which game shows as the hero?**
There's no explicit "set as hero" control. The hero is always the first flagged favorite. Remove and re-add the favorite flag to change the order, or reorder via the flags data directly.

**Q: The hero background images are slow to load.**
The slideshow preloads the next image during each transition. On first load there may be a brief blank moment before the first screenshot loads from the relay cache.

## Gotchas

- **Hero community score** may show `null` on first load if not yet cached — same as on the game page; a background sync fires to populate it.
- **The slideshow uses the same two-element crossfade as GameHero** — `bgAEl` and `bgBEl` are bound to the two background divs and alternate opacity. If only one screenshot exists for the hero game, the slideshow just repeats that image.
