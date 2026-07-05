import { apiGet } from './client'
import { getApiHost } from './config'
import { GuideContentResponseSchema } from 'gaming-journal-contracts/guideContent'
import { GuideMetaSchema } from 'gaming-journal-contracts/guideMeta'
import { GuideFulltextResponseSchema } from 'gaming-journal-contracts/guideFulltext'
import {
    GuideSearchGetResponseSchema, SearchSseEventSchema,
    type GuideSearchData, type GuideSource, type SearchSseEvent,
} from 'gaming-journal-contracts/guideSearch'
import type { ContentBlock } from '@/components/shared/ContentBlockRenderer'

export const getGuideMeta = (appid: number, source: string, guideId: string) =>
    apiGet(`/relay/api/guides/${appid}/${source}/${guideId}/meta`, GuideMetaSchema)

export const getGuideFulltext = (appid: number, source: string, guideId: string) =>
    apiGet(`/relay/api/guides/${appid}/${source}/${guideId}/fulltext`, GuideFulltextResponseSchema)

// GET /relay/api/guides/{appid}/{source}/{guideId}/{slug} — a page's parsed content blocks.
// Extended further in upcoming Guide TODO items (landing/search/download/viewer); this is just
// what ContentBlockRenderer's own verification needed.
export async function getGuideSectionBlocks(appid: number, source: string, guideId: string, slug: string): Promise<ContentBlock[]> {
    const parsed = await apiGet(`/relay/api/guides/${appid}/${source}/${guideId}/${encodeURIComponent(slug)}`, GuideContentResponseSchema)
    return parsed as ContentBlock[]
}

// GET /relay/api/guides/{appid}/search — the cached _search.json, or `null` if no search has ever
// been run for this game (a real 200-with-null-body, not a 404 — matches handleSearch()'s own
// catch-and-res.json(null) behavior, confirmed live).
export const getGuideSearchData = (appid: number) =>
    apiGet(`/relay/api/guides/${appid}/search`, GuideSearchGetResponseSchema)

// POST /relay/api/guides/{appid}/search — runs a live search for one source and streams SSE
// progress. **Not built on the shared `subscribeSSE` client (Phase 0)** — that generic reader
// never inspects `res.ok`, so a 409 ("search already running", a real documented response per
// search.md's own "Common questions") would fall through the frame parser as zero events (its JSON
// error body has no `data: ` lines) and just silently do nothing, rather than triggering the
// web's documented fallback: wait 6s, then GET the cached search and merge whatever arrived. Ported
// `runSearch()`'s exact fetch+reader+409 logic directly instead, keeping the same `data: <json>\n\n`
// frame-splitting technique subscribeSSE uses internally.
export async function runGuideSearch(
    appid: number,
    gameName: string,
    source: GuideSource,
    handlers: { onEvent: (e: SearchSseEvent) => void; onError?: (err: Error) => void; onDone?: () => void },
): Promise<void> {
    const host = await getApiHost()
    let res: Response
    try {
        res = await fetch(`${host}/relay/api/guides/${appid}/search`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
            body: JSON.stringify({ gameName, source }),
        })
    } catch (err) {
        handlers.onError?.(err as Error)
        return
    }

    if (res.status === 409) {
        setTimeout(async () => {
            try {
                const cached = await getGuideSearchData(appid)
                const entry = cached?.sources?.[source]
                if (entry) handlers.onEvent({ phase: 'done', data: cached })
            } catch { /* silent, matching the web's own best-effort retry */ }
            handlers.onDone?.()
        }, 6_000)
        return
    }

    if (!res.ok || !res.body) {
        handlers.onError?.(new Error(`HTTP ${res.status}`))
        return
    }

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    try {
        for (;;) {
            const { done, value } = await reader.read()
            if (done) break
            buffer += decoder.decode(value, { stream: true })
            const frames = buffer.split('\n\n')
            buffer = frames.pop() ?? ''
            for (const frame of frames) {
                const line = frame.split('\n').find(l => l.startsWith('data: '))
                if (!line) continue
                try {
                    handlers.onEvent(SearchSseEventSchema.parse(JSON.parse(line.slice('data: '.length))))
                } catch { /* malformed frame — skip rather than crash the stream */ }
            }
        }
        handlers.onDone?.()
    } catch (err) {
        handlers.onError?.(err as Error)
    }
}

export type { GuideSearchData }

export function guideImageUrl(apiHost: string, appid: number, source: string, guideId: string, section: string, localSrc: string): string {
    // Ported verbatim from GuideBlockRenderer.svelte's imgUrl(): strips the `img/` prefix, forces
    // a .webp extension (images are WebP-converted during parsing), and encodes the section slug.
    const filename = localSrc.replace(/^img\//, '').replace(/\.[^.]+$/, '.webp')
    const sectionEncoded = encodeURIComponent(section)
    return `${apiHost}/relay/guides-img/${appid}/${source}/${guideId}/${sectionEncoded}/img/${filename}`
}
