import { Router } from 'express'
import { getJournalService } from '../services/journalService.js'
import {
    listPages, getPage, createPage, updatePage, deletePage, reorderPages,
} from '../controllers/pagesController.js'

const router = Router()

router.use((req, res, next) => {
    req.journal = getJournalService()
    next()
})

router.get('/',       listPages)
router.put('/order',  reorderPages)
router.get('/:id',    getPage)
router.post('/',      createPage)
router.put('/:id',    updatePage)
router.delete('/:id', deletePage)

export default router
