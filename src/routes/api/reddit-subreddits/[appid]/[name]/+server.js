import { json } from '@sveltejs/kit'
import { removeSubreddit } from '$lib/server/services/redditSubredditsService.js'

export async function DELETE({ params }) {
    try {
        return json(await removeSubreddit(params.appid, params.name))
    } catch (err) {
        return json({ error: err.message }, { status: 500 })
    }
}
