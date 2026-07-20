import { useQuery } from '@tanstack/react-query'
import { router, useLocalSearchParams } from 'expo-router'
import { useState } from 'react'
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import Svg, { Circle, Line, Path, Polygon, Polyline, Rect } from 'react-native-svg'

import { getGameDetail, getPcgwForGame } from '@/api/gamePage'
import { RichHtml } from '@/components/game/About'
import { colors, fonts, radius, spacing } from '@/theme/tokens'
import type { Pcgw } from 'gaming-journal-contracts/pcgw'

// Port of the /game/[appid]/pcgw route (PcgwPage.svelte → PcgwDetail.svelte): the full PCGamingWiki
// detail — Video & Display feature rows, Input cards (mouse/keyboard/controller), Availability &
// Cloud saves, Save & Config file locations, and the grouped Fixes/known-issues accordion. Shares
// the game screen's ['pcgw', appid] / ['gameDetail', appid] query caches so opening this page from
// the section badges is instant (no refetch).

// ── Icons (Lucide paths, copied verbatim from PcgwDetail.svelte's PI map) ─────────────────────────
type IconName =
    | 'monitor' | 'maximize' | 'sun' | 'zap' | 'activity' | 'refresh' | 'sparkles' | 'layers'
    | 'aim' | 'aperture' | 'film' | 'arrowUp' | 'eye' | 'mouse' | 'keyboard' | 'gamepad'
    | 'cloud' | 'folder' | 'save' | 'shield' | 'wrench' | 'alert'

function PcgwIcon({ name, size = 15, color = colors.textMuted }: { name: IconName; size?: number; color?: string }) {
    const s = { stroke: color, strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, fill: 'none' as const }
    const c = { width: size, height: size, viewBox: '0 0 24 24' }
    switch (name) {
        case 'monitor':
            return <Svg {...c}><Rect {...s} x={2} y={3} width={20} height={14} rx={2} /><Path {...s} d="M8 21h8M12 17v4" /></Svg>
        case 'maximize':
            return <Svg {...c}><Polyline {...s} points="15 3 21 3 21 9" /><Polyline {...s} points="9 21 3 21 3 15" /><Line {...s} x1={21} y1={3} x2={14} y2={10} /><Line {...s} x1={3} y1={21} x2={10} y2={14} /></Svg>
        case 'sun':
            return <Svg {...c}><Circle {...s} cx={12} cy={12} r={4} /><Path {...s} d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" /></Svg>
        case 'zap':
            return <Svg {...c}><Polygon {...s} points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" /></Svg>
        case 'activity':
            return <Svg {...c}><Polyline {...s} points="22 12 18 12 15 21 9 3 6 12 2 12" /></Svg>
        case 'refresh':
            return <Svg {...c}><Path {...s} d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" /><Path {...s} d="M21 3v5h-5" /><Path {...s} d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" /><Path {...s} d="M8 16H3v5" /></Svg>
        case 'sparkles':
            return <Svg {...c}><Path {...s} d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" /></Svg>
        case 'layers':
            return <Svg {...c}><Polygon {...s} points="12 2 2 7 12 12 22 7 12 2" /><Polyline {...s} points="2 17 12 22 22 17" /><Polyline {...s} points="2 12 12 17 22 12" /></Svg>
        case 'aim':
            return <Svg {...c}><Circle {...s} cx={12} cy={12} r={10} /><Line {...s} x1={22} y1={12} x2={18} y2={12} /><Line {...s} x1={6} y1={12} x2={2} y2={12} /><Line {...s} x1={12} y1={6} x2={12} y2={2} /><Line {...s} x1={12} y1={22} x2={12} y2={18} /></Svg>
        case 'aperture':
            return <Svg {...c}><Circle {...s} cx={12} cy={12} r={10} /><Line {...s} x1={14.31} y1={8} x2={20.05} y2={17.94} /><Line {...s} x1={9.69} y1={8} x2={21.17} y2={8} /><Line {...s} x1={7.38} y1={12} x2={13.12} y2={2.06} /><Line {...s} x1={9.69} y1={16} x2={3.95} y2={6.06} /><Line {...s} x1={14.31} y1={16} x2={2.83} y2={16} /><Line {...s} x1={16.62} y1={12} x2={10.88} y2={21.94} /></Svg>
        case 'film':
            return <Svg {...c}><Rect {...s} x={2} y={2} width={20} height={20} rx={2.18} /><Line {...s} x1={7} y1={2} x2={7} y2={22} /><Line {...s} x1={17} y1={2} x2={17} y2={22} /><Line {...s} x1={2} y1={12} x2={22} y2={12} /><Line {...s} x1={2} y1={7} x2={7} y2={7} /><Line {...s} x1={2} y1={17} x2={7} y2={17} /><Line {...s} x1={17} y1={17} x2={22} y2={17} /><Line {...s} x1={17} y1={7} x2={22} y2={7} /></Svg>
        case 'arrowUp':
            return <Svg {...c}><Circle {...s} cx={12} cy={12} r={10} /><Polyline {...s} points="16 12 12 8 8 12" /><Line {...s} x1={12} y1={16} x2={12} y2={8} /></Svg>
        case 'eye':
            return <Svg {...c}><Path {...s} d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" /><Circle {...s} cx={12} cy={12} r={3} /></Svg>
        case 'mouse':
            return <Svg {...c}><Rect {...s} x={5} y={2} width={14} height={20} rx={7} /><Path {...s} d="M12 6v4" /></Svg>
        case 'keyboard':
            return <Svg {...c}><Rect {...s} x={2} y={6} width={20} height={12} rx={2} /><Path {...s} d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M8 14h8" /></Svg>
        case 'gamepad':
            return <Svg {...c}><Line {...s} x1={6} y1={12} x2={10} y2={12} /><Line {...s} x1={8} y1={10} x2={8} y2={14} /><Line {...s} x1={15} y1={13} x2={15.01} y2={13} /><Line {...s} x1={18} y1={11} x2={18.01} y2={11} /><Rect {...s} x={2} y={8} width={20} height={12} rx={4} /></Svg>
        case 'cloud':
            return <Svg {...c}><Path {...s} d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" /></Svg>
        case 'folder':
            return <Svg {...c}><Path {...s} d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z" /></Svg>
        case 'save':
            return <Svg {...c}><Path {...s} d="M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" /><Path {...s} d="M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7" /><Path {...s} d="M7 3v4a1 1 0 0 0 1 1h7" /></Svg>
        case 'shield':
            return <Svg {...c}><Path {...s} d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" /></Svg>
        case 'wrench':
            return <Svg {...c}><Path {...s} d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" /></Svg>
        case 'alert':
            return <Svg {...c}><Path {...s} d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><Line {...s} x1={12} y1={9} x2={12} y2={13} /><Line {...s} x1={12} y1={17} x2={12.01} y2={17} /></Svg>
    }
}

// ── Feature/row tables (mirror PcgwDetail.svelte) ────────────────────────────────────────────────
const VIDEO_FEATURES: { key: string; icon: IconName; label: string }[] = [
    { key: 'widescreen', icon: 'monitor', label: 'Widescreen' },
    { key: 'ultrawide', icon: 'monitor', label: 'Ultrawide' },
    { key: 'uhd4k', icon: 'maximize', label: '4K UHD' },
    { key: 'hdr', icon: 'sun', label: 'HDR' },
    { key: 'fps60', icon: 'zap', label: '60 FPS' },
    { key: 'fps120', icon: 'activity', label: '120+ FPS' },
    { key: 'vsync', icon: 'refresh', label: 'VSync' },
    { key: 'aa', icon: 'sparkles', label: 'Anti-Aliasing' },
    { key: 'af', icon: 'layers', label: 'Aniso. Filtering' },
    { key: 'fov', icon: 'aim', label: 'FOV Control' },
    { key: 'rayTracing', icon: 'aperture', label: 'Ray Tracing' },
    { key: 'frameGen', icon: 'film', label: 'Frame Generation' },
    { key: 'upscaling', icon: 'arrowUp', label: 'Upscaling' },
    { key: 'colorBlind', icon: 'eye', label: 'Color Blind Mode' },
]
const MOUSE_ROWS: [string, string][] = [['sensitivity', 'Sensitivity'], ['acceleration', 'Raw input / no accel'], ['inMenus', 'Works in menus'], ['yInversion', 'Y-axis inversion'], ['kbmPrompts', 'KB/M prompts']]
const KB_ROWS: [string, string][] = [['remapping', 'Key remapping'], ['steamInput', 'Steam Input']]
const CTRL_ROWS: [string, string][] = [['support', 'Controller support'], ['fullSupport', 'Full controller'], ['remapping', 'Button remapping'], ['sensitivity', 'Sensitivity'], ['yInversion', 'Y-axis inversion'], ['hotplugging', 'Hot-plugging'], ['simultaneousInput', 'Simultaneous input'], ['hapticFeedback', 'Haptic feedback'], ['promptOverride', 'Prompt override'], ['xinput', 'XInput'], ['dinput', 'DirectInput'], ['playstation', 'PlayStation'], ['nintendo', 'Nintendo']]
const PLATFORM_ROWS: [string, string][] = [['xboxPrompts', 'Xbox prompts'], ['impulseTriggers', 'Impulse triggers'], ['playstationPrompts', 'PlayStation prompts'], ['lightBar', 'Light bar'], ['adaptiveTriggers', 'Adaptive triggers'], ['dualSenseHaptics', 'DualSense haptics'], ['motionSensors', 'Motion sensors'], ['steamDeckPrompts', 'Steam Deck prompts'], ['touchscreen', 'Touchscreen']]
const CLOUD_ROWS: [string, string][] = [['steam', 'Steam'], ['gogGalaxy', 'GOG Galaxy'], ['epicGames', 'Epic Games'], ['eaApp', 'EA App'], ['xbox', 'Xbox'], ['ubisoftConnect', 'Ubisoft Connect'], ['xboxCloud', 'Xbox Cloud'], ['oneDrive', 'OneDrive']]

type BadgeType = 'yes' | 'no' | 'hack' | 'limited' | 'info'
function badge(val: string | null | undefined): { type: BadgeType; text: string } | null {
    if (val == null || val === '') return null
    if (val === 'true') return { type: 'yes', text: 'Yes' }
    if (val === 'false') return { type: 'no', text: 'No' }
    if (val === 'hackable') return { type: 'hack', text: 'Hackable' }
    if (val === 'limited') return { type: 'limited', text: 'Limited' }
    return { type: 'info', text: val.charAt(0).toUpperCase() + val.slice(1) }
}

const BADGE_BOX: Record<BadgeType, { backgroundColor: string }> = {
    yes: { backgroundColor: 'rgba(92,186,92,0.15)' },
    no: { backgroundColor: 'rgba(255,255,255,0.05)' },
    hack: { backgroundColor: 'rgba(201,168,76,0.15)' },
    limited: { backgroundColor: 'rgba(224,169,150,0.14)' },
    info: { backgroundColor: 'rgba(255,255,255,0.08)' },
}
const BADGE_TXT: Record<BadgeType, string> = {
    yes: '#5cba5c', no: colors.textMuted, hack: colors.accent, limited: colors.accent2, info: colors.text,
}

function Badge({ b }: { b: { type: BadgeType; text: string } }) {
    return (
        <View style={[styles.badge, BADGE_BOX[b.type]]}>
            <Text style={[styles.badgeText, { color: BADGE_TXT[b.type] }, b.type === 'info' && styles.badgeTextInfo]}>{b.text}</Text>
        </View>
    )
}

const GROUP_ORDER = ['Issues unresolved', 'Issues fixed', 'Essential improvements']

export default function PcgwDetailScreen() {
    const { appid: appidStr } = useLocalSearchParams<{ appid: string }>()
    const appid = Number(appidStr)

    const pcgwQuery = useQuery({ queryKey: ['pcgw', appid], queryFn: () => getPcgwForGame(appid) })
    const gameQuery = useQuery({ queryKey: ['gameDetail', appid], queryFn: () => getGameDetail(appid) })
    const gameName = gameQuery.data?.name ?? 'Game'
    const data = pcgwQuery.data

    return (
        <ScrollView style={styles.container} contentContainerStyle={styles.content}>
            <View style={styles.nav}>
                <Pressable onPress={() => router.push(`/game/${appid}` as never)} hitSlop={8}>
                    <Text style={styles.backBtn}>‹ {gameName}</Text>
                </Pressable>
            </View>

            <View style={styles.head}>
                <Text style={styles.title}>PCGamingWiki</Text>
                {data?.pageUrl && (
                    <Pressable onPress={() => Linking.openURL(data.pageUrl!)} hitSlop={6} style={styles.srcRow}>
                        <Text style={styles.srcLink}>View on PCGamingWiki</Text>
                        <PcgwIcon name="maximize" size={12} color={colors.accent} />
                    </Pressable>
                )}
            </View>

            {pcgwQuery.isLoading ? (
                <Text style={styles.muted}>Loading…</Text>
            ) : !data?.found ? (
                <Text style={styles.muted}>No PCGamingWiki data for this game.</Text>
            ) : (
                <PcgwDetail data={data} />
            )}
        </ScrollView>
    )
}

function PcgwDetail({ data }: { data: Pcgw }) {
    const [ctrlExpanded, setCtrlExpanded] = useState(false)

    const v = (data.video ?? {}) as Record<string, string | null | undefined>
    const videoNotes = (data.video?.notes ?? {}) as Record<string, string>
    const inp = data.input ?? {}
    const cl = (data.cloud ?? {}) as Record<string, string | null | undefined>
    const cloudNotes = (data.cloud?.notes ?? {}) as Record<string, string>
    const av = data.availability ?? {}
    const paths = data.paths ?? {}
    const fixes = data.fixes ?? []

    const activeVideo = VIDEO_FEATURES.filter((f) => v[f.key] != null)
    const mouseRows = MOUSE_ROWS.filter(([k]) => inp.mouse?.[k] != null)
    const kbRows = KB_ROWS.filter(([k]) => inp.keyboard?.[k] != null)
    const ctrlRows = [...CTRL_ROWS, ...PLATFORM_ROWS].filter(([k]) => inp.controller?.[k] != null || inp.platform?.[k] != null)
    const drmChips = av.drm ?? []
    const cloudRows = CLOUD_ROWS.filter(([k]) => cl[k] != null)

    const ctrlSrc = (k: string) => inp.controller?.[k] ?? inp.platform?.[k]
    const ctrlVisible = ctrlExpanded ? ctrlRows : ctrlRows.slice(0, 5)

    const pathCards = ([
        { title: 'Save Game', icon: 'save' as IconName, obj: paths.saveGame },
        { title: 'Config File', icon: 'folder' as IconName, obj: paths.config },
    ]).filter((p) => p.obj && Object.keys(p.obj).length)

    const fixGroups = (() => {
        const byGroup = new Map<string, typeof fixes>()
        for (const f of fixes) {
            const g = f.group || 'Fixes & Tweaks'
            if (!byGroup.has(g)) byGroup.set(g, [])
            byGroup.get(g)!.push(f)
        }
        const rank = (g: string) => {
            const i = GROUP_ORDER.indexOf(g)
            return i === -1 ? GROUP_ORDER.length : i
        }
        return [...byGroup].sort(([a], [b]) => rank(a) - rank(b))
    })()

    return (
        <View>
            {/* Video & Display */}
            {activeVideo.length > 0 && (
                <View style={styles.block}>
                    <BlockTitle icon="monitor" title="Video & Display" />
                    <View style={styles.featureRows}>
                        {activeVideo.map((f) => {
                            const b = badge(v[f.key])
                            const note = videoNotes[f.key]
                            if (!b) return null
                            return (
                                <View key={f.key} style={styles.frow}>
                                    <View style={styles.frowHead}>
                                        <PcgwIcon name={f.icon} size={15} />
                                        <Text style={styles.frowLabel}>{f.label}</Text>
                                        <Badge b={b} />
                                    </View>
                                    {note && <View style={styles.frowNote}><RichHtml html={note} /></View>}
                                </View>
                            )
                        })}
                    </View>
                </View>
            )}

            {/* Input */}
            {(mouseRows.length > 0 || kbRows.length > 0 || ctrlRows.length > 0) && (
                <View style={styles.block}>
                    <BlockTitle icon="gamepad" title="Input" />
                    <View style={styles.cardGrid}>
                        {mouseRows.length > 0 && (
                            <Card icon="mouse" title="Mouse">
                                {mouseRows.map(([k, label]) => {
                                    const b = badge(inp.mouse?.[k])
                                    return b ? <Row key={k} label={label} b={b} /> : null
                                })}
                            </Card>
                        )}
                        {kbRows.length > 0 && (
                            <Card icon="keyboard" title="Keyboard">
                                {kbRows.map(([k, label]) => {
                                    const b = badge(inp.keyboard?.[k])
                                    return b ? <Row key={k} label={label} b={b} /> : null
                                })}
                            </Card>
                        )}
                        {ctrlRows.length > 0 && (
                            <Card icon="gamepad" title="Controller">
                                {ctrlVisible.map(([k, label]) => {
                                    const b = badge(ctrlSrc(k))
                                    return b ? <Row key={k} label={label} b={b} /> : null
                                })}
                                {ctrlRows.length > 5 && (
                                    <Pressable onPress={() => setCtrlExpanded((x) => !x)} hitSlop={6}>
                                        <Text style={styles.ctrlToggle}>{ctrlExpanded ? 'Show less ↑' : `${ctrlRows.length - 5} more ↓`}</Text>
                                    </Pressable>
                                )}
                            </Card>
                        )}
                    </View>
                </View>
            )}

            {/* Availability & Cloud Saves */}
            {(drmChips.length > 0 || cloudRows.length > 0) && (
                <View style={styles.block}>
                    <BlockTitle icon="shield" title="Availability & Cloud Saves" />
                    <View style={styles.cardGrid}>
                        {drmChips.length > 0 && (
                            <Card icon="shield" title="DRM">
                                <View style={styles.chipRow}>
                                    {drmChips.map((d) => <Text key={d} style={styles.chip}>{d}</Text>)}
                                </View>
                            </Card>
                        )}
                        {cloudRows.length > 0 && (
                            <Card icon="cloud" title="Cloud Saves">
                                {cloudRows.map(([k, label]) => {
                                    const b = badge(cl[k])
                                    if (!b) return null
                                    return (
                                        <View key={k}>
                                            <Row label={label} b={b} />
                                            {cloudNotes[k] && <View style={styles.rowNote}><RichHtml html={cloudNotes[k]} /></View>}
                                        </View>
                                    )
                                })}
                            </Card>
                        )}
                    </View>
                </View>
            )}

            {/* Save & Config Locations */}
            {pathCards.length > 0 && (
                <View style={styles.block}>
                    <BlockTitle icon="save" title="Save & Config Locations" accent />
                    <View style={styles.pathsGrid}>
                        {pathCards.map(({ title, icon, obj }) => (
                            <Card key={title} icon={icon} title={title}>
                                {Object.entries(obj!).map(([os, path]) => (
                                    <View key={os} style={styles.pathRow}>
                                        <Text style={styles.pathOs}>{os}</Text>
                                        <Text style={styles.pathCode}>{path}</Text>
                                    </View>
                                ))}
                            </Card>
                        ))}
                    </View>
                </View>
            )}

            {/* Fixes, tweaks & known issues */}
            {fixGroups.map(([groupName, groupFixes]) => {
                const warn = groupName === 'Issues unresolved'
                return (
                    <View key={groupName} style={styles.block}>
                        <BlockTitle icon={warn ? 'alert' : 'wrench'} title={groupName} warn={warn} />
                        <View style={styles.fixes}>
                            {groupFixes.map((f, i) => (
                                <FixItem key={i} title={f.title} html={f.html} warn={warn} defaultOpen={warn} />
                            ))}
                        </View>
                    </View>
                )
            })}
        </View>
    )
}

function BlockTitle({ icon, title, accent, warn }: { icon: IconName; title: string; accent?: boolean; warn?: boolean }) {
    const color = warn ? colors.accent2 : accent ? colors.accent : colors.textMuted
    return (
        <View style={styles.blockTitle}>
            <PcgwIcon name={icon} size={15} color={color} />
            <Text style={[styles.blockTitleText, { color }]}>{title.toUpperCase()}</Text>
        </View>
    )
}

function Card({ icon, title, children }: { icon: IconName; title: string; children: React.ReactNode }) {
    return (
        <View style={styles.card}>
            <View style={styles.cardTitle}>
                <PcgwIcon name={icon} size={14} />
                <Text style={styles.cardTitleText}>{title.toUpperCase()}</Text>
            </View>
            {children}
        </View>
    )
}

function Row({ label, b }: { label: string; b: { type: BadgeType; text: string } }) {
    return (
        <View style={styles.row}>
            <Text style={styles.rowLabel}>{label}</Text>
            <Badge b={b} />
        </View>
    )
}

function FixItem({ title, html, warn, defaultOpen }: { title: string; html: string; warn?: boolean; defaultOpen?: boolean }) {
    const [open, setOpen] = useState(!!defaultOpen)
    return (
        <View style={[styles.fix, warn && styles.fixWarn, open && !warn && styles.fixOpen]}>
            <Pressable onPress={() => setOpen((x) => !x)} style={styles.fixSummary}>
                <PcgwIcon name={warn ? 'alert' : 'wrench'} size={14} color={warn ? colors.accent2 : colors.textMuted} />
                <Text style={[styles.fixTitle, warn && styles.fixTitleWarn]}>{title}</Text>
                <Text style={styles.fixChevron}>{open ? '⌄' : '›'}</Text>
            </Pressable>
            {open && <View style={styles.fixBody}><RichHtml html={html} /></View>}
        </View>
    )
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    content: { paddingHorizontal: spacing.md, paddingBottom: spacing.xxl },
    nav: { paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border, marginBottom: spacing.md, marginHorizontal: -spacing.md, paddingHorizontal: spacing.md },
    backBtn: { color: colors.accent, fontFamily: fonts.uiBold, fontSize: 13 },
    head: { marginBottom: spacing.lg },
    title: { color: colors.text, fontFamily: fonts.title, fontSize: 24 },
    srcRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 6 },
    srcLink: { color: colors.accent, fontFamily: fonts.ui, fontSize: 12 },
    muted: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 13, fontStyle: 'italic', paddingVertical: spacing.lg },

    block: { marginBottom: 28 },
    blockTitle: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
    blockTitleText: { fontFamily: fonts.uiBold, fontSize: 11, letterSpacing: 1.2 },

    featureRows: {},
    frow: { borderTopWidth: 1, borderTopColor: colors.border, paddingVertical: 10 },
    frowHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    frowLabel: { flex: 1, fontSize: 13, color: colors.text, fontFamily: fonts.ui },
    frowNote: { marginTop: 2, paddingLeft: 25 },

    cardGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    card: { flexGrow: 1, flexBasis: 260, minWidth: 240, backgroundColor: colors.bgRaised, borderWidth: 1, borderColor: colors.border, borderRadius: radius, paddingHorizontal: 16, paddingVertical: 14 },
    cardTitle: { flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 10 },
    cardTitleText: { color: colors.textMuted, fontFamily: fonts.uiBold, fontSize: 11, letterSpacing: 1 },

    row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.04)' },
    rowLabel: { flex: 1, fontSize: 12, color: colors.text, fontFamily: fonts.ui },
    rowNote: { marginTop: -2, marginBottom: 6 },
    ctrlToggle: { color: colors.accent, fontFamily: fonts.uiBold, fontSize: 11, marginTop: 8 },

    badge: { borderRadius: 3, paddingHorizontal: 7, paddingVertical: 2 },
    badgeText: { fontFamily: fonts.uiBold, fontSize: 10 },
    badgeTextInfo: { fontFamily: fonts.ui },

    chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 5 },
    chip: { fontSize: 11, fontFamily: fonts.ui, color: colors.textMuted, borderWidth: 1, borderColor: colors.border, backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: 999, paddingHorizontal: 9, paddingVertical: 2 },

    pathsGrid: { gap: spacing.sm },
    pathRow: { flexDirection: 'row', gap: 12, alignItems: 'flex-start', paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.04)' },
    pathOs: { fontSize: 10, fontFamily: fonts.uiBold, letterSpacing: 0.6, color: colors.accent, textTransform: 'uppercase', paddingTop: 3 },
    pathCode: { flex: 1, fontFamily: 'monospace', fontSize: 11, color: colors.text, backgroundColor: 'rgba(255,255,255,0.05)', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 3, lineHeight: 17 },

    fixes: { gap: 6 },
    fix: { backgroundColor: colors.bgRaised, borderWidth: 1, borderColor: colors.border, borderRadius: radius, overflow: 'hidden' },
    fixOpen: { borderColor: colors.borderHi },
    fixWarn: { borderColor: 'rgba(224,169,150,0.30)' },
    fixSummary: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 16, paddingVertical: 12 },
    fixTitle: { flex: 1, color: colors.text, fontFamily: fonts.ui, fontSize: 13 },
    fixTitleWarn: { color: colors.accent2 },
    fixChevron: { color: colors.textMuted, fontSize: 16 },
    fixBody: { paddingHorizontal: 16, paddingVertical: 14, borderTopWidth: 1, borderTopColor: colors.border },
})
