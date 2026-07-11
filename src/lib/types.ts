// ── Task / Step / Bar ─────────────────────────────────────────────────────────

export type TaskState = 'done' | 'working' | 'started' | 'todo'

export interface Task {
    id:        string
    title:     string
    state:     TaskState | null
    optional?: boolean
    notes?:    string
}

export interface Step {
    id:        string
    title:     string
    state:     TaskState | null
    optional?: boolean
}

export interface Bar {
    id:        string
    title:     string
    steps:     Step[]
    optional?: boolean
}

// ── Counter ───────────────────────────────────────────────────────────────────

export interface Counter {
    id:      string
    name?:   string
    target:  number
    current: number
}

// ── List items ────────────────────────────────────────────────────────────────

export interface JournalListItem {
    id:        string
    title:     string
    done?:     boolean
    order?:    number
    subtasks?: string[]
}

export interface EditorListItem {
    depth: number
    html:  string
}

// ── Page ──────────────────────────────────────────────────────────────────────

export type PageType =
    | 'list'
    | 'progress'
    | 'progress-bars'
    | 'notes'
    | 'page'
    | 'counter'
    | 'multi-counter'

interface PageBase {
    id:        string
    type:      PageType
    title:     string
    appid?:    string
    createdAt: string
    updatedAt: string
}

export interface ListPage extends PageBase {
    type:    'list'
    ordered: boolean
    items:   JournalListItem[]
}

export interface ProgressPage extends PageBase {
    type:  'progress'
    tasks: Task[]
    notes: string
}

export interface ProgressBarsPage extends PageBase {
    type:  'progress-bars'
    bars:  Bar[]
    notes: string
}

export type NoteSize  = 'sm' | 'md' | 'lg'
export type NoteColor = 'yellow' | 'green' | 'pink' | 'blue' | 'purple' | 'red'

export interface StickyNote {
    id:       string
    label:    string
    message:  string
    from:     string
    size:     NoteSize
    color:    NoteColor
    rotation: number
}

export interface NotesPage extends PageBase {
    type:  'notes'
    notes: StickyNote[]
}

export interface ContentPage extends PageBase {
    type:    'page'
    content: string
}

export interface CounterPage extends PageBase {
    type:         'counter'
    current:      number
    target:       number
    description?: string
}

export interface MultiCounterPage extends PageBase {
    type:     'multi-counter'
    counters: Counter[]
}

export type Page =
    | ListPage
    | ProgressPage
    | ProgressBarsPage
    | NotesPage
    | ContentPage
    | CounterPage
    | MultiCounterPage

// ── Flags ─────────────────────────────────────────────────────────────────────

export type FlagKey =
    | 'software' | 'childLock' | 'filtered' | 'alert'
    | 'favorite' | 'revisit'
    | 'completed' | 'dropped' | 'inProgress' | 'backlog'

export type Flags = Partial<Record<FlagKey, boolean>>

export type FlagsStore = Record<string, Flags>

// ── Settings ──────────────────────────────────────────────────────────────────

export interface Settings {
    showChildLocked:        boolean
    showFiltered:           boolean
    showSoftware:           boolean
    hideUnavailable:        boolean
    titleBlocklist:         string[]
    discoverFiltersEnabled: boolean
    hideAdultContent:       boolean
}

// ── Local review ──────────────────────────────────────────────────────────────

export interface ReviewNote {
    id:        string
    text:      string
    pinned:    boolean
    createdAt: string
}

export interface LocalReview {
    stars:     number
    ratings:   Record<string, number>
    tags:      string[]
    notes:     ReviewNote[]
    review:    string
    badges?:   Record<string, boolean | number>
    updatedAt: string
}

// ── Franchise ─────────────────────────────────────────────────────────────────

export interface FranchiseEntry {
    appid: number
    name:  string
}

export interface Franchise {
    id:        string
    name:      string
    entries:   FranchiseEntry[]
    createdAt: string
    updatedAt: string
}

// ── Wishlist ──────────────────────────────────────────────────────────────────

export interface WishlistItem {
    dateAdded: number
}

export interface WishlistStore {
    items: Record<string, WishlistItem>
}

// ── Community prefs ───────────────────────────────────────────────────────────

export interface CommunityPrefs {
    filtered:    string[]
    muted:       string[]
    favorited:   string[]
    highlighted: Record<string, string[]>
}

// ── Segments (progress-helpers) ───────────────────────────────────────────────

export interface Segment {
    num:        number
    color:      string
    label:      string
    stateLabel: string
    optional:   boolean
    done:       boolean
}

// ── Alerts ────────────────────────────────────────────────────────────────────

export interface BestPrice {
    price: number
    cut:   number
    store: string
    url:   string | null
}

export interface AlertResult {
    appid:         number
    name:          string
    bestPrice:     BestPrice | null
    historicalLow: ItadHistoricalLow | null
    isLibrary:     boolean
}

// ── ITAD (IsThereAnyDeal) prices ──────────────────────────────────────────────

export interface ItadDeal {
    store:   string
    price:   number
    regular: number
    cut:     number
    url:     string
}

export interface ItadHistoricalLow {
    price: number
    cut:   number
    store: string
    date?: string
}

export interface ItadData {
    deals?:         ItadDeal[]
    historicalLow?: ItadHistoricalLow
    bestPrice?: {
        price: number
        cut:   number
        store: string
    }
}

// ── Steam / Game data (relay API) ─────────────────────────────────────────────

export interface SteamGame {
    appid:              number
    name:               string
    source?:            'library' | 'wishlist' | 'both' | 'discovered'
    playtimeMinutes?:   number
    playtimeMin?:       number
    playtime?:          number
    playtime_forever?:  number
    playtime2weeks?:    number
    rtime_last_played?: number
    lastPlayedAt?:      string
    effectiveMin?:      number

    media?: {
        header?:      string
        poster?:      string
        background?:  string
        logo?:        string
        screenshots?: string[]
    }
    store?: {
        description?:         string
        detailedDescription?: string
        releaseDate?:         string
        releaseDateIso?:      string
        comingSoon?:          boolean
        developers?:          string[]
        publishers?:          string[]
        genres?:              string[]
        categories?:          string[]
        platforms?:           { windows?: boolean; mac?: boolean; linux?: boolean }
        price?:               { final_formatted?: string; amount?: number }
        isFree?:              boolean
        unavailable?:         boolean
        metacritic?:          number | { score: number; url?: string }
    }
    hltb?: {
        matched:                boolean
        mainStory?:             number
        gameplayMain?:          number
        gameplayMainExtra?:     number
        gameplayCompletionist?: number
    }
    itad?:     ItadData
    wishlist?: {
        priority?:  number
        dateAdded?: number
        local?:     boolean
        steam?:     boolean
    }
    flags?:     Flags
    bestPrice?: BestPrice
}

// ── Trailers ──────────────────────────────────────────────────────────────────

export interface Trailer {
    index:      number
    name:       string
    thumbnail?: string
}

// ── Player counts ─────────────────────────────────────────────────────────────

export interface PlayerCounts {
    appid:   number
    samples: [number, number][]
}

// ── News ──────────────────────────────────────────────────────────────────────

export interface NewsItem {
    date?:     number
    feedlabel: string
    title:     string
    contents?: string
    url?:      string
}

export interface NewsData {
    items?: NewsItem[]
}

// ── ProtonDB ──────────────────────────────────────────────────────────────────

export interface ProtonData {
    tier?:       string
    total?:      number
    score?:      number
    confidence?: string
}

// ── PCGamingWiki ──────────────────────────────────────────────────────────────

/** Per-row free text from a PCGW table's notes cell, as trusted HTML. */
export type PcgwNotes = Record<string, string>

export interface PcgwInput {
    mouse?:      Record<string, string>
    keyboard?:   Record<string, string>
    controller?: Record<string, string>
    platform?:   Record<string, string>
    notes?:      Record<string, PcgwNotes>
}

export interface PcgwVideo extends Record<string, string | PcgwNotes | undefined> {
    notes?: PcgwNotes
}

export interface PcgwPaths {
    saveGame?: Record<string, string>
    config?:   Record<string, string>
}

export interface PcgwFix {
    title:  string
    /** Enclosing <h2>, e.g. "Issues unresolved". Null when the fix heading is itself an h2. */
    group?: string | null
    html:   string
}

export interface PcgwData {
    found?:        boolean
    video?:        PcgwVideo
    input?:        PcgwInput
    cloud?:        Record<string, string> & { notes?: PcgwNotes }
    availability?: { drm?: string[] }
    paths?:        PcgwPaths
    fixes?:        PcgwFix[]
    pageUrl?:      string
}

// ── NexusMods ───────────────────────────────────────────────────────────────────

export interface NexusMod {
    modId:           number
    name:            string
    summary?:        string | null
    version?:        string | null
    author?:         string | null
    uploaderName?:   string | null
    uploaderAvatar?: string | null
    imageUrl?:       string | null   // Nexus CDN — fallback only
    thumbUrl?:       string | null   // Nexus CDN — fallback only
    localImage?:     string | null   // /images/nexus/… served via /relay — preferred
    localThumb?:     string | null
    downloads:       number
    endorsements:    number
    adult:           boolean
    category?:       string | null
    createdAt?:      string | null
    updatedAt?:      string | null
    url:             string
}

export interface NexusData {
    appid:       number
    steamName?:  string | null
    domainName?: string | null   // null when the game isn't on Nexus (sentinel)
    gameId?:     number | null
    nexusName?:  string | null
    gameUrl?:    string | null
    totalMods?:  number
    fetchedAt?:  string
    mods:        NexusMod[]
}

// ── Steam reviews ─────────────────────────────────────────────────────────────

export interface SteamReviewAuthor {
    playtime_at_review?: number
}

export interface SteamUserReview {
    voted_up?:                    boolean
    review?:                      string
    author?:                      SteamReviewAuthor
    timestamp_created?:           number
    votes_up?:                    number
    written_during_early_access?: boolean
}

export interface SteamUserReviewEntry {
    review?:    SteamUserReview
    fetchedAt?: string
}

export interface CommunityReviewSummary {
    scoreDesc?:     string
    totalPositive?: number
    totalNegative?: number
    ratio?:         number
}

export interface CommunityReviewItem {
    votedUp?:       boolean
    postedAt?:      string
    fetchedAt?:     string
    hoursAtReview?: number
    review?:        { author?: SteamReviewAuthor }
    votesUp?:       number
    text?:          string
    earlyAccess?:   boolean
}

export interface CommunityReviews {
    totalReviews?: number
    summary?:      CommunityReviewSummary
    reviews?:      CommunityReviewItem[]
}

// ── Reddit / Community data ───────────────────────────────────────────────────

export interface RedditGalleryImage {
    url?:        string
    thumbnail?:  string | null
    localImage?: string | null
}

export interface RedditPost {
    id:             string
    title:          string
    author?:        string
    score:          number
    numComments:    number
    createdUtc:     number
    subreddit?:     string
    permalink?:     string
    selftext?:      string
    flair?:         string
    isVideo?:       boolean
    isGallery?:     boolean
    thumbnail?:     string | null
    url?:           string
    localThumb?:    string | null
    localImage?:    string | null
    localVideo?:    string | null
    galleryImages?: RedditGalleryImage[]
}

export interface RedditCommentImage {
    localImage?: string | null
    url:         string
}

export interface RedditCommentGif {
    localVideo?: string | null
}

export interface RedditImgurEntry {
    images:  RedditCommentImage[]
    failed?: boolean
}

export interface RedditComment {
    id?:         string
    author?:     string
    body?:       string | null
    createdUtc?: number
    score?:      number
    images?:     RedditCommentImage[]
    gifs?:       RedditCommentGif[]
    imgur?:      RedditImgurEntry[]
    replies?:    RedditComment[]
    depth?:      number
}

export interface RedditSource {
    subreddit: string
    posts:     RedditPost[]
}

export interface RedditData {
    sources: RedditSource[]
}

export interface CommunitySource {
    id:    string
    label: string
    posts: RedditPost[]
}

export interface PinState {
    appid:            number
    name:             string
    pinnedAt:         string
    reason:           'playing' | 'manual'
    sessionEndedAt:   string | null
    postsAccumulated: number
    lastRefreshedAt:  string | null
    expiresAt:        string
}

// ── Community prefs (runtime, Set-based — distinct from stored CommunityPrefs) ─

export interface LoadedPrefs {
    filtered:    Set<string>
    muted:       Set<string>
    favorited:   Set<string>
    highlighted: Set<string>
}

// ── Discover / Search ─────────────────────────────────────────────────────────

export interface DiscoverItem {
    appid:          number
    name:           string
    headerImage?:   string
    posterImage?:   string
    price?:         number
    originalPrice?: number
    discount?:      number
    isFree?:        boolean
    isAdult?:       boolean
}

export interface DiscoverSection {
    id:     string
    label?: string
    page:   number
    pages:  number
    items:  DiscoverItem[]
}

export interface SearchResults {
    results: DiscoverItem[]
    total:   number
}

// ── Account / Profile ─────────────────────────────────────────────────────────

export interface AccountProfile {
    avatar?:      string
    name:         string
    realName?:    string
    profileUrl?:  string
    memberSince?: string
    lastLogoff?:  string
}

export interface AccountSteam {
    level?: number
    xp?:    number
}

export interface AccountStats {
    totalHoursPlayed?:     number
    gamesPlayed?:          number
    achievementsUnlocked?: number
    reviewsWritten?:       number
    totalGames?:           number
    wishlistCount?:        number
}

export interface GameSession {
    startedAt:    string
    endedAt:      string | null
    durationMin?: number
}

export interface AccountGameRecord {
    name:      string
    sessions?: GameSession[]
}

export interface SessionDay {
    day:      string
    label:    string
    sessions: Array<GameSession & { name: string }>
}

export interface AccountData {
    profile:         AccountProfile
    steam?:          AccountSteam
    stats?:          AccountStats
    recentlyPlayed?: SteamGame[]
    mostPlayed?:     SteamGame[]
    sessions?:       Record<string, AccountGameRecord>
}

// ── Journal / Achievements ────────────────────────────────────────────────────

export interface AchievementItem {
    apiname:        string
    displayName?:   string
    icon?:          string | null
    localIcon?:     string | null
    icongray?:      string | null
    localIconGray?: string | null
    achieved?:      number
    unlocktime?:    number
    description?:   string
    hidden?:        boolean
}

export interface SessionAchievement {
    apiname:     string
    unlocktime?: number
}

export interface JournalSession {
    startedAt:     string
    endedAt?:      string | null
    durationMin?:  number
    achievements?: SessionAchievement[]
}

export interface NowPlayingSession {
    appid:               number
    name?:               string
    sessionStartedAt?:   string
    achievementsDuring?: SessionAchievement[]
}

export interface NowPlaying {
    playing?: NowPlayingSession
}
