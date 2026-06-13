<script lang="ts">
    import type { Trailer } from '../../../types.js'

    interface Props {
        appid:    number
        trailers: Trailer[]
    }
    let { appid, trailers }: Props = $props()

    let activeIdx = $state(0)
    let videoEl   = $state<HTMLVideoElement | null>(null)

    function selectTrailer(i: number) {
        if (i === activeIdx) return
        activeIdx = i
        if (videoEl) {
            videoEl.poster = trailers[i]?.thumbnail ?? ''
            videoEl.src    = `/relay/videos/steam/${appid}/${trailers[i]?.index ?? i}.mp4`
            videoEl.play().catch(() => {})
        }
    }
</script>

{#if trailers.length}
    <section class="game-section game-trailers" id="game-sec-trailers">
        <h2 class="game-section-title">Trailers</h2>

        {#if trailers.length === 1}
            <div class="trailers-single">
                <div class="trailers-player-wrap">
                    <video
                        class="trailers-player"
                        controls
                        preload="metadata"
                        src="/relay/videos/steam/{appid}/0.mp4"
                        poster={trailers[0]?.thumbnail ?? ''}
                        bind:this={videoEl}
                    ></video>
                </div>
            </div>
        {:else}
            <div class="trailers-layout">
                <div class="trailers-player-wrap">
                    <video
                        class="trailers-player"
                        controls
                        preload="metadata"
                        src="/relay/videos/steam/{appid}/0.mp4"
                        poster={trailers[0]?.thumbnail ?? ''}
                        bind:this={videoEl}
                    ></video>
                </div>
                <div class="trailers-list">
                    {#each trailers as t, i}
                        <button
                            class="trailers-thumb"
                            class:trailers-thumb--active={i === activeIdx}
                            onclick={() => selectTrailer(i)}
                        >
                            <div class="trailers-thumb-img-wrap">
                                {#if t.thumbnail}
                                    <img
                                        class="trailers-thumb-img"
                                        src={t.thumbnail}
                                        alt=""
                                        loading="lazy"
                                        onerror={(ev) => { (ev.currentTarget as HTMLImageElement).style.display = 'none' }}
                                    />
                                {/if}
                                <span class="trailers-play-icon">&#9654;</span>
                            </div>
                            <span class="trailers-thumb-name">{t.name}</span>
                        </button>
                    {/each}
                </div>
            </div>
        {/if}
    </section>
{/if}
