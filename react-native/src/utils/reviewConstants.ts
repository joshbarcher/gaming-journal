// Ported from src/lib/js/review-modal.ts's SLIDER_KEYS/BADGES/PRESET_TAGS/STAR_LABELS — the exact
// keys/labels/colors the web's review editor and display cards use. Icon SVG paths are NOT ported
// (each badge has a unique hand-drawn multi-path icon) — a react-native-svg rendering of 18 icons
// is real scope beyond this item; badges display via a colored ring + count instead, a documented
// simplification, not a silent omission.
export const SLIDER_KEYS = [
    { key: 'story', label: 'Story' },
    { key: 'soundMusic', label: 'Sound & Music' },
    { key: 'gameplay', label: 'Gameplay' },
    { key: 'graphics', label: 'Graphics' },
    { key: 'replayability', label: 'Replayability' },
    { key: 'performance', label: 'Performance' },
    { key: 'agendaFree', label: 'Agenda-Free' },
]

export const PRESET_TAGS = [
    'Too Long', 'Just Right', 'Short & Sweet', 'Grindy', 'Padded',
    'Brutally Hard', 'Challenging', 'Easy', 'Relaxing', 'Great Story',
    'Weak Story', 'Great Characters', 'Addictive', 'Repetitive', 'Deep Systems',
    'Must Play', 'Hidden Gem', 'Overrated', 'Wait for Sale', 'Great OST',
    'Beautiful Visuals', 'Runs Great', 'Technical Issues', 'Better with Friends',
]

export const STAR_LABELS = ['Not Rated', '1 Star', '2 Stars', '3 Stars', '4 Stars', '5 Stars', 'Legendary']

export type BadgeDef = { id: string; label: string; color: string; hasCount?: boolean }

export const BADGES: BadgeDef[] = [
    { id: 'comfortGame', label: 'Comfort Game', color: '#e8975a' },
    { id: 'replayed', label: 'Replayed', color: '#5ab4e8', hasCount: true },
    { id: 'hiddenGem', label: 'Hidden Gem', color: '#4ecb8d' },
    { id: 'didntLiveUp', label: "Didn't Live Up", color: '#e85a6e' },
    { id: 'surprisedMe', label: 'Surprised Me', color: '#a35ae8' },
    { id: 'soulsLike', label: 'Souls-like', color: '#c0392b' },
    { id: 'rogueLike', label: 'Rogue-like', color: '#e67e22' },
    { id: 'survivor', label: 'Survivor', color: '#27ae60' },
    { id: 'handheld', label: 'Great Handheld', color: '#00bcd4' },
    { id: 'coop', label: 'Co-op', color: '#f1c40f' },
    { id: 'completionist', label: '100%', color: '#c0ca33' },
    { id: 'modded', label: 'Modded', color: '#78909c' },
    { id: 'rageQuit', label: 'Rage Quit', color: '#ff1744' },
    { id: 'watershed', label: 'Watershed', color: '#1976d2' },
    { id: 'thoughtProvoking', label: 'Thought Provoking', color: '#651fff' },
    { id: 'goodGrind', label: 'Good Grind', color: '#ff6d00' },
    { id: 'contentPadded', label: 'Content Padded', color: '#8d6e63' },
    { id: 'trash', label: 'Trash', color: '#546e7a' },
    { id: 'political', label: 'Political', color: '#e040fb' },
]
