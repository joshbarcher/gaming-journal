<script lang="ts">
    import ElbowEdge      from './ElbowEdge.svelte'
    import GraphNode      from './GraphNode.svelte'
    import GameResultNode from './GameResultNode.svelte'

    export interface RecommendQuestion {
        type: string
        label: string
        options: { value: string; label: string; count: number }[]
    }

    export interface RecommendGame {
        appid: number
        name: string
        playtimeMinutes: number
        header: string | null
    }

    type GraphPhase = 'idle' | 'transitioning-out' | 'transitioning-in'

    interface Props {
        question:  RecommendQuestion | null
        games:     RecommendGame[] | null
        loading?:  boolean
        stepIndex: number
        onChoice:  (type: string, value: string) => void
    }

    let { question, games, loading = false, stepIndex, onChoice }: Props = $props()

    // ── Canvas dimensions ─────────────────────────────────────────────────────
    const VW = 1000
    const VH = 680
    const CX = VW / 2    // center x
    const CY = VH / 2    // center y

    const OPTION_R  = 230  // radius for option nodes
    const GAME_R    = 260  // radius for game result nodes

    // ── Phase management ─────────────────────────────────────────────────────
    let graphPhase = $state<GraphPhase>('idle')
    let displayQuestion = $state<RecommendQuestion | null>(null)
    let displayGames    = $state<RecommendGame[] | null>(null)
    let nodePhases      = $state<string[]>([])  // 'entering'|'idle'|'chosen'|'dismissed'
    let elbowOffsets    = $state<number[]>([])  // random elbow T per option

    // Recompute layout whenever the incoming question/games change
    $effect(() => {
        if (loading) return

        // New content arrived — trigger out then in
        if (graphPhase === 'idle' && (question !== displayQuestion || games !== displayGames)) {
            if (displayQuestion !== null || displayGames !== null) {
                // Dismiss current nodes
                graphPhase = 'transitioning-out'
                nodePhases = nodePhases.map(() => 'dismissed')
                setTimeout(finishTransition, 350)
            } else {
                finishTransition()
            }
        }
    })

    function finishTransition() {
        displayQuestion = question
        displayGames    = games

        if (question) {
            nodePhases   = question.options.map(() => 'entering')
            elbowOffsets = question.options.map(() => 0.3 + Math.random() * 0.4)
        } else if (games) {
            nodePhases   = games.map(() => 'entering')
            elbowOffsets = games.map(() => 0.3 + Math.random() * 0.4)
        }

        graphPhase = 'idle'
        // Settle entering → idle after animation
        setTimeout(() => {
            nodePhases = nodePhases.map(() => 'idle')
        }, 600)
    }

    // ── Node position helpers ─────────────────────────────────────────────────
    function optionPositions(count: number, radius: number): { x: number; y: number }[] {
        if (count === 0) return []

        if (count <= 3) {
            // Symmetric arc centred at top (−π/2), spread ~120° per step
            const spread     = (count - 1) * (Math.PI / 3)
            const startAngle = -Math.PI / 2 - spread / 2
            return Array.from({ length: count }, (_, i) => {
                const a = count === 1
                    ? -Math.PI / 2
                    : startAngle + i * spread / (count - 1)
                return { x: CX + Math.cos(a) * radius, y: CY + Math.sin(a) * radius }
            })
        }

        // Full circle, starting at top
        return Array.from({ length: count }, (_, i) => {
            const a = -Math.PI / 2 + (i / count) * Math.PI * 2
            return { x: CX + Math.cos(a) * radius, y: CY + Math.sin(a) * radius }
        })
    }

    const optPos  = $derived(
        displayQuestion
            ? optionPositions(displayQuestion.options.length, OPTION_R)
            : displayGames
                ? optionPositions(Math.min(displayGames.length, 8), GAME_R)
                : []
    )

    // ── Interaction ───────────────────────────────────────────────────────────
    function choose(index: number) {
        if (!displayQuestion || graphPhase !== 'idle') return

        // Mark chosen / dismiss others
        nodePhases = nodePhases.map((_, i) => i === index ? 'chosen' : 'dismissed')

        setTimeout(() => {
            onChoice(displayQuestion!.type, displayQuestion!.options[index].value)
        }, 320)
    }

    // ── Edge color mirrors the current question type ──────────────────────────
    const TYPE_COLORS: Record<string, string> = {
        genre:      '#c9a84c',
        length:     '#4ecdc4',
        tags:       '#e07b54',
        era:        '#a8956a',
        popularity: '#7db5d8',
        status:     '#c17aad',
        developer:  '#8fc47a',
        metacritic: '#d4904a',
    }

    const edgeColor = $derived(
        displayQuestion ? (TYPE_COLORS[displayQuestion.type] ?? 'rgba(237,233,223,0.2)') : '#c9a84c'
    )
</script>

<svg viewBox="0 0 {VW} {VH}" class="recommend-graph" preserveAspectRatio="xMidYMid meet">

    <!-- Edges: drawn before nodes so they sit underneath -->
    {#if (displayQuestion || displayGames) && optPos.length}
        {#each optPos as pos, i}
            <ElbowEdge
                x1={CX} y1={CY}
                x2={pos.x} y2={pos.y}
                elbowT={elbowOffsets[i] ?? 0.5}
                color={edgeColor}
                visible={nodePhases[i] !== 'dismissed'}
                delay={i * 60}
            />
        {/each}
    {/if}

    <!-- Option nodes -->
    {#if displayQuestion}
        {#each displayQuestion.options as opt, i}
            {#if optPos[i]}
                <GraphNode
                    x={optPos[i].x}
                    y={optPos[i].y}
                    label={opt.label}
                    subLabel={opt.count > 0 ? `${opt.count}` : ''}
                    filterType={displayQuestion.type}
                    phase={nodePhases[i] as any ?? 'idle'}
                    delay={i * 80}
                    onclick={() => choose(i)}
                />
            {/if}
        {/each}
    {/if}

    <!-- Game result nodes -->
    {#if displayGames}
        {#each displayGames.slice(0, 8) as game, i}
            {#if optPos[i]}
                <GameResultNode
                    x={optPos[i].x}
                    y={optPos[i].y}
                    appid={game.appid}
                    name={game.name}
                    header={game.header}
                    phase={nodePhases[i] as any ?? 'idle'}
                    delay={i * 80}
                />
            {/if}
        {/each}
    {/if}

    <!-- Center node — always rendered last (on top) -->
    <GraphNode
        x={CX}
        y={CY}
        label={loading
            ? 'Thinking…'
            : displayGames
                ? 'Here\'s what to play'
                : displayQuestion?.label ?? 'What should I play?'}
        subLabel={displayQuestion ? displayQuestion.type : ''}
        filterType="center"
        isCenter
        phase="idle"
    />
</svg>

<style>
    .recommend-graph {
        width: 100%;
        height: 100%;
        display: block;
    }
</style>
