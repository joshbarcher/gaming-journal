import { router } from 'expo-router'

import { queryClient } from '@/api/queryClient'
import { getDownloadedGuides } from '@/api/journal'
import { getLocalWishlistEntry, setGameFlag, setLocalWishlisted } from '@/api/gamePage'
import { openLongPressMenu, type ContextMenuItem } from '@/components/shared/LongPressMenu'
import type { FlagKey, FlagsStore, GameFlags } from 'gaming-journal-contracts/flags'

// Native port of the web app's per-game-card right-click menu (src/lib/js/views/game-card-menu.ts,
// wired globally in +layout.svelte). Touch has no right-click, so this opens the shared drill-down
// LongPressMenu (the same action-sheet mechanism PostCard uses) from a card's onLongPress.
//
// Toggle semantics mirror FlagsBar.svelte / FlagsBar.tsx exactly: an optimistic write followed by a
// rollback only on a network throw (setGameFlag never inspects res.ok — ported faithfully, not
// "fixed"). The optimistic write patches the shared ['flags'] query cache in place so every list
// reading it (library/backlog/favorites/sidebar counts/…) reflects the change instantly; ['flags']
// is then invalidated to reconcile against the authoritative server value (the delta, not a full
// reload). Wishlist lives in local-wishlist, not the flags store — its current state is fetched
// lazily when the "Lists & alerts" submenu opens, matching the web's lazy loadCardState().
//
// The browser-only variants of the web menu (Steam store page, ITAD external deals, the hash-anchor
// "Game info section" sub-links, and every "open in new tab" navigation) are intentionally dropped:
// native has no tabs and no external browser surface here. The in-app navigations (game / journal /
// community / guides) are kept.

// Grouped to match FlagsBar's own grouping so the two surfaces stay conceptually aligned.
const STATUS_FLAGS: { key: FlagKey; label: string }[] = [
    { key: 'backlog',    label: 'Backlog' },
    { key: 'inProgress', label: 'In Progress' },
    { key: 'completed',  label: 'Completed' },
    { key: 'dropped',    label: 'Dropped' },
    { key: 'revisit',    label: 'Revisit' },
]
const VISIBILITY_FLAGS: { key: FlagKey; label: string }[] = [
    { key: 'childLock', label: 'Hide (Child Lock)' },
    { key: 'filtered',  label: 'Filter' },
    { key: 'software',  label: 'Software / Tool' },
]

// Mirrors GuidesCard.tsx's SOURCE_LABELS plus thegamer (present in the web menu's own map).
const GUIDE_SOURCE_LABELS: Record<string, string> = {
    gamefaqs: 'GameFAQs', ign: 'IGN', steam: 'Steam', game8: 'Game8',
    gamerguides: 'Gamer Guides', fandom: 'Fandom', neoseeker: 'Neoseeker', thegamer: 'TheGamer',
}

// A leading check reflects the flag's current on/off state — the touch equivalent of the web menu's
// `checked` affordance (which renders a checkmark next to an active item and nothing next to an
// inactive one).
const mark = (on: boolean | undefined): string => (on ? '✓ ' : '')

function patchFlagCache(appid: number, flag: FlagKey, value: boolean): void {
    queryClient.setQueryData<FlagsStore>(['flags'], (old) => {
        const store = old ?? {}
        const cur = store[appid] ?? {}
        return { ...store, [appid]: { ...cur, [flag]: value } }
    })
}

async function toggleFlag(appid: number, flag: FlagKey, current: boolean): Promise<void> {
    const prev = queryClient.getQueryData<FlagsStore>(['flags'])
    const next = !current
    patchFlagCache(appid, flag, next) // optimistic: instant update for every list on the ['flags'] cache
    try {
        await setGameFlag(appid, flag, next)
    } catch {
        queryClient.setQueryData(['flags'], prev) // rollback only on a network throw (FlagsBar semantics)
        return
    }
    void queryClient.invalidateQueries({ queryKey: ['flags'] })
    if (flag === 'alert') void queryClient.invalidateQueries({ queryKey: ['alerts'] }) // web: refreshAlertsBadge()
}

async function toggleWishlist(appid: number, wasWishlisted: boolean): Promise<void> {
    const ok = await setLocalWishlisted(appid, !wasWishlisted).catch(() => false)
    if (ok) void queryClient.invalidateQueries({ queryKey: ['wishlist'] })
}

function flagItem(appid: number, def: { key: FlagKey; label: string }, flags: GameFlags | undefined): ContextMenuItem {
    const on = !!flags?.[def.key]
    return { label: `${mark(on)}${def.label}`, action: () => { void toggleFlag(appid, def.key, on) } }
}

async function loadGuidesSubmenu(appid: number): Promise<ContextMenuItem[]> {
    const guides = await getDownloadedGuides(appid)
    const sorted = [...guides].sort((a, b) => {
        const la = a.lastUsedAt ? new Date(a.lastUsedAt).getTime() : 0
        const lb = b.lastUsedAt ? new Date(b.lastUsedAt).getTime() : 0
        if (la !== lb) return lb - la
        return new Date(b.parsedAt ?? 0).getTime() - new Date(a.parsedAt ?? 0).getTime()
    })
    return sorted.map(g => ({
        label:  `${GUIDE_SOURCE_LABELS[g.source] ?? g.source} — ${g.title}`,
        action: () => router.push(`/journal/${appid}/guides/${g.source}/${g.guideId}` as never),
    }))
}

/**
 * Open the per-game-card action menu (long-press equivalent of the web's card context menu).
 *
 * @param appid the game's Steam appid
 * @param flags the game's current flags (e.g. `flagsQuery.data?.[appid]` from the ['flags'] query);
 *              drives the toggle checkmarks. `undefined` is treated as all-off.
 */
export function openGameCardMenu(appid: number, flags: GameFlags | undefined, anchor?: { x: number; y: number } | null): void {
    openLongPressMenu([
        { label: 'Play status', submenu: STATUS_FLAGS.map(def => flagItem(appid, def, flags)) },
        {
            label: 'Lists & alerts',
            // Wishlist state isn't in the flags store — fetch it lazily on open (matches the web's
            // per-open loadCardState); the menu shows a "Loading…" row while this resolves.
            submenu: async (): Promise<ContextMenuItem[]> => {
                const wl = await getLocalWishlistEntry(appid).catch(() => ({ wishlisted: false }))
                return [
                    flagItem(appid, { key: 'favorite', label: 'Favorite' }, flags),
                    flagItem(appid, { key: 'playlist', label: 'Play List' }, flags),
                    { label: `${mark(wl.wishlisted)}Wishlist`, action: () => { void toggleWishlist(appid, wl.wishlisted) } },
                    flagItem(appid, { key: 'alert', label: 'Sale Alert' }, flags),
                ]
            },
        },
        { label: 'Visibility', submenu: VISIBILITY_FLAGS.map(def => flagItem(appid, def, flags)) },
        'separator',
        { label: 'Game info', action: () => router.push(`/game/${appid}` as never) },
        { label: 'Journal', action: () => router.push(`/journal/${appid}` as never) },
        { label: 'Community', action: () => router.push(`/community/${appid}` as never) },
        { label: 'Game guides', submenu: () => loadGuidesSubmenu(appid) },
    ], anchor)
}
