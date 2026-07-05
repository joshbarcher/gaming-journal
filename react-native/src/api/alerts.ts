import { apiGet } from './client'
import { AlertsResponseSchema, type AlertsResponse } from 'gaming-journal-contracts/alerts'

// SvelteKit's own route (not relay-proxied) — backs the (still-stubbed) Sale Alerts screen and
// Home's sale card, which only reads `.onSale`.
export const getAlerts = (): Promise<AlertsResponse> => apiGet('/api/alerts', AlertsResponseSchema)
