import { useQuery } from '@tanstack/react-query'
import { router, useLocalSearchParams } from 'expo-router'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'

import { getGameDetail, getNews } from '@/api/gamePage'
import { NewsCard } from '@/components/game/News'
import { useApiHost } from '@/hooks/useApiHost'
import { colors, fonts, spacing } from '@/theme/tokens'

// Port of the /game/[appid]/news route (NewsPage.svelte) — the full list of a game's news as a grid
// of thumbnailed cards. Reuses the ['news', appid] query key so it shares the game screen's already-
// fetched cache (no refetch), and the shared NewsCard component from the game section.
export default function NewsListScreen() {
    const { appid: appidStr } = useLocalSearchParams<{ appid: string }>()
    const appid = Number(appidStr)
    const apiHost = useApiHost().data

    const newsQuery = useQuery({ queryKey: ['news', appid], queryFn: () => getNews(appid) })
    const gameQuery = useQuery({ queryKey: ['gameDetail', appid], queryFn: () => getGameDetail(appid) })
    const items = newsQuery.data?.items ?? []

    return (
        <ScrollView style={styles.container} contentContainerStyle={styles.content}>
            <View style={styles.nav}>
                <Pressable onPress={() => router.back()} hitSlop={8}>
                    <Text style={styles.backBtn}>‹ {gameQuery.data?.name ?? 'Back'}</Text>
                </Pressable>
            </View>

            <Text style={styles.title}>News{items.length ? `  ${items.length}` : ''}</Text>

            {newsQuery.isLoading ? (
                <Text style={styles.muted}>Loading news…</Text>
            ) : !items.length ? (
                <Text style={styles.muted}>No news for this game.</Text>
            ) : (
                <View style={styles.grid}>
                    {items.map((item, i) => (
                        <NewsCard key={item.gid ?? i} item={item} appid={appid} apiHost={apiHost} width="48%" />
                    ))}
                </View>
            )}
        </ScrollView>
    )
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    content: { paddingBottom: spacing.xl },
    nav: { padding: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
    backBtn: { color: colors.accent, fontFamily: fonts.uiBold, fontSize: 13 },
    title: { color: colors.text, fontFamily: fonts.title, fontSize: 22, paddingHorizontal: spacing.md, paddingTop: spacing.md, paddingBottom: spacing.sm },
    muted: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 13, padding: spacing.md },
    grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: spacing.sm, paddingHorizontal: spacing.md },
})
