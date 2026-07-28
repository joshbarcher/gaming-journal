# Map Downloading

Downloads an interactive map for fully-offline use: the map definition, marker icons, and either a tile pyramid or a base image per area. Supports IGN (Map Genie) and Game8 — see [features/guides/map-sources.md](../../features/guides/map-sources.md) for how the two backends differ.

There is **no parse phase**. The fetchers write their own normalized `map.json`, because normalization is a pure JSON transform with no DOM selectors to maintain.

## When it runs

A map is **its own `mode: 'map'` job — never a phase of a guide download.** A deep pyramid is ~87k tiles and over an hour, which must never gate guide availability or stall a re-download queued behind it.

Jobs are queued from the map view's download button (`POST /relay/api/guides/:steamId/:source/:guideId/maps`) and appear on Downloads tagged **Map**, rendering a single **Tiles** bar. `fetch-map.js` can also be run directly.

## Data flow

1. `fetch-map.js` detects the source from the URL host (`ign.com` / `game8.co`), or `--source`.
2. **IGN** — `discoverMaps()` reads `/maps/{slug}` (an index page) for the map list, then `fetchMap()` pulls the map page's `__NEXT_DATA__`, saves it to `_raw/_next.json`, normalizes, downloads the sprite, then descends the pyramid.
3. **Game8** — `discoverMapping()` loads the article in Puppeteer and captures its own `tool_structural_mappings/{id}.json` call, then `fetchGame8Map()` splits `areas[]` into one map dir each, downloading a base image per area and one icon per classification.
4. `map.json` and `_maps/_index.json` are written, and the index rebuilt.

## CLI

```
fetch-map.js --url <u> --steam-id <id> [--guide-id <slug>] [--all-maps]
             [--max-zoom N] [--concurrency N] [--skip-tiles] [--reparse]
             [--reindex] [--force] [--progress-bar <name>]
```

`--reindex` republishes `tiles.json` / `map.json` from what's on disk with **no network** — for recovering an interrupted run.

## Tile pyramid (IGN)

Tiles are ordinary Web Mercator XYZ, which is why the viewer uses Leaflet's default CRS. Discovery is a **quadtree descent**, not a bounding-box scan: the pyramid is a solid rectangle at every level and each tile's four children exist one level down, so descending from `minZoom` visits exactly the tiles that exist.

Palworld z8–16 is 1 → 4 → 16 → … → 65,536, **87,381 total (~280 MB)**. Measured throughput ~25 tiles/s, so ~75 minutes.

**Level-existence probe.** A map's declared `maxZoom` is not always rendered — Lego Batman advertises 16 while its tileset stops at 15. Before committing to a level, one parent's four children are probed; if all are absent the descent stops, `truncatedAt` is set, and the pyramid still counts as `complete`. Four requests instead of 65,536.

## Progressive availability

Tiles are published **as each level completes**:

1. `map.json` and `_index.json` are written **before any tile is fetched**, so the map opens immediately.
2. After each level, `tiles.json` is rewritten with the depth now on disk and `map.json`'s tile block updated to match.
3. The viewer polls `tiles.json` (5 s) while `complete` is false, raising Leaflet's zoom ceiling as levels land.

`tiles.json` is a separate few-hundred-byte file precisely so it can be polled — `map.json` is ~2.4 MB.

## Progress reporting

Two cadences, because the pyramid is back-loaded (z16 alone is 75% of the tiles):

- **Bar** every second, to one decimal. Whole-percent steps meant ~45 s of a motionless bar.
- **Log line** every 4 s with per-level counts, overall position, rate and ETA. Previously it only printed when a level *finished*, leaving the status frozen for most of an hour.

ETA is computed from **newly-fetched tiles only** — cached tiles return instantly and would make a resumed run's estimate uselessly optimistic.

## Politeness

Pacing lives in `guides/config.js` under `map`:

| Setting | Default | Role |
|---|---|---|
| `tileConcurrency` | 6 | parallel tile downloads |
| `tileDelayMinMs` / `tileDelayMaxMs` | 120 / 320 | jittered pause **per worker** |
| `tileRetries` | 3 | 5xx/429/network only |
| `retryBackoffMs` | 800 | doubles per attempt; `Retry-After` overrides |
| `pageDelayMinMs` / `pageDelayMaxMs` | 1500 / 3800 | between map pages under `--all-maps` |

`concurrency × (pace + latency)` is the real throttle — roughly 25 req/s, all to `tiles.mapgenie.io`. **`ign.com` gets one request per map fetch.**

## Storage layout

Maps live inside the guide for the same game.

```
guides/{steamId}/{source}/{guideId}/_maps/
    _index.json                 every map downloaded for this guide
    {mapSlug}/
        _raw/_next.json         raw payload (IGN; re-normalize without refetch)
        map.json                normalized — contracts/ignMap.ts
        tiles.json              live tile depth (tiled maps only)
        sprite.png              IGN: one sheet for all markers
        base.<ext>              Game8: the area's base image
        icons/<slug>.<ext>      Game8: one per classification
        tiles/{z}/{x}/{y}.jpg   tiled maps only
```

## Common questions

**Q: Does re-running re-download tiles?**
No. Resume indexes each level with one `readdir` per x-directory (`scanLevel`) rather than a `stat` per tile — 87k stats over SMB is minutes of nothing. Cached tiles also skip the inter-request pacing.

**Q: What happens to a running map job if the app restarts?**
It's lost. The job queue is in-memory (`const _jobs = []`) with no persistence and no restore on boot. The child process dies or is orphaned, and the job vanishes from the UI. Re-queue it — the fetcher skips everything already on disk.

**Q: A game has no map. Does that fail the job?**
No. `fetch-map.js` exits 0 for `NoMapError` (404) and `UnsupportedMapError` (a backend we don't read).

**Q: Why is `bytes` carried forward on a resumed run?**
Cached tiles contribute no bytes this run, so a fully-cached re-run would report zero. The cached tiles are exactly what an earlier run wrote, so its recorded total is precisely their size.

## Gotchas

- **`rebuildIndex` must not walk the tree.** `sizeBytes` comes from each map's recorded totals; a recursive stat over 87k files adds minutes to every run, including no-op ones.
- **`--reindex` reports the deepest COMPLETE level.** Reaching maxZoom isn't the same as filling it; an interrupted run leaves a partial deepest level, and reporting it would let the viewer zoom into holes.
