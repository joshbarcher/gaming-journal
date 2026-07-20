# IGDB

Resolves a game's official subreddit name from the Internet Game Database (Twitch
IGDB API). The Reddit feature's only consumer. Narrow integration — not a primary
data source.

## Data flow

1. `reddit.service._syncGame()` calls `getSubreddit(appid, gameName)` while
   discovering which subreddits to crawl for a game.
2. `getSubreddit` returns null immediately if IGDB isn't configured or no name is
   given. Otherwise it checks the on-disk cache (30-day TTL) first.
3. On a miss it searches IGDB `games` by **name** (`search "<gameName>"; limit 5`),
   picks the closest name match (exact normalised → substring → first result).
4. For the matched game it queries `websites` and finds the entry whose URL matches
   `reddit.com/r/<name>`, extracting `<name>` via regex.
5. Writes `<appid>.json` `{ appid, igdbId, subreddit, fetchedAt }` and returns the
   subreddit name (or null — a confirmed "no subreddit", also cached).

## Key files

| File | Role |
|------|------|
| `src/lib/server/relay/igdb/igdb.service.js` | `getSubreddit`, `getEntry`, Twitch OAuth token cache, `igdbQuery` |
| `src/lib/server/relay/reddit/reddit.service.js` | Sole caller of `getSubreddit` |

No route/`+server.ts` handler and no scheduler — IGDB is called only in-process by
the Reddit sync.

## Storage layout

All paths relative to `RELAY_DATA_ROOT` (prod `/mnt/data-dir/gaming-journal/relay/`):

```
igdb/
  <appid>.json   ← { appid, igdbId, subreddit, fetchedAt }  (30-day TTL)
```

> Note: contrary to the old relay doc, subreddit lookups **are** now cached to disk
> (`ENTRY_TTL_MS = 30 days`) via `featureDir('igdb')` — they are not made fresh on
> every call.

## Common questions

**Q: What credentials does IGDB require?**
`IGDB_CLIENT_ID` and `IGDB_CLIENT_SECRET` (a Twitch app's client credentials).
`isConfigured()` returns false if either is missing, and `getSubreddit` then returns
null without any network call. An access token is fetched from
`https://id.twitch.tv/oauth2/token` (grant_type=client_credentials) and cached in
memory (`_token`/`_tokenExp`), refreshed 60 s before it expires.

**Q: Why look up by name instead of Steam appid?**
The name search proved more reliable than the `external_games` Steam-uid path. The
result is disambiguated by comparing normalised names (lowercase, punctuation and
leading articles stripped).

## Gotchas

- IGDB uses the **v4** API (`api.igdb.com/v4`) with `Client-ID` + `Bearer` headers
  and a `text/plain` Apicalypse body.
- A **transient** lookup failure (network/HTTP error) preserves the prior cached
  entry and does **not** advance `fetchedAt`, so the next run retries instead of
  locking a null in for the full 30-day TTL. A *successful* query that finds no
  subreddit legitimately caches null.
- The stored value is the bare subreddit **name** (e.g. `skyrim`), not a full URL.
