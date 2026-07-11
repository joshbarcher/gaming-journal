export interface GameSection {
    id:    string
    label: string
}

export const GAME_SECTIONS: GameSection[] = [
    { id: 'game-sec-hero',              label: 'Top' },
    { id: 'game-sec-trailers',          label: 'Trailers' },
    { id: 'game-sec-about',             label: 'About' },
    { id: 'game-sec-hltb',              label: 'How Long To Beat' },
    { id: 'game-sec-player-count',      label: 'Player Count' },
    { id: 'game-sec-screenshots',       label: 'Screenshots' },
    { id: 'game-sec-news',              label: 'News' },
    { id: 'game-sec-local-review',      label: 'Local Review' },
    { id: 'game-sec-steam-review',      label: 'Steam Review' },
    { id: 'game-sec-community-reviews', label: 'Community Reviews' },
    { id: 'game-sec-prices',            label: 'Prices' },
    { id: 'game-sec-protondb',          label: 'Linux Compat.' },
    { id: 'game-sec-pcgw',              label: 'PCGamingWiki' },
    { id: 'game-sec-nexus',             label: 'Nexus Mods' },
]
