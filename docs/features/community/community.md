# Community Page

Per-game community hub at `/game/{appid}/community`. Aggregates Reddit threads from one or more subreddits for a specific game, with per-user content preferences and a pinboard integration.

## Data model

```ts
CommunitySource {
  id:       string    // subreddit name (e.g. "persona3reload")
  label:    string    // display name
  posts:    Post[]    // paginated Reddit posts for this source
}

Post {
  id:          string
  title:       string
  url:         string
  score:       number
  createdUtc:  number
  numComments: number
  // ... other Reddit post fields
}
```

## Loading

On mount:
1. `GET /relay/api/games/{appid}` — game metadata (name, header image)
2. `GET /relay/api/community/{appid}` — all configured sources + posts
3. `GET /relay/api/pin` — current pinboard state
4. `loadPrefs()` — loads user preferences (filtered/muted/favorited/highlighted sets)

## Tabs

- **All** (`__all__`): merged and deduped across all sources, sorted by `createdUtc` descending. Posts appearing in multiple subreddits appear only once.
- **Per-source tabs**: one tab per configured subreddit, showing that source's posts only.

`displaySources = [allSource, ...sources]` — All tab is always first.

## Pagination

25 posts per tab (`PAGE_SIZE`). Each tab tracks its own shown count in `shownCounts`. "Load more" increments `shownCounts[sourceId]` by 25. This is client-side slicing — all posts are fetched up front.

## User preferences

Stored via `community-user-prefs.js`. Four preference sets, all persisted server-side:
- **filtered**: hidden posts (per post ID) — won't appear in the feed
- **muted**: muted subreddits — all posts from that source hidden
- **favorited**: starred posts
- **highlighted**: highlighted posts (visual emphasis)

Toggle functions: `toggleFilter(postId)`, `toggleMute(sourceId)`, `toggleFavorite(postId)`, `toggleHighlight(postId)` — each updates the pref and triggers a save.

Actions are exposed via a **context menu** on each post (`showContextMenu()`).

## Adding subreddits

A modal ("Add Subreddit") lets users link a subreddit to the current game:
- Text input with 350ms debounce
- Validates the subreddit exists via relay
- On confirm: relay creates the association
- Pending state shown via `pendingSub` while the subreddit is being indexed
- `SubredditLoader.svelte` handles the async post-add loading state

## Poll for updates

A `_pollTimer` checks for content updates every 60 seconds (`PIN_POLL_MS = 60_000`). Compares `mergedAt` from the latest fetch against `loadedMergedAt` — if newer content has arrived, sets `hasUpdate = true` which shows a "New posts available — click to reload" banner.

## Pin integration

The community page knows about the relay "pin" — the currently-active pinboard game:
- `isPinned`: this game is the current pin
- `isLive`: pinned and currently in an active session (`sessionEndedAt === null`)
- `isGrace`: pinned but session recently ended (`sessionEndedAt !== null`)

Clicking the pin icon calls `pinGame(appid)` / `unpinGame()`. The pinboard is a separate concept from community — it's the "now playing" widget in the home page mosaic. Pinning here just promotes the game to the home widget.

## Thread view

Clicking a post navigates to or opens `CommunityThread.svelte` — full thread view with nested comments (`Comment.svelte`). Comments are loaded on demand from the relay's Reddit data.

## Key files

| File | Role |
|------|------|
| `src/lib/svelte/community/CommunityPage.svelte` | Main community view — tabs, posts, prefs, pin |
| `src/lib/svelte/community/SubredditLoader.svelte` | Post-add loading state for new subreddits |
| `src/lib/svelte/community/CommunityThread.svelte` | Full Reddit thread + comments |
| `src/lib/svelte/community/Comment.svelte` | Recursive comment renderer |
| `src/lib/js/community-user-prefs.js` | `loadPrefs()`, `toggleFilter()`, `toggleMute()`, `toggleFavorite()`, `toggleHighlight()` |
| `src/lib/js/pin.js` | `getPin()`, `pinGame()`, `unpinGame()`, `fmtExpiry()` |
| `src/lib/js/views/community-render.js` | `fmtScore()`, `fmtTime()`, `thumbSrc()` |
| `relay-server/src/controllers/community/community.controller.js` | `GET /api/community/{appid}`, subreddit management |

## Common questions

**Q: The community page shows no posts.**
The game may not have any subreddits configured. Use "Add Subreddit" to link one. After adding, the relay needs to index it — the `SubredditLoader` shows indexing progress.

**Q: A post I hid keeps reappearing.**
Filtered posts are stored in user prefs on the relay. If prefs aren't loading (relay connectivity issue), the client falls back to empty sets and nothing is filtered. Check that `loadPrefs()` succeeds.

**Q: The "New posts available" banner appeared — what does that mean?**
The poll timer found that the relay has newer posts than what's currently displayed (`mergedAt` timestamp changed). Click the banner to reload posts without losing your tab position.

**Q: What's the difference between "filtered" and "muted"?**
- **Filtered**: hides a specific post by ID (one-off per post)
- **Muted**: hides all posts from an entire subreddit source (per source)

## Gotchas

- **All tab deduplication** — posts are deduped by `post.id`. If the same thread appears in two subreddits (cross-posts), it only shows once in the All tab. The per-source tab for each subreddit still shows it.
- **Pagination is client-side** — all posts load on mount; "Load more" just increases the slice shown. There's no lazy loading of posts from the relay after initial mount.
- **Pin and community are independent** — the pin icon on the community page writes to the home widget pinboard, not the community configuration. Pinning a game doesn't add or remove subreddits.
- **`loadedMergedAt`** is a plain variable (not reactive state) — it persists across polls to compare against the latest fetch result without triggering reactive re-renders unnecessarily.
