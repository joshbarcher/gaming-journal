import logger from '../../logger.js'
import { VALID_TYPES } from '../services/journalService.js'

export function listPages(req, res) {
    res.json(req.journal.getAll())
}

export function getPage(req, res) {
    const page = req.journal.getById(req.params.id)
    if (!page) return res.status(404).json({ error: 'Page not found' })
    res.json(page)
}

export async function createPage(req, res) {
    const { type, title, ...rest } = req.body ?? {}
    if (!type || !title) return res.status(400).json({ error: 'type and title are required' })
    if (!VALID_TYPES.includes(type)) {
        return res.status(400).json({ error: `type must be one of: ${VALID_TYPES.join(', ')}` })
    }
    try {
        const page = await req.journal.create({ type, title, ...rest })
        res.status(201).json(page)
    } catch (err) {
        logger.error('Failed to create page', err)
        res.status(500).json({ error: 'Failed to create page' })
    }
}

export async function updatePage(req, res) {
    const updates = req.body ?? {}
    try {
        const page = await req.journal.update(req.params.id, updates)
        if (!page) return res.status(404).json({ error: 'Page not found' })
        res.json(page)
    } catch (err) {
        logger.error('Failed to update page', err)
        res.status(500).json({ error: 'Failed to update page' })
    }
}

export async function reorderPages(req, res) {
    const { ids } = req.body ?? {}
    if (!Array.isArray(ids)) return res.status(400).json({ error: 'ids array required' })
    try {
        await req.journal.reorder(ids)
        res.json({ ok: true })
    } catch (err) {
        logger.error('Failed to reorder pages', err)
        res.status(500).json({ error: 'Failed to reorder pages' })
    }
}

export async function deletePage(req, res) {
    try {
        const removed = await req.journal.remove(req.params.id)
        if (!removed) return res.status(404).json({ error: 'Page not found' })
        res.status(204).end()
    } catch (err) {
        logger.error('Failed to delete page', err)
        res.status(500).json({ error: 'Failed to delete page' })
    }
}
