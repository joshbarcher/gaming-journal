<script lang="ts">
    interface Props {
        x: number
        y: number
        appid: number
        name: string
        header: string | null
        phase?: 'entering' | 'idle' | 'dismissed'
        delay?: number
    }

    let { x, y, appid, name, header, phase = 'idle', delay = 0 }: Props = $props()

    const W = 150
    const H = 70

    const imgUrl = $derived(header ?? `/relay/images/steam/games/${appid}/header.jpg`)

    function splitName(text: string): [string, string] {
        if (text.length <= 18) return [text, '']
        const idx = text.lastIndexOf(' ', 18)
        if (idx < 1) return [text.slice(0, 18), text.slice(18).trim()]
        return [text.slice(0, idx), text.slice(idx + 1)]
    }

    const [line1, line2] = $derived(splitName(name))
</script>

<!-- Outer g: position only -->
<g transform="translate({x} {y})">
    <!-- Inner g: animation -->
    <g
        class="result-inner"
        class:phase-entering={phase === 'entering'}
        class:phase-idle={phase === 'idle'}
        class:phase-dismissed={phase === 'dismissed'}
        style="--delay:{delay}ms"
    >
        <!-- SVG <a> for navigation -->
        <a href="/game/{appid}" class="result-link">
            <!-- Poster frame -->
            <rect
                x={-W / 2} y={-H / 2}
                width={W} height={H}
                rx="4"
                fill="#1b1916"
                stroke="rgba(255,255,255,0.12)"
                stroke-width="1.5"
                class="result-frame"
            />

            <defs>
                <clipPath id="poster-clip-{appid}">
                    <rect x={-W / 2} y={-H / 2} width={W} height={H} rx="4" />
                </clipPath>
                <linearGradient id="poster-scrim-{appid}" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stop-color="#000" stop-opacity="0" />
                    <stop offset="100%" stop-color="#000" stop-opacity="0.8" />
                </linearGradient>
            </defs>

            <image
                href={imgUrl}
                x={-W / 2} y={-H / 2}
                width={W} height={H}
                preserveAspectRatio="xMidYMid slice"
                clip-path="url(#poster-clip-{appid})"
            />

            <!-- Bottom scrim -->
            <rect
                x={-W / 2} y={H / 2 - 20}
                width={W} height="20"
                fill="url(#poster-scrim-{appid})"
                clip-path="url(#poster-clip-{appid})"
            />

            <!-- Game title below poster -->
            <text x="0" y={H / 2 + 11} text-anchor="middle" dominant-baseline="middle" class="game-title">{line1}</text>
            {#if line2}
                <text x="0" y={H / 2 + 21} text-anchor="middle" dominant-baseline="middle" class="game-title game-title--2">{line2}</text>
            {/if}
        </a>
    </g>
</g>

<style>
    .result-inner {
        opacity: 0;
        transform: scale(0.3);
        transform-origin: 0 0;
        transition:
            opacity 0.4s ease var(--delay),
            transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) var(--delay);
        cursor: pointer;
    }
    .result-inner.phase-entering,
    .result-inner.phase-idle {
        opacity: 1;
        transform: scale(1);
    }
    .result-inner.phase-dismissed {
        opacity: 0;
        transform: scale(0.4);
        transition: opacity 0.2s ease, transform 0.2s ease;
    }
    .result-inner:not(.phase-dismissed):hover .result-frame {
        filter: brightness(1.25);
        stroke: #c9a84c;
    }
    .result-link {
        text-decoration: none;
    }
    .result-frame {
        transition: filter 0.2s ease, stroke 0.2s ease;
    }
    .game-title {
        font-size: 10px;
        fill: #ede9df;
        font-weight: 500;
        pointer-events: none;
    }
    .game-title--2 {
        fill: rgba(237,233,223,0.55);
    }
</style>
