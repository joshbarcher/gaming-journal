import { Image } from 'expo-image'
import { router } from 'expo-router'
import { useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import Animated, { FadeInUp } from 'react-native-reanimated'

import { postRecommend } from '@/api/recommend'
import { useApiHost } from '@/hooks/useApiHost'
import { colors, fonts, radius, spacing } from '@/theme/tokens'
import { RECOMMEND_DEPTHS, type RecommendDepth, type RecommendGame, type RecommendQuestion } from 'gaming-journal-contracts/recommend'

const DEPTH_QUESTIONS: Record<RecommendDepth, number> = { shallow: 3, normal: 5, deep: 7 }

type Phase = 'start' | 'playing' | 'results'
type Filter = { type: string; value: string | null }

// Port of recommend/+page.svelte — **deliberately built from the web's own mobile-fallback stacked
// list design, not the desktop SVG node graph**, per PLAN.md's standing decision: the web already
// ships this simpler presentation layer for ≤479px screens (same state machine, same API, just a
// different UI), so it's reused directly as the one RN implementation rather than porting an
// animated SVG graph (elbow-routed edges, radial node layout, per-type edge colors) that would be
// real, substantial scope for a single screen. No per-breakpoint variation needed here — this is
// the same design at all 3 of this app's required tiers, not a mobile-only special case.
export default function RecommendScreen() {
    const apiHostQuery = useApiHost()
    const apiHost = apiHostQuery.data

    const [depth, setDepth] = useState<RecommendDepth>('normal')
    const [phase, setPhase] = useState<Phase>('start')
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [sequence, setSequence] = useState<string[] | null>(null)
    const [question, setQuestion] = useState<RecommendQuestion | null>(null)
    const [games, setGames] = useState<RecommendGame[] | null>(null)
    const [relaxed, setRelaxed] = useState(false)
    const [stepIndex, setStepIndex] = useState(0)

    async function callRecommend(appliedFilters: Filter[], seq: string[] | null) {
        setLoading(true)
        setError(null)
        try {
            const data = await postRecommend({ depth, sequence: seq ?? undefined, filters: appliedFilters })
            if (seq === null && 'sequence' in data) setSequence(data.sequence)
            if (data.done) {
                setGames(data.games)
                setQuestion(null)
                setRelaxed(data.relaxed ?? false)
                setPhase('results')
            } else {
                setQuestion(data.question)
                setGames(null)
                setPhase('playing')
            }
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Something went wrong')
        } finally {
            setLoading(false)
        }
    }

    function reset(returnToStart: boolean) {
        setSequence(null)
        setQuestion(null)
        setGames(null)
        setRelaxed(false)
        setStepIndex(0)
        setError(null)
        if (returnToStart) setPhase('start')
    }

    async function start() {
        reset(false)
        await callRecommend([], null)
    }

    async function handleChoice(type: string, value: string) {
        setStepIndex(i => i + 1)
        await callRecommend([{ type, value }], sequence)
    }

    async function handleSkip() {
        if (!question) return
        setStepIndex(i => i + 1)
        await callRecommend([{ type: question.type, value: null }], sequence)
    }

    return (
        <View style={styles.container}>
            <View style={styles.topbar}>
                <Text style={styles.title}>Recommendations</Text>
                <View style={styles.controls}>
                    {phase === 'start' ? (
                        <View style={styles.depthToggle}>
                            {RECOMMEND_DEPTHS.map(d => (
                                <Pressable key={d} style={[styles.depthBtn, depth === d && styles.depthBtnActive]} onPress={() => setDepth(d)}>
                                    <Text style={[styles.depthBtnText, depth === d && styles.depthBtnTextActive]}>{d}</Text>
                                </Pressable>
                            ))}
                        </View>
                    ) : (
                        <Text style={styles.depthBadge}>{depth}</Text>
                    )}
                    {phase === 'playing' && question && (
                        <Pressable style={styles.skipBtn} onPress={handleSkip}>
                            <Text style={styles.skipBtnText}>Skip ›</Text>
                        </Pressable>
                    )}
                    {phase !== 'start' && (
                        <Pressable style={styles.resetBtn} onPress={() => reset(true)}>
                            <Text style={styles.resetBtnText}>↺ Reset</Text>
                        </Pressable>
                    )}
                </View>
            </View>

            {phase === 'playing' && sequence && (
                <View style={styles.progressTrack}>
                    {sequence.map((_, i) => (
                        <View key={i} style={[styles.pip, i < stepIndex && styles.pipDone, i === stepIndex && styles.pipActive]} />
                    ))}
                </View>
            )}

            <ScrollView style={styles.canvas} contentContainerStyle={styles.canvasContent}>
                {phase === 'start' && (
                    <View style={styles.startCard}>
                        <Text style={styles.startIcon}>◎</Text>
                        <Text style={styles.startTitle}>Find your next game</Text>
                        <Text style={styles.startDesc}>Answer a few questions and we'll pull something from your library.</Text>
                        <View style={styles.depthToggleLg}>
                            {RECOMMEND_DEPTHS.map(d => (
                                <Pressable key={d} style={[styles.depthBtnLg, depth === d && styles.depthBtnActive]} onPress={() => setDepth(d)}>
                                    <Text style={[styles.depthKey, depth === d && styles.depthBtnTextActive]}>{d}</Text>
                                    <Text style={styles.depthDesc}>{DEPTH_QUESTIONS[d]} questions</Text>
                                </Pressable>
                            ))}
                        </View>
                        <Pressable style={styles.startBtn} onPress={start}>
                            <Text style={styles.startBtnText}>Start exploring</Text>
                        </Pressable>
                    </View>
                )}

                {phase !== 'start' && error && (
                    <View style={[styles.banner, styles.bannerError]}><Text style={styles.bannerErrorText}>{error}</Text></View>
                )}
                {phase !== 'start' && relaxed && (
                    <View style={[styles.banner, styles.bannerRelaxed]}><Text style={styles.bannerRelaxedText}>One filter was loosened to find enough results.</Text></View>
                )}

                {loading && <Text style={styles.loadingText}>Thinking…</Text>}

                {!loading && phase === 'playing' && question && (
                    <View key={stepIndex}>
                        <View style={styles.questionCard}>
                            <Text style={styles.questionType}>{question.type}</Text>
                            <Text style={styles.questionLabel}>{question.label}</Text>
                        </View>
                        <View style={styles.options}>
                            {question.options.map((opt, i) => (
                                <Animated.View key={opt.value} entering={FadeInUp.delay(i * 65 + 120).duration(350)}>
                                    <Pressable style={styles.option} onPress={() => handleChoice(question.type, opt.value)}>
                                        <Text style={styles.optionLabel}>{opt.label}</Text>
                                        {opt.count > 0 && <Text style={styles.optionCount}>{opt.count}</Text>}
                                    </Pressable>
                                </Animated.View>
                            ))}
                        </View>
                    </View>
                )}

                {!loading && phase === 'results' && games && (
                    <View>
                        <Text style={styles.resultsHd}>Here's what to play</Text>
                        <View style={styles.results}>
                            {games.map((game, i) => (
                                <Animated.View key={game.appid} entering={FadeInUp.delay(i * 65 + 80).duration(350)}>
                                    <Pressable style={styles.gameRow} onPress={() => router.push(`/game/${game.appid}` as never)}>
                                        {!!apiHost && (
                                            <Image source={{ uri: `${apiHost}${game.header}` }} style={styles.gameImg} contentFit="cover" />
                                        )}
                                        <Text style={styles.gameName} numberOfLines={2}>{game.name}</Text>
                                    </Pressable>
                                </Animated.View>
                            ))}
                        </View>
                    </View>
                )}
            </ScrollView>
        </View>
    )
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    topbar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border, gap: spacing.sm },
    title: { color: colors.text, fontFamily: fonts.uiBold, fontSize: 15 },
    controls: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
    depthToggle: { flexDirection: 'row', borderWidth: 1, borderColor: colors.border, borderRadius: radius, overflow: 'hidden' },
    depthBtn: { paddingHorizontal: spacing.sm, paddingVertical: 5, borderRightWidth: 1, borderRightColor: colors.border },
    depthBtnActive: { backgroundColor: colors.bgRaised },
    depthBtnText: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 11, textTransform: 'capitalize' },
    depthBtnTextActive: { color: colors.accent, fontFamily: fonts.uiBold },
    depthBadge: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 11, textTransform: 'capitalize', borderWidth: 1, borderColor: colors.border, borderRadius: radius, paddingHorizontal: spacing.sm, paddingVertical: 3 },
    skipBtn: { borderWidth: 1, borderColor: colors.border, borderRadius: radius, paddingHorizontal: spacing.sm, paddingVertical: 5 },
    skipBtnText: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 11 },
    resetBtn: { borderWidth: 1, borderColor: colors.border, borderRadius: radius, paddingHorizontal: spacing.sm, paddingVertical: 5 },
    resetBtnText: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 11 },
    progressTrack: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: spacing.xs, paddingVertical: spacing.sm },
    pip: { width: 28, height: 3, borderRadius: 2, backgroundColor: colors.border },
    pipDone: { backgroundColor: 'rgba(201,168,76,0.45)' },
    pipActive: { backgroundColor: colors.accent },
    canvas: { flex: 1 },
    canvasContent: { padding: spacing.md, gap: spacing.sm, flexGrow: 1 },
    startCard: { alignItems: 'center', gap: spacing.md, padding: spacing.xl, backgroundColor: colors.bgRaised, borderWidth: 1, borderColor: colors.border, borderRadius: 12, marginTop: spacing.xxl, alignSelf: 'center', maxWidth: 420, width: '100%' },
    startIcon: { color: colors.accent, fontSize: 40 },
    startTitle: { color: colors.text, fontFamily: fonts.title, fontSize: 20, textAlign: 'center' },
    startDesc: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 13, textAlign: 'center', lineHeight: 19 },
    depthToggleLg: { flexDirection: 'row', borderWidth: 1, borderColor: colors.border, borderRadius: radius, overflow: 'hidden' },
    depthBtnLg: { alignItems: 'center', paddingHorizontal: spacing.md, paddingVertical: spacing.sm, gap: 2, borderRightWidth: 1, borderRightColor: colors.border },
    depthKey: { color: colors.textMuted, fontFamily: fonts.uiBold, fontSize: 12, textTransform: 'capitalize' },
    depthDesc: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 10 },
    startBtn: { backgroundColor: colors.accent, borderRadius: radius, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
    startBtnText: { color: '#131210', fontFamily: fonts.uiBold, fontSize: 14 },
    banner: { borderRadius: radius, padding: spacing.sm, alignItems: 'center' },
    bannerError: { backgroundColor: 'rgba(239,68,68,0.12)', borderWidth: 1, borderColor: 'rgba(239,68,68,0.25)' },
    bannerErrorText: { color: '#fca5a5', fontFamily: fonts.ui, fontSize: 12 },
    bannerRelaxed: { backgroundColor: colors.accentBg, borderWidth: 1, borderColor: 'rgba(201,168,76,0.3)' },
    bannerRelaxedText: { color: colors.accent, fontFamily: fonts.ui, fontSize: 12 },
    loadingText: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 13, textAlign: 'center', paddingVertical: spacing.xl },
    questionCard: { backgroundColor: colors.bgRaised, borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: spacing.md, gap: 4, marginBottom: spacing.sm },
    questionType: { color: colors.accent, fontFamily: fonts.uiBold, fontSize: 10, textTransform: 'uppercase', letterSpacing: 1 },
    questionLabel: { color: colors.text, fontFamily: fonts.title, fontSize: 16 },
    options: { gap: spacing.sm },
    option: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm, padding: spacing.md, backgroundColor: colors.bgRaised, borderWidth: 1, borderColor: colors.border, borderRadius: 8 },
    optionLabel: { flex: 1, color: colors.text, fontFamily: fonts.ui, fontSize: 14 },
    optionCount: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 12 },
    resultsHd: { color: colors.textMuted, fontFamily: fonts.uiBold, fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, marginBottom: spacing.sm },
    results: { gap: spacing.sm },
    gameRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.sm, backgroundColor: colors.bgRaised, borderWidth: 1, borderColor: colors.border, borderRadius: 8 },
    gameImg: { width: 72, height: 34, borderRadius: 4, backgroundColor: colors.bgHover },
    gameName: { flex: 1, color: colors.text, fontFamily: fonts.uiBold, fontSize: 13 },
})
