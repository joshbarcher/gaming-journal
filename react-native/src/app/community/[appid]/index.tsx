import { useIsFocused, useLocalSearchParams, router } from 'expo-router'
import { useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, FlatList, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'

import { getReddit, addLinkedSubreddit, startRedditSync, subscribeRedditSyncProgress, validateSubreddit } from '@/api/community'
import { loadPrefs, toggleFavorite, toggleFilter, toggleHighlight, toggleMute, type LoadedPrefs } from '@/api/communityPrefs'
import { getGameDetail } from '@/api/gamePage'
import { getPin, pinGame, unpinGame } from '@/api/pin'
import { PinBadge } from '@/components/community/PinBadge'
import { PostCard } from '@/components/community/PostCard'
import { useApiHost } from '@/hooks/useApiHost'
import { colors, fonts, radius, spacing } from '@/theme/tokens'
import type { PinState } from 'gaming-journal-contracts/pin'
import type { RedditPost } from 'gaming-journal-contracts/reddit'

const PAGE_SIZE = 25
const PIN_POLL_MS = 60_000

type Source = { id: string; label: string; posts: RedditPost[] }

// Port of CommunityPage.svelte (community/community.md). Per-source tabs merged/deduped into an
// "All" tab, client-side pagination (Load More → FlatList onEndReached, the RN-idiomatic
// equivalent of the web's IntersectionObserver sentinel), long-press prefs menu, pin badge.
//
// **`hasUpdate` poll is a faithful no-op, not a bug**: the real `/relay/api/reddit/{appid}`
// response has no `mergedAt` field at all (confirmed live) even though CommunityPage.svelte's own
// `_poll()` compares against `data.mergedAt` — so `hasUpdate` can never actually become true
// against the real endpoint. Ported the comparison exactly rather than "fixing" it to use
// `fetchedAt` instead, since that would be a behavior change beyond what the real, current web app
// does (see contracts/reddit.ts's note).
//
// **Add Subreddit modal is a plain absolutely-positioned sibling View, not RN's `<Modal>`**, same
// non-Modal-overlay pattern as ScreenshotLightboxHost/ReviewEditor — but NOT root-mounted via a
// global store like those, since (checked directly) the real web has no separate
// "AddSubredditModal" component either: the whole form lives inline inside CommunityPage.svelte
// itself, single-screen-scoped. Kept that same scoping here rather than inventing a new global
// host for a dialog nothing else in the app needs to open.
export default function CommunityScreen() {
    const { appid: appidStr } = useLocalSearchParams<{ appid: string }>()
    const appid = Number(appidStr)
    const apiHostQuery = useApiHost()
    const apiHost = apiHostQuery.data
    const isFocused = useIsFocused()

    const [gameName, setGameName] = useState<string | null>(null)
    const [sources, setSources] = useState<Source[]>([])
    const [prefs, setPrefs] = useState<LoadedPrefs>({ filtered: new Set(), muted: new Set(), favorited: new Set(), highlighted: new Set() })
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [activeTab, setActiveTab] = useState('__all__')
    const [shownCounts, setShownCounts] = useState<Record<string, number>>({})

    const [pin, setPin] = useState<PinState | null>(null)
    const [hasUpdate, setHasUpdate] = useState(false)
    const [reloadKey, setReloadKey] = useState(0)
    const loadedMergedAtRef = useRef<string | null>(null)

    type PendingSub = { name: string; status: string; error: boolean }
    const [pendingSub, setPendingSub] = useState<PendingSub | null>(null)
    const [showModal, setShowModal] = useState(false)
    const [modalInput, setModalInput] = useState('')
    const [modalStatus, setModalStatus] = useState('')
    const [modalStatusType, setModalStatusType] = useState<'idle' | 'loading' | 'valid' | 'invalid'>('idle')
    const [modalValidName, setModalValidName] = useState<string | null>(null)
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

    useEffect(() => {
        let cancelled = false
        async function load() {
            setLoading(true); setError(null)
            try {
                const [game, redditData, pinState] = await Promise.all([
                    getGameDetail(appid),
                    getReddit(appid),
                    getPin(),
                ])
                if (cancelled) return
                setGameName(game.name ?? null)
                setPin(pinState)
                loadedMergedAtRef.current = redditData.mergedAt ?? null
                setSources(
                    redditData.sources
                        .filter(s => s.posts.length > 0)
                        .map(s => ({ id: s.subreddit, label: `r/${s.subreddit}`, posts: s.posts })),
                )
                setPrefs(await loadPrefs(appid))
            } catch (err) {
                if (!cancelled) setError((err as Error).message)
            } finally {
                if (!cancelled) setLoading(false)
            }
        }
        load()
        return () => { cancelled = true }
    }, [appid, reloadKey])

    const isPinned = pin !== null && pin.appid === appid
    const isLive = isPinned && pin?.reason === 'playing' && pin?.sessionEndedAt === null
    const isGrace = isPinned && pin?.reason === 'playing' && pin?.sessionEndedAt !== null

    // Pin + content-update poll (focus-scoped). Ported verbatim from CommunityPage.svelte's
    // _poll(): always refresh pin; if this game is pinned, also re-fetch reddit data and compare
    // mergedAt. See the file-level note — mergedAt is never actually present live, so this branch
    // is a faithfully-ported no-op, not a missing feature.
    const isPinnedRef = useRef(isPinned)
    isPinnedRef.current = isPinned
    useEffect(() => {
        if (!isFocused) return
        async function poll() {
            let nextPin: PinState | null = null
            try { nextPin = await getPin(); setPin(nextPin) } catch { /* silent */ }
            if (!isPinnedRef.current) return
            try {
                const data = await getReddit(appid)
                const freshMergedAt = data.mergedAt ?? null
                if (freshMergedAt && freshMergedAt !== loadedMergedAtRef.current) setHasUpdate(true)
            } catch { /* silent */ }
        }
        const t = setInterval(poll, PIN_POLL_MS)
        return () => clearInterval(t)
    }, [isFocused, appid])

    const allSource: Source = useMemo(() => {
        const seen = new Set<string>()
        const posts: RedditPost[] = []
        for (const s of sources) for (const p of s.posts) if (!seen.has(p.id)) { seen.add(p.id); posts.push(p) }
        posts.sort((a, b) => (b.createdUtc ?? 0) - (a.createdUtc ?? 0))
        return { id: '__all__', label: 'All', posts }
    }, [sources])

    const displaySources = useMemo(() => [allSource, ...sources], [allSource, sources])
    const totalPosts = useMemo(() => sources.reduce((n, s) => n + s.posts.length, 0), [sources])

    async function handlePin() {
        if (!gameName) return
        if (isPinned) {
            await unpinGame()
            setPin(null)
        } else {
            setPin(await pinGame(appid, gameName))
        }
    }

    function setPrefLocal(key: keyof LoadedPrefs, username: string, value: boolean) {
        setPrefs(prev => {
            const s = new Set(prev[key])
            value ? s.add(username) : s.delete(username)
            return { ...prev, [key]: s }
        })
    }
    const onToggleFilter = (u: string) => { setPrefLocal('filtered', u, !prefs.filtered.has(u)); toggleFilter(u).catch(() => {}) }
    const onToggleMute = (u: string) => { setPrefLocal('muted', u, !prefs.muted.has(u)); toggleMute(u).catch(() => {}) }
    const onToggleFavorite = (u: string) => { setPrefLocal('favorited', u, !prefs.favorited.has(u)); toggleFavorite(u).catch(() => {}) }
    const onToggleHighlight = (u: string) => { setPrefLocal('highlighted', u, !prefs.highlighted.has(u)); toggleHighlight(appid, u).catch(() => {}) }

    const activeSource = displaySources.find(s => s.id === activeTab) ?? allSource
    const shown = shownCounts[activeTab] ?? PAGE_SIZE
    const visiblePosts = activeSource.posts.slice(0, shown)
    const hasMore = activeSource.posts.length > shown

    function loadMore() {
        setShownCounts(prev => ({ ...prev, [activeTab]: (prev[activeTab] ?? PAGE_SIZE) + PAGE_SIZE }))
    }

    // ── Add-subreddit modal ──────────────────────────────────────────────────────────────────────
    function openModal() {
        setModalInput(''); setModalStatus(''); setModalStatusType('idle'); setModalValidName(null)
        setShowModal(true)
    }

    function handleModalInput(raw: string) {
        setModalInput(raw)
        if (debounceRef.current) clearTimeout(debounceRef.current)
        setModalValidName(null)
        const val = raw.trim().replace(/^r\//i, '')
        if (!val) { setModalStatus(''); setModalStatusType('idle'); return }
        setModalStatus('…'); setModalStatusType('loading')
        debounceRef.current = setTimeout(async () => {
            try {
                const data = await validateSubreddit(val)
                if (data.valid) {
                    setModalValidName(data.name ?? val)
                    setModalStatus(`✓ ${data.name} · ${(data.subscribers ?? 0).toLocaleString()} members`)
                    setModalStatusType('valid')
                } else {
                    setModalStatus('✗ Not found'); setModalStatusType('invalid')
                }
            } catch {
                setModalStatus('✗ Check failed'); setModalStatusType('invalid')
            }
        }, 600)
    }

    function doAddSub() {
        if (!modalValidName) return
        const name = modalValidName
        setShowModal(false)
        addSubreddit(name)
    }

    async function addSubreddit(name: string) {
        await addLinkedSubreddit(appid, name).catch(() => {})
        setPendingSub({ name, status: 'Starting sync…', error: false })
        setActiveTab('__pending__')

        try {
            for (let attempt = 0; attempt < 15; attempt++) {
                const { status } = await startRedditSync(appid, gameName ?? '').catch(() => ({ status: 0 }))
                if (status !== 409) break
                setPendingSub(p => p ? { ...p, status: 'Waiting for another sync to finish…' } : p)
                await new Promise(r => setTimeout(r, 4_000))
            }

            await new Promise<void>((resolve) => {
                const fallback = setTimeout(() => { unsub(); resolve() }, 90_000)
                const unsub = subscribeRedditSyncProgress(appid, {
                    onEvent: (ev) => {
                        if (ev.type === 'status') setPendingSub(p => p ? { ...p, status: ev.message } : p)
                        if (ev.type === 'done') { clearTimeout(fallback); unsub(); resolve() }
                    },
                    onError: () => { clearTimeout(fallback); unsub(); resolve() },
                })
            })

            const data = await getReddit(appid).catch(() => null)
            const source = data?.sources?.find(s => s.subreddit.toLowerCase() === name.toLowerCase()) ?? null
            const posts = source?.posts ?? []
            const newSource: Source = { id: source?.subreddit ?? name, label: `r/${source?.subreddit ?? name}`, posts }
            setSources(prev => [...prev, newSource])
            setActiveTab(newSource.id)
            setPendingSub(null)
        } catch {
            setPendingSub(p => p ? { ...p, error: true, status: 'Failed to fetch posts.' } : p)
        }
    }

    if (loading) {
        return <View style={styles.container}><ActivityIndicator color={colors.accent} /></View>
    }
    if (error) {
        return <View style={styles.container}><Text style={styles.errorText}>Failed to load: {error}</Text></View>
    }

    return (
        <View style={styles.container}>
            <View style={styles.header}>
                <Pressable onPress={() => router.back()} hitSlop={8}><Text style={styles.backBtn}>‹ Back</Text></Pressable>
                <View style={styles.headerBody}>
                    <Text style={styles.title} numberOfLines={1}>{gameName ?? ''}</Text>
                    <Text style={styles.subtitle}>{totalPosts} post{totalPosts !== 1 ? 's' : ''} from Reddit</Text>
                </View>
                <PinBadge isPinned={isPinned} isLive={!!isLive} isGrace={!!isGrace} pin={pin} onToggle={handlePin} />
            </View>

            {sources.length === 0 && !pendingSub ? (
                <View style={styles.empty}>
                    <Text style={styles.emptyText}>No community posts found for this game.</Text>
                    <Pressable style={styles.manageBtn} onPress={openModal}>
                        <Text style={styles.manageBtnText}>⚙ Manage Subreddits</Text>
                    </Pressable>
                </View>
            ) : (
                <>
                    <View style={styles.tabsBar}>
                        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabsRow}>
                            {displaySources.map(src => (
                                <Pressable key={src.id} style={[styles.tab, activeTab === src.id && styles.tabActive]} onPress={() => setActiveTab(src.id)}>
                                    <Text style={[styles.tabText, activeTab === src.id && styles.tabTextActive]}>{src.label}</Text>
                                    <Text style={styles.tabCount}>{src.posts.length}</Text>
                                </Pressable>
                            ))}
                            {pendingSub && (
                                <View style={[styles.tab, styles.tabLoading]}>
                                    <Text style={styles.tabText}>r/{pendingSub.name}</Text>
                                    <ActivityIndicator size="small" color={colors.textMuted} />
                                </View>
                            )}
                        </ScrollView>
                        <Pressable style={styles.manageToggle} onPress={openModal}><Text style={styles.manageToggleText}>⚙</Text></Pressable>
                    </View>

                    {activeTab === '__pending__' && pendingSub ? (
                        <View style={styles.pendingWrap}>
                            {pendingSub.error ? (
                                <Text style={styles.emptyText}>Failed to fetch posts.</Text>
                            ) : (
                                <>
                                    <ActivityIndicator color={colors.accent} />
                                    <Text style={styles.pendingStatus}>{pendingSub.status}</Text>
                                </>
                            )}
                        </View>
                    ) : (
                        <FlatList
                            data={visiblePosts}
                            keyExtractor={(p) => p.id}
                            renderItem={({ item }) => (
                                <PostCard
                                    post={item} appid={appid} prefs={prefs} apiHost={apiHost}
                                    onToggleFilter={onToggleFilter} onToggleMute={onToggleMute}
                                    onToggleHighlight={onToggleHighlight} onToggleFavorite={onToggleFavorite}
                                />
                            )}
                            onEndReachedThreshold={0.4}
                            onEndReached={() => hasMore && loadMore()}
                            ListEmptyComponent={<Text style={styles.emptyText}>No posts.</Text>}
                            // Perf pass: this list grows unbounded via "Load more" (25 posts/page,
                            // no cap) — tuned windowing so a long browsing session doesn't keep
                            // hundreds of post-card images mounted at once.
                            initialNumToRender={10}
                            maxToRenderPerBatch={10}
                            windowSize={7}
                            removeClippedSubviews
                        />
                    )}
                </>
            )}

            {hasUpdate && (
                <View style={styles.updateBanner}>
                    <Text style={styles.updateBannerText}>New community posts available</Text>
                    <Pressable onPress={() => { setHasUpdate(false); setReloadKey(k => k + 1) }}>
                        <Text style={styles.updateRefresh}>Refresh</Text>
                    </Pressable>
                    <Pressable onPress={() => setHasUpdate(false)} hitSlop={8}><Text style={styles.updateDismiss}>×</Text></Pressable>
                </View>
            )}

            {showModal && (
                <View style={styles.modalBackdrop}>
                    <Pressable style={StyleSheet.absoluteFill} onPress={() => setShowModal(false)} />
                    <View style={styles.modalDialog}>
                        <View style={styles.modalHeader}>
                            <Text style={styles.modalLabel}>Add Subreddit</Text>
                            <Pressable onPress={() => setShowModal(false)}><Text style={styles.modalClose}>×</Text></Pressable>
                        </View>
                        <View style={styles.modalAddRow}>
                            <Text style={styles.modalPrefix}>r/</Text>
                            <TextInput
                                style={styles.modalInput}
                                placeholder="subreddit name"
                                placeholderTextColor={colors.textMuted}
                                autoCapitalize="none"
                                autoCorrect={false}
                                value={modalInput}
                                onChangeText={handleModalInput}
                            />
                            <Pressable style={[styles.modalAddBtn, !modalValidName && styles.modalAddBtnDisabled]} disabled={!modalValidName} onPress={doAddSub}>
                                <Text style={styles.modalAddBtnText}>Add</Text>
                            </Pressable>
                        </View>
                        {!!modalStatus && (
                            <Text style={[
                                styles.modalStatus,
                                modalStatusType === 'valid' && styles.modalStatusValid,
                                modalStatusType === 'invalid' && styles.modalStatusInvalid,
                            ]}>{modalStatus}</Text>
                        )}
                    </View>
                </View>
            )}
        </View>
    )
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    errorText: { color: colors.text, fontFamily: fonts.ui, textAlign: 'center', margin: spacing.lg },
    header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
    backBtn: { color: colors.accent, fontFamily: fonts.uiBold, fontSize: 13 },
    headerBody: { flex: 1, minWidth: 0 },
    title: { color: colors.text, fontFamily: fonts.title, fontSize: 16 },
    subtitle: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 11 },
    empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md, padding: spacing.xl },
    emptyText: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 13, textAlign: 'center', padding: spacing.lg },
    manageBtn: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius, backgroundColor: colors.bgHover },
    manageBtnText: { color: colors.text, fontFamily: fonts.ui, fontSize: 12 },
    tabsBar: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: colors.border },
    tabsRow: { gap: 4, paddingHorizontal: spacing.sm, paddingVertical: 6 },
    tab: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: spacing.sm, paddingVertical: 6, borderRadius: radius },
    tabActive: { backgroundColor: colors.bgHover },
    tabLoading: { opacity: 0.6 },
    tabText: { color: colors.textMuted, fontFamily: fonts.uiBold, fontSize: 11 },
    tabTextActive: { color: colors.text },
    tabCount: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 9, backgroundColor: colors.bg, paddingHorizontal: 4, borderRadius: 4 },
    manageToggle: { paddingHorizontal: spacing.sm },
    manageToggleText: { color: colors.textMuted, fontSize: 14 },
    pendingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
    pendingStatus: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 12 },
    updateBanner: {
        position: 'absolute', bottom: spacing.md, left: spacing.md, right: spacing.md,
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        backgroundColor: colors.bgRaised, borderWidth: 1, borderColor: colors.borderAct,
        borderRadius: radius, padding: spacing.sm,
    },
    updateBannerText: { color: colors.text, fontFamily: fonts.ui, fontSize: 12, flex: 1 },
    updateRefresh: { color: colors.accent, fontFamily: fonts.uiBold, fontSize: 12, marginRight: spacing.sm },
    updateDismiss: { color: colors.textMuted, fontSize: 16, paddingHorizontal: spacing.xs },
    modalBackdrop: {
        ...StyleSheet.absoluteFill,
        backgroundColor: 'rgba(0,0,0,0.75)', alignItems: 'center', justifyContent: 'center', padding: spacing.md,
    },
    modalDialog: { width: '100%', maxWidth: 420, backgroundColor: colors.bgRaised, borderRadius: radius, borderWidth: 1, borderColor: colors.border, padding: spacing.md },
    modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.sm },
    modalLabel: { color: colors.text, fontFamily: fonts.uiBold, fontSize: 14 },
    modalClose: { color: colors.textMuted, fontSize: 18 },
    modalAddRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, borderWidth: 1, borderColor: colors.border, borderRadius: radius, paddingHorizontal: spacing.sm },
    modalPrefix: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 13 },
    modalInput: { flex: 1, color: colors.text, fontFamily: fonts.ui, fontSize: 13, paddingVertical: spacing.sm },
    modalAddBtn: { paddingHorizontal: spacing.sm, paddingVertical: 6, borderRadius: radius, backgroundColor: colors.accentBg },
    modalAddBtnDisabled: { opacity: 0.4 },
    modalAddBtnText: { color: colors.accent, fontFamily: fonts.uiBold, fontSize: 12 },
    modalStatus: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 11, marginTop: spacing.xs },
    modalStatusValid: { color: '#7edb8a' },
    modalStatusInvalid: { color: '#e05d5d' },
})
