<script lang="ts">
    import type { SteamGame, PcgwData } from '../../../types.js'

    // Icons
    const PI: Record<string, string> = {
        monitor:  `<svg class="pcgw-icon" viewBox="0 0 24 24"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>`,
        maximize: `<svg class="pcgw-icon" viewBox="0 0 24 24"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>`,
        sun:      `<svg class="pcgw-icon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>`,
        zap:      `<svg class="pcgw-icon" viewBox="0 0 24 24"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`,
        activity: `<svg class="pcgw-icon" viewBox="0 0 24 24"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>`,
        refresh:  `<svg class="pcgw-icon" viewBox="0 0 24 24"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/></svg>`,
        sparkles: `<svg class="pcgw-icon" viewBox="0 0 24 24"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/></svg>`,
        layers:   `<svg class="pcgw-icon" viewBox="0 0 24 24"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>`,
        aim:      `<svg class="pcgw-icon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="22" y1="12" x2="18" y2="12"/><line x1="6" y1="12" x2="2" y2="12"/><line x1="12" y1="6" x2="12" y2="2"/><line x1="12" y1="22" x2="12" y2="18"/></svg>`,
        aperture: `<svg class="pcgw-icon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="14.31" y1="8" x2="20.05" y2="17.94"/><line x1="9.69" y1="8" x2="21.17" y2="8"/><line x1="7.38" y1="12" x2="13.12" y2="2.06"/><line x1="9.69" y1="16" x2="3.95" y2="6.06"/><line x1="14.31" y1="16" x2="2.83" y2="16"/><line x1="16.62" y1="12" x2="10.88" y2="21.94"/></svg>`,
        film:     `<svg class="pcgw-icon" viewBox="0 0 24 24"><rect x="2" y="2" width="20" height="20" rx="2.18"/><line x1="7" y1="2" x2="7" y2="22"/><line x1="17" y1="2" x2="17" y2="22"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="2" y1="7" x2="7" y2="7"/><line x1="2" y1="17" x2="7" y2="17"/><line x1="17" y1="17" x2="22" y2="17"/><line x1="17" y1="7" x2="22" y2="7"/></svg>`,
        arrowUp:  `<svg class="pcgw-icon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><polyline points="16 12 12 8 8 12"/><line x1="12" y1="16" x2="12" y2="8"/></svg>`,
        eye:      `<svg class="pcgw-icon" viewBox="0 0 24 24"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>`,
        mouse:    `<svg class="pcgw-icon" viewBox="0 0 24 24"><rect x="5" y="2" width="14" height="20" rx="7"/><path d="M12 6v4"/></svg>`,
        keyboard: `<svg class="pcgw-icon" viewBox="0 0 24 24"><rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M8 14h8"/></svg>`,
        gamepad:  `<svg class="pcgw-icon" viewBox="0 0 24 24"><line x1="6" y1="12" x2="10" y2="12"/><line x1="8" y1="10" x2="8" y2="14"/><line x1="15" y1="13" x2="15.01" y2="13"/><line x1="18" y1="11" x2="18.01" y2="11"/><rect x="2" y="8" width="20" height="12" rx="4"/></svg>`,
        cloud:    `<svg class="pcgw-icon" viewBox="0 0 24 24"><path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/></svg>`,
        folder:   `<svg class="pcgw-icon" viewBox="0 0 24 24"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/></svg>`,
        save:     `<svg class="pcgw-icon" viewBox="0 0 24 24"><path d="M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7"/><path d="M7 3v4a1 1 0 0 0 1 1h7"/></svg>`,
        shield:   `<svg class="pcgw-icon" viewBox="0 0 24 24"><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/></svg>`,
        wrench:   `<svg class="pcgw-icon" viewBox="0 0 24 24"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>`,
        extLink:  `<svg class="pcgw-icon pcgw-icon--xs" viewBox="0 0 24 24"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>`,
    }

    const VIDEO_FEATURES = [
        { key: 'widescreen', icon: 'monitor',  label: 'Widescreen' },
        { key: 'ultrawide',  icon: 'monitor',  label: 'Ultrawide' },
        { key: 'uhd4k',      icon: 'maximize', label: '4K UHD' },
        { key: 'hdr',        icon: 'sun',      label: 'HDR' },
        { key: 'fps60',      icon: 'zap',      label: '60 FPS' },
        { key: 'fps120',     icon: 'activity', label: '120+ FPS' },
        { key: 'vsync',      icon: 'refresh',  label: 'VSync' },
        { key: 'aa',         icon: 'sparkles', label: 'Anti-Aliasing' },
        { key: 'af',         icon: 'layers',   label: 'Aniso. Filtering' },
        { key: 'fov',        icon: 'aim',      label: 'FOV Control' },
        { key: 'rayTracing', icon: 'aperture', label: 'Ray Tracing' },
        { key: 'frameGen',   icon: 'film',     label: 'Frame Generation' },
        { key: 'upscaling',  icon: 'arrowUp',  label: 'Upscaling' },
        { key: 'colorBlind', icon: 'eye',      label: 'Color Blind Mode' },
    ]

    const MOUSE_ROWS    = [['sensitivity','Sensitivity'],['acceleration','Raw input / no accel'],['inMenus','Works in menus'],['yInversion','Y-axis inversion'],['kbmPrompts','KB/M prompts']]
    const KB_ROWS       = [['remapping','Key remapping'],['steamInput','Steam Input']]
    const CTRL_ROWS     = [['support','Controller support'],['fullSupport','Full controller'],['remapping','Button remapping'],['sensitivity','Sensitivity'],['yInversion','Y-axis inversion'],['hotplugging','Hot-plugging'],['simultaneousInput','Simultaneous input'],['hapticFeedback','Haptic feedback'],['promptOverride','Prompt override'],['xinput','XInput'],['dinput','DirectInput'],['playstation','PlayStation'],['nintendo','Nintendo']]
    const PLATFORM_ROWS = [['xboxPrompts','Xbox prompts'],['impulseTriggers','Impulse triggers'],['playstationPrompts','PlayStation prompts'],['lightBar','Light bar'],['adaptiveTriggers','Adaptive triggers'],['dualSenseHaptics','DualSense haptics'],['motionSensors','Motion sensors'],['steamDeckPrompts','Steam Deck prompts'],['touchscreen','Touchscreen']]
    const CLOUD_ROWS    = [['steam','Steam'],['gogGalaxy','GOG Galaxy'],['epicGames','Epic Games'],['eaApp','EA App'],['xbox','Xbox'],['ubisoftConnect','Ubisoft Connect'],['xboxCloud','Xbox Cloud'],['oneDrive','OneDrive']]

    function badge(val: string | undefined): { type: 'yes' | 'no' | 'hack' } | null {
        if (val === 'true')     return { type: 'yes' }
        if (val === 'false')    return { type: 'no' }
        if (val === 'hackable') return { type: 'hack' }
        return null
    }

    interface Props {
        pcgwData?:  PcgwData | null
        game:       SteamGame
        onRefresh?: () => Promise<void>
    }
    let { pcgwData, game, onRefresh }: Props = $props()

    let refreshing = $state(false)

    async function refresh() {
        if (!onRefresh || refreshing) return
        refreshing = true
        try { await onRefresh() } finally { refreshing = false }
    }

    let v    = $derived(pcgwData?.video     ?? {})
    let inp  = $derived(pcgwData?.input     ?? {} as any)
    let cl   = $derived(pcgwData?.cloud     ?? {})
    let av   = $derived(pcgwData?.availability ?? {})
    let paths = $derived(pcgwData?.paths    ?? {})
    let fixes = $derived(pcgwData?.fixes    ?? [])

    let activeVideoFeatures = $derived(VIDEO_FEATURES.filter(f => v[f.key] != null))
    let mouseRows  = $derived(MOUSE_ROWS.filter(([k]) => inp.mouse?.[k] != null))
    let kbRows     = $derived(KB_ROWS.filter(([k]) => inp.keyboard?.[k] != null))
    let ctrlRows   = $derived([...CTRL_ROWS, ...PLATFORM_ROWS].filter(([k]) => inp.controller?.[k] != null || inp.platform?.[k] != null))
    let drmChips   = $derived(av.drm ?? [])
    let cloudRows  = $derived(CLOUD_ROWS.filter(([k]) => cl[k] != null))
</script>

{#if pcgwData?.found}
    <section class="game-section" id="game-sec-pcgw">
        <h2 class="game-section-title">
            PCGamingWiki
            {#if pcgwData.pageUrl}
                <a class="pcgw-wiki-link" href={pcgwData.pageUrl} target="_blank" rel="noopener">{@html PI.extLink}</a>
            {/if}
            <button class="game-refresh-btn" class:game-refresh-btn--spinning={refreshing} disabled={refreshing} onclick={refresh} title="Refresh PCGamingWiki data">↻</button>
        </h2>

        <!-- Video & Display -->
        {#if activeVideoFeatures.length}
            <div class="pcgw-block">
                <h3 class="pcgw-block-title">{@html PI.monitor}Video &amp; Display</h3>
                <div class="pcgw-feature-grid">
                    {#each activeVideoFeatures as f}
                        {@const b = badge(v[f.key])}
                        {#if b}
                            <div class="pcgw-feature-tile">
                                {@html PI[f.icon]}
                                <span class="pcgw-tile-label">{f.label}</span>
                                <span class="pcgw-badge pcgw-badge--{b.type}">{b.type === 'yes' ? 'Yes' : b.type === 'no' ? 'No' : 'Hackable'}</span>
                            </div>
                        {/if}
                    {/each}
                </div>
            </div>
        {/if}

        <!-- Input -->
        {#if mouseRows.length || kbRows.length || ctrlRows.length}
            <div class="pcgw-block">
                <h3 class="pcgw-block-title">{@html PI.gamepad}Input</h3>
                <div class="pcgw-input-grid">
                    {#if mouseRows.length}
                        <div class="pcgw-input-card">
                            <div class="pcgw-card-title">{@html PI.mouse}Mouse</div>
                            {#each mouseRows as [k, label]}
                                {@const b = badge(inp.mouse[k])}
                                {#if b}<div class="pcgw-row"><span class="pcgw-row-label">{label}</span><span class="pcgw-badge pcgw-badge--{b.type}">{b.type === 'yes' ? 'Yes' : b.type === 'no' ? 'No' : 'Hackable'}</span></div>{/if}
                            {/each}
                        </div>
                    {/if}
                    {#if kbRows.length}
                        <div class="pcgw-input-card">
                            <div class="pcgw-card-title">{@html PI.keyboard}Keyboard</div>
                            {#each kbRows as [k, label]}
                                {@const b = badge(inp.keyboard[k])}
                                {#if b}<div class="pcgw-row"><span class="pcgw-row-label">{label}</span><span class="pcgw-badge pcgw-badge--{b.type}">{b.type === 'yes' ? 'Yes' : b.type === 'no' ? 'No' : 'Hackable'}</span></div>{/if}
                            {/each}
                        </div>
                    {/if}
                    {#if ctrlRows.length}
                        <div class="pcgw-input-card pcgw-input-card--fit">
                            <div class="pcgw-card-title">{@html PI.gamepad}Controller</div>
                            <div class="pcgw-rows-multicol">
                                {#each ctrlRows as [k, label]}
                                    {@const src = inp.controller?.[k] ?? inp.platform?.[k]}
                                    {@const b = badge(src)}
                                    {#if b}<div class="pcgw-row"><span class="pcgw-row-label">{label}</span><span class="pcgw-badge pcgw-badge--{b.type}">{b.type === 'yes' ? 'Yes' : b.type === 'no' ? 'No' : 'Hackable'}</span></div>{/if}
                                {/each}
                            </div>
                        </div>
                    {/if}
                </div>
            </div>
        {/if}

        <!-- Availability & Cloud Saves -->
        {#if drmChips.length || cloudRows.length}
            <div class="pcgw-block">
                <h3 class="pcgw-block-title">{@html PI.shield}Availability &amp; Cloud Saves</h3>
                <div class="pcgw-avail-grid">
                    {#if drmChips.length}
                        <div class="pcgw-input-card">
                            <div class="pcgw-card-title">{@html PI.shield}DRM</div>
                            <div class="pcgw-chip-row">
                                {#each drmChips as d}<span class="pcgw-chip">{d}</span>{/each}
                            </div>
                        </div>
                    {/if}
                    {#if cloudRows.length}
                        <div class="pcgw-input-card">
                            <div class="pcgw-card-title">{@html PI.cloud}Cloud Saves</div>
                            {#each cloudRows as [k, label]}
                                {@const b = badge(cl[k])}
                                {#if b}<div class="pcgw-row"><span class="pcgw-row-label">{label}</span><span class="pcgw-badge pcgw-badge--{b.type}">{b.type === 'yes' ? 'Yes' : b.type === 'no' ? 'No' : 'Hackable'}</span></div>{/if}
                            {/each}
                        </div>
                    {/if}
                </div>
            </div>
        {/if}

        <!-- Save & Config Locations -->
        <div class="pcgw-block pcgw-block--files" id="Game_data">
            <h3 class="pcgw-block-title">{@html PI.save}Save &amp; Config Locations</h3>
            <div class="pcgw-paths-grid">
                {#each [{ title: 'Save Game', icon: PI.save, obj: paths.saveGame }, { title: 'Config File', icon: PI.folder, obj: paths.config }] as { title, icon, obj }}
                    {#if obj && Object.keys(obj).length}
                        <div class="pcgw-path-card">
                            <div class="pcgw-card-title">{@html icon}{title}</div>
                            {#each Object.entries(obj) as [os, path]}
                                <div class="pcgw-path-row">
                                    <span class="pcgw-path-os">{os}</span>
                                    <code class="pcgw-path-code">{path}</code>
                                </div>
                            {/each}
                        </div>
                    {/if}
                {/each}
            </div>
        </div>

        <!-- Fixes & Tweaks -->
        {#if fixes.length}
            <div class="pcgw-block">
                <h3 class="pcgw-block-title">{@html PI.wrench}Fixes &amp; Tweaks</h3>
                <div class="pcgw-fixes">
                    {#each fixes as f}
                        <details class="pcgw-fix">
                            <summary>{@html PI.wrench}{f.title}</summary>
                            <div class="pcgw-fix-body">{@html f.html}</div>
                        </details>
                    {/each}
                </div>
            </div>
        {/if}
    </section>
{/if}
