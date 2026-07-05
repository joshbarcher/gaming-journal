// Contract for GET /relay/api/reddit/{appid} and GET /relay/api/reddit/{appid}/thread/{postId}.
// Ported from the RedditPost/RedditComment/RedditSource/RedditData interfaces in
// gaming-journal's src/lib/types.ts, then EXTENDED against a real live payload (Persona 3
// Reload, appid 2161700) which carries several fields the web's own TS interface never declared
// (videoUrl/isImage/imageUrl/previewUrl/domain/stickied on posts; stickied/distinguished/
// isSubmitter on comments) — the web just reads through these via untyped access. Kept as
// optional/passthrough rather than narrowing to only what the web's types.ts declares.
//
// Top-level GET /relay/api/reddit/{appid} shape is ALSO a correction: community.md's own
// "Loading" section describes step 2 as `GET /relay/api/community/{appid}` returning `{sources}`
// — that endpoint returns a real 404 (confirmed live), doesn't exist anywhere in relay-server's
// routers. The real, working endpoint (used by CommunityPage.svelte's actual onMount code) is
// `/relay/api/reddit/{appid}`, and its real top-level shape is `{appid, gameName, subreddit,
// fetchedAt, sources}` — NOT `{sources}` alone, and there is no `mergedAt` field anywhere in it
// (see api/community.ts's getReddit for the resulting dead-code implication on the "new posts"
// poll).
import { z } from 'zod'

export const RedditGalleryImageSchema = z.object({
    url:        z.string().optional(),
    thumbnail:  z.string().nullable().optional(),
    localImage: z.string().nullable().optional(),
})

export const RedditPostSchema = z.object({
    id:            z.string(),
    title:         z.string(),
    selftext:      z.string().nullable().optional(),
    score:         z.number(),
    numComments:   z.number(),
    author:        z.string().optional(),
    subreddit:     z.string().optional(),
    permalink:     z.string().optional(),
    stickied:      z.boolean().optional(),
    isVideo:       z.boolean().optional(),
    videoUrl:      z.string().nullable().optional(),
    isImage:       z.boolean().optional(),
    imageUrl:      z.string().nullable().optional(),
    isGallery:     z.boolean().optional(),
    galleryImages: z.array(RedditGalleryImageSchema).optional(),
    previewUrl:    z.string().nullable().optional(),
    thumbnail:     z.string().nullable().optional(),
    url:           z.string().optional(),
    flair:         z.string().nullable().optional(),
    createdUtc:    z.number(),
    domain:        z.string().optional(),
    localImage:    z.string().nullable().optional(),
    localThumb:    z.string().nullable().optional(),
    localVideo:    z.string().nullable().optional(),
})

export const RedditSourceSchema = z.object({
    subreddit: z.string(),
    posts:     z.array(RedditPostSchema),
})

export const RedditDataSchema = z.object({
    appid:     z.number().optional(),
    gameName:  z.string().optional(),
    subreddit: z.string().nullable().optional(),
    fetchedAt: z.string().optional(),
    mergedAt:  z.string().optional(), // never actually present live — kept optional, see note above
    sources:   z.array(RedditSourceSchema),
})

export const RedditCommentImageSchema = z.object({
    localImage: z.string().nullable().optional(),
    url:        z.string(),
})

export const RedditCommentGifSchema = z.object({
    localVideo: z.string().nullable().optional(),
})

export const RedditImgurEntrySchema = z.object({
    images: z.array(RedditCommentImageSchema),
    failed: z.boolean().optional(),
})

export type RedditComment = {
    id?: string
    author?: string
    body?: string | null
    createdUtc?: number
    score?: number
    depth?: number
    stickied?: boolean
    distinguished?: string | null
    isSubmitter?: boolean
    images?: z.infer<typeof RedditCommentImageSchema>[]
    gifs?: z.infer<typeof RedditCommentGifSchema>[]
    imgur?: z.infer<typeof RedditImgurEntrySchema>[]
    replies?: RedditComment[]
}

export const RedditCommentSchema: z.ZodType<RedditComment> = z.lazy(() => z.object({
    id:            z.string().optional(),
    author:        z.string().optional(),
    body:          z.string().nullable().optional(),
    createdUtc:    z.number().optional(),
    score:         z.number().optional(),
    depth:         z.number().optional(),
    stickied:      z.boolean().optional(),
    distinguished: z.string().nullable().optional(),
    isSubmitter:   z.boolean().optional(),
    images:        z.array(RedditCommentImageSchema).optional(),
    gifs:          z.array(RedditCommentGifSchema).optional(),
    imgur:         z.array(RedditImgurEntrySchema).optional(),
    replies:       z.array(RedditCommentSchema).optional(),
}))

export const RedditThreadSchema = z.object({
    postId:    z.string().optional(),
    subreddit: z.string().optional(),
    fetchedAt: z.string().optional(),
    post:      RedditPostSchema,
    comments:  z.array(RedditCommentSchema),
})

// GET /relay/api/reddit/{appid}/sync/progress — SSE event shape, ported from the web's own
// `es.onmessage` handler (`ev.type === 'status'|'done'`). Not verified against a live stream this
// session (would require a real, uncached subreddit to trigger a real sync) — typed from the
// source's own JSON.parse usage rather than assumed.
export const RedditSyncProgressEventSchema = z.union([
    z.object({ type: z.literal('status'), message: z.string() }),
    z.object({ type: z.literal('done') }),
])

export type RedditGalleryImage      = z.infer<typeof RedditGalleryImageSchema>
export type RedditPost              = z.infer<typeof RedditPostSchema>
export type RedditSource            = z.infer<typeof RedditSourceSchema>
export type RedditData              = z.infer<typeof RedditDataSchema>
export type RedditThread            = z.infer<typeof RedditThreadSchema>
export type RedditSyncProgressEvent = z.infer<typeof RedditSyncProgressEventSchema>
