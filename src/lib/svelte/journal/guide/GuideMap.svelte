<script lang="ts">
    // Offline viewer for a downloaded IGN interactive map.
    //
    // Everything it renders comes off the NAS through /relay/guides-map — the
    // tile pyramid, the marker sprite and map.json. No request leaves the box,
    // which is the whole point: the map has to work with the guide, offline.
    //
    // Markers are painted by a canvas layer (lib/js/ign-map-markers) rather than
    // Leaflet Markers; 11k DOM nodes is not a panning experience.
    import { onMount, onDestroy } from 'svelte'
    import L from 'leaflet'
    import 'leaflet/dist/leaflet.css'
    import { createMarkerLayer, loadSprite, spriteScaleFor, type MapIcon } from '$lib/js/ign-map-markers'
    import { jobStore } from '$lib/guide-jobs.svelte.js'

    let { appid, source = 'ign', guideId, mapSlug = null, collapsed = false }: {
        appid: string
        source?: string
        guideId: string
        mapSlug?: string | null
        /** Driven by the guide viewer's shared TOC collapse, so both modes agree. */
        collapsed?: boolean
    } = $props()

    const base = $derived(`/relay/guides-map/${appid}/${source}/${encodeURIComponent(guideId)}/_maps`)

    // ── Discovery / download ─────────────────────────────────────────────────
    // The Map toggle is offered for every IGN guide, including ones with no map
    // downloaded yet — otherwise a map could never be discovered from the UI.
    let probing    = $state(false)
    let probed     = $state<any[] | null>(null)
    let probeError = $state<string | null>(null)
    let queued     = $state<Set<string>>(new Set())

    async function probeForMaps() {
        probing = true
        probeError = null
        try {
            const res = await fetch(`/relay/api/guides/${appid}/${source}/${encodeURIComponent(guideId)}/maps?probe=1`)
            const data = await res.json()
            probed = data.missing ?? data.available ?? []
            if (data.probeError) probeError = data.probeError
        } catch (err) {
            probeError = err instanceof Error ? err.message : String(err)
        } finally {
            probing = false
        }
    }

    async function downloadMap(m: { mapSlug: string }) {
        queued = new Set([...queued, m.mapSlug])
        const res = await fetch(`/relay/api/guides/${appid}/${source}/${encodeURIComponent(guideId)}/maps`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ mapSlug: m.mapSlug }),
        }).catch(() => null)
        // Seed the shared store so the banner flips to "downloading" immediately
        // rather than waiting for the next SSE push.
        if (res?.ok) jobStore.applyEvent(await res.json().catch(() => null))
        // A resumed download republishes tiles.json per level — start watching.
        startPolling()
    }

    // The queue runs one job per source, so a map job for this guide is the one
    // that matters here. Resuming an interrupted pyramid is the same call as
    // starting one: the fetcher skips whatever is already on disk.
    const mapJob = $derived(
        jobStore.jobs.find(j =>
            (j.status === 'pending' || j.status === 'running') &&
            j.mode === 'map' &&
            j.steamId === String(appid) &&
            j.guideId === guideId
        ) ?? null
    )

    // Percent of the target pyramid on disk. `tilesExpected` is exact once the
    // base level is known (each level quadruples), so this isn't a guess.
    const tilePct = $derived.by(() => {
        const st = tileStatus
        if (!st?.tilesExpected) return null
        return Math.min(100, Math.round(((st.tilesDone ?? st.count) / st.tilesExpected) * 100))
    })

    let index      = $state<any[]>([])
    // Chosen in loadIndex() from the `mapSlug` prop rather than initialised from
    // it here: the prop is only a starting preference, and reading it at
    // declaration would capture one value and never track later changes.
    let activeSlug = $state<string | null>(null)
    let mapData    = $state<any>(null)
    let loading    = $state(true)
    let error      = $state<string | null>(null)

    // Tile availability, published by the fetcher after every completed zoom level.
    // A separate few-hundred-byte file rather than map.json (2.4mb, nearly all
    // markers) precisely so it can be polled while a download runs.
    let tileStatus = $state<any>(null)
    let statusTimer: ReturnType<typeof setInterval> | null = null

    const STATUS_POLL_MS = 5000

    function stopPolling() {
        if (statusTimer) { clearInterval(statusTimer); statusTimer = null }
    }

    /** Raise the viewer's zoom ceiling to match what's now on disk. */
    function applyDepth(status: any) {
        if (!leaflet || !mapData) return
        const max = Math.min(mapData.view.maxZoom, status.maxZoom)
        if (max < mapData.view.minZoom) return          // nothing usable yet
        if (tileLayer) tileLayer.options.maxZoom = max
        leaflet.setMaxZoom(max)
        // Bounds only exist once the base level lands; applying them late is fine
        // and stops the user panning into grey before then.
        if (status.bounds && !boundsApplied) {
            leaflet.setMaxBounds(L.latLngBounds(status.bounds[0], status.bounds[1]))
            boundsApplied = true
        }
    }

    let boundsApplied = false

    // The rail animates its width over 220ms (matching the TOC's grid transition).
    // Leaflet caches container size, so without a nudge afterwards the tile grid
    // keeps the pre-collapse width and leaves a blank strip.
    $effect(() => {
        collapsed
        if (!leaflet) return
        const t = setTimeout(() => leaflet?.invalidateSize(), 260)
        return () => clearTimeout(t)
    })

    async function pollStatus() {
        if (!activeSlug) return
        try {
            const res = await fetch(`${base}/${activeSlug}/tiles.json`, { cache: 'no-store' })
            if (!res.ok) return
            const st = await res.json()
            const prevMax = tileStatus?.maxZoom ?? -Infinity
            tileStatus = st
            if (st.maxZoom > prevMax) applyDepth(st)
            if (st.complete) stopPolling()
        } catch { /* transient — the next tick retries */ }
    }

    function startPolling() {
        stopPolling()
        // Only while a pyramid is still filling in. A finished map polls nothing.
        if (tileStatus?.complete) return
        statusTimer = setInterval(pollStatus, STATUS_POLL_MS)
    }

    let enabled  = $state<Set<string>>(new Set())
    let found    = $state<Set<string>>(new Set())
    let query    = $state('')
    let selected = $state<any>(null)
    let collapsedGroups = $state<Set<string>>(new Set())

    // bind:this targets must be $state in Svelte 5, or assignments to them don't
    // trigger the effects that read them.
    let mapEl = $state<HTMLDivElement | undefined>(undefined)
    let leaflet: L.Map | null = null
    let markerLayer: any = null
    let tileLayer: L.TileLayer | null = null

    // ── Type tree ────────────────────────────────────────────────────────────
    const typeBySlug = $derived(new Map<string, any>((mapData?.types ?? []).map((t: any) => [t.typeSlug, t])))

    // IGN groups 43 leaf layers under 8 parents. A leaf whose parent is missing
    // is surfaced at the top level rather than dropped, so no layer is unreachable.
    const groups = $derived.by(() => {
        const types = mapData?.types ?? []
        const parents = types.filter((t: any) => !t.parentTypeSlug)
        const out = parents.map((p: any) => ({
            ...p,
            kids: types.filter((t: any) => t.parentTypeSlug === p.typeSlug && t.markerCount > 0),
        })).filter((g: any) => g.kids.length)
        const orphans = types.filter((t: any) =>
            t.markerCount > 0 && t.parentTypeSlug && !types.some((p: any) => p.typeSlug === t.parentTypeSlug))
        if (orphans.length) out.push({ typeSlug: '_other', typeName: 'Other', kids: orphans })
        return out
    })

    const visibleMarkers = $derived.by(() => {
        if (!mapData) return []
        const q = query.trim().toLowerCase()
        return mapData.markers.filter((m: any) =>
            enabled.has(m.typeSlug) && (!q || m.name.toLowerCase().includes(q)))
    })

    const foundKey = $derived(`ign-map-found:${appid}:${guideId}:${activeSlug}`)

    // ── Filter persistence ───────────────────────────────────────────────────
    // Layer filters are saved server-side per map, so a map reopens exactly as it
    // was left — on any machine, unlike the localStorage-backed found markers.
    const prefsUrl = $derived(
        `/relay/api/guides/${appid}/${source}/${encodeURIComponent(guideId)}/maps/${activeSlug}/prefs`
    )

    // Guards a first-load race: the map applies IGN's defaults before prefs arrive,
    // and without this the resulting state change would immediately save those
    // defaults back over what the user had stored.
    let prefsLoaded = $state(false)
    let saveTimer: ReturnType<typeof setTimeout> | null = null

    /**
     * Persist the current filter state, debounced.
     *
     * Called from the toggle handlers rather than an $effect on `enabled`: an effect
     * would also fire for the programmatic default-application during load, which is
     * exactly the write we must not make.
     */
    // The write the debounce is currently holding, so it can be flushed early.
    let pendingSave: { url: string, body: string } | null = null

    function flushPrefs() {
        if (saveTimer) { clearTimeout(saveTimer); saveTimer = null }
        if (!pendingSave) return
        const { url, body } = pendingSave
        pendingSave = null
        fetch(url, { method: 'PUT', headers: { 'content-type': 'application/json' }, body })
            .catch(() => { /* best-effort; the map stays usable either way */ })
    }

    function savePrefs() {
        if (!prefsLoaded || !activeSlug) return
        // URL and body are captured NOW, not at fire time: switching maps inside the
        // debounce window would otherwise PUT this map's filters to the next map's key.
        pendingSave = {
            url:  prefsUrl,
            body: JSON.stringify({ enabled: [...enabled], collapsedGroups: [...collapsedGroups] }),
        }
        if (saveTimer) clearTimeout(saveTimer)
        // "All"/"None" and rapid checkbox runs would otherwise be one PUT per click.
        saveTimer = setTimeout(flushPrefs, 600)
    }

    /**
     * Apply saved filters over the map's own defaults.
     *
     * Saved slugs are intersected with the types this map currently has: a re-download
     * can add or drop layers, and a stale slug would otherwise sit in `enabled`
     * forever, or worse, leave the user with a set referencing nothing.
     *
     * `enabled: null` means never-saved and falls through to IGN's defaults, while an
     * empty array is a deliberate "everything off" and is honoured.
     */
    function applyPrefs(prefs: any, data: any) {
        const known = new Set<string>(data.types.map((t: any) => t.typeSlug))
        if (Array.isArray(prefs?.enabled)) {
            enabled = new Set<string>(prefs.enabled.filter((s: string) => known.has(s)))
        }
        if (Array.isArray(prefs?.collapsedGroups)) {
            collapsedGroups = new Set<string>(prefs.collapsedGroups.filter((s: string) => known.has(s)))
        }
    }

    // ── Load ─────────────────────────────────────────────────────────────────
    async function loadIndex() {
        const res = await fetch(`${base}/_index.json`)
        // A 404 is the normal "nothing downloaded yet" state, not a failure —
        // it drops through to the discovery panel rather than an error.
        index = res.ok ? await res.json() : []
        if (!index.length) return
        // Honour the requested map when it was actually downloaded; otherwise
        // fall back to the first one rather than rendering nothing.
        activeSlug = index.some(m => m.mapSlug === mapSlug) ? mapSlug! : index[0].mapSlug
    }

    async function loadMap(slug: string) {
        loading = true
        error = null
        try {
            // map.json is published before the tiles start arriving, so the map —
            // markers, filters, legend — opens while the pyramid is still filling.
            // tiles.json is the live authority on how deep it currently goes.
            const [res, statusRes] = await Promise.all([
                fetch(`${base}/${slug}/map.json`),
                fetch(`${base}/${slug}/tiles.json`, { cache: 'no-store' }).catch(() => null),
            ])
            if (!res.ok) throw new Error(`map.json missing for "${slug}"`)
            const data = await res.json()
            mapData = data
            tileStatus = statusRes?.ok ? await statusRes.json() : data.tiles
            boundsApplied = false

            // IGN's own first-load selection is the floor; saved prefs override it below.
            enabled = new Set(data.types.filter((t: any) => t.defaultOn && t.markerCount > 0).map((t: any) => t.typeSlug))
            prefsLoaded = false
            collapsedGroups = new Set()
            try {
                const p = await fetch(prefsUrl).then(r => r.ok ? r.json() : null)
                applyPrefs(p, data)
            } catch { /* unreachable prefs must not block the map — defaults stand */ }
            prefsLoaded = true
            try {
                found = new Set(JSON.parse(localStorage.getItem(foundKey) ?? '[]'))
            } catch { found = new Set() }
            selected = null
            await renderMap()
        } catch (err) {
            error = err instanceof Error ? err.message : String(err)
        } finally {
            loading = false
        }
    }

    // ── Leaflet ──────────────────────────────────────────────────────────────
    async function renderMap() {
        if (!mapEl || !mapData) return
        leaflet?.remove()
        leaflet = null

        const { view } = mapData
        const tiles = tileStatus ?? mapData.tiles
        // The pyramid can stop short of the map's own maxZoom (a --max-zoom cap,
        // or a download still in flight), so clamp to what is actually on disk —
        // zooming past it would just paint blank tiles. pollStatus() raises this
        // as deeper levels land.
        const maxZoom = Math.max(view.minZoom, Math.min(view.maxZoom, tiles.maxZoom ?? view.maxZoom))

        leaflet = L.map(mapEl, {
            crs: L.CRS.EPSG3857,
            minZoom: view.minZoom,
            maxZoom,
            zoomControl: true,
            attributionControl: false,
            // Game maps are a tiny patch of the world; without this you can drag
            // off the edge into grey and lose the map.
            maxBoundsViscosity: 1,
        })

        if (tiles.bounds) {
            leaflet.setMaxBounds(L.latLngBounds(tiles.bounds[0], tiles.bounds[1]))
            boundsApplied = true
        }
        leaflet.setView([view.initialLat, view.initialLng], Math.min(view.initialZoom, maxZoom))

        if (view.backgroundColor) mapEl.style.background = view.backgroundColor

        const tileTemplate = `${base}/${activeSlug}/${tiles.template}`
        tileLayer = L.tileLayer(tileTemplate, {
            minZoom: view.minZoom,
            maxZoom,
            noWrap: true,
            // Keep showing the parent tile while a child loads instead of flashing
            // empty — the NAS is fast but not instant over SMB.
            keepBuffer: 4,
        }).addTo(leaflet)

        // Watch for deeper levels only while the pyramid is still filling.
        startPolling()

        const sprite = await loadSprite(`${base}/${activeSlug}/${mapData.sprite.file}`)
        const icons: MapIcon[] = mapData.types.flatMap((t: any) => [t.icon, t.legend].filter(Boolean))
        const spriteScale = spriteScaleFor(sprite, icons)

        markerLayer = createMarkerLayer(visibleMarkers, {
            sprite,
            spriteScale,
            iconFor: (slug: string) => typeBySlug.get(slug)?.icon ?? null,
            isFound: (id: string) => found.has(id),
            onSelect: (m: any) => { selected = m; markerLayer?.setSelected(m?.id ?? null) },
        })
        markerLayer.addTo(leaflet)
    }

    // Repaint whenever the filtered set changes — cheap, it's one canvas pass.
    $effect(() => {
        const markers = visibleMarkers
        if (markerLayer) markerLayer.setMarkers(markers)
    })

    $effect(() => {
        if (activeSlug) loadMap(activeSlug)
    })

    onMount(async () => {
        try {
            await loadIndex()
        } catch (err) {
            error = err instanceof Error ? err.message : String(err)
        } finally {
            // loadMap() owns `loading` once a map is selected; with none there is
            // nothing further to wait for.
            if (!activeSlug) loading = false
        }
    })

    onDestroy(() => {
        document.removeEventListener('fullscreenchange', onFullscreenChange)
        // Toggling a layer then leaving inside the debounce window would otherwise
        // drop the write — flush it on the way out.
        flushPrefs()
        stopPolling()
        leaflet?.remove()
        leaflet = null
    })

    // ── Fullscreen ───────────────────────────────────────────────────────────
    let isFullscreen = $state(false)
    let rootEl = $state<HTMLDivElement | undefined>(undefined)

    function onFullscreenChange() {
        isFullscreen = document.fullscreenElement === rootEl
        // Leaflet caches its container size; without this the tile grid keeps the
        // pre-fullscreen dimensions and leaves the new area blank.
        setTimeout(() => leaflet?.invalidateSize(), 120)
    }

    function toggleFullscreen() {
        if (document.fullscreenElement) document.exitFullscreen().catch(() => {})
        else rootEl?.requestFullscreen?.().catch(() => {})
    }

    onMount(() => {
        document.addEventListener('fullscreenchange', onFullscreenChange)
    })

    // ── Interactions ─────────────────────────────────────────────────────────
    function toggleType(slug: string) {
        const next = new Set(enabled)
        next.has(slug) ? next.delete(slug) : next.add(slug)
        enabled = next
        savePrefs()
    }

    function toggleGroup(group: any) {
        const allOn = group.kids.every((k: any) => enabled.has(k.typeSlug))
        const next = new Set(enabled)
        for (const k of group.kids) allOn ? next.delete(k.typeSlug) : next.add(k.typeSlug)
        enabled = next
        savePrefs()
    }

    function toggleCollapse(slug: string) {
        const next = new Set(collapsedGroups)
        next.has(slug) ? next.delete(slug) : next.add(slug)
        collapsedGroups = next
        savePrefs()
    }

    function setAll(on: boolean) {
        enabled = on
            ? new Set(mapData.types.filter((t: any) => t.markerCount > 0).map((t: any) => t.typeSlug))
            : new Set()
        savePrefs()
    }

    function toggleFound(id: string) {
        const next = new Set(found)
        next.has(id) ? next.delete(id) : next.add(id)
        found = next
        localStorage.setItem(foundKey, JSON.stringify([...next]))
        markerLayer?.setSelected(selected?.id ?? null)   // forces a repaint
    }

    function flyTo(m: any) {
        selected = m
        markerLayer?.setSelected(m.id)
        leaflet?.setView([m.lat, m.lng], Math.max(leaflet.getZoom(), mapData.view.initialZoom))
    }

    /** Inline style windowing the sprite sheet for a legend swatch. */
    function swatch(t: any): string {
        const ic = t.legend ?? t.icon
        if (!ic) return 'display:none'
        // Background-size is expressed in icon-coordinate units so the same
        // offsets that drive the canvas work here; the browser scales the sheet.
        return [
            `width:${ic.width}px`,
            `height:${ic.height}px`,
            `background-image:url(${base}/${activeSlug}/${mapData.sprite.file})`,
            `background-position:-${ic.offsetX}px -${ic.offsetY}px`,
            `background-size:${spriteSheetW}px ${spriteSheetH}px`,
        ].join(';')
    }

    // Sheet size in icon-coordinate units — derived from the declared extent so
    // the CSS swatches line up with the canvas regardless of the sheet's @Nx scale.
    const spriteSheetW = $derived.by(() => {
        const icons = (mapData?.types ?? []).flatMap((t: any) => [t.icon, t.legend].filter(Boolean))
        return icons.reduce((mx: number, ic: any) => Math.max(mx, ic.offsetX + ic.width), 0)
    })
    const spriteSheetH = $derived.by(() => {
        const icons = (mapData?.types ?? []).flatMap((t: any) => [t.icon, t.legend].filter(Boolean))
        return icons.reduce((mx: number, ic: any) => Math.max(mx, ic.offsetY + ic.height), 0)
    })

    const searchHits = $derived.by(() => {
        const q = query.trim().toLowerCase()
        if (q.length < 2 || !mapData) return []
        return mapData.markers
            .filter((m: any) => m.name.toLowerCase().includes(q))
            .slice(0, 40)
    })
</script>

<div class="gm-root" class:gm-root--fs={isFullscreen} class:gm-root--collapsed={collapsed} bind:this={rootEl}>
    {#if !loading && !index.length}
        <!-- No map on disk. Guides downloaded before maps were folded into the
             download pipeline land here, so the map can be fetched without
             re-downloading the whole guide. -->
        <div class="gm-discover">
            <h3>No interactive map downloaded</h3>
            {#if probed === null}
                <p>Guides downloaded before map support was added don’t have one yet.</p>
                <button type="button" class="gm-btn" onclick={probeForMaps} disabled={probing}>
                    {probing ? 'Checking IGN…' : 'Check IGN for a map'}
                </button>
            {:else if probed.length}
                <p>{probed.length === 1 ? '1 map available' : `${probed.length} maps available`} for this guide:</p>
                <ul class="gm-avail">
                    {#each probed as m}
                        <li>
                            <span>{m.mapName}</span>
                            <button type="button" class="gm-btn" onclick={() => downloadMap(m)}
                                    disabled={queued.has(m.mapSlug)}>
                                {queued.has(m.mapSlug) ? 'Queued' : 'Download'}
                            </button>
                        </li>
                    {/each}
                </ul>
                <p class="gm-hint">Downloads run in the queue — watch progress on the Downloads page. Reload this page when it finishes.</p>
            {:else}
                <p>IGN has no interactive map for this game.</p>
            {/if}
            {#if probeError}<p class="gm-hint gm-hint--err">{probeError}</p>{/if}
        </div>
    {:else}
    <!-- The rail varies with the collapse state; the map surface below it does not,
         so only the aside is branched. -->
    {#if collapsed}
        <!-- Collapsed rail, mirroring the TOC's collapsed view: the layers that are
             currently on, as sprite swatches. Clicking one switches it off, so the
             rail stays useful rather than being decoration. -->
        <aside class="gm-side gm-side--collapsed">
            {#each (mapData?.types ?? []).filter((t: any) => t.markerCount > 0 && enabled.has(t.typeSlug)) as t}
                <button type="button" class="gm-rail-btn" title="{t.typeName} ({t.markerCount}) — click to hide"
                        onclick={() => toggleType(t.typeSlug)}>
                    <span class="gm-sw" style={swatch(t)}></span>
                </button>
            {/each}
        </aside>
    {:else}
    <aside class="gm-side">
        {#if index.length > 1}
            <select class="gm-mapsel" bind:value={activeSlug}>
                {#each index as m}
                    <option value={m.mapSlug}>{m.mapName}</option>
                {/each}
            </select>
        {/if}

        <input class="gm-search" type="search" placeholder="Search markers…" bind:value={query} />

        {#if searchHits.length}
            <ul class="gm-hits">
                {#each searchHits as m}
                    <li>
                        <button type="button" onclick={() => flyTo(m)}>
                            <span class="gm-sw" style={swatch(typeBySlug.get(m.typeSlug) ?? {})}></span>
                            <span class="gm-hit-name">{m.name || typeBySlug.get(m.typeSlug)?.typeName}</span>
                        </button>
                    </li>
                {/each}
            </ul>
        {/if}

        <div class="gm-bulk">
            <button type="button" onclick={() => setAll(true)}>All</button>
            <button type="button" onclick={() => setAll(false)}>None</button>
            <span class="gm-count">{visibleMarkers.length.toLocaleString()} shown</span>
        </div>

        <div class="gm-groups">
            {#each groups as g}
                {@const allOn = g.kids.every((k: any) => enabled.has(k.typeSlug))}
                <div class="gm-group">
                    <div class="gm-group-head">
                        <button type="button" class="gm-caret" onclick={() => toggleCollapse(g.typeSlug)}>
                            {collapsedGroups.has(g.typeSlug) ? '▸' : '▾'}
                        </button>
                        <label>
                            <input type="checkbox" checked={allOn} onchange={() => toggleGroup(g)} />
                            <span>{g.typeName}</span>
                        </label>
                    </div>
                    {#if !collapsedGroups.has(g.typeSlug)}
                        <ul>
                            {#each g.kids as t}
                                <li>
                                    <label>
                                        <input type="checkbox" checked={enabled.has(t.typeSlug)}
                                               onchange={() => toggleType(t.typeSlug)} />
                                        <span class="gm-sw" style={swatch(t)}></span>
                                        <span class="gm-tname">{t.typeName}</span>
                                        <span class="gm-tcount">{t.markerCount}</span>
                                    </label>
                                </li>
                            {/each}
                        </ul>
                    {/if}
                </div>
            {/each}
        </div>
    </aside>
    {/if}

    <div class="gm-mapwrap">
        <button type="button" class="gm-fs" onclick={toggleFullscreen}
                title={isFullscreen ? 'Exit fullscreen (Esc)' : 'Fullscreen'}
                aria-label={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}>
            {#if isFullscreen}
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M9 3v6H3M15 3v6h6M9 21v-6H3M15 21v-6h6" />
                </svg>
            {:else}
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M3 9V3h6M21 9V3h-6M3 15v6h6M21 15v6h-6" />
                </svg>
            {/if}
        </button>

        {#if error}
            <div class="gm-msg gm-err">
                <p>{error}</p>
                <p class="gm-hint">Download one with <code>fetch-map.js --url https://www.ign.com/maps/{guideId}</code></p>
            </div>
        {:else if loading}
            <div class="gm-msg">Loading map…</div>
        {/if}

        <div class="gm-map" bind:this={mapEl}></div>

        {#if selected}
            <div class="gm-popup">
                <button class="gm-popup-x" type="button" onclick={() => { selected = null; markerLayer?.setSelected(null) }}>×</button>
                <h4>{selected.name || typeBySlug.get(selected.typeSlug)?.typeName}</h4>
                <p class="gm-popup-type">{typeBySlug.get(selected.typeSlug)?.typeName}</p>
                <label class="gm-popup-found">
                    <input type="checkbox" checked={found.has(selected.id)} onchange={() => toggleFound(selected.id)} />
                    Mark as found
                </label>
            </div>
        {/if}

        <!-- Partial pyramid. The map is fully usable at the depth already on disk;
             this says how deep that is and offers to fetch the rest. Resuming is the
             same call as starting — the fetcher skips what it already has. -->
        {#if mapData && tileStatus && !tileStatus.complete}
            <div class="gm-partial">
                {#if tileStatus.maxZoom < mapData.view.minZoom}
                    <span>No tiles yet</span>
                {:else}
                    <span>Zoom z{tileStatus.minZoom}–{tileStatus.maxZoom} of {mapData.view.maxZoom} available</span>
                {/if}
                {#if mapJob}
                    <span class="gm-partial-prog">
                        downloading{tilePct != null ? ` ${tilePct}%` : ''}…
                    </span>
                    <div class="gm-partial-bar"><div style="width:{mapJob.progress.download}%"></div></div>
                {:else}
                    <button type="button" class="gm-btn gm-btn--sm"
                            onclick={() => downloadMap({ mapSlug: activeSlug! })}
                            disabled={queued.has(activeSlug ?? '')}>
                        {queued.has(activeSlug ?? '') ? 'Queued' : 'Download rest'}
                    </button>
                {/if}
            </div>
        {/if}
    </div>
    {/if}
</div>

<style>
    /* Mirrors .gv-body's grid so the map sits in the content column and its
       layer list lands in the same 300px column the TOC uses. Both modes then
       share one skeleton — content centred, secondary nav always on the right —
       instead of the map having its own left rail that shifts everything. */
    .gm-root {
        display: grid;
        grid-template-columns: 1fr 300px;
        height: 100%;
        min-height: 32rem;
        /* Same easing/duration as .gv-body so collapsing feels identical whether
           you're on the guide or the map. */
        transition: grid-template-columns 220ms cubic-bezier(0.4, 0, 0.2, 1);
    }

    /* 40px matches .gv-toc--collapsed .gv-body, so the gutter handle lands in the
       same place in both modes. */
    .gm-root--collapsed { grid-template-columns: 1fr 40px; }

    .gm-side--collapsed {
        display: flex; flex-direction: column; align-items: center; gap: 6px;
        padding: 12px 0 40px;
    }
    .gm-rail-btn {
        display: grid; place-content: center;
        width: 26px; height: 26px; padding: 0;
        background: none; border: 0; cursor: pointer; border-radius: 4px;
    }
    .gm-rail-btn:hover { background: rgba(255, 255, 255, 0.08); }
    /* The swatches are 33x44 sprite windows; scale them down to fit the rail
       without redefining every icon's geometry. */
    .gm-rail-btn .gm-sw { transform: scale(0.55); transform-origin: center; }

    /* Explicit placement rather than DOM order: the layer list is declared first
       so it reads before the canvas for keyboard and screen-reader users, while
       still painting on the right. */
    .gm-side {
        grid-column: 2; grid-row: 1;
        overflow-y: auto; scrollbar-width: none;
        padding: 16px 16px 40px;
        /* Same surface treatment as .gv-sidebar so the column doesn't change
           character when you flip between Guide and Map. */
        background: var(--clr-bg-raised);
        border-left: 1px solid var(--clr-border);
        font-size: .82rem;
    }
    .gm-side::-webkit-scrollbar { display: none; }

    .gm-mapsel, .gm-search {
        width: 100%; margin-bottom: .5rem; padding: .35rem .5rem;
        background: var(--clr-bg, #101015); color: inherit;
        border: 1px solid var(--clr-border); border-radius: .3rem;
    }

    .gm-hits { list-style: none; margin: 0 0 .5rem; padding: 0; max-height: 14rem; overflow-y: auto; }
    .gm-hits button {
        display: flex; align-items: center; gap: .4rem; width: 100%;
        background: none; border: 0; color: inherit; text-align: left;
        padding: .2rem .25rem; cursor: pointer; border-radius: .25rem;
    }
    .gm-hits button:hover { background: var(--hover, #23232c); }
    .gm-hit-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

    .gm-bulk { display: flex; align-items: center; gap: .35rem; margin-bottom: .5rem; }
    .gm-bulk button {
        padding: .2rem .5rem; background: var(--input-bg, #101015); color: inherit;
        border: 1px solid var(--border, #2a2a32); border-radius: .25rem; cursor: pointer;
    }
    .gm-count { margin-left: auto; opacity: .65; font-size: .75rem; }

    .gm-group { margin-bottom: .35rem; }
    .gm-group-head { display: flex; align-items: center; gap: .25rem; font-weight: 600; }
    .gm-caret { background: none; border: 0; color: inherit; cursor: pointer; padding: 0 .15rem; }
    .gm-group ul { list-style: none; margin: .15rem 0 .35rem 1.1rem; padding: 0; }
    .gm-group label { display: flex; align-items: center; gap: .35rem; cursor: pointer; padding: .1rem 0; }
    .gm-tname { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .gm-tcount { margin-left: auto; opacity: .5; font-size: .72rem; }

    /* Sprite window — same offsets the canvas layer draws with. */
    .gm-sw { display: inline-block; flex: 0 0 auto; background-repeat: no-repeat; }

    .gm-mapwrap { grid-column: 1; grid-row: 1; position: relative; min-width: 0; }
    .gm-map { position: absolute; inset: 0; background: #0d0d11; }

    /* Fullscreen makes the root the whole screen; the flex row inside is unchanged,
       so the filter rail travels with the map rather than being left behind. */
    .gm-root--fs { height: 100vh; }

    .gm-fs {
        position: absolute; top: .6rem; right: .6rem; z-index: 620;
        display: grid; place-content: center; width: 1.9rem; height: 1.9rem;
        color: inherit; cursor: pointer; border-radius: .3rem;
        background: var(--panel, #16161c); border: 1px solid var(--border, #2a2a32);
        opacity: .82;
    }
    .gm-fs:hover { opacity: 1; }

    /* Nothing downloaded yet — there is no map and no layer list, so this spans
       both columns rather than leaving an empty rail beside it. */
    .gm-discover {
        grid-column: 1 / -1;
        margin: auto; padding: 1.5rem; max-width: 26rem; text-align: center;
        align-self: center;
    }
    .gm-discover h3 { margin: 0 0 .5rem; font-size: 1rem; }
    .gm-discover p { margin: 0 0 .75rem; opacity: .75; font-size: .85rem; }
    .gm-btn {
        padding: .35rem .8rem; cursor: pointer; border-radius: .3rem; color: inherit;
        background: var(--input-bg, #101015); border: 1px solid var(--border, #2a2a32);
    }
    .gm-btn:disabled { opacity: .5; cursor: default; }
    .gm-avail { list-style: none; margin: 0 0 .5rem; padding: 0; text-align: left; }
    .gm-avail li {
        display: flex; align-items: center; justify-content: space-between; gap: .5rem;
        padding: .35rem 0; border-bottom: 1px solid var(--border, #2a2a32);
    }
    .gm-hint--err { color: #e0a0a0; }

    .gm-msg {
        position: absolute; inset: 0; z-index: 500; display: grid; place-content: center;
        text-align: center; background: rgba(13, 13, 17, .85); pointer-events: none;
    }
    .gm-err { pointer-events: auto; }
    .gm-hint { opacity: .6; font-size: .8rem; margin-top: .4rem; }

    .gm-popup {
        position: absolute; right: .75rem; bottom: .75rem; z-index: 600; width: 15rem;
        padding: .6rem .7rem; border-radius: .4rem;
        background: var(--panel, #16161c); border: 1px solid var(--border, #2a2a32);
        box-shadow: 0 .5rem 1.5rem rgba(0,0,0,.45);
    }
    .gm-popup h4 { margin: 0 1rem .15rem 0; font-size: .9rem; }
    .gm-popup-type { margin: 0 0 .4rem; opacity: .6; font-size: .75rem; }
    .gm-popup-found { display: flex; align-items: center; gap: .35rem; font-size: .8rem; cursor: pointer; }
    .gm-popup-x {
        position: absolute; top: .25rem; right: .35rem; background: none; border: 0;
        color: inherit; opacity: .6; cursor: pointer; font-size: 1rem; line-height: 1;
    }

    .gm-partial {
        position: absolute; left: .75rem; bottom: .75rem; z-index: 600;
        display: flex; align-items: center; gap: .5rem; flex-wrap: wrap;
        max-width: 22rem;
        padding: .3rem .55rem; border-radius: .25rem; font-size: .72rem;
        background: rgba(80, 60, 20, .88); border: 1px solid rgba(200, 160, 60, .4);
    }
    .gm-partial-prog { opacity: .8; }
    .gm-partial-bar {
        flex: 1 0 100%; height: 3px; border-radius: 2px;
        background: rgba(255, 255, 255, .15); overflow: hidden;
    }
    .gm-partial-bar > div { height: 100%; background: #d8b45c; transition: width .4s ease; }
    .gm-btn--sm { padding: .15rem .5rem; font-size: .72rem; }

    /* Matches the breakpoint where the guide viewer drops its own TOC column:
       below it, layers stack above the map rather than squeezing it. */
    @media (max-width: 1280px) {
        .gm-root { grid-template-columns: 1fr; grid-template-rows: auto 1fr; }
        .gm-side {
            grid-column: 1; grid-row: 1; max-height: 14rem;
            border-left: 0; border-bottom: 1px solid var(--clr-border);
            padding: 12px 16px;
        }
        .gm-mapwrap { grid-column: 1; grid-row: 2; min-height: 26rem; }
    }
</style>
