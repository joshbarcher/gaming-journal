import { z } from 'zod'

import { apiDelete, apiGet, apiPost, apiPut } from './client'
import { FranchiseListSchema, FranchiseSchema, type Franchise } from 'gaming-journal-contracts/franchises'

export const getFranchises = () => apiGet('/api/franchises', FranchiseListSchema)
export const getFranchise = (id: string) => apiGet(`/api/franchises/${id}`, FranchiseSchema)
export const createFranchise = (name: string) => apiPost('/api/franchises', FranchiseSchema, { name })
export const updateFranchiseName = (id: string, name: string) => apiPut(`/api/franchises/${id}`, FranchiseSchema, { name })
// DELETE franchise returns a bare 204 per src/routes/api/franchises/[id]/+server.ts — read the
// handler directly rather than guessing, per the standing rule about unverified mutation shapes.
export const deleteFranchise = (id: string) => apiDelete(`/api/franchises/${id}`, z.unknown())
export const addFranchiseEntry = (id: string, entry: { appid: number; name: string }): Promise<Franchise> =>
    apiPost(`/api/franchises/${id}/entries`, FranchiseSchema, entry)
export const removeFranchiseEntry = (id: string, appid: number): Promise<Franchise> =>
    apiDelete(`/api/franchises/${id}/entries/${appid}`, FranchiseSchema)
export const reorderFranchiseEntries = (id: string, appids: number[]): Promise<Franchise> =>
    apiPut(`/api/franchises/${id}/entries/order`, FranchiseSchema, { appids })
