# Community Page — TODO

## Subreddit Discovery

### Manual subreddit override
Some games use a franchise subreddit rather than a game-specific one. IGDB won't have
a Reddit link for these. Need a per-game override mechanism (small JSON config or
game settings field) so the correct subreddit can be pinned manually.

**Known gaps:**
- **Resident Evil Requiem** (appid 3764200) — community is at r/ResidentEvilRequiem
  but IGDB has no Reddit website linked for this title. Pin manually.

### Franchise subreddit fallback
If no game-specific subreddit is found via IGDB, attempt to find a franchise-level
subreddit (e.g. r/residentevil for any RE game). Needs to be conservative to avoid
wrong matches.

---

## Features

### Search
Filter posts by keyword within the currently active tab. Client-side (data already
cached) — no new API calls needed. Useful for "who else got stuck at this boss" queries.

### Image gallery tab
Dedicated tab showing only image posts from all sources. Grid layout. Good for fan art,
screenshots, memes.

### Steam community integration
Add Steam Hub discussions as a fourth source alongside the three Reddit tabs. The
community page sources abstraction is already generic (`{ id, label, type, posts }`)
and ready for this.
