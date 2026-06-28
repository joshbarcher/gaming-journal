# Game Reviews

Three review types appear on the game page: the user's **local review** (app-specific rating system), the user's **Steam review** (synced from Steam), and **community reviews** (aggregated Steam score from all users).

## Local Review

A custom rating system independent of Steam. Stored on the relay, not in Steam.

### Data model
```ts
{
  stars:   number        // 1–5, or 6 for "Legendary"
  ratings: Record<string, number>  // slider keys → 0–10 scores
  tags:    string[]      // freeform text tags
  badges:  Record<string, number | boolean>  // badge id → count or true
  review:  string        // freeform text review
}
```

### Star scale
- 1–5 stars: standard rating, rendered as ★/☆
- 6 = **Legendary**: displayed as 5 gold stars + a "✦ Legendary" badge. There is no 6th star in the UI — `displayStars = isLegendary ? 5 : review.stars`.

### Layout (LocalReviewCard)
Two-column when any bars/tags/badges are present (`hasColumns`):
- **Left column** (`rev-local-left`): rating bars — one horizontal fill bar per active slider key (value > 0), labeled with key name and numeric value
- **Right column** (`rev-local-right`): tags as pills, then badges in a row

Text review below both columns, collapsed with "Read review ↓ / Show less ↑" toggle.

### Slider keys
Defined in `SLIDER_KEYS` (from `review-modal.js`). Each has a `key` and `label`. Only bars with value > 0 are shown (`activeBars`).

### Badges
Defined in `BADGES` (from `review-modal.js`). Each badge has `id`, `label`, `color`, `icon`, and optional `hasCount`. `hasCount` badges display "×N" when the stored count > 1 (e.g. "Replayed ×3").

### Editing
Clicking "Edit Review" or "✦ Write a Review" calls `openLocalReview()` → `openReviewModal(appid, gameName, existing)` (imported from `review-modal.js`). After save, re-fetches `GET /api/local-reviews/{appid}` to refresh the display.

### Key files

| File | Role |
|------|------|
| `src/lib/svelte/game/sections/LocalReviewCard.svelte` | Read-only display of local review |
| `src/lib/js/review-modal.js` | `openReviewModal()`, `SLIDER_KEYS`, `BADGES` constants |
| `src/lib/svelte/my-reviews/MyReviews.svelte` | `/my-reviews` page — lists all local reviews across all games |

## My Steam Review (MyReview)

The user's own Steam review for this game. Synced from Steam via the relay, read-only display.

- Data from `GET /relay/api/steam/reviews/{appid}` → `SteamUserReviewEntry`
- Shows: voted up/down, review text, hours at review time, date posted
- No editing — Steam reviews are managed on Steam

## Community Reviews (CommunityReviews)

Aggregated review score from all Steam users. Phase 1 data — loaded alongside the game, but may trigger a background sync.

- Data from `GET /relay/api/steam/community-reviews/{appid}` → `CommunityReviews`
- Shows: overall score label (e.g. "Very Positive"), review count, recent score
- If Phase 1 returns `null` (not cached): Phase 2 fires `POST /relay/api/steam/community-reviews/{appid}/sync` to populate it, then re-fetches
- `ScoreChip` in GameHero also shows the community review score as a compact chip

### Key files

| File | Role |
|------|------|
| `src/lib/svelte/game/sections/MyReview.svelte` | Steam review display |
| `src/lib/svelte/game/sections/CommunityReviews.svelte` | Community score display |
| `src/lib/svelte/game/sections/ScoreChip.svelte` | Compact score chip (used in GameHero) |
| `relay-server/src/services/steam/community-reviews.service.js` | Scrape + cache community score |

## Common questions

**Q: Legendary is 5 stars in the UI but stored as 6. Why?**
"Legendary" is semantically above "5 stars" — it's a special tier, not a 6th point on the same scale. The card always renders 5 star icons max; the Legendary badge appears alongside them. Never add a 6th star to the star row. See memory: [Local review card layout](../../../memory/feedback_local_review_layout.md).

**Q: Where are local reviews stored?**
Server-side on the relay. `GET/PUT /api/local-reviews/{appid}`. Not localStorage.

**Q: Community reviews sometimes show as "None" on first load. Is that a bug?**
No — it means the community review data isn't cached yet. Phase 2 will sync it in the background. Refreshing the page after a few seconds should show the score.

**Q: The review modal opens an existing review for editing. How does it know the current data?**
`openLocalReview()` in `GamePage` fetches `GET /api/local-reviews/{appid}` fresh before opening the modal, passing `existing` to pre-populate the form.

## Gotchas

- **`activeBars` only shows sliders with value > 0** — if a user set a slider to 0, it's treated as "not rated" and hidden. The left column only appears if at least one bar is active.
- **`hasColumns` controls the two-column layout** — if no bars, tags, or badges are set, the card collapses to just stars + review text (no columns). Don't assume the two-column DOM is always present.
- **MyReview is the user's personal Steam review** — not the community aggregate. Keep these conceptually separate; they come from different endpoints and display differently.
