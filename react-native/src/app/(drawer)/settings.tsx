import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native'

import { getApiHost, setApiHost } from '@/api/config'
import { getFlags } from '@/api/flags'
import { getSettings, patchSettings } from '@/api/settings'
import { setCachedBlocklist } from '@/storage/discBlocklist'
import { colors, fonts, radius, spacing } from '@/theme/tokens'
import type { Settings } from 'gaming-journal-contracts/settings'

// Port of Settings.svelte (account/settings.md) — Content Filters + Wishlist sections — appended
// below this screen's PRE-EXISTING "API Host" section (Phase 0 infrastructure: the Tailscale/LAN
// address this RN app talks to). These are genuinely different concerns with no shared web
// equivalent — the web app IS the server, so it never needed a "which server" setting — but they
// share the same `/settings` drawer route, and splitting them into two differently-named drawer
// entries would be a more confusing nav than one screen with two sections. Kept as one screen.
//
// Optimistic update with rollback on every toggle (`onToggle`/`saveBlocklist` in the real
// component) — update local state immediately, PATCH, revert to the pre-change value on failure.
//
// **`hideUnavailable` inversion, replicated exactly, not "fixed"**: the UI toggle reads "Show
// Unavailable Games" but the underlying field means the opposite — checked (show unavailable = on)
// → `hideUnavailable: false`; unchecked → `hideUnavailable: true`. The real component's own
// `onToggle` special-cases this one key (`key === 'hideUnavailable' ? !checked : checked`) —
// ported that exact inversion, applied to no other setting.
//
// **Dual write for the title blocklist, replicated exactly**: every blocklist change PATCHes
// `/api/settings` AND mirrors the full list to the AsyncStorage key `disc-title-blocklist` (the RN
// equivalent of the web's `localStorage` key of the same name) via `setCachedBlocklist()` — the
// Discover screen (this phase's earlier item) reads that mirror for an instant initial filter
// state before its own settings fetch resolves, matching the real app's two-storage-writes-per-
// change design rather than simplifying to a single PATCH.
export default function SettingsScreen() {
    const [host, setHost] = useState('')
    const [hostSaved, setHostSaved] = useState(false)

    useEffect(() => { getApiHost().then(setHost) }, [])

    async function handleSaveHost() {
        await setApiHost(host)
        setHostSaved(true)
        setTimeout(() => setHostSaved(false), 1500)
    }

    const settingsQuery = useQuery({ queryKey: ['settings'], queryFn: getSettings })
    const flagsQuery = useQuery({ queryKey: ['flags'], queryFn: getFlags })

    const [settings, setSettings] = useState<Partial<Settings>>({})
    const [showBlocklist, setShowBlocklist] = useState(false)
    const [newTerm, setNewTerm] = useState('')

    useEffect(() => {
        if (settingsQuery.data) setSettings(settingsQuery.data)
    }, [settingsQuery.data])

    const flagCounts = useMemo(() => {
        const flags = Object.values(flagsQuery.data ?? {})
        return {
            childLocked: flags.filter(f => f?.childLock).length,
            filtered: flags.filter(f => f?.filtered).length,
        }
    }, [flagsQuery.data])

    async function onToggle(key: keyof Settings, checked: boolean) {
        const prev = settings[key]
        const nextValue = key === 'hideUnavailable' ? !checked : checked
        setSettings(s => ({ ...s, [key]: nextValue }))
        try {
            await patchSettings({ [key]: nextValue })
        } catch {
            setSettings(s => ({ ...s, [key]: prev }))
        }
    }

    async function saveBlocklist(list: string[]) {
        const prev = settings.titleBlocklist
        setSettings(s => ({ ...s, titleBlocklist: list }))
        try {
            await patchSettings({ titleBlocklist: list })
            await setCachedBlocklist(list)
        } catch {
            setSettings(s => ({ ...s, titleBlocklist: prev }))
        }
    }

    function addTerm() {
        const term = newTerm.trim().toLowerCase()
        if (!term) return
        saveBlocklist([...(settings.titleBlocklist ?? []), term])
        setNewTerm('')
    }

    function removeTerm(i: number) {
        saveBlocklist((settings.titleBlocklist ?? []).filter((_, idx) => idx !== i))
    }

    const blocklist = settings.titleBlocklist ?? []

    return (
        <ScrollView style={styles.container} contentContainerStyle={styles.content}>
            <Text style={styles.pageTitle}>Settings</Text>

            <View style={styles.section}>
                <Text style={styles.sectionTitle}>API Host</Text>
                <Text style={styles.sectionDesc}>
                    Tailscale hostname or LAN IP for the gaming-journal server, e.g. http://192.168.86.65:8061
                </Text>
                <TextInput
                    value={host}
                    onChangeText={setHost}
                    autoCapitalize="none"
                    autoCorrect={false}
                    placeholder="http://192.168.86.65:8061"
                    placeholderTextColor={colors.textMuted}
                    style={styles.hostInput}
                />
                <Pressable onPress={handleSaveHost} style={styles.hostSaveBtn}>
                    <Text style={styles.hostSaveBtnText}>{hostSaved ? 'Saved' : 'Save'}</Text>
                </Pressable>
            </View>

            {settingsQuery.isLoading ? (
                <Text style={styles.loadingText}>Loading settings…</Text>
            ) : settingsQuery.isError ? (
                <Text style={styles.errorText}>Failed to load settings.</Text>
            ) : (
                <>
                    <View style={styles.section}>
                        <Text style={styles.sectionTitle}>Content Filters</Text>
                        <Text style={styles.sectionDesc}>
                            Games flagged as Child Lock or Filtered are hidden from all lists by default. Toggle these on to reveal them.
                        </Text>

                        <ToggleRow
                            label="Show Child Locked Games"
                            count={flagCounts.childLocked}
                            desc="Reveal games flagged with the child lock in library, wishlist, and all other lists."
                            value={!!settings.showChildLocked}
                            onChange={(v) => onToggle('showChildLocked', v)}
                        />
                        <ToggleRow
                            label="Show Filtered Games"
                            count={flagCounts.filtered}
                            desc="Reveal games flagged as filtered (political themes, personal preference, etc.)."
                            value={!!settings.showFiltered}
                            onChange={(v) => onToggle('showFiltered', v)}
                        />
                        <ToggleRow
                            label="Enable Discovery Filters"
                            desc="Apply the title blocklist to the Discovery page and home page mosaic. Turn off to see all results unfiltered."
                            value={!!settings.discoverFiltersEnabled}
                            onChange={(v) => onToggle('discoverFiltersEnabled', v)}
                        />

                        <View style={styles.blocklistRow}>
                            <View style={styles.toggleText}>
                                <Text style={styles.toggleLabel}>
                                    Discovery Title Filter
                                    {blocklist.length > 0 && <Text style={styles.filterCount}>  {blocklist.length} term{blocklist.length === 1 ? '' : 's'}</Text>}
                                </Text>
                                <Text style={styles.toggleDesc}>Hide games whose titles contain any of these words or phrases from Discovery and the home page mosaic.</Text>
                            </View>
                            <Pressable style={styles.revealBtn} onPress={() => setShowBlocklist(v => !v)}>
                                <Text style={styles.revealBtnText}>{showBlocklist ? 'Hide' : 'Manage'}</Text>
                            </Pressable>
                        </View>

                        {showBlocklist && (
                            <View style={styles.blocklistPanel}>
                                {blocklist.length > 0 ? (
                                    <View style={styles.blocklistTags}>
                                        {blocklist.map((term, i) => (
                                            <View key={`${term}-${i}`} style={styles.blocklistTag}>
                                                <Text style={styles.blocklistTagText}>{term}</Text>
                                                <Pressable onPress={() => removeTerm(i)} hitSlop={6}>
                                                    <Text style={styles.blocklistTagRemove}>×</Text>
                                                </Pressable>
                                            </View>
                                        ))}
                                    </View>
                                ) : (
                                    <Text style={styles.blocklistEmpty}>No terms yet. Add one below.</Text>
                                )}
                                <View style={styles.blocklistAddRow}>
                                    <TextInput
                                        style={styles.blocklistInput}
                                        placeholder="Add a word or phrase…"
                                        placeholderTextColor={colors.textMuted}
                                        value={newTerm}
                                        onChangeText={setNewTerm}
                                        onSubmitEditing={addTerm}
                                        autoCapitalize="none"
                                    />
                                    <Pressable style={styles.blocklistAddBtn} onPress={addTerm}>
                                        <Text style={styles.blocklistAddBtnText}>Add</Text>
                                    </Pressable>
                                </View>
                            </View>
                        )}
                    </View>

                    <View style={styles.section}>
                        <Text style={styles.sectionTitle}>Wishlist</Text>
                        <ToggleRow
                            label="Show Unavailable Games"
                            desc="Show wishlist items that are no longer available on the Steam store."
                            value={!settings.hideUnavailable}
                            onChange={(v) => onToggle('hideUnavailable', v)}
                        />
                    </View>
                </>
            )}
        </ScrollView>
    )
}

function ToggleRow({
    label, desc, value, onChange, count,
}: {
    label: string
    desc: string
    value: boolean
    onChange: (v: boolean) => void
    count?: number
}) {
    return (
        <View style={styles.toggleRow}>
            <View style={styles.toggleText}>
                <Text style={styles.toggleLabel}>
                    {label}
                    {!!count && <Text style={styles.filterCount}>  {count} game{count === 1 ? '' : 's'}</Text>}
                </Text>
                <Text style={styles.toggleDesc}>{desc}</Text>
            </View>
            <Switch
                value={value}
                onValueChange={onChange}
                trackColor={{ false: colors.bgHover, true: colors.accentBg }}
                thumbColor={value ? colors.accent : colors.textMuted}
            />
        </View>
    )
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    content: { padding: spacing.md, gap: spacing.lg, paddingBottom: spacing.xxl },
    loadingText: { color: colors.textMuted, fontFamily: fonts.ui, padding: spacing.lg },
    errorText: { color: colors.text, fontFamily: fonts.ui, textAlign: 'center', margin: spacing.lg },
    pageTitle: { color: colors.text, fontFamily: fonts.title, fontSize: 22 },
    section: { gap: spacing.sm },
    sectionTitle: { color: colors.text, fontFamily: fonts.title, fontSize: 16 },
    sectionDesc: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 12, lineHeight: 17 },
    hostInput: { borderWidth: 1, borderColor: colors.border, borderRadius: radius, padding: spacing.sm, color: colors.text, fontFamily: fonts.ui },
    hostSaveBtn: { backgroundColor: colors.accent, borderRadius: radius, padding: spacing.sm, alignItems: 'center' },
    hostSaveBtnText: { color: colors.bg, fontFamily: fonts.uiBold },
    toggleRow: {
        flexDirection: 'row', alignItems: 'center', gap: spacing.md,
        paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border,
    },
    toggleText: { flex: 1, gap: 2 },
    toggleLabel: { color: colors.text, fontFamily: fonts.uiBold, fontSize: 13 },
    toggleDesc: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 11, lineHeight: 15 },
    filterCount: { color: colors.accent, fontFamily: fonts.ui, fontSize: 11 },
    blocklistRow: {
        flexDirection: 'row', alignItems: 'center', gap: spacing.md,
        paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border,
    },
    revealBtn: { paddingHorizontal: spacing.sm, paddingVertical: 6, borderRadius: radius, backgroundColor: colors.bgHover },
    revealBtnText: { color: colors.text, fontFamily: fonts.uiBold, fontSize: 12 },
    blocklistPanel: { gap: spacing.sm, paddingTop: spacing.xs },
    blocklistTags: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
    blocklistTag: {
        flexDirection: 'row', alignItems: 'center', gap: 6,
        backgroundColor: colors.bgHover, borderRadius: 999, paddingHorizontal: spacing.sm, paddingVertical: 4,
    },
    blocklistTagText: { color: colors.text, fontFamily: fonts.ui, fontSize: 12 },
    blocklistTagRemove: { color: colors.textMuted, fontSize: 14 },
    blocklistEmpty: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 12, fontStyle: 'italic' },
    blocklistAddRow: { flexDirection: 'row', gap: spacing.xs },
    blocklistInput: {
        flex: 1, backgroundColor: colors.bgHover, borderWidth: 1, borderColor: colors.border, borderRadius: radius,
        color: colors.text, fontFamily: fonts.ui, fontSize: 13, paddingHorizontal: spacing.sm, paddingVertical: spacing.sm,
    },
    blocklistAddBtn: { paddingHorizontal: spacing.md, justifyContent: 'center', borderRadius: radius, backgroundColor: colors.accentBg, borderWidth: 1, borderColor: colors.borderAct },
    blocklistAddBtnText: { color: colors.accent, fontFamily: fonts.uiBold, fontSize: 13 },
})
