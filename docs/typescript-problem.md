# TypeScript `any` Problem — Phase 1 Typing

## Background

A Phase 0 TypeScript migration was recently completed. All `// @ts-nocheck` suppressions were
removed from every Svelte component, and the project now passes `npm run typecheck` with 0 errors
and all 261 tests green.

However, the migration reached zero errors by leaning heavily on `any` as a crutch for API
response data. This is the technical debt that Phase 1 should resolve.

---

## What Exists Today

`src/lib/types.ts` already has well-typed definitions for **internal/storage** data:

- `Page` union and subtypes (`ListPage`, `ProgressPage`, `ProgressBarsPage`, etc.)
- `Task`, `Step`, `Bar`, `Counter`, `JournalListItem`
- `Flags`, `FlagsStore`, `Settings`
- `LocalReview`, `ReviewNote`
- `Franchise`, `FranchiseEntry`
- `CommunityPrefs`
- `Segment`, `AlertResult`, `BestPrice`

What is **missing** is types for every shape that comes from the relay API — the external Steam /
Reddit data that flows through almost every component.

---

## The Core Problem

### 1. API response shapes are typed as `any`

In nearly every Svelte component, state variables holding API data look like this:

```typescript
let game             = $state<any>(null)
let communityReviews = $state<any>(null)
let post             = $state<any>(null)
let comments         = $state<any[]>([])
let sources          = $state<any[]>([])
let owned            = $state<Set<number>>(new Set())
let ownedMap         = $state<Map<number, any>>(new Map())
```

These `any` types mean TypeScript cannot catch:
- Typos in property names (`game.stor.description` instead of `game.store.description`)
- Missing null checks on nullable fields
- Broken assumptions when the relay API changes a field name or shape
- Wrong types passed between components

### 2. Callback parameters are polluted by missing array element types

Because the source arrays are `any[]`, every callback must be manually annotated:

```typescript
// These `: any` annotations only exist because the array has no element type
ownedMap = new Map<number, any>(owned.map((g: any) => [g.appid, g]))
sources.filter((s: any) => s.posts?.length > 0)
comments.map((c: any) => c.id)
(page.bars ?? []).find((b: any) => b.id === barId)
```

With proper types these would just be:
```typescript
ownedMap = new Map(owned.map(g => [g.appid, g]))          // g: SteamGame
sources.filter(s => s.posts.length > 0)                   // s: RedditSource
comments.map(c => c.id)                                   // c: RedditComment
(page.bars ?? []).find(b => b.id === barId)               // b: Bar  ← already typed!
```

### 3. Type casts that shouldn't need to exist

```typescript
(prefs as any)[key]                          // prefs has a known shape
(el as HTMLElement).dataset.author           // legitimate DOM cast, fine to keep
scoreMap.get((el as HTMLElement).dataset.id) // same
(getWithTTL(STORAGE_KEY) as string)          // storage.ts returns unknown — fixable
```

The `prefs` cast specifically exists because `CommunityPrefs` (already in types.ts) uses named
fields (`filtered`, `muted`, etc.) but the code uses dynamic string keys. Either an index
signature or a helper function resolves this.

---

## Types That Need to Be Defined

Add these to `src/lib/types.ts`. The shapes below are derived from how the data is consumed across
the components — treat them as starting points and adjust to match the actual relay API responses.

### Steam / Game data

```typescript
// Returned by /relay/api/games/:appid and /relay/api/steam/games
export interface SteamGame {
    appid:            number
    name:             string
    source?:          'library' | 'wishlist' | 'both' | 'discovered'
    playtimeMinutes?: number
    playtime_forever?: number   // raw Steam field name used in library lists
    rtime_last_played?: number

    media?: {
        header?:      string
        background?:  string
        logo?:        string
        screenshots?: string[]
    }
    store?: {
        description?:         string
        detailedDescription?: string
        releaseDate?:         string
        releaseDateIso?:      string
        comingSoon?:          boolean
        developers?:          string[]
        publishers?:          string[]
        genres?:              string[]
        categories?:          string[]
        platforms?:           { windows?: boolean; mac?: boolean; linux?: boolean }
        price?:               { formatted: string; amount: number }
        isFree?:              boolean
        unavailable?:         boolean
        metacritic?:          number | { score: number; url?: string }
    }
    hltb?: {
        matched:               boolean
        gameplayMain?:         number
        gameplayMainExtra?:    number
        gameplayCompletionist?: number
    }
    itad?: {
        bestPrice?: BestPrice
    }
    wishlist?: {
        priority?:  number
        dateAdded?: number
        local?:     boolean
    }
    flags?:   Flags
}
```

### Reddit / Community data

```typescript
// Returned by /relay/api/reddit/:appid
export interface RedditPost {
    id:          string
    title:       string
    author?:     string
    score:       number
    numComments: number
    createdUtc:  number
    subreddit?:  string
    permalink?:  string
    selftext?:   string
    flair?:      string
    isVideo?:    boolean
    isGallery?:  boolean
    thumbnail?:  string
    url?:        string
    galleryImages?: { url: string; thumbnail?: string; localImage?: string }[]
}

export interface RedditComment {
    id:       string
    author?:  string
    body:     string
    score:    number
    replies?: RedditComment[]
    createdUtc?: number
}

export interface RedditSource {
    subreddit: string
    posts:     RedditPost[]
}

export interface RedditData {
    sources: RedditSource[]
}
```

### Community prefs (loaded state, distinct from the stored shape)

The existing `CommunityPrefs` in types.ts stores arrays; the loaded in-component state uses Sets:

```typescript
// Runtime shape used in CommunityPage/CommunityThread $state
export interface LoadedPrefs {
    filtered:    Set<string>
    muted:       Set<string>
    favorited:   Set<string>
    highlighted: Set<string>
}
```

The `(prefs as any)[key]` cast in `_setPref()` exists because `LoadedPrefs` has named fields but
the function uses a string key. Fix: add an index signature or replace the dynamic key with a
discriminated helper.

### Steam reviews

```typescript
export interface CommunityReviewSummary {
    ratio:       number
    total:       number
    positive:    number
    description: string
}

export interface CommunityReviews {
    summary?:  CommunityReviewSummary
    reviews?:  SteamReview[]
}

export interface SteamReview {
    author:        string
    voted_up:      boolean
    review:        string
    timestamp_created: number
    votes_up:      number
}

export interface MyReview {
    review?:       string
    voted_up?:     boolean
    timestamp_updated?: number
}
```

### Discover / Search

```typescript
export interface DiscoverItem {
    appid:         number
    name:          string
    headerImage?:  string
    price?:        number
    originalPrice?: number
    discount?:     number
    isFree?:       boolean
}

export interface DiscoverSection {
    id:     string
    label:  string
    page:   number
    pages:  number
    items:  DiscoverItem[]
}
```

### Player counts

```typescript
export interface PlayerCounts {
    appid:    number
    samples:  [number, number][]   // [unixTimestampSecs, playerCount]
}
```

---

## Where the `any` Types Are Used

Every component below has at least one `$state<any>` or `Map<number, any>` that should become a
proper type. The high-value targets are:

| Component | State to type |
|-----------|--------------|
| `GamePage.svelte` | `game`, `communityReviews`, `myReview`, `playerCounts`, `localReview`, `trailers` |
| `GameHero.svelte` | `game`, `communityReviews`, `protonData`, `itad`, `hltb` (all props) |
| `Home.svelte` | `ownedMap`, all the derived game arrays |
| `History.svelte` | `owned`, `ownedMap`, `lastPlayedMap` |
| `Abandoned.svelte` | same pattern as History |
| `Backlog.svelte` | same pattern |
| `HallOfFame.svelte` | same pattern |
| `InProgress.svelte` | same pattern |
| `LibraryPage.svelte` | `all: SteamGame[]` |
| `WishlistPage.svelte` | `all: SteamGame[]` |
| `Favorites.svelte` | `ownedMap`, game arrays |
| `TopGames.svelte` | `samples`, chart data |
| `Discover.svelte` | `featuredData: DiscoverSection[]`, search results |
| `CommunityPage.svelte` | `sources: RedditSource[]`, `prefs: LoadedPrefs` |
| `CommunityThread.svelte` | `post: RedditPost`, `comments: RedditComment[]`, `prefs: LoadedPrefs` |
| `Franchise.svelte` | `ownedMap: Map<number, SteamGame>`, `wishlistMap` |
| `Franchises.svelte` | `ownedMap: Map<number, SteamGame>` |
| `Account.svelte` | `recentlyPlayed`, `mostPlayed`, `sessions` |
| `JournalDashboard.svelte` | `game`, achievements arrays |
| `MyReviews.svelte` | `allEntries`, `gamesMap` |

---

## The Right Approach

1. **Expand `src/lib/types.ts`** with the shapes above (and any others discovered during the
   work). Keep all shared types here — don't scatter them into component files.

2. **Type props and state top-down**: start with a component's `$props()` declaration, then let
   the types flow into the derived state and callbacks. Most `: any` callback annotations will
   disappear automatically once the source array is typed.

3. **Use `SteamGame` in the Map types**: `Map<number, any>` → `Map<number, SteamGame>`. This
   alone eliminates a large fraction of the casts.

4. **Fix `getWithTTL` in `storage.ts`**: it currently returns `unknown`. Give it a generic:
   `getWithTTL<T = string>(key: string): T | null`. This removes the `as string` casts at every
   call site.

5. **Fix the `_setPref` dynamic key pattern** in CommunityPage/CommunityThread: replace the
   `(prefs as any)[key]` cast with a proper discriminated approach using `LoadedPrefs`.

6. **Verify with `npm run typecheck`** (target: 0 errors) and `npm test` (target: 261 passing)
   after each file. The test suite does not cover component rendering, so typecheck is the primary
   signal.

---

## What Good Looks Like When Done

```typescript
// Before
let game = $state<any>(null)
ownedMap = new Map<number, any>(owned.map((g: any) => [g.appid, g]))
sources.filter((s: any) => s.posts?.length > 0).map((s: any) => ({ ... }))

// After
let game = $state<SteamGame | null>(null)
ownedMap = new Map(owned.map(g => [g.appid, g]))           // g: SteamGame, inferred
sources.filter(s => s.posts.length > 0).map(s => ({ ... }))  // s: RedditSource, inferred
```

No spurious `: any` annotations in callbacks. No `as any` casts on data access. TypeScript
catches a misspelled `game.sotre.description` at compile time instead of silently returning
`undefined` at runtime.
