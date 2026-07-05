import { apiGet } from './client'
import { AccountDataSchema, type AccountData } from 'gaming-journal-contracts/account'

export const getAccount = (): Promise<AccountData> => apiGet('/relay/api/account', AccountDataSchema)
