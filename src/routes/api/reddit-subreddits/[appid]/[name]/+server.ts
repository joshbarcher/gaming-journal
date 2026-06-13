import { json } from '@sveltejs/kit'
import { removeSubreddit } from '$lib/server/services/redditSubredditsService.js'

export async function DELETE({ params }: { params: { appid: string; name: string } }) {
    try {
        return json(await removeSubreddit(params.appid, params.name))
    } catch (err) {
        return json({ error: (err as Error).message }, { status: 500 })
    }
}
