import Svg, { Circle, Line, Path, Polygon, Polyline } from 'react-native-svg'

import { colors } from '@/theme/tokens'

// Shared lucide icon set for the RN app — replaces the old emoji UI markers (see project_no_emojis).
// Paths are the official lucide 24×24 source, inlined via react-native-svg (already a dep) so both
// apps draw the exact same icons without pulling in lucide-react-native. Children inherit `stroke`
// and `fill:none` from the root <Svg> (confirmed behavior — the guide PinIcon works the same way).
// Colour by category via the `color` prop (default gold = colors.accent); tones live in tokens.ts.
export type LucideName =
    | 'pin' | 'trophy' | 'square-pen' | 'shopping-cart' | 'circle-plus' | 'heart' | 'gamepad-2'
    | 'message-circle' | 'settings' | 'hourglass' | 'clock' | 'bar-chart' | 'notebook-pen'
    | 'file-text' | 'sparkles' | 'sparkle' | 'wand-sparkles' | 'party-popper' | 'crown' | 'gem'
    | 'award' | 'medal' | 'star' | 'search' | 'pencil' | 'triangle-alert' | 'download'
    | 'diamond' | 'hexagon' | 'refresh-cw'

const ICONS: Record<LucideName, React.ReactNode> = {
    'pin': <><Path d="M12 17v5" /><Path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1z" /></>,
    'trophy': <><Path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" /><Path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" /><Path d="M4 22h16" /><Path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" /><Path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" /><Path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" /></>,
    'square-pen': <><Path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><Path d="M18.375 2.625a1 1 0 0 1 3 3l-9.013 9.014a2 2 0 0 1-.853.505l-2.873.84a.5.5 0 0 1-.62-.62l.84-2.873a2 2 0 0 1 .506-.852z" /></>,
    'shopping-cart': <><Circle cx="8" cy="21" r="1" /><Circle cx="19" cy="21" r="1" /><Path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12" /></>,
    'circle-plus': <><Circle cx="12" cy="12" r="10" /><Path d="M8 12h8" /><Path d="M12 8v8" /></>,
    'heart': <Path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z" />,
    'gamepad-2': <><Line x1="6" x2="10" y1="11" y2="11" /><Line x1="8" x2="8" y1="9" y2="13" /><Line x1="15" x2="15.01" y1="12" y2="12" /><Line x1="18" x2="18.01" y1="10" y2="10" /><Path d="M17.32 5H6.68a4 4 0 0 0-3.978 3.59c-.006.052-.01.101-.017.152C2.604 9.416 2 14.456 2 16a3 3 0 0 0 3 3c1 0 1.5-.5 2-1l1.414-1.414A2 2 0 0 1 9.828 16h4.344a2 2 0 0 1 1.414.586L17 18c.5.5 1 1 2 1a3 3 0 0 0 3-3c0-1.545-.604-6.584-.685-7.258-.007-.05-.011-.1-.017-.151A4 4 0 0 0 17.32 5z" /></>,
    'message-circle': <Path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />,
    'settings': <><Path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" /><Circle cx="12" cy="12" r="3" /></>,
    'hourglass': <><Path d="M5 22h14" /><Path d="M5 2h14" /><Path d="M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22" /><Path d="M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2" /></>,
    'clock': <><Circle cx="12" cy="12" r="10" /><Polyline points="12 6 12 12 16 14" /></>,
    'bar-chart': <><Line x1="18" y1="20" x2="18" y2="10" /><Line x1="12" y1="20" x2="12" y2="4" /><Line x1="6" y1="20" x2="6" y2="14" /></>,
    'notebook-pen': <><Path d="M13.4 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7.4" /><Path d="M2 6h4" /><Path d="M2 10h4" /><Path d="M2 14h4" /><Path d="M2 18h4" /><Path d="M21.378 5.626a1 1 0 1 0-3.004-3.004l-5.01 5.012a2 2 0 0 0-.506.854l-.837 2.87a.5.5 0 0 0 .62.62l2.87-.837a2 2 0 0 0 .854-.506z" /></>,
    'file-text': <><Path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" /><Path d="M14 2v4a2 2 0 0 0 2 2h4" /><Path d="M16 13H8" /><Path d="M16 17H8" /><Path d="M10 9H8" /></>,
    'sparkles': <><Path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .962 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.962 0z" /><Path d="M20 3v4" /><Path d="M22 5h-4" /><Path d="M4 17v2" /><Path d="M5 18H3" /></>,
    'sparkle': <Path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .962 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.962 0z" />,
    'wand-sparkles': <><Path d="m21.64 3.64-1.28-1.28a1.21 1.21 0 0 0-1.72 0L2.36 18.64a1.21 1.21 0 0 0 0 1.72l1.28 1.28a1.2 1.2 0 0 0 1.72 0L21.64 5.36a1.2 1.2 0 0 0 0-1.72Z" /><Path d="m14 7 3 3" /><Path d="M5 6v4" /><Path d="M19 14v4" /><Path d="M10 2v2" /><Path d="M7 8H3" /><Path d="M21 16h-4" /><Path d="M11 3H9" /></>,
    'party-popper': <><Path d="M5.8 11.3 2 22l10.7-3.79" /><Path d="M4 3h.01" /><Path d="M22 8h.01" /><Path d="M15 2h.01" /><Path d="M22 20h.01" /><Path d="m22 2-2.24.75a2.9 2.9 0 0 0-1.96 3.12v0c.1.86-.57 1.63-1.45 1.63h-.38c-.86 0-1.6.6-1.76 1.44L14 10" /><Path d="m22 13-.82-.33c-.86-.34-1.82.2-1.98 1.11v0c-.11.7-.72 1.22-1.43 1.22H17" /><Path d="m11 2 .33.82c.34.86-.2 1.82-1.11 1.98v0C9.52 4.9 9 5.52 9 6.23V7" /><Path d="M11 13c1.93 1.93 2.83 4.17 2 5-.83.83-3.07-.07-5-2-1.93-1.93-2.83-4.17-2-5 .83-.83 3.07.07 5 2Z" /></>,
    'crown': <><Path d="M11.562 3.266a.5.5 0 0 1 .876 0L15.39 8.87a1 1 0 0 0 1.516.294L21.183 5.5a.5.5 0 0 1 .798.519l-2.834 10.246a1 1 0 0 1-.956.734H5.81a1 1 0 0 1-.957-.734L2.02 6.02a.5.5 0 0 1 .798-.519l4.276 3.664a1 1 0 0 0 1.516-.294z" /><Path d="M5 21h14" /></>,
    'gem': <><Path d="M6 3h12l4 6-10 13L2 9Z" /><Path d="M11 3 8 9l4 13 4-13-3-6" /><Path d="M2 9h20" /></>,
    'award': <><Path d="m15.477 12.89 1.515 8.526a.5.5 0 0 1-.81.47l-3.58-2.687a1 1 0 0 0-1.197 0l-3.586 2.686a.5.5 0 0 1-.81-.469l1.514-8.526" /><Circle cx="12" cy="8" r="6" /></>,
    'medal': <><Path d="M7.21 15 2.66 7.14a2 2 0 0 1 .13-2.2L4.4 2.8A2 2 0 0 1 6 2h12a2 2 0 0 1 1.6.8l1.6 2.14a2 2 0 0 1 .14 2.2L16.79 15" /><Path d="M11 12 5.12 2.2" /><Path d="m13 12 5.88-9.8" /><Path d="M8 7h8" /><Circle cx="12" cy="17" r="5" /><Path d="M12 18v-2h-.5" /></>,
    'star': <Polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />,
    'search': <><Circle cx="11" cy="11" r="8" /><Path d="m21 21-4.3-4.3" /></>,
    'pencil': <><Path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" /><Path d="m15 5 4 4" /></>,
    'triangle-alert': <><Path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" /><Path d="M12 9v4" /><Path d="M12 17h.01" /></>,
    'download': <><Path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><Polyline points="7 10 12 15 17 10" /><Line x1="12" x2="12" y1="15" y2="3" /></>,
    'diamond': <Path d="M2.7 10.3a2.41 2.41 0 0 0 0 3.41l7.59 7.59a2.41 2.41 0 0 0 3.41 0l7.59-7.59a2.41 2.41 0 0 0 0-3.41L13.71 2.71a2.41 2.41 0 0 0-3.41 0z" />,
    'hexagon': <Path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />,
    'refresh-cw': <><Path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" /><Path d="M21 3v5h-5" /><Path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" /><Path d="M8 16H3v5" /></>,
}

export function Lucide({ name, size = 16, color = colors.accent, strokeWidth = 2 }: {
    name: LucideName
    size?: number
    color?: string
    strokeWidth?: number
}) {
    return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
            {ICONS[name]}
        </Svg>
    )
}
