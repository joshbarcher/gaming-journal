import { apiGet, apiPost } from './client'
import { getApiHost } from './config'
import { subscribeSSE } from './sse'
import {
    RedditDataSchema, RedditSyncProgressEventSchema, RedditThreadSchema,
    type RedditData, type RedditSyncProgressEvent, type RedditThread,
} from 'gaming-journal-contracts/reddit'
import { RedditSubredditsResponseSchema, type RedditSubredditsResponse } from 'gaming-journal-contracts/redditSubreddits'
import { z } from 'zod'

// GET /relay/api/reddit/{appid} — real top-level shape is {appid,gameName,subreddit,fetchedAt,
// sources}, confirmed live; there's no `mergedAt` anywhere in it despite CommunityPage.svelte's
// own polling logic comparing against `data.mergedAt`. That comparison is real, existing web
// code — ported faithfully below in useCommunityUpdatePoll, which means (matching the web
// exactly) `hasUpdate` structurally exists but can never actually become true against this
// endpoint's real payload. Not "fixed" here — same latent no-op as the web's own production code.
export const getReddit = (appid: number, gameName?: string): Promise<RedditData> =>
    apiGet(`/relay/api/reddit/${appid}${gameName ? `?name=${encodeURIComponent(gameName)}` : ''}`, RedditDataSchema)

export const getThread = (appid: number, postId: string, sub: string, force = false): Promise<RedditThread> =>
    apiGet(`/relay/api/reddit/${appid}/thread/${postId}?sub=${encodeURIComponent(sub)}${force ? '&force=true' : ''}`, RedditThreadSchema)

export const validateSubreddit = (name: string): Promise<{ valid: boolean; name?: string; subscribers?: number }> =>
    apiGet(`/relay/api/reddit/validate-subreddit?name=${encodeURIComponent(name)}`, z.object({
        valid: z.boolean(), name: z.string().optional(), subscribers: z.number().optional(), error: z.string().optional(),
    }))

export const getLinkedSubreddits = (appid: number): Promise<RedditSubredditsResponse> =>
    apiGet(`/api/reddit-subreddits/${appid}`, RedditSubredditsResponseSchema)

export const addLinkedSubreddit = (appid: number, name: string): Promise<RedditSubredditsResponse> =>
    apiPost(`/api/reddit-subreddits/${appid}`, RedditSubredditsResponseSchema, { name })

// Sync kickoff is fire-and-forget from the caller's perspective (relay streams real progress via
// SSE separately) — mirrors the web's own `fetch(syncUrl, {method:'POST'})` which never awaits a
// meaningful body, just checks for a 409 (another sync already running).
export async function startRedditSync(appid: number, gameName: string): Promise<{ status: number }> {
    const base = await getApiHost()
    const res = await fetch(`${base}/relay/api/reddit/${appid}/sync?name=${encodeURIComponent(gameName)}`, { method: 'POST' })
    return { status: res.status }
}

export function subscribeRedditSyncProgress(
    appid: number,
    handlers: { onEvent: (e: RedditSyncProgressEvent) => void; onError?: (err: Error) => void },
): () => void {
    let unsubscribe = () => {}
    getApiHost().then(host => {
        unsubscribe = subscribeSSE<RedditSyncProgressEvent>(
            `${host}/relay/api/reddit/${appid}/sync/progress`,
            { onEvent: raw => handlers.onEvent(RedditSyncProgressEventSchema.parse(raw)), onError: handlers.onError },
        )
    })
    return () => unsubscribe()
}
