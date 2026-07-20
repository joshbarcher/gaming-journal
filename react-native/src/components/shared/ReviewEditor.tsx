import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'

import { putLocalReview } from '@/api/localReview'
import { Lucide } from '@/components/shared/Lucide'
import { useReviewEditorStore } from '@/store/reviewEditorStore'
import { colors, fonts, radius, spacing } from '@/theme/tokens'
import { BADGES, PRESET_TAGS, SLIDER_KEYS, STAR_LABELS } from '@/utils/reviewConstants'

// Port of review-modal.ts's openReviewModal() — the write/edit review flow. Root-mounted (see
// store/reviewEditorStore.ts) per the standing full-screen-overlay rule.
//
// Sliders (0-10, 7 of them) are a tap-based 10-segment stepper here rather than a native <input
// type="range"> equivalent — no slider dependency exists in this app yet
// (@react-native-community/slider), and adding one for 7 fields deep inside an already-large item
// felt like its own task; a documented simplification, not a silent omission.
export function ReviewEditor() {
    const { visible, appid, existing, close } = useReviewEditorStore()
    const queryClient = useQueryClient()

    const [stars, setStars] = useState(0)
    const [sliderVals, setSliderVals] = useState<Record<string, number>>({})
    const [activeTags, setActiveTags] = useState<Set<string>>(new Set())
    const [customTags, setCustomTags] = useState<string[]>([])
    const [customInput, setCustomInput] = useState('')
    const [badgeVals, setBadgeVals] = useState<Record<string, number | boolean>>({})
    const [reviewText, setReviewText] = useState('')
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        if (!visible) return
        setStars(existing?.stars ?? 0)
        const sv: Record<string, number> = {}
        for (const { key } of SLIDER_KEYS) sv[key] = (existing?.ratings?.[key] as number) ?? 5
        setSliderVals(sv)
        const tags = existing?.tags ?? []
        setActiveTags(new Set(tags))
        setCustomTags(tags.filter(t => !PRESET_TAGS.includes(t)))
        const bv: Record<string, number | boolean> = {}
        for (const b of BADGES) bv[b.id] = existing?.badges?.[b.id] ?? (b.hasCount ? 0 : false)
        setBadgeVals(bv)
        setReviewText(existing?.review ?? '')
        setError(null)
    }, [visible, existing])

    const saveMutation = useMutation({
        mutationFn: () => {
            const ratings: Record<string, number> = {}
            for (const { key } of SLIDER_KEYS) ratings[key] = sliderVals[key]
            return putLocalReview(appid!, {
                stars, ratings, tags: [...activeTags], notes: existing?.notes ?? [],
                review: reviewText.trim(), badges: badgeVals,
            })
        },
        onSuccess: (saved) => {
            queryClient.setQueryData(['localReview', appid], saved)
            close()
        },
        onError: (err) => setError((err as Error).message),
    })

    function toggleTag(tag: string) {
        setActiveTags(prev => {
            const next = new Set(prev)
            if (next.has(tag)) next.delete(tag)
            else next.add(tag)
            return next
        })
    }

    function addCustomTag() {
        const val = customInput.trim()
        if (!val || activeTags.has(val)) { setCustomInput(''); return }
        if (!PRESET_TAGS.includes(val)) setCustomTags(t => [...t, val])
        setActiveTags(prev => new Set(prev).add(val))
        setCustomInput('')
    }

    function toggleBadge(b: typeof BADGES[number]) {
        if (b.hasCount) {
            setBadgeVals(v => ({ ...v, [b.id]: (v[b.id] as number) > 0 ? 0 : 1 }))
        } else {
            setBadgeVals(v => ({ ...v, [b.id]: !v[b.id] }))
        }
    }
    function adjustBadgeCount(id: string, delta: number) {
        setBadgeVals(v => ({ ...v, [id]: Math.max(0, (v[id] as number) + delta) }))
    }

    if (!appid) return null

    return (
        <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
            <View style={styles.backdrop}>
                <View style={styles.sheet}>
                    <View style={styles.header}>
                        <Text style={styles.headerTitle}>Write a Review</Text>
                        <Pressable onPress={close} hitSlop={8}><Text style={styles.closeBtn}>×</Text></Pressable>
                    </View>
                    <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
                        <Text style={styles.sectionLabel}>Rating</Text>
                        <View style={styles.starsRow}>
                            {Array.from({ length: 6 }, (_, i) => i + 1).map(n => (
                                <Pressable key={n} onPress={() => setStars(s => s === n ? 0 : n)} hitSlop={4}>
                                    {n === 6 ? (
                                        <Lucide name="sparkles" color={n <= stars ? colors.accent : colors.textMuted} size={24} />
                                    ) : (
                                        <Text style={[styles.starBtn, n <= stars && styles.starBtnActive]}>★</Text>
                                    )}
                                </Pressable>
                            ))}
                            <Text style={styles.starLabel}>{STAR_LABELS[stars] ?? 'Not Rated'}</Text>
                        </View>

                        <Text style={styles.sectionLabel}>Characteristics</Text>
                        {SLIDER_KEYS.map(({ key, label }) => (
                            <View key={key} style={styles.sliderRow}>
                                <Text style={styles.sliderLabel}>{label}</Text>
                                <View style={styles.sliderTrack}>
                                    {Array.from({ length: 10 }, (_, i) => i + 1).map(n => (
                                        <Pressable
                                            key={n}
                                            style={[styles.sliderSeg, n <= sliderVals[key] && styles.sliderSegActive]}
                                            onPress={() => setSliderVals(v => ({ ...v, [key]: v[key] === n ? 0 : n }))}
                                        />
                                    ))}
                                </View>
                                <Text style={styles.sliderVal}>{sliderVals[key] || '—'}</Text>
                            </View>
                        ))}

                        <Text style={styles.sectionLabel}>Badges</Text>
                        <View style={styles.badgesPicker}>
                            {BADGES.map(b => {
                                const active = b.hasCount ? (badgeVals[b.id] as number) > 0 : !!badgeVals[b.id]
                                return (
                                    <Pressable key={b.id} style={[styles.badgePick, active && { borderColor: b.color, backgroundColor: `${b.color}22` }]} onPress={() => toggleBadge(b)}>
                                        <Text style={[styles.badgePickLabel, active && { color: b.color }]}>{b.label}</Text>
                                        {b.hasCount && active && (
                                            <View style={styles.badgeCountRow}>
                                                <Pressable onPress={() => adjustBadgeCount(b.id, -1)} hitSlop={6}><Text style={styles.badgeCountBtn}>−</Text></Pressable>
                                                <Text style={styles.badgeCountVal}>{badgeVals[b.id]}</Text>
                                                <Pressable onPress={() => adjustBadgeCount(b.id, 1)} hitSlop={6}><Text style={styles.badgeCountBtn}>+</Text></Pressable>
                                            </View>
                                        )}
                                    </Pressable>
                                )
                            })}
                        </View>

                        <Text style={styles.sectionLabel}>Tags</Text>
                        <View style={styles.tagsWrap}>
                            {[...PRESET_TAGS, ...customTags].map(t => (
                                <Pressable key={t} style={[styles.tagBtn, activeTags.has(t) && styles.tagBtnActive]} onPress={() => toggleTag(t)}>
                                    <Text style={[styles.tagBtnText, activeTags.has(t) && styles.tagBtnTextActive]}>{t}</Text>
                                </Pressable>
                            ))}
                        </View>
                        <View style={styles.customTagRow}>
                            <TextInput
                                style={styles.customTagInput}
                                placeholder="Custom tag…"
                                placeholderTextColor={colors.textMuted}
                                value={customInput}
                                onChangeText={setCustomInput}
                                maxLength={40}
                                onSubmitEditing={addCustomTag}
                            />
                            <Pressable style={styles.addTagBtn} onPress={addCustomTag}><Text style={styles.addTagBtnText}>Add</Text></Pressable>
                        </View>

                        <Text style={styles.sectionLabel}>My Review</Text>
                        <TextInput
                            style={styles.textarea}
                            multiline
                            numberOfLines={8}
                            placeholder="Write your thoughts on this game…"
                            placeholderTextColor={colors.textMuted}
                            value={reviewText}
                            onChangeText={setReviewText}
                        />
                    </ScrollView>
                    <View style={styles.footer}>
                        {error && <Text style={styles.errorText}>{error}</Text>}
                        <Pressable style={styles.cancelBtn} onPress={close}><Text style={styles.cancelBtnText}>Cancel</Text></Pressable>
                        <Pressable style={styles.saveBtn} onPress={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
                            <Text style={styles.saveBtnText}>{saveMutation.isPending ? 'Saving…' : 'Save Review'}</Text>
                        </Pressable>
                    </View>
                </View>
            </View>
        </Modal>
    )
}

const styles = StyleSheet.create({
    backdrop: {
        ...StyleSheet.absoluteFill,
        ...(Platform.OS === 'web' ? { position: 'fixed' as 'absolute' } : null),
        backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end',
    },
    sheet: { backgroundColor: colors.bgRaised, borderTopLeftRadius: 12, borderTopRightRadius: 12, maxHeight: '90%' },
    header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
    headerTitle: { color: colors.text, fontFamily: fonts.title, fontSize: 16 },
    closeBtn: { color: colors.textMuted, fontSize: 24 },
    body: { paddingHorizontal: spacing.md },
    bodyContent: { paddingVertical: spacing.md, gap: spacing.xs },
    sectionLabel: { color: colors.textMuted, fontFamily: fonts.uiBold, fontSize: 11, textTransform: 'uppercase', marginTop: spacing.sm, marginBottom: spacing.xs },
    starsRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
    starBtn: { fontSize: 24, color: colors.textMuted },
    starBtnActive: { color: '#c8a84b' },
    starLabel: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 12, marginLeft: spacing.sm },
    sliderRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.xs },
    sliderLabel: { color: colors.text, fontFamily: fonts.ui, fontSize: 11, width: 90 },
    sliderTrack: { flex: 1, flexDirection: 'row', gap: 2 },
    sliderSeg: { flex: 1, height: 14, backgroundColor: colors.bgHover, borderRadius: 2 },
    sliderSegActive: { backgroundColor: '#c8a84b' },
    sliderVal: { color: colors.textMuted, fontFamily: fonts.uiBold, fontSize: 11, width: 20, textAlign: 'right' },
    badgesPicker: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
    badgePick: { borderWidth: 1, borderColor: colors.border, borderRadius: radius, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, gap: 4 },
    badgePickLabel: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 11 },
    badgeCountRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, justifyContent: 'center' },
    badgeCountBtn: { color: colors.text, fontSize: 14, paddingHorizontal: 4 },
    badgeCountVal: { color: colors.text, fontFamily: fonts.uiBold, fontSize: 12 },
    tagsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    tagBtn: { borderWidth: 1, borderColor: colors.border, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
    tagBtnActive: { borderColor: '#c8a84b', backgroundColor: 'rgba(200,168,75,0.12)' },
    tagBtnText: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 11 },
    tagBtnTextActive: { color: '#c8a84b' },
    customTagRow: { flexDirection: 'row', gap: spacing.xs, marginTop: spacing.xs },
    customTagInput: { flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: radius, paddingHorizontal: spacing.sm, paddingVertical: 6, color: colors.text, fontFamily: fonts.ui, fontSize: 12 },
    addTagBtn: { backgroundColor: colors.bgHover, borderRadius: radius, paddingHorizontal: spacing.sm, justifyContent: 'center' },
    addTagBtnText: { color: colors.text, fontFamily: fonts.uiBold, fontSize: 12 },
    textarea: { borderWidth: 1, borderColor: colors.border, borderRadius: radius, padding: spacing.sm, color: colors.text, fontFamily: fonts.ui, fontSize: 13, minHeight: 120, textAlignVertical: 'top' },
    footer: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, borderTopWidth: 1, borderTopColor: colors.border },
    errorText: { color: '#e05050', fontFamily: fonts.ui, fontSize: 11, flex: 1 },
    cancelBtn: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius, backgroundColor: colors.bgHover },
    cancelBtnText: { color: colors.text, fontFamily: fonts.ui, fontSize: 13 },
    saveBtn: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius, backgroundColor: '#c8a84b' },
    saveBtnText: { color: '#1a1208', fontFamily: fonts.uiBold, fontSize: 13 },
})
