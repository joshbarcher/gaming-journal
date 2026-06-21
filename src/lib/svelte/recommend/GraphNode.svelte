<script lang="ts">
    const TYPE_COLORS: Record<string, string> = {
        genre:      '#c9a84c',   // gold — app accent
        length:     '#4ecdc4',   // teal — app progress
        tags:       '#e07b54',   // terracotta
        era:        '#a8956a',   // muted amber
        popularity: '#7db5d8',   // dusty blue
        status:     '#c17aad',   // muted mauve
        developer:  '#8fc47a',   // sage green
        metacritic: '#d4904a',   // burnt amber
        center:     '#ede9df',   // warm white
    }

    interface Props {
        x: number
        y: number
        label: string
        subLabel?: string
        filterType?: string
        isCenter?: boolean
        phase?: 'entering' | 'idle' | 'chosen' | 'dismissed'
        delay?: number
        onclick?: () => void
    }

    let {
        x, y, label, subLabel = '', filterType = 'center',
        isCenter = false, phase = 'idle', delay = 0, onclick,
    }: Props = $props()

    const color  = $derived(TYPE_COLORS[filterType] ?? '#818cf8')
    const radius = $derived(isCenter ? 68 : 50)

    function splitLabel(text: string, maxLen = 16): [string, string] {
        const parenIdx = text.indexOf('(')
        if (parenIdx > 1) return [text.slice(0, parenIdx).trim(), text.slice(parenIdx)]
        if (text.length <= maxLen) return [text, '']
        const idx = text.lastIndexOf(' ', maxLen)
        if (idx < 1) return [text.slice(0, maxLen), text.slice(maxLen).trim()]
        return [text.slice(0, idx), text.slice(idx + 1)]
    }

    const [line1, line2] = $derived(splitLabel(label, isCenter ? 14 : 14))
</script>

<!-- Outer g: positioning only, never animated -->
<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
<g transform="translate({x} {y})" onclick={onclick ?? undefined} role={onclick ? 'button' : undefined}>

    <!-- Inner g: animation target -->
    <g
        class="node-inner"
        class:phase-entering={phase === 'entering'}
        class:phase-idle={phase === 'idle'}
        class:phase-chosen={phase === 'chosen'}
        class:phase-dismissed={phase === 'dismissed'}
        class:is-center={isCenter}
        class:is-option={!isCenter}
        style="--color:{color}; --delay:{delay}ms"
    >
        {#if isCenter}
            <circle r={radius + 12} fill="none" stroke={color} stroke-width="1" opacity="0.2" class="glow-ring" />
            <circle r={radius + 6}  fill="none" stroke={color} stroke-width="1" opacity="0.35" class="glow-ring glow-ring--mid" />
        {/if}

        <circle
            r={radius}
            fill={isCenter ? 'rgba(19,18,16,0.96)' : 'rgba(27,25,22,0.92)'}
            stroke={color}
            stroke-width={isCenter ? 2 : 1.5}
            class="node-circle"
        />

        {#if isCenter && subLabel}
            <text class="node-eyebrow" y={-radius * 0.55} text-anchor="middle" dominant-baseline="middle">{subLabel}</text>
        {/if}

        <text
            class="node-label"
            class:center-label={isCenter}
            y={line2 ? -8 : 0}
            text-anchor="middle"
            dominant-baseline="middle"
        >{line1}</text>

        {#if line2}
            <text
                class="node-label"
                class:center-label={isCenter}
                y={10}
                text-anchor="middle"
                dominant-baseline="middle"
            >{line2}</text>
        {/if}

        {#if !isCenter && subLabel}
            <text class="node-count" y={radius * 0.65} text-anchor="middle" dominant-baseline="middle">{subLabel}</text>
        {/if}
    </g>
</g>

<style>
    /* Base: hidden, scaled down */
    .node-inner {
        opacity: 0;
        transform: scale(0.3);
        transform-origin: 0 0;
        transition:
            opacity 0.4s ease var(--delay),
            transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) var(--delay);
    }

    /* Visible states */
    .node-inner.phase-entering,
    .node-inner.phase-idle {
        opacity: 1;
        transform: scale(1);
    }

    /* Chosen: brief scale-up before leaving */
    .node-inner.phase-chosen {
        opacity: 1;
        transform: scale(1.15);
        transition: opacity 0.2s ease, transform 0.2s ease;
    }

    /* Dismissed: fade + shrink */
    .node-inner.phase-dismissed {
        opacity: 0;
        transform: scale(0.4);
        transition: opacity 0.25s ease var(--delay), transform 0.25s ease var(--delay);
    }

    /* Hover: only interactive option nodes */
    .node-inner.is-option:not(.phase-dismissed) {
        cursor: pointer;
    }
    .node-inner.is-option:not(.phase-dismissed):hover .node-circle {
        filter: brightness(1.4);
    }

    .glow-ring {
        animation: pulse-ring 3s ease-in-out infinite;
        pointer-events: none;
    }
    .glow-ring--mid {
        animation-delay: 1s;
    }
    @keyframes pulse-ring {
        0%, 100% { opacity: 0.2; }
        50%       { opacity: 0.5; }
    }

    .node-eyebrow {
        font-size: 9px;
        fill: rgba(237,233,223,0.45);
        letter-spacing: 0.08em;
        text-transform: uppercase;
        pointer-events: none;
    }
    .node-label {
        font-size: 12px;
        fill: #ede9df;
        font-weight: 500;
        pointer-events: none;
        letter-spacing: 0.01em;
    }
    .node-label.center-label {
        font-size: 15px;
        font-weight: 600;
        fill: #ede9df;
    }
    .node-count {
        font-size: 10px;
        fill: rgba(237,233,223,0.35);
        pointer-events: none;
    }
</style>
