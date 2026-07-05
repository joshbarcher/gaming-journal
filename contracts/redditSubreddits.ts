// Contract for GET/POST /api/reddit-subreddits/{appid} — the per-game list of linked subreddit
// names this app's own SvelteKit route persists (relay does the actual Reddit fetching/caching
// separately). Both GET and POST return the same plain string[] (confirmed by reading
// redditSubredditsService.ts directly).
import { z } from 'zod'

export const RedditSubredditsResponseSchema = z.array(z.string())

export type RedditSubredditsResponse = z.infer<typeof RedditSubredditsResponseSchema>
