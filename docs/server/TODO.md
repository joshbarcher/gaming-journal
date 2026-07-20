# Server Docs — index

Backend service reference docs (`src/lib/server/relay/`), ported from the former relay repo and rewritten for the folded-in design (2026-07-18). Format spec: `guidance.md`. Orientation + topology: `../relay-server.md`.

All every path/route/function/storage location was verified against the live code during the port.

## core/
- [x] `startup.md` — `bootRelay()` / fast-boot / `ENABLE_SCHEDULERS`
- [x] `sync-tick.md` — the 30-min Steam tick sequence
- [x] `managed-file.md` — atomic JSON store, audit/checkpoint, promise-cached singletons

## steam/
- [x] account · achievements · applist · community-reviews · discovery · featured
- [x] games · images · news · now-playing · play-log · player-counts · player-stats
- [x] progress-suggest · recently-played · reviews-api · reviews-scraper · sessions
- [x] store · upcoming · videos · wishlist

## external/
- [x] igdb · nexus · pcgw · protondb · reddit

## guides/
- [x] fetching · job-queue · parsing · search

## hltb/ · itad/ · system/
- [x] hltb · itad · pin · provision · recommend

## Not ported (left the app at decommission)
- **mail** → standalone `emails` app (`C:\dev\emails`, :8025)
- **sms** → `beacon`

## Issues surfaced during the port (not yet fixed)
- **`steam/account.md`** — `achievementsUnlocked` reads the retired monolithic `achievements.json` (now `.migrated`) → derives 0; account "Achievements" stat is broken. Same class as the fixed `steam:images` regression. Fix: read the sharded cache.
- **`steam/videos.md`** — no on-demand trailer download exists in the journal; trailers are served only from files the retired relay pre-fetched. New games get none. Re-adding download is a new feature, not a regression.
