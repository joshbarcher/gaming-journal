import { apiGet, apiPut } from './client'
import { OrderSchema, type Order } from 'gaming-journal-contracts/order'

export async function getOrder(list: string): Promise<Order> {
    return apiGet(`/api/order/${list}`, OrderSchema)
}

export async function setOrder(list: string, appids: number[]): Promise<Order> {
    return apiPut(`/api/order/${list}`, OrderSchema, appids)
}
