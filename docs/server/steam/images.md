# Steam Images

Downloads and serves game images (header, capsule, poster, hero, background, logo), screenshots, and achievement icons from Steam CDNs. Per-game local files. The CDN URL that succeeded per file is tracked in a `sources.json` singleton to skip already-downloaded files. Lives in `src/lib/server/relay/steam/images.service.js` + `image-sources.js`.

## Data flow

### Game images
1. `syncGameImages({ force })` iterates owned games + non-owned wishlist appids × 6 image types.
2. Phase 1 (no disk I/O): skip a type if `sources.json` already records a URL that is still in the expected URL list.
3. Phase 1.5: for hash-based types (`header`, `capsule`, `background`), fetch `appdetails` for games with no cached store URL and persist the resolved URL into `steam/store/{appid}.json`.
4. Phase 2 (20 req/s): download from the first non-404 URL in the chain (store-resolved URL prepended when available). Success recorded in `sources.games[appid][filename]`.
- `syncOneGame(appid)` / `syncOneScreenshots(appid)` are the per-game variants used by the discovery worker.
- `ensureDiscoveryImages(items)` (8-way concurrency) ensures `poster.jpg` + `header.jpg` for discovered/featured games, trying each item's known CDN URL before pattern fallbacks; returns the appids confirmed to have a poster.

### Achievement icons
1. `syncAchievementImages({ appids })` — called by the 30-min tick after `syncAchievements()`, passing only the just-synced appids.
2. Reads the **sharded** achievement cache via `getAchievements()` / `getAchievementsForGame(id)` (dynamic import; the old monolithic `achievements.json` is retired). Downloads `icon` (color) + `icongray` (gray) per achievement.
3. Stored under `steam/images/achievements/{appid}/` with sanitized filenames.

### 6 game image types (CDN chain per type)

| Type | Primary CDN path | Fallbacks |
|------|------------------|-----------|
| header | `apps/{id}/header.jpg` | CDN2 header |
| capsule | `apps/{id}/capsule_616x353.jpg` | CDN2 |
| poster | `apps/{id}/library_600x900_2x.jpg` | CDN2 |
| hero | `apps/{id}/library_hero.jpg` | CDN2 |
| background | `apps/{id}/background_raw.jpg` | `page_bg_generated_v6b.jpg`, CDN2 |
| logo | `apps/{id}/library_logo.png` | CDN2, `logo.png` |

CDN1 = `cdn.akamai.steamstatic.com`, CDN2 = `shared.akamai.steamstatic.com/store_item_assets`.

## Key files

| File | Role |
|------|------|
| `src/lib/server/relay/steam/images.service.js` | `syncGameImages`, `syncScreenshotImages`, `syncAchievementImages`, `ensureDiscoveryImages`, `syncOneGame`, `syncOneScreenshots`, `downloadFile`, `migrateSrcSidecars` |
| `src/lib/server/relay/steam/image-sources.js` | `getSourcesFile`/`makeSourcesFile` — the `sources.json` singleton |
| `src/routes/relay/api/steam/images/{games,screenshots,achievements/images}/sync/+server.ts` | `POST` sync endpoints (`relayRoute('steam-images')`); also `migrate-sources` |
| `src/routes/relay/images/steam/[...file]/+server.ts` | Serves the files at `/relay/images/steam/...` |

## Storage layout

Under the relay data root (`RELAY_DATA_ROOT`; prod `/mnt/data-dir/gaming-journal/relay`):

```
steam/
  images/
    games/{appid}/        header.jpg capsule.jpg poster.jpg hero.jpg background.jpg logo.png
    screenshots/{appid}/  {id}.jpg
    achievements/{appid}/ {safeName}_{color|gray}_{filename}
    sources.json          ← { games:{}, screenshots:{}, achievements:{} } keyed by appid → { filename: usedUrl }
```

Files are served at `/relay/images/steam/...`. Downloads call `recordWrite()` (activity tracking) for NAS write accounting.

## Common questions

**Q: What is `sources.json` for?**
Records which CDN URL succeeded per file. On the next sync, a file is skipped if its stored URL is still in the expected list — without it every sync would re-attempt downloads. Note the shape is now `{ section: { appid: { filename: url } } }`, not flat `{appid}.{type}` keys.

**Q: All CDN URLs 404?**
`downloadFile` returns `{ result: 'missing', url: null }`; the slot stays empty and the client falls back to a CDN URL or placeholder.

## Gotchas

- Achievement filenames are sanitized: Windows reserved names (`CON`, `PRN`, …) get a `_` prefix; illegal chars → `_`; trailing dots/spaces → `_`.
- `syncAchievementImages` with an explicit empty `appids: []` downloads nothing (matching the pre-shard contract) and does not warm the cache; `undefined` means "all".
- `statRetry` wraps `fs.access` in `ensureDiscoveryImages` to ride out `EAGAIN` on the NAS.
