# Steam Videos (Trailers)

Serves game trailers as local MP4 files, per-game directory. The folded-in journal only **reads** the cached metadata and serves the files — the download step was not ported (see Gotchas).

## Data flow

1. Trailer metadata is cached at `steam/movies/{appid}.json` (a `movies[]` array with `name`, `highlight`, `thumbnail`, video URLs). Downloaded MP4s live at `steam/videos/{appid}/{index}.mp4`.
2. `getVideoMeta(appid)` reads `movies/{appid}.json`, sorts `movies[]` (highlighted first), and returns only the entries whose local `{index}.mp4` exists on disk (`fileExists`).
3. `GET /relay/api/videos/{appid}` returns that metadata array.
4. Files are served at `GET /relay/videos/steam/{appid}/{index}.mp4` via `serveStatic()` (`shared/static-files.ts`), which answers Range requests with `206` — required for `<video>` seeking.

## Key files

| File | Role |
|------|------|
| `src/lib/server/relay/steam/videos.service.js` | `getVideoMeta` — metadata for locally-available videos |
| `src/routes/relay/api/videos/[appid]/+server.ts` | `GET /relay/api/videos/:appid` (feature `steam-videos`); error bodies are `[]` |
| `src/routes/relay/videos/steam/[...file]/+server.ts` | Static MP4 serving via `serveStatic` (Range/206), root `steam/videos` |

## Storage layout

Paths under the relay data root (`RELAY_DATA_ROOT`; prod `/mnt/data-dir/gaming-journal/relay`).

```
<relay-data-root>/steam/
  movies/
    {appid}.json   ← { movies[{ name, highlight, thumbnail, ... }] } — metadata from the store API
  videos/
    {appid}/
      0.mp4        ← first trailer (highlight sort order)
      1.mp4        ← second trailer
      ...
```

## Common questions

**Q: How are videos indexed?**
By position in the sorted `movies[]` (highlighted first). `index` is the 0-based post-sort position, not the Steam movie ID.

## Gotchas

- **No download step in the journal.** Only `getVideoMeta` was ported; there is no route or service that fetches MP4s or writes `movies/{appid}.json`. Trailers are served from files already present on the NAS (written by the retired relay's download pipeline). If a new download path is needed it must be re-implemented.

  > **Known limitation:** there is no trailer *download* step in the journal — `videos.service.js` is read-only and `static-files.ts` only serves. Trailers are served from `.mp4` files the retired relay had already written to the NAS; a game with no pre-downloaded trailer gets none on-demand. Re-adding a download step (or a one-off backfill) would be a new feature, not a fold-in regression.

- `getVideoMeta` returns only trailers with a local file — undownloaded trailers are silently omitted.
- The highlight-first sort is applied at read time; `movies/{appid}.json` stores API order.
- No eviction policy — removing a trailer from Steam does not delete the local MP4.
