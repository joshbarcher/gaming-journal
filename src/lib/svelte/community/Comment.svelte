<script lang="ts">
    import type { RedditComment } from '../../types.js'
    import { fmtScore, fmtTime } from '../../js/views/community-render.js'

    interface Props {
        comment:   RedditComment
        threadUrl: string
        depth?:    number
    }
    let { comment, threadUrl, depth = 0 }: Props = $props()

    let collapsed = $state(false)

    let usedDepth = $derived(comment.depth ?? depth)
    let author    = $derived(comment.author ?? '')
    let replies   = $derived(comment.replies ?? [])

    let displayBody = $derived.by(() => {
        const raw = comment.body ?? null
        return raw
            ? raw
                .replace(/https?:\/\/(?:preview|i)\.redd\.it\/\S+\.(?:png|jpe?g|gif|webp)\S*/gi, '')
                .replace(/!\[gif\]\(giphy\|[a-zA-Z0-9]+[^)]*\)/gi, '')
                .replace(/\[[^\]]*\]\(https?:\/\/(?:i\.)?imgur\.com\/[^)]+\)/gi, '')
                .replace(/https?:\/\/(?:i\.)?imgur\.com\/\S+/gi, '')
                .trim()
            : null
    })

    let images = $derived(comment.images ?? [])
    let gifs   = $derived((comment.gifs ?? []).filter(g => g.localVideo))
    let imgur  = $derived((comment.imgur ?? []).filter(e => e.images?.length && !e.failed))

    let hasBody = $derived(!!(displayBody || images.length || gifs.length || imgur.length))

    function imgSrc(img: { localImage?: string | null; url?: string }): string {
        return img.localImage ? `/relay${img.localImage}` : (img.url ?? '')
    }
</script>

<div
    class="thread-comment"
    data-depth={usedDepth}
    data-id={comment.id ?? ''}
    data-author={author}
>
    <div class="thread-comment-header">
        {#if replies.length > 0}
            <button
                class="thread-comment-toggle"
                aria-label={collapsed ? 'Expand replies' : 'Collapse replies'}
                onclick={() => collapsed = !collapsed}
            >{collapsed ? '+' : '−'}</button>
        {/if}
        <span class="thread-comment-author">{author || '[deleted]'}</span>
        <span class="thread-comment-score">▲ {fmtScore(comment.score)}</span>
        <span class="thread-comment-time">{fmtTime(comment.createdUtc)}</span>
    </div>

    <div class="thread-comment-body">
        {#if displayBody}
            {displayBody}
        {:else if images.length === 0 && gifs.length === 0 && imgur.length === 0}
            <em class="thread-comment-deleted">[deleted]</em>
        {/if}
    </div>

    {#each images as img}
        {@const src = imgSrc(img)}
        <div class="thread-comment-image" data-lightbox-src={src}>
            <img
                {src}
                alt=""
                loading="lazy"
                onerror={(e) => e.currentTarget.closest('.thread-comment-image')?.remove()}
            />
        </div>
    {/each}

    {#each gifs as g}
        <div class="thread-comment-gif">
            <video src="/relay{g.localVideo}" autoplay loop muted playsinline></video>
        </div>
    {/each}

    {#each imgur as entry}
        {@const first = entry.images[0]}
        {@const src = imgSrc(first)}
        {#if entry.images.length === 1}
            <div class="thread-comment-image" data-lightbox-src={src}>
                <img
                    {src}
                    alt=""
                    loading="lazy"
                    onerror={(e) => e.currentTarget.closest('.thread-comment-image')?.remove()}
                />
            </div>
        {:else}
            {@const srcs = JSON.stringify(entry.images.map(imgSrc))}
            <div class="thread-comment-imgur-album" data-carousel={srcs}>
                <img
                    {src}
                    alt=""
                    loading="lazy"
                    onerror={(e) => e.currentTarget.closest('.thread-comment-imgur-album')?.remove()}
                />
                <span class="thread-comment-album-badge">+{entry.images.length - 1} more</span>
            </div>
        {/if}
    {/each}

    {#if replies.length > 0 && !collapsed}
        <div class="thread-comment-replies">
            {#each replies as reply (reply.id)}
                <svelte:self comment={reply} {threadUrl} depth={usedDepth + 1} />
            {/each}
        </div>
    {/if}
</div>
