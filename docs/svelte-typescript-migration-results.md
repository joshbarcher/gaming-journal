# TypeScript + Vitest Migration — Final Results

**Date completed:** 2026-06-12/13  
**Branch:** `svelte-migration`  
**Commit:** `f1d23f5 Added typescript + vitest.`

## Stack at completion

| Package | Version |
|---|---|
| Svelte | ^5.56.3 |
| SvelteKit | ^2.65.0 |
| TypeScript | ^6.0.3 |
| svelte-check | ^4.6.0 |
| Vitest | ^4.1.8 |
| @testing-library/svelte | ^5.3.1 |
| @testing-library/jest-dom | ^6.9.1 |
| @vitest/coverage-v8 | ^4.1.8 |
| tsx | ^4.22.4 |

## Final scores

- `npm run typecheck` → **0 errors** (433 files)
- `npm test` → **278/278 tests pass** (11 test files)
- a11y warnings → **suppressed globally** (solo personal app, not needed)

---

## Phase summary

### Phase 0 — Setup
- `tsx` installed as a dev dependency
- `tsconfig.json` created, extending `.svelte-kit/tsconfig.json` with `strict: true, allowJs: true, checkJs: false`
- `typecheck` script: `svelte-check --tsconfig ./tsconfig.json`

### Phase 1 — Shared types (`src/lib/types.ts`)
All domain interfaces extracted into one file. Key types:

- Page union: `GamePage | CounterPage | TaskPage | BarPage | StepPage | NotesPage`
- `SteamGame` (relay API shape — library/wishlist/discover, includes hltb/itad/store/media/flags)
- `AccountData`, `NowPlaying`, `JournalSession`, `SessionDay`
- `DiscoverItem`, `SearchResults`, `AlertResult`
- `CommunityReviews`, `RedditData`
- `Settings`, `Flags`, `LocalReview`, `Franchise`, `Wishlist`
- `Segment`, `Bar`, `Step`, `Task`, `Counter`

Service files use relative imports (`../../types.js` not `$lib/types.js`) so tests can resolve them without Vite alias resolution.

### Phase 2 — Server layer
Converted to `.ts`: `managed-file.ts` (generic `ManagedFile<T>`), `logger.ts`, all 10 service files, `hooks.server.ts`.

### Phase 3 — Client utilities
All 18 `src/lib/js/**/*.js` files converted to `.ts`, including `sidebar.svelte.ts` (Svelte 5 rune store file).

### Phase 4 — API routes
All 29 `src/routes/**/*.js` server files converted to `.ts`, including `+layout.ts`. Route handler params typed inline (`{ params: { id: string }; request: Request }`) — SvelteKit `RequestEvent` not always imported.

### Phase 5 — Svelte components tagged
All 68 `.svelte` files given `<script lang="ts">` + `// @ts-nocheck` to opt in to TypeScript parsing without breaking anything.

### Phase 6 — Remove `@ts-nocheck`
All 68 `// @ts-nocheck` suppressions removed. Required fixing real type errors throughout. Used `any` pragmatically for API response shapes as a first pass.

### Phase 7 — Full type audit (any elimination)
- Replaced all `$state<any>` with proper typed state across all views
- Typed all Svelte component props using `$props()`
- Key fixes needed:
  - `$state` narrowing: Svelte 5 `$state` values can't be narrowed in-place; capture to local `const` before guard checks
  - `++` on cast expression is a TS error; use `x = (x as number) + 1`
  - `filter(Boolean)` on union arrays needs a type predicate
  - `FlagKey` indexing: had to type it explicitly to index `Flags`
  - `keyof LoadedPrefs` for preferences casts
- Remaining legitimate `any`:
  - `PlayerChart.svelte` — Chart.js loaded from CDN
  - `GamePage.svelte` — worker messaging (untyped worker protocol)
  - `PageEditor.svelte` — DOM `Node` traversal
  - `Home.svelte` — `unwrapLibrary(json: any)` at fetch boundary

---

## Vitest migration

### Why Vitest
Previously used `node --test` with a custom TAP parser in `testRunner.js`. Switched to Vitest because it's Vite-native, has first-class TypeScript support, and works properly with Svelte 5.

### vite.config.js test configuration

```js
const isTest = !!process.env.VITEST

return {
    plugins: [isTest ? svelte() : sveltekit()],   // standalone svelte() in test mode
    resolve:  isTest ? { conditions: ['browser'] } : undefined,
    test: {
        environment: 'jsdom',
        setupFiles:  ['src/tests/setup.ts'],
        include:     ['src/**/*.test.{js,ts}'],
        exclude:     ['src/tests/e2e/**', 'node_modules/**'],
        coverage: {
            provider: 'v8',
            include:  ['src/lib/**'],
            exclude:  ['src/lib/**/*.svelte', 'src/tests/**'],
        },
    },
}
```

**Critical: two things required for Svelte component tests in jsdom:**

1. **`svelte()` standalone plugin** (not `sveltekit()`) in test mode — `sveltekit()` sets up virtual modules that don't exist in a test environment.
2. **`resolve.conditions: ['browser']`** — Svelte 5 ships both a server build (`index-server.js`) and a browser build (`index-client.js`). Node resolves the server build by default, which calls `mount()` and immediately throws `lifecycle_function_unavailable: mount(...) is not available on the server`. Adding the `browser` export condition makes Svelte and all other packages with browser-specific builds resolve correctly.

### src/tests/setup.ts

```ts
import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/svelte'
import { afterEach } from 'vitest'

afterEach(() => cleanup())
```

**Critical: explicit `cleanup()` registration.** `@testing-library/svelte` does not auto-register cleanup in all environments. Without this, rendered components accumulate in `document.body` across tests. Subsequent `getByText('3')` calls find the value in every prior render and throw "Found multiple elements" even though each test renders only one component. Must be in `setupFiles` so it applies globally.

### testRunner.js rewrite

The in-app test runner (used by the journal's settings page to run tests from the UI) was rewritten from a TAP parser to a Vitest JSON reporter consumer:

```js
spawn(process.execPath, [
    'node_modules/.bin/vitest', 'run',
    '--reporter=json', `--outputFile=${resultFile}`,
    '--coverage', '--coverage.reporter=json-summary',
], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] })
```

Parses `vitest-results-*.json` (Vitest JSON format) and `coverage/coverage-summary.json` (v8 json-summary format) into the same shape the UI already expected.

### API migration — node:test → Vitest

| node:test | Vitest |
|---|---|
| `assert.strictEqual(a, b)` | `expect(a).toBe(b)` |
| `assert.deepStrictEqual(a, b)` | `expect(a).toEqual(b)` |
| `assert.throws(fn, /re/)` | `expect(() => fn()).toThrow(/re/)` |
| `assert.rejects(() => fn())` | `await expect(fn()).rejects.toThrow()` |
| `assert.doesNotReject(() => fn())` | `await expect(fn()).resolves.not.toThrow()` |
| `assert.ok(x)` | `expect(x).toBeTruthy()` |
| `assert.ok(x !== null)` | `expect(x).not.toBeNull()` |
| `assert.notEqual(a, b)` | `expect(a).not.toBe(b)` |

### Component tests

Two Svelte component test files added under `src/tests/components/`:

- **`Counter.test.ts`** (10 tests) — renders title, current/target values, percentage, 0%, increment/decrement, floor at 0, subtitle, delete button. Mocks `api.js`, `dialog.js`, `sidebar.js`, `router.js` via `vi.mock()`.
- **`Settings.test.ts`** (7 tests) — loading state, all settings sections render after fetch resolves, error state. Mocks `fetch` via `vi.stubGlobal()`.

### a11y warnings

Suppressed globally in `svelte.config.js` — solo personal app, not needed:

```js
onwarn: (warning, handler) => {
    if (warning.code.startsWith('a11y')) return
    handler(warning)
},
```

---

## Test files

| File | Subject | Tests |
|---|---|---|
| `utils.test.ts` | `escapeHtml`, `progressPercent`, `isSuperComplete`, `groupPagesByType` | 14 |
| `progressHelpers.test.ts` | `barProgressPercent`, `percentToColor`, `globalSegments`, `pagePct`, `segmentColor`, `stateLabel`, `heatmapRows` | 47 |
| `calendar.test.ts` | `_localDateStr`, `_buildDayMap`, `_splitAtMidnight`, `buildReleaseMap`, `buildCell`, `buildMonth` | 49 |
| `pageHelpers.test.ts` | `parseListItems`, `applyIndent`, `renderListItems` | 22 |
| `logger.test.ts` | `_formatStderrChunk`, `Logger`, `StreamLogger` | 31 |
| `managedFile.test.ts` | `ManagedFile` read/write/checkpoint/audit | 28 |
| `server.test.ts` | `_formatUptime`, GET `/health` endpoint | 10 |
| `journalService.test.ts` | `JournalService` CRUD + checkpoint | 47 |
| `localWishlist.test.ts` | `localWishlistService` add/remove/dedup | 13 |
| `components/Counter.test.ts` | Counter Svelte component | 10 |
| `components/Settings.test.ts` | Settings Svelte component | 7 |
| **Total** | | **278** |
