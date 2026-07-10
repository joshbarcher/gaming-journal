import { Linking, Pressable, StyleSheet, Text, View } from 'react-native'
import { useState } from 'react'

import { colors, fonts, radius, spacing } from '@/theme/tokens'
import { stripHtml } from '@/utils/gameRender'
import type { Pcgw } from 'gaming-journal-contracts/pcgw'

// Port of PCGW.svelte. Renders only if pcgwData?.found. badge() semantics ported exactly: "true"→
// Yes, "false"→No, "hackable"→Hackable, "limited"→Limited, and any other free text (e.g.
// "always on") is shown verbatim. Dropping unrecognised values used to hide the whole row, taking
// its notes with it — which is where PCGW puts the detail that matters.
type VideoKey = Exclude<keyof NonNullable<Pcgw['video']>, 'notes'>

const VIDEO_FEATURES: { key: VideoKey; label: string }[] = [
    { key: 'widescreen', label: 'Widescreen' }, { key: 'ultrawide', label: 'Ultrawide' },
    { key: 'uhd4k', label: '4K UHD' }, { key: 'hdr', label: 'HDR' },
    { key: 'fps60', label: '60 FPS' }, { key: 'fps120', label: '120 FPS' },
    { key: 'vsync', label: 'VSync' }, { key: 'aa', label: 'Anti-aliasing' }, { key: 'af', label: 'Anisotropic' },
    { key: 'fov', label: 'FOV' }, { key: 'rayTracing', label: 'Ray Tracing' }, { key: 'frameGen', label: 'Frame Gen' },
    { key: 'upscaling', label: 'Upscaling' }, { key: 'colorBlind', label: 'Color Blind' },
]
const CTRL_ROWS = ['support', 'fullSupport', 'remapping', 'sensitivity', 'yInversion', 'hotplugging', 'simultaneousInput', 'hapticFeedback', 'promptOverride', 'xinput', 'dinput', 'playstation', 'nintendo']
const PLATFORM_ROWS = ['xboxPrompts', 'impulseTriggers', 'playstationPrompts', 'lightBar', 'adaptiveTriggers', 'dualSenseHaptics', 'motionSensors', 'steamDeckPrompts', 'steamInputModes', 'officialPresets', 'touchscreen', 'trackedMotion']
const CLOUD_KEYS = ['steam', 'gogGalaxy', 'epicGames', 'eaApp', 'xbox', 'ubisoftConnect', 'xboxCloud', 'oneDrive']

type BadgeType = 'yes' | 'no' | 'hack' | 'limited' | 'info'

function badge(val: string | null | undefined): { type: BadgeType; text: string } | null {
    if (val == null || val === '') return null
    if (val === 'true') return { type: 'yes', text: 'Yes' }
    if (val === 'false') return { type: 'no', text: 'No' }
    if (val === 'hackable') return { type: 'hack', text: 'Hackable' }
    if (val === 'limited') return { type: 'limited', text: 'Limited' }
    return { type: 'info', text: val.charAt(0).toUpperCase() + val.slice(1) }
}
function labelize(key: string) {
    return key.replace(/([A-Z])/g, ' $1').replace(/^./, c => c.toUpperCase())
}

export function PCGW({ data, refreshing, onRefresh }: { data: Pcgw | null | undefined; refreshing: boolean; onRefresh: () => void }) {
    const [ctrlExpanded, setCtrlExpanded] = useState(false)
    if (!data?.found) return null

    const videoNotes = data.video?.notes ?? {}
    const videoTiles = VIDEO_FEATURES
        .map(f => ({ ...f, b: badge(data.video?.[f.key]), note: videoNotes[f.key] }))
        .filter(f => f.b)

    const mouseRows = Object.entries(data.input?.mouse ?? {}).filter(([, v]) => v != null)
    const kbRows = Object.entries(data.input?.keyboard ?? {}).filter(([, v]) => v != null)
    const ctrlAll = [...CTRL_ROWS, ...PLATFORM_ROWS]
        .map(k => [k, data.input?.controller?.[k] ?? data.input?.platform?.[k]] as const)
        .filter(([, v]) => v != null)
    const ctrlVisible = ctrlExpanded ? ctrlAll : ctrlAll.slice(0, 5)

    const cloudRows = CLOUD_KEYS
        .map(k => [k, data.cloud?.[k] as string | null | undefined] as const)
        .filter(([, v]) => v != null)
    const drmChips = data.availability?.drm ?? []
    const savePaths = Object.entries(data.paths?.saveGame ?? {})
    const configPaths = Object.entries(data.paths?.config ?? {})
    // Unresolved issues before optional tweaks — a broken feature outranks a nice-to-have.
    const GROUP_ORDER = ['Issues unresolved', 'Issues fixed', 'Essential improvements']
    const fixGroups = [...(data.fixes ?? []).reduce((m, f) => {
        const g = f.group || 'Fixes & Tweaks'
        return m.set(g, [...(m.get(g) ?? []), f])
    }, new Map<string, NonNullable<Pcgw['fixes']>>())]
        .sort(([a], [b]) => {
            const rank = (g: string) => (GROUP_ORDER.indexOf(g) + 1 || GROUP_ORDER.length + 1)
            return rank(a) - rank(b)
        })

    return (
        <View style={styles.section}>
            <View style={styles.titleRow}>
                <Text style={styles.title}>PCGamingWiki</Text>
                <Pressable onPress={onRefresh} disabled={refreshing} hitSlop={8}>
                    <Text style={styles.refreshBtn}>{refreshing ? '⟳' : '↻'}</Text>
                </Pressable>
                {data.pageUrl && (
                    <Pressable onPress={() => Linking.openURL(data.pageUrl!)}>
                        <Text style={styles.link}>↗</Text>
                    </Pressable>
                )}
            </View>

            {videoTiles.length > 0 && (
                <Block title="Video & Display">
                    <View style={styles.grid}>
                        {videoTiles.map(f => (
                            <View key={f.key} style={[styles.tile, f.note && styles.tileNoted]}>
                                <View style={styles.tileHead}>
                                    <Text style={styles.tileLabel}>{f.label}</Text>
                                    <BadgeText b={f.b!} />
                                </View>
                                {f.note && <Text style={styles.tileNote}>{stripHtml(f.note)}</Text>}
                            </View>
                        ))}
                    </View>
                </Block>
            )}

            {(mouseRows.length > 0 || kbRows.length > 0 || ctrlAll.length > 0) && (
                <Block title="Input">
                    {mouseRows.length > 0 && <SubGroup label="Mouse" rows={mouseRows} />}
                    {kbRows.length > 0 && <SubGroup label="Keyboard" rows={kbRows} />}
                    {ctrlAll.length > 0 && (
                        <>
                            <SubGroup label="Controller" rows={ctrlVisible} />
                            {ctrlAll.length > 5 && (
                                <Pressable onPress={() => setCtrlExpanded(v => !v)}>
                                    <Text style={styles.moreLink}>{ctrlExpanded ? 'Show less ↑' : `${ctrlAll.length - 5} more ↓`}</Text>
                                </Pressable>
                            )}
                        </>
                    )}
                </Block>
            )}

            {(drmChips.length > 0 || cloudRows.length > 0) && (
                <Block title="Availability & Cloud Saves">
                    {drmChips.length > 0 && (
                        <View style={styles.chipRow}>
                            {drmChips.map(d => <Text key={d} style={styles.chip}>{d}</Text>)}
                        </View>
                    )}
                    {cloudRows.length > 0 && <SubGroup label="Cloud Saves" rows={cloudRows} />}
                </Block>
            )}

            {(savePaths.length > 0 || configPaths.length > 0) && (
                <Block title="Save & Config Locations">
                    {savePaths.length > 0 && <PathCard title="Save Game" paths={savePaths} />}
                    {configPaths.length > 0 && <PathCard title="Config File" paths={configPaths} />}
                </Block>
            )}

            {fixGroups.map(([groupName, groupFixes]) => (
                <Block key={groupName} title={groupName}>
                    {groupFixes.map((f, i) => <FixItem key={i} title={f.title} html={f.html} />)}
                </Block>
            ))}
        </View>
    )
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <View style={styles.block}>
            <Text style={styles.blockTitle}>{title}</Text>
            {children}
        </View>
    )
}

const BADGE_COLORS: Record<BadgeType, string> = {
    yes: '#4caf72', no: '#e05252', hack: '#e0a052', limited: '#e0a996', info: colors.text,
}

function BadgeText({ b }: { b: { type: BadgeType; text: string } }) {
    return <Text style={[styles.badgeText, { color: BADGE_COLORS[b.type] }]}>{b.text}</Text>
}

function SubGroup({ label, rows }: { label: string; rows: readonly (readonly [string, string | null | undefined])[] }) {
    const visible = rows.map(([k, v]) => [k, badge(v)] as const).filter(([, b]) => b)
    if (!visible.length) return null
    return (
        <View style={styles.subGroup}>
            <Text style={styles.subGroupLabel}>{label}</Text>
            {visible.map(([k, b]) => (
                <View key={k} style={styles.row}>
                    <Text style={styles.rowLabel}>{labelize(k)}</Text>
                    <BadgeText b={b!} />
                </View>
            ))}
        </View>
    )
}

function PathCard({ title, paths }: { title: string; paths: [string, string][] }) {
    return (
        <View style={styles.pathCard}>
            <Text style={styles.pathTitle}>{title}</Text>
            {paths.map(([os, path]) => (
                <View key={os} style={styles.pathRow}>
                    <Text style={styles.pathOs}>{os}</Text>
                    <Text style={styles.pathValue} numberOfLines={2}>{path}</Text>
                </View>
            ))}
        </View>
    )
}

function FixItem({ title, html }: { title: string; html: string }) {
    const [open, setOpen] = useState(false)
    return (
        <View style={styles.fixItem}>
            <Pressable onPress={() => setOpen(v => !v)}>
                <Text style={styles.fixTitle}>{open ? '▾ ' : '▸ '}{title}</Text>
            </Pressable>
            {open && <Text style={styles.fixBody}>{stripHtml(html)}</Text>}
        </View>
    )
}

const styles = StyleSheet.create({
    section: { padding: spacing.md },
    titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm },
    title: { color: colors.text, fontFamily: fonts.title, fontSize: 16, flex: 1 },
    refreshBtn: { color: colors.textMuted, fontSize: 16 },
    link: { color: colors.accent, fontSize: 14 },
    block: { marginBottom: spacing.md },
    blockTitle: { color: colors.textMuted, fontFamily: fonts.uiBold, fontSize: 11, textTransform: 'uppercase', marginBottom: spacing.xs },
    grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    tile: { width: 100, backgroundColor: colors.bgRaised, borderRadius: radius, padding: spacing.xs, gap: 2 },
    // Tiles carrying wiki notes take the full row so the prose isn't a 100px column.
    tileNoted: { width: '100%' },
    tileHead: { gap: 2 },
    tileNote: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 11, lineHeight: 16, marginTop: 4 },
    tileLabel: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 10 },
    badgeText: { fontFamily: fonts.uiBold, fontSize: 12 },
    subGroup: { marginBottom: spacing.sm },
    subGroupLabel: { color: colors.text, fontFamily: fonts.uiBold, fontSize: 12, marginBottom: 4 },
    row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 },
    rowLabel: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 12 },
    moreLink: { color: colors.accent, fontFamily: fonts.uiBold, fontSize: 11, marginTop: 2 },
    chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginBottom: spacing.sm },
    chip: { backgroundColor: colors.bgHover, color: colors.text, fontFamily: fonts.ui, fontSize: 11, paddingHorizontal: spacing.sm, paddingVertical: 3, borderRadius: 10 },
    pathCard: { backgroundColor: colors.bgRaised, borderRadius: radius, padding: spacing.sm, marginBottom: spacing.sm },
    pathTitle: { color: colors.text, fontFamily: fonts.uiBold, fontSize: 12, marginBottom: 4 },
    pathRow: { marginBottom: 4 },
    pathOs: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 10 },
    pathValue: { color: colors.text, fontFamily: 'monospace', fontSize: 11 },
    fixItem: { marginBottom: spacing.sm },
    fixTitle: { color: colors.text, fontFamily: fonts.uiBold, fontSize: 12 },
    fixBody: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 12, marginTop: 4, paddingLeft: spacing.sm, lineHeight: 18 },
})
