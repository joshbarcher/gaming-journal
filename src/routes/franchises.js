import { Router } from 'express'
import {
    handleListFranchises,
    handleGetFranchise,
    handleCreateFranchise,
    handleUpdateFranchise,
    handleDeleteFranchise,
    handleAddEntry,
    handleRemoveEntry,
    handleReorderEntries,
} from '../controllers/franchisesController.js'

const router = Router()

router.get('/',    handleListFranchises)
router.post('/',   handleCreateFranchise)

router.get('/:id',    handleGetFranchise)
router.put('/:id',    handleUpdateFranchise)
router.delete('/:id', handleDeleteFranchise)

router.post('/:id/entries',                    handleAddEntry)
router.delete('/:id/entries/:appid',           handleRemoveEntry)
router.put('/:id/entries/order',               handleReorderEntries)

export default router
