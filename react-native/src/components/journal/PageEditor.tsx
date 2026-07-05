import { useMutation } from '@tanstack/react-query'
import { router } from 'expo-router'
import { useEffect, useRef, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'

import { updatePage } from '@/api/journal'
import { colors, fonts, radius, spacing } from '@/theme/tokens'
import { newBlock, parseBlocksFromHtml, serializeBlocksToHtml, type PageBlock } from '@/utils/pageBlocks'
import type { Page } from 'gaming-journal-contracts/pages'

// Port of PageEditor.svelte — but as a genuinely different editing model, not a port of its
// contenteditable + document.execCommand() mechanism (no RN equivalent exists for either). See
// utils/pageBlocks.ts for the real-data-informed reasoning. Bold/italic/underline/font-size/
// font-family are dropped entirely — the toolbar for those simply has no RN counterpart — this is
// the expected, documented cost of "no contenteditable," not a bug.
export function PageEditor({ page, appid }: { page: Page; appid: number }) {
    const [title, setTitle] = useState(page.title ?? '')
    const [blocks, setBlocks] = useState<PageBlock[]>(() => parseBlocksFromHtml(page.content))
    const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
    // Guards against a real bug caught during verification: `blocks` is initialized directly from
    // the loaded page (parseBlocksFromHtml), so the save-effect below would otherwise fire once on
    // mount too — silently re-writing the exact same content back (bumping `updatedAt`) on every
    // page open, even a read-only visit, not just on a genuine edit. Skip the first run.
    const isFirstRender = useRef(true)

    const titleMutation = useMutation({ mutationFn: (t: string) => updatePage(page.id, { title: t }) })
    const contentMutation = useMutation({ mutationFn: (content: string) => updatePage(page.id, { content }) })

    useEffect(() => {
        if (isFirstRender.current) { isFirstRender.current = false; return }
        if (saveTimer.current) clearTimeout(saveTimer.current)
        saveTimer.current = setTimeout(() => {
            contentMutation.mutate(serializeBlocksToHtml(blocks))
        }, 600)
        return () => { if (saveTimer.current) clearTimeout(saveTimer.current) }
        // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-arm the debounce when blocks actually change
    }, [blocks])

    function onTitleBlur() {
        const t = title.trim()
        if (!t || t === page.title) { setTitle(page.title ?? ''); return }
        titleMutation.mutate(t)
    }

    function updateBlock(id: string, text: string) {
        setBlocks(bs => bs.map(b => b.id === id ? { ...b, text } : b))
    }
    function removeBlock(id: string) {
        setBlocks(bs => bs.filter(b => b.id !== id))
    }
    function moveBlock(id: string, dir: -1 | 1) {
        setBlocks(bs => {
            const idx = bs.findIndex(b => b.id === id)
            const target = idx + dir
            if (idx === -1 || target < 0 || target >= bs.length) return bs
            const next = [...bs]
            ;[next[idx], next[target]] = [next[target], next[idx]]
            return next
        })
    }
    function addBlock(type: PageBlock['type']) {
        setBlocks(bs => [...bs, newBlock(type)])
    }

    return (
        <ScrollView style={styles.container}>
            <View style={styles.header}>
                <Pressable onPress={() => router.push(`/journal/${appid}/pages` as never)}>
                    <Text style={styles.breadcrumb}>Home / Journal / Pages / <Text style={styles.breadcrumbCurrent}>{page.title}</Text></Text>
                </Pressable>
                <TextInput
                    style={styles.titleInput}
                    value={title}
                    onChangeText={setTitle}
                    onBlur={onTitleBlur}
                    placeholder="Page title"
                    placeholderTextColor={colors.textMuted}
                />
                <Text style={styles.subtitle}>Page · Structured Text</Text>
            </View>

            <View style={styles.blocks}>
                {blocks.map((b, i) => (
                    <View key={b.id} style={styles.blockRow}>
                        <View style={styles.blockControls}>
                            <Pressable onPress={() => moveBlock(b.id, -1)} disabled={i === 0} hitSlop={6}>
                                <Text style={[styles.controlBtn, i === 0 && styles.controlBtnDisabled]}>↑</Text>
                            </Pressable>
                            <Pressable onPress={() => moveBlock(b.id, 1)} disabled={i === blocks.length - 1} hitSlop={6}>
                                <Text style={[styles.controlBtn, i === blocks.length - 1 && styles.controlBtnDisabled]}>↓</Text>
                            </Pressable>
                            <Pressable onPress={() => removeBlock(b.id)} hitSlop={6}>
                                <Text style={styles.removeBtn}>×</Text>
                            </Pressable>
                        </View>
                        {b.type === 'listItem' && <Text style={styles.bullet}>•</Text>}
                        <BlockTextInput
                            block={b}
                            onChangeText={(t) => updateBlock(b.id, t)}
                        />
                    </View>
                ))}
            </View>

            <View style={styles.addRow}>
                <Pressable style={styles.addBtn} onPress={() => addBlock('paragraph')}>
                    <Text style={styles.addBtnText}>+ Paragraph</Text>
                </Pressable>
                <Pressable style={styles.addBtn} onPress={() => addBlock('heading')}>
                    <Text style={styles.addBtnText}>+ Heading</Text>
                </Pressable>
                <Pressable style={styles.addBtn} onPress={() => addBlock('listItem')}>
                    <Text style={styles.addBtnText}>+ List Item</Text>
                </Pressable>
            </View>
        </ScrollView>
    )
}

// Real bug caught during verification: a plain multiline TextInput doesn't auto-grow on RN Web —
// it renders as a small fixed-height scrollable box, so a long real paragraph (one saved page's
// content was 3960 characters as a single block) visually looked "cut off" to just its first line
// even though the underlying value was correctly parsed in full (confirmed via the DOM: `value`
// held all 3960 characters while `clientHeight` stayed pinned at 40px against a `scrollHeight` of
// 1000px). Fixed with the standard RN auto-grow pattern: track each block's measured content
// height via `onContentSizeChange` and apply it as an explicit style height.
function BlockTextInput({ block, onChangeText }: { block: PageBlock; onChangeText: (text: string) => void }) {
    const [height, setHeight] = useState(24)
    return (
        <TextInput
            style={[
                styles.blockInput,
                block.type === 'heading' && styles.headingInput,
                block.type === 'paragraph' && { height: Math.max(24, height) },
            ]}
            value={block.text}
            onChangeText={onChangeText}
            onContentSizeChange={(e) => setHeight(e.nativeEvent.contentSize.height)}
            multiline={block.type === 'paragraph'}
            placeholder={block.type === 'heading' ? 'Heading' : block.type === 'listItem' ? 'List item' : 'Write something…'}
            placeholderTextColor={colors.textMuted}
        />
    )
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    header: { padding: spacing.md, gap: 4 },
    breadcrumb: { color: 'rgba(237,233,223,0.5)', fontFamily: fonts.ui, fontSize: 11 },
    breadcrumbCurrent: { color: 'rgba(237,233,223,0.85)' },
    titleInput: { color: colors.text, fontFamily: fonts.title, fontSize: 22, paddingVertical: 4 },
    subtitle: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 12 },
    blocks: { paddingHorizontal: spacing.md, gap: spacing.sm },
    blockRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.xs, backgroundColor: colors.bgRaised, borderWidth: 1, borderColor: colors.border, borderRadius: radius, padding: spacing.sm },
    blockControls: { gap: 4, alignItems: 'center' },
    controlBtn: { color: colors.textMuted, fontSize: 14, paddingHorizontal: 2 },
    controlBtnDisabled: { opacity: 0.25 },
    removeBtn: { color: colors.textMuted, fontSize: 16, paddingHorizontal: 2 },
    bullet: { color: colors.textMuted, fontSize: 16, marginTop: 4 },
    blockInput: { flex: 1, color: colors.text, fontFamily: fonts.ui, fontSize: 14, lineHeight: 20, minHeight: 24 },
    headingInput: { fontFamily: fonts.uiBold, fontSize: 18 },
    addRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, padding: spacing.md },
    addBtn: { backgroundColor: colors.bgHover, borderRadius: radius, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs },
    addBtnText: { color: colors.text, fontFamily: fonts.uiBold, fontSize: 12 },
})
