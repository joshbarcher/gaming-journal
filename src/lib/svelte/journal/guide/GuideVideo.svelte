<script lang="ts">
    // A video ContentBlock rendered as a Tributary link with the poster frame as its
    // preview. The href is Tributary's player, never youtube.com — so hover, middle-click
    // and right-click all stay inside the LAN — and a plain click opens the modal player
    // over the guide instead of navigating away from the page the reader is following.
    //
    // The poster frame is the copy stored beside the guide's own images at parse time, so
    // it renders from our server like every other guide image. The title is resolved from
    // Tributary at render (it isn't known at parse time) and only swaps the label in.
    import { tributaryEmbedUrl, fetchTributaryTitle, openTributarySync, preloadTributary } from '$lib/tributary'

    let { videoId, thumbUrl = '', caption = '' }: {
        videoId: string
        thumbUrl?: string
        caption?: string
    } = $props()

    const href = $derived(tributaryEmbedUrl(videoId))
    let title = $state<string | null>(null)

    $effect(() => {
        let cancelled = false
        title = null
        // There is a video on this page by definition — start the player loader now so the
        // first click opens the modal instead of falling through to the player page.
        preloadTributary()
        fetchTributaryTitle(videoId).then(t => { if (!cancelled) title = t })
        return () => { cancelled = true }
    })

    function onClick(e: MouseEvent) {
        // Leave modified clicks alone — they mean "open the full player in a new tab" —
        // and swallow the click only when the modal actually opened. Otherwise the href
        // stands, and the card behaves like the link it is.
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
        if (openTributarySync(videoId)) e.preventDefault()
    }
</script>

<figure class="gv-video-figure">
    <a class="gv-video" {href} target="_blank" rel="noreferrer" onclick={onClick}>
        <span class="gv-video-thumb">
            {#if thumbUrl}
                <img src={thumbUrl} alt="" loading="lazy">
            {/if}
            <span class="gv-video-play" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="26" height="26" fill="currentColor"><path d="M8 5.14v13.72a1 1 0 0 0 1.54.84l10.29-6.86a1 1 0 0 0 0-1.68L9.54 4.3A1 1 0 0 0 8 5.14z"/></svg>
            </span>
        </span>
        <span class="gv-video-meta">
            <span class="gv-video-title">{title ?? 'Watch video'}</span>
            <span class="gv-video-src">Tributary</span>
        </span>
    </a>
    {#if caption}
        <figcaption class="gv-caption">{caption}</figcaption>
    {/if}
</figure>
