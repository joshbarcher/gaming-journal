import { Router } from 'express'
import { getSubreddits, addSubreddit, removeSubreddit } from '../services/redditSubredditsService.js'

const router = Router()

router.get('/:appid', async (req, res) => {
    try {
        res.json(await getSubreddits(req.params.appid))
    } catch (err) {
        res.status(500).json({ error: err.message })
    }
})

router.post('/:appid', async (req, res) => {
    const { name } = req.body
    if (!name || typeof name !== 'string') return res.status(400).json({ error: 'name required' })
    try {
        res.json(await addSubreddit(req.params.appid, name.trim()))
    } catch (err) {
        res.status(500).json({ error: err.message })
    }
})

router.delete('/:appid/:name', async (req, res) => {
    try {
        res.json(await removeSubreddit(req.params.appid, req.params.name))
    } catch (err) {
        res.status(500).json({ error: err.message })
    }
})

export default router
