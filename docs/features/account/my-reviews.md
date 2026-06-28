# My Reviews

All local reviews across all games at `/my-reviews`. A searchable, sortable grid of every game you've reviewed in-app.

## Data

Two parallel fetches on mount:
- `GET /api/local-reviews` → `Record<appid, LocalReview>` — all stored local reviews
- `GET /relay/api/steam/games` → game list for names and header images

Reviews with no games match (e.g., discovered games not in the Steam library) still show — name falls back to `"App {appid}"`.

## Filtering and sorting

**Search**: filters by game name or tags (case-insensitive substring). No debounce — reactive to `bind:value`.

**Sort options:**

| Option | Sort key |
|--------|----------|
| By Stars | `stars` descending, then name ascending |
| By Name | Game name ascending |
| Recently Reviewed | `rev.updatedAt` descending |

## Card layout

Each card links to `/game/{appid}` and shows:
- Header image (dimmed if no stars: `mr-card-img--unrated`)
- Star overlay: filled stars (`★`) for ratings 1–5; a `✦` symbol appended for Legendary (stars === 6)
- Game name
- Up to 3 tags as pills
- Review text excerpt (first line / truncated)

Stars display: `Math.min(stars, 6)` star icons. For `stars === 6` (Legendary), the 6th icon is `✦` (not a regular star) — matching the display pattern in LocalReviewCard.

## Key files

| File | Role |
|------|------|
| `src/lib/svelte/my-reviews/MyReviews.svelte` | My Reviews page component |
| `src/routes/my-reviews/+page.svelte` | Route shell |
| `src/routes/api/local-reviews/+server.ts` | `GET /api/local-reviews` (all reviews) |
| `src/routes/api/local-reviews/[appid]/+server.ts` | Per-game review CRUD |

## Common questions

**Q: A game I reviewed isn't showing.**
`allEntries = Object.entries(reviews)` — every key in the `/api/local-reviews` response maps to a card. If a review is missing, it wasn't saved. Check `/api/local-reviews/{appid}` directly to verify.

**Q: The search doesn't find a game by tag.**
Tags are matched with `tag.toLowerCase().includes(q)`. The search checks all of `rev.tags`, not just the 3 displayed on the card. If the tag isn't in `rev.tags`, it won't match.

## Gotchas

- **Legendary (stars === 6) renders `✦` as the 6th icon** — the loop is `Array.from({ length: Math.min(stars, 6) }, ...)`, so for Legendary it runs 6 iterations; the 6th iteration (`i === 6`) renders `✦` instead of `★`. This matches LocalReviewCard's display.
- **No editing from this page** — cards link to the game page where the review modal is opened. My Reviews is read-only display.
- **`updatedAt` field** — review records have an `updatedAt` ISO timestamp written by the relay on every save. "Recently Reviewed" sort uses this; it's not the initial creation date.
