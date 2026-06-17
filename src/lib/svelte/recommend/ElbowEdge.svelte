<script lang="ts">
    interface Props {
        x1: number
        y1: number
        x2: number
        y2: number
        elbowT?: number   // 0..1, where along X the knee sits
        color?: string   // defaults to warm border tone
        visible?: boolean
        delay?: number    // ms stagger for draw-in animation
    }

    let { x1, y1, x2, y2, elbowT = 0.5, color = 'rgba(237,233,223,0.2)', visible = true, delay = 0 }: Props = $props()

    // Elbow: M x1,y1  →  (knee,y1)  →  (knee,y2)  →  x2,y2
    const knee = $derived(x1 + (x2 - x1) * elbowT)
    const d    = $derived(`M ${x1} ${y1} L ${knee} ${y1} L ${knee} ${y2} L ${x2} ${y2}`)

    // Approximate total path length for dash animation
    const pathLen = $derived(
        Math.abs(x2 - x1) + Math.abs(y2 - y1) + Math.abs(knee - x1) * 0.0
    )
</script>

<path
    {d}
    fill="none"
    stroke={color}
    stroke-width="1.5"
    stroke-linecap="round"
    stroke-linejoin="round"
    class="elbow-edge"
    class:visible
    style="--delay:{delay}ms; --path-len:{Math.abs(x2-x1)+Math.abs(y2-y1)+200}"
/>

<style>
    .elbow-edge {
        opacity: 0;
        stroke-dasharray: var(--path-len);
        stroke-dashoffset: var(--path-len);
        transition: opacity 0.2s ease, stroke-dashoffset 0s;
    }
    .elbow-edge.visible {
        opacity: 0.45;
        stroke-dashoffset: 0;
        transition:
            opacity 0.3s ease var(--delay),
            stroke-dashoffset 0.5s ease var(--delay);
    }
</style>
