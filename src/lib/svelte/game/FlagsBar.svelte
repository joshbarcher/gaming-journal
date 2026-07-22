<script lang="ts">
    import type { SteamGame, Flags, FlagKey } from '../../types.js'
    import { refreshAlertsBadge } from '../../js/sidebar.js'

    interface Props {
        appid:           number | string
        flags:           Flags
        game:            SteamGame | null
        localWishlisted: boolean
    }
    let { appid, flags = $bindable({}), game, localWishlisted = $bindable(false) }: Props = $props()

    const SVG = (paths: string) => `<svg class="game-flag-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`

    const FLAG_GROUPS = [
        [
            { key: 'software',  label: 'Software / Tool — excluded from play stats',   icon: SVG(`<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>`) },
        ],
        [
            { key: 'childLock', label: 'Child Lock — hidden from all views',            icon: SVG(`<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>`) },
            { key: 'filtered',  label: 'Filtered — hidden unless filter is lifted',     icon: SVG(`<path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><line x1="2" x2="22" y1="2" y2="22"/>`) },
            { key: 'alert',     label: 'Sale Alert — notify when on sale',              icon: SVG(`<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>`) },
        ],
        [
            { key: 'favorite',  label: 'Favorite',                                      icon: SVG(`<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>`) },
            { key: 'revisit',   label: 'Revisit — want to replay',                      icon: SVG(`<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>`) },
            { key: 'playlist',  label: 'Add to Play List — queue up on Playing',        icon: SVG(`<path d="M12 12H3"/><path d="M16 6H3"/><path d="M12 18H3"/><path d="m16 12 5 3-5 3v-6Z"/>`) },
        ],
        [
            { key: 'completed', label: 'Completed',                                     icon: SVG(`<path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/>`) },
            { key: 'dropped',   label: "Dropped — abandoned, won't return",             icon: SVG(`<circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/>`) },
            { key: 'inProgress',label: 'In Progress — paused mid-playthrough',          icon: SVG(`<circle cx="12" cy="12" r="10"/><line x1="10" x2="10" y1="15" y2="9"/><line x1="14" x2="14" y1="15" y2="9"/>`) },
            { key: 'backlog',   label: 'Backlog — owned, unstarted, intend to play',    icon: SVG(`<path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/>`) },
        ],
    ]

    const WL_STAR_FILL = `<svg class="game-flag-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`

    let isLibrary = $derived(game?.source === 'library' || game?.source === 'both')
    let isSteamWl = $derived(game?.wishlist?.steam === true)

    async function toggleFlag(key: string) {
        const fkey = key as FlagKey
        const prev = !!flags[fkey]
        flags = { ...flags, [fkey]: !prev }
        try {
            await fetch(`/api/flags/${appid}`, {
                method:  'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify({ flag: key, value: !prev }),
            })
            if (key === 'alert') refreshAlertsBadge()
        } catch {
            flags = { ...flags, [key]: prev }
        }
    }

    async function toggleWishlist() {
        const was = localWishlisted
        localWishlisted = !was
        try {
            const res = await fetch(`/api/local-wishlist/${appid}`, { method: was ? 'DELETE' : 'POST' })
            if (!res.ok) localWishlisted = was
        } catch {
            localWishlisted = was
        }
    }
</script>

<div class="game-flags-inner">
    {#each FLAG_GROUPS as group, gi}
        <div class="game-flags-group">
            {#each group as f}
                <button
                    class="game-flag game-flag--{f.key}"
                    class:game-flag--active={!!flags[f.key as FlagKey]}
                    title={f.label}
                    onclick={() => toggleFlag(f.key)}
                >
                    {@html f.icon}
                </button>
            {/each}
        </div>
        {#if gi < FLAG_GROUPS.length - 1}
            <div class="game-flags-divider"></div>
        {/if}
    {/each}

    {#if !isLibrary}
        <div class="game-flags-divider"></div>
        <div class="game-flags-group">
            {#if isSteamWl}
                <button class="game-flag game-wishlist-btn game-wishlist-btn--steam" disabled title="On Steam Wishlist">
                    {@html WL_STAR_FILL}
                </button>
            {:else}
                <button
                    class="game-flag game-wishlist-btn"
                    class:game-flag--active={localWishlisted}
                    title={localWishlisted ? 'Remove from Local Wishlist' : 'Add to Local Wishlist'}
                    onclick={toggleWishlist}
                >
                    {@html WL_STAR_FILL}
                </button>
            {/if}
        </div>
    {/if}
</div>
