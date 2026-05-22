import { Router } from 'express'
import {
    getLocalReview,
    getOrSeedLocalReview,
    getAllLocalReviews,
    setLocalReview,
    deleteLocalReview,
    addNote,
    deleteNote,
    updateNote,
} from '../services/localReviewsService.js'

const router = Router()

router.get('/', async (_req, res) => {
    try {
        res.json(await getAllLocalReviews())
    } catch (err) {
        res.status(500).json({ error: err.message })
    }
})

router.get('/:appid', async (req, res) => {
    try {
        const review = await getOrSeedLocalReview(Number(req.params.appid))
        if (review === null) return res.status(404).json({ error: 'No review found' })
        res.json(review)
    } catch (err) {
        res.status(500).json({ error: err.message })
    }
})

router.put('/:appid', async (req, res) => {
    try {
        const review = await setLocalReview(Number(req.params.appid), req.body)
        res.json(review)
    } catch (err) {
        res.status(500).json({ error: err.message })
    }
})

router.delete('/:appid', async (req, res) => {
    try {
        await deleteLocalReview(Number(req.params.appid))
        res.json({ ok: true })
    } catch (err) {
        res.status(500).json({ error: err.message })
    }
})

router.post('/:appid/notes', async (req, res) => {
    try {
        const { text } = req.body
        if (!text || typeof text !== 'string' || !text.trim()) {
            return res.status(400).json({ error: 'text is required' })
        }
        const note = await addNote(Number(req.params.appid), text)
        res.json(note)
    } catch (err) {
        res.status(500).json({ error: err.message })
    }
})

router.patch('/:appid/notes/:noteId', async (req, res) => {
    try {
        const { pinned } = req.body
        const note = await updateNote(Number(req.params.appid), req.params.noteId, { pinned: Boolean(pinned) })
        if (!note) return res.status(404).json({ error: 'Note not found' })
        res.json(note)
    } catch (err) {
        res.status(500).json({ error: err.message })
    }
})

router.delete('/:appid/notes/:noteId', async (req, res) => {
    try {
        await deleteNote(Number(req.params.appid), req.params.noteId)
        res.json({ ok: true })
    } catch (err) {
        res.status(500).json({ error: err.message })
    }
})

export default router
