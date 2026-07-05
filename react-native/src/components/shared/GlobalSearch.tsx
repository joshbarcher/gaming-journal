import { useQuery } from '@tanstack/react-query'
import { Image } from 'expo-image'
import { useRouter } from 'expo-router'
import { useEffect, useState } from 'react'
import {
    ActivityIndicator,
    FlatList,
    Modal,
    Pressable,
    StyleSheet,
    Text,
    TextInput,
    useWindowDimensions,
    View,
} from 'react-native'

import { searchGames } from '@/api/discover'
import { useGlobalSearchStore } from '@/store/globalSearchStore'
import { colors, fonts, radius, spacing } from '@/theme/tokens'

// Touch redesign of global/global-search.md — see globalSearchStore.ts for what changed and why.
export function GlobalSearchHost() {
    const { open, setOpen } = useGlobalSearchStore()
    const router = useRouter()
    const { height: windowHeight } = useWindowDimensions()
    const [query, setQuery] = useState('')
    const [debounced, setDebounced] = useState('')

    useEffect(() => {
        const timer = setTimeout(() => setDebounced(query), 200) // matches web's 200ms debounce
        return () => clearTimeout(timer)
    }, [query])

    useEffect(() => {
        if (!open) { setQuery(''); setDebounced('') } // no search history — matches web (Gotchas)
    }, [open])

    const searchQuery = useQuery({
        queryKey: ['globalSearch', debounced],
        queryFn:  () => searchGames(debounced),
        enabled:  debounced.trim().length >= 2, // matches web's 2-char minimum
    })

    function selectResult(appid: number) {
        setOpen(false)
        router.push(`/game/${appid}` as never)
    }

    return (
        <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
            <Pressable style={styles.scrim} onPress={() => setOpen(false)}>
                <Pressable
                    style={[styles.box, { maxHeight: windowHeight - spacing.xxl - spacing.md }]}
                    onPress={() => {}}
                >
                    <View style={styles.inputRow}>
                        <TextInput
                            autoFocus
                            value={query}
                            onChangeText={setQuery}
                            placeholder="Search games…"
                            placeholderTextColor={colors.textMuted}
                            style={styles.input}
                        />
                        {searchQuery.isFetching && <ActivityIndicator size="small" color={colors.accent} />}
                        {query.length > 0 && (
                            <Pressable onPress={() => setQuery('')} hitSlop={8}>
                                <Text style={styles.clearButton}>×</Text>
                            </Pressable>
                        )}
                    </View>

                    <FlatList
                        data={searchQuery.data ?? []}
                        keyExtractor={(item) => String(item.appid)}
                        keyboardShouldPersistTaps="handled"
                        renderItem={({ item }) => (
                            <Pressable style={styles.result} onPress={() => selectResult(item.appid)}>
                                {item.headerImage && (
                                    <Image source={{ uri: item.headerImage }} style={styles.resultImage} contentFit="cover" />
                                )}
                                <Text style={styles.resultText} numberOfLines={1}>{item.name}</Text>
                            </Pressable>
                        )}
                    />
                </Pressable>
            </Pressable>
        </Modal>
    )
}

const styles = StyleSheet.create({
    scrim: {
        flex:            1,
        backgroundColor: 'rgba(0, 0, 0, 0.7)',
        paddingTop:      spacing.xxl,
        paddingHorizontal: spacing.md,
    },
    box: {
        // maxHeight set inline per-window-height above — a raw '80%' isn't reliable inside a web
        // Modal (found via the screenshot-first recipe: the box overflowed a short landscape
        // viewport and the page behind it showed through beneath the box).
        backgroundColor: colors.bgRaised,
        borderWidth:     1,
        borderColor:     colors.border,
        borderRadius:    radius,
        overflow:        'hidden',
    },
    inputRow: {
        flexDirection:     'row',
        alignItems:        'center',
        gap:               spacing.sm,
        padding:           spacing.md,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
    },
    input: {
        flex:       1,
        color:      colors.text,
        fontFamily: fonts.ui,
        fontSize:   15,
    },
    clearButton: {
        color:    colors.textMuted,
        fontSize: 20,
    },
    result: {
        flexDirection:  'row',
        alignItems:     'center',
        gap:            spacing.sm,
        paddingVertical:   spacing.sm,
        paddingHorizontal: spacing.md,
    },
    resultImage: {
        width:           64,
        height:          30,
        borderRadius:    radius,
        backgroundColor: colors.bgHover,
    },
    resultText: {
        flex:       1,
        color:      colors.text,
        fontFamily: fonts.ui,
        fontSize:   14,
    },
})
