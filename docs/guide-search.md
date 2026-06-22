# Guide Search — GameFAQs Discovery

## Script

`relay-server/src/tools/discover-guides.js`

Reads the top N most-played games from the relay, searches GameFAQs for each,
and reports found guide URLs with type (HTML / text).

```
node --env-file .env src/tools/discover-guides.js              # top 100
node --env-file .env src/tools/discover-guides.js --limit 20
node --env-file .env src/tools/discover-guides.js --offset 20 --limit 20
node --env-file .env src/tools/discover-guides.js --game "Elden Ring"
node --env-file .env src/tools/discover-guides.js --search-only   # skip /faqs fetch
node --env-file .env src/tools/discover-guides.js --debug          # candidate scores
```

Relay URL is hardcoded to `http://192.168.86.65:8050` (override via `RELAY_URL` env).

---

## How GameFAQs search works

**URL:** `https://gamefaqs.gamespot.com/search?game={query}`
(NOT `?q=` — the form field is `name="game"`, id `#searchtextbox`)

**Bot detection bypass required.** Headless Chrome reports `window.screen` as 800×600
by default — GameFAQs reads this and returns empty results. Fix: spoof screen dimensions
via `evaluateOnNewDocument` before the page loads.

Navigation flow: load the GameFAQs homepage first, then type into `#searchtextbox` and
submit. This sets the correct `Referer` header and avoids the empty-results bot response.

Game result links on the search page match: `/{platform}/{numericId}-{slug}`

---

## Candidate scoring

Each search result gets a combined score:

```
finalScore = nameSimilarity(steamName, gfaqName) + platScore(platform) / 100
```

**Name similarity rules:**
1. Exact normalized match → 1.0
2. One name is a prefix of the other → 0.9
3. Word overlap: `shared / max(queryWords, candidateWords)` — only words > 2 chars
   kept, except numeric tokens (any length) are always kept

**Platform priority** (higher = better): PS5=10, PS4=9, Switch=8, PC=7, PS3=5, PS2=3, PS1=2

**Minimum score to match: 0.6** — below this the game is reported as not found.

---

## Roman numeral normalization

GameFAQs uses roman numerals (Final Fantasy XVI); Steam often uses arabic (FINAL FANTASY XVI
or sometimes the arabic equivalent). Both are normalized before scoring:

```
"Final Fantasy XVI"  →  "final fantasy 16"
"Final Fantasy XV"   →  "final fantasy 15"
```

Covered range: I–XXV. Normalization runs inside `normalize()` via a word-boundary regex
so it doesn't mangle words like "mix" or "viii" appearing mid-word.

---

## Fallthrough for stub entries

Some games have multiple GameFAQs entries — a stub (no guides) and a real one
(e.g. "Final Fantasy XIV Online" has 0 guides; the guides live under
"Final Fantasy XIV Online: A Realm Reborn").

When the top candidate's `/faqs` page has 0 guides, the script tries the next candidate
**only if** that candidate's name starts with the top candidate's name (subtitle/expansion
pattern). Up to 3 candidates are tried.

This prevents falling through to unrelated games: "Borderlands 4" (0 guides, new game)
will NOT fall through to "Borderlands" (2009).

---

## Guide type detection

On a `/faqs` page, each guide link is examined. The nearest ancestor container
(`li`, `tr`, `.pod-game-titles`, `.faqlist`) is scanned for the word `HTML` to determine
type. Text guides report as `[text]`; HTML guides report as `[HTML]`.

---

## Known edge cases

| Game | Issue | Status |
|------|-------|--------|
| FINAL FANTASY XIV Online | Stub entry has 0 guides; real entry is "A Realm Reborn" | Fixed via fallthrough |
| Borderlands 4 | On GameFAQs but no guides yet (2025 release) | Correctly reports no guides |
| Final Fantasy XVI | GameFAQs uses roman numerals; Steam uses XVI | Fixed via roman→arabic normalization |
| Games not on GameFAQs | Returns not found (< 0.6 score) | Working |
| Games on GameFAQs but no guides | Returns found/no-guides bucket | Working |

---

## Output buckets

- `✓ Found with guides` — matched a game and found at least one guide
- `~ Found, no guides` — matched the game page but /faqs has no guides yet
- `✗ Not found` — no candidate scored ≥ 0.6
- `! Errors` — network/parse failures
